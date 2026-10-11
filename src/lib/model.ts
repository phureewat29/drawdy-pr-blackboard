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
 * A link is a fact. In the files the parser reads, every link comes from a
 * reference the linker resolved (`linker.ts`): the innermost card holding
 * the reference, to the card standing for what it names. Other languages
 * keep the line patterns of `symbols.ts`, and draw only `calls` and
 * `imports`.
 */

import { parsePatch, type DiffLine, type Hunk } from "./diff.ts";
import type { FileFacts, Unit } from "./facts.ts";
import { sortBy, uniqBy } from "./fp.ts";
import type { FileStatus, PrFile, PrInfo } from "./github.ts";
import { layers } from "./graph.ts";
import { laneRank, planBoard } from "./layout.ts";
import { languageOf, roleOf, type FileRole, type Language } from "./language.ts";
import { builtinRule, resolveAll, type Ref } from "./linker.ts";
import { readSources, type Parse, type Read, type Sources } from "./sources.ts";
import {
    callEdges,
    callsTo,
    changedSymbols,
    findDecls,
    isComment,
    labelOf,
    looseRuns,
    testCases,
    type ChangedSymbol,
    type LooseChange,
    type TestCase,
} from "./symbols.ts";
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

/** What the read tier gave: every text read, the parsed files' facts, and the references that resolved. */
export type Analysed = { texts: ReadonlyMap<string, string>; facts: ReadonlyMap<string, FileFacts>; refs: readonly Ref[] };

const fileName = (path: string) => path.split("/").pop() ?? path;

/**
 * Reads what the board needs (`sources.ts`), resolves its references and
 * builds the review: the one path from a pull request's files to its board,
 * for the driver, the tests and the score gate alike.
 */
export const analyse = async (pr: PrInfo, files: readonly PrFile[], read: Read, parse: Parse): Promise<Review> => {
    const sources: Sources = await readSources(files, read, parse);
    const changed = new Set(files.filter((f) => f.status !== "removed").map((f) => f.path));
    const refs = resolveAll([...sources.facts.values()], changed, { paths: sources.paths, builtin: builtinRule(pr.ref, changed) });
    return buildReview(pr, files, { texts: sources.texts, facts: sources.facts, refs });
};

/** Python's relative imports between changed files, with the importing line: links between whole-file cards. */
const pythonImports = (files: readonly ReviewFile[], heads: ReadonlyMap<string, readonly string[]>): { from: string; to: string; at: number }[] => {
    const byStem = new Map(files.map((f) => [f.path.replace(/\.[^/.]+$/, ""), f.path]));
    const edges: { from: string; to: string; at: number }[] = [];
    for (const f of files.filter((x) => x.lang === "py")) {
        (heads.get(f.path) ?? []).forEach((line, i) => {
            const name = /^\s*from\s+\.(\w+)\s+import/.exec(line)?.[1];
            const target = name ? byStem.get(`${f.path.split("/").slice(0, -1).concat(name).join("/")}`) : undefined;
            if (target && target !== f.path && !edges.some((e) => e.from === f.path && e.to === target)) edges.push({ from: f.path, to: target, at: i + 1 });
        });
    }
    return edges;
};

/** Groups of ids joined by edges in either direction, each in the order given. */
const components = (ids: readonly string[], edges: readonly { from: string; to: string }[]): string[][] => {
    const known = new Set(ids);
    const adj = new Map<string, string[]>();
    for (const e of edges) {
        adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
        adj.set(e.to, [...(adj.get(e.to) ?? []), e.from]);
    }
    const seen = new Set<string>();
    const out: string[][] = [];
    for (const id of ids) {
        if (seen.has(id)) continue;
        const group = new Set([id]);
        const stack = [id];
        while (stack.length > 0) {
            for (const next of adj.get(stack.pop()!) ?? []) {
                if (group.has(next) || !known.has(next)) continue;
                group.add(next);
                stack.push(next);
            }
        }
        group.forEach((g) => seen.add(g));
        out.push(ids.filter((x) => group.has(x)));
    }
    return out;
};

/** Threads, largest first, then the bottom row: the order cards are pinned in. */
const threadsOf = (ids: readonly string[], edges: readonly { from: string; to: string }[]) =>
    sortBy(
        components(ids, edges).filter((g) => g.length >= 2),
        (g) => -g.length,
        (g) => ids.indexOf(g[0])
    );

const IMPORT_LINE = /^\s*(import\b|from\s+\S+\s+import\b|export\s.*\bfrom\b|use\s|#include|require\(|const\s.*=\s*require\()/;

/** The head lines inside a module's import statements: `import`, `export … from`, and a module-level `const x = require(…)`. */
const importLines = (t: Flat): Set<number> => {
    const lines = new Set<number>();
    for (let n = t.first[0]; n >= 0; n = t.next[n]) {
        const ty = t.type[n];
        const text = textOf(t, n);
        const isImport =
            ty === "import_statement" ||
            (ty === "export_statement" && /\bfrom\s*["']/.test(text) && !/^export\s+(default\s+)?(async\s+)?(function|class|const|let|var|interface|type|enum)\b/.test(text)) ||
            ((ty === "lexical_declaration" || ty === "variable_declaration") && /^\s*(const|let|var)\b[^=]*=\s*require\s*\(\s*["'][^"']+["']\s*\)\s*;?\s*$/.test(text));
        if (isImport) for (let l = lineOf(t, t.start[n]); l <= lineOf(t, Math.max(t.start[n], t.end[n] - 1)); l++) lines.add(l);
    }
    return lines;
};

/** Names a run of import lines adds: in its added lines, not in its deleted ones. */
const addedImports = (lines: readonly DiffLine[]): string[] => {
    const names = (t: "add" | "del") => lines.filter((l) => l.t === t).flatMap((l) => l.text.replace(/['"][^'"]*['"]/g, "").match(/[A-Za-z_$][\w$]*/g) ?? []);
    const removed = new Set(names("del"));
    const skip = new Set(["import", "from", "type", "export", "as", "require", "const", "let", "var", "use", "default"]);
    return uniqBy(names("add").filter((n) => !removed.has(n) && !skip.has(n)), (n) => n);
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
const parsedChanges = (path: string, lang: Language, ff: FileFacts, hunks: readonly Hunk[], units: Map<string, Unit>): { symbols: ChangedSymbol[]; loose: LooseChange[] } => {
    const text = ff.flat.text.split("\n");
    const changed = hunks.flatMap((h) => h.lines).filter((l) => l.t !== "ctx" && !(l.t === "add" && (text[l.at - 1] ?? "").trim() === ""));
    const owned = new Map<Unit, DiffLine[]>();
    const loose: DiffLine[] = [];
    for (const l of changed) {
        const owner = sortBy(
            ff.units.filter((u) => u.docLine <= l.at && l.at <= u.endLine),
            (u) => u.endLine - u.docLine
        )[0];
        if (owner) owned.set(owner, [...(owned.get(owner) ?? []), l]);
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
                label: labelOf(u),
                kind: u.kind,
                status: added.has(u.nameLine) ? "new" : "changed",
                start: u.startLine,
                end: u.endLine,
                from: Math.min(...ats),
                to: Math.max(...ats),
                add: ls.filter((l) => l.t === "add").length,
                del: ls.filter((l) => l.t === "del").length,
            },
        ];
    });
    return { symbols, loose: looseRuns(path, loose) };
};

/** A pin's first shown line: the declaration's first line, or its first change when that comes earlier. */
const pinFrom = (s: ChangedSymbol) => Math.min(s.from, s.start);

export const buildReview = (pr: PrInfo, prFiles: readonly PrFile[], analysed: Analysed): Review => {
    const { facts } = analysed;
    const heads = new Map([...analysed.texts].map(([path, text]) => [path, text.split("\n")]));
    /** The parsed unit behind each changed symbol of a parsed file. */
    const units = new Map<string, Unit>();
    const files: ReviewFile[] = prFiles.map((f) => {
        const role = roleOf(f.path);
        const lang = languageOf(f.path);
        const hunks = f.patch ? parsePatch(f.patch) : [];
        const ff = role === "code" && f.status !== "removed" ? facts.get(f.path) : undefined;
        const found = ff ? parsedChanges(f.path, lang, ff, hunks, units) : role === "code" ? changedSymbols(f.path, lang, heads.get(f.path) ?? null, hunks) : { symbols: [], loose: [] };
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
            hasPatch: f.patch !== undefined,
            symbols: found.symbols,
            loose,
            cases: role === "test" ? testCases(hunks) : [],
        };
    });
    const context: BoardContext = { files, heads, facts, refs: analysed.refs, units };
    const draft = files.flatMap((f) => f.symbols).length >= 2 ? symbolBoard(context) : fileBoard(context);
    // Which cards a full board keeps depends on where tests hang, so links are found once on every card, then again on those kept.
    const limited = limit(place({ ...draft, links: linksOf(draft.pins, context) }), files);
    const board = place({ ...limited, links: linksOf(limited.pins, context) });
    const review: Review = { pr, files, ...board, order: [], unpinned: unpinnedOf(board, files) };
    return { ...review, order: planBoard(review).order };
};

/** The cards Next and Previous walk, in board order: every one but unchanged context. */
export const stepsOf = (review: Pick<Review, "order" | "pins">): string[] => review.order.filter((id) => review.pins.find((p) => p.id === id)?.kind !== "context");

type Board = Pick<Review, "mode" | "pins" | "links" | "bands">;
type Draft = Omit<Board, "links">;

type BoardContext = {
    files: readonly ReviewFile[];
    heads: ReadonlyMap<string, readonly string[]>;
    facts: ReadonlyMap<string, FileFacts>;
    refs: readonly Ref[];
    units: ReadonlyMap<string, Unit>;
};

const prPin = (): Pin => ({ id: "pr", kind: "pr", name: "The pull request", from: 0, to: 0, band: 0, lane: "flow", column: 0, status: "changed", add: 0, del: 0 });

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
    const { files, heads, facts, refs, units } = ctx;
    const symbols = files.flatMap((f) => f.symbols);
    // Parsed declarations first, as the linker's board orders them; the line patterns' after.
    const parsed = symbols.filter((s) => units.has(s.id));
    const patterned = symbols.filter((s) => !units.has(s.id));
    const ids = [...parsed, ...patterned].map((s) => s.id);
    const symbolOf = new Map(symbols.map((s) => [s.id, s]));
    const changedUnits = parsed.map((s) => units.get(s.id)!);
    // A reference inside one changed unit to another, nesting aside; a class never starts an edge, since its range holds every unchanged method.
    const edgeSet = new Map<string, { from: string; to: string }>();
    for (const r of refs) {
        const src = innermost(changedUnits, r.path, r.start);
        if (!src || src.kind === "class") continue;
        for (const target of r.units) {
            if (!units.has(target.id) || target.id === src.id || nests(src, target)) continue;
            edgeSet.set(`${src.id}>${target.id}`, { from: src.id, to: target.id });
        }
    }
    const edges = [...edgeSet.values(), ...callEdges(patterned, heads)];
    const threads = threadsOf(ids, edges);
    const inThread = new Set(threads.flat());
    const pins: Pin[] = [prPin()];
    const bands: Band[] = [];
    const restBand = threads.length;
    const changePin = (s: ChangedSymbol, band: number, lane: Lane, column: number): Pin => {
        const from = pinFrom(s);
        return { id: s.id, kind: "change", name: s.label, path: s.path, symbol: s, from, to: s.end, band, lane, column, status: s.status, add: s.add, del: s.del, head: (heads.get(s.path) ?? []).slice(from - 1, s.end) };
    };
    threads.forEach((members, b) => {
        const depth = layers(members, edges.filter((e) => members.includes(e.from) && members.includes(e.to)).map((e) => [e.from, e.to] as const));
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
    for (const r of refs) for (const u of r.units) refsTo.set(u.id, [...(refsTo.get(u.id) ?? []), r]);
    const parsedCandidates = (near: string) =>
        sortBy(
            [...facts.values()].filter((f) => roleOf(f.path) === "code").flatMap((f) => f.units.filter((u) => u.kind === "function" || u.kind === "method").map((u) => ({ f, u }))),
            ({ u }) => (u.path === near ? 0 : changedPaths.has(u.path) ? 1 : 2),
            ({ u }) => u.path,
            ({ u }) => u.startLine
        ).filter(({ u }) => !units.has(u.id));
    const parsedCaller = (entry: Unit, band: number): Pin | null => {
        const sites = refsTo.get(entry.id) ?? [];
        if (sites.length === 0) return null;
        for (const { f, u } of parsedCandidates(entry.path)) {
            if (nests(u, entry) || (entry.name.startsWith("#") && u.path !== entry.path)) continue;
            if (isDeprecated(heads.get(u.path) ?? [], u.startLine, languageOf(u.path))) continue;
            // The caller is the innermost unit around the reference, not a class around a changed method.
            if (sites.some((s) => s.path === u.path && s.start >= u.start && s.start < u.end && innermost(f.units, s.path, s.start) === u)) return contextPin(`ctx:${u.id}`, u.path, labelOf(u), u.startLine, u.endLine, band);
        }
        return null;
    };
    const unparsed = [...heads.keys()].filter((path) => !facts.has(path));
    const pinnedAt = new Set(symbols.map((s) => `${s.path}:${s.start}`));
    // Unchanged functions of the files read without the parser, by path, in line order.
    const callers = new Map(
        sortBy(unparsed, (path) => path).map((path) => [
            path,
            findDecls(heads.get(path)!, languageOf(path)).filter((d) => (d.kind === "function" || d.kind === "method") && !pinnedAt.has(`${path}:${d.start}`)),
        ])
    );
    const patternedCaller = (e: ChangedSymbol, band: number): Pin | null => {
        // Its own file first; a Rust call is proved only inside its file.
        const paths = [e.path, ...(e.lang === "rs" || e.name.startsWith("#") ? [] : [...callers.keys()].filter((path) => path !== e.path))];
        for (const path of paths) {
            for (const d of callers.get(path) ?? []) {
                if (path === e.path && ((d.start <= e.start && e.end <= d.end) || (e.start <= d.start && d.end <= e.end))) continue;
                const lines = heads.get(path)!;
                if (isDeprecated(lines, d.start, languageOf(path))) continue;
                if (callsTo(path, lines, languageOf(path), d, e).length > 0) return contextPin(`ctx:${path}:${d.start}`, path, labelOf(d), d.start, d.end, band);
            }
        }
        return null;
    };
    bands.forEach((band, b) => {
        for (const entry of band.entries) {
            const unit = units.get(entry);
            const caller = unit ? parsedCaller(unit, b) : patternedCaller(symbolOf.get(entry)!, b);
            if (!caller) continue;
            if (!pins.some((p) => p.id === caller.id)) pins.push(caller);
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
    const { files, refs, heads } = ctx;
    const code = files.filter((f) => f.role === "code");
    const ids = code.map((f) => `file:${f.path}`);
    const codePaths = new Set(code.map((f) => f.path));
    const edgeSet = new Map<string, { from: string; to: string }>();
    for (const r of refs) {
        if (!codePaths.has(r.path)) continue;
        for (const u of r.units) if (u.path !== r.path && codePaths.has(u.path)) edgeSet.set(`${r.path}>${u.path}`, { from: `file:${r.path}`, to: `file:${u.path}` });
    }
    const edges = [...edgeSet.values(), ...pythonImports(code, heads).map((e) => ({ from: `file:${e.from}`, to: `file:${e.to}` }))];
    const threads = threadsOf(ids, edges);
    const pins: Pin[] = [prPin()];
    const bands: Band[] = [];
    threads.forEach((members, b) => {
        const depth = layers(members, edges.filter((e) => members.includes(e.from) && members.includes(e.to)).map((e) => [e.from, e.to] as const));
        for (const id of members) pins.push(filePin(files.find((f) => `file:${f.path}` === id)!, b, "flow", depth.get(id)! + 1));
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
 * The links between the cards given. In parsed files each resolved reference
 * goes from the innermost card holding it to the card standing for what it
 * names: that declaration's own card, a card it is nested in when it has
 * none, or the file card showing a file's changed lines. Two declaration
 * cards that nest make no link. Other languages add their calls and import
 * lines, by name.
 */
const linksOf = (pins: readonly Pin[], ctx: BoardContext): Link[] => {
    const { files, facts, refs, units, heads } = ctx;
    type Region = { pin: Pin; path: string; start: number; end: number };
    const regions: Region[] = [];
    const represented = new Map<string, string>();
    const changedUnits = [...units.values()];
    const offsetOfLine = (path: string, line: number, end = false) => {
        const t = facts.get(path)?.flat;
        if (!t) return 0;
        if (line > t.lineStarts.length) return t.text.length;
        return end ? (line < t.lineStarts.length ? t.lineStarts[line] : t.text.length) : t.lineStarts[Math.max(0, line - 1)];
    };
    const unitOf = (p: Pin): Unit | undefined => units.get(p.id) ?? (p.kind === "context" && p.path ? facts.get(p.path)?.units.find((u) => `ctx:${u.id}` === p.id) : undefined);
    for (const p of pins) {
        const u = unitOf(p);
        if (!p.path || !u) continue;
        regions.push({ pin: p, path: p.path, start: u.start, end: u.end });
        represented.set(u.id, p.id);
        // Changed units nested in it without a card of their own.
        for (const x of changedUnits) if (x !== u && x.path === u.path && u.start <= x.start && x.end <= u.end && !pins.some((k) => k.id === x.id)) represented.set(x.id, p.id);
    }
    for (const p of pins) {
        if (!p.path || (p.kind !== "file" && p.kind !== "test")) continue;
        const t = facts.get(p.path)?.flat;
        if (!t) continue;
        if (p.kind === "test" || !p.ranges) {
            regions.push({ pin: p, path: p.path, start: 0, end: t.text.length });
            if (p.kind === "file") for (const x of changedUnits) if (x.path === p.path && !represented.has(x.id)) represented.set(x.id, p.id);
            continue;
        }
        for (const r of p.ranges) regions.push({ pin: p, path: p.path, start: offsetOfLine(p.path, r.from), end: offsetOfLine(p.path, r.to, true) });
    }
    const pinAt = (path: string, offset: number): Pin | null => {
        let best: Region | null = null;
        for (const r of regions) if (r.path === path && offset >= r.start && offset < r.end && (!best || r.end - r.start < best.end - best.start)) best = r;
        return best?.pin ?? null;
    };
    const holds = (a: Pin, b: Pin) => {
        const ra = regions.filter((r) => r.pin === a);
        const rb = regions.filter((r) => r.pin === b);
        return rb.length > 0 && rb.every((y) => ra.some((x) => x.path === y.path && x.start <= y.start && y.end <= x.end));
    };
    const isDecl = (p: Pin) => (p.kind === "change" || p.kind === "context") && unitOf(p) !== undefined;
    const pinById = new Map(pins.map((p) => [p.id, p]));
    const pairs = new Map<string, { from: Pin; to: Pin; refs: Ref[] }>();
    for (const r of refs) {
        const from = pinAt(r.path, r.start);
        if (!from) continue;
        for (const u of r.units) {
            const to = pinById.get(represented.get(u.id) ?? "");
            if (!to || to === from) continue;
            if (isDecl(from) && isDecl(to) && (holds(from, to) || holds(to, from))) continue;
            const key = `${from.id}>${to.id}`;
            const pair = pairs.get(key) ?? { from, to, refs: [] };
            if (!pair.refs.includes(r)) pair.refs.push(r);
            pairs.set(key, pair);
        }
    }
    const changedIn = new Map(files.map((f) => [f.path, new Set(f.hunks.flatMap((h) => h.lines).filter((l) => l.t === "add").map((l) => l.n!))]));
    const links = [...pairs.values()].map(({ from, to, refs: rs }) => {
        const calls = [...new Set(rs.filter((r) => r.ref === "call").map((r) => r.line))].sort((a, b) => a - b);
        const all = [...new Set(rs.map((r) => r.line))].sort((a, b) => a - b);
        const kind: LinkKind =
            from.kind === "test" ? "tests" : from.kind === "context" ? "context" : calls.length > 0 ? "calls" : rs.some((r) => r.ref !== "import" && r.ref !== "export") ? "uses" : "imports";
        const rows = kind === "calls" || (kind === "context" && calls.length > 0) ? calls : all;
        return link(kind, from.id, to.id, rows, startRow(calls, all, changedIn.get(from.path ?? "") ?? new Set()), kind === "context" ? (calls.length > 0 ? "calls" : "uses") : undefined);
    });

    // Other languages, by name: calls between changed declarations, an unchanged caller's calls, and import lines.
    const patterned = pins.filter((p) => p.kind === "change" && p.symbol && !units.has(p.id)).map((p) => p.symbol!);
    for (const e of callEdges(patterned, heads)) links.push(link("calls", e.from, e.to, e.calls, startRow(e.calls, e.calls, changedIn.get(pinById.get(e.from)?.path ?? "") ?? new Set())));
    for (const c of pins.filter((p) => p.kind === "context" && !unitOf(p))) {
        const lines = heads.get(c.path!) ?? [];
        for (const s of patterned.filter((x) => x.id !== c.id && pins.some((p) => p.id === x.id && p.lane === "flow" && p.band === c.band))) {
            const calls = callsTo(c.path!, lines, languageOf(c.path!), { start: c.from, end: c.to, kind: "function" }, s);
            if (calls.length > 0) links.push(link("context", c.id, s.id, calls, calls[0], "calls"));
        }
    }
    const symbols = pins.filter((p) => p.kind === "change" && p.symbol).map((p) => p.symbol!);
    // Rust's `use` lines name items through module paths; a name alone proves nothing there.
    for (const p of pins.filter((x) => x.kind === "file" && x.ranges && x.name.endsWith(" imports") && !facts.has(x.path!) && languageOf(x.path!) !== "rs")) {
        const f = files.find((x) => x.path === p.path)!;
        const lines = f.hunks.flatMap((h) => h.lines).filter((l) => l.t !== "ctx" && p.ranges!.some((r) => l.at >= r.from && l.at <= r.to));
        const names = new Set(addedImports(lines));
        for (const s of symbols) {
            if (s.path === p.path || s.name.startsWith("#") || !names.has(s.name)) continue;
            const row = lines.find((l) => l.t === "add" && new RegExp(`\\b${s.name.replace(/\$/g, "\\$")}\\b`).test(l.text))?.n;
            links.push(link("imports", p.id, s.id, row ? [row] : [], row));
        }
    }
    const fileIds = new Set(pins.filter((p) => p.kind === "file").map((p) => p.id));
    for (const e of pythonImports(files.filter((f) => f.role === "code"), heads)) {
        const from = `file:${e.from}`;
        const to = `file:${e.to}`;
        if (fileIds.has(from) && fileIds.has(to) && pinById.get(from)!.lane === "flow") links.push(link("imports", from, to, [e.at], e.at));
    }
    return uniqBy(links, (l) => `${l.from}>${l.to}`);
};

/**
 * Where tests and loose file cards hang, from the links: a test under the
 * first thread whose change cards it covers, a file card whose every link
 * goes into one thread under that thread, so their strings run straight up.
 * Everything else, the bottom row.
 */
const place = (board: Board): Board => {
    const restBand = board.bands.length;
    const flowBand = (id: string) => board.pins.find((p) => p.id === id && p.lane === "flow" && (p.kind === "change" || p.kind === "file"))?.band;
    return {
        ...board,
        pins: board.pins.map((p) => {
            if (p.kind === "test") {
                const bands = board.links.filter((l) => l.from === p.id && l.kind === "tests").map((l) => flowBand(l.to)).filter((b): b is number => b !== undefined);
                return bands.length > 0 ? { ...p, lane: "under" as const, band: Math.min(...bands) } : { ...p, lane: "rest" as const, band: restBand };
            }
            if (p.kind !== "file" || p.lane === "flow") return p;
            const bands = new Set(board.links.filter((l) => l.from === p.id).map((l) => board.pins.find((x) => x.id === l.to && x.lane === "flow")?.band));
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
 * than the board has room, so a second order is tried: a part of each
 * thread, largest first, of at most `LIMITS.part` cards, grown from its
 * entries along what they call; then the rest of each thread, then the
 * bottom row. The order whose cards share more links fills the board; on
 * a tie, the first.
 */
const limit = (board: Board, files: readonly ReviewFile[]): Board => {
    const { pins, bands, links } = board;
    if (pins.length <= LIMITS.cards) return board;
    const index = new Map(pins.map((p, i) => [p.id, i]));
    const ranks = new Map(pins.filter((p) => p.lane === "rest").map((p) => [p.id, laneRank(p, files)]));
    const flow = (b: number) =>
        sortBy(
            pins.filter((p) => p.band === b && p.lane === "flow" && p.kind !== "pr" && p.kind !== "context"),
            (p) => p.column,
            (p) => index.get(p.id)!
        );
    const tail = (b: number) => [...pins.filter((p) => p.band === b && p.kind === "context"), ...pins.filter((p) => p.band === b && p.lane === "under")];
    const rest = sortBy(
        pins.filter((p) => p.lane === "rest"),
        (p) => ranks.get(p.id)![0],
        (p) => -(p.add + p.del),
        (p) => ranks.get(p.id)![1],
        (p) => ranks.get(p.id)![2]
    );
    const nearest = [pins[0], ...bands.flatMap((_, b) => [...flow(b), ...tail(b)]), ...rest];

    const calls = new Map<string, string[]>();
    for (const l of links) calls.set(l.from, [...(calls.get(l.from) ?? []), l.to]);
    const shared = (ids: ReadonlySet<string>) => [...ids].reduce((n, id) => n + (calls.get(id) ?? []).filter((x) => ids.has(x)).length, 0);
    /** Adds an entry and what it calls, breadth first, the three callees that call most first, while `tree` holds fewer than `LIMITS.part`. */
    const grow = (entry: Pin, members: ReadonlySet<string>, tree: Set<string>) => {
        const queue = [entry.id];
        const seen = new Set<string>();
        while (queue.length > 0 && tree.size < LIMITS.part) {
            const id = queue.shift()!;
            if (seen.has(id)) continue;
            seen.add(id);
            tree.add(id);
            const next = (calls.get(id) ?? []).filter((x) => members.has(x) && !seen.has(x));
            queue.push(...sortBy(next, (x) => -(calls.get(x)?.length ?? 0), (x) => index.get(x)!).slice(0, 3));
        }
        return tree;
    };
    const part = (b: number): Pin[] => {
        const members = flow(b);
        if (members.length <= LIMITS.part) return [...members, ...tail(b)];
        const ids = new Set(members.map((p) => p.id));
        const first = Math.min(...members.map((p) => p.column));
        // The entries whose own trees share the most links first.
        const entries = sortBy(
            members.filter((p) => p.column === first),
            (e) => -shared(grow(e, ids, new Set())),
            (e) => index.get(e.id)!
        );
        const tree = new Set<string>();
        for (const e of entries) if (tree.size < LIMITS.part) grow(e, ids, tree);
        const linked = tail(b).filter((p) => links.some((l) => (l.from === p.id && tree.has(l.to)) || (l.to === p.id && tree.has(l.from))));
        return [...members.filter((p) => tree.has(p.id)), ...linked];
    };
    const parts = bands.map((_, b) => part(b));
    const inParts = new Set(parts.flat().map((p) => p.id));
    const grown = [pins[0], ...parts.flat(), ...bands.flatMap((_, b) => [...flow(b), ...tail(b)].filter((p) => !inParts.has(p.id))), ...rest];

    const cut = (order: Pin[]) => new Set(order.slice(0, LIMITS.cards).map((p) => p.id));
    const byNearest = cut(nearest);
    const byParts = cut(grown);
    const keep = shared(byParts) > shared(byNearest) ? byParts : byNearest;
    const kept = bands.filter((_, b) => pins.some((p) => p.band === b && p.lane === "flow" && p.kind !== "pr" && keep.has(p.id)));
    const bandOf = new Map(bands.map((b, i) => [b, i]));
    const renumber = new Map(kept.map((b, i) => [bandOf.get(b)!, i]));
    return {
        ...board,
        pins: pins.filter((p) => keep.has(p.id)).map((p) => ({ ...p, band: p.lane === "rest" ? kept.length : (renumber.get(p.band) ?? kept.length) })),
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
