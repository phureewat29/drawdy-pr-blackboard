/**
 * What a C# type name means where it is written (C# spec 7.6), and static
 * types as overload resolution compares them. A simple type name is a type
 * parameter, a type nested in a type around it (declared or inherited),
 * else a type of the innermost namespace around it, declared in its own
 * file or in a file read beside it, the same folder holding one project's
 * code. Anything further out (an enclosing namespace, a using directive, a
 * global using, another project) may lose to a type the reads never saw, so
 * names nothing sure. Two types written alike in one non-generic class's
 * code are one type, whatever they name. Conversions are judged only where
 * no type judgement can go wrong (`fits`).
 */

import type { GScope } from "../../anyfacts.ts";
import { child, textOf } from "../../syntax.ts";
import { bodyOf, membersOf, openOf, type CFile, type CType } from "./files.ts";
import { arityOf, bare, code, dotted, typeArgs } from "./nodes.ts";

/** A library type known by its members' names: object, ValueType, Enum, a delegate's base. */
export type Lib = { lib: string; names: ReadonlySet<string> | null; base: Lib | null };

const OBJECT_NAMES = ["Equals", "GetHashCode", "GetType", "ToString", "MemberwiseClone", "ReferenceEquals", "Finalize"];
export const OBJECT: Lib = { lib: "System.Object", names: new Set(OBJECT_NAMES), base: null };
export const VALUE_TYPE: Lib = { lib: "System.ValueType", names: new Set(OBJECT_NAMES), base: OBJECT };
export const ENUM: Lib = {
    lib: "System.Enum",
    names: new Set([...OBJECT_NAMES, "CompareTo", "Format", "GetName", "GetNames", "GetNamesAsUnderlyingType", "GetTypeCode", "GetUnderlyingType", "GetValues", "GetValuesAsUnderlyingType", "HasFlag", "IsDefined", "Parse", "ToObject", "TryFormat", "TryParse"]),
    base: VALUE_TYPE,
};
/** A delegate's base: members not listed, so any of its names is unknown. */
export const DELEGATE: Lib = { lib: "System.MulticastDelegate", names: null, base: OBJECT };
/** The members a record gets without writing them. */
export const RECORD_MADE: ReadonlySet<string> = new Set(["Equals", "GetHashCode", "ToString", "PrintMembers", "Deconstruct", "EqualityContract"]);

/** What a type name means: a type read, a library type known, a type parameter, or nothing sure. */
export type TypeRes = { k: "type"; t: CType } | { k: "lib"; lib: Lib } | { k: "param" } | { k: "unknown" };
const UNKNOWN: TypeRes = { k: "unknown" };
const PARAM: TypeRes = { k: "param" };

export const scopeOf = (cf: CFile, n: number): GScope => cf.f.scopes[cf.f.enclosing[n]];

/** Whether a node is in a type's body, where its members are in scope; not its header (base list, parameters, attributes). */
export const inBody = (T: CType, n: number): boolean => {
    const b = bodyOf(T);
    const t = T.file.t;
    return b >= 0 && t.start[b] <= t.start[n] && t.end[n] <= t.end[b];
};

/** The type a simple type name means at a node: `arity` type arguments written. */
export const typeName = (cf: CFile, n: number, name: string, arity: number): TypeRes => {
    for (let s: GScope | null = scopeOf(cf, n); s; s = s.parent) {
        const params = arity === 0 && (s.names.get(name) ?? []).some((b) => b.kind === "type");
        if (s.kind === "class") {
            if (params) return PARAM;
            const T = cf.byNode.get(s.node);
            if (!T) return UNKNOWN;
            if (inBody(T, n)) {
                const m = memberType(T, name, arity);
                if (m) return m;
            } else if ((membersOf(T).get(name) ?? []).some((m) => m.kind === "type") || openOf(T)) return UNKNOWN;
            continue;
        }
        if (params) return PARAM;
        if (s.kind === "module") break;
    }
    return namespaceType(cf, n, name, arity);
};

/** A type of the innermost namespace around a node, declared once in its file or in a compiled file of its folder. */
const namespaceType = (cf: CFile, n: number, name: string, arity: number): TypeRes => {
    const ns = cf.nsAt(n);
    const found: CType[] = [];
    for (const g of cf.program.folder(cf.dir)) {
        for (const T of g.types) {
            if (T.outer || T.ns !== ns || T.name !== name || T.arity !== arity || (T.fileLocal && g !== cf)) continue;
            if (g !== cf && !cf.program.compiled(g.path)) return UNKNOWN;
            found.push(T);
        }
    }
    if (!cf.program.folder(cf.dir).includes(cf)) for (const T of cf.types) if (!T.outer && T.ns === ns && T.name === name && T.arity === arity) found.push(T);
    return found.length === 1 && !found[0].partial && !found[0].conditional ? { k: "type", t: found[0] } : UNKNOWN;
};

/**
 * A type nested in a type, declared or inherited (a supertype's private one
 * aside); null when no supertype may hold one. One a part of a partial type
 * declares is the type's: no other part may declare the name again.
 */
export const memberType = (T: CType, name: string, arity: number, depth = 0): TypeRes | null => {
    if (depth > 20) return UNKNOWN;
    const own = (membersOf(T).get(name) ?? []).filter((m) => m.kind === "type" && m.arity === arity && (depth === 0 || m.access !== "private"));
    if (own.length > 0) return own.length === 1 && !own[0].conditional && own[0].nested && !openOf(own[0].nested) ? { k: "type", t: own[0].nested } : UNKNOWN;
    if (openOf(T)) return UNKNOWN;
    const s = supersOf(T);
    let found: TypeRes | null = null;
    for (const x of [s.base, ...(T.kind === "interface" ? s.ifaces : [])]) {
        if (x === undefined) continue;
        if (x === null) return UNKNOWN;
        if ("lib" in x) {
            if (x.names === null) return UNKNOWN;
            continue;
        }
        const m = memberType(x, name, arity, depth + 1);
        if (m && found && !(m.k === "type" && found.k === "type" && m.t === found.t)) return UNKNOWN;
        found = m ?? found;
    }
    return found;
};

/** A type's base class and interfaces as its declaration writes them; null for one not known. An interface has no base (undefined). */
export type Supers = { base: CType | Lib | null | undefined; ifaces: (CType | null)[] };

const superCache = new WeakMap<CType, Supers>();
export const supersOf = (T: CType): Supers => {
    const hit = superCache.get(T);
    if (hit) return hit;
    // A cycle reads as not known.
    superCache.set(T, { base: null, ifaces: [] });
    const t = T.file.t;
    const list = code(t, T.node).find((c) => t.type[c] === "base_list");
    const entries = list === undefined ? [] : code(t, list).filter((c) => t.type[c] !== "argument_list");
    const resolved = entries.map((e) => typeAt(T.file, t.type[e] === "primary_constructor_base_type" ? child(t, e, "type") : e));
    const asType = (r: TypeRes): CType | null => (r.k === "type" ? r.t : null);
    let out: Supers;
    if (T.kind === "enum") out = { base: ENUM, ifaces: [] };
    else if (T.kind === "delegate") out = { base: DELEGATE, ifaces: [] };
    else if (T.kind === "interface") out = { base: undefined, ifaces: resolved.map(asType) };
    else if (T.kind === "struct" || T.value) out = { base: VALUE_TYPE, ifaces: resolved.map(asType) };
    else if (resolved.length === 0) out = { base: OBJECT, ifaces: [] };
    else {
        const first = resolved[0];
        const ft = asType(first);
        if (first.k === "lib") out = { base: first.lib, ifaces: resolved.slice(1).map(asType) };
        else if (ft && ft.kind === "interface") out = { base: OBJECT, ifaces: resolved.map(asType) };
        else if (ft && (ft.kind === "class" || ft.kind === "record") && !ft.value) out = { base: ft, ifaces: resolved.slice(1).map(asType) };
        else out = { base: null, ifaces: resolved.slice(1).map(asType) };
    }
    superCache.set(T, out);
    return out;
};

/** The type a type node names where it is written: a simple name, `Outer.Inner`, `Foo<int>`; unknown for a namespace's name. */
export const typeAt = (cf: CFile, n: number): TypeRes => {
    const t = cf.t;
    if (n < 0) return UNKNOWN;
    switch (t.type[n]) {
        case "identifier":
            return typeName(cf, n, bare(textOf(t, n)), 0);
        case "generic_name":
            return typeName(cf, n, dotted(t, n)[0], arityOf(t, n));
        case "predefined_type":
            return textOf(t, n) === "object" ? { k: "lib", lib: OBJECT } : UNKNOWN;
        case "qualified_name": {
            const q = typeAt(cf, child(t, n, "qualifier"));
            const name = child(t, n, "name");
            if (q.k !== "type") return UNKNOWN;
            return memberType(q.t, dotted(t, name)[0], arityOf(t, name)) ?? UNKNOWN;
        }
        default:
            return UNKNOWN;
    }
};

/**
 * A static type, as overload resolution reads an argument or a parameter:
 * a primitive (an integer constant's value where it is a literal;
 * `variable` where it is surely no constant, which constant conversions
 * need), null, `default`, a type read (with its type arguments), string,
 * object or dynamic, a type written but not known (`written`: the same
 * key, the same type), an array, a nullable value type, a lambda (`fn`),
 * or not known. Nothing that names a type parameter is known: one class's
 * code serves every instantiation.
 */
export type SType =
    | { k: "prim"; name: string; value?: number; variable?: true }
    | { k: "null" }
    | { k: "default" }
    | { k: "type"; t: CType; args?: SType[] }
    | { k: "lib"; name: "string" | "object" | "dynamic" }
    | { k: "written"; key: string }
    | { k: "array"; elem: SType; rank: number }
    | { k: "nullable"; of: SType }
    | { k: "fn" }
    | { k: "unknown" };

export const UNTYPED: SType = { k: "unknown" };
export const STRING: SType = { k: "lib", name: "string" };
export const OBJECT_TYPE: SType = { k: "lib", name: "object" };
/** `dynamic`: a call with an argument of it is bound when it runs. */
export const DYNAMIC: SType = { k: "lib", name: "dynamic" };
export const BOOL: SType = { k: "prim", name: "bool", variable: true };

/** C#'s keywords for primitive types. */
export const PRIMS: ReadonlySet<string> = new Set(["bool", "char", "sbyte", "byte", "short", "ushort", "int", "uint", "long", "ulong", "float", "double", "decimal", "nint", "nuint"]);

/** A type node as a static type, read where it is written. */
export const staticType = (cf: CFile, n: number): SType => {
    const t = cf.t;
    if (n < 0) return UNTYPED;
    const ty = t.type[n];
    if (ty === "predefined_type") {
        const k = textOf(t, n);
        return PRIMS.has(k) ? { k: "prim", name: k } : k === "string" ? STRING : k === "object" ? OBJECT_TYPE : UNTYPED;
    }
    if (ty === "nullable_type") {
        const of = staticType(cf, child(t, n, "type"));
        if (of.k === "prim" || (of.k === "type" && (of.t.value || of.t.kind === "enum"))) return { k: "nullable", of };
        // `Foo?` of a reference type is Foo; of a type not known, its own written type.
        if (of.k === "type" || of.k === "lib") return of;
        return of.k === "written" ? written(cf, n) : UNTYPED;
    }
    if (ty === "array_type") {
        const rank = child(t, n, "rank");
        const elem = staticType(cf, child(t, n, "type"));
        return elem.k === "unknown" ? UNTYPED : { k: "array", elem, rank: 1 + (rank >= 0 ? (textOf(t, rank).match(/,/g) ?? []).length : 0) };
    }
    if (ty === "identifier" || ty === "generic_name" || ty === "qualified_name") {
        // `dynamic` is a contextual keyword: tree-sitter reads it as a name.
        if (ty === "identifier" && textOf(t, n) === "dynamic") return DYNAMIC;
        const r = typeAt(cf, n);
        if (r.k === "type") return ty === "generic_name" ? { k: "type", t: r.t, args: typeArgs(t, n).map((a) => staticType(cf, a)) } : { k: "type", t: r.t };
        return r.k === "unknown" ? written(cf, n) : UNTYPED;
    }
    return UNTYPED;
};

/**
 * A type written but not known, keyed by its text and the class whose
 * code it is in: there, the same text names the same type. Not inside a
 * generic class, nor naming a method's type parameter, where it may name
 * another type for each instantiation.
 */
const written = (cf: CFile, n: number): SType => {
    const text = textOf(cf.t, n).replace(/\s+/g, "");
    let cls = "";
    for (let s: GScope | null = scopeOf(cf, n); s; s = s.parent) {
        const params = [...s.names].filter(([, bs]) => bs.some((b) => b.kind === "type")).map(([name]) => name);
        if (s.kind === "class") {
            if (params.length > 0) return UNTYPED;
            const T = cf.byNode.get(s.node);
            cls ||= T && inBody(T, n) ? `${s.node}` : `${s.node}h`;
        } else if (params.some((v) => new RegExp(`\\b${v}\\b`).test(text))) return UNTYPED;
    }
    return cls ? { k: "written", key: `${cf.path}#${cls}|${text}` } : UNTYPED;
};

/** Whether a type's name means one type wherever it's used: no type around it takes type arguments. */
const closed = (T: CType): boolean => !T.outer || (T.outer.arity === 0 && closed(T.outer));

/** Whether a static type is known exactly: no type parameter, no type written but not known. */
export const exact = (a: SType): boolean => {
    switch (a.k) {
        case "prim":
        case "lib":
            return true;
        case "type":
            return closed(a.t) && (a.args ?? []).length === a.t.arity && (a.args ?? []).every(exact);
        case "array":
            return exact(a.elem);
        case "nullable":
            return exact(a.of);
        default:
            return false;
    }
};

export const sameType = (a: SType, b: SType): boolean => {
    if (a.k !== b.k) return false;
    switch (a.k) {
        case "prim":
        case "lib":
            return a.name === (b as typeof a).name;
        case "written":
            return a.key === (b as typeof a).key;
        case "type": {
            const y = b as typeof a;
            const xa = a.args ?? [];
            const ya = y.args ?? [];
            return a.t === y.t && xa.length === ya.length && xa.every((x, i) => sameType(x, ya[i]));
        }
        case "array":
            return a.rank === (b as typeof a).rank && sameType(a.elem, (b as typeof a).elem);
        case "nullable":
            return sameType(a.of, (b as typeof a).of);
        default:
            return false;
    }
};

/** Whether two static types are surely one type: an identity conversion (C# spec 10.2.2). */
export const identical = (a: SType, b: SType): boolean => sameType(a, b) && (exact(a) || a.k === "written");

/** Whether two static types are surely different types: both known exactly (object and dynamic are one). */
export const differ = (a: SType, b: SType): boolean => exact(a) && exact(b) && !sameType(a, b) && !(a.k === "lib" && b.k === "lib" && a.name !== "string" && b.name !== "string");

export type Fit = "yes" | "no" | "maybe";

/** Each primitive's implicit numeric conversions (C# spec 10.2.3). */
const WIDENING: Record<string, string[]> = {
    sbyte: ["short", "int", "long", "float", "double", "decimal", "nint"],
    byte: ["short", "ushort", "int", "uint", "long", "ulong", "float", "double", "decimal", "nint", "nuint"],
    short: ["int", "long", "float", "double", "decimal", "nint"],
    ushort: ["int", "uint", "long", "ulong", "float", "double", "decimal", "nint", "nuint"],
    int: ["long", "float", "double", "decimal", "nint"],
    uint: ["long", "ulong", "float", "double", "decimal", "nuint"],
    long: ["float", "double", "decimal"],
    ulong: ["float", "double", "decimal"],
    char: ["ushort", "int", "uint", "long", "ulong", "float", "double", "decimal", "nint", "nuint"],
    float: ["double"],
    nint: ["long", "float", "double", "decimal"],
    nuint: ["ulong", "float", "double", "decimal"],
};

export const INTEGRAL: ReadonlySet<string> = new Set(["sbyte", "byte", "short", "ushort", "int", "uint", "long", "ulong", "char", "nint", "nuint"]);

/** The range an int or long constant converts into (C# spec 10.2.11). */
const RANGES: Record<string, [number, number]> = { sbyte: [-128, 127], byte: [0, 255], short: [-32768, 32767], ushort: [0, 65535], uint: [0, 4294967295], ulong: [0, Number.MAX_SAFE_INTEGER] };

/** A primitive to a primitive: identity, a widening, an int or long constant in range; nint and nuint aside. */
const primFits = (a: SType & { k: "prim" }, p: string): Fit => {
    if (a.name === p || (WIDENING[a.name] ?? []).includes(p)) return "yes";
    if (a.name === "nint" || a.name === "nuint" || p === "nint" || p === "nuint") return "maybe";
    const range = RANGES[p];
    if (!range || !(a.name === "int" || (a.name === "long" && p === "ulong"))) return "no";
    if (a.value !== undefined) return a.value >= range[0] && a.value <= range[1] ? "yes" : "no";
    return a.variable ? "no" : "maybe";
};

/**
 * A primitive to an enum: only a constant zero converts (C# spec 10.2.4),
 * of an integer type; in Roslyn of a real one too (`0.0`, `0m`, `1e-50f`),
 * of a char never. Sure only for an integer.
 */
const enumZero = (a: SType & { k: "prim" }): Fit => {
    if (a.name === "bool" || a.variable) return "no";
    if (a.value === undefined || a.name === "char") return "maybe";
    return a.value !== 0 ? "no" : INTEGRAL.has(a.name) ? "yes" : "maybe";
};

/** Whether a type or a type above it declares a user-defined conversion; true where that isn't known. */
export const convertsImplicitly = (T: CType, depth = 0): boolean => {
    if (depth > 20 || openOf(T)) return true;
    const t = T.file.t;
    for (const c of code(t, bodyOf(T))) if (t.type[c] === "conversion_operator_declaration" || t.type[c].startsWith("preproc")) return true;
    const b = supersOf(T).base;
    return b === null || (b !== undefined && !("lib" in b) && convertsImplicitly(b, depth + 1));
};

/** Whether a type is a class's, an interface's or a delegate's: one null converts to. */
export const isReference = (T: CType): boolean => !T.value && T.kind !== "enum";

/** Whether a type is, or provably derives from or implements, another: through declarations that hold in every build. */
export const derives = (a: CType, b: CType, depth = 0): boolean => {
    if (a === b) return true;
    if (depth > 20 || openOf(a)) return false;
    const s = supersOf(a);
    return [s.base, ...s.ifaces].some((x) => !!x && !("lib" in x) && derives(x, b, depth + 1));
};

/** Whether a type's every supertype is known (an interface's too): then no conversion but what they write exists. */
export const knownChain = (T: CType, depth = 0): boolean => {
    if (depth > 20 || openOf(T)) return false;
    const s = supersOf(T);
    return [s.base, ...s.ifaces].every((x) => x === undefined || (x !== null && ("lib" in x ? x.names !== null : knownChain(x, depth + 1))));
};

/** A non-generic type whose name means one type everywhere: what "derives" and "declares no conversion" can be judged on. */
const plain = (a: SType): a is SType & { k: "type" } => a.k === "type" && a.t.arity === 0 && !a.args?.length && closed(a.t);

/**
 * Whether an argument of static type `a` converts to a parameter of type
 * `p` (C# spec 10.2). "yes" only through a conversion that surely exists:
 * identity, a numeric widening, an int constant in range, a reference or
 * boxing conversion to a known supertype or to object, null to a reference
 * type, `default`. "no" only where no conversion can exist, a user-defined
 * one included: between primitives, strings and types whose every
 * supertype is read and declares no conversion operator. Else "maybe".
 */
export const fits = (a: SType, p: SType): Fit => {
    if (identical(a, p) || a.k === "default") return "yes";
    // A ref struct never boxes (to object or an interface it implements, no conversion); to another type only a user-defined one converts it.
    if (a.k === "type" && a.t.refStruct) return "maybe";
    if (a.k === "unknown" || p.k === "unknown" || a.k === "written" || p.k === "written" || (a.k === "lib" && a.name === "dynamic")) return "maybe";
    if (p.k === "lib" && p.name !== "string") {
        // To object or dynamic: anything but a lambda (it may have no natural type).
        return a.k === "fn" ? "maybe" : "yes";
    }
    const userFrom = (x: SType) => x.k === "type" && convertsImplicitly(x.t);
    switch (p.k) {
        case "lib":
            // To string.
            if (a.k === "null") return "yes";
            if (a.k === "type") return userFrom(a) ? "maybe" : "no";
            if (a.k === "nullable") return a.of.k === "prim" ? "no" : "maybe";
            return "no";
        case "prim":
            if (a.k === "prim") return primFits(a, p.name);
            if (a.k === "type") return a.t.kind === "enum" || !userFrom(a) ? "no" : "maybe";
            if (a.k === "nullable") return a.of.k === "prim" || (a.of.k === "type" && !userFrom(a.of)) ? "no" : "maybe";
            return "no";
        case "nullable": {
            if (a.k === "null") return "yes";
            const of = p.of;
            if (of.k === "prim") {
                if (a.k === "prim") {
                    const f = primFits(a, of.name);
                    return f === "yes" && (a.name === of.name || (WIDENING[a.name] ?? []).includes(of.name)) ? "yes" : f === "no" ? "no" : "maybe";
                }
                if (a.k === "nullable" && a.of.k === "prim") return a.of.name === of.name || (WIDENING[a.of.name] ?? []).includes(of.name) ? "yes" : "maybe";
                if (a.k === "lib" || a.k === "array" || a.k === "fn") return "no";
                return a.k === "type" && !userFrom(a) ? "no" : "maybe";
            }
            if (of.k === "type" && a.k === "type" && a.t === of.t && plain(a)) return "yes";
            if (of.k === "type" && of.t.kind === "enum" && a.k === "prim") return enumZero(a) === "no" ? "no" : "maybe";
            return "maybe";
        }
        case "array":
            if (a.k === "null") return "yes";
            if (a.k === "prim" || a.k === "lib" || a.k === "fn") return "no";
            if (a.k === "type") return userFrom(a) ? "maybe" : "no";
            return "maybe";
        case "type": {
            const D = p.t;
            const userTo = convertsImplicitly(D);
            if (a.k === "null") return isReference(D) ? "yes" : D.kind === "enum" || !userTo ? "no" : "maybe";
            if (a.k === "prim") return D.kind === "enum" ? enumZero(a) : D.kind === "interface" || D.kind === "delegate" || !userTo ? "no" : "maybe";
            if (a.k === "lib") return a.name === "object" || D.kind === "enum" || D.kind === "interface" || D.kind === "delegate" || !userTo ? "no" : "maybe";
            if (a.k === "type" && plain(p)) {
                if (derives(a.t, D)) return "yes";
                return plain(a) && knownChain(a.t) && !convertsImplicitly(a.t) && !userTo ? "no" : "maybe";
            }
            return "maybe";
        }
        default:
            return "maybe";
    }
};
