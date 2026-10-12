/**
 * Overload resolution (JLS 15.12.2). Of the methods or constructors a call
 * may reach, the one its number of arguments, varargs counted, and their
 * static types prove, as javac's three phases pick it. Overloads spread
 * across a hierarchy count too, and a method overrides another where their
 * parameter types erase alike. A lone candidate the arguments' types rule
 * out is no answer: code that compiles calls another.
 */

import { isIface, type JType } from "./files.ts";
import { libNamed, type Lib } from "./library.ts";
import { membersOf, methodsOf, type JMethod } from "./members.ts";
import { hasModifier } from "./nodes.ts";
import { ARRAY_SUPERTYPES, BOXES, sameType, UNBOXED, UNTYPED, widens, type Fit, type SType } from "./static-types.ts";
import { closureOf, supersOf } from "./type-names.ts";

/** What a type known by key alone is: one read, or a JDK type the table holds. */
const refType = (s: SType & { k: "ref" }): JType | Lib | undefined => s.type ?? libNamed(s.key);

/**
 * Whether an argument of type `a` may be passed for a parameter of type
 * `p`: by identity or widening alone (strict), or also by boxing and
 * unboxing (loose). "maybe" wherever a type isn't known.
 */
const fits = (a: SType, p: SType, loose: boolean): Fit => {
    if (a.k === "unknown" || p.k === "unknown" || p.k === "null" || p.k === "fn") return "maybe";
    if (a.k === "fn") return p.k === "var" ? "maybe" : p.k === "ref" ? takesFn(p, a.arity) : "no";
    if (p.k === "var") return a.k === "prim" && !loose ? "no" : "maybe";
    if (a.k === "var") return p.k === "prim" ? (loose ? "maybe" : "no") : "maybe";
    if (a.k === "null") return p.k === "prim" ? "no" : "yes";
    if (a.k === "prim") {
        if (p.k === "prim") return widens(a.name, p.name) ? "yes" : "no";
        if (!loose || p.k === "array") return "no";
        // Boxing, then a widening reference conversion (JLS 5.3).
        return fits({ k: "ref", key: BOXES[a.name] }, p, true);
    }
    if (p.k === "prim") {
        // Only the eight boxes unbox (JLS 5.1.8).
        if (!loose || a.k === "array") return "no";
        const prim = UNBOXED[a.key];
        return prim && widens(prim, p.name) ? "yes" : "no";
    }
    if (a.k === "array") {
        if (p.k === "array") return a.elem.k === "prim" || p.elem.k === "prim" ? (a.elem.k === "prim" && p.elem.k === "prim" ? (a.elem.name === p.elem.name ? "yes" : "no") : sameType(a.elem, p.elem) ? "yes" : "no") : fits(a.elem, p.elem, false);
        return ARRAY_SUPERTYPES.has(p.key) ? "yes" : "no";
    }
    if (p.k === "array") return "no";
    // A parameterized parameter type (`Collection<? extends Project>`) takes a subtype of its erasure only as its arguments allow: for sure, only itself written alike.
    if (p.args && p.targs !== undefined && a.key === p.key && a.targs === p.targs) return "yes";
    const yes: Fit = p.args ? "maybe" : "yes";
    if (a.key === p.key || p.key === "java.lang.Object") return yes;
    // No other type is a final class's subtype but an enum constant's class, whose supertype is known.
    const pt = refType(p);
    const final = pt !== undefined && isFinal(pt);
    const at = refType(a);
    if (!at) return final ? "no" : "maybe";
    const c = closureOf(at);
    return c.keys.has(p.key) ? yes : c.complete || final ? "no" : "maybe";
};

/** JDK classes their specification makes final. */
const FINAL_LIB = new Set(["java.lang.String", "java.lang.Class", "java.lang.StringBuilder", "java.lang.StringBuffer", "java.util.Optional", ...Object.values(BOXES)]);

/** Whether no type but itself (and an enum's constants' classes) extends a type: a final class, an enum, a record. */
const isFinal = (x: JType | Lib): boolean => ("fqn" in x ? FINAL_LIB.has(x.fqn) : x.kind === "enum" || x.kind === "record" || (x.kind === "class" && hasModifier(x.file.t, x.node, "final")));

/**
 * Whether a lambda (of `arity` parameters; null: a method reference) may
 * stand for a parameter of a type (JLS 15.12.2.1): never a class's, nor an
 * interface's of no abstract method or of several, nor one whose method
 * takes another number of parameters.
 */
const takesFn = (p: SType & { k: "ref" }, arity: number | null): Fit => {
    const x = refType(p);
    if (!x) return "maybe";
    if (!isIface(x)) return "no";
    const shape = fnShape(x);
    if (!shape) return "maybe";
    if (shape.length !== 1) return "no";
    return arity === null || shape[0].some((m) => m.varargs || m.n === arity) ? "maybe" : "no";
};

/** Object's public methods, which an interface's abstract methods don't count (JLS 9.8). */
const OBJECT_PUBLIC = new Set(["equals/1", "hashCode/0", "toString/0", "getClass/0", "notify/0", "notifyAll/0", "wait/0", "wait/1", "wait/2"]);

/** An interface's abstract methods, by name; null where not all are known, or where a default one may override one whose parameter types can't be compared. */
const shapes = new WeakMap<JType | Lib, JMethod[][] | null>();
const fnShape = (x: JType | Lib): JMethod[][] | null => {
    if (shapes.has(x)) return shapes.get(x)!;
    shapes.set(x, null);
    const names = new Set<string>();
    const seen = new Set<JType | Lib>();
    const walk = (y: JType | Lib | null): boolean => {
        if (!y) return false;
        if (seen.has(y)) return true;
        seen.add(y);
        if ("fqn" in y) {
            if (!y.members) return false;
            for (const m of y.methods) names.add(m.name);
        } else for (const name of membersOf(y).methods.keys()) names.add(name);
        return supersOf(y).every(walk);
    };
    let shape: JMethod[][] | null = walk(x) ? [] : null;
    for (const name of names) {
        if (!shape) break;
        const set = methodsOf(x, name);
        const live = set.list.filter((m) => !m.isStatic && !OBJECT_PUBLIC.has(`${m.name}/${m.n}`));
        const abstract = live.filter((m) => m.abstract);
        if (!set.complete || live.some((m) => !m.abstract && abstract.some((a) => a.n === m.n && (a.key() === null || m.key() === null)))) shape = null;
        else if (abstract.length > 0) shape.push(abstract);
    }
    shapes.set(x, shape);
    return shape;
};

/** Whether a method may take the arguments: in javac's first phase (strict), its second (loose), or its third (varargs, loose). */
const applies = (m: JMethod, args: readonly SType[], phase: 1 | 2 | 3): Fit => {
    const ps = m.params();
    if (phase < 3 ? ps.length !== args.length : !m.varargs || args.length < ps.length - 1) return "no";
    const last = ps[ps.length - 1];
    let all: Fit = "yes";
    for (let i = 0; i < args.length; i++) {
        const p = phase === 3 && i >= ps.length - 1 ? (last.k === "array" ? last.elem : last.k === "var" ? last : UNTYPED) : ps[i];
        const f = fits(args[i], p, phase > 1);
        if (f === "no") return "no";
        if (f === "maybe") all = "maybe";
    }
    return all;
};

/** Whether a method may take a call's arguments in some phase: one their types rule out is no answer, as code that compiles has another. */
export const mayApply = (m: JMethod, args: readonly SType[]): boolean => applies(m, args, 1) !== "no" || applies(m, args, 2) !== "no" || applies(m, args, 3) !== "no";

/** Whether type `a` is provably a subtype of `b`, primitives by widening. */
const subtype = (a: SType, b: SType): boolean => {
    if (a.k === "prim" && b.k === "prim") return widens(a.name, b.name);
    // A parameterized supertype needs its arguments compared: for sure, only itself written alike.
    if (b.k === "ref" && b.args) return a.k === "ref" && a.key === b.key && b.targs !== undefined && a.targs === b.targs;
    if (a.k === "array" && b.k === "array") return a.elem.k === "prim" ? sameType(a.elem, b.elem) : subtype(a.elem, b.elem);
    if (a.k === "array" && b.k === "ref") return ARRAY_SUPERTYPES.has(b.key);
    if (a.k !== "ref" || b.k !== "ref") return false;
    if (a.key === b.key || b.key === "java.lang.Object") return true;
    const at = refType(a);
    return !!at && closureOf(at).keys.has(b.key);
};

/** Whether `m` is more specific than `o` (JLS 15.12.2.5), provably: each of its parameter types a subtype of the other's. */
const moreSpecific = (m: JMethod, o: JMethod): boolean => {
    const a = m.params();
    const b = o.params();
    return a.length === b.length && a.every((p, i) => subtype(p, b[i]));
};

/**
 * Of overloads that all fit a call's number of arguments, the one javac
 * picks, where the arguments' static types prove it: when one applies for
 * sure in the first phase, javac picks among those that may apply there,
 * the most specific; with none sure, any phase may decide, so only one
 * that may apply in some phase is sure.
 */
export const byArguments = <M extends JMethod>(cands: readonly M[], args: readonly SType[]): M | null => {
    const first = cands.map((m) => applies(m, args, 1));
    if (first.includes("yes")) {
        const may = cands.filter((_, i) => first[i] !== "no");
        if (may.length === 1) return may[0];
        const best = may.filter((m) => first[cands.indexOf(m)] === "yes" && may.every((o) => o === m || (moreSpecific(m, o) && !moreSpecific(o, m))));
        return best.length === 1 ? best[0] : null;
    }
    const any = cands.filter((m) => mayApply(m, args));
    return any.length === 1 ? any[0] : null;
};

/**
 * The methods a call with `k` arguments may reach (`k` null: a method
 * reference, any number): those of `k` parameters, and the varargs ones
 * that take `k`. With no argument, a method of no parameter always
 * applies, so javac's first phase takes it before any varargs one.
 */
export const reachable = <M extends { n: number; varargs: boolean }>(list: readonly M[], k: number | null): M[] => {
    if (k === null) return [...list];
    const fixed = list.filter((m) => !m.varargs && m.n === k);
    return k === 0 && fixed.length === 1 ? fixed : list.filter((m) => (m.varargs ? k >= m.n - 1 : k === m.n));
};
