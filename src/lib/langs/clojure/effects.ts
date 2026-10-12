/**
 * What a file's forms may do to a namespace that no def form shows: refer
 * any name (`require`, `use`, `refer`), define any var (`load`, `eval`),
 * add an alias or drop one, or make a var a macro (`alter-meta!`,
 * `.setMacro`). Each top-level form is read apart, with the vars it names,
 * so the resolver can follow a wrapper's effects to the code that calls it.
 */

import { textOf, type Flat } from "../../syntax.ts";
import { CORE_NS, DEFINES } from "./core.ts";
import { formsOf, partsOf, plainName, symOf, type Platform, type Sym } from "./forms.ts";
import { coreName, targetOf, type NsInfo } from "./ns.ts";

/**
 * Effects, as bits: any name may be referred; any var may be defined (code
 * from a file or text, `load`); an alias may be added; any alias may be
 * dropped; a var given to it may become a macro; forms built in code may
 * be evaluated (`eval`), which, the forms being code the files show, stays
 * in its file.
 */
export const REFERS = 1;
export const LOADS = 2;
export const ALIASES = 4;
export const UNALIASES = 8;
export const MACROS = 16;
export const EVALS = 32;

const RA = REFERS | ALIASES;
const bits = (pairs: [string, number][]) => new Map(pairs.flatMap(([names, b]) => names.split(" ").map((n) => [n, b] as const)));
/** The core functions that change what a namespace's names mean, by host (ClojureScript has no `load` or `refer`). */
const CALLS = new Map([
    ["clj", bits([["require use", RA], ["refer refer-clojure", REFERS], ["alias", ALIASES], ["ns-unalias", UNALIASES], ["load load-file load-string load-reader", LOADS], ["eval", EVALS]])],
    ["cljs", bits([["require use require-macros use-macros", RA], ["refer-clojure", REFERS], ["alias", ALIASES], ["ns-unalias", UNALIASES], ["load-file", LOADS], ["eval", EVALS]])],
]);
/** The Namespace class's methods: `(.refer *ns* 'f #'v)`. */
const METHODS = bits([[".refer", REFERS], [".addAlias", ALIASES], [".removeAlias", UNALIASES], [".intern", LOADS]]);

/** A var a form names, and whether the name runs as the file loads (`now`), not in a function's body. */
export type Named = Sym & { now: boolean };

/**
 * A file's effects: each top-level form's bits, on the file itself (`bits`:
 * not the code a syntax quote builds, which runs where it is placed) and
 * when the form's var is called (`call`); those of every trigger name it
 * mentions, quoted or as a string too (`mention`); whether it builds code
 * of names (`builds`: 1, an `eval` or a `resolve` of a name not written
 * out; 2, a macro's def; 4, code it reads from text); the vars it names (to
 * follow), and those it names as vars (`#'x`), finds by name (`(resolve
 * 'x)`) or takes from a namespace (`ns/*`). Then the vars `alter-meta!` or
 * `.setMacro` may make macros (`ns/*` for any of a namespace); whether any
 * var of the file may be one; whether a name in code (not quoted) has an
 * effect; the vars an `intern` into another namespace defines (`*` for any
 * name); the multimethods `defmethod` and `.addMethod` forms add methods
 * to, and the method names of protocol implementations, with their
 * top-level forms.
 */
export type Effects = {
    bits: number[];
    call: number[];
    mention: number[];
    builds: number[];
    names: Named[][];
    vars: Sym[][];
    macroVars: Sym[];
    interns: Sym[];
    macros: boolean;
    code: boolean;
    methods: (Sym & { top: number })[];
    impls: { name: string; top: number }[];
};

/** The def forms whose bodies run when the var is called, not as the file loads; a `fn` a def holds too, but one passed to a call may run now (`(mapv (fn …) xs)`). */
const LATER = new Set("defn defn- defmacro defmethod definline deftest deftest- deftype defrecord extend-type extend-protocol extend".split(" "));
const FNS = new Set(["fn", "fn*"]);

/** The functions that find a var by a quoted name. */
const RESOLVES = new Set(["resolve", "ns-resolve", "requiring-resolve", "find-var", "intern"]);
/** `clojure.lang.RT/var` and `clojure.lang.Var/find`, which find a var by its name as `find-var` does. */
const javaFinds = (s: Sym | null): boolean => !!s && s.ns !== null && ((s.name === "var" && /(^|\.)RT$/.test(s.ns)) || (s.name === "find" && /(^|\.)Var$/.test(s.ns)));
/** A string that may be a name: `"require"`, `"clojure.core/require"`. */
const NAME = /^[^\s"\\/]+(\/[^\s"\\/]+)?$/;
/** The forms that implement a protocol's methods, each method a list headed by its name. */
const IMPLS = new Set("extend-protocol extend-type extend defrecord deftype reify specify specify! proxy".split(" "));
const MACRO_META = /\^:macro\b|:macro\s+true/;

/** Where a form sits: in a place no code is (a def's name, a `case` constant, quoted data), quoted (and data a macro may still build code of: `mention`), in a syntax quote's code, in a function's body, held as a def's value (`(defmulti m dispatch)`), in a macro's body. */
type At = { data: boolean; quoted: boolean; mention: boolean; template: boolean; later: boolean; held: boolean; macro: boolean };

/** What one argument of clojure.core's `require` may do: nothing for a quoted name or a flag, an alias for `:as`, refers for `:refer`; anything for one not written out. */
const requireArg = (t: Flat, x: number): number => {
    if (t.type[x] === "kwd_lit") return 0;
    if (t.type[x] !== "quoting_lit") return RA;
    const text = textOf(t, x);
    return (/:refer/.test(text) ? REFERS : 0) | (/:as\b/.test(text) ? ALIASES : 0);
};

/**
 * The effects of the top-level forms but the `ns` form (`skip`), however
 * deep, `comment` forms aside. A def form's name, `declare`'s names, a
 * `case` constant and quoted data are no code; vectors and metadata are. A
 * name the file defines before it, or one `:refer-clojure` leaves out, is
 * no core var; a wrapper's of another namespace (`classloader/require`)
 * counts, but for `load`. `keep` says which names in code the walk reads
 * as code, not as a local or a binding.
 */
export const effectsOf = (t: Flat, tops: readonly number[], heads: readonly (Sym | null)[], skip: number, p: Platform, ns: NsInfo | null, keep?: (n: number) => boolean): Effects => {
    const calls = CALLS.get(p.host) ?? CALLS.get("clj")!;
    const fx: Effects = { bits: tops.map(() => 0), call: tops.map(() => 0), mention: tops.map(() => 0), builds: tops.map(() => 0), names: tops.map(() => []), vars: tops.map(() => []), macroVars: [], interns: [], macros: false, code: false, methods: [], impls: [] };
    /** Effects in a top-level form: on the file, but for a syntax quote's code, and when its var is called. */
    const effects = (k: number, at: At) => {
        fx.call[top] |= k;
        if (!at.template) fx.bits[top] |= k;
    };
    const own = new Map<string, number>();
    tops.forEach((x, i) => {
        const name = heads[i] && DEFINES.has(heads[i]!.name) ? plainName(t, formsOf(t, x, p)[1]) : null;
        if (name !== null && !own.has(name)) own.set(name, t.start[x]);
    });
    const mine = (s: Sym, at: number) => s.ns === null && (own.get(s.name) ?? Infinity) < at;
    let top = 0;

    /** What a symbol may do, given the arguments it is called with. */
    const effect = (s: Sym, at: number, args: readonly number[] | null): number => {
        if (s.ns === null && METHODS.has(s.name)) return METHODS.get(s.name)!;
        const core = s.ns !== null ? (CORE_NS.has(targetOf(ns, s.ns)) ? s.name : null) : ns?.refers.has(s.name) || mine(s, at) ? null : coreName(ns, s.name);
        // A namespace's map of names holds `require`, `load` and `eval` for the taking: clojure.core's (`ns-publics`), or one's refers (`ns-map` of `*ns*` or a namespace written out).
        const named = args ? (plainName(t, args[0]) === "*ns*" ? "*ns*" : (quotedName(args[0])?.name ?? null)) : null;
        if (((core === "ns-map" || core === "ns-refers") && named !== null) || ((core === "ns-publics" || core === "ns-interns") && named !== null && CORE_NS.has(named))) return RA | LOADS;
        if (core !== null && calls.has(core)) {
            if (args && (core === "require" || core === "require-macros")) return args.reduce((k, x) => k | requireArg(t, x), 0);
            // `(eval (read-string …))` runs code from text, as `load` does.
            return core === "eval" && args?.some((x) => /\b(read|read-string|slurp)\b/.test(textOf(t, x))) ? LOADS : calls.get(core)!;
        }
        return mine(s, at) ? 0 : (calls.get(s.name) ?? 0) & (RA | UNALIASES);
    };

    /** Whether a form surely is no `:macro` key. */
    const notMacro = (x: number | undefined) => {
        const k = x !== undefined && t.type[x] === "kwd_lit" ? partsOf(t, x) : null;
        return !!k && !(k.ns === null && k.name === "macro");
    };
    /** Whether a map surely holds no `:macro`: one written out, or `select-keys` of keys written out. */
    const noMacros = (x: number): boolean => {
        const vs = formsOf(t, x, p);
        if (t.type[x] === "map_lit") return vs.every((k, i) => i % 2 === 1 || notMacro(k));
        return t.type[x] === "list_lit" && plainName(t, vs[0]) === "select-keys" && t.type[vs[2]] === "vec_lit" && formsOf(t, vs[2], p).every(notMacro);
    };
    /** Whether `(alter-meta! v f args…)` or `(reset-meta! v m)` surely leaves `:macro` alone: `dissoc`; `assoc`, `update`, `assoc-in` or `update-in` of other keys; `merge` of maps without it. */
    const harmless = (name: string, args: readonly number[]): boolean => {
        if (name === "reset-meta!") return args.length === 1 && noMacros(args[0]);
        const rest = args.slice(1);
        switch (plainName(t, args[0])) {
            case "dissoc":
                return true;
            case "assoc":
                return rest.every((x, i) => i % 2 === 1 || notMacro(x));
            case "update":
                return notMacro(rest[0]);
            case "assoc-in":
            case "update-in":
                return t.type[rest[0]] === "vec_lit" && notMacro(formsOf(t, rest[0], p)[0]);
            case "merge":
                return rest.every(noMacros);
        }
        return false;
    };
    /**
     * The var a form names as one (`#'x`, `(var x)`, `(resolve 'x)`,
     * `(find-var (symbol "app.m" "x"))`, `(clojure.lang.RT/var "app.m" "x")`),
     * `*` for any var of a namespace it names (`(ns-resolve 'app.m n)`); null
     * for another form, undefined for a namespace (`*ns*`).
     */
    const varOf = (x: number): Sym | null | undefined => {
        const vs = formsOf(t, x, p);
        if (t.type[x] === "var_quoting_lit") return symOf(t, vs[0] ?? -1);
        const h = t.type[x] === "list_lit" ? plainName(t, vs[0]) : plainName(t, x);
        if (h === "*ns*" || h === "the-ns" || h === "find-ns" || h === "create-ns") return undefined;
        if (h === "var") return symOf(t, vs[1] ?? -1);
        if (h === "ns-resolve") {
            const named = nsNamed(vs[1]);
            return named === null ? null : { ns: named, name: nameOf(vs[2])?.name ?? "*" };
        }
        if (h === "resolve" || h === "requiring-resolve" || h === "find-var") return nameOf(vs[1]);
        if (t.type[x] !== "list_lit" || !javaFinds(symOf(t, vs[0] ?? -1))) return null;
        const a = strOf(vs[1]);
        return a !== null && vs.length > 2 ? { ns: a, name: strOf(vs[2]) ?? "*" } : nameOf(vs[1]);
    };
    /** A call that may set a var's `:macro`: the var it names may become a macro; one it can't name, any of the file's, and any its top-level form names, finds by name or takes from a namespace (`fx.vars`). */
    const metaWrite = (h: Sym, vs: readonly number[], at: At) => {
        const name = h.ns === null || CORE_NS.has(targetOf(ns, h.ns)) ? h.name : "";
        const sets =
            name === "alter-meta!" || name === "reset-meta!" ? !harmless(name, vs.slice(2)) : [".alterMeta", ".resetMeta", ".setMeta", ".setMacro"].includes(name) || (name === "." && plainName(t, vs[2]) === "setMacro");
        if (!sets) return;
        const v = varOf(vs[1] ?? -1);
        if (v) fx.macroVars.push(v);
        else if (v === null) {
            fx.macros = true;
            effects(MACROS, at);
        }
    };

    /** The name a form gives as a quoted symbol (`'x`, `(with-meta 'x …)`), or null. */
    const quotedName = (x: number | undefined): Sym | null => {
        const vs = x === undefined ? [] : formsOf(t, x, p);
        if (x !== undefined && t.type[x] === "quoting_lit") return symOf(t, vs[0] ?? -1);
        return x !== undefined && t.type[x] === "list_lit" && plainName(t, vs[0]) === "with-meta" ? quotedName(vs[1]) : null;
    };
    /** A string's text, or null. */
    const strOf = (x: number | undefined): string | null => {
        const text = x === undefined || t.type[x] !== "str_lit" ? "" : textOf(t, x);
        return /^"[^"\\]*"$/.test(text) ? text.slice(1, -1) : null;
    };
    /** `"ns/name"` or `"name"` as a symbol. */
    const parsed = (text: string): Sym => {
        const i = text.indexOf("/");
        return i > 0 && i < text.length - 1 ? { ns: text.slice(0, i), name: text.slice(i + 1) } : { ns: null, name: text };
    };
    /** The name a form gives: a quoted symbol, or one built of strings (`(symbol "app.m" "x")`, `(symbol "app.m/x")`; `*` for a name not written out); or null. */
    const nameOf = (x: number | undefined): Sym | null => {
        const q = quotedName(x);
        const vs = q || x === undefined || t.type[x] !== "list_lit" ? [] : formsOf(t, x, p);
        const a = plainName(t, vs[0]) === "symbol" ? strOf(vs[1]) : null;
        if (a === null) return q ?? (vs.length === 2 && plainName(t, vs[0]) === "symbol" ? quotedName(vs[1]) : null);
        return vs.length > 2 ? { ns: a, name: strOf(vs[2]) ?? "*" } : parsed(a);
    };
    /** The namespace a form names: `'app.m`, `(symbol "app.m")`, `(the-ns 'app.m)`, `(find-ns 'app.m)`; or null. */
    const nsNamed = (x: number | undefined): string | null => {
        const q = nameOf(x);
        if (q) return q.ns === null && q.name !== "*" ? q.name : null;
        const vs = x === undefined || t.type[x] !== "list_lit" ? [] : formsOf(t, x, p);
        return ["the-ns", "find-ns", "create-ns"].includes(plainName(t, vs[0]) ?? "") ? nsNamed(vs[1]) : null;
    };
    /**
     * `(intern ns name …)`: into another namespace, the var it names (`*`
     * for any); one not written out, the name in any. Into `*ns*` as the
     * file loads, the file's own (`outline.ts` reads a name written out); in
     * a function's body, its caller's, any var.
     */
    const intern = (vs: readonly number[], at: At) => {
        const nsForm = vs[1] !== undefined && t.type[vs[1]] === "list_lit" && ["the-ns", "find-ns", "create-ns"].includes(plainName(t, formsOf(t, vs[1], p)[0]) ?? "") ? formsOf(t, vs[1], p)[1] : vs[1];
        const here = plainName(t, nsForm) === "*ns*";
        const target = here ? null : (quotedName(nsForm)?.name ?? null);
        const name = quotedName(vs[2])?.name ?? "*";
        if (here && (at.later || at.template)) fx.call[top] |= LOADS;
        else if (here || target === ns?.name) {
            if (name === "*") effects(LOADS, at);
        } else fx.interns.push({ ns: target ?? "*", name });
    };
    const symbol = (n: number, args: readonly number[] | null, at: At, quoted: boolean) => {
        const s = symOf(t, n)!;
        const code = !quoted && !(s.ns === null && METHODS.has(s.name));
        if (code && keep && !keep(n)) return;
        if (s.ns !== null || own.has(s.name) || ns?.refers.has(s.name) || ns?.referAll.length) fx.names[top].push({ ...s, now: !at.later && (args !== null || !at.held) });
        // In code a macro or an `eval` builds, a call's arguments may be added later (`(concat '(require) more)`).
        const k = effect(s, t.start[n], quoted && at.macro ? null : args);
        effects(k, at);
        if (!at.template) fx.mention[top] |= k;
        fx.code ||= code && k !== 0;
        fx.macros ||= s.name.endsWith("setMacro");
    };
    const visit = (n: number, at: At): void => {
        const type = t.type[n];
        const vs = formsOf(t, n, p);
        // `#(f %)` is a list too.
        const h = type === "list_lit" || type === "anon_fn_lit" ? symOf(t, vs[0] ?? -1) : null;
        const plain = h?.ns === null ? h.name : null;
        if (plain === "comment") return;
        // A def's metadata is evaluated: `(def ^{:k (require …)} v …)`.
        for (let c = t.first[n]; c >= 0; c = t.next[c]) if (t.field[c] === "meta" || t.field[c] === "old_meta") formsOf(t, c, p).forEach((x) => visit(x, { ...at, data: false, quoted: true, mention: false }));
        if (type === "quoting_lit" || plain === "quote") {
            // Quoted, a name is data, but where `resolve` finds its var (`((resolve 'require) …)`), or where a macro or an `eval` builds a form it heads (`(list 'require …)`, `` `(~'require …) ``, `'(require …)`).
            const x = vs[type === "quoting_lit" ? 0 : 1];
            const up = t.type[t.parent[n]] === "unquoting_lit" ? t.parent[n] : n;
            const parent = t.type[t.parent[up]] === "list_lit" ? formsOf(t, t.parent[up], p) : [];
            const builds = parent[0] === up || (parent[1] === up && ["list", "list*", "cons"].includes(plainName(t, parent[0]) ?? ""));
            // `(list 'quote 'load)` builds `(quote load)`: a name, no call.
            const prior = parent[parent.indexOf(up) - 1];
            const quotes = prior !== undefined && t.type[prior] === "quoting_lit" && plainName(t, formsOf(t, prior, p)[0]) === "quote";
            if (x !== undefined && t.type[x] === "sym_lit" && !at.data && (RESOLVES.has(plainName(t, parent[0]) ?? "") || javaFinds(symOf(t, parent[0] ?? -1)) || (at.macro && builds))) symbol(x, null, at, true);
            if (x !== undefined) visit(x, { ...at, data: at.data || !at.macro || t.type[x] !== "list_lit", quoted: true, mention: !at.data && !quotes });
            return;
        }
        const k = type === "kwd_lit" ? partsOf(t, n) : null;
        if (k) fx.macros ||= k.ns === null && k.name === "macro";
        else if (type === "sym_lit" && !at.data) symbol(n, null, at, at.quoted);
        // Quoted data a macro may build code of (`(apply list ['require …])`), and strings it may make names of (`(symbol "require")`).
        else if (type === "sym_lit" && at.mention && !at.template) fx.mention[top] |= effect(symOf(t, n)!, t.start[n], null);
        else if (type === "str_lit" && (!at.data || at.mention) && !at.template && NAME.test(strOf(n) ?? " ")) fx.mention[top] |= effect(parsed(strOf(n)!), t.start[n], null);
        // A local named `intern` is no core var (`keep`); a method (`.setMacro`, `(. v setMacro)`) is never a local.
        if (h && !at.data && (at.quoted || !keep || keep(vs[0]) || (h.ns === null && h.name.startsWith(".")))) {
            metaWrite(h, vs, at);
            const core = h.ns === null || CORE_NS.has(targetOf(ns, h.ns));
            if (h.name === "intern" && core) intern(vs, at);
            // Code built of names: `eval`, `resolve` of a name not written out, a namespace's map of names.
            if ((core && (h.name === "eval" || (RESOLVES.has(h.name) && h.name !== "intern" && !quotedName(vs[h.name === "ns-resolve" ? 2 : 1])) || ["ns-publics", "ns-interns", "ns-map", "ns-refers"].includes(h.name))) || javaFinds(h)) fx.builds[top] |= 1;
            // Code read from text (`read-string`) may hold any name.
            if (core && !at.template && (h.name === "read-string" || h.name === "read")) fx.builds[top] |= 4;
            // `(defmethod m …)`, `(.addMethod m dispatch f)`: a multimethod's method.
            if ((h.name === "defmethod" || (h.ns === null && h.name === ".addMethod")) && symOf(t, vs[1] ?? -1)) fx.methods.push({ ...symOf(t, vs[1])!, top });
            if (IMPLS.has(h.name)) for (const x of vs.slice(1)) for (const m of t.type[x] === "list_lit" ? [formsOf(t, x, p)[0]] : t.type[x] === "map_lit" ? formsOf(t, x, p).filter((_, i) => i % 2 === 0) : []) if (partsOf(t, m ?? -1)) fx.impls.push({ name: partsOf(t, m)!.name, top });
        }
        if (h && !at.data) symbol(vs[0], vs.slice(1), at, at.quoted);
        // The vars a form names (`#'x`) or finds by name (`(ns-resolve 'app.m n)`), and the namespaces whose vars it takes (`(ns-publics 'app.m)`): a meta write on a var it can't name may be on any of them.
        const v = type === "var_quoting_lit" || plain === "var" || (h && !at.data && (RESOLVES.has(h.name) || javaFinds(h)) && h.name !== "intern") ? varOf(n) : null;
        if (v && !at.data) fx.vars[top].push(v);
        const whole = h && !at.data && ["ns-publics", "ns-interns", "the-ns", "find-ns"].includes(plain ?? "") ? nsNamed(vs[1]) : null;
        if (whole !== null) fx.vars[top].push({ ns: whole, name: "*" });
        // `(defn name …)`, `(declare names…)`: the names are no code; `(case e const result … default?)`: nor the constants.
        const named = h && DEFINES.has(h.name) ? 2 : plain === "declare" ? vs.length : 1;
        // A macro's def: `defmacro`, or a def whose metadata says `:macro` (`(defn ^:macro m …)`).
        const macro = !!h && (h.name === "defmacro" || (DEFINES.has(h.name) && MACRO_META.test(vs.slice(1, 4).map((x) => (t.type[x] === "sym_lit" || t.type[x] === "map_lit" ? textOf(t, x) : "")).join(" "))));
        if (macro && !at.data) fx.builds[top] |= 2;
        const inner = {
            ...at,
            template: (at.template || type === "syn_quoting_lit") && type !== "unquoting_lit" && type !== "unquote_splicing_lit",
            later: at.later || (!!h && LATER.has(h.name)) || (at.held && (type === "anon_fn_lit" || (!!plain && FNS.has(plain)))),
            held: false,
            macro: at.macro || macro,
        };
        // `(def v f)`, `(defmulti m dispatch)`, `(def handlers {:k f})`: a value the def holds runs later, if at all, through the def's var.
        const holds = plain === "def" || plain === "defonce" || plain === "defmulti";
        const literal = type === "vec_lit" || type === "map_lit" || type === "set_lit";
        vs.forEach((x, j) => (!h || j > 0) && visit(x, { ...inner, held: (holds && j > 1) || (at.held && literal), data: at.data || (j > 0 && j < named) || (plain === "case" && j > 1 && j % 2 === 0 && j < vs.length - 1) }));
    };
    /** Whether a form names `eval` outside its quotes. */
    const evals = (n: number): boolean => {
        const s = symOf(t, n);
        if (s) return s.name === "eval" && (s.ns === null || CORE_NS.has(targetOf(ns, s.ns)));
        const vs = formsOf(t, n, p);
        const h = t.type[n] === "list_lit" ? plainName(t, vs[0]) : null;
        return t.type[n] !== "quoting_lit" && h !== "quote" && h !== "comment" && vs.some(evals);
    };
    tops.forEach((x, i) => {
        if (i === skip) return;
        top = i;
        // A form that calls `eval` may build the code it evaluates of its quoted names.
        visit(x, { data: false, quoted: false, mention: false, template: false, later: false, held: false, macro: evals(x) });
    });
    return fx;
};
