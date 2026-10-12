/**
 * Which receivers an inherent impl lends its methods to: an impl for some of
 * a generic type's instances (`impl Packed<FlowElem>`) only to a receiver
 * proven one of them.
 */

import { scopeAround, type GFile, type GScope } from "../../anyfacts.ts";
import type { Typing } from "../../anylink.ts";
import { child, namedChildren, textOf, type Flat } from "../../syntax.ts";
import { selfClass } from "./nodes.ts";

/** The inherent impl a function is a method of, or -1. */
const inherentImpl = (t: Flat, fn: number): number => {
    const list = t.parent[fn];
    const impl = list >= 0 && t.type[list] === "declaration_list" ? t.parent[list] : -1;
    return impl >= 0 && t.type[impl] === "impl_item" && child(t, impl, "trait") < 0 ? impl : -1;
};

/** A type's arguments, lifetimes left out: `Packed<'a, FlowElem>` has one. */
const typeArgs = (t: Flat, type: number): number[] =>
    t.type[type] === "generic_type" ? namedChildren(t, child(t, type, "type_arguments")).filter((c) => t.type[c] !== "lifetime" && !t.type[c].endsWith("comment")) : [];

/** The names of an impl's own type and const parameters. */
const ownParams = (t: Flat, impl: number): Set<string> =>
    new Set(namedChildren(t, child(t, impl, "type_parameters")).flatMap((p) => (t.type[p] === "type_parameter" || t.type[p] === "const_parameter" ? [textOf(t, child(t, p, "name"))] : [])));

/** Whether an impl is for every instance of its type: each argument it writes is one of its own parameters, each once (`impl Foo`, `impl<T> Foo<T>`). */
const forEvery = (t: Flat, impl: number): boolean => {
    const own = ownParams(t, impl);
    return typeArgs(t, child(t, impl, "type")).every((a) => t.type[a] === "type_identifier" && own.delete(textOf(t, a)));
};

/** A type node's children that tell types apart: lifetimes, their commas and comments left out, so `Foo<'a, X>` and `Foo<'_, X>` read alike. */
const typeParts = (t: Flat, n: number): number[] => {
    const out: number[] = [];
    for (let c = t.first[n]; c >= 0; c = t.next[c]) {
        if (t.type[c] === "lifetime") {
            if (t.next[c] >= 0 && t.type[t.next[c]] === ",") c = t.next[c];
        } else if (!t.type[c].endsWith("comment")) out.push(c);
    }
    return out;
};

/** A type's tokens as `typeParts` reads them. */
const typeText = (t: Flat, n: number): string => (t.first[n] < 0 ? textOf(t, n) : typeParts(t, n).map((c) => typeText(t, c)).join(" "));

/** A type argument where it is written: a file and a node. */
type Slot = { f: GFile; n: number };

/**
 * Whether an impl's type argument covers a receiver's: an own parameter of
 * the impl stands for any type, the same one where it repeats; anything else
 * is written alike, the receiver's names gathered so what they mean can be
 * compared.
 */
const covers = (mt: Flat, p: number, r: Slot, own: ReadonlySet<string>, bound: Map<string, string>, names: Slot[]): boolean => {
    const rt = r.f.flat;
    if (mt.type[p] === "type_identifier" && own.has(textOf(mt, p))) {
        const was = bound.get(textOf(mt, p));
        bound.set(textOf(mt, p), typeText(rt, r.n));
        return was === undefined || was === typeText(rt, r.n);
    }
    if (mt.type[p] !== rt.type[r.n]) return false;
    const ps = typeParts(mt, p);
    const rs = typeParts(rt, r.n);
    if (ps.length === 0) {
        if (rs.length > 0 || textOf(mt, p) !== textOf(rt, r.n)) return false;
        if (/^[A-Za-z_]\w*$/.test(textOf(mt, p))) names.push(r);
        return true;
    }
    return ps.length === rs.length && ps.every((c, i) => covers(mt, c, { f: r.f, n: rs[i] }, own, bound, names));
};

/**
 * The defaults of the struct, enum or union an impl's type names, where the
 * impl's own module declares it: a slot for each type or const parameter, or
 * null where there is none or it names another parameter (`V = T`).
 */
const defaultsOf = (f: GFile, type: number): (Slot | null)[] => {
    const t = f.flat;
    const name = t.type[type] === "generic_type" ? child(t, type, "type") : type;
    if (name < 0 || t.type[name] !== "type_identifier") return [];
    for (let s: GScope | null = scopeAround(f, type); s; s = s.parent) {
        const bs = s.names.get(textOf(t, name));
        if (!bs) {
            if (s.kind === "module") return [];
            continue;
        }
        const decl = bs.length === 1 && bs[0].unit ? bs[0].unit.node : -1;
        if (decl < 0 || !(t.type[decl] === "struct_item" || t.type[decl] === "enum_item" || t.type[decl] === "union_item")) return [];
        const params = namedChildren(t, child(t, decl, "type_parameters")).filter((p) => t.type[p] === "type_parameter" || t.type[p] === "const_parameter");
        const names = new Set(params.map((p) => textOf(t, child(t, p, "name"))));
        return params.map((p) => {
            const d = child(t, p, t.type[p] === "type_parameter" ? "default_type" : "value");
            return d >= 0 && !typeText(t, d).split(" ").some((x) => names.has(x)) ? { f, n: d } : null;
        });
    }
    return [];
};

/** The module scope whose declarations names written at a node mean, or null when a scope between binds one of them (a parameter, a local `use`). */
const meaningAt = (f: GFile, n: number, names: readonly string[]): GScope | null => {
    for (let s: GScope | null = scopeAround(f, n); s; s = s.parent) {
        if (s.kind === "module") return s;
        const scope = s;
        if (names.some((x) => scope.names.has(x))) return null;
    }
    return null;
};

/** Whether a node is `self` or `Self`, a macro's token too. */
const isSelf = (t: Flat, n: number) => t.type[n] === "self" || ((t.type[n] === "identifier" || t.type[n] === "type_identifier") && (textOf(t, n) === "self" || textOf(t, n) === "Self"));

/** A type with references and pointers taken off. */
const pointee = (t: Flat, n: number): number => {
    let x = n;
    while (x >= 0 && (t.type[x] === "reference_type" || t.type[x] === "pointer_type")) x = child(t, x, "type");
    return x;
};

/** The type a receiver is written to have, references and pointers taken off: its impl's for `self` and `Self` (`impl Trait for &Foo<X>` too), else the one its binding declares; -1 when none is written. */
const writtenType = (t: Flat, receiver: number, declared: number): number => {
    let x = pointee(t, receiver >= 0 && isSelf(t, receiver) ? receiver : declared);
    if (x >= 0 && isSelf(t, x)) {
        const impl = selfClass(t, x);
        x = impl >= 0 && t.type[impl] === "impl_item" ? pointee(t, child(t, impl, "type")) : -1;
    }
    return x >= 0 && (t.type[x] === "generic_type" || t.type[x] === "type_identifier" || t.type[x] === "scoped_type_identifier") ? x : -1;
};

/**
 * Whether an inherent impl lends a method to a receiver. An impl for every
 * instance of its type (`impl Foo`, `impl<T> Foo<T>`) lends it to a receiver
 * whose type isn't written, or is written with no more arguments than the
 * impl's: an argument the impl leaves out is the type's default, so an impl
 * writing fewer may be for other instances. An impl for some instances only
 * (`impl Packed<FlowElem>`, `impl<T> Once<T, ()>`) lends it to `self` and
 * `Self` inside it, and to a receiver whose written type has arguments it
 * covers, those left out read as the defaults where the impl's module
 * declares the type, each name meaning the same declaration as in the impl:
 * a `Packed<ParElem>` gets nothing from `impl Packed<FlowElem>`.
 */
export const lendsTo: NonNullable<Typing["lendsTo"]> = (call, receiver, declared, method, unitNode) => {
    const mt = method.flat;
    const impl = inherentImpl(mt, unitNode);
    if (impl < 0) return true;
    const type = writtenType(call.flat, receiver, declared);
    const args: Slot[] = type >= 0 ? typeArgs(call.flat, type).map((n) => ({ f: call, n })) : [];
    const own = child(mt, impl, "type");
    const want = typeArgs(mt, own);
    if (forEvery(mt, impl)) return args.length <= want.length;
    if (type < 0) return false;
    if (call === method && type === own) return true;
    if (args.length < want.length) {
        const defaults = defaultsOf(method, own);
        for (let i = args.length; i < want.length && defaults[i]; i++) args.push(defaults[i]!);
    }
    const params = ownParams(mt, impl);
    const bound = new Map<string, string>();
    const names: Slot[] = [];
    if (args.length !== want.length || !want.every((p, i) => covers(mt, p, args[i], params, bound, names))) return false;
    const meaning = meaningAt(method, own, names.map((x) => textOf(x.f.flat, x.n)));
    return meaning !== null && meaningAt(call, type, []) === meaning && names.every((x) => meaningAt(x.f, x.n, [textOf(x.f.flat, x.n)]) === meaning);
};
