/**
 * The cards a board drafts before the card limit. With enough readable
 * declarations, a card per changed declaration, threads of them as bands, one
 * unchanged caller per thread, file cards for the changes outside every
 * declaration, and the test files; with too few, a card per file.
 */

import { allLines } from "../diff.ts";
import { groupBy, minBy, partition, sortBy, sumBy } from "../fp.ts";
import { languageOf, roleOf, type Language } from "../language.ts";
import type { Facts, Ref, Unit } from "../langs/pack.ts";
import { linkerOf } from "../linking.ts";
import type { Band, Lane, Pin, Review, ReviewFile } from "../model.ts";
import { isComment, type ChangedSymbol } from "../symbols.ts";
import { lineOf } from "../syntax.ts";
import { pinFrom } from "./changes.ts";
import { layThreads, type Edge } from "./threads.ts";

/** What drafting a board and finding its links read. */
export type BoardContext = {
    files: readonly ReviewFile[];
    heads: ReadonlyMap<string, readonly string[]>;
    facts: ReadonlyMap<string, Facts>;
    refs: readonly Ref[];
    /** The parsed unit behind each changed declaration of a parsed file, by its id. */
    units: ReadonlyMap<string, Unit>;
    nameOf: (u: Unit) => string;
};

export type Draft = Pick<Review, "mode" | "pins" | "bands">;

const fileName = (path: string) => path.split("/").pop() ?? path;

/** Two units of one file, one inside the other. */
const nests = (a: Pick<Unit, "path" | "start" | "end">, b: Pick<Unit, "path" | "start" | "end">) => a.path === b.path && ((a.start <= b.start && b.end <= a.end) || (b.start <= a.start && a.end <= b.end));

/** The innermost of some units holding an offset of a file. */
const innermost = (units: readonly Unit[], path: string, offset: number): Unit | undefined =>
    minBy(
        units.filter((u) => u.path === path && u.start <= offset && offset < u.end),
        (u) => u.end - u.start
    );

const prPin = (): Pin => ({ id: "pr", kind: "pr", name: "The PR", from: 0, to: 0, band: 0, lane: "flow", column: 0, status: "changed", add: 0, del: 0 });

/** A file's card: the whole file, or with `ranges`, only the changes in those head lines. */
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
    add: ranges ? sumBy(f.loose, (l) => l.add) : f.additions,
    del: ranges ? sumBy(f.loose, (l) => l.del) : f.deletions,
    ...(ranges ? { ranges } : {}),
});

/** Every test file, in the bottom row until its links say which thread it covers. */
const testPins = (files: readonly ReviewFile[], restBand: number): Pin[] =>
    files
        .filter((f) => f.role === "test")
        .map((t) => ({ id: `test:${t.path}`, kind: "test", name: fileName(t.path), path: t.path, from: 1, to: Number.MAX_SAFE_INTEGER, band: restBand, lane: "rest", column: 0, status: t.status === "added" ? "new" : "changed", add: t.additions, del: t.deletions }));

/** The edges between changed units: a reference inside one to another, nesting aside. A class never starts one, since its range holds every unchanged method. */
const unitEdges = (parsed: readonly ChangedSymbol[], ctx: BoardContext): Edge[] => {
    const { refs, units } = ctx;
    const changedUnits = groupBy(
        parsed.map((s) => units.get(s.id)!),
        (u) => u.path
    );
    const edges = new Map<string, Edge>();
    for (const r of refs) {
        const src = innermost(changedUnits[r.path] ?? [], r.path, r.start);
        if (!src || src.kind === "class") continue;
        for (const named of r.units) {
            const target = !units.has(named.id) && r.alt ? r.alt : named;
            if (!units.has(target.id) || target.id === src.id || nests(src, target)) continue;
            edges.set(`${src.id}>${target.id}`, { from: src.id, to: target.id });
        }
    }
    return [...edges.values()];
};

/** Too few readable declarations: whole files, laid out as a flow by what they reference in each other. */
export const fileBoard = ({ files, refs }: BoardContext): Draft => {
    const code = files.filter((f) => f.role === "code");
    const codePaths = new Set(code.map((f) => f.path));
    const edges = new Map<string, Edge>();
    for (const r of refs) {
        if (!codePaths.has(r.path)) continue;
        for (const u of r.units) if (u.path !== r.path && codePaths.has(u.path)) edges.set(`${r.path}>${u.path}`, { from: `file:${r.path}`, to: `file:${u.path}` });
    }
    const fileOf = new Map<string, ReviewFile>();
    for (const f of files) if (!fileOf.has(`file:${f.path}`)) fileOf.set(`file:${f.path}`, f);
    const flow = layThreads(
        code.map((f) => `file:${f.path}`),
        [...edges.values()],
        (id, band, column) => filePin(fileOf.get(id)!, band, "flow", column)
    );
    const restBand = flow.bands.length;
    const inFlow = new Set(flow.pins.map((p) => p.id));
    const rest = files.filter((f) => f.role !== "test" && !inFlow.has(`file:${f.path}`)).map((f) => filePin(f, restBand, "rest", 0));
    return { mode: "files", pins: [prPin(), ...flow.pins, ...rest, ...testPins(files, restBand)], bands: flow.bands };
};

/** Enough readable declarations: a card each, those joined by links in threads. */
export const symbolBoard = (ctx: BoardContext): Draft => {
    const { files, heads, units } = ctx;
    const symbols = files.flatMap((f) => f.symbols);
    // Parsed declarations first, as the linker's board orders them; the line patterns' after.
    const [parsed, patterned] = partition(symbols, (s) => units.has(s.id));
    const ids = [...parsed, ...patterned].map((s) => s.id);
    const symbolOf = new Map(symbols.map((s) => [s.id, s]));
    const changePin = (id: string, band: number, lane: Lane, column: number): Pin => {
        const s = symbolOf.get(id)!;
        const from = pinFrom(s);
        return { id: s.id, kind: "change", name: s.label, path: s.path, symbol: s, from, to: s.end, band, lane, column, status: s.status, add: s.add, del: s.del, head: (heads.get(s.path) ?? []).slice(from - 1, s.end) };
    };
    const flow = layThreads(ids, unitEdges(parsed, ctx), (id, band, column) => changePin(id, band, "flow", column));
    const restBand = flow.bands.length;
    const inFlow = new Set(flow.pins.map((p) => p.id));
    const rest = ids.filter((id) => !inFlow.has(id)).map((id) => changePin(id, restBand, "rest", 0));
    return { mode: "symbols", pins: [prPin(), ...flow.pins, ...rest, ...contextCallers(flow.bands, ctx), ...fileCards(ctx, restBand), ...testPins(files, restBand)], bands: flow.bands };
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
 * One unchanged caller per thread, of its first entry that has one: who the
 * change affects. A caller of two threads' entries gets one card, with the
 * first. Threads join parsed declarations only.
 */
const contextCallers = (bands: readonly Band[], ctx: BoardContext): Pin[] => {
    const { files, heads, facts, refs, units, nameOf } = ctx;
    const changedPaths = new Set(files.map((f) => f.path));
    const refsTo = groupBy(
        refs.flatMap((r) => r.units.map((u) => ({ id: u.id, r }))),
        (x) => x.id
    );
    // The unchanged functions and methods of the parsed code, by path and line.
    const candidates = sortBy(
        [...facts.values()].filter((f) => roleOf(f.path) === "code").flatMap((f) => f.units.filter((u) => u.kind === "function" || u.kind === "method")),
        (u) => u.path,
        (u) => u.startLine
    ).filter((u) => !units.has(u.id));
    const callerOf = (entry: Unit, band: number): Pin | null => {
        const sites = (refsTo[entry.id] ?? []).map((x) => x.r);
        if (sites.length === 0) return null;
        // The caller is the innermost unit around a reference, not a class around a changed method.
        const around = new Set(sites.map((s) => innermost(facts.get(s.path)?.units ?? [], s.path, s.start)));
        // The entry's own file first, then the other changed files, then the rest. A private name (`#x`) is reached from its own file only.
        const near = sortBy(candidates, (u) => (u.path === entry.path ? 0 : changedPaths.has(u.path) ? 1 : 2));
        const u = near.find((u) => around.has(u) && !nests(u, entry) && !(entry.name.startsWith("#") && u.path !== entry.path) && !isDeprecated(heads.get(u.path) ?? [], u.startLine, languageOf(u.path)));
        if (!u) return null;
        return { id: `ctx:${u.id}`, kind: "context", name: nameOf(u), path: u.path, from: u.startLine, to: u.endLine, band, lane: "flow", column: 0, status: "unchanged", add: 0, del: 0, head: (heads.get(u.path) ?? []).slice(u.startLine - 1, u.endLine) };
    };
    const pins: Pin[] = [];
    bands.forEach((band, b) => {
        for (const entry of band.entries) {
            const unit = units.get(entry);
            const caller = unit ? callerOf(unit, b) : null;
            if (!caller) continue;
            if (!pins.some((p) => p.id === caller.id)) pins.push(caller);
            return;
        }
    });
    return pins;
};

/** A line that looks like an import in the common languages, for a file no parser reads, whatever its language. */
const IMPORT_LINE = /^\s*(import\b|from\s+\S+\s+import\b|export\s.*\bfrom\b|use\s|#include|require\(|const\s.*=\s*require\()/;

/** The head lines inside a parsed module's import statements, as its linker tells them (`Linker.isImport`). */
const importLines = (f: Facts): Set<number> => {
    const t = f.flat;
    const isImport = linkerOf(f.path)?.isImport;
    const lines = new Set<number>();
    for (let n = t.first[0]; n >= 0; n = t.next[n]) if (isImport?.(t, n)) for (let l = lineOf(t, t.start[n]); l <= lineOf(t, Math.max(t.start[n], t.end[n] - 1)); l++) lines.add(l);
    return lines;
};

/** Whether a file card's changed lines all import: inside a parsed module's import statements, or by the line's own look. */
const onlyImports = (f: ReviewFile, ranges: readonly { from: number; to: number }[], parsed?: Facts): boolean => {
    const inImports = parsed ? importLines(parsed) : new Set<number>();
    const lines = allLines(f.hunks).filter((l) => l.t !== "ctx" && l.text.trim() !== "" && ranges.some((r) => l.at >= r.from && l.at <= r.to));
    return lines.length > 0 && lines.every((l) => inImports.has(l.n ?? l.at) || IMPORT_LINE.test(l.text));
};

/** File cards for a symbol board: a file without readable code whole, and another's changes outside every declaration. */
const fileCards = ({ files, facts }: BoardContext, band: number): Pin[] =>
    files.flatMap((f): Pin[] => {
        if (f.role === "test") return [];
        if (f.role !== "code" || f.symbols.length === 0) return [filePin(f, band, "rest", 0)];
        if (f.loose.length === 0) return [];
        const ranges = f.loose.map((l) => ({ from: l.from, to: l.to }));
        return [filePin(f, band, "rest", 0, ranges, `${fileName(f.path)}${onlyImports(f, ranges, facts.get(f.path)) ? " imports" : ", other lines"}`)];
    });
