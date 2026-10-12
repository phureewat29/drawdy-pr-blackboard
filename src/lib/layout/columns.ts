/**
 * Where the cards stand. Each band, one per thread, runs left to right from
 * callers to what they call, each column ordered by where its cards' links
 * pull them; the band's tests and file cards hang in the row under it; every
 * other card fills the bottom row. The PR card stands alone in the first
 * column, however long its description, the code `columnGap` to its right,
 * so a tall PR card never pushes a card down.
 */

import { rowMiddle, type CardModel } from "../card/grid.ts";
import { crossings, pathClears } from "../curve.ts";
import { groupBy, minBy, sortBy, sum } from "../fp.ts";
import type { Link, LinkKind, Pin, Review, ReviewFile } from "../model.ts";
import { crossingsAmong, stringPath, upBends } from "./bends.ts";
import { LAYOUT } from "./constants.ts";
import { bottom, bottomMiddle, othersThan, right, topMiddle, type Rect, type Size } from "./geometry.ts";

/** The gap between columns and between stacked cards: roomier boards widen them. */
export type Spacing = { gap: number; stack: number };

export type Placement = {
    placed: Map<string, Rect>;
    /** Every pin in board order: left to right along each band, the row under it, then the bottom row. */
    order: string[];
};

type Placeable = Pick<Review, "files" | "pins" | "links" | "bands">;

/** A board while its cards are placed. */
type Board = {
    review: Placeable;
    pinOf: (id: string) => Pin;
    sizeOf: (id: string) => Size;
    /** Where a link's string leaves its card, from the card's top. */
    startOf: (l: Link) => number;
    spacing: Spacing;
    /** Where the code starts: right of the PR card. */
    codeLeft: number;
    placed: Map<string, Rect>;
    order: string[];
};

const place = (board: Board, id: string, x: number, y: number, width = board.sizeOf(id).width) =>
    board.placed.set(id, { x: Math.round(x), y: Math.round(y), width, height: board.sizeOf(id).height });

const lowest = (board: Board) => Math.max(0, ...[...board.placed.values()].map(bottom));
const widest = (board: Board) => Math.max(0, ...[...board.placed.values()].map(right));
const middleX = (r: Rect) => r.x + r.width / 2;

/** Links that place a card level with the row that makes them. Context links never place one. */
const FLOW_KINDS: readonly LinkKind[] = ["calls", "uses", "imports"];

/** One band's columns, left to right, and the links between them. */
type Band = {
    columns: number[];
    cardsIn: Record<number, string[]>;
    width: Map<number, number>;
    left: Map<number, number>;
    /** Links between two of the band's columns: the ones that order and place its cards. */
    ties: Link[];
    columnOf: (id: string) => number;
    board: Board;
};

/** Tops of a band's cards, relative to the band's top, by pin id. */
type Tops = ReadonlyMap<string, number>;
/** Each column's cards, top to bottom. */
type Orders = Map<number, readonly string[]>;

const bandOf = (board: Board, members: readonly string[]): Band => {
    const columnOf = (id: string) => board.pinOf(id).column;
    const cardsIn = groupBy(members, columnOf);
    const columns = Object.keys(cardsIn)
        .map(Number)
        .sort((x, y) => x - y);
    const width = new Map(columns.map((c) => [c, Math.max(...cardsIn[c].map((id) => board.sizeOf(id).width))]));
    const left = new Map<number, number>();
    let cursor = board.codeLeft;
    for (const c of columns) {
        left.set(c, cursor);
        cursor += width.get(c)! + board.spacing.gap;
    }
    const ties = board.review.links.filter((l) => FLOW_KINDS.includes(l.kind) && members.includes(l.from) && members.includes(l.to) && columnOf(l.from) !== columnOf(l.to));
    return { columns, cardsIn, width, left, ties, columnOf, board };
};

/** The top that sets `l.to`'s header level with the row `l` leaves its caller from. */
const levelWithCaller = (band: Band, l: Link, top: Tops) => top.get(l.from)! + band.board.startOf(l) - LAYOUT.header;
/** The top that sets the row `l` leaves from level with its callee's header. */
const levelWithCallee = (band: Band, l: Link, top: Tops) => top.get(l.to)! + LAYOUT.header - band.board.startOf(l);

const fromLeft = (band: Band, l: Link, id: string) => l.to === id && band.columnOf(l.from) < band.columnOf(id);

const mean = (xs: readonly number[]): number | null => (xs.length === 0 ? null : sum(xs) / xs.length);

/** Where the rows that call a card from its left would have its top. */
const pullFromLeft = (band: Band, id: string, top: Tops) => mean(band.ties.filter((l) => fromLeft(band, l, id)).map((l) => levelWithCaller(band, l, top)));

/** Where all its links would have it: level with the rows that call it, and its rows level with what they call. */
const pullFromBoth = (band: Band, id: string, top: Tops) =>
    mean(band.ties.flatMap((l) => (l.to === id ? [levelWithCaller(band, l, top)] : l.from === id ? [levelWithCallee(band, l, top)] : [])));

/**
 * Tops for one order of each column, left to right. An entry takes the
 * band's top; any other card's header is level with a row that calls it: of
 * those no more than `maxDrop` below the band's top, the one nearest their
 * mean. A card no such row calls starts at the top and its string slopes, so
 * a long chain of calls doesn't turn into a staircase. Cards in a column are
 * pushed down only as far as `stack` needs.
 */
const topsFor = (band: Band, orders: Orders): Map<string, number> => {
    const top = new Map<string, number>();
    const level = (id: string): number => {
        const levels = band.ties.filter((l) => fromLeft(band, l, id) && top.has(l.from)).map((l) => levelWithCaller(band, l, top));
        const middle = sum(levels) / Math.max(1, levels.length);
        return minBy(
            levels.filter((y) => y <= LAYOUT.maxDrop),
            (y) => Math.abs(y - middle)
        ) ?? 0;
    };
    for (const c of band.columns) {
        let previous = -Infinity;
        for (const id of orders.get(c)!) {
            const t = Math.max(level(id), previous + band.board.spacing.stack);
            top.set(id, t);
            previous = t + band.board.sizeOf(id).height;
        }
    }
    return top;
};

/** How often straight lines between the ties' ends cross: what orders are compared by. */
const tanglesOf = (band: Band, top: Tops): number =>
    crossingsAmong(
        band.ties.map((l) => [
            { x: band.left.get(band.columnOf(l.from))! + band.width.get(band.columnOf(l.from))!, y: top.get(l.from)! + band.board.startOf(l) },
            { x: band.left.get(band.columnOf(l.to))!, y: top.get(l.to)! + LAYOUT.header },
        ]),
        crossings
    );

/** A column sorted by where its cards' links pull them; a card nothing pulls keeps its place. */
const sortedByPull = (ids: readonly string[], pull: (id: string) => number | null, top: Tops): string[] =>
    sortBy(
        ids,
        (id) => pull(id) ?? top.get(id) ?? 0,
        (id) => top.get(id) ?? 0
    );

/** Each column by path, then sorted by the rows that call its cards, column by column from the left. */
const orderByCallers = (band: Band): { orders: Orders; top: Tops } => {
    const { pinOf } = band.board;
    const orders: Orders = new Map(band.columns.map((c) => [c, sortBy(band.cardsIn[c], (id) => pinOf(id).path ?? "", (id) => pinOf(id).from)]));
    let top = topsFor(band, orders);
    for (const c of band.columns) {
        orders.set(c, sortedByPull(orders.get(c)!, (id) => pullFromLeft(band, id, top), top));
        top = topsFor(band, orders);
    }
    return { orders, top };
};

/** A few sweeps by both sides, keeping the order whose strings cross least. */
const untangle = (band: Band, first: { orders: Orders; top: Tops }): { orders: Orders; top: Tops } => {
    let current = { ...first, tangles: tanglesOf(band, first.top) };
    let best = current;
    for (let sweep = 0; sweep < LAYOUT.sweeps && best.tangles > 0; sweep++) {
        const { orders, top } = current;
        const next: Orders = new Map(band.columns.map((c) => [c, sortedByPull(orders.get(c)!, (id) => pullFromBoth(band, id, top), top)]));
        const nextTop = topsFor(band, next);
        current = { orders: next, top: nextTop, tangles: tanglesOf(band, nextTop) };
        if (current.tangles < best.tangles) best = current;
    }
    return best;
};

/** Whether a string from card `id`, placed as it is now, could curve up to `target` clear of every other card. */
const reaches = (board: Board, id: string, target: Rect): boolean => {
    const a = topMiddle(board.placed.get(id)!);
    const z = bottomMiddle(target);
    return a.y > z.y && pathClears(stringPath(a, upBends(a, z), z), othersThan(board.placed, id).filter((r) => r !== target), LAYOUT.clearance);
};

/**
 * The row under a band: its tests, and file cards whose every link goes
 * into it, each centred under the cards it links to when a string can rise
 * from there, else under each of them in turn.
 */
const placeRowUnder = (board: Board, b: number, members: readonly string[]) => {
    const under = board.review.pins.filter((p) => p.lane === "under" && p.band === b);
    if (under.length === 0) return;
    const top = lowest(board) + LAYOUT.underGap;
    const coveredBy = (p: Pin) =>
        sortBy(
            board.review.links.filter((l) => l.from === p.id && members.includes(l.to)).map((l) => board.placed.get(l.to)!),
            (r) => r.x
        );
    const centredUnder = (p: Pin, xs: readonly number[]) => sum(xs) / Math.max(1, xs.length) - board.sizeOf(p.id).width / 2;
    const wantedX = (p: Pin) => centredUnder(p, coveredBy(p).map(middleX));
    let edge = -Infinity;
    for (const p of sortBy(under, wantedX, (p) => p.path ?? "")) {
        const covered = coveredBy(p);
        const spots = [wantedX(p), ...covered.map((r) => centredUnder(p, [middleX(r)]))].map((x) => Math.max(board.codeLeft, x, edge + LAYOUT.restSpacing));
        const rises = (x: number) => {
            place(board, p.id, x, top);
            return covered.some((r) => reaches(board, p.id, r));
        };
        const x = spots.find(rises) ?? spots[0];
        place(board, p.id, x, top);
        board.order.push(p.id);
        edge = x + board.sizeOf(p.id).width;
    }
};

const placeBand = (board: Board, b: number) => {
    const members = board.review.pins.filter((p) => p.lane === "flow" && p.band === b && p.kind !== "pr").map((p) => p.id);
    const floor = b === 0 ? 0 : lowest(board) + LAYOUT.bandGap;
    const band = bandOf(board, members);
    const { orders, top } = untangle(band, orderByCallers(band));
    const cards = band.columns.flatMap((c) => orders.get(c)!);
    const dy = floor - Math.min(...cards.map((id) => top.get(id)!));
    // Column 0, the callers, keeps the code's left edge straight. Cards after it take their column's width,
    // so every string leaves a column from one edge, clear of wider cards above and below.
    for (const id of cards) {
        const c = band.columnOf(id);
        place(board, id, band.left.get(c)!, top.get(id)! + dy, c === 0 ? board.sizeOf(id).width : band.width.get(c)!);
    }
    board.order.push(...cards);
    placeRowUnder(board, b, members);
};

/** Each review's file roles by path, the first file's for a path: a big PR's bottom row ranks thousands of cards. */
const rolesOf = new WeakMap<readonly ReviewFile[], Map<string, ReviewFile["role"]>>();

/** The bottom row's order: code in path order, then docs and config, then generated files. */
export const laneRank = (pin: Pin, files: readonly ReviewFile[]): [number, string, number] => {
    let roles = rolesOf.get(files);
    if (!roles) {
        roles = new Map();
        for (const f of files) if (!roles.has(f.path)) roles.set(f.path, f.role);
        rolesOf.set(files, roles);
    }
    const role = (pin.path === undefined ? undefined : roles.get(pin.path)) ?? "code";
    return [role === "generated" ? 2 : role === "docs" || role === "config" ? 1 : 0, pin.path ?? "", pin.from];
};

/**
 * The bottom row, in `laneRank` order, a test right after the card it
 * covers. It wraps where the widest band ends, or `minRowWidth` past the
 * code's left edge; with no thread, it starts level with the PR card.
 */
const placeBottomRow = (board: Board) => {
    const rest = board.review.pins.filter((p) => p.lane === "rest");
    const rank = (k: number) => (p: Pin) => laneRank(p, board.review.files)[k];
    const ranked = sortBy(rest, rank(0), rank(1), rank(2));
    const covers = (t: Pin) => board.review.links.find((l) => l.from === t.id && l.kind === "tests" && rest.some((p) => p.id === l.to))?.to;
    const sequence = ranked.flatMap((p) => (p.kind === "test" && covers(p) ? [] : [p, ...ranked.filter((t) => t.kind === "test" && covers(t) === p.id)]));
    const rowRight = board.codeLeft + Math.max(LAYOUT.minRowWidth, widest(board) - board.codeLeft);
    let x = board.codeLeft;
    let rowTop = board.placed.size === 0 ? 0 : lowest(board) + LAYOUT.bandGap;
    let rowBottom = rowTop;
    sequence.forEach((p, i) => {
        const size = board.sizeOf(p.id);
        const gap = i > 0 && p.kind === "test" && covers(p) === sequence[i - 1].id ? LAYOUT.restTestSpacing : LAYOUT.restSpacing;
        if (i > 0 && x + gap + size.width > rowRight) {
            rowTop = rowBottom + LAYOUT.restSpacing;
            x = board.codeLeft;
        } else if (i > 0) x += gap;
        place(board, p.id, x, rowTop);
        rowBottom = Math.max(rowBottom, rowTop + size.height);
        x += size.width;
        board.order.push(p.id);
    });
};

export const placeCards = (review: Placeable, cards: ReadonlyMap<string, CardModel>, prSize: Size, spacing: Spacing): Placement => {
    const pins = new Map(review.pins.map((p) => [p.id, p]));
    const pr = review.pins.find((p) => p.kind === "pr");
    const board: Board = {
        review,
        pinOf: (id) => pins.get(id)!,
        sizeOf: (id) => (id === "pr" ? prSize : cards.get(id)!),
        startOf: (l) => rowMiddle(cards.get(l.from)?.anchors[l.id] ?? -1),
        spacing,
        codeLeft: pr ? prSize.width + LAYOUT.columnGap : 0,
        placed: new Map(),
        order: pr ? [pr.id] : [],
    };
    review.bands.forEach((_, b) => placeBand(board, b));
    placeBottomRow(board);
    // The PR card last, so the code's places never depend on it, but before the strings, so they clear it too.
    if (pr) place(board, pr.id, 0, 0);
    return { placed: board.placed, order: board.order };
};
