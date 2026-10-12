/** The routes a link's string may take between two placed cards, in the order they are tried. */

import { rowMiddle, type CardModel } from "../card/grid.ts";
import { inflate, pathClears, pathHits } from "../curve.ts";
import { sortBy, uniqBy } from "../fp.ts";
import type { Lane, Link } from "../model.ts";
import { acrossBends, backBends, hooks, hugs, levelBends, stringPath, throughBends, upBends, type ColumnLane, type Route } from "./bends.ts";
import { LAYOUT } from "./constants.ts";
import { bottom, bottomMiddle, othersThan, right, topMiddle, type Point, type Rect } from "./geometry.ts";

/** Where a string meets a card, as a share of its width and height. */
export type End = { pin: string; anchorX: number; anchorY: number };

/** A route a string may take, and the curve Drawdy draws along it; R1' names the lanes it takes too. */
export type Candidate = { route: Route; from: End; to: End; start: Point; end: Point; bend: Point[]; path: Point[]; lanes?: string[] };

/** What routing reads of a placed board. */
export type RouteBoard = {
    placed: ReadonlyMap<string, Rect>;
    cards: ReadonlyMap<string, CardModel>;
    /** Lanes taken through gaps in the columns, by column and height: strings through one gap run side by side. */
    lanes: ReadonlySet<string>;
};

type Ends = Pick<Candidate, "from" | "to" | "start" | "end">;

const endOn = (pin: string, r: Rect, p: Point): End => ({ pin, anchorX: (p.x - r.x) / r.width, anchorY: (p.y - r.y) / r.height });

const endsOf = (l: Link, A: Rect, B: Rect, start: Point, end: Point): Ends => ({ from: endOn(l.from, A, start), to: endOn(l.to, B, end), start, end });

const candidate = (route: Route, ends: Ends, bend: Point[]): Candidate => ({ route, ...ends, bend, path: stringPath(ends.start, bend, ends.end) });

/** The routes a link may take, in the order they are tried; where its cards stand decides. A card in a row under the flow strings up or down when it can. */
export const routesOf = (board: RouteBoard, l: Link, fromLane: Lane): Candidate[] => {
    const A = board.placed.get(l.from)!;
    const B = board.placed.get(l.to)!;
    const fromRow = fromLane !== "flow";
    const rightward = B.x >= right(A) + LAYOUT.clearance;
    if (fromRow && bottom(B) <= A.y - LAYOUT.clearance) return [verticalRoute(l, A, B), ...(rightward ? acrossRoutes(board, l, A, B) : [])];
    if (rightward) return acrossRoutes(board, l, A, B);
    if (fromRow && B.y >= bottom(A) + LAYOUT.clearance) return [verticalRoute(l, A, B)];
    if (l.kind === "tests" && A.y === B.y && right(B) < A.x) return [flatRoute(l, A, B)];
    return backRoutes(l, A, B);
};

/** Whether a route keeps `clearance` from every card but its own two, makes no hook, and runs along no card's edge. */
export const clears = (placed: ReadonlyMap<string, Rect>, c: Candidate): boolean =>
    !hooks(c.route, c.path, c.start, c.end) && pathClears(c.path, othersThan(placed, c.from.pin, c.to.pin), LAYOUT.clearance) && ![...placed.values()].some((r) => hugs(c.path, r));

/** R2: up to a card above (or down to one below), middle to middle. */
const verticalRoute = (l: Link, A: Rect, B: Rect): Candidate => {
    const up = bottom(B) <= A.y;
    const ends = endsOf(l, A, B, up ? topMiddle(A) : bottomMiddle(A), up ? bottomMiddle(B) : topMiddle(B));
    return candidate("R2", ends, upBends(ends.start, ends.end));
};

/** R1 from the row that makes the link to the target's header, then the same eased level, then R1' detours. */
const acrossRoutes = (board: RouteBoard, l: Link, A: Rect, B: Rect): Candidate[] => {
    const start = { x: right(A), y: A.y + rowMiddle(board.cards.get(l.from)?.anchors[l.id] ?? -1) };
    const end = { x: B.x, y: B.y + LAYOUT.header };
    const ends = endsOf(l, A, B, start, end);
    const direct = candidate("R1", ends, acrossBends(start, end));
    return [direct, candidate("R1", ends, levelBends(start, end)), ...detours(board, l, ends, direct)];
};

/** Cards side by side in x, grouped into the columns they stand in, each top to bottom. */
const columnsOf = (rects: readonly Rect[]): { lo: number; hi: number; cards: Rect[] }[] => {
    const columns: { lo: number; hi: number; cards: Rect[] }[] = [];
    for (const r of sortBy(rects, (r) => r.x)) {
        const last = columns[columns.length - 1];
        if (last && r.x < last.hi) {
            last.hi = Math.max(last.hi, right(r));
            last.cards.push(r);
        } else columns.push({ lo: r.x, hi: right(r), cards: [r] });
    }
    return columns.map((c) => ({ ...c, cards: sortBy(c.cards, (r) => r.y) }));
};

/**
 * Heights a string may run at through a column: side by side in each gap
 * between stacked cards, each lane at least `hug.near` from both cards so it
 * never reads as either card's border (one lane in a 48 gap, one more for
 * every 10 over), and just above or below the column.
 */
const laneSlots = (column: readonly Rect[]): number[] => {
    const { off, lane } = LAYOUT.detour;
    const ys: number[] = [];
    column.slice(1).forEach((r, i) => {
        const room = r.y - bottom(column[i]);
        const middle = (bottom(column[i]) + r.y) / 2;
        for (const k of [0, 1, -1, 2, -2]) if (room / 2 - Math.abs(k * lane) >= LAYOUT.hug.near) ys.push(middle + k * lane);
    });
    for (let k = 0; k < 4; k++) ys.push(column[0].y - off - k * lane, bottom(column[column.length - 1]) + off + k * lane);
    return ys.map((y) => Math.round(y));
};

type Column = { lo: number; hi: number; ideal: number; slots: number[] };

/** The nearest free lane in each column; the nearest above the straight line in each; the nearest below. */
const LANE_PICKS: ((c: Column) => number)[] = [
    (c) => c.slots[0],
    (c) => c.slots.find((y) => y <= c.ideal) ?? c.slots[0],
    (c) => c.slots.find((y) => y >= c.ideal) ?? c.slots[0],
];

/**
 * R1' through the columns R1 runs into: level along a free lane in each,
 * curving between columns. A lane more than `detour.reach` off the straight
 * line would make a long detour, so a column with none leaves no R1'.
 */
const detours = (board: RouteBoard, l: Link, ends: Ends, direct: Candidate): Candidate[] => {
    const { start: a, end: b } = ends;
    const others = othersThan(board.placed, l.from, l.to).filter((r) => r.x > a.x && right(r) < b.x);
    if (!others.some((r) => pathHits(direct.path, inflate(r, LAYOUT.clearance)))) return [];
    const lineY = (x: number) => a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x || 1);
    const columns = columnsOf(others).map((column): Column => {
        const ideal = lineY((column.lo + column.hi) / 2);
        const slots = laneSlots(column.cards).filter((y) => !board.lanes.has(`${column.lo}:${y}`) && Math.abs(y - ideal) <= LAYOUT.detour.reach);
        return { lo: column.lo, hi: column.hi, ideal, slots: sortBy(slots, (y) => Math.abs(y - ideal)) };
    });
    if (columns.some((c) => c.slots.length === 0)) return [];
    const routes = LANE_PICKS.map((pick): Candidate => {
        const through: ColumnLane[] = columns.map((c) => ({ lo: c.lo, hi: c.hi, y: pick(c) }));
        return { ...candidate("R1'", ends, throughBends(a, b, through)), lanes: through.map((t) => `${t.lo}:${t.y}`) };
    });
    return uniqBy(routes, (r) => r.lanes!.join(" "));
};

/** R4: a back link, over both cards from top middle to top middle, else under them. */
const backRoutes = (l: Link, A: Rect, B: Rect): Candidate[] => {
    const over = endsOf(l, A, B, topMiddle(A), topMiddle(B));
    const under = endsOf(l, A, B, bottomMiddle(A), bottomMiddle(B));
    return [
        candidate("R4", over, backBends(over.start, over.end, Math.min(A.y, B.y), -1)),
        candidate("R4", under, backBends(under.start, under.end, Math.max(bottom(A), bottom(B)), 1)),
    ];
};

/** R3: a test right after its card in the bottom row, from its left edge to the card's right edge, both at the header's middle. */
const flatRoute = (l: Link, A: Rect, B: Rect): Candidate => {
    const ends = endsOf(l, A, B, { x: A.x, y: A.y + LAYOUT.header }, { x: right(B), y: B.y + LAYOUT.header });
    return candidate("R3", ends, acrossBends(ends.start, ends.end));
};
