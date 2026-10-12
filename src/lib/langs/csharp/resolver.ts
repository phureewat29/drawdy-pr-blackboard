/**
 * C#'s resolver. C#'s names don't follow the generic resolver's scopes, so
 * C# brings its own: the C# spec's rules (chapters 7, 12.5, 12.6 and 12.8),
 * where the files read prove them for code that compiles. What they can't
 * prove names nothing, and so does a site inside `#if`, in a file its
 * project may not compile (`msbuild.ts`), or in a file tree-sitter may have
 * read otherwise than the compiler (`doubtOf`). A type name goes through
 * `types.ts`, a name before `.` through `expressions.ts`, a call through
 * `calls.ts`.
 */

import type { GSite } from "../../anyfacts.ts";
import type { Named, OwnResolver } from "../../anylink.ts";
import { child, textOf } from "../../syntax.ts";
import type { Unit } from "../pack.ts";
import { callOf, ctorOf } from "./calls.ts";
import { baseOf, meaningOf, valueOf } from "./expressions.ts";
import { readFiles, type CFile, type CMember, type CType } from "./files.ts";
import { lookup, typesAround } from "./members.ts";
import { compiled } from "./msbuild.ts";
import { argumentList, arityOf, bare, conditional, dotted, hasModifier } from "./nodes.ts";
import { creationOf, primaryBase } from "./rules.ts";
import { typeAt, type TypeRes } from "./types.ts";

const named = (u: Unit | undefined, ref: Named[number]["ref"]): Named => (u ? [{ ref, units: [u] }] : []);

const typeLink = (r: TypeRes): Named => (r.k === "type" ? named(r.t.unit, "type") : []);

/** A member as a value names: a property's card, a nested type's (of the arity written); a field, an event, a method group none. */
const memberLink = (m: CMember | undefined, arity: number): Named => {
    if (!m) return [];
    if (m.kind === "type") return m.arity === arity ? named(m.nested?.unit, "type") : [];
    return m.kind === "property" && !m.implicit ? named(m.unit, "value") : [];
};

/** The type a receiver node is or holds a value of. */
const typeOfReceiver = (cf: CFile, recv: number): { T: CType; via: "self" | "type" | "value" } | null => {
    const t = cf.t;
    if (t.type[recv] === "base") {
        const B = baseOf(cf, recv);
        return B ? { T: B, via: "self" } : null;
    }
    if (t.type[recv] === "object_creation_expression") {
        const r = typeAt(cf, child(t, recv, "type"));
        return r.k === "type" ? { T: r.t, via: "value" } : null;
    }
    const v = valueOf(cf, recv);
    if (v.k === "type") return { T: v.t, via: "type" };
    return v.k === "value" && v.type.k === "type" ? { T: v.type.t, via: v.self ? "self" : "value" } : null;
};

/** The one member a lookup's first level holds, or none. */
const firstMember = (cf: CFile, n: number, T: CType, name: string, via: "self" | "type" | "value"): CMember | undefined => {
    const found = lookup(T, name, cf, n, via, true);
    const first = found.levels[0];
    return first && !("lib" in first) && first.members.length === 1 ? first.members[0] : undefined;
};

/**
 * The type `new(…)` makes, where the code writes it for sure: an explicitly
 * typed variable, field or property it initialises, the method or local
 * function (not async) it is returned from, a variable it is assigned to in
 * a statement of its own. Never in an object or collection initializer,
 * whose names are members of what is made.
 */
const targetType = (cf: CFile, creation: number): CType | null => {
    const t = cf.t;
    let p = t.parent[creation];
    if (t.type[p] === "arrow_expression_clause") p = t.parent[p];
    if (t.type[p] === "return_statement") {
        p = t.parent[p];
        while (p > 0 && !["method_declaration", "local_function_statement", "lambda_expression", "anonymous_method_expression", "accessor_declaration", "property_declaration", "constructor_declaration"].includes(t.type[p])) p = t.parent[p];
    }
    let r: TypeRes | null = null;
    if (t.type[p] === "variable_declarator") r = typeAt(cf, child(t, t.parent[p], "type"));
    else if (t.type[p] === "property_declaration") r = typeAt(cf, child(t, p, "type"));
    else if ((t.type[p] === "method_declaration" || t.type[p] === "local_function_statement") && !hasModifier(t, p, "async")) r = typeAt(cf, child(t, p, t.type[p] === "method_declaration" ? "returns" : "type"));
    else if (t.type[p] === "assignment_expression" && t.field[creation] === "right" && t.type[t.parent[p]] === "expression_statement" && t.type[child(t, p, "operator")] === "=") {
        const v = valueOf(cf, child(t, p, "left"));
        return v.k === "value" && v.type.k === "type" && !v.type.args ? v.type.t : null;
    }
    return r?.k === "type" ? r.t : null;
};

/** The names of the types C#'s keywords stand for. */
const KEYWORD_TYPES: Record<string, string> = { bool: "Boolean", char: "Char", sbyte: "SByte", byte: "Byte", short: "Int16", ushort: "UInt16", int: "Int32", uint: "UInt32", long: "Int64", ulong: "UInt64", float: "Single", double: "Double", decimal: "Decimal", string: "String", object: "Object", nint: "IntPtr", nuint: "UIntPtr" };

/**
 * Whether a member's type surely has another name than the member's: then
 * `Name.X` reads the member, never a type of that name (`Color Color`, C#
 * spec 12.8.7.2). A keyword names its type (`string String`); a generic or
 * qualified name ends in its type's own name; a lone name another type's
 * only if a type read, else it may be an alias, a global one unread.
 */
const otherName = (m: CMember, name: string): boolean => {
    const t = m.owner.file.t;
    let x = m.type;
    while (x >= 0 && t.type[x] === "nullable_type") x = child(t, x, "type");
    if (x < 0) return false;
    switch (t.type[x]) {
        case "predefined_type":
            return KEYWORD_TYPES[textOf(t, x)] !== name;
        case "generic_name":
        case "qualified_name":
            return dotted(t, x).pop() !== name;
        case "identifier": {
            const r = typeAt(m.owner.file, x);
            return r.k === "type" && r.t.name !== name;
        }
        default:
            return t.type[x] === "array_type" || t.type[x] === "tuple_type";
    }
};

/** Whether a node sits in a constant pattern (`x is Foo.Bar`, `case Foo:`), which C# may read as a type first. */
const inConstantPattern = (t: CFile["t"], n: number): boolean => {
    for (let x = t.parent[n]; x >= 0 && t.type[x] !== "switch_section" && !t.type[x].endsWith("_statement"); x = t.parent[x]) if (t.type[x] === "constant_pattern") return true;
    return false;
};

/**
 * What a site names, and how: nothing in a file tree-sitter may have read
 * otherwise, inside `#if`, or in a file its project may not compile. A
 * constant pattern (`x is Foo.Bar`, `case Foo:`) reads as a type where it
 * can (C# spec 11.2.3): there, only a type no local or member's name hides.
 */
const resolveSite = (cf: CFile, s: GSite): Named => {
    const t = cf.t;
    const n = s.node;
    if (cf.doubt || conditional(t, n) || !cf.program.compiled(cf.path)) return [];
    if (!inConstantPattern(t, n)) return resolveNamed(cf, s);
    if (s.ref === "call" || (s.shape === "member" && typeOfReceiver(cf, s.receiver)?.via !== "type") || (s.shape === "bare" && s.ref === "value" && meaningOf(cf, n, s.name).k !== "type")) return [];
    return resolveNamed(cf, s).filter((x) => x.ref === "type");
};

/** What a site of a file read for sure names. */
const resolveNamed = (cf: CFile, s: GSite): Named => {
    const t = cf.t;
    const n = s.node;
    const ty = t.type[n];
    // `this(…)` and `base(…)`.
    if (ty === "this" || ty === "base") {
        const target = ty === "base" ? baseOf(cf, n) : typesAround(cf, n)[0];
        return target ? ctorOf(cf, n, target, argumentList(t, t.parent[n]), ty) : [];
    }
    // `Foo x = new(…)`.
    if (ty === "new") {
        const T = targetType(cf, t.parent[n]);
        return T ? ctorOf(cf, n, T, argumentList(t, t.parent[n]), "new") : [];
    }
    const e = t.type[t.parent[n]] === "generic_name" ? t.parent[n] : n;
    // `new Foo(…)`: the type, and its constructor the arguments reach; a primary constructor's base type, the same.
    const creation = creationOf(t, n);
    const base = creation < 0 ? primaryBase(t, n) : -1;
    if (creation >= 0 || base >= 0) {
        const r = typeAt(cf, creation >= 0 ? child(t, creation, "type") : t.type[t.parent[e]] === "qualified_name" ? t.parent[e] : e);
        if (r.k !== "type") return [];
        return [...typeLink(r), ...ctorOf(cf, n, r.t, creation >= 0 ? argumentList(t, creation) : base, creation >= 0 ? "new" : "base")];
    }
    if (s.ref === "call") return named(callOf(cf, n)?.unit, "call");
    if (s.shape === "member") {
        const r = typeOfReceiver(cf, s.receiver);
        return r ? memberLink(firstMember(cf, n, r.T, s.name, r.via), arityOf(t, e)) : [];
    }
    if (s.shape === "path") return typeLink(typeAt(cf, t.parent[e]));
    if (s.ref === "type") return typeLink(typeAt(cf, e));
    // A name standing for a value: a member of a type around, else a type; a generic one a type only where no member takes the name (a method group `M<int>`).
    const m = meaningOf(cf, n, s.name);
    if (m.k === "type") return e !== n ? typeLink(typeAt(cf, e)) : typeLink(m.res);
    if (m.k !== "member" || e !== n) return [];
    const first = m.found.levels[0];
    const x = first && !("lib" in first) && first.members.length === 1 ? first.members[0] : undefined;
    // `Color.Red` where a property `Color` is of type Color: before `.`, the name may mean the type.
    const before = t.type[t.parent[n]] === "member_access_expression" && t.field[n] === "expression";
    if (before && x && x.kind !== "type" && !otherName(x, s.name)) return [];
    return memberLink(x, 0);
};

const program: OwnResolver["program"] = (files, ctx) => {
    const cfileOf = readFiles(files, (path) => compiled(path, ctx));
    // A site reaches only a unit of its name (`@x` is `x`); `this(…)`, `base(…)` and `new(…)` a constructor.
    const names = new Set(["this", "base", "new"]);
    for (const f of files) for (const u of f.units) names.add(bare(u.name));
    return (f, s) => {
        const name = bare(s.name);
        return names.has(name) ? resolveSite(cfileOf(f), name === s.name ? s : { ...s, name }) : [];
    };
};

export const CSHARP_RESOLVER: OwnResolver = { program };
