/**
 * The card limit: which cards a board keeps when it has more than it holds,
 * and what that leaves off.
 *
 * The cards go in the order they fill the board: the PR card; each thread,
 * largest first, with its context card and tests, its cards nearest the
 * entry first; then the bottom row, code before docs and config before
 * generated files, the largest changes first. The order runs band by band,
 * so the bands left are always the first ones.
 *
 * Cards nearest the entries share no string when a thread has more entries
 * than the board has room, so two more orders are tried: a part of each
 * thread, largest first, of at most `LIMITS.part` cards, grown from its
 * entries along what they link to; and such parts grown along calls alone,
 * the parts sharing the most calls first. The order whose cards share more
 * calls fills the board, then the one sharing more links: calls outrank
 * type uses, which can join a whole file's declarations into one thread.
 * On a tie, the first.
 */

import { groupBy, sortBy, sumBy } from "../fp.ts";
import { laneRank } from "../layout.ts";
import type { Board, Pin, Review, ReviewFile } from "../model.ts";
import { adjacency } from "./threads.ts";

/** Cards a board holds at most, the PR card and context cards included; and the most one thread's part takes when threads overflow it. */
export const LIMITS = { cards: 32, part: 8 } as const;

/** The board's first `LIMITS.cards` cards, in the order that fills it best. */
export const limit = (board: Board, files: readonly ReviewFile[]): Board => (board.pins.length <= LIMITS.cards ? board : keepOnly(board, bestCut(board, files)));

/** The ids of the cards the best order puts first. */
const bestCut = ({ pins, bands, links }: Board, files: readonly ReviewFile[]): Set<string> => {
    const index = new Map(pins.map((p, i) => [p.id, i]));
    const inBand = groupBy(pins, (p) => p.band);
    /** A band's cards in its flow, by column. */
    const flow = (b: number) =>
        sortBy(
            (inBand[b] ?? []).filter((p) => p.lane === "flow" && p.kind !== "pr" && p.kind !== "context"),
            (p) => p.column,
            (p) => index.get(p.id)!
        );
    /** A band's context card, then the cards under it. */
    const tail = (b: number) => {
        const band = inBand[b] ?? [];
        return [...band.filter((p) => p.kind === "context"), ...band.filter((p) => p.lane === "under")];
    };
    const ranks = new Map(pins.filter((p) => p.lane === "rest").map((p) => [p.id, laneRank(p, files)]));
    const rank = (p: Pin) => ranks.get(p.id)!;
    const rest = sortBy(
        pins.filter((p) => p.lane === "rest"),
        (p) => rank(p)[0],
        (p) => -(p.add + p.del),
        (p) => rank(p)[1],
        (p) => rank(p)[2]
    );
    const nearest = [pins[0], ...bands.flatMap((_, b) => [...flow(b), ...tail(b)]), ...rest];

    // The cards each card links to, the ones it calls, and the cards it shares a link with, either way.
    const linksTo = adjacency(links);
    const callsTo = adjacency(links.filter((l) => l.kind === "calls"));
    const linked = adjacency([...links, ...links.map((l) => ({ from: l.to, to: l.from }))]);
    type Via = Record<string, string[]>;
    /** How many of the edges along `via` both ends of are among some cards. */
    const shared = (ids: ReadonlySet<string>, via: Via) => sumBy([...ids], (id) => (via[id] ?? []).filter((x) => ids.has(x)).length);
    /** Adds an entry and what it links to, breadth first, the three that link most first, while `tree` holds fewer than `LIMITS.part`. */
    const grow = (entry: Pin, members: ReadonlySet<string>, tree: Set<string>, via: Via) => {
        const queue = [entry.id];
        const seen = new Set<string>();
        while (queue.length > 0 && tree.size < LIMITS.part) {
            const id = queue.shift()!;
            if (seen.has(id)) continue;
            seen.add(id);
            tree.add(id);
            const next = (via[id] ?? []).filter((x) => members.has(x) && !seen.has(x));
            queue.push(
                ...sortBy(
                    next,
                    (x) => -(via[x]?.length ?? 0),
                    (x) => index.get(x)!
                ).slice(0, 3)
            );
        }
        return tree;
    };
    /** A band's first column. */
    const firstColumn = (members: Pin[]) => {
        const first = Math.min(...members.map((p) => p.column));
        return members.filter((p) => p.column === first);
    };
    /** The cards of a band no other of it calls. */
    const uncalled = (members: Pin[]) => {
        const called = new Set(members.flatMap((p) => callsTo[p.id] ?? []));
        return members.filter((p) => !called.has(p.id));
    };
    /** A part of a band grown along `via` from its entries, those whose own trees share the most first. */
    const part = (b: number, via: Via, entriesOf: (members: Pin[]) => Pin[]): Pin[] => {
        const members = flow(b);
        if (members.length <= LIMITS.part) return [...members, ...tail(b)];
        const ids = new Set(members.map((p) => p.id));
        const firsts = entriesOf(members);
        const own = new Map(firsts.map((e) => [e, shared(grow(e, ids, new Set(), via), via)]));
        const entries = sortBy(
            firsts,
            (e) => -own.get(e)!,
            (e) => index.get(e.id)!
        );
        const tree = new Set<string>();
        for (const e of entries) if (tree.size < LIMITS.part) grow(e, ids, tree, via);
        return [...members.filter((p) => tree.has(p.id)), ...tail(b).filter((p) => (linked[p.id] ?? []).some((x) => tree.has(x)))];
    };
    const grownAlong = (parts: Pin[][]) => {
        const inParts = new Set(parts.flat().map((p) => p.id));
        return [pins[0], ...parts.flat(), ...bands.flatMap((_, b) => [...flow(b), ...tail(b)].filter((p) => !inParts.has(p.id))), ...rest];
    };
    const callParts = bands.map((_, b) => part(b, callsTo, uncalled));
    const grown = grownAlong(bands.map((_, b) => part(b, linksTo, firstColumn)));
    const grownByCalls = grownAlong(
        sortBy(
            callParts,
            (ps) => -shared(new Set(ps.map((p) => p.id)), callsTo),
            (ps) => callParts.indexOf(ps)
        )
    );

    const cut = (order: Pin[]) => new Set(order.slice(0, LIMITS.cards).map((p) => p.id));
    const beats = (ids: ReadonlySet<string>, best: ReadonlySet<string>) => {
        const [calls, bestCalls] = [shared(ids, callsTo), shared(best, callsTo)];
        return calls > bestCalls || (calls === bestCalls && shared(ids, linksTo) > shared(best, linksTo));
    };
    return [grown, grownByCalls].map(cut).reduce((best, ids) => (beats(ids, best) ? ids : best), cut(nearest));
};

/** A board of some of its cards: the bands left are those with a card in their flow, renumbered in order. */
const keepOnly = (board: Board, keep: ReadonlySet<string>): Board => {
    const inBand = groupBy(board.pins, (p) => p.band);
    const kept = board.bands.map((_, b) => b).filter((b) => (inBand[b] ?? []).some((p) => p.lane === "flow" && p.kind !== "pr" && keep.has(p.id)));
    const renumber = new Map(kept.map((b, i) => [b, i]));
    return {
        ...board,
        // The PR card heads the first band kept, whichever that is.
        pins: board.pins.filter((p) => keep.has(p.id)).map((p) => ({ ...p, band: p.kind === "pr" ? 0 : p.lane === "rest" ? kept.length : (renumber.get(p.band) ?? kept.length) })),
        bands: kept.map((b) => ({ entries: board.bands[b].entries.filter((id) => keep.has(id)) })),
    };
};

/** What the card limit left off: declarations without a card, and files with no card whose declarations aren't counted already. */
export const unpinnedOf = (board: Board, files: readonly ReviewFile[]): Review["unpinned"] => {
    const pinned = new Set(board.pins.map((p) => p.id));
    const lost = board.mode === "symbols" ? files.flatMap((f) => f.symbols).filter((s) => !pinned.has(s.id)) : [];
    const carded = new Set(board.pins.map((p) => p.path));
    const counted = new Set(lost.map((s) => s.path));
    return { functions: lost.length, files: files.filter((f) => !carded.has(f.path) && !counted.has(f.path)).length };
};
