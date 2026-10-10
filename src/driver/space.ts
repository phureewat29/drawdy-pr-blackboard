import { isDefined } from "../lib/fp.ts";
import { union, type Rect } from "../lib/layout.ts";
import type { Ddp } from "./ddp.ts";

/** Clearance kept around placed content, in canvas units. */
const MARGIN = 240;

const inflate = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by });

/**
 * Where a block shaped like `wanted` can go without covering anything: at
 * `wanted` itself when that is clear, otherwise just right of everything on
 * the board, top-aligned with `wanted`.
 */
export const findFreeSpot = async (ddp: Ddp, wanted: Rect): Promise<{ x: number; y: number }> => {
    const { drawdyElements: inside } = await ddp.call("command:scene:query-rect", {
        rect: inflate(wanted, MARGIN / 2),
        properties: ["type"],
    });
    if (inside.length === 0) return { x: wanted.x, y: wanted.y };
    const { drawdyElements: all } = await ddp.call("command:scene:get-drawdy-elements", {
        properties: ["x", "y", "width", "height"],
    });
    const others = all
        .map(({ x, y, width, height }) => (x === undefined || y === undefined ? null : { x, y, width: width ?? 0, height: height ?? 0 }))
        .filter(isDefined);
    if (others.length === 0) return { x: wanted.x, y: wanted.y };
    const board = union(others);
    return { x: board.x + board.width + MARGIN, y: wanted.y };
};
