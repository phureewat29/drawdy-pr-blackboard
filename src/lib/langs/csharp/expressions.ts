/**
 * What a C# expression is: its static type, which tells overloads apart
 * (`exprType`), and what it is as a receiver (`valueOf`): a value of a
 * static type, or a type. A simple name is a local, a parameter or a local
 * function of the code around it, then a member of a type around it
 * (declared or inherited), then a type (C# spec 12.8.4). Expressions and
 * calls (`calls.ts`) resolve each other.
 */

import type { GBinding, GScope } from "../../anyfacts.ts";
import { child, textOf } from "../../syntax.ts";
import { callOf } from "./calls.ts";
import type { CFile, CMember, CType } from "./files.ts";
import { lookup, typesAround, type Lookup } from "./members.ts";
import { bare, code, hasModifier, swallows, tight } from "./nodes.ts";
import { BOOL, scopeOf, staticType, STRING, supersOf, typeAt, typeName, UNTYPED, type SType, type TypeRes } from "./types.ts";

/** Caches `read` per file and node; a node asked for again while its value is being made gets `cycle`. */
export const perNode = <V>(cycle: V, read: (cf: CFile, n: number) => V): ((cf: CFile, n: number) => V) => {
    const cache = new WeakMap<CFile, Map<number, V>>();
    return (cf, n) => {
        let byNode = cache.get(cf);
        if (!byNode) cache.set(cf, (byNode = new Map()));
        if (byNode.has(n)) return byNode.get(n)!;
        byNode.set(n, cycle);
        const value = read(cf, n);
        byNode.set(n, value);
        return value;
    };
};

/** What a simple name means at a node: a binding of the code around it, a member of a type around it (the levels found), a type, or nothing sure. */
export type Meaning = { k: "local"; b: GBinding } | { k: "member"; T: CType; found: Lookup } | { k: "type"; res: TypeRes } | { k: "unknown" };
const UNSURE: Meaning = { k: "unknown" };

export const meaningOf = (cf: CFile, n: number, name: string): Meaning => {
    for (let s: GScope | null = scopeOf(cf, n); s; s = s.parent) {
        const bs = s.names.get(name) ?? [];
        // A type parameter, which a type around declares before its members (C# spec 12.8.4); a primary constructor's parameter, which a member may hide or not.
        if (bs.some((b) => b.kind === "type") || (s.kind === "class" && bs.length > 0)) return UNSURE;
        if (s.kind === "class") continue;
        // A local of a top-level statement too.
        if (bs.length > 0) return bs.length === 1 ? { k: "local", b: bs[0] } : UNSURE;
    }
    for (const T of typesAround(cf, n)) {
        const found = lookup(T, name, cf, n, "self", true);
        if (found.levels.length > 0) return { k: "member", T, found };
        if (!found.complete) return UNSURE;
    }
    return { k: "type", res: typeName(cf, n, name, 0) };
};

/** Statements whose pattern and out variables stay in scope after them, in their block. */
const LEAKY: ReadonlySet<string> = new Set(["expression_statement", "local_declaration_statement", "if_statement", "return_statement", "throw_statement", "yield_statement"]);

/** A primitive that is surely no constant: a variable's, a call's. */
const variable = (s: SType): SType => (s.k === "prim" ? { k: "prim", name: s.name, variable: true } : s);

/** A binding's static type at a node: its written type, a `var`'s value's; a pattern's or an out variable's only where its statement keeps it in scope. A `const` local is a constant, any other a variable. */
const bindingType = (cf: CFile, b: GBinding, at: number): SType => {
    const t = cf.t;
    const decl = t.parent[b.node];
    if (["declaration_pattern", "recursive_pattern", "declaration_expression"].includes(t.type[decl])) {
        let stmt = decl;
        while (stmt > 0 && !t.type[stmt].endsWith("_statement")) stmt = t.parent[stmt];
        const inside = t.start[stmt] <= t.start[at] && t.end[at] <= t.end[stmt];
        if (!inside && !LEAKY.has(t.type[stmt])) return UNTYPED;
    }
    const constant = t.type[decl] === "variable_declarator" && hasModifier(t, t.parent[t.parent[decl]], "const");
    if (b.typeNode !== undefined) return constant ? staticType(cf, b.typeNode) : variable(staticType(cf, b.typeNode));
    if (b.init !== undefined) return variable(exprType(cf, b.init));
    return UNTYPED;
};

/** A member's static type as a value: a field's, a property's or a constant's written type, an enum member's enum; a method group or a type has none. */
export const memberType = (m: CMember): SType => {
    if (m.kind === "constant") return m.owner.kind === "enum" ? { k: "type", t: m.owner } : staticType(m.owner.file, m.type);
    return m.kind === "field" || m.kind === "property" || m.kind === "event" ? variable(staticType(m.owner.file, m.type)) : UNTYPED;
};

/** What an expression is as a receiver: a value of a static type, a type, or nothing sure. */
export type Val = { k: "value"; type: SType; self: boolean } | { k: "type"; t: CType } | { k: "unknown" };
const NOTHING: Val = { k: "unknown" };

const fromRes = (r: TypeRes): Val => (r.k === "type" ? { k: "type", t: r.t } : NOTHING);

/** The one member a level of a lookup holds, a field's or a property's, or none. */
const lone = (found: Lookup): CMember | null => {
    const first = found.levels[0];
    return first && !("lib" in first) && first.members.length === 1 ? first.members[0] : null;
};

/** A member as a receiver: a value of its type, or the nested type it is (a generic one never names a bare name). */
const memberVal = (x: CMember | null): Val => (!x ? NOTHING : x.kind === "type" ? (x.nested && x.arity === 0 ? { k: "type", t: x.nested } : NOTHING) : { k: "value", type: memberType(x), self: false });

export const valueOf: (cf: CFile, e: number) => Val = perNode(NOTHING, (cf, e) => {
    const t = cf.t;
    switch (t.type[e]) {
        case "this": {
            const T = typesAround(cf, e)[0];
            return T ? { k: "value", type: { k: "type", t: T }, self: true } : NOTHING;
        }
        case "identifier": {
            const m = meaningOf(cf, e, bare(textOf(t, e)));
            if (m.k === "local") return { k: "value", type: bindingType(cf, m.b, e), self: false };
            if (m.k === "type") return fromRes(m.res);
            return m.k === "member" ? memberVal(lone(m.found)) : NOTHING;
        }
        case "generic_name":
        case "qualified_name":
            return fromRes(typeAt(cf, e));
        case "parenthesized_expression":
            return valueOf(cf, code(t, e)[0] ?? -1);
        case "member_access_expression": {
            const q = child(t, e, "expression");
            const nameNode = child(t, e, "name");
            if (t.type[q] === "base" || t.type[nameNode] !== "identifier") return NOTHING;
            const recv = valueOf(cf, q);
            if (recv.k === "unknown") return NOTHING;
            const T = recv.k === "type" ? recv.t : recv.type.k === "type" ? recv.type.t : null;
            if (!T) return NOTHING;
            return memberVal(lone(lookup(T, bare(textOf(t, nameNode)), cf, nameNode, recv.k === "type" ? "type" : recv.self ? "self" : "value", true)));
        }
        default: {
            const type = exprType(cf, e);
            return type.k === "unknown" ? NOTHING : { k: "value", type, self: false };
        }
    }
});

const INT_MAX = 2n ** 31n - 1n;
const UINT_MAX = 2n ** 32n - 1n;
const LONG_MAX = 2n ** 63n - 1n;

/** An integer literal's type and value (C# spec 6.4.5.3). */
const integerType = (text: string): SType => {
    const s = text.replace(/_/g, "").toLowerCase();
    const suffix = /(ul|lu|u|l)$/.exec(s)?.[1] ?? "";
    const digits = s.slice(0, s.length - suffix.length);
    let v: bigint;
    try {
        v = BigInt(/^0[xb]/.test(digits) ? digits : digits.replace(/^0+(?=\d)/, ""));
    } catch {
        return UNTYPED;
    }
    const name = suffix === "" ? (v <= INT_MAX ? "int" : v <= UINT_MAX ? "uint" : v <= LONG_MAX ? "long" : "ulong") : suffix === "u" ? (v <= UINT_MAX ? "uint" : "ulong") : suffix === "l" ? (v <= LONG_MAX ? "long" : "ulong") : "ulong";
    return v <= BigInt(Number.MAX_SAFE_INTEGER) ? { k: "prim", name, value: Number(v) } : { k: "prim", name };
};

const FLOATING = ["decimal", "double", "float"];

/** Binary numeric promotion (C# spec 12.4.7.3) of two primitives other than bool, nint and nuint. */
const promoted = (a: string, b: string): string => {
    for (const n of ["decimal", "double", "float", "ulong", "long"]) if (a === n || b === n) return n;
    if (a === "uint" || b === "uint") return ["sbyte", "short", "int"].includes(a === "uint" ? b : a) ? "long" : "uint";
    return "int";
};

/** A primitive's type after `+`, `-` or `~` and as a shift's left operand (C# spec 12.4.7.2). */
const unaryPromoted = (a: string): string => (["sbyte", "byte", "short", "ushort", "char"].includes(a) ? "int" : a);

/** A binary operator's result on primitives (C# spec 12.12): only where no user-defined operator can take part; a variable where an operand is one. */
const binaryType = (op: string, a: SType, b: SType): SType => {
    if (a.k !== "prim" || b.k !== "prim") {
        const plain = (x: SType) => x.k === "prim" || x.k === "null" || (x.k === "lib" && x.name === "string");
        return op === "+" && plain(a) && plain(b) && ((a.k === "lib" && a.name === "string") || (b.k === "lib" && b.name === "string")) ? STRING : UNTYPED;
    }
    const flag = (s: SType & { k: "prim" }): SType => (a.variable || b.variable ? { ...s, variable: true } : s);
    if (["==", "!=", "<", ">", "<=", ">="].includes(op)) return BOOL;
    if (a.name === "bool" || b.name === "bool") return a.name === b.name && ["&", "|", "^", "&&", "||"].includes(op) ? BOOL : UNTYPED;
    if ([a.name, b.name].some((x) => x === "nint" || x === "nuint")) return UNTYPED;
    if (op === "<<" || op === ">>" || op === ">>>") return FLOATING.includes(a.name) ? UNTYPED : flag({ k: "prim", name: unaryPromoted(a.name) });
    if (["&", "|", "^"].includes(op) && (FLOATING.includes(a.name) || FLOATING.includes(b.name))) return UNTYPED;
    return ["+", "-", "*", "/", "%", "&", "|", "^"].includes(op) ? flag({ k: "prim", name: promoted(a.name, b.name) }) : UNTYPED;
};

/** A prefix operator's result: `+`, `-`, `~` and `!` on primitives, `++` and `--`; a literal's value carried for constant conversions. */
const prefixType = (cf: CFile, e: number): SType => {
    const t = cf.t;
    const operand = code(t, e)[0] ?? -1;
    const op = t.type[t.first[e]];
    const a = exprType(cf, operand);
    if (a.k !== "prim") return UNTYPED;
    if (op === "!") return a.name === "bool" ? BOOL : UNTYPED;
    if (op === "++" || op === "--") return variable(a);
    if ((op !== "-" && op !== "+" && op !== "~") || a.name === "bool" || a.name === "nint" || a.name === "nuint" || (op === "~" && FLOATING.includes(a.name))) return UNTYPED;
    // `-2147483648` and `-9223372036854775808` are int's and long's least values (C# spec 6.4.5.3).
    if (op === "-" && t.type[operand] === "integer_literal" && !/[ul]$|^0[xb]/i.test(textOf(t, operand))) {
        const v = BigInt(textOf(t, operand).replace(/_/g, "").replace(/^0+(?=\d)/, "") || "0");
        if (v === INT_MAX + 1n) return { k: "prim", name: "int", value: -2147483648 };
        if (v === LONG_MAX + 1n) return { k: "prim", name: "long" };
    }
    if (op === "-" && a.name === "ulong") return UNTYPED;
    const name = op === "-" && a.name === "uint" ? "long" : unaryPromoted(a.name);
    const value = a.value === undefined || (op === "~" && name !== "int") ? undefined : op === "-" ? -a.value : op === "~" ? ~a.value : a.value;
    return { k: "prim", name, ...(value !== undefined ? { value } : {}), ...(a.variable ? { variable: true as const } : {}) };
};

/**
 * An expression's static type, where its form says it for sure: a literal
 * (a u8 string's and an interpolated one's are other types), `this`, a
 * creation, a cast, a variable's, a field's or a property's written type, a
 * method's written result, an operator on primitives. A target-typed form
 * (`new()`, `a ? b : c`, a switch, a collection, a tuple, `throw`) has
 * none: what it converts to isn't its natural type's.
 */
export const exprType: (cf: CFile, e: number) => SType = perNode(UNTYPED, (cf, e) => {
    const t = cf.t;
    if (e < 0) return UNTYPED;
    switch (t.type[e]) {
        case "integer_literal":
            return integerType(textOf(t, e));
        case "real_literal": {
            // Its value where every real type keeps it: zero, or too large to round to zero (a float's least is 1.4e-45, a decimal's 1e-28).
            const s = textOf(t, e).toLowerCase().replace(/_/g, "");
            const value = Number(s.replace(/[fdm]$/, ""));
            return { k: "prim", name: s.endsWith("f") ? "float" : s.endsWith("m") ? "decimal" : "double", ...(value === 0 || (Number.isFinite(value) && Math.abs(value) >= 1e-27) ? { value } : {}) };
        }
        case "character_literal":
            return { k: "prim", name: "char" };
        case "boolean_literal":
            return BOOL;
        case "null_literal":
            return { k: "null" };
        case "string_literal":
        case "verbatim_string_literal":
        case "raw_string_literal":
            return /u8$/i.test(textOf(t, e)) ? UNTYPED : STRING;
        case "default_expression": {
            const ty = child(t, e, "type");
            const s = ty >= 0 ? staticType(cf, ty) : { k: "default" as const };
            return s.k === "prim" ? { k: "prim", name: s.name, value: 0 } : s;
        }
        case "this":
        case "identifier":
        case "member_access_expression": {
            const v = valueOf(cf, e);
            return v.k === "value" ? v.type : UNTYPED;
        }
        case "parenthesized_expression":
        case "checked_expression":
            return exprType(cf, code(t, e)[0] ?? -1);
        case "cast_expression": {
            const s = staticType(cf, child(t, e, "type"));
            const inner = exprType(cf, child(t, e, "value"));
            return s.k === "prim" ? { k: "prim", name: s.name, ...(inner.k === "prim" && inner.variable ? { variable: true as const } : {}) } : s;
        }
        // `x as T`, `x is T`: unless tree-sitter took a looser operator into them (`a ?? b as T`, `x is null || y`).
        case "as_expression":
            return tight(t, child(t, e, "left")) ? staticType(cf, child(t, e, "right")) : UNTYPED;
        case "is_expression":
            return tight(t, child(t, e, "left")) ? BOOL : UNTYPED;
        case "is_pattern_expression":
            return tight(t, child(t, e, "expression")) && !swallows(t, child(t, e, "pattern")) ? BOOL : UNTYPED;
        case "object_creation_expression":
        case "array_creation_expression":
            return variable(staticType(cf, child(t, e, "type")));
        case "lambda_expression":
        case "anonymous_method_expression":
            return { k: "fn" };
        case "binary_expression":
            return binaryType(t.type[child(t, e, "operator")], exprType(cf, child(t, e, "left")), exprType(cf, child(t, e, "right")));
        case "prefix_unary_expression":
            return prefixType(cf, e);
        case "postfix_unary_expression": {
            const op = t.type[t.next[code(t, e)[0] ?? -1] ?? -1];
            const a = exprType(cf, code(t, e)[0] ?? -1);
            return op === "!" ? a : (op === "++" || op === "--") && a.k === "prim" ? variable(a) : UNTYPED;
        }
        case "invocation_expression": {
            const fn = child(t, e, "function");
            if (t.type[fn] === "identifier" && textOf(t, fn) === "nameof") return STRING;
            // `x?.M()`: M's result, or null.
            if (t.type[fn] === "conditional_access_expression") return UNTYPED;
            const name = calleeName(t, fn);
            const m = name >= 0 ? callOf(cf, name) : null;
            return m && m.kind === "method" ? variable(staticType(m.owner.file, m.type)) : UNTYPED;
        }
        default:
            return UNTYPED;
    }
});

/** The name node an invocation's function ends in: `M`, `x.M`, `x?.M`, `M<T>`. */
export const calleeName = (t: CFile["t"], fn: number): number => {
    let x = fn;
    if (t.type[x] === "member_access_expression") x = child(t, x, "name");
    else if (t.type[x] === "conditional_access_expression") x = child(t, code(t, x).find((c) => t.type[c] === "member_binding_expression") ?? -1, "name");
    if (x >= 0 && t.type[x] === "generic_name") x = code(t, x)[0] ?? -1;
    return x >= 0 && t.type[x] === "identifier" ? x : -1;
};

/** `base` in a type: its base class. */
export const baseOf = (cf: CFile, n: number): CType | null => {
    const T = typesAround(cf, n)[0];
    const b = T ? supersOf(T).base : null;
    return b && !("lib" in b) ? b : null;
};
