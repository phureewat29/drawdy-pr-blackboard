/**
 * Where tests and loose file cards hang, from the links: a test under the
 * first thread whose change cards it covers, a file card whose every link
 * goes into one thread under that thread, so their strings run straight up.
 * Everything else goes to the bottom row.
 */

import { groupBy } from "../fp.ts";
import type { Board, Pin } from "../model.ts";

/** Each id's band, from the first of some cards with it. */
const firstBands = (pins: readonly Pin[]): Map<string, number> => {
    const bands = new Map<string, number>();
    for (const p of pins) if (!bands.has(p.id)) bands.set(p.id, p.band);
    return bands;
};

export const place = (board: Board): Board => {
    const restBand = board.bands.length;
    const flow = board.pins.filter((p) => p.lane === "flow");
    const flowBands = firstBands(flow);
    const codeBands = firstBands(flow.filter((p) => p.kind === "change" || p.kind === "file"));
    const linksFrom = groupBy(board.links, (l) => l.from);
    const rest = (p: Pin): Pin => ({ ...p, lane: "rest", band: restBand });
    return {
        ...board,
        pins: board.pins.map((p): Pin => {
            const links = linksFrom[p.id] ?? [];
            if (p.kind === "test") {
                const bands = links.filter((l) => l.kind === "tests").flatMap((l) => codeBands.get(l.to) ?? []);
                return bands.length > 0 ? { ...p, lane: "under", band: Math.min(...bands) } : rest(p);
            }
            if (p.kind !== "file" || p.lane === "flow") return p;
            const bands = new Set(links.map((l) => flowBands.get(l.to)));
            const [band] = bands;
            return bands.size === 1 && band !== undefined ? { ...p, lane: "under", band } : rest(p);
        }),
    };
};
