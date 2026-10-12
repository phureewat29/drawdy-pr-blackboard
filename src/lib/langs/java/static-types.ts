/** Static types as overload resolution needs them, and the conversions between them (JLS 5). */

import { typeKey, type JType } from "./files.ts";
import type { Lib } from "./library.ts";

/**
 * A static type: a primitive, null, a reference type by key (its name with
 * its package's; a local or anonymous class's `#id`), an array, a type
 * variable, a lambda's or a method reference's (`fn`, its parameters'
 * number if a lambda's), or one not known.
 */
export type SType = { k: "prim"; name: string } | { k: "null" } | { k: "ref"; key: string; type?: JType | Lib; args?: true; targs?: string } | { k: "array"; elem: SType } | { k: "var" } | { k: "fn"; arity: number | null } | { k: "unknown" };
export const UNTYPED: SType = { k: "unknown" };
export type Fit = "yes" | "no" | "maybe";

/** A type read, as a static type. */
export const refTo = (T: JType): SType => ({ k: "ref", key: typeKey(T), type: T });

/** Each primitive's widening conversions (JLS 5.1.2). */
const WIDENING: Record<string, string[]> = {
    byte: ["short", "int", "long", "float", "double"],
    short: ["int", "long", "float", "double"],
    char: ["int", "long", "float", "double"],
    int: ["long", "float", "double"],
    long: ["float", "double"],
    float: ["double"],
};
export const BOXES: Record<string, string> = { int: "java.lang.Integer", long: "java.lang.Long", short: "java.lang.Short", byte: "java.lang.Byte", char: "java.lang.Character", boolean: "java.lang.Boolean", float: "java.lang.Float", double: "java.lang.Double" };
export const UNBOXED: Record<string, string> = Object.fromEntries(Object.entries(BOXES).map(([prim, box]) => [box, prim]));
const PRIMITIVES = new Set(Object.keys(BOXES));

/** The reference types an array is a subtype of (JLS 4.10.3). */
export const ARRAY_SUPERTYPES: ReadonlySet<string> = new Set(["java.lang.Object", "java.lang.Cloneable", "java.io.Serializable"]);

/** Whether a primitive converts to another by identity or widening. */
export const widens = (from: string, to: string): boolean => from === to || (WIDENING[from] ?? []).includes(to);

/** A type as the JDK table writes it: a primitive, a type variable `?`, an array `T[]`, else a type's name. */
export const libParam = (p: string): SType => (p === "?" ? { k: "var" } : p.endsWith("[]") ? { k: "array", elem: libParam(p.slice(0, -2)) } : PRIMITIVES.has(p) ? { k: "prim", name: p } : { k: "ref", key: p });

export const sameType = (a: SType, b: SType): boolean =>
    a.k === b.k && (a.k === "prim" ? a.name === (b as typeof a).name : a.k === "ref" ? a.key === (b as typeof a).key : a.k === "array" ? sameType(a.elem, (b as typeof a).elem) : a.k === "null");

/** Unary numeric promotion. */
export const promote = (prim: string): string => (prim === "byte" || prim === "short" || prim === "char" ? "int" : prim);

/** A binary operator's result on two primitives: a shift takes its left operand's promoted type, else binary numeric promotion; booleans give a boolean. */
export const promoted = (a: string, b: string, op: string): SType => {
    if (a === "boolean" || b === "boolean") return a === b && ["&", "|", "^"].includes(op) ? { k: "prim", name: "boolean" } : UNTYPED;
    if (op === "<<" || op === ">>" || op === ">>>") return { k: "prim", name: promote(a) };
    for (const wide of ["double", "float", "long"]) if (a === wide || b === wide) return { k: "prim", name: wide };
    return { k: "prim", name: "int" };
};
