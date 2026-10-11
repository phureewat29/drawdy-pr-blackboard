/**
 * Layered layout for the change map: callers in the left column, what they
 * call to their right, so the map reads left to right like the board.
 */

/**
 * Columns by longest path from the callers nobody calls, after dropping the
 * edges that close a cycle. Nodes with no edges sit in the first column.
 */
export const layers = (ids: readonly string[], edges: readonly (readonly [string, string])[]): Map<string, number> => {
    const out = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const [a, b] of edges) if (out.has(a) && out.has(b) && a !== b) out.get(a)!.push(b);

    // Depth-first search in id order; an edge back to a node on the stack closes a cycle.
    const state = new Map<string, "open" | "done">();
    const kept: [string, string][] = [];
    const visit = (id: string) => {
        state.set(id, "open");
        for (const next of out.get(id)!) {
            const s = state.get(next);
            if (s === "open") continue;
            kept.push([id, next]);
            if (!s) visit(next);
        }
        state.set(id, "done");
    };
    for (const id of ids) if (!state.has(id)) visit(id);

    // Longest path, in topological order: the graph is a DAG now.
    const layer = new Map<string, number>(ids.map((id) => [id, 0]));
    const waiting = new Map<string, number>(ids.map((id) => [id, 0]));
    const after = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const [a, b] of kept) {
        waiting.set(b, waiting.get(b)! + 1);
        after.get(a)!.push(b);
    }
    const ready = [...waiting].filter(([, n]) => n === 0).map(([id]) => id);
    for (let i = 0; i < ready.length; i++) {
        const a = ready[i];
        for (const b of after.get(a)!) {
            layer.set(b, Math.max(layer.get(b)!, layer.get(a)! + 1));
            waiting.set(b, waiting.get(b)! - 1);
            if (waiting.get(b) === 0) ready.push(b);
        }
    }
    return layer;
};
