/** Diff lines as highlighted rows, each edit's changed words marked. */

import { allLines, type DiffLine } from "../diff.ts";
import { groupBy } from "../fp.ts";
import { highlightLine, type HighlightState } from "../highlight.ts";
import type { Pin, ReviewFile } from "../model.ts";
import { expandTabs, type Row } from "./grid.ts";

type Span = { start: number; endA: number; endB: number };

/** Where a changed line differs from the line it replaced, between their common start and end; null when they share too little for a mark to help. */
export const changedSpan = (a: string, b: string): Span | null => {
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA--;
        endB--;
    }
    // Shared indentation says nothing about whether two lines are the same line edited.
    const indent = Math.min(/^\s*/.exec(a)![0].length, /^\s*/.exec(b)![0].length, start);
    const shared = start - indent + (a.length - endA);
    if (shared < 4 || shared < (Math.max(a.length, b.length) - indent) * 0.3) return null;
    return { start, endA, endB };
};

/** Past this many added lines in one run, pairing costs more than the marks help. */
const MAX_PAIRED = 40;

/**
 * Which added line each deleted line became: the most alike one, keeping
 * their order, so an edit lines up with its old version even when lines
 * were inserted around it. Null for a deleted line that matches none.
 */
const pairLines = (dels: readonly string[], adds: readonly string[]): ({ add: number; span: Span } | null)[] => {
    let from = 0;
    return dels.map((a) => {
        if (adds.length > MAX_PAIRED) return null;
        let best: { add: number; span: Span; score: number } | null = null;
        for (let at = from; at < adds.length; at++) {
            const span = changedSpan(a, adds[at]);
            const score = span ? span.start + (a.length - span.endA) : -1;
            if (span && (!best || score > best.score)) best = { add: at, span, score };
        }
        if (!best) return null;
        from = best.add + 1;
        return { add: best.add, span: best.span };
    });
};

/** Runs of deleted lines followed by added lines, as index ranges. */
const changeRuns = (lines: readonly DiffLine[]): { dels: number[]; adds: number[] }[] => {
    const runs: { dels: number[]; adds: number[] }[] = [];
    for (let i = 0; i < lines.length; ) {
        if (lines[i].t !== "del") {
            i++;
            continue;
        }
        const dels: number[] = [];
        const adds: number[] = [];
        while (i < lines.length && lines[i].t === "del") dels.push(i++);
        while (i < lines.length && lines[i].t === "add") adds.push(i++);
        runs.push({ dels, adds });
    }
    return runs;
};

/** Each edited line's changed stretch, `[from, to)`, by line. */
export const changedStretches = (lines: readonly DiffLine[]): Map<DiffLine, [number, number]> => {
    const marks = new Map<DiffLine, [number, number]>();
    for (const run of changeRuns(lines)) {
        const pairs = pairLines(
            run.dels.map((i) => expandTabs(lines[i].text)),
            run.adds.map((i) => expandTabs(lines[i].text))
        );
        pairs.forEach((pair, d) => {
            if (!pair) return;
            marks.set(lines[run.dels[d]], [pair.span.start, pair.span.endA]);
            marks.set(lines[run.adds[pair.add]], [pair.span.start, pair.span.endB]);
        });
    }
    return marks;
};

/** A line's HTML with the changed stretch wrapped in `<mark>`. */
export const highlightMarked = (text: string, lang: ReviewFile["lang"], state: HighlightState, [from, to]: [number, number]) =>
    from === to
        ? highlightLine(text, lang, state)
        : highlightLine(text.slice(0, from), lang, state) + `<mark>${highlightLine(text.slice(from, to), lang, state)}</mark>` + highlightLine(text.slice(to), lang, state);

/** Highlighted rows for diff lines, each deleted line paired with the added line it became and the changed words marked: a one-word edit doesn't read as a rewrite. */
export const lineRows = (lang: ReviewFile["lang"], lines: readonly DiffLine[]): Extract<Row, { kind: "line" }>[] => {
    const marks = changedStretches(lines);
    const state: HighlightState = { inBlock: false };
    return lines.map((line) => {
        const text = expandTabs(line.text);
        const mark = marks.get(line);
        return { kind: "line", line, html: mark ? highlightMarked(text, lang, state, mark) : highlightLine(text, lang, state) };
    });
};

/**
 * A declaration card's head lines with the diff laid over them: deletions above what replaced them, and those at the declaration's very
 * end before the line after it. Unchanged lines between hunks take their base number from the hunks above.
 */
export const pinLines = ({ head = [], from, to, symbol }: Pin, f: Pick<ReviewFile, "hunks">): DiffLine[] => {
    const all = allLines(f.hunks);
    const byHead = new Map(all.filter((l) => l.n !== undefined).map((l) => [l.n!, l]));
    const dels = groupBy(all.filter((l) => l.t === "del"), (l) => l.at);
    const offset = (n: number) => {
        const above = f.hunks.filter((h) => h.newEnd < n);
        const last = above[above.length - 1];
        return last ? last.oldEnd - last.newEnd : 0;
    };
    const out: DiffLine[] = [];
    for (let n = from; n <= to; n++) {
        out.push(...(dels[n] ?? []));
        out.push(byHead.get(n) ?? { t: "ctx", o: n + offset(n), n, at: n, text: head[n - from] ?? "" });
    }
    if ((symbol?.to ?? 0) > to) out.push(...(dels[to + 1] ?? []));
    return out;
};
