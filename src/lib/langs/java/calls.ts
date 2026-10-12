/**
 * Which method or constructor a call reaches (JLS 15.9, 15.12). An
 * unqualified call names a method of the innermost class around it with a
 * member of that name, else a static import's. With a supertype not read,
 * only a class's own members are sure, and a call only with no argument, to
 * a method nothing unseen replaces. A protected constructor of another
 * package is reached only through `super(…)` or an anonymous class.
 */

import type { GScope } from "../../anyfacts.ts";
import type { Named } from "../../anylink.ts";
import { once } from "../../fp.ts";
import { child, namedChildren, textOf } from "../../syntax.ts";
import { access, importable, type Recv } from "./access.ts";
import { exprType, exprVal, selfOf, superVal, typeOf, type Val } from "./expressions.ts";
import { isIface, openOf, perNode, pkgOf, type JFile, type JType } from "./files.ts";
import { gapIn } from "./gaps.ts";
import { classTypeVar, viewType } from "./generics.ts";
import type { Lib } from "./library.ts";
import { membersOf, methodsOf, recordComponents, type JMethod, type MethodSet } from "./members.ts";
import { argCount, code, namesOf } from "./nodes.ts";
import { byArguments, mayApply, reachable } from "./overloads.ts";
import { scopeOf } from "./scopes.ts";
import { keyOfParams, paramTypes } from "./signatures.ts";
import type { SType } from "./static-types.ts";
import { fqnType, superclassOf } from "./type-names.ts";

const argTypes = (jf: JFile, call: number): SType[] => code(jf.t, child(jf.t, call, "arguments")).map((a) => exprType(jf, a));

/** How a call names its receiver, given what its qualifier is (`q`) and the class whose own instance it is (`self`). */
export const receiverOf = (q: Val, self: JType | null, T: JType): Recv => (self ? { kind: "self", view: self } : q.k === "type" ? { kind: "type" } : { kind: "expr", type: T });

/** How each call `pick` resolved names its receiver, by its name's node: what binds its class's type variables. */
const receivers = new WeakMap<JFile, Map<number, Recv>>();

/** The class a call's result is when its method returns a type variable of its class: what the receiver binds it to. */
export const resultView = (jf: JFile, nameNode: number, m: JMethod, rt: number): JType | null => {
    const recv = receivers.get(jf)?.get(nameNode);
    if (!recv || recv.kind === "type" || "fqn" in m.owner) return null;
    return viewType(recv.kind === "self" ? recv.view : recv.type, m.owner, classTypeVar(m.owner, rt), recv.kind === "self");
};

/** The one method of a set a call at node `n` with `k` arguments may reach (its arguments' types telling overloads apart); `owner`: the type searched. */
export const pick = (jf: JFile, n: number, owner: JType | Lib, set: MethodSet, k: number | null, recv: Recv): JMethod | null => {
    const m = pickFrom(jf, n, owner, set, k, recv);
    if (m) {
        let byNode = receivers.get(jf);
        if (!byNode) receivers.set(jf, (byNode = new Map()));
        byNode.set(n, recv);
    }
    return m;
};

const pickFrom = (jf: JFile, n: number, owner: JType | Lib, set: MethodSet, k: number | null, recv: Recv): JMethod | null => {
    const call = jf.t.parent[n];
    if (k !== null && gapIn(jf.t, child(jf.t, call, "arguments"))) return null;
    const usable = set.list.map((m) => ({ m, a: access(jf, n, m, recv) })).filter((x) => x.a !== "no");
    const possible = reachable(usable.map((x) => x.m), k);
    // A member whose access is open may or may not compete.
    if (usable.some((x) => x.a === "maybe" && possible.includes(x.m))) return null;
    if (possible.length > 1) return set.complete && k !== null ? byArguments(possible, argTypes(jf, call)) : null;
    if (possible.length !== 1) return null;
    const m = possible[0];
    if (k !== null && !mayApply(m, argTypes(jf, call))) return null;
    if (set.complete) return m;
    // With a supertype not read, only a call with no argument is sure, to a method nothing unseen replaces: the type's own, or a concrete one of a class it extends, no class between them open.
    if (k !== 0 || m.varargs || m.n !== 0) return null;
    for (let s: JType | Lib | null = owner; s; s = superclassOf(s)) {
        if (s === m.owner) return s === owner || !m.abstract ? m : null;
        if (!("fqn" in s) && openOf(s)) return null;
    }
    return null;
};

/** The method a call's name reaches, or null. */
export const callOf: (jf: JFile, nameNode: number) => JMethod | null = perNode(null, (jf, nameNode) => {
    const t = jf.t;
    const call = t.parent[nameNode];
    const name = textOf(t, nameNode);
    const k = argCount(t, call);
    const obj = child(t, call, "object");
    const sup = namedChildren(t, call).find((c) => t.type[c] === "super" && t.field[c] !== "object");
    if (sup !== undefined) {
        // `X.super.m()`: interface X's own method, or the superclass's of an outer class X.
        const q = exprVal(jf, obj);
        const X = q.k === "type" && q.res.k === "type" ? q.res.t : null;
        const target = X ? (isIface(X) ? X : superclassOf(X)) : null;
        return target ? pick(jf, nameNode, target, methodsOf(target, name), k, { kind: "self", view: null }) : null;
    }
    if (obj < 0) return unqualified(jf, nameNode, name, k);
    const q = t.type[obj] === "super" ? superVal(jf, obj) : exprVal(jf, obj);
    const T = typeOf(q);
    if (!T) return null;
    const self = selfOf(jf, obj);
    return pick(jf, nameNode, T, methodsOf(T, name), k, receiverOf(q, self, T));
});

/** `m(…)`: the innermost class around with a member named m, else the static imports'. */
const unqualified = (jf: JFile, n: number, name: string, k: number): JMethod | null => {
    for (let s: GScope | null = scopeOf(jf, n); s; s = s.parent) {
        if (s.kind !== "class") continue;
        const T = jf.byNode.get(s.node);
        if (!T) return null;
        const set = methodsOf(T, name);
        if (set.list.length > 0) return pick(jf, n, T, set, k, { kind: "self", view: T });
        if (!set.complete) return null;
    }
    if (gapIn(jf.t, child(jf.t, jf.t.parent[n], "arguments"))) return null;
    const candidates: JMethod[] = [];
    let complete = true;
    for (const i of jf.statics.filter((i) => i.local === name)) {
        const c = fqnType(jf, namesOf(i.spec), true);
        if (c.k !== "type") return null;
        const set = methodsOf(c.t, name);
        if (!set.complete) complete = false;
        candidates.push(...set.list.filter((m) => m.isStatic));
    }
    // A single-static import shadows an on-demand one's method of the same parameter types.
    const singles = candidates.length;
    for (const i of jf.staticStars) {
        const c = fqnType(jf, namesOf(i.spec), true);
        if (c.k !== "type") {
            complete = false;
            continue;
        }
        const set = methodsOf(c.t, name);
        if (!set.complete) complete = false;
        for (const m of set.list) if (m.isStatic && !candidates.slice(0, singles).some((x) => x.n === m.n && x.key() !== null && x.key() === m.key())) candidates.push(m);
    }
    const possible = reachable(candidates.filter((m) => importable(jf, m)), k);
    const args = argTypes(jf, jf.t.parent[n]);
    if (possible.length > 1 && complete) return byArguments(possible, args);
    if (possible.length !== 1 || !mayApply(possible[0], args)) return null;
    // An import not read may hold another; one of no parameter is shadowed by a single import's.
    return complete || (k === 0 && possible[0].n === 0 && !possible[0].varargs && candidates.indexOf(possible[0]) < singles) ? possible[0] : null;
};

/**
 * The constructor a creation (`how`: `new`, an anonymous class's, `T::new`)
 * or `this(…)` / `super(…)` with `k` arguments reaches (any number for
 * `T::new`; `call`, the node holding its arguments), as a site names it: a
 * declared one, its class's card standing for it where it has none, or the
 * implicit one, the class's.
 */
export const ctorOf = (jf: JFile, n: number, T: JType, k: number | null, how: "new" | "anonymous" | "ref" | "this" | "super", call = -1): Named => {
    if ((T.kind !== "class" && T.kind !== "record") || openOf(T)) return [];
    if (call >= 0 && gapIn(jf.t, child(jf.t, call, "arguments"))) return [];
    const reached = (c: JMethod) => (c.access === "protected" ? pkgOf(T) === jf.pkg || how === "super" || how === "anonymous" || how === "this" : access(jf, n, c, { kind: "type" }) === "yes");
    const ctors: JMethod[] = membersOf(T).ctors.filter(reached);
    const implicit = (params: () => SType[], count: number, varargs: boolean): JMethod => ({ name: T.name, owner: T, node: -1, unit: T.unit, n: count, varargs, isStatic: false, abstract: false, access: "public", key: () => null, params });
    if (T.kind === "class" && membersOf(T).ctors.length === 0) ctors.push(implicit(() => [], 0, false));
    if (T.kind === "record") {
        // The canonical constructor is implicit unless declared: a compact one, or one taking the components' types.
        const components = recordComponents(T);
        const key = keyOfParams(T.file, components);
        const varargs = components.some((c) => T.file.t.type[c] === "spread_parameter");
        if (!membersOf(T).ctors.some((c) => T.file.t.type[c.node] === "compact_constructor_declaration" || (c.n === components.length && key !== null && c.key() === key))) ctors.push(implicit(once(() => paramTypes(T.file, components)), components.length, varargs));
    }
    const possible = reachable(ctors, k);
    const args = call >= 0 ? argTypes(jf, call) : null;
    const one = possible.length > 1 ? (args ? byArguments(possible, args) : null) : possible.length === 1 && (!args || mayApply(possible[0], args)) ? possible[0] : null;
    const unit = one?.unit ?? (one ? T.unit : undefined);
    return unit ? [{ ref: "call", units: [unit], ...(unit !== T.unit && T.unit ? { alt: T.unit } : {}) }] : [];
};
