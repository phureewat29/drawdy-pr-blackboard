/**
 * A file's namespace as one platform reads it: its `ns` form, the vars its
 * def forms define (at the top level, or in a form that runs at load time),
 * and the names a form of unknown meaning may define. Only the def forms the
 * units query lists define a var, whatever namespace their head is written
 * with (`mu/defn`), but a qualified `def` (`s/def`, `mr/def`) and
 * `defmethod` define none.
 */

import type { GFile } from "../../anyfacts.ts";
import { textOf, type Flat } from "../../syntax.ts";
import type { Unit } from "../pack.ts";
import { CORE_MACROS, CORE_NS, DEFINES, LIBRARIES, LOAD_TIME, SPECIAL } from "./core.ts";
import { ALIASES, effectsOf, EVALS, LOADS, REFERS, UNALIASES, type Effects } from "./effects.ts";
import { branchOf, formsOf, kwName, plainName, symOf, valuesOf, type Platform, type Sym } from "./forms.ts";
import { coreName, readNs, targetOf, type NsInfo } from "./ns.ts";

/**
 * A var a form defines: its name; what it holds (`fn`, `macro`, `value`,
 * `multi`, `protocol`, a protocol's `method`, a record's `ctor`, or `class`,
 * a record's, type's or interface's own name, seen in its file only); the
 * top-level form's index, and where the def form starts; whether it is
 * private; the card standing for it. A `guess` macro is one only because
 * its file may make any of its vars one; `guess` keeps the kind it had.
 */
export type Def = { name: string; kind: string; top: number; start: number; private: boolean; unit?: Unit; guess?: string };

export type Outline = {
    ns: NsInfo | null;
    /** The index of the `ns` form among the top-level forms, or -1. */
    nsTop: number;
    /** The top-level forms, as the platform reads them. */
    tops: number[];
    /** The index of the first top-level form outside the namespace: an `in-ns` or a second `ns`. */
    end: number;
    defs: Map<string, Def[]>;
    /** The index of each name's first `declare`. */
    declared: Map<string, number>;
    /** Names a form of unknown meaning may define. */
    maybe: Set<string>;
    /** The namespace may hold vars no form of the file shows (`load`, an odd `ns`): its names resolve to nothing. */
    open: boolean;
    /** A name nothing the file shows gives may be any namespace's: a `use`, `refer` or `require` outside the `ns` form, or no `ns` form. */
    openRefers: boolean;
    /** An alias added outside the `ns` form may shadow a namespace's whole name, Clojure reading aliases first (`aliased`); any alias may be dropped (`unaliased`). */
    aliased: boolean;
    unaliased: boolean;
    /** What the forms may do that no def form shows (`effects.ts`). */
    fx: Effects;
};

/** clojure.test is cljs.test in ClojureScript, and so on: a library by either name. */
export const libraryOf = (ns: string) => LIBRARIES.get(ns) ?? LIBRARIES.get(ns.replace(/^clojure\./, "cljs.")) ?? LIBRARIES.get(ns.replace(/^cljs\./, "clojure."));

/**
 * What a head defines by its name, as the units query reads it, or null: a
 * qualified head of a library reads as that library's form; an unqualified
 * one must name a var the file can reach (`deftest` is no clojure.core var).
 */
const defHead = (o: Outline, head: Sym): string | null => {
    const target = head.ns === null ? "" : targetOf(o.ns, head.ns);
    if (libraryOf(target)) return /^(clojure|cljs)\.test$/.test(target) && head.name === "deftest" ? "deftest" : null;
    const n = head.name;
    if (head.ns === null && !(SPECIAL.has(n) || (n !== "deftest" && coreName(o.ns, n) === n) || o.defs.has(n) || o.ns?.refers.has(n) || o.ns?.referAll.length || o.openRefers)) return null;
    return DEFINES.has(n) && (head.ns === null || n !== "def" || CORE_NS.has(target)) ? n : null;
};

/**
 * Whether a top-level form's head surely defines no var: a special form, a
 * function of the file's own, one of clojure.core's own (but `intern`), a
 * library's. An unqualified name nothing else gives is clojure.core's.
 */
const definesNothing = (o: Outline, head: Sym): boolean => {
    if (head.ns !== null) {
        const target = targetOf(o.ns, head.ns);
        return (CORE_NS.has(target) || !!libraryOf(target)) && head.name !== "intern";
    }
    if (SPECIAL.has(head.name)) return true;
    if (head.name === "intern" || o.ns?.refers.has(head.name) || o.ns?.referAll.length || o.openRefers || o.maybe.has(head.name)) return false;
    const own = o.defs.get(head.name);
    return own ? own.every((d) => d.kind !== "macro") : coreName(o.ns, head.name) === head.name && CORE_MACROS.get(head.name) !== "unknown";
};

/** The names a form of unknown meaning may define: its symbols, and those in its vectors, lists and quotes, a level down. */
const mentioned = (t: Flat, form: number, p: Platform, out: Set<string>) => {
    for (const x of formsOf(t, form, p).slice(1))
        for (const y of t.type[x] === "quoting_lit" ? formsOf(t, x, p) : [x])
            for (const z of t.type[y] === "vec_lit" || t.type[y] === "list_lit" ? formsOf(t, y, p) : [y]) {
                const name = plainName(t, z);
                if (name !== null) out.add(name);
            }
};

const PRIVATE = /\^:private\b|:private\s+true/;
const MACRO = /\^:macro\b|:macro\s+true/;

/** A def form's metadata as written: its name's, and a `defn`'s or `defmulti`'s attribute maps, before its parameters or after its arities. */
const metaOf = (t: Flat, vs: readonly number[], shape: string): string => {
    let meta = textOf(t, vs[1]);
    for (let i = 2; i < vs.length && (shape === "defn" || shape === "defmulti"); i++) {
        const type = t.type[vs[i]];
        if (kwName(t, vs[i]) === "-") i++;
        else if (type === "map_lit") meta += textOf(t, vs[i]);
        else if (type !== "str_lit" && !(type === "list_lit" && shape === "defn")) break;
    }
    return meta;
};

/** The vars a def form defines, by the kind its head gives. */
const defsOf = (t: Flat, form: number, head: string, p: Platform, top: number, unit: Unit | undefined, add: (d: Def) => void) => {
    const vs = formsOf(t, form, p);
    const name = plainName(t, vs[1]);
    const [what, shape] = DEFINES.get(head)!;
    if (name === null || what === "method") return;
    const meta = metaOf(t, vs, shape);
    const def = (n: string, kind: string) => add({ name: n, kind, top, start: t.start[form], private: head === "defn-" || PRIVATE.test(meta), ...(unit ? { unit } : {}) });
    if (what === "record" || what === "type" || what === "interface") {
        def(name, "class");
        if (what !== "interface") def(`->${name}`, "ctor");
        if (what === "record") def(`map->${name}`, "ctor");
    } else if (what === "protocol") {
        def(name, "value");
        for (const sig of vs.slice(2)) {
            const method = t.type[sig] === "list_lit" ? plainName(t, formsOf(t, sig, p)[0]) : null;
            if (method !== null) def(method, "method");
        }
    } else def(name, MACRO.test(meta) ? "macro" : what);
};

/** Whether a form doesn't run as written on a platform: in a quote, a syntax quote, `#_`, a `comment` form, or a reader conditional's branch the platform skips. */
const inert = (t: Flat, n: number, p: Platform): boolean => {
    for (let prev = n, x = t.parent[n]; x > 0; prev = x, x = t.parent[x]) {
        const type = t.type[x];
        if (type === "quoting_lit" || type === "syn_quoting_lit" || type === "dis_expr" || (type === "list_lit" && plainName(t, valuesOf(t, x)[0]) === "comment")) return true;
        if ((type === "read_cond_lit" || type === "splicing_read_cond_lit") && branchOf(t, x, p) !== prev) return true;
    }
    return false;
};

/**
 * A file's namespace as a platform reads it. Options: `extra`, effects
 * (`effects.ts`) the vars its code names may have; `keep`, which names in
 * code may have one (all, by default); `quiet`, none counted.
 */
export const readOutline = (f: GFile, p: Platform, opts: { extra?: number; keep?: (n: number) => boolean; quiet?: true } = {}): Outline => {
    const t = f.flat;
    const tops = formsOf(t, 0, p);
    const heads = tops.map((form) => (t.type[form] === "list_lit" ? symOf(t, formsOf(t, form, p)[0] ?? -1) : null));
    const nsAt = heads.findIndex((h) => h?.ns === null && h.name === "ns");
    const ns = nsAt < 0 ? null : readNs(t, tops[nsAt], p);
    const fx = effectsOf(t, tops, heads, nsAt, p, ns, opts.keep);
    const bits = opts.quiet ? 0 : fx.bits.reduce((a, b) => a | b, opts.extra ?? 0);
    // With no `ns` form, the file is `load`ed into a namespace whose refers it can't see.
    const o: Outline = { ns: null, nsTop: -1, tops, end: tops.length, defs: new Map(), declared: new Map(), maybe: new Set(), open: !!(bits & (LOADS | EVALS)), openRefers: !!(bits & REFERS) || nsAt < 0, aliased: !!(bits & ALIASES), unaliased: !!(bits & UNALIASES), fx };
    const add = (d: Def) => o.defs.set(d.name, [...(o.defs.get(d.name) ?? []), d]);
    const collected = new Set<number>();
    /** A form at the top level, or inside one that runs at load time: its defs, else what it may define. */
    const read = (form: number, head: Sym, i: number) => {
        const kind = defHead(o, head);
        if (kind !== null) {
            collected.add(form);
            defsOf(t, form, kind, p, i, f.unitByNode.get(form), add);
        } else if (head.ns === null && LOAD_TIME.has(head.name)) {
            for (const x of formsOf(t, form, p).slice(1)) {
                const h = t.type[x] === "list_lit" ? symOf(t, formsOf(t, x, p)[0] ?? -1) : null;
                if (h) read(x, h, i);
            }
        } else if (!definesNothing(o, head)) mentioned(t, form, p, o.maybe);
    };
    for (let i = 0; i < tops.length; i++) {
        const form = tops[i];
        const head = heads[i];
        const plain = head?.ns === null ? head.name : null;
        // The namespace's `ns` form comes before its first def; a second one, or an `in-ns`, leaves it.
        if (i === nsAt && o.defs.size + o.maybe.size === 0) {
            o.ns = ns;
            o.nsTop = i;
            o.open ||= !o.ns || o.ns.odd;
        } else if (plain === "ns" || plain === "in-ns") {
            o.end = i;
            break;
        } else if (plain === "declare") formsOf(t, form, p).forEach((x) => plainName(t, x) !== null && !o.declared.has(plainName(t, x)!) && o.declared.set(plainName(t, x)!, i));
        else if (head) read(form, head, i);
    }
    o.openRefers ||= !o.ns;
    // A var the file may make a macro: every function's, value's and multimethod's.
    if (fx.macros) for (const d of [...o.defs.values()].flat()) if (d.kind === "fn" || d.kind === "value" || d.kind === "multi") Object.assign(d, { kind: "macro", guess: d.kind });
    // A def or an `intern` anywhere else (in a function, a macro's form) may define its name at any time: a record's constructors too.
    for (let n = 0; n < t.count; n++) {
        if (t.type[n] !== "list_lit" || t.parent[n] === 0 || collected.has(n)) continue;
        const vs = valuesOf(t, n);
        const head = symOf(t, vs[0] ?? -1);
        if (!head || inert(t, n, p)) continue;
        if (head.name === "intern") mentioned(t, n, p, o.maybe);
        const name = DEFINES.has(head.name) && head.name !== "defmethod" ? plainName(t, vs[1]) : null;
        if (name !== null) [name, `->${name}`, `map->${name}`].forEach((x) => o.maybe.add(x));
    }
    return o;
};
