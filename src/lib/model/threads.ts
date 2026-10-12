/**
 * Threads: the cards joined by links, each laid out as a band of the board,
 * callers in the left column and what they call to their right.
 */

import { groupBy, mapValues, sortBy } from "../fp.ts";
import type { Band, Pin } from "../model.ts";

export type Edge = { from: string; to: string };

/** Each id's neighbours along the edges, from → to, in the edges' order. */
export const adjacency = (edges: readonly Edge[]): Record<string, string[]> =>
    mapValues(
        groupBy(edges, (e) => e.from),
        (es) => es.map((e) => e.to)
    );

/** Groups of ids joined by edges in either direction, each in the order given. */
const components = (ids: readonly string[], edges: readonly Edge[]): string[][] => {
    const known = new Set(ids);
    const next = adjacency([...edges, ...edges.map((e) => ({ from: e.to, to: e.from }))]);
    const group = new Map<string, number>();
    let groups = 0;
    for (const id of ids) {
        if (group.has(id)) continue;
        const g = groups++;
        group.set(id, g);
        const stack = [id];
        while (stack.length > 0) {
            for (const n of next[stack.pop()!] ?? []) {
                if (group.has(n) || !known.has(n)) continue;
                group.set(n, g);
                stack.push(n);
            }
        }
    }
    const out: string[][] = Array.from({ length: groups }, () => []);
    for (const id of ids) out[group.get(id)!].push(id);
    return out;
};

/**
 * Columns by longest path from the callers nobody calls, after dropping the
 * edges that close a cycle. Ids with no edges sit in the first column.
 */
const layers = (ids: readonly string[], edges: readonly Edge[]): Map<string, number> => {
    const known = new Set(ids);
    const out = adjacency(edges.filter((e) => known.has(e.from) && known.has(e.to) && e.from !== e.to));

    // Depth-first search in id order; an edge back to a node on the stack closes a cycle.
    const state = new Map<string, "open" | "done">();
    const kept: Edge[] = [];
    const visit = (id: string) => {
        state.set(id, "open");
        for (const next of out[id] ?? []) {
            const s = state.get(next);
            if (s === "open") continue;
            kept.push({ from: id, to: next });
            if (!s) visit(next);
        }
        state.set(id, "done");
    };
    for (const id of ids) if (!state.has(id)) visit(id);

    // Longest path, in topological order: the graph is a DAG now.
    const layer = new Map<string, number>(ids.map((id) => [id, 0]));
    const waiting = new Map<string, number>(ids.map((id) => [id, 0]));
    for (const e of kept) waiting.set(e.to, waiting.get(e.to)! + 1);
    const after = adjacency(kept);
    const ready = [...waiting].filter(([, n]) => n === 0).map(([id]) => id);
    for (let i = 0; i < ready.length; i++) {
        const a = ready[i];
        for (const b of after[a] ?? []) {
            layer.set(b, Math.max(layer.get(b)!, layer.get(a)! + 1));
            waiting.set(b, waiting.get(b)! - 1);
            if (waiting.get(b) === 0) ready.push(b);
        }
    }
    return layer;
};

/**
 * The threads among some ids, largest first: each a band of cards in columns
 * by depth, its entries the cards nothing else in it links to.
 */
export const layThreads = (ids: readonly string[], edges: readonly Edge[], pinOf: (id: string, band: number, column: number) => Pin): { pins: Pin[]; bands: Band[] } => {
    const first = new Map<string, number>();
    for (const [i, id] of ids.entries()) if (!first.has(id)) first.set(id, i);
    const threads = sortBy(
        components(ids, edges).filter((g) => g.length >= 2),
        (g) => -g.length,
        (g) => first.get(g[0])!
    );
    // The edges inside each thread, in the order given: what its columns come from.
    const threadOf = new Map(threads.flatMap((members, b) => members.map((id) => [id, b] as const)));
    const within = threads.map((): Edge[] => []);
    for (const e of edges) {
        const b = threadOf.get(e.from);
        if (b !== undefined && threadOf.get(e.to) === b) within[b].push(e);
    }
    const pins: Pin[] = [];
    const bands = threads.map((members, b): Band => {
        const depth = layers(members, within[b]);
        for (const id of members) pins.push(pinOf(id, b, depth.get(id)! + 1));
        return { entries: members.filter((id) => depth.get(id) === 0) };
    });
    return { pins, bands };
};
