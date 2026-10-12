/** tree-sitter-php 0.24.2's nodes, as PHP's rule table and resolver read them. */

import { child, namedChildren, textOf, type Flat } from "../../syntax.ts";

export const CLASS_LIKES: ReadonlySet<string> = new Set(["class_declaration", "interface_declaration", "trait_declaration", "enum_declaration"]);

/** Code whose variables are its own. */
export const FUNCTIONS: ReadonlySet<string> = new Set(["function_definition", "method_declaration", "anonymous_function", "arrow_function"]);

/** A class-like's keyword, `class`, `trait`, from its node's type. */
export const kindOf = (type: string): string => type.slice(0, type.indexOf("_"));

/** Whether a node sits in code that runs apart from where it is written: a function's or a closure's body, or an anonymous class. */
export const nested = (t: Flat, n: number): boolean => {
    for (let x = t.parent[n]; x >= 0; x = t.parent[x]) if (FUNCTIONS.has(t.type[x]) || t.type[x] === "anonymous_class") return true;
    return false;
};

/** Whether a declaration is a statement of its file or namespace, which runs whenever the file does: not in an `if`, a block or a function. */
export const atTop = (t: Flat, n: number): boolean => {
    const p = t.parent[n];
    return p === 0 || (t.type[p] === "compound_statement" && t.type[t.parent[p]] === "namespace_definition");
};

/** The last node of a node's subtree: nodes are numbered in tree order, so its subtree is the ids from it to this one. */
export const lastOf = (t: Flat, n: number): number => {
    let x = n;
    for (let c = t.first[x]; c >= 0; c = t.first[x]) {
        while (t.next[c] >= 0) c = t.next[c];
        x = c;
    }
    return x;
};

/** The text of a name, spaces out. */
export const nameText = (t: Flat, n: number): string => (n < 0 ? "" : textOf(t, n).replace(/\s+/g, ""));

/** A modifier's keyword among a declaration's children: `public`, `static`, `abstract`. */
export const modifiers = (t: Flat, n: number): string => namedChildren(t, n).filter((c) => t.type[c].endsWith("_modifier")).map((c) => textOf(t, c).toLowerCase()).join(" ");

/** The class a type, a `new` or a scope names: its name node, or -1. */
export const classNameNode = (t: Flat, n: number): number => {
    const x = t.type[n] === "named_type" ? (namedChildren(t, n)[0] ?? -1) : n;
    return x >= 0 && (t.type[x] === "name" || t.type[x] === "qualified_name") ? x : -1;
};

/** Whether a binary expression is `x instanceof Name`. */
export const isInstanceof = (t: Flat, n: number): boolean => t.type[child(t, n, "operator")] === "instanceof";
