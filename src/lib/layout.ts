/**
 * Where everything goes on the investigation board. Coordinates are canvas
 * units relative to the review's top-left corner.
 *
 *   [PR card]   [caller, unchanged]┄▶[entry] ─calls─▶ [callee]   one band per thread,
 *   [its whole ]                                                  callers left
 *   [description]      [test card under what it covers] [imports] the row under it
 *   [          ]   [lone function] ◀─tests─ [test]   [README.md]  the bottom row
 *
 * The PR card stands alone in the first column, however long its
 * description, and the code is laid out 160 to its right, so a tall PR card
 * never pushes a card down.
 *
 * Cards are placed first, each column in the order its links pull it. Then
 * the links, shortest first, get strings: arrows bound to both cards through
 * bend points, which Drawdy draws as a smooth curve (`catmullRomSpline`).
 * Of the routes that clear every other card by 8 and run along no card's
 * edge, the one crossing fewest strings wins, as long as the strings, all
 * told, cross no more often than straight lines would; a link left without
 * a string is listed in the panel only. Labels go last, beside a bend between two bends, which the
 * curve passes through at an angle no drag changes.
 */

import { CARD, pinCard, prCard, rowMiddle, wordOf, type CardModel, type Theme } from "./card.ts";
import { catmullRomSpline, crossings, inflate, nearRun, pathClears, pathHits, smoothstep } from "./curve.ts";
import { sortBy, uniqBy } from "./fp.ts";
import type { Link, LinkKind, Pin, Review, ReviewFile } from "./model.ts";

export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Point = { x: number; y: number };
export type TextSpot = { x: number; y: number; text: string; fontSize: number; width: number; height: number };

export const LAYOUT = {
    /** Room kept between any two cards or labels, and between a string and any card or label but its own two cards. */
    clearance: 8,
    /** Next card in a column: its top at least this far below the previous card's bottom. */
    stack: 48,
    columnGap: 160,
    /**
     * Roomier boards, tried in turn while strings can't find their way: a wider gap between columns gives a string
     * room to climb, a taller one between stacked cards a second lane through it.
     */
    roomier: [
        { gap: 240, stack: 48 },
        { gap: 240, stack: 58 },
    ],
    /** From the lowest card of one band, the row under it included, to the top of the next band or the bottom row. */
    bandGap: 96,
    /** From a band's lowest card to the top of the row under it. */
    underGap: 72,
    /** How far below its band's top a card may go to sit level with the row that calls it: about one card. */
    maxDrop: 400,
    restSpacing: 48,
    /** Room for a string and its label between a bottom-row card and the test right after it. */
    restTestSpacing: 160,
    minRowWidth: 2800,
    /** `flat`: from a flat string to its label's near edge; `steep`: from a steep one. */
    label: { size: 16, height: 22, flat: 6, steep: 10 },
    /** A string meets a card's side at its header's middle. */
    header: CARD.header / 2,
    /** How far a string across hangs at its middle: `share` of its length, no less than `min` and no more than `max`. */
    sag: { share: 0.08, min: 20, max: 48 },
    /** A string may run closer than `near` to a card's edge, its own cards' too, for less than `run`: any longer and it reads as the card's border. */
    hug: { near: 24, run: 120 },
    /**
     * R1' through columns: a lane at least `hug.near` clear of the cards on either side of its gap, or `off` above or below
     * a column, at most `reach` off the straight line; strings in one gap `lane` apart; the course level `margin` beyond each
     * column's edges, a bend every `step`.
     */
    detour: { off: 24, reach: 320, lane: 10, margin: 16, step: 64 },
    /** Strings of one kind into one card, at most: the nearest ones. */
    fanIn: 3,
    /** Strings that run within `near` of each other for `run` or more count as close when colours are handed out. */
    colour: { near: 12, run: 60 },
    /** Passes that reorder each column by where its cards' links pull them from both sides. */
    sweeps: 4,
    /** A back link runs over both cards: its outer bends `lead` above the higher card's top, its middle `top` above. */
    back: { lead: 48, top: 60 },
} as const;

/**
 * String colours, which tell strings apart; the label says what a string
 * means. Okabe-Ito's hues, darkened where they were too light, and a
 * violet, so each reads on Drawdy's light canvas (#f4f4f5, 2.7:1 or more)
 * and dark one (#18181b, 3.4:1 or more), which draws them as given. The
 * violet, which most strings get, reads best on both (3.9:1 and 4.2:1);
 * the order after it puts the hues that differ most, for colour-blind
 * readers too, first. None is the cards' diff green or red.
 */
export const STRING_COLOURS = ["#9163d5", "#da7f00", "#009E73", "#0072B2", "#CC79A7", "#a79300", "#D55E00", "#29a1c1"] as const;

/**
 * Each string colour as the panel's 12 px text, in `STRING_COLOURS`' order,
 * on the panel's background (`#ffffff` light, `#27272a` dark): the string's
 * own colour where it reaches 4.6:1, else the nearest OKLCH lightness that
 * does, its hue kept; then no two closer than the board's two closest
 * strings (orange and vermillion, 0.075 in OKLab), so a name stays nearer
 * its own string than another's. Every pair reads 4.6:1 or more.
 */
export const STRING_TEXT: Record<Theme, readonly string[]> = {
    light: ["#8b5dcf", "#ad6300", "#038561", "#0267a1", "#aa5b88", "#867500", "#a14500", "#017f9c"],
    dark: ["#a578ec", "#ea8e24", "#11a377", "#3a96d8", "#cc79a7", "#a79300", "#e56c1f", "#3dafd0"],
};

export type StringStyle = { color: string; width: number; dash: "solid" | "dashed" };

export type End = { pin: string; anchorX: number; anchorY: number };

/** R1 across, R1' detour, R2 up or down, R3 flat leftward in the bottom row, R4 back over (or under) both cards. */
export type Route = "R1" | "R1'" | "R2" | "R3" | "R4";

export type PlannedString = {
    link: string;
    kind: LinkKind;
    route: Route;
    from: End;
    to: End;
    start: Point;
    end: Point;
    /** Exactly three bend points, in canvas units. */
    bend: Point[];
    /** The curve Drawdy draws: `catmullRomSpline([start, ...bend, end])`. */
    path: Point[];
    label: TextSpot | null;
    style: StringStyle;
};

export type BoardPlan = {
    pins: Map<string, Rect>;
    cards: Map<string, CardModel>;
    /** The links that get a string. */
    strings: PlannedString[];
    /** Links with no clear route: the panel lists them. */
    undrawn: string[];
    /** Every pin in board order: left to right along each band, the row under it, then the bottom row. */
    order: string[];
    bounds: Rect;
};

/** Text width in canvas units, roughly: Drawdy's handwriting face runs a little over half an em a character. */
const textWidth = (text: string, fontSize: number) => Math.ceil([...text].length * fontSize * 0.56) + 4;

export const union = (rects: readonly Rect[]): Rect => {
    const x = Math.min(...rects.map((r) => r.x));
    const y = Math.min(...rects.map((r) => r.y));
    return {
        x,
        y,
        width: Math.max(...rects.map((r) => r.x + r.width)) - x,
        height: Math.max(...rects.map((r) => r.y + r.height)) - y,
    };
};

export const textRect = (t: TextSpot): Rect => ({ x: t.x, y: t.y, width: t.width, height: t.height });

const right = (r: Rect) => r.x + r.width;
const bottom = (r: Rect) => r.y + r.height;

const overlaps = (a: Rect, b: Rect) => a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);

/** The box a polyline spans. */
export const pathRect = (path: readonly Point[]): Rect => union(path.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 })));

/**
 * Colours for the strings: all those leaving one card share its colour, as
 * strings that start together should. Cards whose strings cross, run close
 * together, or meet at one end get different colours where the palette
 * allows: greedy, the cards with the most such neighbours first, then in
 * board order, so a pull request always gets the same colours. Returns
 * each string's colour by link id.
 */
const colourStrings = (strings: readonly PlannedString[], order: readonly string[]): Map<string, string> => {
    const { near, run } = LAYOUT.colour;
    const cards = sortBy([...new Set(strings.map((s) => s.from.pin))], (pin) => order.indexOf(pin));
    const same = (p: Point, q: Point) => Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5;
    const clash = (a: PlannedString, b: PlannedString) => {
        const shared = [a.start, a.end].filter((p) => same(p, b.start) || same(p, b.end));
        return shared.length > 0 || stringCrossings(a, b) > 0 || nearRun(a.path, b.path, near) >= run;
    };
    const neighbours = new Map(cards.map((pin) => [pin, new Set<string>()]));
    strings.forEach((a, i) =>
        strings.slice(i + 1).forEach((b) => {
            if (a.from.pin === b.from.pin || !clash(a, b)) return;
            neighbours.get(a.from.pin)!.add(b.from.pin);
            neighbours.get(b.from.pin)!.add(a.from.pin);
        })
    );
    const colour = new Map<string, number>();
    for (const pin of sortBy(cards, (p) => -neighbours.get(p)!.size, (p) => order.indexOf(p))) {
        const taken = [...neighbours.get(pin)!].flatMap((n) => (colour.has(n) ? [colour.get(n)!] : []));
        const free = STRING_COLOURS.findIndex((_, i) => !taken.includes(i));
        colour.set(pin, free >= 0 ? free : sortBy(STRING_COLOURS.map((_, i) => i), (i) => taken.filter((t) => t === i).length)[0]);
    }
    return new Map(strings.map((s) => [s.link, STRING_COLOURS[colour.get(s.from.pin)!]]));
};

/** Dashed when either end is unchanged code, the one thing a string's look says besides its colour. */
const styleOf = (l: Link, review: Pick<Review, "pins">): StringStyle => ({
    color: STRING_COLOURS[0],
    width: 2,
    dash: review.pins.some((p) => p.kind === "context" && (p.id === l.from || p.id === l.to)) ? "dashed" : "solid",
});

/** Each review's file roles by path, the first file's for a path: a big pull request's bottom row ranks thousands of cards. */
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

/** Links that place a card level with the row that makes them. Context links never place one. */
const FLOW_KINDS: readonly LinkKind[] = ["calls", "uses", "imports"];

const S = smoothstep;
/** Points Drawdy draws for each stretch of a string's curve between two of its points. */
const SPLINE_STEPS = 20;
const STAGES = [0.25, 0.5, 0.75];

/**
 * R1 and R3: even steps along x and a sag at the middle, 8 % of the
 * string's length from 20 to 48, like string pinned at both ends, so
 * strings that share an end meet at their own angles.
 * `level`: a smoothstep in y instead, leaving and arriving level, for a
 * string that must clear the corner of a card beside its start or end, or
 * that would climb along a card's side: level, it climbs mid-gap.
 */
const acrossBends = (a: Point, b: Point, level = false): Point[] => {
    const d = { x: b.x - a.x, y: b.y - a.y };
    const { share, min, max } = LAYOUT.sag;
    const sag = Math.min(max, Math.max(min, Math.hypot(d.x, d.y) * share));
    return STAGES.map((s) => ({ x: a.x + d.x * s, y: a.y + d.y * (level ? S(s) : s) + sag * 4 * s * (1 - s) }));
};

/** R2: even steps along y, a smoothstep in x. */
const upBends = (a: Point, b: Point): Point[] => STAGES.map((s) => ({ x: a.x + (b.x - a.x) * S(s), y: a.y + (b.y - a.y) * s }));

/** The axis a route runs along: vertical for R2, across for the rest. */
const mainAxis = (route: Route): "x" | "y" => (route === "R2" ? "y" : "x");

/** Whether a curve runs more than 2 past either of its ends along its route's main axis: a hook. */
export const hooks = (route: Route, path: readonly Point[], start: Point, end: Point): boolean => {
    const axis = mainAxis(route);
    const lo = Math.min(start[axis], end[axis]) - 2;
    const hi = Math.max(start[axis], end[axis]) + 2;
    return path.some((p) => p[axis] < lo || p[axis] > hi);
};

/** The curve Drawdy draws through a string's ends and bends. */
export const stringPath = (start: Point, bend: readonly Point[], end: Point): Point[] => catmullRomSpline([start, ...bend, end], SPLINE_STEPS);

/** Whether a string runs along one of a card's four edges, closer than `hug.near`, for `hug.run` or more. */
const hugs = (path: readonly Point[], r: Rect): boolean => {
    const [tl, tr, br, bl] = [
        { x: r.x, y: r.y },
        { x: right(r), y: r.y },
        { x: right(r), y: bottom(r) },
        { x: r.x, y: bottom(r) },
    ];
    return [[tl, bl], [tr, br], [tl, tr], [bl, br]].some((edge) => nearRun(path, edge, LAYOUT.hug.near) >= LAYOUT.hug.run);
};

/** How far from an end two strings share their crossings don't count: there they meet, as strings into one point do. */
const MEET = 24;

/** How often two strings cross, between their ends; where they share an end they meet, which is no crossing. */
export const stringCrossings = (a: Pick<PlannedString, "start" | "end" | "path">, b: Pick<PlannedString, "start" | "end" | "path">): number => {
    const same = (p: Point, q: Point) => Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5;
    const shared = [a.start, a.end].filter((p) => same(p, b.start) || same(p, b.end));
    return crossings(a.path, b.path, shared, MEET);
};

type Plannable = Pick<Review, "pr" | "files" | "pins" | "links" | "bands" | "unpinned">;

type Candidate = { route: Route; from: End; to: End; start: Point; end: Point; bend: Point[]; lanes?: string[] };

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
 * between stacked cards, each lane at least `hug.near` from both cards,
 * so it never reads as either card's border (one lane in a 48 gap, one
 * more for every 10 over), and just above or below the column.
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

/**
 * R1' bends: the string's course runs flat along its lane through each
 * column and eases between them on a smoothstep, which starts and ends
 * level, so it never overshoots. Bends sit every `step` along that course:
 * Drawdy's curve through points that close together follows it.
 */
export const throughBends = (a: Point, b: Point, columns: readonly { lo: number; hi: number; y: number }[]): Point[] => {
    const { margin, step } = LAYOUT.detour;
    const course: Point[] = [a];
    /** From `p` to `q`: level at both ends between two columns; straight from the source and into the target, so strings sharing an end meet at their own angles. */
    const leg = (p: Point, q: Point, level: boolean) => {
        for (let x = p.x + 4; x < q.x; x += 4) {
            const s = (x - p.x) / (q.x - p.x);
            course.push({ x, y: p.y + (q.y - p.y) * (level ? smoothstep(s) : s) });
        }
        course.push(q);
    };
    let at = a;
    columns.forEach((c, i) => {
        leg(at, { x: c.lo - margin, y: c.y }, i > 0);
        at = { x: c.hi + margin, y: c.y };
        course.push(at);
    });
    leg(at, b, false);
    const length = course.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - course[i].x, p.y - course[i].y), 0);
    const count = Math.max(3, Math.round(length / step) - 1);
    const bends: Point[] = [];
    let walked = 0;
    for (let i = 1, k = 1; i < course.length && k <= count; i++) {
        const [p, q] = [course[i - 1], course[i]];
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        while (k <= count && walked + d >= (k * length) / (count + 1)) {
            const t = ((k * length) / (count + 1) - walked) / (d || 1);
            bends.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
            k++;
        }
        walked += d;
    }
    return bends;
};

/**
 * The board for a review. Columns stand 160 apart and stacked cards 48;
 * when that leaves a link with no clear route, roomier boards are tried,
 * and the plan that draws the most strings wins, then the one whose strings
 * cross least, then the first tried.
 */
export const planBoard = (review: Plannable): BoardPlan => {
    const tangle = (plan: BoardPlan) => plan.strings.reduce((n, s, i) => n + plan.strings.slice(i + 1).reduce((m, o) => m + stringCrossings(s, o), 0), 0);
    let best = planWith(review, LAYOUT.columnGap, LAYOUT.stack);
    for (const { gap, stack } of LAYOUT.roomier) {
        if (best.undrawn.length === 0) break;
        const roomier = planWith(review, gap, stack);
        if (roomier.undrawn.length < best.undrawn.length || (roomier.undrawn.length === best.undrawn.length && tangle(roomier) < tangle(best))) best = roomier;
    }
    return best;
};

/** The cards Next and Previous walk, in board order: the code, not the PR card, which the panel's Description shows, nor unchanged context. */
export const stepsOf = (review: Pick<Review, "order" | "pins">): string[] =>
    review.order.filter((id) => {
        const kind = review.pins.find((p) => p.id === id)?.kind;
        return kind !== "context" && kind !== "pr";
    });

const planWith = (review: Plannable, gap: number, stack: number): BoardPlan => {
    const L = LAYOUT;
    const pinOf = (id: string) => review.pins.find((p) => p.id === id)!;
    const cards = new Map(review.pins.filter((p) => p.kind !== "pr").map((p) => [p.id, pinCard(p, review)]));
    const prSize = prCard(review);
    const sizeOf = (id: string): Size => {
        const { width, height } = id === "pr" ? prSize : cards.get(id)!;
        return { width, height };
    };
    const pr = review.pins.find((p) => p.kind === "pr");
    /** Where the code starts: 160 right of the PR card, which stands alone in the first column. */
    const codeLeft = pr ? prSize.width + L.columnGap : 0;

    // The code is placed first, without the PR card, so a tall description never pushes a card down.
    const placed = new Map<string, Rect>();
    const order: string[] = pr ? [pr.id] : [];
    const lowest = () => Math.max(0, ...[...placed.values()].map(bottom));
    const widest = () => Math.max(0, ...[...placed.values()].map(right));
    const place = (id: string, x: number, y: number, width = sizeOf(id).width) => placed.set(id, { x: Math.round(x), y: Math.round(y), width, height: sizeOf(id).height });
    const othersThan = (...ids: string[]) => [...placed].filter(([id]) => !ids.includes(id)).map(([, r]) => r);
    const clear = (c: Candidate) => {
        const path = stringPath(c.start, c.bend, c.end);
        return !hooks(c.route, path, c.start, c.end) && pathClears(path, othersThan(c.from.pin, c.to.pin), L.clearance) && ![...placed.values()].some((r) => hugs(path, r));
    };

    const end = (pin: string, r: Rect, p: Point): End => ({ pin, anchorX: (p.x - r.x) / r.width, anchorY: (p.y - r.y) / r.height });
    const topMiddle = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y });
    const bottomMiddle = (r: Rect): Point => ({ x: r.x + r.width / 2, y: bottom(r) });

    /** R2: from a card in a row below up to a card above (or down to one below), middle to middle. */
    const vertical = (l: Link, A: Rect, B: Rect): Candidate => {
        const up = bottom(B) <= A.y;
        const a = up ? topMiddle(A) : bottomMiddle(A);
        const b = up ? bottomMiddle(B) : topMiddle(B);
        return { route: "R2", from: end(l.from, A, a), to: end(l.to, B, b), start: a, end: b, bend: upBends(a, b) };
    };

    /** Lanes taken through gaps in the columns, by column and height: strings through one gap run side by side. */
    const lanes = new Set<string>();

    /**
     * R1, then R1' through the columns R1 runs into: flat along a gap
     * between two stacked cards in each (or just above or below the column),
     * curving between columns. A gap more than `reach` off the straight line
     * would make a long detour, so then the link is left to the panel.
     */
    const across = (l: Link, A: Rect, B: Rect): Candidate[] => {
        const a = { x: right(A), y: A.y + rowMiddle(cards.get(l.from)?.anchors[l.id] ?? -1) };
        const b = { x: B.x, y: B.y + L.header };
        const ends = { from: end(l.from, A, a), to: end(l.to, B, b), start: a, end: b };
        const direct: Candidate = { route: "R1", ...ends, bend: acrossBends(a, b) };
        const level: Candidate = { route: "R1", ...ends, bend: acrossBends(a, b, true) };
        const others = othersThan(l.from, l.to).filter((r) => r.x > a.x && right(r) < b.x);
        if (!others.some((r) => pathHits(stringPath(a, direct.bend, b), inflate(r, L.clearance)))) return [direct, level];
        const lineY = (x: number) => a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x || 1);
        const columns = columnsOf(others).map((column) => {
            const ideal = lineY((column.lo + column.hi) / 2);
            const slots = laneSlots(column.cards).filter((y) => !lanes.has(`${column.lo}:${y}`) && Math.abs(y - ideal) <= L.detour.reach);
            return { ...column, ideal, slots: sortBy(slots, (y) => Math.abs(y - ideal)) };
        });
        if (columns.some((c) => c.slots.length === 0)) return [direct, level];
        // The nearest lane in each column, then the nearest above the straight line in all of them, then below.
        const picks = [
            (c: (typeof columns)[number]) => c.slots[0],
            (c: (typeof columns)[number]) => c.slots.find((y) => y <= c.ideal) ?? c.slots[0],
            (c: (typeof columns)[number]) => c.slots.find((y) => y >= c.ideal) ?? c.slots[0],
        ];
        const routes = picks.map((pick): Candidate => {
            const through = columns.map((c) => ({ lo: c.lo, hi: c.hi, y: pick(c) }));
            return { route: "R1'", ...ends, bend: throughBends(a, b, through), lanes: through.map((t) => `${t.lo}:${t.y}`) };
        });
        return [direct, level, ...uniqBy(routes, (r) => r.lanes!.join(" "))];
    };

    /** R4: a back link, over both cards from top middle to top middle, else under them. */
    const back = (l: Link, A: Rect, B: Rect): Candidate[] =>
        (["over", "under"] as const).map((side) => {
            const a = side === "over" ? topMiddle(A) : bottomMiddle(A);
            const b = side === "over" ? topMiddle(B) : bottomMiddle(B);
            const sign = side === "over" ? -1 : 1;
            const edge = side === "over" ? Math.min(A.y, B.y) : Math.max(bottom(A), bottom(B));
            const inward = (Math.sign(b.x - a.x) * Math.abs(b.x - a.x)) / 8;
            const bend = [
                { x: a.x + inward, y: edge + sign * L.back.lead },
                { x: (a.x + b.x) / 2, y: edge + sign * L.back.top },
                { x: b.x - inward, y: edge + sign * L.back.lead },
            ];
            return { route: "R4", from: end(l.from, A, a), to: end(l.to, B, b), start: a, end: b, bend };
        });

    /** R3: a test right after its card in the bottom row, from its left edge to the card's right edge, both at the header's middle. */
    const flat = (l: Link, A: Rect, B: Rect): Candidate => {
        const a = { x: A.x, y: A.y + L.header };
        const b = { x: right(B), y: B.y + L.header };
        return { route: "R3", from: end(l.from, A, a), to: end(l.to, B, b), start: a, end: b, bend: acrossBends(a, b) };
    };

    /** The routes a link may take, in the order they are tried. Positions decide. */
    const routesOf = (l: Link): Candidate[] => {
        const A = placed.get(l.from)!;
        const B = placed.get(l.to)!;
        const low = pinOf(l.from).lane !== "flow";
        if (low && bottom(B) <= A.y - L.clearance) return [vertical(l, A, B), ...(B.x >= right(A) + L.clearance ? across(l, A, B) : [])];
        if (B.x >= right(A) + L.clearance) return across(l, A, B);
        if (low && B.y >= bottom(A) + L.clearance) return [vertical(l, A, B)];
        if (l.kind === "tests" && A.y === B.y && right(B) < A.x) return [flat(l, A, B)];
        return back(l, A, B);
    };

    // Bands, top to bottom.
    review.bands.forEach((_, b) => {
        const members = review.pins.filter((p) => p.lane === "flow" && p.band === b && p.kind !== "pr").map((p) => p.id);
        const floor = b === 0 ? 0 : lowest() + L.bandGap;
        const columns = new Map<number, string[]>();
        for (const id of members) {
            const c = pinOf(id).column;
            columns.set(c, [...(columns.get(c) ?? []), id]);
        }
        const keys = [...columns.keys()].sort((x, y) => x - y);
        const width = new Map(keys.map((c) => [c, Math.max(...columns.get(c)!.map((id) => sizeOf(id).width))]));
        const left = new Map<number, number>();
        let cursor = codeLeft;
        for (const c of keys) {
            left.set(c, cursor);
            cursor += width.get(c)! + gap;
        }
        const columnOf = (id: string) => pinOf(id).column;
        // Links between two columns of the band: the ones that order and place its cards.
        const ties = review.links.filter((l) => FLOW_KINDS.includes(l.kind) && members.includes(l.from) && members.includes(l.to) && columnOf(l.from) !== columnOf(l.to));
        /** Where a link's string leaves its card, from the card's top. */
        const startOf = (l: Link) => rowMiddle(cards.get(l.from)?.anchors[l.id] ?? -1);

        /**
         * Tops for one order of each column, left to right. An entry takes the
         * band's top; any other card's header is level with a row that calls
         * it: of those no more than `maxDrop` below the band's top, the one
         * nearest their mean. A card no such row calls starts at the top and
         * its string slopes, so a long chain of calls doesn't turn into a
         * staircase. Cards in a column are pushed down only as far as `stack`
         * needs.
         */
        const topsFor = (orders: ReadonlyMap<number, readonly string[]>): Map<string, number> => {
            const top = new Map<string, number>();
            const level = (id: string): number => {
                const levels = ties.filter((l) => l.to === id && columnOf(l.from) < columnOf(id) && top.has(l.from)).map((l) => top.get(l.from)! + startOf(l) - L.header);
                const middle = levels.reduce((a, y) => a + y, 0) / Math.max(1, levels.length);
                return sortBy(
                    levels.filter((y) => y <= L.maxDrop),
                    (y) => Math.abs(y - middle)
                )[0] ?? 0;
            };
            for (const c of keys) {
                let previous = -Infinity;
                for (const id of orders.get(c)!) {
                    const wanted = level(id);
                    const t = Math.max(wanted, previous + stack);
                    top.set(id, t);
                    previous = t + sizeOf(id).height;
                }
            }
            return top;
        };

        /**
         * Where a card's links would have it, from cards on either side: level
         * with the row that calls it, or with its row level with what it
         * calls. Its mean orders its column, so strings run short and parallel.
         */
        const pull = (id: string, top: ReadonlyMap<string, number>, sides: "left" | "both"): number | null => {
            const wants = ties.flatMap((l) => {
                if (l.to === id && (sides === "both" || columnOf(l.from) < columnOf(id))) return [top.get(l.from)! + startOf(l) - L.header];
                if (l.from === id && sides === "both") return [top.get(l.to)! + L.header - startOf(l)];
                return [];
            });
            return wants.length === 0 ? null : wants.reduce((a, y) => a + y, 0) / wants.length;
        };
        /** How often straight lines between the strings' ends cross: what the orders are compared by. */
        const tangles = (top: ReadonlyMap<string, number>): number => {
            const lines = ties.map((l) => [
                { x: left.get(columnOf(l.from))! + width.get(columnOf(l.from))!, y: top.get(l.from)! + startOf(l) },
                { x: left.get(columnOf(l.to))!, y: top.get(l.to)! + L.header },
            ]);
            return lines.reduce((n, a, i) => n + lines.slice(i + 1).reduce((m, b) => m + crossings(a, b), 0), 0);
        };
        const byPath = (ids: readonly string[]) => sortBy(ids, (id) => pinOf(id).path ?? "", (id) => pinOf(id).from);
        /** A column sorted by where its cards' links pull them; a card nothing pulls keeps its place. */
        const sorted = (ids: readonly string[], key: (id: string) => number | null, fallback: ReadonlyMap<string, number>) =>
            sortBy(ids, (id) => key(id) ?? fallback.get(id) ?? 0, (id) => fallback.get(id) ?? 0);

        // First by the rows that call each card, column by column; then a few sweeps by both sides, keeping the order whose strings cross least.
        let orders = new Map(keys.map((c) => [c, byPath(columns.get(c)!)] as const));
        const first = new Map<string, number>();
        for (const c of keys) {
            const sofar = topsFor(orders);
            orders.set(c, sorted(orders.get(c)!, (id) => pull(id, sofar, "left"), first));
            for (const [id, t] of topsFor(orders)) first.set(id, t);
        }
        let top = topsFor(orders);
        let best = { orders, top, tangles: tangles(top) };
        for (let sweep = 0; sweep < L.sweeps && best.tangles > 0; sweep++) {
            orders = new Map(keys.map((c) => [c, sorted(orders.get(c)!, (id) => pull(id, top, "both"), top)] as const));
            top = topsFor(orders);
            const n = tangles(top);
            if (n < best.tangles) best = { orders, top, tangles: n };
        }
        top = best.top;
        const bandOrder = keys.flatMap((c) => best.orders.get(c)!);
        const dy = floor - Math.min(...bandOrder.map((id) => top.get(id)!));
        // Column 0, the callers, keeps the code's left edge straight. Cards after it take their column's width,
        // so every string leaves a column from one edge, clear of wider cards above and below.
        for (const id of bandOrder) place(id, left.get(columnOf(id))!, top.get(id)! + dy, columnOf(id) === 0 ? sizeOf(id).width : width.get(columnOf(id))!);
        order.push(...bandOrder);

        // The row under the band: its tests, and file cards whose every link goes into it.
        const under = review.pins.filter((p) => p.lane === "under" && p.band === b);
        if (under.length === 0) return;
        const cardTop = lowest() + L.underGap;
        const coveredBy = (p: Pin) => sortBy(review.links.filter((l) => l.from === p.id && members.includes(l.to)).map((l) => placed.get(l.to)!), (r) => r.x);
        const centredUnder = (p: Pin, xs: readonly number[]) => xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length) - sizeOf(p.id).width / 2;
        const wantedX = (p: Pin) => centredUnder(p, coveredBy(p).map((r) => r.x + r.width / 2));
        /** Whether a string from the card, placed as it is now, could curve up to `target` clear of every other card. */
        const reaches = (p: Pin, target: Rect) => {
            const card = placed.get(p.id)!;
            const a = topMiddle(card);
            const z = bottomMiddle(target);
            return a.y > z.y && pathClears(stringPath(a, upBends(a, z), z), othersThan(p.id).filter((r) => r !== target), L.clearance);
        };
        let edge = -Infinity;
        for (const p of sortBy(under, wantedX, (p) => p.path ?? "")) {
            // Centred under its cards when a string can run from there; else under each of them in turn.
            const covered = coveredBy(p);
            const spots = [wantedX(p), ...covered.map((r) => centredUnder(p, [r.x + r.width / 2]))].map((x) => Math.max(codeLeft, x, edge + L.restSpacing));
            const x =
                spots.find((x) => {
                    place(p.id, x, cardTop);
                    return covered.some((r) => reaches(p, r));
                }) ?? spots[0];
            place(p.id, x, cardTop);
            order.push(p.id);
            edge = x + sizeOf(p.id).width;
        }
    });

    const rest = review.pins.filter((p) => p.lane === "rest");
    if (rest.length > 0) {
        const ranked = sortBy(
            rest,
            (p) => laneRank(p, review.files)[0],
            (p) => laneRank(p, review.files)[1],
            (p) => laneRank(p, review.files)[2]
        );
        // A test whose covered card is in the row sits right after it.
        const covers = (t: Pin) => review.links.find((l) => l.from === t.id && l.kind === "tests" && rest.some((p) => p.id === l.to))?.to;
        const sequence: Pin[] = [];
        for (const p of ranked) {
            if (p.kind === "test" && covers(p)) continue;
            sequence.push(p, ...ranked.filter((t) => t.kind === "test" && covers(t) === p.id));
        }
        // The row wraps where the widest band ends, or 2800 past the code's left edge; with no thread, it starts level with the PR card.
        const rowRight = codeLeft + Math.max(L.minRowWidth, widest() - codeLeft);
        let x = codeLeft;
        let rowTop = placed.size === 0 ? 0 : lowest() + L.bandGap;
        let rowBottom = rowTop;
        sequence.forEach((p, i) => {
            const size = sizeOf(p.id);
            const gap = i > 0 && p.kind === "test" && covers(p) === sequence[i - 1].id ? L.restTestSpacing : L.restSpacing;
            if (i > 0 && x + gap + size.width > rowRight) {
                rowTop = rowBottom + L.restSpacing;
                x = codeLeft;
            } else if (i > 0) x += gap;
            place(p.id, x, rowTop);
            rowBottom = Math.max(rowBottom, rowTop + size.height);
            x += size.width;
            order.push(p.id);
        });
    }

    // The PR card at the board's top-left corner, placed before the strings so they clear it too.
    if (pr) place(pr.id, 0, 0);

    // Strings: the first route that clears, for every link between two placed cards.
    const rank = (id: string) => order.indexOf(id);
    const distance = (l: Link) => {
        const [A, B] = [placed.get(l.from)!, placed.get(l.to)!];
        return Math.hypot(A.x + A.width / 2 - B.x - B.width / 2, A.y + A.height / 2 - B.y - B.height / 2);
    };
    // Shortest first: near links make the strings that read best, so they are drawn before far ones are weighed against them.
    const links = sortBy(
        review.links.filter((l) => placed.has(l.from) && placed.has(l.to)),
        distance,
        (l) => rank(l.from),
        (l) => rank(l.to)
    );
    // Past `fanIn` strings of one kind into one card (a type every handler uses), the far ones would only tangle: the panel lists them.
    const groups = new Map<string, Link[]>();
    for (const l of links) groups.set(`${l.to} ${l.kind}`, [...(groups.get(`${l.to} ${l.kind}`) ?? []), l]);
    const crowd = new Set([...groups.values()].flatMap((group) => sortBy(group, distance).slice(L.fanIn).map((l) => l.id)));
    // From the row under, a string rises to a card above its own card, the two overlapping in x: one running sideways would cross the board, so it waits, and the panel lists it unless its card would have no string at all.
    const sideways = (l: Link) => {
        if (pinOf(l.from).lane !== "under") return false;
        const [A, B] = [placed.get(l.from)!, placed.get(l.to)!];
        return !(A.x < B.x + B.width && B.x < A.x + A.width);
    };
    const strings: PlannedString[] = [];
    const undrawn: string[] = [];
    const tangle = { curved: 0, straight: 0 };
    /** Draws a link's string when one of its routes clears, within the crossing budget. */
    const draw = (l: Link): boolean => {
        const crossed = (c: Candidate) => {
            const path = stringPath(c.start, c.bend, c.end);
            return strings.reduce((n, o) => n + stringCrossings({ ...c, path }, o), 0);
        };
        const straight = (c: Candidate) => strings.reduce((n, o) => n + crossings([c.start, c.end], [o.start, o.end]), 0);
        // Of the routes that clear, the one crossing the fewest strings already drawn; the earliest of equals.
        const clearRoutes = routesOf(l).filter(clear);
        const found = clearRoutes.length <= 1 ? clearRoutes[0] : sortBy(clearRoutes, crossed)[0];
        // Strings may cross each other no more often, all told, than straight lines between the same ends would: past that, a link is listed in the panel.
        if (!found || tangle.curved + crossed(found) > tangle.straight + straight(found)) return false;
        const { lanes: taken = [], ...route } = found;
        taken.forEach((lane) => lanes.add(lane));
        tangle.curved += crossed(found);
        tangle.straight += straight(found);
        strings.push({ link: l.id, kind: l.kind, ...route, path: stringPath(found.start, found.bend, found.end), label: null, style: styleOf(l, review) });
        return true;
    };
    const held: Link[] = [];
    for (const l of links) {
        if (crowd.has(l.id)) undrawn.push(l.id);
        else if (sideways(l)) held.push(l);
        else if (!draw(l)) undrawn.push(l.id);
    }
    // A row-under card left with no string keeps one, its shortest sideways link that routes: a card with links never stands alone.
    const tied = (id: string) => strings.some((s) => s.from.pin === id || s.to.pin === id);
    for (const l of held) if (tied(l.from) || !draw(l)) undrawn.push(l.id);

    // Labels: beside a middle bend of each string, clear of every card, label and other string by 8, else none.
    const labels: TextSpot[] = [];
    for (const s of strings) {
        const text = wordOf(review.links.find((l) => l.id === s.link)!);
        const w = textWidth(text, L.label.size);
        const h = L.label.height;
        const boxes = [...placed.values(), ...labels.map(textRect)];
        const others = strings.filter((o) => o !== s);
        /** Beside bend `i`: its neighbours are bends too, so a drag, which moves only the ends, leaves the curve there as it is. */
        const besideBend = (i: number): TextSpot[] => {
            const [before, middle, after] = [s.bend[i - 1], s.bend[i], s.bend[i + 1]];
            const at = (i + 1) * SPLINE_STEPS;
            /** The stretch of the curve around the bend that lies within `lo`..`hi` along `axis`. */
            const near = (lo: number, hi: number, axis: "x" | "y") => {
                const inside = (k: number) => k >= 0 && k < s.path.length && s.path[k][axis] >= lo - 2 && s.path[k][axis] <= hi + 2;
                let first = at;
                let last = at;
                while (inside(first - 1)) first--;
                while (inside(last + 1)) last++;
                return s.path.slice(first, last + 1);
            };
            const spots: Point[] = [];
            if (Math.abs(after.y - before.y) > Math.abs(after.x - before.x)) {
                const y = middle.y - h / 2;
                const xs = near(y, y + h, "y").map((p) => p.x);
                spots.push({ x: Math.max(middle.x, ...xs) + L.label.steep, y }, { x: Math.min(middle.x, ...xs) - L.label.steep - w, y });
            } else {
                const x = middle.x - w / 2;
                const ys = near(x, x + w, "x").map((p) => p.y);
                spots.push({ x, y: Math.min(middle.y, ...ys) - L.label.flat - h }, { x, y: Math.max(middle.y, ...ys) + L.label.flat });
            }
            return spots.map((p): TextSpot => ({ x: Math.round(p.x), y: Math.round(p.y), text, fontSize: L.label.size, width: w, height: h }));
        };
        // The middle bend first, then outward: a string through columns has many.
        const middle = (s.bend.length - 1) / 2;
        const bends = sortBy(
            s.bend.map((_, i) => i).filter((i) => i > 0 && i < s.bend.length - 1),
            (i) => Math.abs(i - middle)
        );
        const found = bends.flatMap(besideBend).find((t) => {
            const r = textRect(t);
            const padded = inflate(r, L.clearance);
            return boxes.every((b) => !overlaps(padded, b)) && others.every((o) => !pathHits(o.path, padded)) && !pathHits(s.path, inflate(r, 2));
        });
        if (!found) continue;
        s.label = found;
        labels.push(found);
    }

    const colours = colourStrings(strings, order);
    for (const s of strings) s.style = { ...s.style, color: colours.get(s.link)! };

    return {
        pins: placed,
        cards,
        strings,
        undrawn,
        order,
        bounds: union([...placed.values(), ...labels.map(textRect), ...strings.map((s) => pathRect(s.path))]),
    };
};

/** The plan moved so its top-left corner sits at `to`. */
export const shiftPlan = (plan: BoardPlan, to: Point): BoardPlan => {
    const dx = to.x - plan.bounds.x;
    const dy = to.y - plan.bounds.y;
    const r = <T extends Point>(v: T): T => ({ ...v, x: v.x + dx, y: v.y + dy });
    return {
        ...plan,
        pins: new Map([...plan.pins].map(([id, rect]) => [id, r(rect)])),
        strings: plan.strings.map((s) => ({ ...s, start: r(s.start), end: r(s.end), bend: s.bend.map(r), path: s.path.map(r), label: s.label && r(s.label) })),
        bounds: r(plan.bounds),
    };
};
