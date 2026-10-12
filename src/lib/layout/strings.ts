/**
 * Which links get a string, and the route each takes. Of a link's routes
 * that clear, the one crossing fewest strings wins, as long as the strings,
 * all told, cross no more often than straight lines would. A link left
 * without a string is listed in the panel only.
 */

import type { CardModel } from "../card/grid.ts";
import { crossings } from "../curve.ts";
import { groupBy, minBy, sortBy, sumBy } from "../fp.ts";
import type { Lane, Link, LinkKind, Review } from "../model.ts";
import { stringCrossings, type Route } from "./bends.ts";
import { LAYOUT } from "./constants.ts";
import type { Point, Rect } from "./geometry.ts";
import { clears, routesOf, type Candidate, type End } from "./routes.ts";

/** A string before its label and colour: its route, and the curve Drawdy draws through its ends and bends. */
export type DrawnString = {
    link: string;
    kind: LinkKind;
    route: Route;
    from: End;
    to: End;
    start: Point;
    end: Point;
    /** Three bend points, or one every `detour.step` for R1'. */
    bend: Point[];
    /** `catmullRomSpline([start, ...bend, end])`. */
    path: Point[];
};

const centreDistance = (A: Rect, B: Rect) => Math.hypot(A.x + A.width / 2 - B.x - B.width / 2, A.y + A.height / 2 - B.y - B.height / 2);

/** Shortest first: near links make the strings that read best, so they are drawn before far ones are weighed against them. */
const nearestFirst = (links: readonly Link[], placed: ReadonlyMap<string, Rect>, order: readonly string[]): Link[] =>
    sortBy(
        links.filter((l) => placed.has(l.from) && placed.has(l.to)),
        (l) => centreDistance(placed.get(l.from)!, placed.get(l.to)!),
        (l) => order.indexOf(l.from),
        (l) => order.indexOf(l.to)
    );

/** Past `fanIn` strings of one kind into one card (a type every handler uses), the far ones would only tangle. */
const pastFanIn = (links: readonly Link[]): Set<string> =>
    new Set(Object.values(groupBy(links, (l) => `${l.to} ${l.kind}`)).flatMap((group) => group.slice(LAYOUT.fanIn).map((l) => l.id)));

/** Whether two cards share no stretch of x, so a string between them runs sideways. */
const apart = (A: Rect, B: Rect) => !(A.x < B.x + B.width && B.x < A.x + A.width);

export const drawStrings = (
    review: Pick<Review, "pins" | "links">,
    cards: ReadonlyMap<string, CardModel>,
    placed: ReadonlyMap<string, Rect>,
    order: readonly string[]
): { strings: DrawnString[]; undrawn: string[] } => {
    const laneOf = new Map<string, Lane>(review.pins.map((p) => [p.id, p.lane]));
    const lanes = new Set<string>();
    const board = { placed, cards, lanes };
    const strings: DrawnString[] = [];
    const undrawn: string[] = [];
    const curvedCrossings = (c: Candidate) => sumBy(strings, (o) => stringCrossings(c, o));
    const straightCrossings = (c: Candidate) => sumBy(strings, (o) => crossings([c.start, c.end], [o.start, o.end]));
    /** Crossings so far: the strings' may never outnumber those of straight lines between the same ends. */
    const tally = { curved: 0, straight: 0 };

    const draw = (l: Link): boolean => {
        const found = minBy(routesOf(board, l, laneOf.get(l.from)!).filter((c) => clears(placed, c)), curvedCrossings);
        if (!found) return false;
        const curved = curvedCrossings(found);
        const straight = straightCrossings(found);
        if (tally.curved + curved > tally.straight + straight) return false;
        tally.curved += curved;
        tally.straight += straight;
        const { lanes: taken = [], ...route } = found;
        for (const lane of taken) lanes.add(lane);
        strings.push({ link: l.id, kind: l.kind, ...route });
        return true;
    };

    // From the row under, a string rises to a card above its own card; one running sideways would cross the board, so it waits.
    const held: Link[] = [];
    const links = nearestFirst(review.links, placed, order);
    const crowded = pastFanIn(links);
    for (const l of links) {
        if (crowded.has(l.id)) undrawn.push(l.id);
        else if (laneOf.get(l.from) === "under" && apart(placed.get(l.from)!, placed.get(l.to)!)) held.push(l);
        else if (!draw(l)) undrawn.push(l.id);
    }
    // A card with links never stands alone: one left with no string keeps its shortest sideways link that routes.
    const tied = (id: string) => strings.some((s) => s.from.pin === id || s.to.pin === id);
    for (const l of held) if (tied(l.from) || !draw(l)) undrawn.push(l.id);
    return { strings, undrawn };
};
