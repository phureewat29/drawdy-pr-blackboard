import type { Theme } from "../card/html.ts";
import { nearRun } from "../curve.ts";
import { minBy, sortBy } from "../fp.ts";
import { sharedEnds, stringCrossings } from "./bends.ts";
import { LAYOUT } from "./constants.ts";
import type { DrawnString } from "./strings.ts";

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

/** Each card's neighbours: the cards whose strings cross its strings, run close to them, or meet them at an end. */
const neighboursOf = (strings: readonly DrawnString[], cards: readonly string[]): Map<string, Set<string>> => {
    const { near, run } = LAYOUT.colour;
    const clash = (a: DrawnString, b: DrawnString) => sharedEnds(a, b).length > 0 || stringCrossings(a, b) > 0 || nearRun(a.path, b.path, near) >= run;
    const neighbours = new Map(cards.map((pin) => [pin, new Set<string>()]));
    strings.forEach((a, i) =>
        strings.slice(i + 1).forEach((b) => {
            if (a.from.pin === b.from.pin || !clash(a, b)) return;
            neighbours.get(a.from.pin)!.add(b.from.pin);
            neighbours.get(b.from.pin)!.add(a.from.pin);
        })
    );
    return neighbours;
};

/** The first colour no neighbour has, else the one fewest have. */
const freeColour = (taken: readonly number[]): number => {
    const colours = STRING_COLOURS.map((_, i) => i);
    return colours.find((i) => !taken.includes(i)) ?? minBy(colours, (i) => taken.filter((t) => t === i).length)!;
};

/**
 * Each string's colour by link id. Strings leaving one card share its colour; neighbouring cards get different ones while the
 * palette lasts: greedy, the cards with the most neighbours first, then in board order, so a PR always gets the same colours.
 */
export const colourStrings = (strings: readonly DrawnString[], order: readonly string[]): Map<string, string> => {
    const cards = sortBy([...new Set(strings.map((s) => s.from.pin))], (pin) => order.indexOf(pin));
    const neighbours = neighboursOf(strings, cards);
    const colour = new Map<string, number>();
    for (const pin of sortBy(cards, (p) => -neighbours.get(p)!.size, (p) => order.indexOf(p))) {
        const taken = [...neighbours.get(pin)!].flatMap((n) => (colour.has(n) ? [colour.get(n)!] : []));
        colour.set(pin, freeColour(taken));
    }
    return new Map(strings.map((s) => [s.link, STRING_COLOURS[colour.get(s.from.pin)!]]));
};
