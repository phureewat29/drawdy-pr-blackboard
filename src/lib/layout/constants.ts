import { CARD } from "../card/grid.ts";

/**
 * The board's measures, in canvas units. Documented here rather than on
 * each field: esbuild keeps comments inside object literals, and this
 * object ships twice, in the driver and in the parser worker.
 *
 * - `clearance`: kept between any two cards or labels, and between a string
 *   and any card or label but its own two.
 * - `stack`: from a card's bottom to the next card's top in its column, at
 *   least. `columnGap`: between a band's columns, and right of the PR card.
 * - `roomier`: tried in turn while links find no route. A wider column gap
 *   gives a string room to climb, a taller stack a second lane.
 * - `bandGap`: above every band but the first, and above the bottom row.
 *   `underGap`: from a band's lowest card to the row under it.
 * - `maxDrop`: how far below its band's top a card may go to sit level with
 *   the row that calls it: about one card.
 * - `restSpacing`: between bottom-row cards. `restTestSpacing`: before a test
 *   right after its card, room for a string and its label.
 * - `minRowWidth`: where the bottom row wraps, past the code's left edge,
 *   unless a band is wider.
 * - `label`: font size and height; `flat` and `steep`, from a flat or steep
 *   string to its label's near edge.
 * - `header`: strings meet a card's side at its header's middle.
 * - `sag`: a string across hangs at its middle by `share` of its length,
 *   from `min` to `max`, like string pinned at both ends.
 * - `hug`: a string closer than `near` to any card's edge, its own cards'
 *   too, for `run` or more reads as that card's border.
 * - `detour`: R1' lanes stand `lane` apart, or `off` above or below a
 *   column, at most `reach` off the straight line; the course runs level
 *   `margin` past each column, with a bend every `step`.
 * - `fanIn`: strings of one kind into one card, at most: the nearest.
 * - `colour`: strings within `near` of each other for `run` or more count
 *   as close when colours are handed out.
 * - `sweeps`: passes that reorder each column by its cards' links on both
 *   sides.
 * - `back`: a back link's outer bends stand `lead` beyond the cards, its
 *   middle `top`.
 */
export const LAYOUT = {
    clearance: 8,
    stack: 48,
    columnGap: 160,
    roomier: [
        { gap: 240, stack: 48 },
        { gap: 240, stack: 58 },
    ],
    bandGap: 96,
    underGap: 72,
    maxDrop: 400,
    restSpacing: 48,
    restTestSpacing: 160,
    minRowWidth: 2800,
    label: { size: 16, height: 22, flat: 6, steep: 10 },
    header: CARD.header / 2,
    sag: { share: 0.08, min: 20, max: 48 },
    hug: { near: 24, run: 120 },
    detour: { off: 24, reach: 320, lane: 10, margin: 16, step: 64 },
    fanIn: 3,
    colour: { near: 12, run: 60 },
    sweeps: 4,
    back: { lead: 48, top: 60 },
} as const;
