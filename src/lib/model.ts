/**
 * A pull request turned into an investigation board: the pieces of evidence
 * (pins) and the links between them.
 *
 * Each pin is a card: the pull request, a changed declaration, the unchanged
 * caller of a thread's entry, a test file, or a file with no readable
 * declarations. Changed declarations joined by links form threads, each
 * laid out as a band; changes that join no thread go to the bottom row. The
 * steps walk the pins in board order, which the layout decides, so
 * `buildReview` plans the board once to fix it.
 *
 * A link is a fact: every link comes from a reference a linker resolved,
 * `linker.ts` for JavaScript and TypeScript, `anylink.ts` for the languages
 * with a rule table: the innermost card holding the reference, to the card
 * standing for what it names. Other languages keep the line patterns of
 * `symbols.ts` for their cards, and draw no strings.
 */

import { isGeneric } from "./anyfacts.ts";
import { resolveAny } from "./anylink.ts";
import { addedHunks, parsePatch, type DiffLine, type Hunk } from "./diff.ts";
import type { FileFacts, Unit } from "./facts.ts";
import { sortBy } from "./fp.ts";
import type { FileStatus, PrFile, PrInfo } from "./github.ts";
import { layers } from "./graph.ts";
import { langOf } from "./langs/index.ts";
import { laneRank, planBoard, type BoardPlan } from "./layout.ts";
import { languageOf, roleOf, type FileRole, type Language } from "./language.ts";
import { builtinRule, resolveAll, type Ref } from "./linker.ts";
import { readSources, type Parse, type Read, type Sources } from "./sources.ts";
import { changedSymbols, isComment, labelOf, looseRuns, testCases, type ChangedSymbol, type LooseChange, type TestCase } from "./symbols.ts";
import { lineOf, textOf, type Flat } from "./syntax.ts";

export type ReviewFile = {
    path: string;
    previousPath?: string;
    status: FileStatus;
    role: FileRole;
    lang: Language;
    additions: number;
    deletions: number;
    hunks: Hunk[];
    /** False when GitHub left the diff out. */
    hasPatch: boolean;
    symbols: ChangedSymbol[];
    loose: LooseChange[];
    cases: TestCase[];
};

export type PinKind = "pr" | "change" | "context" | "test" | "file";
export type PinStatus = "new" | "changed" | "unchanged";
/**
 * Where a pin sits: in a thread's flow, in the row under it (the thread's
 * tests, and file cards whose every link goes into it), or in the bottom row.
 */
export type Lane = "flow" | "under" | "rest";

export type Pin = {
    id: string;
    kind: PinKind;
    /** What the card is called: `#dispatch()`, `hono-base.ts imports`, `compose.test.ts`. */
    name: string;
    path?: string;
    symbol?: ChangedSymbol;
    /** The head lines the card covers. */
    from: number;
    to: number;
    /** The band it belongs to; the bottom row counts as the band after the last. */
    band: number;
    lane: Lane;
    /** Column within its band: callers left, what they call right. */
    column: number;
    status: PinStatus;
    add: number;
    del: number;
    /** Head lines `from`..`to`, for change and context cards. */
    head?: string[];
    /** A file card about only some of a file's changes: these head ranges. */
    ranges?: { from: number; to: number }[];
};

export type LinkKind = "calls" | "uses" | "context" | "tests" | "imports";

export type Link = {
    id: string;
    from: string;
    to: string;
    kind: LinkKind;
    /** How a context link reads: `calls` when one of its references is a call, else `uses`. */
    reads?: "calls" | "uses";
    /** Head line in `from` where the string starts. */
    at?: number;
    /** The head lines in `from` that make the link: its calls for `calls`, else every reference. */
    rows: number[];
};

/** A thread of changed declarations joined by links, with its tests: one band of the board. */
export type Band = {
    /** The changed declarations nothing else in the thread links to. */
    entries: string[];
};

export type Review = {
    pr: PrInfo;
    files: ReviewFile[];
    /** Declarations when PR Blackboard could read them, otherwise whole files. */
    mode: "symbols" | "files";
    pins: Pin[];
    links: Link[];
    bands: Band[];
    /** Every pin by id in board order: left to right along each band, the row under it, then the bottom row. */
    order: string[];
    /**
     * What the card limit left off: changed declarations with no card, and
     * changed files with no card whose declarations aren't counted already.
     */
    unpinned: { functions: number; files: number };
};

/** Cards a board holds at most, the PR card and context cards included; and the most one thread's part takes when threads overflow it. */
export const LIMITS = { cards: 32, part: 8 } as const;

/** What a card needs of a parsed file, whichever parser read it. */
type Parsed = Pick<FileFacts, "path" | "flat" | "units">;

/**
 * What the read tier gave: every text read, the parsed files' facts, the
 * references that resolved, and the card names the rule tables give their
 * units (`Server.Start()`), which `labelOf` gives the rest.
 */
export type Analysed = { texts: ReadonlyMap<string, string>; facts: ReadonlyMap<string, Parsed>; refs: readonly Ref[]; labels: ReadonlyMap<string, string> };

/** A review and its board's plan, which fixes the review's order. */
export type Built = { review: Review; plan: BoardPlan };

const fileName = (path: string) => path.split("/").pop() ?? path;

/**
 * Reads what the board needs (`sources.ts`), resolves its references and
 * builds the review: the one path from a pull request's files to its board,
 * for the parser worker, the tests and the score gate alike.
 */
export const analyse = async (pr: PrInfo, files: readonly PrFile[], read: Read, parse: Parse): Promise<Built> => {
    const sources: Sources = await readSources(files, read, parse);
    const changed = new Set(files.filter((f) => f.status !== "removed").map((f) => f.path));
    const parsed = [...sources.facts.values()];
    const generic = parsed.filter(isGeneric);
    const refs = [
        ...resolveAll(
            parsed.filter((f): f is FileFacts => !isGeneric(f)),
            changed,
            { paths: sources.paths, builtin: builtinRule(pr.ref, changed) }
        ),
        ...resolveAny(generic, (f) => langOf(f.path)!.resolver, (path) => sources.texts.get(path), sources.exists),
    ];
    const labels = new Map(generic.flatMap((f) => [...f.labels]));
    return buildReview(pr, files, { texts: sources.texts, facts: sources.facts, refs, labels });
};

/** Adds a value to the list kept under a key. */
const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
    const values = map.get(key);
    if (values) values.push(value);
    else map.set(key, [value]);
};

/** Groups of ids joined by edges in either direction, each in the order given. */
const components = (ids: readonly string[], edges: readonly { from: string; to: string }[]): string[][] => {
    const known = new Set(ids);
    const adj = new Map<string, string[]>();
    for (const e of edges) {
        push(adj, e.from, e.to);
        push(adj, e.to, e.from);
    }
    const group = new Map<string, number>();
    let groups = 0;
    for (const id of ids) {
        if (group.has(id)) continue;
        const g = groups++;
        group.set(id, g);
        const stack = [id];
        while (stack.length > 0) {
            for (const next of adj.get(stack.pop()!) ?? []) {
                if (group.has(next) || !known.has(next)) continue;
                group.set(next, g);
                stack.push(next);
            }
        }
    }
    const out: string[][] = Array.from({ length: groups }, () => []);
    for (const id of ids) out[group.get(id)!].push(id);
    return out;
};

/** Threads, largest first, then the bottom row: the order cards are pinned in. */
const threadsOf = (ids: readonly string[], edges: readonly { from: string; to: string }[]) => {
    const first = new Map<string, number>();
    for (const [i, id] of ids.entries()) if (!first.has(id)) first.set(id, i);
    return sortBy(
        components(ids, edges).filter((g) => g.length >= 2),
        (g) => -g.length,
        (g) => first.get(g[0])!
    );
};

/** For each thread, the edges between its own members, in the order given: what its columns come from. */
const threadEdges = (threads: readonly string[][], edges: readonly { from: string; to: string }[]): (readonly [string, string])[][] => {
    const threadOf = new Map(threads.flatMap((members, b) => members.map((id) => [id, b] as const)));
    const out = threads.map((): (readonly [string, string])[] => []);
    for (const e of edges) {
        const b = threadOf.get(e.from);
        if (b !== undefined && threadOf.get(e.to) === b) out[b].push([e.from, e.to]);
    }
    return out;
};

const IMPORT_LINE = /^\s*(import\b|from\s+\S+\s+import\b|export\s.*\bfrom\b|use\s|#include|require\(|const\s.*=\s*require\()/;

/** Python's, Go's and Rust's import statements. */
const IMPORTS = new Set(["import_from_statement", "future_import_statement", "import_declaration", "use_declaration"]);

/** The head lines inside a module's import statements: `import`, `export … from`, a module-level `const x = require(…)`, `from x import y`, `use a::b`. */
const importLines = (t: Flat): Set<number> => {
    const lines = new Set<number>();
    for (let n = t.first[0]; n >= 0; n = t.next[n]) {
        const ty = t.type[n];
        const text = textOf(t, n);
        const isImport =
            ty === "import_statement" ||
            IMPORTS.has(ty) ||
            (ty === "export_statement" && /\bfrom\s*["']/.test(text) && !/^export\s+(default\s+)?(async\s+)?(function|class|const|let|var|interface|type|enum)\b/.test(text)) ||
            ((ty === "lexical_declaration" || ty === "variable_declaration") && /^\s*(const|let|var)\b[^=]*=\s*require\s*\(\s*["'][^"']+["']\s*\)\s*;?\s*$/.test(text));
        if (isImport) for (let l = lineOf(t, t.start[n]); l <= lineOf(t, Math.max(t.start[n], t.end[n] - 1)); l++) lines.add(l);
    }
    return lines;
};

/** Doc comments right above a declaration that mark it deprecated. */
const isDeprecated = (lines: readonly string[], start: number, lang: Language): boolean => {
    for (let n = start - 1; n >= 1 && n >= start - 40; n--) {
        const line = lines[n - 1];
        if (!isComment(line, lang) && !/^\s*@/.test(line)) return false;
        if (/@deprecated\b/.test(line)) return true;
    }
    return false;
};

/**
 * A parsed file's changes: each changed line belongs to the innermost unit
 * whose range, from its first attached comment to its last line, holds the
 * line's head position (a deletion sits at the head line after it). Added
 * blank lines belong to nothing; the rest is loose.
 */
const parsedChanges = (path: string, lang: Language, ff: Parsed, hunks: readonly Hunk[], units: Map<string, Unit>, nameOf: (u: Unit) => string): { symbols: ChangedSymbol[]; loose: LooseChange[] } => {
    const text = ff.flat.text.split("\n");
    const changed = hunks.flatMap((h) => h.lines).filter((l) => l.t !== "ctx" && !(l.t === "add" && (text[l.at - 1] ?? "").trim() === ""));
    // Each line's owner: the unit with the shortest range holding it, the first on a tie.
    const owners = new Array<Unit | undefined>(text.length + 2).fill(undefined);
    for (const u of ff.units) {
        for (let n = u.docLine; n <= u.endLine; n++) {
            const best = owners[n];
            if (!best || u.endLine - u.docLine < best.endLine - best.docLine) owners[n] = u;
        }
    }
    const owned = new Map<Unit, DiffLine[]>();
    const loose: DiffLine[] = [];
    for (const l of changed) {
        const owner = owners[l.at];
        if (owner) push(owned, owner, l);
        else loose.push(l);
    }
    const added = new Set(changed.filter((l) => l.t === "add").map((l) => l.n!));
    const symbols = ff.units.flatMap((u): ChangedSymbol[] => {
        const ls = owned.get(u);
        if (!ls) return [];
        units.set(u.id, u);
        const ats = ls.map((l) => l.at);
        return [
            {
                id: u.id,
                path,
                lang,
                name: u.name,
                label: nameOf(u),
                kind: u.kind,
                status: added.has(u.nameLine) ? "new" : "changed",
                start: u.startLine,
                end: u.endLine,
                from: ats.reduce((a, b) => Math.min(a, b)),
                to: ats.reduce((a, b) => Math.max(a, b)),
                add: ls.filter((l) => l.t === "add").length,
                del: ls.filter((l) => l.t === "del").length,
            },
        ];
    });
    return { symbols, loose: looseRuns(path, loose) };
};

/** A pin's first shown line: the declaration's first line, or its first change when that comes earlier. */
const pinFrom = (s: ChangedSymbol) => Math.min(s.from, s.start);

export const buildReview = (pr: PrInfo, prFiles: readonly PrFile[], analysed: Analysed): Built => {
    const { facts } = analysed;
    const heads = new Map([...analysed.texts].map(([path, text]) => [path, text.split("\n")]));
    /** The parsed unit behind each changed symbol of a parsed file. */
    const units = new Map<string, Unit>();
    const nameOf = (u: Unit) => analysed.labels.get(u.id) ?? labelOf(u);
    const files: ReviewFile[] = prFiles.map((f) => {
        const role = roleOf(f.path);
        const lang = languageOf(f.path);
        // A file added whole is all new: when GitHub leaves its patch out, its text read gives it.
        const whole = f.patch === undefined && f.status === "added" ? analysed.texts.get(f.path) : undefined;
        const hunks = f.patch ? parsePatch(f.patch) : whole !== undefined ? addedHunks(whole) : [];
        const ff = role === "code" && f.status !== "removed" ? facts.get(f.path) : undefined;
        const found = ff ? parsedChanges(f.path, lang, ff, hunks, units, nameOf) : role === "code" ? changedSymbols(f.path, lang, heads.get(f.path) ?? null, hunks) : { symbols: [], loose: [] };
        // A loose run inside the lines a change card shows is already on that card.
        const loose = found.loose.filter((r) => !found.symbols.some((s) => pinFrom(s) <= r.from && r.to <= s.end));
        return {
            path: f.path,
            ...(f.previousPath ? { previousPath: f.previousPath } : {}),
            status: f.status,
            role,
            lang,
            additions: f.additions,
            deletions: f.deletions,
            hunks,
            hasPatch: f.patch !== undefined || whole !== undefined,
            symbols: found.symbols,
            loose,
            cases: role === "test" ? testCases(hunks) : [],
        };
    });
    const context: BoardContext = { files, heads, facts, refs: analysed.refs, units, nameOf };
    const draft = files.flatMap((f) => f.symbols).length >= 2 ? symbolBoard(context) : fileBoard(context);
    // Which cards a full board keeps depends on where tests hang, so links are found once on every card, then again on those kept.
    const limited = limit(place({ ...draft, links: linksOf(draft.pins, context) }), files);
    const board = place({ ...limited, links: linksOf(limited.pins, context) });
    const review: Review = { pr, files, ...board, order: [], unpinned: unpinnedOf(board, files) };
    const plan = planBoard(review);
    return { review: { ...review, order: plan.order }, plan };
};

/**
 * Only what the board and Read all need: a file with no card keeps its name,
 * role and counts, not its diff. The parser worker sends the driver this, and
 * the driver keeps it: Bun's 2,188-file rewrite would otherwise cross as
 * 84 MB, and be stored.
 */
export const compact = (review: Review): Review => {
    const carded = new Set(review.pins.map((p) => p.path));
    return { ...review, files: review.files.map((f) => (carded.has(f.path) ? f : { ...f, hunks: [], symbols: [], loose: [], cases: [] })) };
};

type Board = Pick<Review, "mode" | "pins" | "links" | "bands">;
type Draft = Omit<Board, "links">;

type BoardContext = {
    files: readonly ReviewFile[];
    heads: ReadonlyMap<string, readonly string[]>;
    facts: ReadonlyMap<string, Parsed>;
    refs: readonly Ref[];
    units: ReadonlyMap<string, Unit>;
    nameOf: (u: Unit) => string;
};

const prPin = (): Pin => ({ id: "pr", kind: "pr", name: "The PR", from: 0, to: 0, band: 0, lane: "flow", column: 0, status: "changed", add: 0, del: 0 });

/** Two units of one file, one inside the other. */
const nests = (a: Pick<Unit, "path" | "start" | "end">, b: Pick<Unit, "path" | "start" | "end">) => a.path === b.path && ((a.start <= b.start && b.end <= a.end) || (b.start <= a.start && a.end <= b.end));

/** The innermost of some units holding an offset of a file. */
const innermost = (units: readonly Unit[], path: string, offset: number): Unit | undefined =>
    sortBy(
        units.filter((u) => u.path === path && u.start <= offset && offset < u.end),
        (u) => u.end - u.start
    )[0];

const filePin = (f: ReviewFile, band: number, lane: Lane, column: number, ranges?: { from: number; to: number }[], name = fileName(f.path)): Pin => ({
    id: `file:${f.path}`,
    kind: "file",
    name,
    path: f.path,
    from: ranges ? Math.min(...ranges.map((r) => r.from)) : 1,
    to: ranges ? Math.max(...ranges.map((r) => r.to)) : Number.MAX_SAFE_INTEGER,
    band,
    lane,
    column,
    status: f.status === "added" ? "new" : "changed",
    add: ranges ? f.loose.reduce((n, l) => n + l.add, 0) : f.additions,
    del: ranges ? f.loose.reduce((n, l) => n + l.del, 0) : f.deletions,
    ...(ranges ? { ranges } : {}),
});

/** Every test file, in the bottom row until its links say which thread it covers. */
const testPins = (files: readonly ReviewFile[], restBand: number): Pin[] =>
    files
        .filter((f) => f.role === "test")
        .map((t) => ({ id: `test:${t.path}`, kind: "test", name: fileName(t.path), path: t.path, from: 1, to: Number.MAX_SAFE_INTEGER, band: restBand, lane: "rest", column: 0, status: t.status === "added" ? "new" : "changed", add: t.additions, del: t.deletions }));

const symbolBoard = (ctx: BoardContext): Draft => {
    const { files, heads, facts, refs, units, nameOf } = ctx;
    const symbols = files.flatMap((f) => f.symbols);
    // Parsed declarations first, as the linker's board orders them; the line patterns' after.
    const parsed = symbols.filter((s) => units.has(s.id));
    const patterned = symbols.filter((s) => !units.has(s.id));
    const ids = [...parsed, ...patterned].map((s) => s.id);
    const symbolOf = new Map(symbols.map((s) => [s.id, s]));
    const changedUnits = new Map<string, Unit[]>();
    for (const u of parsed.map((s) => units.get(s.id)!)) push(changedUnits, u.path, u);
    // A reference inside one changed unit to another, nesting aside; a class never starts an edge, since its range holds every unchanged method.
    const edgeSet = new Map<string, { from: string; to: string }>();
    for (const r of refs) {
        const src = innermost(changedUnits.get(r.path) ?? [], r.path, r.start);
        if (!src || src.kind === "class") continue;
        for (const target of r.units) {
            if (!units.has(target.id) || target.id === src.id || nests(src, target)) continue;
            edgeSet.set(`${src.id}>${target.id}`, { from: src.id, to: target.id });
        }
    }
    const edges = [...edgeSet.values()];
    const threads = threadsOf(ids, edges);
    const inThread = new Set(threads.flat());
    const pins: Pin[] = [prPin()];
    const bands: Band[] = [];
    const restBand = threads.length;
    const changePin = (s: ChangedSymbol, band: number, lane: Lane, column: number): Pin => {
        const from = pinFrom(s);
        return { id: s.id, kind: "change", name: s.label, path: s.path, symbol: s, from, to: s.end, band, lane, column, status: s.status, add: s.add, del: s.del, head: (heads.get(s.path) ?? []).slice(from - 1, s.end) };
    };
    const within = threadEdges(threads, edges);
    threads.forEach((members, b) => {
        const depth = layers(members, within[b]);
        for (const id of members) pins.push(changePin(symbolOf.get(id)!, b, "flow", depth.get(id)! + 1));
        bands.push({ entries: members.filter((id) => depth.get(id) === 0) });
    });
    for (const id of ids.filter((id) => !inThread.has(id))) pins.push(changePin(symbolOf.get(id)!, restBand, "rest", 0));

    // One unchanged caller per thread, of its first entry that has one: who the change affects.
    const contextPin = (id: string, path: string, name: string, from: number, to: number, band: number): Pin => ({
        id,
        kind: "context",
        name,
        path,
        from,
        to,
        band,
        lane: "flow",
        column: 0,
        status: "unchanged",
        add: 0,
        del: 0,
        head: (heads.get(path) ?? []).slice(from - 1, to),
    });
    const changedPaths = new Set(files.map((f) => f.path));
    const refsTo = new Map<string, Ref[]>();
    for (const r of refs) for (const u of r.units) push(refsTo, u.id, r);
    // The unchanged functions and methods of the parsed code, by path and line.
    const candidates = sortBy(
        [...facts.values()].filter((f) => roleOf(f.path) === "code").flatMap((f) => f.units.filter((u) => u.kind === "function" || u.kind === "method")),
        (u) => u.path,
        (u) => u.startLine
    ).filter((u) => !units.has(u.id));
    /** The candidates in the entry's own file first, then those in other changed files, then the rest. */
    const parsedCandidates = (near: string) => {
        const rank = (u: Unit) => (u.path === near ? 0 : changedPaths.has(u.path) ? 1 : 2);
        return [0, 1, 2].flatMap((r) => candidates.filter((u) => rank(u) === r));
    };
    const parsedCaller = (entry: Unit, band: number): Pin | null => {
        const sites = refsTo.get(entry.id) ?? [];
        if (sites.length === 0) return null;
        // The caller is the innermost unit around a reference, not a class around a changed method.
        const around = new Set(sites.map((s) => innermost(facts.get(s.path)?.units ?? [], s.path, s.start)));
        for (const u of parsedCandidates(entry.path)) {
            if (!around.has(u) || nests(u, entry) || (entry.name.startsWith("#") && u.path !== entry.path)) continue;
            if (isDeprecated(heads.get(u.path) ?? [], u.startLine, languageOf(u.path))) continue;
            return contextPin(`ctx:${u.id}`, u.path, nameOf(u), u.startLine, u.endLine, band);
        }
        return null;
    };
    // A caller of two threads' entries gets one card, with the first. Threads join parsed declarations only.
    const callerIds = new Set<string>();
    bands.forEach((band, b) => {
        for (const entry of band.entries) {
            const unit = units.get(entry);
            const caller = unit ? parsedCaller(unit, b) : null;
            if (!caller) continue;
            if (!callerIds.has(caller.id)) pins.push(caller);
            callerIds.add(caller.id);
            return;
        }
    });

    // File cards: changes outside every declaration, and files without readable code.
    for (const f of files) {
        if (f.role === "test") continue;
        const whole = f.role !== "code" || f.symbols.length === 0;
        if (!whole && f.loose.length === 0) continue;
        const ranges = whole ? undefined : f.loose.map((l) => ({ from: l.from, to: l.to }));
        const ff = facts.get(f.path);
        const inImports = ff ? importLines(ff.flat) : new Set<number>();
        const lines = whole ? [] : f.hunks.flatMap((h) => h.lines).filter((l) => l.t !== "ctx" && l.text.trim() !== "" && ranges!.some((r) => l.at >= r.from && l.at <= r.to));
        const imports = lines.length > 0 && lines.every((l) => inImports.has(l.n ?? l.at) || IMPORT_LINE.test(l.text));
        pins.push(filePin(f, restBand, "rest", 0, ranges, whole ? fileName(f.path) : imports ? `${fileName(f.path)} imports` : `${fileName(f.path)}, other lines`));
    }
    pins.push(...testPins(files, restBand));
    return { mode: "symbols", pins, bands };
};

/** Too few readable declarations: whole files, laid out as a flow by what they reference in each other. */
const fileBoard = (ctx: BoardContext): Draft => {
    const { files, refs } = ctx;
    const code = files.filter((f) => f.role === "code");
    const ids = code.map((f) => `file:${f.path}`);
    const codePaths = new Set(code.map((f) => f.path));
    const edgeSet = new Map<string, { from: string; to: string }>();
    for (const r of refs) {
        if (!codePaths.has(r.path)) continue;
        for (const u of r.units) if (u.path !== r.path && codePaths.has(u.path)) edgeSet.set(`${r.path}>${u.path}`, { from: `file:${r.path}`, to: `file:${u.path}` });
    }
    const edges = [...edgeSet.values()];
    const threads = threadsOf(ids, edges);
    const pins: Pin[] = [prPin()];
    const bands: Band[] = [];
    const fileOf = new Map<string, ReviewFile>();
    for (const f of files) if (!fileOf.has(`file:${f.path}`)) fileOf.set(`file:${f.path}`, f);
    const within = threadEdges(threads, edges);
    threads.forEach((members, b) => {
        const depth = layers(members, within[b]);
        for (const id of members) pins.push(filePin(fileOf.get(id)!, b, "flow", depth.get(id)! + 1));
        bands.push({ entries: members.filter((id) => depth.get(id) === 0) });
    });
    const placed = new Set(pins.map((p) => p.id));
    for (const f of files) if (f.role !== "test" && !placed.has(`file:${f.path}`)) pins.push(filePin(f, threads.length, "rest", 0));
    pins.push(...testPins(files, threads.length));
    return { mode: "files", pins, bands };
};

const link = (kind: LinkKind, from: string, to: string, rows: readonly number[], at: number | undefined, reads?: "calls" | "uses"): Link => ({
    id: `${kind}:${from}>${to}`,
    from,
    to,
    kind,
    ...(reads ? { reads } : {}),
    ...(at !== undefined ? { at } : {}),
    rows: [...rows],
});

/** Where a string starts: the first changed call row, else the first call row, else the first changed row, else the first. */
const startRow = (calls: readonly number[], rows: readonly number[], changed: ReadonlySet<number>): number | undefined =>
    calls.find((n) => changed.has(n)) ?? calls[0] ?? rows.find((n) => changed.has(n)) ?? rows[0];

/**
 * The links between the cards given: each resolved reference goes from the
 * innermost card holding it to the card standing for what it names: that
 * declaration's own card, a card it is nested in when it has none, or the
 * file card showing a file's changed lines. Two declaration cards that nest
 * make no link.
 */
const linksOf = (pins: readonly Pin[], ctx: BoardContext): Link[] => {
    const { files, facts, refs, units } = ctx;
    type Region = { pin: Pin; path: string; start: number; end: number };
    const regions: Region[] = [];
    const represented = new Map<string, string>();
    const pinIds = new Set(pins.map((p) => p.id));
    const changedUnits = new Map<string, Unit[]>();
    for (const u of units.values()) push(changedUnits, u.path, u);
    const offsetOfLine = (path: string, line: number, end = false) => {
        const t = facts.get(path)?.flat;
        if (!t) return 0;
        if (line > t.lineStarts.length) return t.text.length;
        return end ? (line < t.lineStarts.length ? t.lineStarts[line] : t.text.length) : t.lineStarts[Math.max(0, line - 1)];
    };
    const unitOfPin = new Map<Pin, Unit | undefined>();
    const unitOf = (p: Pin): Unit | undefined => {
        if (!unitOfPin.has(p)) unitOfPin.set(p, units.get(p.id) ?? (p.kind === "context" && p.path ? facts.get(p.path)?.units.find((u) => `ctx:${u.id}` === p.id) : undefined));
        return unitOfPin.get(p);
    };
    for (const p of pins) {
        const u = unitOf(p);
        if (!p.path || !u) continue;
        regions.push({ pin: p, path: p.path, start: u.start, end: u.end });
        represented.set(u.id, p.id);
        // Changed units nested in it without a card of their own.
        for (const x of changedUnits.get(u.path) ?? []) if (x !== u && u.start <= x.start && x.end <= u.end && !pinIds.has(x.id)) represented.set(x.id, p.id);
    }
    for (const p of pins) {
        if (!p.path || (p.kind !== "file" && p.kind !== "test")) continue;
        const t = facts.get(p.path)?.flat;
        if (!t) continue;
        if (p.kind === "test" || !p.ranges) {
            regions.push({ pin: p, path: p.path, start: 0, end: t.text.length });
            if (p.kind === "file") for (const x of changedUnits.get(p.path) ?? []) if (!represented.has(x.id)) represented.set(x.id, p.id);
            continue;
        }
        for (const r of p.ranges) regions.push({ pin: p, path: p.path, start: offsetOfLine(p.path, r.from), end: offsetOfLine(p.path, r.to, true) });
    }
    const regionsIn = new Map<string, Region[]>();
    const regionsOf = new Map<Pin, Region[]>();
    for (const r of regions) {
        push(regionsIn, r.path, r);
        push(regionsOf, r.pin, r);
    }
    const pinAt = (path: string, offset: number): Pin | null => {
        let best: Region | null = null;
        for (const r of regionsIn.get(path) ?? []) if (offset >= r.start && offset < r.end && (!best || r.end - r.start < best.end - best.start)) best = r;
        return best?.pin ?? null;
    };
    const holds = (a: Pin, b: Pin) => {
        const ra = regionsOf.get(a) ?? [];
        const rb = regionsOf.get(b) ?? [];
        return rb.length > 0 && rb.every((y) => ra.some((x) => x.path === y.path && x.start <= y.start && y.end <= x.end));
    };
    const isDecl = (p: Pin) => (p.kind === "change" || p.kind === "context") && unitOf(p) !== undefined;
    const pinById = new Map(pins.map((p) => [p.id, p]));
    const pairs = new Map<string, { from: Pin; to: Pin; refs: Ref[]; seen: Set<Ref> }>();
    for (const r of refs) {
        const from = pinAt(r.path, r.start);
        if (!from) continue;
        for (const u of r.units) {
            const to = pinById.get(represented.get(u.id) ?? "");
            if (!to || to === from) continue;
            if (isDecl(from) && isDecl(to) && (holds(from, to) || holds(to, from))) continue;
            const key = `${from.id}>${to.id}`;
            const pair = pairs.get(key) ?? { from, to, refs: [], seen: new Set<Ref>() };
            if (!pair.seen.has(r)) {
                pair.seen.add(r);
                pair.refs.push(r);
            }
            pairs.set(key, pair);
        }
    }
    // The head lines each file adds, read once per file a string starts in.
    const fileByPath = new Map(files.map((f) => [f.path, f]));
    const addedLines = new Map<string, Set<number>>();
    const changedIn = (path = ""): Set<number> => {
        let hit = addedLines.get(path);
        if (!hit) {
            const f = fileByPath.get(path);
            hit = new Set(f ? f.hunks.flatMap((h) => h.lines).filter((l) => l.t === "add").map((l) => l.n!) : []);
            addedLines.set(path, hit);
        }
        return hit;
    };
    const links = [...pairs.values()].map(({ from, to, refs: rs }) => {
        const calls = [...new Set(rs.filter((r) => r.ref === "call").map((r) => r.line))].sort((a, b) => a - b);
        const all = [...new Set(rs.map((r) => r.line))].sort((a, b) => a - b);
        const kind: LinkKind =
            from.kind === "test" ? "tests" : from.kind === "context" ? "context" : calls.length > 0 ? "calls" : rs.some((r) => r.ref !== "import" && r.ref !== "export") ? "uses" : "imports";
        const rows = kind === "calls" || (kind === "context" && calls.length > 0) ? calls : all;
        return link(kind, from.id, to.id, rows, startRow(calls, all, changedIn(from.path)), kind === "context" ? (calls.length > 0 ? "calls" : "uses") : undefined);
    });

    return links;
};

/**
 * Where tests and loose file cards hang, from the links: a test under the
 * first thread whose change cards it covers, a file card whose every link
 * goes into one thread under that thread, so their strings run straight up.
 * Everything else, the bottom row.
 */
const place = (board: Board): Board => {
    const restBand = board.bands.length;
    // The band of the first card in a flow with each id, and of the first change or file card.
    const flowBands = new Map<string, number>();
    const codeBands = new Map<string, number>();
    for (const p of board.pins) {
        if (p.lane !== "flow") continue;
        if (!flowBands.has(p.id)) flowBands.set(p.id, p.band);
        if ((p.kind === "change" || p.kind === "file") && !codeBands.has(p.id)) codeBands.set(p.id, p.band);
    }
    const linksFrom = new Map<string, Link[]>();
    for (const l of board.links) push(linksFrom, l.from, l);
    return {
        ...board,
        pins: board.pins.map((p) => {
            if (p.kind === "test") {
                const bands = (linksFrom.get(p.id) ?? []).filter((l) => l.kind === "tests").map((l) => codeBands.get(l.to)).filter((b): b is number => b !== undefined);
                return bands.length > 0 ? { ...p, lane: "under" as const, band: Math.min(...bands) } : { ...p, lane: "rest" as const, band: restBand };
            }
            if (p.kind !== "file" || p.lane === "flow") return p;
            const bands = new Set((linksFrom.get(p.id) ?? []).map((l) => flowBands.get(l.to)));
            const [band] = bands;
            return bands.size === 1 && band !== undefined ? { ...p, lane: "under" as const, band } : { ...p, lane: "rest" as const, band: restBand };
        }),
    };
};

/**
 * The first `LIMITS.cards` pins in the order they fill the board: the PR
 * card; each thread, largest first, with its context card and tests, its
 * cards nearest the entry first; then the bottom row, code before docs and
 * config before generated files, the largest changes first. The order runs
 * band by band, so the bands left are always the first ones.
 *
 * Cards nearest the entries share no string when a thread has more entries
 * than the board has room, so two more orders are tried: a part of each
 * thread, largest first, of at most `LIMITS.part` cards, grown from its
 * entries along what they link to; and such parts grown along calls alone,
 * the parts sharing the most calls first. The order whose cards share more
 * calls fills the board, then the one sharing more links: calls outrank
 * type uses, which can join a whole file's declarations into one thread.
 * On a tie, the first.
 */
const limit = (board: Board, files: readonly ReviewFile[]): Board => {
    const { pins, bands, links } = board;
    if (pins.length <= LIMITS.cards) return board;
    const index = new Map(pins.map((p, i) => [p.id, i]));
    const ranks = new Map(pins.filter((p) => p.lane === "rest").map((p) => [p.id, laneRank(p, files)]));
    const inBand = new Map<number, Pin[]>();
    for (const p of pins) push(inBand, p.band, p);
    const flow = (b: number) =>
        sortBy(
            (inBand.get(b) ?? []).filter((p) => p.lane === "flow" && p.kind !== "pr" && p.kind !== "context"),
            (p) => p.column,
            (p) => index.get(p.id)!
        );
    const tail = (b: number) => {
        const band = inBand.get(b) ?? [];
        return [...band.filter((p) => p.kind === "context"), ...band.filter((p) => p.lane === "under")];
    };
    const rest = sortBy(
        pins.filter((p) => p.lane === "rest"),
        (p) => ranks.get(p.id)![0],
        (p) => -(p.add + p.del),
        (p) => ranks.get(p.id)![1],
        (p) => ranks.get(p.id)![2]
    );
    const nearest = [pins[0], ...bands.flatMap((_, b) => [...flow(b), ...tail(b)]), ...rest];

    // The cards each card links to, the ones it calls, and the cards it shares a link with, either way.
    const linksTo = new Map<string, string[]>();
    const callsTo = new Map<string, string[]>();
    const linked = new Map<string, string[]>();
    for (const l of links) {
        push(linksTo, l.from, l.to);
        if (l.kind === "calls") push(callsTo, l.from, l.to);
        push(linked, l.from, l.to);
        push(linked, l.to, l.from);
    }
    const shared = (ids: ReadonlySet<string>, via: ReadonlyMap<string, string[]>) => [...ids].reduce((n, id) => n + (via.get(id) ?? []).filter((x) => ids.has(x)).length, 0);
    /** Adds an entry and what it links to, breadth first, the three that link most first, while `tree` holds fewer than `LIMITS.part`. */
    const grow = (entry: Pin, members: ReadonlySet<string>, tree: Set<string>, via: ReadonlyMap<string, string[]>) => {
        const queue = [entry.id];
        const seen = new Set<string>();
        while (queue.length > 0 && tree.size < LIMITS.part) {
            const id = queue.shift()!;
            if (seen.has(id)) continue;
            seen.add(id);
            tree.add(id);
            const next = (via.get(id) ?? []).filter((x) => members.has(x) && !seen.has(x));
            queue.push(...sortBy(next, (x) => -(via.get(x)?.length ?? 0), (x) => index.get(x)!).slice(0, 3));
        }
        return tree;
    };
    /** A part of a band grown from its entries along `via`, the entries whose own trees share the most first: the cards of its first column, or with `callers`, the cards no other calls. */
    const part = (b: number, via: ReadonlyMap<string, string[]>, callers = false): Pin[] => {
        const members = flow(b);
        if (members.length <= LIMITS.part) return [...members, ...tail(b)];
        const ids = new Set(members.map((p) => p.id));
        const first = Math.min(...members.map((p) => p.column));
        const called = new Set(members.flatMap((p) => via.get(p.id) ?? []));
        const firsts = members.filter((p) => (callers ? !called.has(p.id) : p.column === first));
        const own = new Map(firsts.map((e) => [e, shared(grow(e, ids, new Set(), via), via)]));
        const entries = sortBy(
            firsts,
            (e) => -own.get(e)!,
            (e) => index.get(e.id)!
        );
        const tree = new Set<string>();
        for (const e of entries) if (tree.size < LIMITS.part) grow(e, ids, tree, via);
        return [...members.filter((p) => tree.has(p.id)), ...tail(b).filter((p) => (linked.get(p.id) ?? []).some((x) => tree.has(x)))];
    };
    const grownAlong = (parts: Pin[][]) => {
        const inParts = new Set(parts.flat().map((p) => p.id));
        return [pins[0], ...parts.flat(), ...bands.flatMap((_, b) => [...flow(b), ...tail(b)].filter((p) => !inParts.has(p.id))), ...rest];
    };
    const callParts = bands.map((_, b) => part(b, callsTo, true));
    const callsIn = (ps: Pin[]) => shared(new Set(ps.map((p) => p.id)), callsTo);
    const grown = grownAlong(bands.map((_, b) => part(b, linksTo)));
    const grownByCalls = grownAlong(sortBy(callParts, (ps) => -callsIn(ps), (ps) => callParts.indexOf(ps)));

    const cut = (order: Pin[]) => new Set(order.slice(0, LIMITS.cards).map((p) => p.id));
    const score = (ids: ReadonlySet<string>) => [shared(ids, callsTo), shared(ids, linksTo)];
    let keep = cut(nearest);
    for (const order of [grown, grownByCalls]) {
        const ids = cut(order);
        const [calls, all] = score(ids);
        const [keptCalls, keptAll] = score(keep);
        if (calls > keptCalls || (calls === keptCalls && all > keptAll)) keep = ids;
    }
    const kept = bands.filter((_, b) => (inBand.get(b) ?? []).some((p) => p.lane === "flow" && p.kind !== "pr" && keep.has(p.id)));
    const bandOf = new Map(bands.map((b, i) => [b, i]));
    const renumber = new Map(kept.map((b, i) => [bandOf.get(b)!, i]));
    return {
        ...board,
        // The PR card heads the first band kept, whichever that is.
        pins: pins.filter((p) => keep.has(p.id)).map((p) => ({ ...p, band: p.kind === "pr" ? 0 : p.lane === "rest" ? kept.length : (renumber.get(p.band) ?? kept.length) })),
        bands: kept.map((b) => ({ entries: b.entries.filter((id) => keep.has(id)) })),
    };
};

/** What the card limit left off: declarations without a card, and files with no card whose declarations aren't counted already. */
const unpinnedOf = (board: Board, files: readonly ReviewFile[]): Review["unpinned"] => {
    const pinned = new Set(board.pins.map((p) => p.id));
    const lost = board.mode === "symbols" ? files.flatMap((f) => f.symbols).filter((s) => !pinned.has(s.id)) : [];
    const carded = new Set(board.pins.map((p) => p.path));
    const counted = new Set(lost.map((s) => s.path));
    return { functions: lost.length, files: files.filter((f) => !carded.has(f.path) && !counted.has(f.path)).length };
};
