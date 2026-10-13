/** tree-sitter-kotlin 1.1.0's nodes, as the Kotlin linker reads them. */

import { textOf, type Flat } from "../../syntax.ts";

const COMMENTS = new Set(["line_comment", "block_comment"]);

/** A node's named children, comments aside. */
export const code = (t: Flat, n: number): number[] => {
    const out: number[] = [];
    for (let c = t.first[n]; c >= 0; c = t.next[c]) if (t.named[c] && !COMMENTS.has(t.type[c])) out.push(c);
    return out;
};

/** A node's first named child of a type, or -1. */
export const kid = (t: Flat, n: number, type: string): number => {
    for (let c = t.first[n]; c >= 0; c = t.next[c]) if (t.type[c] === type) return c;
    return -1;
};

/** A node's keyword or punctuation child, or -1. */
export const token = (t: Flat, n: number, tok: string): number => {
    for (let c = t.first[n]; c >= 0; c = t.next[c]) if (!t.named[c] && t.type[c] === tok) return c;
    return -1;
};

/** A name as Kotlin compares it: `\`a b\`` is `a b`. */
export const bare = (s: string): string => (s.length > 1 && s[0] === "`" && s.endsWith("`") ? s.slice(1, -1) : s);

/** An identifier node's name. */
export const nameOf = (t: Flat, n: number): string => bare(textOf(t, n));

/** The modifiers a declaration writes: `private`, `open`, `companion`, `expect`, … (annotations aside). */
export const modifiersOf = (t: Flat, n: number): Set<string> => {
    const out = new Set<string>();
    const m = kid(t, n, "modifiers");
    if (m < 0) return out;
    for (const c of code(t, m)) if (t.type[c] !== "annotation") out.add(textOf(t, c));
    return out;
};

/** Whether a declaration carries an annotation. */
export const annotated = (t: Flat, n: number): boolean => {
    const m = kid(t, n, "modifiers");
    return m >= 0 && kid(t, m, "annotation") >= 0;
};

/** What a `class_declaration` declares: `interface` (and `fun interface`), `enum`, `annotation`, or `class`. */
export const classKind = (t: Flat, n: number): "class" | "interface" | "enum" | "annotation" => {
    if (token(t, n, "interface") >= 0) return "interface";
    const mods = modifiersOf(t, n);
    return mods.has("enum") ? "enum" : mods.has("annotation") ? "annotation" : "class";
};

/** The parts of a call: its callee, type arguments, value arguments and trailing lambda; `f(a) {}` reads as one call. */
export type Call = { node: number; callee: number; typeArgs: number; args: number[]; lambda: number };

/** The call a `call_expression` makes; a call whose callee is a call that only adds a trailing lambda is that call (`with(x) { }`). */
export const callOf = (t: Flat, n: number): Call | null => {
    if (t.type[n] !== "call_expression") return null;
    const kids = code(t, n);
    let callee = kids[0] ?? -1;
    let typeArgs = kid(t, n, "type_arguments");
    let vargs = kid(t, n, "value_arguments");
    let lambda = kid(t, n, "annotated_lambda");
    // `f(a) { }`: tree-sitter nests the call with arguments inside the one with the lambda.
    if (t.type[callee] === "call_expression" && vargs < 0 && typeArgs < 0 && lambda >= 0 && kid(t, callee, "annotated_lambda") < 0) {
        const inner = callee;
        callee = code(t, inner)[0] ?? -1;
        typeArgs = kid(t, inner, "type_arguments");
        vargs = kid(t, inner, "value_arguments");
    }
    const args = vargs >= 0 ? code(t, vargs).filter((c) => t.type[c] === "value_argument") : [];
    return { node: n, callee, typeArgs, args, lambda };
};

/** The call_expression whose callee a node is, through `f(a) {}`'s nesting, or -1. */
export const callAround = (t: Flat, callee: number): number => {
    const p = t.parent[callee];
    if (p < 0 || t.type[p] !== "call_expression" || code(t, p)[0] !== callee) return -1;
    // The inner call of `f(a) {}` is the outer one's head.
    const pp = t.parent[p];
    if (pp >= 0 && t.type[pp] === "call_expression" && code(t, pp)[0] === p && kid(t, p, "annotated_lambda") < 0 && kid(t, pp, "annotated_lambda") >= 0 && kid(t, pp, "value_arguments") < 0) return pp;
    return p;
};

/** A navigation's receiver, operator (`.`, `?.`, `::`) and name. */
export const navOf = (t: Flat, n: number): { receiver: number; op: string; name: number } | null => {
    if (t.type[n] !== "navigation_expression") return null;
    const kids = code(t, n);
    if (kids.length !== 2 || t.type[kids[1]] !== "identifier") return null;
    let op = "";
    for (let c = t.first[n]; c >= 0; c = t.next[c]) if (!t.named[c] && (t.type[c] === "." || t.type[c] === "?." || t.type[c] === "::")) op = t.type[c];
    return op ? { receiver: kids[0], op, name: kids[1] } : null;
};

/** The parts a `value_argument` writes: its name (`x = …`), spread (`*a`), and value. */
export const argOf = (t: Flat, a: number): { name: string | null; spread: boolean; value: number } => {
    const kids = code(t, a);
    const named = token(t, a, "=") >= 0 && kids.length >= 2 && t.type[kids[0]] === "identifier";
    const value = named ? kids[1] : (kids[0] ?? -1);
    return { name: named ? nameOf(t, kids[0]) : null, spread: value >= 0 && t.type[value] === "spread_expression", value };
};

/** Each identifier of a `user_type`, and the type arguments written after it. */
export const typeParts = (t: Flat, n: number): { name: number; args: number }[] => {
    const out: { name: number; args: number }[] = [];
    for (const c of code(t, n)) {
        if (t.type[c] === "identifier") out.push({ name: c, args: -1 });
        else if (t.type[c] === "type_arguments" && out.length > 0) out[out.length - 1].args = c;
    }
    return out;
};

/** A type node without nullability, parentheses and annotations: `(Foo)?` is `Foo`. */
export const stripType = (t: Flat, n: number): number => {
    let x = n;
    for (;;) {
        if (x < 0) return -1;
        const ty = t.type[x];
        if (ty === "nullable_type" || ty === "parenthesized_type" || ty === "non_nullable_type") {
            const inner = code(t, x).find((c) => t.type[c] !== "type_modifiers");
            x = inner ?? -1;
        } else return x;
    }
};

/** Whether a type node is nullable (`Foo?`). */
export const nullable = (t: Flat, n: number): boolean => {
    for (let x = n; x >= 0 && (t.type[x] === "nullable_type" || t.type[x] === "parenthesized_type"); x = code(t, x)[0] ?? -1) if (t.type[x] === "nullable_type") return true;
    return false;
};

/** The written type of a declaration-like node: the type child among a declaration's parts. */
export const TYPE_NODES = new Set(["user_type", "nullable_type", "function_type", "parenthesized_type", "non_nullable_type", "dynamic"]);

/** Whether a node is inside another, or is it. */
export const within = (t: Flat, n: number, outer: number): boolean => {
    for (let x = n; x >= 0; x = t.parent[x]) if (x === outer) return true;
    return false;
};

/** The innermost ancestor of a node (itself excluded) of one of some types, or -1. */
export const ancestor = (t: Flat, n: number, types: ReadonlySet<string>): number => {
    for (let x = t.parent[n]; x >= 0; x = t.parent[x]) if (types.has(t.type[x])) return x;
    return -1;
};

/** An annotation's class by its last written name (`@a.b.Foo(…)` is Foo), or "". */
export const annotationName = (t: Flat, a: number): string => {
    const inner = code(t, a).find((c) => t.type[c] === "user_type" || t.type[c] === "constructor_invocation") ?? -1;
    const ut = inner >= 0 && t.type[inner] === "constructor_invocation" ? kid(t, inner, "user_type") : inner;
    if (ut < 0) return "";
    const parts = typeParts(t, ut);
    return parts.length ? nameOf(t, parts[parts.length - 1].name) : "";
};

export const text = textOf;
