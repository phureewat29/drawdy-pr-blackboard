/**
 * Which method or constructor a call reaches (C# spec 12.6.4, 12.8.10),
 * drawn only where no judgement of types can go wrong. Overload resolution
 * keeps the applicable methods of the most derived type that has any, then
 * picks the better one; the better-member rules (conversions, handlers,
 * priorities) are never applied here. A call links in two ways only:
 *
 * - The first level of the lookup with an applicable method holds exactly
 *   one that surely applies, every other there surely not: the most
 *   derived type's applicable methods are the candidates, and one alone
 *   needs no better-member rule. No extension method answers a call that
 *   has an applicable method.
 * - A bare name or `base.` (which no extension method answers), the lookup
 *   complete: every method of the name but one surely doesn't apply. Code
 *   that compiles calls the one left.
 *
 * A method surely doesn't apply only by counts, names and `ref` kinds, or
 * by types known exactly (`fits`). The line goes to the most derived
 * override along the receiver's type.
 */

import type { GScope } from "../../anyfacts.ts";
import type { Named } from "../../anylink.ts";
import { child, textOf } from "../../syntax.ts";
import { baseOf, exprType, perNode, valueOf } from "./expressions.ts";
import { membersOf, openOf, type CFile, type CMember, type CType } from "./files.ts";
import { lookup, typesAround, type Lookup } from "./members.ts";
import { argsOf, arityOf, bare, code, conditionOf, hasModifier, holdsDirective, isVar, typeArgs, typeParams, type Param } from "./nodes.ts";
import { differ, fits, identical, scopeOf, staticType, UNTYPED, type Fit, type SType } from "./types.ts";

/**
 * An argument as overload resolution reads it: its static type, its
 * modifier, its name; `out var x` and `out _` take any type; an
 * interpolated string (`handler`) may go to a `ref` handler parameter
 * without `ref`.
 */
type ArgT = { type: SType; mod: string; name: string | null; anyOut: boolean; handler: boolean };

const argTypes = (cf: CFile, list: number): ArgT[] => {
    const t = cf.t;
    return argsOf(t, list).map((a) => {
        const decl = t.type[a.expr] === "declaration_expression";
        const ty = decl ? child(t, a.expr, "type") : -1;
        const anyOut = a.mod === "out" && ((decl && isVar(t, ty)) || (t.type[a.expr] === "identifier" && textOf(t, a.expr) === "_"));
        return { type: anyOut ? UNTYPED : decl ? staticType(cf, ty) : exprType(cf, a.expr), mod: a.mod, name: a.name, anyOut, handler: /\$@?"|@\$"/.test(textOf(t, a.expr)) };
    });
};

const isDynamic = (a: ArgT): boolean => a.type.k === "lib" && a.type.name === "dynamic";

/** A parameter's static type, read in its declaration's file. */
const paramType = (m: CMember, p: Param): SType => (p.type >= 0 ? staticType(m.owner.file, p.type) : UNTYPED);

type Pair = { a: ArgT; p: Param; elem: boolean };

/** Each argument's parameter, in a method's normal or expanded form (C# spec 12.6.4.2); null when they don't match. */
const pairsOf = (args: readonly ArgT[], ps: readonly Param[], expanded: boolean): Pair[] | null => {
    const out: Pair[] = [];
    const used = new Set<number>();
    const last = ps.length - 1;
    for (const [k, a] of args.entries()) {
        let j = a.name !== null ? ps.findIndex((p) => p.name === a.name) : k;
        if (a.name === null && expanded && k >= last) j = last;
        if (j < 0 || j > last) return null;
        const elem = expanded && j === last;
        if (used.has(j) && !(elem && a.name === null)) return null;
        used.add(j);
        out.push({ a, p: ps[j], elem });
    }
    for (let j = 0; j <= last; j++) if (!used.has(j) && !ps[j].optional && !(expanded && j === last)) return null;
    return out;
};

/** Whether a type is a COM interface's: its methods take `ref` arguments without `ref`. */
const comImport = (T: CType): boolean => /\bComImport\b/.test(T.file.t.text.slice(T.file.t.start[T.node], T.file.t.start[child(T.file.t, T.node, "name")]));

/** Whether an argument may be passed to a parameter, by its modifier and its type. */
const argFits = (m: CMember, { a, p, elem }: Pair): Fit => {
    const mode = p.mode;
    if ((a.mod === "out") !== (mode === "out")) return "no";
    if (a.mod === "ref" && mode === "") return "no";
    if (a.mod === "in" && (mode === "" || mode === "ref")) return "no";
    if (a.mod === "" && mode === "ref") return a.handler || comImport(m.owner) ? "maybe" : "no";
    if (a.anyOut) return "yes";
    let want = paramType(m, p);
    if (elem) want = want.k === "array" && want.rank === 1 ? want.elem : UNTYPED;
    // A variable passed by reference: its type is the parameter's (`ref` to an `in` parameter only from C# 12).
    if (a.mod !== "") return a.mod === "ref" && mode === "in" ? "maybe" : identical(a.type, want) ? "yes" : differ(a.type, want) ? "no" : "maybe";
    return fits(a.type, want);
};

/**
 * The type arguments a call writes: how many, and whether each is surely
 * no ref struct, which only a type parameter that `allows ref struct`
 * takes (C# 13).
 */
type TypeArgs = { count: number; plain: boolean };

const NO_TYPE_ARGS: TypeArgs = { count: 0, plain: true };

const typeArgsOf = (cf: CFile, gen: number): TypeArgs => {
    if (gen < 0) return NO_TYPE_ARGS;
    const plain = typeArgs(cf.t, gen).every((a) => {
        const s = staticType(cf, a);
        return s.k === "prim" || s.k === "lib" || s.k === "array" || s.k === "nullable" || (s.k === "type" && !s.t.refStruct);
    });
    return { count: arityOf(cf.t, gen), plain };
};

/**
 * Whether a generic method's type arguments may be found: given, unless a
 * constraint (never judged here) may refuse them, a written one or a ref
 * struct's; inferred (C# spec 12.6.3), never for sure, and never for a type
 * parameter no parameter's type names. A method a constraint refuses
 * leaves the call to an extension method.
 */
const typeArgsFit = (m: CMember, targs: TypeArgs): Fit => {
    if (m.arity === 0) return targs.count === 0 ? "yes" : "no";
    const t = m.owner.file.t;
    if (targs.count > 0) return m.arity !== targs.count ? "no" : !targs.plain || code(t, m.node).some((c) => t.type[c] === "type_parameter_constraints_clause") ? "maybe" : "yes";
    const written = m.params.map((p) => (p.type >= 0 ? textOf(t, p.type) : ""));
    if (written.some((x) => x.includes("\\"))) return "maybe";
    const named = new Set(written.flatMap((x) => (x.match(/@?[\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}\p{Cf}]*/gu) ?? []).map(bare)));
    return typeParams(t, m.node).every((v) => named.has(v)) ? "maybe" : "no";
};

/** Whether a method may take the arguments, in its normal form or its expanded one (a `params` parameter taking them one by one). */
const applicable = (m: CMember, args: readonly ArgT[], targs: TypeArgs): Fit => {
    const generic = typeArgsFit(m, targs);
    if (generic === "no") return "no";
    const ps = m.params;
    if (ps.some((p) => p.arglist)) return "maybe";
    const forms = [pairsOf(args, ps, false)];
    if (ps.length > 0 && ps[ps.length - 1].params) forms.push(pairsOf(args, ps, true));
    let fit: Fit = "no";
    for (const pairs of forms) {
        if (!pairs) continue;
        let f: Fit = "yes";
        for (const pair of pairs) {
            const g = argFits(m, pair);
            if (g === "no") {
                f = "no";
                break;
            }
            if (g === "maybe") f = "maybe";
        }
        if (f === "yes") return generic;
        if (f === "maybe") fit = "maybe";
    }
    return fit;
};

/**
 * Whether a method of a lookup may take the arguments. An override more
 * derived than it may give its parameters other names and defaults, which
 * the call uses (C# spec 12.6.4.1): sure only when every one agrees.
 */
const fitOf = (found: Lookup, m: CMember, args: readonly ArgT[], targs: TypeArgs): Fit => {
    const decls = [m];
    for (const level of found.levels) {
        if ("lib" in level || level.owner === m.owner) break;
        for (const o of level.members) if (o.override && o.kind === "method" && o.params.length === m.params.length) decls.push(o);
    }
    const fs = decls.map((d) => applicable(d, args, targs));
    return fs.every((f) => f === fs[0]) ? fs[0] : "maybe";
};

/** Whether two methods' parameters are surely the same types ("same"), surely not, or not known (one needs a type argument put in). */
const signature = (a: CMember, b: CMember): "same" | "different" | "unknown" => {
    if (a.params.length !== b.params.length || a.arity !== b.arity || a.params.some((p, i) => p.mode !== b.params[i].mode)) return "different";
    let all: "same" | "unknown" = "same";
    for (const [i, p] of a.params.entries()) {
        const x = paramType(a, p);
        const y = paramType(b, b.params[i]);
        if (differ(x, y)) return "different";
        if (!identical(x, y)) all = "unknown";
    }
    return all;
};

/** The most derived override of a method along a lookup's levels, more derived than its own; null where one's parameters can't be compared. */
const overrideOf = (found: Lookup, m: CMember): CMember | null => {
    for (const level of found.levels) {
        if ("lib" in level || level.owner === m.owner) break;
        for (const o of level.members) {
            if (!o.override || o.kind !== "method") continue;
            const s = signature(o, m);
            if (s === "unknown") return null;
            if (s === "same") return o;
        }
    }
    return m;
};

/**
 * How a call names its method: bare or through `base.` (no extension
 * method answers), through a value, through a type, or through a name that
 * is both a value and its type's name (`Color Color`, C# spec 12.8.7.2).
 */
type Form = "bare" | "base" | "value" | "type" | "both";

const MEMBERS: ReadonlySet<string> = new Set(["method_declaration", "constructor_declaration", "destructor_declaration", "property_declaration", "indexer_declaration", "event_declaration", "operator_declaration", "conversion_operator_declaration", "field_declaration", "event_field_declaration"]);

/** Whether code at a node surely runs with an instance: in an instance member's body or accessors, in no static lambda or local function. */
const instanceContext = (t: CFile["t"], n: number): boolean => {
    for (let x = n, p = t.parent[n]; p > 0; x = p, p = t.parent[p]) {
        const ty = t.type[p];
        if ((ty === "lambda_expression" || ty === "anonymous_method_expression" || ty === "local_function_statement") && hasModifier(t, p, "static")) return false;
        if (ty === "constructor_initializer" || ty === "parameter_list" || ty === "attribute_list") return false;
        if (MEMBERS.has(ty)) return ["body", "accessors"].includes(t.field[x]) || t.type[x] === "accessor_list" || t.type[x] === "arrow_expression_clause" ? !hasModifier(t, p, "static") && !ty.includes("operator") && !ty.includes("field") : false;
    }
    return false;
};

/**
 * The method a call reaches through a lookup's levels (see the file's
 * comment). C# 7.3 drops a static method called through a value and an
 * instance one called through a type or from a static context (before
 * or after keeping the most derived type's: the line holds either way).
 */
const methodOf = (cf: CFile, n: number, found: Lookup, args: readonly ArgT[], targs: TypeArgs, form: Form): CMember | null => {
    if (args.some(isDynamic)) return null;
    const kept = (m: CMember) => (form === "value" || form === "base" ? !m.isStatic : form === "type" ? m.isStatic : form === "both" || m.isStatic || instanceContext(cf.t, n));
    for (const level of found.levels) {
        if ("lib" in level || level.members.some((m) => m.kind !== "method")) break;
        const cands = level.members.filter((m) => !m.override);
        const fs = cands.map((m) => fitOf(found, m, args, targs));
        if (fs.includes("maybe")) break;
        const yes = cands.filter((_, i) => fs[i] === "yes");
        if (yes.length === 0) continue;
        const ok = yes.filter(kept);
        return ok.length === 1 && (yes.length === 1 || form === "value" || form === "base" || form === "type") ? overrideOf(found, ok[0]) : null;
    }
    if ((form !== "bare" && form !== "base") || !found.complete) return null;
    const live: CMember[] = [];
    for (const level of found.levels) {
        if ("lib" in level || level.members.some((m) => m.kind !== "method")) return null;
        for (const m of level.members) if (!m.override && fitOf(found, m, args, targs) !== "no") live.push(m);
    }
    return live.length === 1 ? overrideOf(found, live[0]) : null;
};

/** Whether a name is a local, a parameter or a local function where it's called: then no member. */
const boundLocally = (cf: CFile, n: number, name: string): boolean => {
    for (let s: GScope | null = scopeOf(cf, n); s; s = s.parent) if ((s.names.get(name) ?? []).some((b) => b.kind !== "type")) return true;
    return false;
};

/** The method a call's name reaches, or null. */
export const callOf: (cf: CFile, nameNode: number) => CMember | null = perNode(null, (cf, n) => {
    const t = cf.t;
    const gen = t.type[t.parent[n]] === "generic_name" ? t.parent[n] : -1;
    const e = gen >= 0 ? gen : n;
    const targs = typeArgsOf(cf, gen);
    const name = bare(textOf(t, n));
    let p = t.parent[e];
    let call: number;
    let found: Lookup | null = null;
    let form: Form;
    if (t.type[p] === "invocation_expression") {
        call = p;
        form = "bare";
        if (boundLocally(cf, n, name)) return null;
        for (const T of typesAround(cf, n)) {
            const l = lookup(T, name, cf, n, "self");
            if (l.levels.length > 0) {
                found = l;
                break;
            }
            if (!l.complete) return null;
        }
    } else {
        let recv: number;
        if (t.type[p] === "member_access_expression") recv = child(t, p, "expression");
        else if (t.type[p] === "member_binding_expression") {
            const cond = t.parent[p];
            recv = t.type[cond] === "conditional_access_expression" ? conditionOf(t, cond) : -1;
            p = cond;
        } else return null;
        call = t.parent[p];
        if (t.type[call] !== "invocation_expression" || recv < 0) return null;
        let T: CType | null = null;
        if (t.type[recv] === "base") {
            T = baseOf(cf, recv);
            form = "base";
        } else {
            const v = valueOf(cf, recv);
            if (v.k === "type") {
                T = v.t;
                form = "type";
            } else if (v.k === "value" && v.type.k === "type") {
                T = v.type.t;
                // `Color.M()` where Color is a value of a type named Color: either may be meant (C# spec 12.8.7.2).
                form = t.type[recv] === "identifier" && bare(textOf(t, recv)) === T.name ? "both" : "value";
            } else return null;
        }
        if (!T) return null;
        found = lookup(T, name, cf, n, form === "type" ? "type" : form === "base" ? "self" : "value");
    }
    const list = child(t, call, "arguments");
    if (!found || holdsDirective(t, list)) return null;
    return methodOf(cf, n, found, argTypes(cf, list), targs, form);
});

/**
 * Whether code at a node may call a constructor (C# spec 7.5.3): a private
 * one from its type's text; a protected one also from a derived class's
 * `base(…)`, never through `new` (C# spec 7.5.4).
 */
const ctorAccess = (cf: CFile, n: number, m: CMember, via: "new" | "base" | "this"): Fit => {
    if (m.access === "public" || m.access === "internal" || m.access === "protected internal") return "yes";
    if (typesAround(cf, n).includes(m.owner)) return "yes";
    return m.access !== "private" && via === "base" ? "yes" : "no";
};

/**
 * The constructor a creation (`new T(…)`, a base type's arguments, `this(…)`
 * and `base(…)`) reaches with the arguments of `list`, as a site names it: a
 * declared one, or its type's card for an implicit or a primary one.
 * Constructors are a type's own and no extension method makes an object:
 * the one that may apply, if alone, is the one code that compiles calls.
 */
export const ctorOf = (cf: CFile, n: number, T: CType, list: number, via: "new" | "base" | "this"): Named => {
    if (openOf(T) || T.kind === "interface" || T.kind === "enum" || T.kind === "delegate" || !T.unit || holdsDirective(cf.t, list)) return [];
    const args = argTypes(cf, list);
    if (args.some(isDynamic)) return [];
    const ctors = (membersOf(T).get(T.name) ?? []).filter((m) => m.kind === "ctor" && !m.isStatic);
    if (ctors.some((m) => m.conditional)) return [];
    // A record's copy constructor takes one argument too.
    if (T.kind === "record" && args.length === 1) return [];
    // No constructor written: the implicit one, which takes no argument; a struct's `new S()` is its default value whatever it declares.
    if (ctors.length === 0 || (T.value && args.length === 0 && !ctors.some((m) => m.params.length === 0))) return args.length === 0 ? [{ ref: "call", units: [T.unit] }] : [];
    const live: CMember[] = [];
    for (const m of ctors) if (ctorAccess(cf, n, m, via) === "yes" && applicable(m, args, NO_TYPE_ARGS) !== "no") live.push(m);
    const m = live.length === 1 ? live[0] : null;
    const u = m?.unit ?? (m?.implicit ? T.unit : undefined);
    return u ? [{ ref: "call", units: [u], ...(u !== T.unit ? { alt: T.unit } : {}) }] : [];
};
