/**
 * The cards pinned on the board, and Read all, the one popover.
 *
 * A card is a component: an iframe that can't report where it was clicked.
 * So every card is built on a fixed grid, a 56 px header then rows of
 * exactly 20 px, and `pinCard` returns that grid as data. The layout reads it to start strings at the right row,
 * and the navigator turns a canvas click back into a row.
 *
 * A change card shows one declaration: its first line, every changed line
 * with two lines around it, every row that calls another card, and folds
 * between, cut at `CARD.maxRows`. Read all shows the rest. Any card that
 * hides something, folded lines, a test's code or the end of a long line,
 * ends in a row that says `Read all`.
 */

import { allLines, type DiffLine } from "./diff.ts";
import { clamp, count, plural, sortBy } from "./fp.ts";
import { escapeHtml, highlightLine, type HighlightState } from "./highlight.ts";
import { languageOf } from "./language.ts";
import type { Link, Pin, Review, ReviewFile } from "./model.ts";
import { MARKDOWN_CSS, blocksHeight, lexMarkdown, markdownBlocks, markdownHtml, segments, segmentsHtml, type MdToken } from "./markdown.ts";
import type { TestCase } from "./symbols.ts";

export const CARD = {
    header: 56,
    row: 20,
    padBottom: 12,
    minWidth: 480,
    maxWidth: 880,
    /** Width of one character of the code font at 12.5px. */
    charWidth: 7.6,
    /** Two line-number columns, the +/− column and the call arrow. */
    gutter: 124,
    /** Code rows a card shows at most; rows that start a string are never cut. */
    maxRows: 24,
    /** Unchanged lines a card keeps on each side of a change. */
    context: 2,
    /** Rows a context card shows at most. */
    contextRows: 10,
    /** Test cases a test card lists at most. */
    maxCases: 12,
} as const;

export type Row =
    | { kind: "line"; line: DiffLine; html: string; call?: boolean }
    /**
     * `⋯ 23 lines`; the last one reads `· Read all`. `cut`: no line is folded,
     * but `count` lines are cut short at the card's edge, the first at `from`.
     */
    | { kind: "fold"; count: number; from: number; to: number; tail: boolean; more: boolean; cut?: true }
    /** Unchanged lines between two hunks: the diff doesn't hold them, so nothing opens there. */
    | { kind: "gap"; count: number }
    /** `depth`: how many of the shown groups above the case hold it. */
    | { kind: "case"; test: TestCase; depth: number }
    | { kind: "info"; text: string; readAll?: boolean };

/** A card's last row when it hides something: `· Read all` in its text. */
const opensReadAll = (r: Row | undefined): boolean => (r?.kind === "fold" && r.tail) || (r?.kind === "info" && r.readAll === true);

export type CardModel = {
    pin: string;
    rows: Row[];
    width: number;
    height: number;
    /** The row each outgoing link's string starts at, by link id. */
    anchors: Record<string, number>;
};

const expandTabs = (text: string) => text.replace(/\t/g, "    ");
const fileName = (path: string) => path.split("/").pop() ?? path;

/**
 * Where a changed line differs from the line it replaced: the stretch between
 * their common start and common end. Null when they share too little for
 * the mark to help, and the whole line reads as changed.
 */
export const changedSpan = (a: string, b: string): { start: number; endA: number; endB: number } | null => {
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

/** A line's HTML with the changed stretch wrapped in `<mark>`. */
const highlightMarked = (text: string, lang: ReviewFile["lang"], state: HighlightState, [from, to]: [number, number]) =>
    from === to
        ? highlightLine(text, lang, state)
        : highlightLine(text.slice(0, from), lang, state) +
          `<mark>${highlightLine(text.slice(from, to), lang, state)}</mark>` +
          highlightLine(text.slice(to), lang, state);

type Pair = { add: number; span: { start: number; endA: number; endB: number } };

/**
 * Which added line each deleted line became: the most alike one, keeping
 * their order, so an edit lines up with its old version even when lines
 * were inserted around it. Null for a deleted line that matches none.
 */
const pairLines = (dels: readonly string[], adds: readonly string[]): (Pair | null)[] => {
    let from = 0;
    return dels.map((a) => {
        if (adds.length > 40) return null;
        let best: (Pair & { score: number }) | null = null;
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
const changeRuns = <T>(items: readonly T[], kind: (item: T) => "del" | "add" | "other"): { dels: number[]; adds: number[] }[] => {
    const runs: { dels: number[]; adds: number[] }[] = [];
    for (let i = 0; i < items.length; ) {
        if (kind(items[i]) !== "del") {
            i++;
            continue;
        }
        const dels: number[] = [];
        const adds: number[] = [];
        while (i < items.length && kind(items[i]) === "del") dels.push(i++);
        while (i < items.length && kind(items[i]) === "add") adds.push(i++);
        runs.push({ dels, adds });
    }
    return runs;
};

/**
 * Highlighted rows for diff lines. Each deleted line is paired with the added
 * line it became, and the words that changed between them are marked, so a
 * one-word edit doesn't read as a rewritten line.
 */
const lineRows = (lang: ReviewFile["lang"], lines: readonly DiffLine[]): Extract<Row, { kind: "line" }>[] => {
    const marks = new Map<DiffLine, [number, number]>();
    for (const run of changeRuns(lines, (l) => (l.t === "ctx" ? "other" : l.t))) {
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
    const state: HighlightState = { inBlock: false };
    return lines.map((line) => {
        const text = expandTabs(line.text);
        const mark = marks.get(line);
        return { kind: "line", line, html: mark ? highlightMarked(text, lang, state, mark) : highlightLine(text, lang, state) };
    });
};

/**
 * The lines of head `from`..`to` with the diff laid over them: unchanged
 * lines from the head file, changed ones from the patch, deletions in place
 * above what replaced them. Unchanged lines between hunks get their base
 * number from the offset the hunks above left.
 */
const declLines = (f: Pick<ReviewFile, "hunks">, head: readonly string[], from: number, to: number, trailing = false): DiffLine[] => {
    const all = allLines(f.hunks);
    const byHead = new Map(all.filter((l) => l.n !== undefined).map((l) => [l.n!, l]));
    const dels = new Map<number, DiffLine[]>();
    for (const l of all) if (l.t === "del") dels.set(l.at, [...(dels.get(l.at) ?? []), l]);
    const offset = (n: number) => {
        const above = f.hunks.filter((h) => h.newEnd < n);
        const last = above[above.length - 1];
        return last ? last.oldEnd - last.newEnd : 0;
    };
    const out: DiffLine[] = [];
    for (let n = from; n <= to; n++) {
        out.push(...(dels.get(n) ?? []));
        out.push(byHead.get(n) ?? { t: "ctx", o: n + offset(n), n, at: n, text: head[n - from] ?? "" });
    }
    // Lines deleted at the very end of a declaration sit before the line after it.
    if (trailing) out.push(...(dels.get(to + 1) ?? []));
    return out;
};

/**
 * Rows from lines by priority: 3 always shows, 2 shows unless the card is
 * too long, 1 is context that goes first. Lines not shown fold into
 * `⋯ N lines`; one hidden line shows instead, at the end too, since its
 * fold would take the same room.
 */
const foldRows = (lang: ReviewFile["lang"], lines: readonly DiffLine[], priority: readonly number[], calls: ReadonlySet<number>, max: number): Row[] => {
    const highlighted = lineRows(lang, lines);
    const render = (kept: readonly boolean[], cut: boolean): Row[] => {
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
    const at = (min: number) => priority.map((p) => p >= min);
    for (const min of [1, 2]) {
        const rows = render(at(min), false);
        if (rows.length <= max) return rows;
    }
    const kept = at(3);
    priority.forEach((p, i) => {
        if (p !== 2) return;
        kept[i] = true;
        if (render(kept, true).length > max) kept[i] = false;
    });
    return render(kept, true);
};

const outgoing = (review: Pick<Review, "links">, pin: string) => review.links.filter((l) => l.from === pin);

/**
 * The file a declaration's card reads: the pull request's, or for an
 * unchanged caller in a file the pull request leaves alone, that file with
 * nothing changed.
 */
const declFileOf = (pin: Pin, review: Pick<Review, "files">): Pick<ReviewFile, "hunks" | "lang"> | undefined =>
    review.files.find((x) => x.path === pin.path) ?? (pin.kind === "context" && pin.path ? { hunks: [], lang: languageOf(pin.path) } : undefined);

/** The cards a card's lines hold, a Python class's methods: their lines fold on it, since their own cards show them. */
const nestedIn = (pin: Pin, pins: readonly Pin[]): Pin[] =>
    pins.filter((q) => q.id !== pin.id && (q.kind === "change" || q.kind === "context") && q.path === pin.path && pin.from <= q.from && q.to <= pin.to && (pin.from < q.from || q.to < pin.to));

/** Rows for a changed or unchanged declaration. */
const declRows = (pin: Pin, review: Pick<Review, "files" | "links"> & Partial<Pick<Review, "pins">>): Row[] => {
    const f = declFileOf(pin, review);
    if (!f || !pin.head) return [{ kind: "info", text: "PR Blackboard couldn't read this file." }];
    const lines = declLines(f, pin.head, pin.from, pin.to, (pin.symbol?.to ?? 0) > pin.to);
    const out = outgoing(review, pin.id);
    const starts = new Set(out.map((l) => l.at).filter((n): n is number => n !== undefined));
    const calls = new Set(out.flatMap((l) => l.rows));
    const start = pin.symbol?.start ?? pin.from;
    // Lines that are the card's own, not a nested card's: only these show. Blank lines go with the code below them, else above.
    const nested = nestedIn(pin, review.pins ?? []);
    const own = lines.map((l) => !nested.some((q) => l.at >= q.from && l.at <= q.to));
    const blank = (i: number) => lines[i].text.trim() === "";
    for (let i = 0; nested.length > 0 && i < lines.length; i++) {
        if (!blank(i)) continue;
        let j = i;
        while (j < lines.length && blank(j)) j++;
        for (let k = i; k < j; k++) own[k] = j < lines.length ? own[j] : i > 0 ? own[i - 1] : own[k];
        i = j;
    }
    if (pin.kind === "context") {
        // Callers show their call rows; a short helper shows its body.
        const priority = lines.map((l, i) => (own[i] && (l.n === start || starts.has(l.n ?? -1) || calls.has(l.n ?? -1)) ? 3 : 0));
        const near = priority.map((_, i) => priority.slice(Math.max(0, i - 1), i + 2).some((p) => p === 3));
        const helper = calls.size === 0;
        return foldRows(f.lang, lines, priority.map((p, i) => (p === 3 ? 3 : own[i] && (helper || near[i]) ? 1 : 0)), calls, CARD.contextRows);
    }
    const sigEnd = (() => {
        for (let n = start; n <= Math.min(pin.to, start + 15); n++) if (/(\{|=>|:|=)\s*$/.test((pin.head[n - pin.from] ?? "").trim())) return n;
        return start;
    })();
    const changedAt = lines.map((l, i) => (l.t === "ctx" || !own[i] ? -1 : i)).filter((i) => i >= 0);
    const priority = lines.map((l, i) => {
        const n = l.n ?? -1;
        if (!own[i]) return 0;
        if ((l.t !== "del" && n === start) || starts.has(n)) return 3;
        if (l.t !== "ctx" || calls.has(n) || (n === sigEnd && sigEnd - start + 1 > 3)) return 2;
        if (changedAt.some((c) => Math.abs(c - i) <= CARD.context)) return 1;
        return 0;
    });
    return foldRows(f.lang, lines, priority, calls, CARD.maxRows);
};

/** Rows for a file card: the hunks, or only those around its ranges, as an excerpt. */
const fileRows = (pin: Pin, review: Pick<Review, "files">): Row[] => {
    const f = review.files.find((x) => x.path === pin.path);
    if (!f) return [{ kind: "info", text: "Nothing to show." }];
    if (!f.hasPatch) {
        return [
            { kind: "info", text: "GitHub doesn't show this diff: the file is too large or not text." },
            ...(f.previousPath ? [{ kind: "info" as const, text: `Renamed from ${f.previousPath}.` }] : []),
        ];
    }
    if (f.hunks.length === 0) return [{ kind: "info", text: f.previousPath ? `Renamed from ${f.previousPath}, with no changes inside.` : "No changes inside the file." }];
    const inRange = (l: DiffLine) => !pin.ranges || pin.ranges.some((r) => l.at >= r.from - 3 && l.at <= r.to + 3);
    const rows: Row[] = [];
    let end: number | null = null;
    for (const h of f.hunks) {
        const lines = h.lines.filter(inRange);
        if (lines.length === 0) continue;
        if (end !== null && lines[0].at > end + 1) rows.push({ kind: "gap", count: lines[0].at - end - 1 });
        end = lines[lines.length - 1].at;
        const changedAt = lines.map((l, i) => (l.t === "ctx" ? -1 : i)).filter((i) => i >= 0);
        const priority = lines.map((l, i) => (l.t !== "ctx" ? 2 : changedAt.some((c) => Math.abs(c - i) <= CARD.context) ? 1 : 0));
        rows.push(...foldRows(f.lang, lines, priority, new Set(), Number.MAX_SAFE_INTEGER).filter((r) => !(r.kind === "fold" && r.tail)));
    }
    if (rows.length <= CARD.maxRows) return rows;
    const kept = rows.slice(0, CARD.maxRows - 1);
    const hidden = rows.slice(kept.length).reduce((n, r) => n + (r.kind === "line" ? 1 : r.kind === "fold" ? r.count : 0), 0);
    return [...kept, { kind: "fold", count: hidden, from: 0, to: 0, tail: true, more: true }];
};

const testRows = (pin: Pin, review: Pick<Review, "files">): Row[] => {
    const f = review.files.find((x) => x.path === pin.path);
    if (!f) return [];
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
    // The card lists the cases; their code is always hidden, so it always ends in Read all. The header gives the code's size.
    const tail: Row =
        cases.length > shown.length
            ? { kind: "info", text: `${plural(cases.length - shown.length, "more case")} · Read all`, readAll: true }
            : { kind: "info", text: "Test code · Read all", readAll: true };
    return [...rows, tail];
};

/** What a link means, in one word: a context link reads as what its references do. */
export const wordOf = (l: Pick<Link, "kind" | "reads">): "calls" | "uses" | "tests" | "imports" => (l.kind === "context" ? (l.reads ?? "calls") : l.kind);

type Word = ReturnType<typeof wordOf>;

/** How the panel words each kind of link, seen from either end: links to the card first, then links it makes. */
const LINK_WORDS: { out: Word[]; inc: Word[]; word: string }[] = [
    { out: [], inc: ["calls"], word: "called by" },
    { out: [], inc: ["uses"], word: "used by" },
    { out: [], inc: ["tests"], word: "tested by" },
    { out: [], inc: ["imports"], word: "imported by" },
    { out: ["calls"], inc: [], word: "calls" },
    { out: ["uses"], inc: [], word: "uses" },
    { out: ["tests"], inc: [], word: "tests" },
    { out: ["imports"], inc: [], word: "imports" },
];

export type LinkGroup = { word: string; links: { link: string; name: string }[] };

/** What the panel calls a card in a link: a file card by its file, so `imported by hono-base.ts`, not `… hono-base.ts imports`. */
const linkName = (pin: Pin | undefined, id: string): string => (pin?.kind === "file" && pin.path ? fileName(pin.path) : (pin?.name ?? id));

/**
 * A card's links, one group per kind, naming every link whether or not its
 * string is drawn. Names follow board order, the order Next walks.
 */
export const linkGroups = (pin: Pick<Pin, "id">, review: Pick<Review, "links" | "pins" | "order">): LinkGroup[] => {
    const nameOf = (id: string) => linkName(review.pins.find((p) => p.id === id), id);
    return LINK_WORDS.map(({ out, inc, word }) => {
        const outgoing = review.links.filter((l) => l.from === pin.id && out.includes(wordOf(l))).map((l) => ({ link: l.id, card: l.to }));
        const incoming = review.links.filter((l) => l.to === pin.id && inc.includes(wordOf(l))).map((l) => ({ link: l.id, card: l.from }));
        const links = sortBy([...outgoing, ...incoming], (l) => review.order.indexOf(l.card));
        return { word, links: links.map((l) => ({ link: l.link, name: nameOf(l.card) })) };
    }).filter((g) => g.links.length > 0);
};

const rowChars = (r: Row): number => {
    switch (r.kind) {
        case "line":
            return expandTabs(r.line.text).length;
        case "case":
            return r.test.name.length + 10 + r.depth * 2;
        case "info":
            return r.text.length * 0.9;
        default:
            return 0;
    }
};

/** How wide a card must be to show a row whole. */
const rowWidth = (r: Row): number => CARD.gutter + rowChars(r) * CARD.charWidth + 32;

/**
 * A card as data: its rows, size, and where its strings start. A card at
 * its widest cuts long lines with `…`; unless it already ends in Read all,
 * a row saying so follows, Read all opening at the first one.
 */
export const pinCard = (pin: Pin, review: Pick<Review, "files" | "links"> & Partial<Pick<Review, "pins">>): CardModel => {
    const built = pin.kind === "change" || pin.kind === "context" ? declRows(pin, review) : pin.kind === "test" ? testRows(pin, review) : fileRows(pin, review);
    const header = 220 + (pin.name.length + (pin.path ?? "").length) * 7;
    const width = Math.round(clamp(Math.max(header, ...built.map(rowWidth)), CARD.minWidth, CARD.maxWidth));
    // The code column starts after the gutter, 68 on a context card, and keeps 12 clear at its right.
    const room = width - (pin.kind === "context" ? 68 : CARD.gutter) - 12;
    const cut = built.flatMap((r) => (r.kind === "line" && rowChars(r) * CARD.charWidth > room ? [r.line.at] : []));
    const rows: Row[] =
        cut.length === 0 || opensReadAll(built[built.length - 1])
            ? built
            : [...built, { kind: "fold", count: cut.length, from: cut[0], to: cut[0], tail: true, more: false, cut: true }];
    const anchors: Record<string, number> = {};
    for (const l of outgoing(review, pin.id)) {
        const i = rows.findIndex((r) => r.kind === "line" && r.line.t !== "del" && r.line.n === l.at);
        if (i >= 0) anchors[l.id] = i;
    }
    return { pin: pin.id, rows, width, height: CARD.header + rows.length * CARD.row + CARD.padBottom, anchors };
};

/** The middle of a row, in pixels from the card's top; -1 is the header. */
export const rowMiddle = (row: number): number => (row < 0 ? CARD.header / 2 : CARD.header + row * CARD.row + CARD.row / 2);

/** Where a card's name sits in its header, for a card at `card` drawn `scale` times its planned size. */
export const nameRect = (card: { x: number; y: number; width: number }, name: string, scale = 1): { x: number; y: number; width: number; height: number } => {
    // After 14 px of padding, the name in 15 px monospace, about 9 px a character, cut at 52 % of the card.
    const width = Math.min(name.length * 9, (card.width / scale) * 0.52) + 4;
    return { x: card.x + 14 * scale, y: card.y, width: width * scale, height: CARD.header * scale };
};

/** A fold row: its card-local top and the head line Read all opens at, 0 for the first change. */
export type Fold = [y: number, line: number];

/** The rows that open Read all: `⋯ 23 lines`, `· Read all`, and a test card's last row. */
export const foldsOf = (card: CardModel): Fold[] =>
    card.rows.flatMap((r, i): Fold[] => {
        const y = CARD.header + i * CARD.row;
        if (r.kind === "fold") return [[y, r.from]];
        return r.kind === "info" && r.readAll ? [[y, 0]] : [];
    });

/** The fold row under card-local `y`, if any. Rows are 20 high; the PR card's zone runs to its foot. */
export const foldAt = (folds: readonly Fold[], y: number, height: number = CARD.row): Fold | null => folds.find(([top]) => y >= top && y < top + height) ?? null;

export type Theme = "light" | "dark";

/**
 * Card colours, per theme. Diff, syntax and Markdown colours are GitHub's
 * (Primer), so code reads as it does on GitHub. Read all's frame and its
 * buttons take theirs from here too, so it matches the cards.
 */
export const PALETTES: Record<Theme, Record<string, string>> = {
    light: {
        bg: "#ffffff", bg2: "#f4f4f5", ink: "#18181b", ink2: "#52525b", ink3: "#8a8a93", line: "#e4e4e7", hover: "rgb(24 24 27 / .05)",
        "add-bg": "#e6ffec", "add-gut": "#ccffd8", add: "#1a7f37", "del-bg": "#ffebe9", "del-gut": "#ffd7d5", del: "#c4232e",
        "add-mark": "#abf2bc", "del-mark": "rgb(255 129 130 / .4)", blue: "#4a6ee0",
        k: "#cf222e", s: "#0a3069", n: "#0550ae", c: "#59636e", f: "#8250df", t: "#953800",
        "md-link": "#0969da", "md-code-bg": "#f6f8fa", "md-border": "#d1d9e0",
    },
    dark: {
        bg: "#1f1f23", bg2: "#27272b", ink: "#f4f4f5", ink2: "#b4b4bc", ink3: "#85858f", line: "#34343a", hover: "rgb(255 255 255 / .06)",
        "add-bg": "rgb(46 160 67 / .15)", "add-gut": "rgb(63 185 80 / .3)", add: "#5bd178", "del-bg": "rgb(248 81 73 / .1)", "del-gut": "rgb(248 81 73 / .3)", del: "#ff8079",
        "add-mark": "rgb(46 160 67 / .4)", "del-mark": "rgb(248 81 73 / .4)", blue: "#8aa4ff",
        k: "#ff7b72", s: "#a5d6ff", n: "#79c0ff", c: "#9198a1", f: "#d2a8ff", t: "#ffa657",
        "md-link": "#4493f8", "md-code-bg": "#151b23", "md-border": "#3d444d",
    },
};

/**
 * Colours for a theme, fixed in the page. A card's iframe can't follow
 * Drawdy's theme: its `prefers-color-scheme` follows the browser's, which
 * often differs, so the card takes the theme Drawdy showed when it was pinned.
 */
const themeVars = (theme: Theme) => `:root { color-scheme: ${theme}; ${Object.entries(PALETTES[theme]).map(([k, v]) => `--${k}: ${v};`).join(" ")} }`;

const BASE_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; overflow: hidden; background: var(--bg); color: var(--ink); }
body { font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.mono, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
.a { color: var(--add); } .d { color: var(--del); }
`;

const CARD_CSS = `
header { height: ${CARD.header}px; display: flex; align-items: center; gap: 10px; padding: 0 14px; background: var(--bg2); border-bottom: 1px solid var(--line); white-space: nowrap; }
.name { flex: none; max-width: 52%; font: 600 15px/1 ui-monospace, SFMono-Regular, Menlo, monospace; overflow: hidden; text-overflow: ellipsis; }
.chip { flex: none; border-radius: 6px; padding: 3px 7px; font: 700 10.5px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .06em; }
.chip.new { background: var(--add-gut); color: var(--add); } .chip.unchanged { background: var(--line); color: var(--ink2); } .chip.test { background: var(--blue); color: var(--bg); }
.where { min-width: 0; flex: 1; text-align: right; color: var(--ink3); font: 12px ui-monospace, Menlo, monospace; overflow: hidden; text-overflow: ellipsis; }
.counts { flex: none; font: 500 12.5px ui-monospace, Menlo, monospace; }
.r { height: ${CARD.row}px; line-height: ${CARD.row}px; display: grid; grid-template-columns: 44px 44px 20px 16px 1fr; white-space: pre; overflow: hidden; font: 12.5px/${CARD.row}px ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
.r > i { font-style: normal; text-align: right; padding-right: 8px; color: var(--ink3); font-size: 11.5px; }
.r > b { font-weight: 400; text-align: center; color: var(--ink3); }
.r > u { text-decoration: none; color: var(--ink); font-weight: 700; text-align: center; }
.r > code { overflow: hidden; text-overflow: ellipsis; padding-right: 12px; }
.add { background: var(--add-bg); } .add > i { background: var(--add-gut); } .add > b { color: var(--add); }
.del { background: var(--del-bg); } .del > i { background: var(--del-gut); } .del > b { color: var(--del); }
.plain .r { grid-template-columns: 52px 16px 1fr; color: var(--ink2); }
.gap, .fold, .info { height: ${CARD.row}px; line-height: ${CARD.row}px; padding: 0 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--ink3); font-size: 11.5px; }
.fold, .gap { font-family: ui-monospace, Menlo, monospace; padding-left: 112px; }
.fold.cases { padding-left: 52px; }
.ra { color: var(--ink2); text-decoration: underline; text-underline-offset: 2px; }
.dots { font: 15px/1 ui-sans-serif, system-ui, sans-serif; }
.info { color: var(--ink2); font-size: 12.5px; }
.case { height: ${CARD.row}px; line-height: ${CARD.row}px; padding-right: 14px; display: grid; grid-template-columns: 44px 20px 1fr; white-space: nowrap; overflow: hidden; font-size: 12.5px; }
.case > i { font-style: normal; text-align: right; padding-right: 8px; color: var(--ink3); font: 11.5px/${CARD.row}px ui-monospace, Menlo, monospace; }
.case > b { font-weight: 400; text-align: center; }
.case > span { overflow: hidden; text-overflow: ellipsis; }
.case.group > span { font-weight: 600; }
.case.removed { color: var(--ink3); text-decoration: line-through; }
.k { color: var(--k); } .s { color: var(--s); } .n { color: var(--n); } .c { color: var(--c); font-style: italic; } .f { color: var(--f); } .t { color: var(--t); }
mark { color: inherit; border-radius: 3px; background: var(--add-mark); }
.del mark { background: var(--del-mark); }
body.context { border: 1.5px dashed var(--ink3); border-radius: 12px; }
body.context header { background: transparent; color: var(--ink2); }
`;

const DOTS = `<span class="dots">⋯</span>`;

/** Every fold row opens Read all, so each underlines what to click: its line count, or `Read all` on the last. */
const foldText = (r: Extract<Row, { kind: "fold" }>) => {
    if (r.cut) return `${DOTS} ${plural(r.count, "line")} cut short · <span class="ra">Read all</span>`;
    if (r.tail) return `${DOTS} ${plural(r.count, r.more ? "more line" : "line")} · <span class="ra">Read all</span>`;
    return `${DOTS} <span class="ra">${plural(r.count, "line")}</span>`;
};

/** Read all wraps long lines; each wrapped part starts under its line's own indent, two columns in. */
const hanging = (text: string) => {
    const at = /^ */.exec(expandTabs(text))![0].length + 2;
    return ` style="padding-left:${at}ch;text-indent:-${at}ch"`;
};

const rowHtml = (row: Row, plain = false, wrap = false): string => {
    switch (row.kind) {
        case "gap":
            return `<div class="gap">${DOTS} ${plural(row.count, "line")}</div>`;
        case "fold":
            return `<div class="fold">${foldText(row)}</div>`;
        case "info":
            // A test card's last row opens Read all as a fold row does, so it looks like one, under the case names.
            return row.readAll
                ? `<div class="fold cases">${DOTS} ${escapeHtml(row.text).replace("Read all", '<span class="ra">Read all</span>')}</div>`
                : `<div class="info">${escapeHtml(row.text)}</div>`;
        case "case": {
            const t = row.test;
            const indent = row.depth > 0 ? ` style="padding-left:${row.depth * 12}px"` : "";
            return `<div class="case${t.group ? " group" : ""}${t.t === "del" ? " removed" : ""}"><i>${t.at}</i><b class="${t.t === "add" ? "a" : "d"}">${t.t === "add" ? "+" : "−"}</b><span${indent}>${escapeHtml(t.name)}</span></div>`;
        }
        case "line": {
            const l = row.line;
            const sign = l.t === "add" ? "+" : l.t === "del" ? "−" : "";
            const arrow = row.call ? "→" : "";
            const code = `<code${wrap ? hanging(l.text) : ""}>${row.html || " "}</code>`;
            if (plain) return `<div class="r ctx" data-at="${l.at}"><i>${l.n ?? ""}</i><u>${arrow}</u>${code}</div>`;
            return `<div class="r ${l.t}" data-at="${l.at}"><i>${l.o ?? ""}</i><i>${l.n ?? ""}</i><b>${sign}</b><u>${arrow}</u>${code}</div>`;
        }
    }
};

const page = (css: string, body: string, theme: Theme, script = "", bodyClass = "") =>
    `<!doctype html><html><head><meta charset="utf-8"><style>${themeVars(theme)}${BASE_CSS}${css}</style></head><body${bodyClass ? ` class="${bodyClass}"` : ""}>${body}${script ? `<script>${script}</script>` : ""}</body></html>`;

/** The card's chip, when it has one: changed code needs none. */
export const chipOf = (pin: Pick<Pin, "kind" | "status">): "NEW" | "UNCHANGED" | "TESTS" | null =>
    pin.kind === "test" ? "TESTS" : pin.kind === "context" ? "UNCHANGED" : pin.status === "new" && pin.kind !== "pr" ? "NEW" : null;

const CHIP_CLASS = { NEW: "new", UNCHANGED: "unchanged", TESTS: "test" } as const;

/** Where a card's code is, by its path in the repo: `src/hono-base.ts · 411–471`. */
export const whereOf = (pin: Pin): string => {
    if (!pin.path) return "";
    return pin.kind === "change" || pin.kind === "context" ? `${pin.path} · ${pin.from}–${pin.to}` : pin.path;
};

/** Languages whose method cards are named with their type, `Server.Start()` (`labelOf`). */
const TYPED_METHODS: ReadonlySet<string> = new Set(["py", "go", "rs"]);

/**
 * A card's name as its header shows it, `width` wide: 52 % of the header
 * inside its padding, at about 9.2 px a character. A method's name that
 * doesn't fit loses its type from the left, never the method:
 * `…ServerProtocolConfigFlow.async_step_user()`; with fewer than 8
 * characters of the type left, the method shows alone. Read all and the
 * panel show the whole name.
 */
export const headerName = (pin: Pick<Pin, "kind" | "name" | "path">, width: number): string => {
    const room = Math.floor(((width - 28) * 0.52) / 9.2);
    const parts = /^(\S+)(\.|::)([^\s.:()]+(?:\(\))?)$/.exec(pin.name);
    if (pin.name.length <= room || !parts || (pin.kind !== "change" && pin.kind !== "context") || !TYPED_METHODS.has(languageOf(pin.path ?? ""))) return pin.name;
    const [, type, separator, method] = parts;
    const keep = room - 1 - separator.length - method.length;
    return keep >= 8 ? `…${type.slice(type.length - keep)}${separator}${method}` : method;
};

/** A card's header: the name, its chip, where it is and `+N −M`. Read all opens with the same one, `✕` drawn over its right end. */
const headerHtml = (pin: Pin, name = pin.name): string => {
    const chip = chipOf(pin);
    const counts = pin.kind === "context" ? "" : `<span class="counts"><span class="a">+${count(pin.add)}</span> <span class="d">−${count(pin.del)}</span></span>`;
    return `<header><span class="name">${escapeHtml(name)}</span>${chip ? `<span class="chip ${CHIP_CLASS[chip]}">${chip}</span>` : ""}<span class="where">${escapeHtml(whereOf(pin))}</span>${counts}</header>`;
};

export const cardHtml = (card: CardModel, pin: Pin, theme: Theme): string => {
    const plain = pin.kind === "context";
    return page(CARD_CSS, headerHtml(pin, headerName(pin, card.width)) + `<div class="${plain ? "plain" : ""}">${card.rows.map((r) => rowHtml(r, plain)).join("")}</div>`, theme, "", plain ? "context" : "");
};

const PR = {
    width: 640,
    pad: 16,
    titleLine: 26,
    /** About how wide a character of the 20 px title runs. */
    titleChar: 10.8,
    /** Title to meta, and the meta line. */
    meta: 24,
    unpinned: 20,
    /** 16 above the rule, the rule, 16 below. */
    rule: 33,
    /** The description area is never taller. */
    maxDescription: 500,
    fold: 32,
    /** The fade over a first block cut inside. */
    fade: 48,
    /** How far over Chrome's layout the description's estimate runs at most, as a share of it. */
    over: 0.1,
} as const;

type PrCardInput = Pick<Review, "pr" | "files" | "unpinned">;

/** `28 functions and 2 files not pinned`, or null when everything is. */
export const unpinnedText = ({ functions, files }: Review["unpinned"]): string | null => {
    const parts = [functions > 0 ? plural(functions, "function") : "", files > 0 ? plural(files, "file") : ""].filter(Boolean);
    return parts.length > 0 ? `${parts.join(" and ")} not pinned` : null;
};

export type PrCard = {
    width: number;
    height: number;
    titleLines: number;
    /** The description's blocks the card shows: all of them, or those that fit whole. */
    tokens: MdToken[];
    /** The whole description estimated at the card's width; 0 when there is none. */
    estimate: number;
    /** The most room the card gives the blocks it shows; the surplus of the estimate sits at the card's foot. */
    description: number;
    /** The first block is cut inside, under a fade. */
    cut: boolean;
    /**
     * When the card hides some of the description, where a click opens Read
     * all, card-local, down to the card's foot. The fold row follows the
     * description as Chrome lays it out, up to `PR.over` above its
     * estimated top, so the zone starts that far above.
     */
    fold: number | null;
};

/**
 * Which of the description's blocks fit in `max`: all of them when the
 * rest would take no more room than the fold row, else as many whole
 * blocks as fit, never ending on a heading, so the card stops between
 * blocks. When not even the first fits, it is cut inside.
 */
const fitBlocks = (tokens: readonly MdToken[], blocks: readonly number[], max: number): { count: number; height: number; cut: boolean } => {
    // What the fold row would hide fits in the fold row's own room: show it instead.
    if (blocksHeight(blocks) <= max + PR.fold) return { count: tokens.length, height: blocksHeight(blocks), cut: false };
    let count = 0;
    while (count < tokens.length && blocksHeight(blocks.slice(0, count + 1)) <= max) count++;
    if (count === tokens.length) return { count, height: blocksHeight(blocks), cut: false };
    while (count > 0 && (tokens[count - 1].type === "heading" || blocks[count - 1] === 0)) count--;
    if (count === 0) return { count: tokens.length, height: max, cut: true };
    return { count, height: blocksHeight(blocks.slice(0, count)), cut: false };
};

/**
 * The PR card's size and parts. A component's height is fixed when it is
 * made, for every viewer, so the description is estimated block by block
 * (`markdownBlocks`), a little over what Chrome lays out. Up to 500 it shows
 * whole. Past that the card shows the blocks that fit whole and ends in
 * `⋯ Read all`, right under the last of them; what the estimate gave over
 * sits at the card's foot.
 */
export const prCard = (review: PrCardInput): PrCard => {
    const all = lexMarkdown(review.pr.body);
    const inner = PR.width - 2 * PR.pad;
    const titleChars = segments(review.pr.title).reduce((n, s) => n + s.text.length * (s.code ? 1.15 : 1), 0);
    const titleLines = clamp(Math.ceil((titleChars * PR.titleChar) / inner), 1, 3);
    const blocks = markdownBlocks(all, inner);
    const estimate = blocksHeight(blocks);
    const fit = fitBlocks(all, blocks, PR.maxDescription);
    const folded = fit.count < all.length || fit.cut;
    const top = CARD.header + PR.pad + titleLines * PR.titleLine + PR.meta + (unpinnedText(review.unpinned) ? PR.unpinned : 0) + (estimate > 0 ? PR.rule : 0);
    return {
        width: PR.width,
        height: top + fit.height + (folded ? PR.fold : 0) + PR.pad,
        titleLines,
        tokens: all.slice(0, fit.count),
        estimate,
        description: fit.height,
        cut: fit.cut,
        fold: folded ? top + fit.height - (fit.cut ? 0 : Math.ceil(fit.height * PR.over)) : null,
    };
};

const STATE_STYLE: Record<string, string> = {
    open: "background:#1a7f37;color:#fff",
    draft: "background:#6e7781;color:#fff",
    merged: "background:#8250df;color:#fff",
    closed: "background:#cf222e;color:#fff",
};

/** A pull request's state as both the PR card and the panel write it: `Merged`. */
const stateText = (state: string): string => `${state[0].toUpperCase()}${state.slice(1)}`;

const PR_CSS = `
.prchip { flex: none; border: 1px solid var(--line); border-radius: 999px; padding: 2px 9px; font: 12px/16px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink2); }
.state { flex: none; border-radius: 999px; padding: 2px 10px; font: 600 12px/16px ui-sans-serif, system-ui, sans-serif; }
main { padding: ${PR.pad}px ${PR.pad}px 0; }
.title { font: 600 20px/${PR.titleLine}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; overflow-wrap: anywhere; }
.title code { padding: .1em .35em; font: 85% ui-monospace, SFMono-Regular, Menlo, monospace; background: rgb(129 139 152 / .12); border-radius: 6px; }
.meta { margin-top: 4px; height: 20px; color: var(--ink2); font-size: 12.5px; line-height: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.unpinned { height: ${PR.unpinned}px; line-height: ${PR.unpinned}px; font-size: 12.5px; color: var(--ink3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rule { margin: 16px 0; border: 0; height: 1px; background: var(--line); }
`;

const prHeader = (review: PrCardInput) => {
    const { pr } = review;
    return `<header><span class="prchip">${escapeHtml(`${pr.ref.owner}/${pr.ref.repo}#${pr.ref.number}`)}</span><span class="state" style="${STATE_STYLE[pr.state]}">${stateText(pr.state)}</span></header>`;
};

const prLead = (review: PrCardInput, titleLines: number | null) => {
    const { pr } = review;
    const unpinned = unpinnedText(review.unpinned);
    const clampCss = titleLines === null ? "" : ` style="max-height:${titleLines * PR.titleLine}px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:${titleLines};-webkit-box-orient:vertical"`;
    return `<h1 class="title"${clampCss}>${segmentsHtml(segments(pr.title))}</h1>
<div class="meta">${escapeHtml(pr.author)} · ${plural(pr.changedFiles, "file")} · <span class="a mono">+${count(pr.additions)}</span> <span class="d mono">−${count(pr.deletions)}</span></div>${unpinned ? `<div class="unpinned">${unpinned}</div>` : ""}`;
};

/**
 * The PR card: the header every card has (the pull request's chip and its
 * state), the title, author and counts, what the board leaves off,
 * then the description as GitHub shows it, cut to fit (`prCard`).
 */
export const prCardHtml = (review: PrCardInput, theme: Theme): string => {
    const m = prCard(review);
    const fade = m.cut ? `.desc::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: ${PR.fade}px; background: linear-gradient(transparent, var(--bg)); }` : "";
    const css = `${CARD_CSS}${PR_CSS}${MARKDOWN_CSS}
.desc { position: relative; max-height: ${m.description}px; overflow: hidden; } ${fade}
.more { height: ${PR.fold}px; line-height: ${PR.fold}px; font: 12px/${PR.fold}px ui-monospace, Menlo, monospace; color: var(--ink3); }
`;
    const description = m.description > 0 ? `<hr class="rule"><div class="desc"><div class="md">${markdownHtml(m.tokens, "card")}</div></div>` : "";
    const more = m.fold !== null ? `<div class="more">${DOTS} <span class="ra">Read all</span></div>` : "";
    return page(css, `${prHeader(review)}<main>${prLead(review, m.titleLines)}${description}${more}</main>`, theme);
};

/** A file's whole diff, unchanged stretches between hunks counted. */
const fileDiffRows = (f: ReviewFile): Row[] => {
    if (!f.hasPatch) return [{ kind: "info", text: "GitHub doesn't show this diff: the file is too large or not text." }];
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
    return lineRows(f.lang, declLines(f, pin.head, pin.from, pin.to, (pin.symbol?.to ?? 0) > pin.to)).map((r) => (r.line.n !== undefined && calls.has(r.line.n) ? { ...r, call: true } : r));
};

/**
 * A page for Read all, and how tall it lays out at a width, estimated as a
 * card's description is, so the overlay is no taller than its page.
 */
export type ReadAllPage = { html: string; height: (width: number) => number };

/**
 * How many rows a line takes in Read all, whose code column is `room` wide
 * less its 12 px of right padding: one, and more for a long line, each part
 * after the first starting under the line's indent plus two columns.
 */
const wrappedRows = (r: Row, room: number): number => {
    if (r.kind !== "line") return 1;
    const text = expandTabs(r.line.text);
    const fits = Math.max(1, Math.floor((room - 12) / CARD.charWidth));
    if (text.length <= fits) return 1;
    const hang = /^ */.exec(text)![0].length + 2;
    return 1 + Math.ceil((text.length - fits) / Math.max(8, fits - hang));
};

/** Room Read all's header keeps on its right for the overlay's `✕`. */
const CLOSE_ROOM = 56;

const READ_ALL_CSS = `
html { overflow: auto; overscroll-behavior: contain; }
body { height: auto; overflow: visible; }
header { position: sticky; top: 0; z-index: 1; padding-right: ${CLOSE_ROOM}px; }
.r { height: auto; min-height: ${CARD.row}px; white-space: pre-wrap; }
.r > code { overflow: visible; text-overflow: clip; overflow-wrap: anywhere; user-select: text; }
.r:hover { box-shadow: inset 0 0 0 999px var(--hover); }
.fold, .gap { padding-left: 14px; }
`;

/**
 * Scrolls Read all to the lines in focus, or the first change, a third of
 * the way down, with a whole row under the header. Runs inside its iframe.
 * Drawdy lays the overlay out after the page starts, which resets the
 * scroll, so it scrolls again on each resize for two seconds, until the
 * reader scrolls, clicks or types. It sets its own scroller's `scrollTop`:
 * `scrollIntoView` would also scroll the pages around the iframe.
 */
const readAllScript = () => {
    const go = () => {
        const target = document.querySelector(".focus") ?? document.querySelector(".r.add, .r.del");
        const root = document.scrollingElement ?? document.documentElement;
        const head = document.querySelector("header")?.getBoundingClientRect().height ?? 0;
        if (!target || root.clientHeight <= 0) return;
        const docTop = (el: Element) => el.getBoundingClientRect().top + root.scrollTop - head;
        const wanted = docTop(target) - (root.clientHeight - head) / 3;
        const row = [...document.querySelectorAll("body > div > div")].find((el) => docTop(el) >= wanted - 0.5);
        root.scrollTop = Math.max(0, row ? docTop(row) : wanted);
    };
    const watch = new ResizeObserver(go);
    watch.observe(document.documentElement);
    const stop = () => watch.disconnect();
    for (const type of ["wheel", "pointerdown", "keydown", "touchstart"]) window.addEventListener(type, stop, { once: true });
    setTimeout(stop, 2000);
    go();
};

/**
 * The PR page's height at `width`: what the card's estimate gives, with the
 * whole title and description. A `<details>` opens on the page but counts
 * as its summary in the estimate, so a description with one takes the
 * overlay's full height.
 */
const prPageHeight = (review: PrCardInput, tokens: readonly MdToken[], width: number): number => {
    if (/<details/i.test(review.pr.body)) return Infinity;
    const inner = width - 2 * PR.pad;
    const titleChars = segments(review.pr.title).reduce((n, s) => n + s.text.length * (s.code ? 1.15 : 1), 0);
    const description = blocksHeight(markdownBlocks(tokens, inner));
    return (
        CARD.header +
        PR.pad +
        Math.max(1, Math.ceil((titleChars * PR.titleChar) / inner)) * PR.titleLine +
        PR.meta +
        (unpinnedText(review.unpinned) ? PR.unpinned : 0) +
        (description > 0 ? PR.rule + description : 0) +
        24
    );
};

const PR_READ_ALL_CSS = `
.md pre { overflow: auto; }
main { padding-bottom: 24px; }
`;

/**
 * Read all for a card: the card's own header, then the whole declaration
 * for a change or context card, the file's diff for a test or file card,
 * or the PR card's title, meta and whole description. Unified, wrapped,
 * changed words marked, opened at `focus` or the first change, in the
 * theme the cards were pinned in.
 */
export const readAllOf = (pin: Pin, review: Pick<Review, "pr" | "files" | "links" | "unpinned">, theme: Theme, focus: number | null): ReadAllPage => {
    if (pin.kind === "pr") {
        const tokens = lexMarkdown(review.pr.body);
        const body = `${prHeader(review)}<main>${prLead(review, null)}${review.pr.body.trim() ? `<hr class="rule"><div class="md">${markdownHtml(tokens, "page")}</div>` : ""}</main>`;
        return { html: page(CARD_CSS + READ_ALL_CSS + PR_CSS + MARKDOWN_CSS + PR_READ_ALL_CSS, body, theme), height: (width) => prPageHeight(review, tokens, width) };
    }
    const file = review.files.find((f) => f.path === pin.path);
    const declFile = declFileOf(pin, review);
    const rows = pin.kind === "change" || pin.kind === "context" ? (declFile ? declarationRows(pin, declFile, review) : []) : file ? fileDiffRows(file) : [];
    const isFocus = (r: Row) => focus !== null && r.kind === "line" && r.line.at === focus;
    const plain = pin.kind === "context";
    const html = rows.map((r) => (isFocus(r) ? rowHtml(r, plain, true).replace('class="r ', 'class="r focus ') : rowHtml(r, plain, true))).join("");
    return {
        html: page(CARD_CSS + READ_ALL_CSS, `${headerHtml(pin)}<div class="${plain ? "plain" : ""}">${html}</div>`, theme, `(${readAllScript.toString()})();`),
        height: (width) => CARD.header + rows.reduce((n, r) => n + wrappedRows(r, width - (plain ? 68 : CARD.gutter)) * CARD.row, 0) + CARD.padBottom,
    };
};

/** Read all while the review loads, or why it couldn't: the card's name in the header, then the line. */
export const readAllMessage = (name: string, text: string, theme: Theme): ReadAllPage => ({
    html: page(
        CARD_CSS + READ_ALL_CSS + ".note { padding: 16px 14px; color: var(--ink2); font-size: 13px; line-height: 18px; }",
        `<header><span class="name">${escapeHtml(name)}</span></header><p class="note">${escapeHtml(text)}</p>`,
        theme
    ),
    // 13 px sans runs about 7 px a character.
    height: (width) => CARD.header + 32 + Math.ceil((text.length * 7) / (width - 28)) * 18,
});
