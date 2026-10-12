/**
 * Which rows a card shows. A change card shows one declaration: its first
 * line, every changed line with two lines around it, every row that calls
 * another card, and folds between, cut at `CARD.maxRows`. Any card that
 * hides something ends in a row that says `Read all`.
 */

import type { DiffLine } from "../diff.ts";
import { plural, sumBy } from "../fp.ts";
import { languageOf } from "../language.ts";
import type { Link, Pin, Review, ReviewFile } from "../model.ts";
import { CARD, isDeclaration, type Row } from "./grid.ts";
import { lineRows, pinLines } from "./lines.ts";

export type CardInput = Pick<Review, "files" | "links"> & Partial<Pick<Review, "pins">>;

/**
 * How much a line wants to show: `always` is never folded, `ifRoom` shows
 * unless the card would be too long, and `context` folds first.
 */
const SHOW = { always: 3, ifRoom: 2, context: 1, never: 0 } as const;

export const outgoing = (review: Pick<Review, "links">, pin: string): Link[] => review.links.filter((l) => l.from === pin);

/**
 * The file a declaration's card reads: the PR's, or for an unchanged caller
 * in a file the PR leaves alone, that file with nothing changed.
 */
export const declFileOf = (pin: Pin, review: Pick<Review, "files">): Pick<ReviewFile, "hunks" | "lang"> | undefined =>
    review.files.find((x) => x.path === pin.path) ?? (pin.kind === "context" && pin.path ? { hunks: [], lang: languageOf(pin.path) } : undefined);

/**
 * Rows from lines by priority (`SHOW`). Lines not shown fold into
 * `⋯ N lines`; one hidden line shows instead, at the end too, since its
 * fold would take the same room.
 */
const foldRows = (lang: ReviewFile["lang"], lines: readonly DiffLine[], priority: readonly number[], calls: ReadonlySet<number>, max: number): Row[] => {
    const highlighted = lineRows(lang, lines);
    /** `cut`: lines that would show if there were room are folded too, so the last fold reads `more lines`. */
    const showing = (kept: readonly boolean[], cut: boolean): Row[] => {
        const rows: Row[] = [];
        for (let i = 0; i < lines.length; ) {
            if (kept[i]) {
                const n = lines[i].n;
                rows.push({ ...highlighted[i], ...(n !== undefined && calls.has(n) ? { call: true } : {}) });
                i++;
                continue;
            }
            let j = i;
            while (j < lines.length && !kept[j]) j++;
            const tail = j === lines.length;
            if (j - i === 1) rows.push(highlighted[i]);
            else rows.push({ kind: "fold", count: j - i, from: lines[i].at, to: lines[j - 1].at, tail, more: tail && cut });
            i = j;
        }
        return rows;
    };
    const atLeast = (min: number) => priority.map((p) => p >= min);
    for (const min of [SHOW.context, SHOW.ifRoom]) {
        const rows = showing(atLeast(min), false);
        if (rows.length <= max) return rows;
    }
    const kept = atLeast(SHOW.always);
    priority.forEach((p, i) => {
        if (p !== SHOW.ifRoom) return;
        kept[i] = true;
        if (showing(kept, true).length > max) kept[i] = false;
    });
    return showing(kept, true);
};

/** Whether each of `count` lines lies within `CARD.context` lines of a changed one, by index. */
const nearChanges = (count: number, changed: readonly number[]): boolean[] => Array.from({ length: count }, (_, i) => changed.some((c) => Math.abs(c - i) <= CARD.context));

/** The cards a card's lines hold, a Python class's methods: their lines fold on it, since their own cards show them. */
const nestedIn = (pin: Pin, pins: readonly Pin[]): Pin[] =>
    pins.filter((q) => q.id !== pin.id && isDeclaration(q) && q.path === pin.path && pin.from <= q.from && q.to <= pin.to && (pin.from < q.from || q.to < pin.to));

/** Whether each line is the card's own, not a nested card's: only these show. Blank lines go with the code below them, else above. */
const ownLines = (lines: readonly DiffLine[], nested: readonly Pin[]): boolean[] => {
    const own = lines.map((l) => !nested.some((q) => l.at >= q.from && l.at <= q.to));
    if (nested.length === 0) return own;
    const blank = (i: number) => lines[i].text.trim() === "";
    for (let i = 0; i < lines.length; i++) {
        if (!blank(i)) continue;
        let j = i;
        while (j < lines.length && blank(j)) j++;
        for (let k = i; k < j; k++) own[k] = j < lines.length ? own[j] : i > 0 ? own[i - 1] : own[k];
        i = j;
    }
    return own;
};

/** The line a declaration's signature ends on: the first of its first 16 that ends in `{`, `=>`, `:` or `=`. */
const signatureEnd = (pin: Pin, start: number): number => {
    for (let n = start; n <= Math.min(pin.to, start + 15); n++) if (/(\{|=>|:|=)\s*$/.test((pin.head![n - pin.from] ?? "").trim())) return n;
    return start;
};

type Marks = {
    /** The declaration's first line. */
    start: number;
    /** Lines where a string starts. */
    starts: ReadonlySet<number>;
    /** Lines that make a link: its calls, or every reference. */
    calls: ReadonlySet<number>;
};

/** An unchanged caller shows its call rows; a short helper, calling no card, shows its body. */
const contextPriority = (lines: readonly DiffLine[], own: readonly boolean[], { start, starts, calls }: Marks): number[] => {
    const key = lines.map((l, i) => own[i] && (l.n === start || starts.has(l.n ?? -1) || calls.has(l.n ?? -1)));
    const nearKey = key.map((_, i) => key.slice(Math.max(0, i - 1), i + 2).some(Boolean));
    const helper = calls.size === 0;
    return key.map((k, i) => (k ? SHOW.always : own[i] && (helper || nearKey[i]) ? SHOW.context : SHOW.never));
};

/** A change card always shows its first line and the rows strings start at; changes, calls and a long signature's end while there's room. */
const changePriority = (pin: Pin, lines: readonly DiffLine[], own: readonly boolean[], { start, starts, calls }: Marks): number[] => {
    const sigEnd = signatureEnd(pin, start);
    const near = nearChanges(lines.length, lines.flatMap((l, i) => (l.t === "ctx" || !own[i] ? [] : [i])));
    return lines.map((l, i) => {
        const n = l.n ?? -1;
        if (!own[i]) return SHOW.never;
        if ((l.t !== "del" && n === start) || starts.has(n)) return SHOW.always;
        if (l.t !== "ctx" || calls.has(n) || (n === sigEnd && sigEnd - start + 1 > 3)) return SHOW.ifRoom;
        return near[i] ? SHOW.context : SHOW.never;
    });
};

/** Rows for a changed or unchanged declaration. */
const declRows = (pin: Pin, review: CardInput): Row[] => {
    const f = declFileOf(pin, review);
    if (!f || !pin.head) return [{ kind: "info", text: "PR Blackboard couldn't read this file." }];
    const lines = pinLines(pin, f);
    const out = outgoing(review, pin.id);
    const marks: Marks = {
        start: pin.symbol?.start ?? pin.from,
        starts: new Set(out.map((l) => l.at).filter((n): n is number => n !== undefined)),
        calls: new Set(out.flatMap((l) => l.rows)),
    };
    const own = ownLines(lines, nestedIn(pin, review.pins ?? []));
    if (pin.kind === "context") return foldRows(f.lang, lines, contextPriority(lines, own, marks), marks.calls, CARD.contextRows);
    return foldRows(f.lang, lines, changePriority(pin, lines, own, marks), marks.calls, CARD.maxRows);
};

const NO_DIFF = "GitHub doesn't show this diff: the file is too large or not text.";

/** Unchanged lines a file card's excerpt keeps around each of its ranges. */
const EXCERPT_CONTEXT = 3;

/** Rows for a file card: the hunks, or only those around its ranges, as an excerpt. */
const fileRows = (pin: Pin, review: Pick<Review, "files">): Row[] => {
    const f = review.files.find((x) => x.path === pin.path);
    if (!f) return [{ kind: "info", text: "Nothing to show." }];
    if (!f.hasPatch) return [{ kind: "info", text: NO_DIFF }, ...(f.previousPath ? [{ kind: "info" as const, text: `Renamed from ${f.previousPath}.` }] : [])];
    if (f.hunks.length === 0) return [{ kind: "info", text: f.previousPath ? `Renamed from ${f.previousPath}, with no changes inside.` : "No changes inside the file." }];
    const inRange = (l: DiffLine) => !pin.ranges || pin.ranges.some((r) => l.at >= r.from - EXCERPT_CONTEXT && l.at <= r.to + EXCERPT_CONTEXT);
    const rows: Row[] = [];
    let end: number | null = null;
    for (const h of f.hunks) {
        const lines = h.lines.filter(inRange);
        if (lines.length === 0) continue;
        if (end !== null && lines[0].at > end + 1) rows.push({ kind: "gap", count: lines[0].at - end - 1 });
        end = lines[lines.length - 1].at;
        const near = nearChanges(lines.length, lines.flatMap((l, i) => (l.t === "ctx" ? [] : [i])));
        const priority = lines.map((l, i) => (l.t !== "ctx" ? SHOW.ifRoom : near[i] ? SHOW.context : SHOW.never));
        rows.push(...foldRows(f.lang, lines, priority, new Set(), Number.MAX_SAFE_INTEGER).filter((r) => !(r.kind === "fold" && r.tail)));
    }
    if (rows.length <= CARD.maxRows) return rows;
    const kept = rows.slice(0, CARD.maxRows - 1);
    const hidden = sumBy(rows.slice(kept.length), (r) => (r.kind === "line" ? 1 : r.kind === "fold" ? r.count : 0));
    return [...kept, { kind: "fold", count: hidden, from: 0, to: 0, tail: true, more: true }];
};

/** A test card lists its cases, nested under their groups; their code always stays for Read all. */
const testRows = (pin: Pin, review: Pick<Review, "files">): Row[] => {
    const f = review.files.find((x) => x.path === pin.path);
    if (!f) return [];
    // A removed case shows only where no added one stands at its line.
    const cases = f.cases.filter((c) => c.t === "add" || !f.cases.some((d) => d.t === "add" && d.at === c.at));
    if (cases.length === 0) return fileRows(pin, review);
    const shown = cases.slice(0, CARD.maxCases);
    // The indents of the groups still open above each case: a line indented no deeper than a group's closes it.
    const open: number[] = [];
    const rows = shown.map((test): Row => {
        while (open.length > 0 && open[open.length - 1] >= test.indent) open.pop();
        const depth = open.length;
        if (test.group) open.push(test.indent);
        return { kind: "case", test, depth };
    });
    const more = cases.length - shown.length;
    return [...rows, { kind: "info", text: more > 0 ? `${plural(more, "more case")} · Read all` : "Test code · Read all", readAll: true }];
};

export const rowsOf = (pin: Pin, review: CardInput): Row[] => (isDeclaration(pin) ? declRows(pin, review) : pin.kind === "test" ? testRows(pin, review) : fileRows(pin, review));

/** A file's whole diff, unchanged stretches between hunks counted. */
export const fileDiffRows = (f: ReviewFile): Row[] => {
    if (!f.hasPatch) return [{ kind: "info", text: NO_DIFF }];
    const rows: Row[] = [];
    f.hunks.forEach((h, i) => {
        const before = i === 0 ? h.newStart - 1 : h.newStart - f.hunks[i - 1].newEnd - 1;
        if (before > 0) rows.push({ kind: "gap", count: before });
        rows.push(...lineRows(f.lang, h.lines));
    });
    return rows;
};

/** A whole declaration with its changes, nothing folded, and `→` on the rows that call another card, as on the card. */
export const declarationRows = (pin: Pin, f: Pick<ReviewFile, "hunks" | "lang">, review: Pick<Review, "links">): Row[] => {
    if (!pin.head) return [];
    const calls = new Set(outgoing(review, pin.id).flatMap((l) => l.rows));
    return lineRows(f.lang, pinLines(pin, f)).map((r) => (r.line.n !== undefined && calls.has(r.line.n) ? { ...r, call: true } : r));
};
