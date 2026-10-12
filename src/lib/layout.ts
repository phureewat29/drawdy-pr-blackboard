/**
 * Where everything goes on the investigation board. Coordinates are canvas
 * units relative to the review's top-left corner.
 *
 *   [PR card]   [caller, unchanged]┄▶[entry] ─calls─▶ [callee]   one band per thread,
 *   [its whole ]                                                  callers left
 *   [description]      [test card under what it covers] [imports] the row under it
 *   [          ]   [lone function] ◀─tests─ [test]   [README.md]  the bottom row
 *
 * Cards are placed first (`layout/columns.ts`). Then the links, shortest
 * first, get strings (`layout/strings.ts`): arrows bound to both cards
 * through bend points, which Drawdy draws as a smooth curve. Labels go last,
 * beside a bend (`layout/labels.ts`).
 */

import { pinCard, prCard } from "./card.ts";
import type { CardModel } from "./card/grid.ts";
import { crossingsAmong, stringCrossings } from "./layout/bends.ts";
import { colourStrings } from "./layout/colours.ts";
import { placeCards, type Spacing } from "./layout/columns.ts";
import { LAYOUT } from "./layout/constants.ts";
import { pathRect, textRect, union, type Point, type Rect, type Size, type TextSpot } from "./layout/geometry.ts";
import { labelStrings } from "./layout/labels.ts";
import { drawStrings, type DrawnString } from "./layout/strings.ts";
import type { Review } from "./model.ts";

export { STRING_COLOURS, STRING_TEXT } from "./layout/colours.ts";
export { laneRank } from "./layout/columns.ts";
export { pathRect, union, type Point, type Rect, type Size } from "./layout/geometry.ts";

export type StringStyle = { color: string; width: number; dash: "solid" | "dashed" };

export type PlannedString = DrawnString & { label: TextSpot | null; style: StringStyle };

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

type Plannable = Pick<Review, "pr" | "files" | "pins" | "links" | "bands" | "unpinned">;

/** Dashed when either end is unchanged code, the one thing a string's look says besides its colour. */
const styleOf = (s: DrawnString, color: string, review: Pick<Review, "pins">): StringStyle => ({
    color,
    width: 2,
    dash: review.pins.some((p) => p.kind === "context" && (p.id === s.from.pin || p.id === s.to.pin)) ? "dashed" : "solid",
});

const planWith = (review: Plannable, cards: Map<string, CardModel>, prSize: Size, spacing: Spacing): BoardPlan => {
    const { placed, order } = placeCards(review, cards, prSize, spacing);
    const { strings, undrawn } = drawStrings(review, cards, placed, order);
    const labels = labelStrings(strings, review.links, [...placed.values()]);
    const colours = colourStrings(strings, order);
    return {
        pins: placed,
        cards,
        strings: strings.map((s, i) => ({ ...s, label: labels[i], style: styleOf(s, colours.get(s.link)!, review) })),
        undrawn,
        order,
        bounds: union([...placed.values(), ...labels.flatMap((t) => (t ? [textRect(t)] : [])), ...strings.map((s) => pathRect(s.path))]),
    };
};

/**
 * The board for a review. While links find no clear route, roomier boards are tried: the plan that draws the most strings wins,
 * then the one whose strings cross least, then the first.
 */
export const planBoard = (review: Plannable): BoardPlan => {
    const cards = new Map(review.pins.filter((p) => p.kind !== "pr").map((p) => [p.id, pinCard(p, review)]));
    const prSize = prCard(review);
    const tangle = (plan: BoardPlan) => crossingsAmong(plan.strings, stringCrossings);
    let best = planWith(review, cards, prSize, { gap: LAYOUT.columnGap, stack: LAYOUT.stack });
    for (const spacing of LAYOUT.roomier) {
        if (best.undrawn.length === 0) break;
        const roomier = planWith(review, cards, prSize, spacing);
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
