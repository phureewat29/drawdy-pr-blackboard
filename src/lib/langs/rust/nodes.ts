/** Rust's syntax nodes as the rule table and the resolver read them: tree-sitter-rust 0.24.0's. */

import { perTree, type Flat } from "../../syntax.ts";

/** Each node's previous sibling, or -1: a macro's token tree can hold thousands of tokens. */
const previousSiblings = perTree((t: Flat): Int32Array => {
    const prev = new Int32Array(t.count).fill(-1);
    for (let p = 0; p < t.count; p++) for (let c = t.first[p], last = -1; c >= 0; last = c, c = t.next[c]) prev[c] = last;
    return prev;
});

export const previous = (t: Flat, n: number): number => previousSiblings(t)[n];

/** The impl, trait or type a node sits in, whose `self` and `Self` it means, or -1. */
export const selfClass = (t: Flat, n: number): number => {
    for (let x = t.parent[n]; x >= 0; x = t.parent[x]) {
        const ty = t.type[x];
        if (ty === "impl_item" || ty === "trait_item" || ty === "struct_item" || ty === "enum_item" || ty === "union_item") return x;
    }
    return -1;
};
