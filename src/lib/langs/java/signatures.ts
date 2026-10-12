/**
 * A declaration's written types, read where they are written: as keys that
 * tell overloads apart and find overrides (JLS 8.4.2), and as static types.
 * A parameter type with type arguments is a sure fit only for an argument of
 * the type written alike, or where they are unbounded wildcards or the
 * method's own type variables inference binds from that argument alone.
 */

import type { GBinding } from "../../anyfacts.ts";
import { child, hasToken, namedChildren, textOf, type Flat } from "../../syntax.ts";
import { typeKey, type JFile } from "./files.ts";
import { code, dimsOf, isAnnotation, isPrimitiveType, lastDescendant, spreadType, typeParts } from "./nodes.ts";
import { typeParameterOf } from "./scopes.ts";
import { UNTYPED, type SType } from "./static-types.ts";
import { NONE, resolveParts, type TypeRes } from "./type-names.ts";

const NO_VARS: ReadonlySet<string> = new Set();

/**
 * Whether a type node writes type arguments that constrain it (`List<String>`,
 * `Map<K, ? extends V>`), which its erasure alone can't compare. An unbounded
 * wildcard constrains nothing (`Class<?>`), nor does one of `lone`, a
 * method's type variable that inference binds from this argument alone
 * (`<T> T fromJson(String json, Class<T> c)` takes any `Class`).
 */
const constrained = (t: Flat, n: number, lone: ReadonlySet<string> = NO_VARS): boolean => {
    const last = lastDescendant(t, n);
    for (let x = n; x <= last; x++) {
        if (t.type[x] !== "type_arguments") continue;
        if (code(t, x).some((c) => (t.type[c] === "wildcard" ? code(t, c).some((b) => !isAnnotation(t, b)) : t.type[c] !== "type_identifier" || !lone.has(textOf(t, c))))) return true;
    }
    return false;
};

/**
 * A method's or a constructor's type variables written with no bound that
 * appear once among its parameters' types: inference binds such a variable
 * from that argument alone, whatever its type arguments are (JLS 18.5.1).
 */
export const loneVars = (t: Flat, decl: number, params: readonly number[]): ReadonlySet<string> => {
    const tps = child(t, decl, "type_parameters");
    if (tps < 0) return NO_VARS;
    const free = new Set<string>();
    for (const tp of code(t, tps)) {
        const parts = code(t, tp).filter((c) => !isAnnotation(t, c));
        if (t.type[tp] === "type_parameter" && parts.length === 1 && t.type[parts[0]] === "type_identifier") free.add(textOf(t, parts[0]));
    }
    if (free.size === 0) return NO_VARS;
    const seen = new Map<string, number>();
    for (const p of params) {
        const last = lastDescendant(t, p);
        for (let x = p; x <= last; x++) if (t.type[x] === "type_identifier" && free.has(textOf(t, x))) seen.set(textOf(t, x), (seen.get(textOf(t, x)) ?? 0) + 1);
    }
    return new Set([...free].filter((v) => seen.get(v) === 1));
};

/** The key of the type a name means: a type read by its key, a JDK or imported type by its name; null for any other. */
const keyOfRes = (r: TypeRes): string | null => (r.k === "type" ? typeKey(r.t) : r.k === "lib" ? r.lib.fqn : r.k === "none" ? (r.fqn ?? null) : null);

/** A parameter list's types, as keys that tell types apart: a type read by its id, a JDK or imported type by its name, a primitive by its keyword; null when one can't be told. */
export const keyOfParams = (jf: JFile, params: readonly number[]): string | null => {
    const t = jf.t;
    const keys: string[] = [];
    for (const p of params) {
        const spread = t.type[p] === "spread_parameter";
        const typeNode = spread ? spreadType(t, p) : child(t, p, "type");
        const k = keyOfType(jf, typeNode, (spread ? 1 : 0) + dimsOf(t, child(t, p, "dimensions")));
        if (k === null) return null;
        keys.push(k);
    }
    return keys.join(",");
};

/** A type's key, a type variable's its erasure's (its first bound's, else Object's): methods whose parameters' keys match override one another, or clash. */
const keyOfType = (jf: JFile, n: number, dims: number, depth = 0): string | null => {
    const t = jf.t;
    if (n < 0 || depth > 8) return null;
    if (isPrimitiveType(t, n)) return textOf(t, n) + "[]".repeat(dims);
    if (t.type[n] === "array_type") return keyOfType(jf, child(t, n, "element"), dims + dimsOf(t, child(t, n, "dimensions")), depth);
    const parts = typeParts(t, n);
    const r = parts.length > 0 ? resolveParts(jf, n, parts) : NONE;
    if (r.k === "param") {
        const tp = typeParameterOf(jf, n, parts[0]);
        const bound = tp < 0 ? undefined : namedChildren(t, tp).find((c) => t.type[c] === "type_bound");
        return tp < 0 ? null : bound === undefined ? `java.lang.Object${"[]".repeat(dims)}` : keyOfType(jf, code(t, bound)[0] ?? -1, dims, depth + 1);
    }
    const name = keyOfRes(r);
    return name === null ? null : name + "[]".repeat(dims);
};

/** A variable's array dimensions written after its name, `int x[]`; a varargs parameter's one. */
export const bindingDims = (t: Flat, b: GBinding): number => {
    const p = t.parent[b.node];
    return t.type[p] === "variable_declarator" && t.type[t.parent[p]] === "spread_parameter" ? 1 : dimsOf(t, child(t, p, "dimensions"));
};

/**
 * A type as written, type arguments and all, by the keys of the types it
 * names (`java.util.Map<java.lang.reflect.TypeVariable<?>,java.lang.reflect.Type>`);
 * undefined where a name isn't known or is a type variable.
 */
const writtenKey = (jf: JFile, n: number): string | undefined => {
    const t = jf.t;
    const ty = t.type[n];
    if (isPrimitiveType(t, n)) return textOf(t, n);
    if (ty === "annotated_type") {
        const inner = code(t, n).find((c) => !isAnnotation(t, c));
        return inner === undefined ? undefined : writtenKey(jf, inner);
    }
    if (ty === "array_type") {
        const elem = writtenKey(jf, child(t, n, "element"));
        return elem === undefined ? undefined : elem + "[]".repeat(dimsOf(t, child(t, n, "dimensions")));
    }
    // `Outer<A>.Inner` names its outer type's arguments where its key doesn't.
    if (ty !== "generic_type") for (let x = n; x <= lastDescendant(t, n); x++) if (t.type[x] === "type_arguments") return undefined;
    const parts = typeParts(t, n);
    if (parts.length === 0) return undefined;
    const base = keyOfRes(resolveParts(jf, n, parts)) ?? undefined;
    if (base === undefined || ty !== "generic_type") return base;
    const targs = argsKey(jf, n);
    return targs === undefined ? undefined : base + targs;
};

/** A generic type node's type arguments as written, by `writtenKey` (`<?,? extends java.lang.Number>`); undefined where one isn't known. */
const argsKey = (jf: JFile, n: number): string | undefined => {
    const t = jf.t;
    const lists = code(t, n).filter((c) => t.type[c] === "type_arguments");
    if (lists.length !== 1 || code(t, n).some((c) => t.type[c] === "scoped_type_identifier")) return undefined;
    const out: string[] = [];
    for (const c of code(t, lists[0])) {
        if (t.type[c] !== "wildcard") {
            const k = writtenKey(jf, c);
            if (k === undefined) return undefined;
            out.push(k);
            continue;
        }
        const bound = code(t, c).filter((b) => !isAnnotation(t, b));
        if (bound.length === 0) {
            out.push("?");
            continue;
        }
        const k = writtenKey(jf, bound[bound.length - 1]);
        if (k === undefined) return undefined;
        out.push(`? ${hasToken(t, c, "super") ? "super" : "extends"} ${k}`);
    }
    return `<${out.join(",")}>`;
};

const arrayOf = (elem: SType, dims: number): SType => (dims > 0 ? arrayOf({ k: "array", elem }, dims - 1) : elem);

/** A parameter's or a variable's static type from its written type node; `dims` more array dimensions; `lone`, its method's type variables `constrained` lets go. */
export const staticType = (jf: JFile, n: number, dims = 0, lone: ReadonlySet<string> = NO_VARS): SType => {
    const t = jf.t;
    if (n < 0) return UNTYPED;
    if (isPrimitiveType(t, n)) return arrayOf({ k: "prim", name: textOf(t, n) }, dims);
    if (t.type[n] === "array_type") return staticType(jf, child(t, n, "element"), dims + dimsOf(t, child(t, n, "dimensions")));
    const parts = typeParts(t, n);
    if (parts.length === 0) return UNTYPED;
    const r = resolveParts(jf, n, parts);
    const targs = constrained(t, n, lone) && t.type[n] === "generic_type" ? argsKey(jf, n) : undefined;
    const args = constrained(t, n, lone) ? { args: true as const, ...(targs !== undefined ? { targs } : {}) } : {};
    const base: SType =
        r.k === "type" ? { k: "ref", key: typeKey(r.t), type: r.t, ...args } : r.k === "lib" ? { k: "ref", key: r.lib.fqn, type: r.lib, ...args } : r.k === "param" ? { k: "var" } : r.k === "none" && r.fqn ? { k: "ref", key: r.fqn, ...args } : UNTYPED;
    return arrayOf(base, dims);
};

/** A parameter list's static types, a varargs one as its array; `lone`, as for `staticType`. */
export const paramTypes = (jf: JFile, params: readonly number[], lone: ReadonlySet<string> = NO_VARS): SType[] =>
    params.map((p) => {
        const t = jf.t;
        return t.type[p] === "spread_parameter" ? staticType(jf, spreadType(t, p), 1, lone) : staticType(jf, child(t, p, "type"), dimsOf(t, child(t, p, "dimensions")), lone);
    });
