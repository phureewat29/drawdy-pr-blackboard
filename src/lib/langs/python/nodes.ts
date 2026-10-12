/** Python's syntax nodes as the rule table and the resolver read them: tree-sitter-python 0.25.0's. */

import { namedChildren, textOf, type Flat } from "../../syntax.ts";

export const PATTERNS = new Set(["pattern_list", "tuple_pattern", "list_pattern", "tuple", "list", "parenthesized_expression", "list_splat_pattern", "list_splat", "as_pattern_target", "expression_list"]);

/** Every name a target binds: `a`, `a, (b, *c)`, but not `x.y` or `x[i]`. */
export const targets = (t: Flat, n: number, out: number[] = []): number[] => {
    if (n < 0) return out;
    const ty = t.type[n];
    if (ty === "identifier") out.push(n);
    else if (PATTERNS.has(ty)) for (const c of namedChildren(t, n)) targets(t, c, out);
    return out;
};

/** Every attribute a target sets: `x.y`, `a, x.y = ...`. */
export const attributeTargets = (t: Flat, n: number, out: number[] = []): number[] => {
    if (n < 0) return out;
    if (t.type[n] === "attribute") out.push(n);
    else if (PATTERNS.has(t.type[n])) for (const c of namedChildren(t, n)) attributeTargets(t, c, out);
    return out;
};

/** The class a function definition sits in directly, through decorators. */
export const classOfMethod = (t: Flat, fn: number): number => {
    let p = t.parent[fn];
    if (p >= 0 && t.type[p] === "decorated_definition") p = t.parent[p];
    if (p >= 0 && t.type[p] === "block") p = t.parent[p];
    return p >= 0 && t.type[p] === "class_definition" ? p : -1;
};

/** Whether a statement sits right in a class body. */
export const inClassBody = (t: Flat, stmt: number): boolean => {
    const block = stmt >= 0 ? t.parent[stmt] : -1;
    return block >= 0 && t.type[block] === "block" && t.type[t.parent[block]] === "class_definition";
};

/** A definition's decorators, as written after `@` up to their arguments: `staticmethod`, `x.setter`, `typing.overload`. */
export const decorators = (t: Flat, def: number): string[] => {
    const p = t.parent[def];
    if (p < 0 || t.type[p] !== "decorated_definition") return [];
    return namedChildren(t, p)
        .filter((c) => t.type[c] === "decorator")
        .map((c) => textOf(t, c).replace(/^@\s*/, "").split("(")[0].trim());
};

export const isOverload = (t: Flat, def: number) => decorators(t, def).some((d) => /^(?:[\w.]+\.)?overload$/.test(d));

/** Whether a string is a whole annotation naming one type: `x: "Config"`, a forward reference, never `Literal["config"]`. */
export const annotationName = (t: Flat, content: number): boolean => {
    const str = t.parent[content];
    const annotation = str >= 0 ? t.parent[str] : -1;
    return (
        t.type[str] === "string" &&
        annotation >= 0 &&
        t.type[annotation] === "type" &&
        (t.field[annotation] === "type" || t.field[annotation] === "return_type") &&
        namedChildren(t, str).length === 3 &&
        /^[A-Za-z_]\w*$/.test(textOf(t, content))
    );
};
