/** A card's links as words: a string's label, and the panel's link lines. */

import { sortBy } from "../fp.ts";
import type { Link, Pin, Review } from "../model.ts";

/** What a link means, in one word: a context link reads as what its references do. */
export const wordOf = (l: Pick<Link, "kind" | "reads">): "calls" | "uses" | "tests" | "imports" => (l.kind === "context" ? (l.reads ?? "calls") : l.kind);

type Word = ReturnType<typeof wordOf>;

/** How the panel words each kind of link, seen from either end: links into the card first, then links it makes. */
const LINK_WORDS: { kind: Word; into: boolean; word: string }[] = [
    { kind: "calls", into: true, word: "called by" },
    { kind: "uses", into: true, word: "used by" },
    { kind: "tests", into: true, word: "tested by" },
    { kind: "imports", into: true, word: "imported by" },
    { kind: "calls", into: false, word: "calls" },
    { kind: "uses", into: false, word: "uses" },
    { kind: "tests", into: false, word: "tests" },
    { kind: "imports", into: false, word: "imports" },
];

export type LinkGroup = { word: string; links: { link: string; name: string }[] };

/** What the panel calls a card in a link: a file card by its file, so `imported by hono-base.ts`, not `… hono-base.ts imports`. */
const linkName = (pin: Pin | undefined, id: string): string => (pin?.kind === "file" && pin.path ? (pin.path.split("/").pop() ?? pin.path) : (pin?.name ?? id));

/**
 * A card's links, one group per kind, naming every link whether or not its
 * string is drawn. Names follow board order, the order Next walks.
 */
export const linkGroups = (pin: Pick<Pin, "id">, review: Pick<Review, "links" | "pins" | "order">): LinkGroup[] => {
    const nameOf = (id: string) => linkName(review.pins.find((p) => p.id === id), id);
    return LINK_WORDS.map(({ kind, into, word }) => {
        const links = review.links.filter((l) => (into ? l.to : l.from) === pin.id && wordOf(l) === kind).map((l) => ({ link: l.id, card: into ? l.from : l.to }));
        return { word, links: sortBy(links, (l) => review.order.indexOf(l.card)).map((l) => ({ link: l.link, name: nameOf(l.card) })) };
    }).filter((g) => g.links.length > 0);
};
