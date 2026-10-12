/** Reading JavaScript and TypeScript syntax nodes: what every part of a file's facts asks of its tree. */

import { child, childOfType, namedChildren, textOf, type Flat } from "../../../syntax.ts";

const FUNCTIONS = new Set(["function_expression", "arrow_function", "generator_function", "function"]);
const WRAPPERS = new Set(["parenthesized_expression", "as_expression", "satisfies_expression", "non_null_expression", "type_assertion"]);

/** The expression inside parentheses, `as`, `satisfies`, `!` and `<T>`. */
export const unwrap = (t: Flat, n: number): number => {
    while (n >= 0 && WRAPPERS.has(t.type[n])) {
        const inner = t.type[n] === "type_assertion" ? namedChildren(t, n).filter((c) => t.type[c] !== "type_arguments").pop() : namedChildren(t, n)[0];
        if (inner === undefined) break;
        n = inner;
    }
    return n;
};

export const isFn = (t: Flat, n: number): boolean => n >= 0 && FUNCTIONS.has(t.type[n]);

/** The object literal a module-level initializer builds, directly or as a call's argument (`ObjectFreeze({...})`). */
export const objectOf = (t: Flat, e: number): number => {
    e = unwrap(t, e);
    if (t.type[e] === "object") return e;
    if (t.type[e] !== "call_expression") return -1;
    for (const a of namedChildren(t, child(t, e, "arguments"))) if (t.type[unwrap(t, a)] === "object") return unwrap(t, a);
    return -1;
};

/** A property name as written: identifiers as is, strings without quotes. */
export const propName = (t: Flat, n: number): string => {
    if (n < 0) return "?";
    if (t.type[n] !== "string") return textOf(t, n);
    const fragment = childOfType(t, n, "string_fragment");
    return fragment >= 0 ? textOf(t, fragment) : "";
};

/** A string literal's value, or a template's without substitutions; null for anything else. */
export const stringValue = (t: Flat, n: number): string | null => {
    if (t.type[n] === "string") return propName(t, n);
    if (t.type[n] === "template_string" && !namedChildren(t, n).some((c) => t.type[c] === "template_substitution")) return textOf(t, n).slice(1, -1);
    return null;
};

/** The string a call's first argument is, as in `require("m")` and `import("m")`, or null. */
export const firstStringArgument = (t: Flat, call: number): string | null => {
    const first = namedChildren(t, child(t, call, "arguments"))[0];
    return first === undefined ? null : stringValue(t, first);
};

/** The type a node's `: T` annotation names, or -1. */
export const annotatedType = (t: Flat, n: number): number => {
    const annotation = child(t, n, "type");
    return annotation >= 0 ? (namedChildren(t, annotation)[0] ?? -1) : -1;
};

/** A class field's name: JavaScript's grammar calls it `property`, TypeScript's `name`. */
export const fieldName = (t: Flat, field: number): number => child(t, field, t.type[field] === "field_definition" ? "property" : "name");

/** The assignment an expression statement is, or -1. */
export const assignmentIn = (t: Flat, statement: number): number => {
    const e = namedChildren(t, statement)[0];
    return e !== undefined && t.type[e] === "assignment_expression" ? e : -1;
};
