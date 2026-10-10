import { catmullRomSpline } from "../lib/curve.ts";
import type { Point, Rect } from "../lib/layout.ts";
import type { Ddp } from "./ddp.ts";
import { markOf, type BoardMark } from "./elements.ts";

export type Marked = { id: string; mark: BoardMark };

/** Every PR Blackboard element on the board, grouped by pull request. */
export const readBoard = async (ddp: Ddp): Promise<Map<string, Marked[]>> => {
    const { drawdyElements } = await ddp.call("command:scene:get-drawdy-elements", { properties: ["meta"] });
    const byPr = new Map<string, Marked[]>();
    for (const e of drawdyElements) {
        const mark = markOf(e.meta);
        if (mark) byPr.set(mark.pr, [...(byPr.get(mark.pr) ?? []), { id: e.id, mark }]);
    }
    return byPr;
};

export type Clicked = Marked & { rect: Rect; path: Point[] | null };

/**
 * The one read a click costs: the clicked elements with their marks, where
 * they are now, and, for a string, the curve it draws. Elements that aren't
 * PR Blackboard's are left out.
 */
export const readClicked = async (ddp: Ddp, ids: readonly string[]): Promise<Clicked[]> => {
    if (ids.length === 0) return [];
    const found = await ddp.tryCall("command:scene:get-drawdy-elements", {
        properties: ["meta", "x", "y", "width", "height", "points"],
        drawdyElementIds: [...ids],
    });
    return (found?.drawdyElements ?? []).flatMap((e): Clicked[] => {
        const mark = markOf(e.meta);
        if (!mark || e.x === undefined || e.y === undefined) return [];
        return [{ id: e.id, mark, rect: { x: e.x, y: e.y, width: e.width ?? 0, height: e.height ?? 0 }, path: e.points ? curveOf(e.points) : null }];
    });
};

/** Where elements are now: people move cards around. Missing ids are left out. */
export const rectsOf = async (ddp: Ddp, ids: readonly string[]): Promise<Map<string, Rect>> => {
    if (ids.length === 0) return new Map();
    const found = await ddp.tryCall("command:scene:element-rects", { drawdyElementIds: [...ids] });
    return new Map((found?.rects ?? []).map((r) => [r.drawdyElementId, r.rect]));
};

/**
 * The curve a string draws, from its live points: Drawdy keeps them as
 * `[start, end, ...bend]` and draws a spline through `[start, ...bend, end]`.
 */
const curveOf = (points: readonly (readonly [number, number])[]): Point[] | null => {
    if (points.length < 2) return null;
    const [start, end, ...bend] = points.map(([x, y]) => ({ x, y }));
    return catmullRomSpline([start, ...bend, end], 20);
};

/** Whether a pull request's board for this head commit is on the board already. */
export const pinnedAt = (elements: readonly Marked[], sha: string): boolean => elements.some((e) => e.mark.sha === sha && e.mark.part === "pr");
