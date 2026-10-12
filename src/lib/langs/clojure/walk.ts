/**
 * The names a file's code refers to, as one platform reads it: each symbol
 * its enclosing forms evaluate, beside the locals the binding forms around
 * it bind (`let`, `fn`, destructuring, `for`, `catch`, a record's fields).
 * What a list's head does with the forms after it comes from `classify`:
 * one of the tables' forms, or a function call. Inside a form whose head
 * may be a macro of unknown meaning, a name is `hidden`: the macro may bind
 * it. A symbol in a syntax quote is read when the reader reads it, never as
 * a local.
 */

import type { Flat } from "../../syntax.ts";
import { SPECIAL, type Shape } from "./core.ts";
import { branchOf, formsOf, kwName, nameNode, partsOf, plainName, symOf, valuesOf, type Platform, type Sym } from "./forms.ts";
import type { Outline } from "./outline.ts";

/** A name a symbol may refer by: `mode` says how it is read (code, a syntax quote, `#'x`, a name an `ns` form refers, a class `Foo.` makes); `top` is its top-level form's index, `at` where it starts. */
export type Use = { ns: string | null; name: string; how: "call" | "value" | "import"; mode: "code" | "syntax" | "var" | "refer" | "class"; hidden: boolean; shown: boolean; top: number; at: number };

/** A head's meaning, given its symbol, the top-level form it sits in and where it starts: a form of the tables, a function's `call`, or `unknown`. */
export type Classify = (sym: Sym, top: number, at: number) => Shape;

/** For each symbol a platform reads, by its name node: the name it may refer by, or null where it names no var (a local, a binding, a quoted name). */
export type Uses = Map<number, Use | null>;

type Locals = { name: string; next: Locals } | null;
/** `hidden`: inside a form whose head may be a macro; `shown`: one the code shows (a var's name it calls), not a head made unknown by what the files can't show. */
type Cx = { locals: Locals; hidden: boolean; shown: boolean; top: number };

/** The forms that read their first form as code: a value threaded into it stays code. */
const EVALUATES = new Set<Shape>(["call", "thread", "steps", "as->", "case", "try"]);

/** The names `#(…)` binds. */
const ANON = ["%", "%&", ...Array.from({ length: 20 }, (_, i) => `%${i + 1}`)];

/** A method or field (`.foo`, `.-foo`) or a constructor (`Foo.`): no var. */
const isInterop = (name: string): boolean => name !== "." && name !== ".." && (name.startsWith(".") || name.endsWith("."));

export const walkUses = (t: Flat, p: Platform, o: Outline, classify: Classify): Uses => {
    const uses: Uses = new Map();
    const fs = (n: number) => formsOf(t, n, p);
    const first = (n: number) => valuesOf(t, n)[0] ?? -1;
    const bound = (l: Locals, name: string): boolean => !!l && (l.name === name || bound(l.next, name));
    const scope = (cx: Cx, names: readonly string[]): Cx => ({ ...cx, locals: names.reduce<Locals>((next, name) => ({ name, next }), cx.locals) });
    const hide = (cx: Cx, shown = false): Cx => ({ ...cx, hidden: true, shown: cx.shown || shown });
    /** Every symbol in a form names no var here. */
    const mute = (n: number | undefined) => {
        for (let x = n ?? -1; n !== undefined && n >= 0 && x < t.count && (x === n || t.start[x] < t.end[n]); x++) if (t.type[x] === "sym_name") uses.set(x, null);
    };
    const set = (n: number, u: Use | null) => {
        const at = nameNode(t, n);
        if (at >= 0) uses.set(at, u);
    };
    const none = (n: number) => set(n, null);
    const use = (n: number, cx: Cx, how: Use["how"], mode: Use["mode"]) => {
        const s = symOf(t, n);
        if (s) set(n, s.ns === null && SPECIAL.has(s.name) ? null : { ns: s.ns, name: s.name, how, mode, hidden: cx.hidden, shown: cx.shown, top: cx.top, at: t.start[n] });
    };
    const each = (xs: readonly number[], cx: Cx) => xs.forEach((x) => code(x, cx));

    /** An `:or` default and the name it defaults, which it runs before. */
    const defaults = new Map<number, string>();
    /** The names a binding form binds (a symbol, a vector or map destructuring); the code inside it (`:or`'s values, a map's keys, a `:- schema`) goes to `later`. */
    const binds = (n: number, names: string[], later: number[]) => {
        const type = t.type[n];
        const vs = type === "vec_lit" || type === "map_lit" ? fs(n) : [];
        if (type === "sym_lit") {
            none(n);
            if (plainName(t, n) !== "&") names.push(symOf(t, n)!.name);
        } else if (type === "vec_lit")
            for (let i = 0; i < vs.length; i++) {
                const k = kwName(t, vs[i]);
                if (k === "-") later.push(...vs.slice(i + 1, i + 2));
                else if (k === null) binds(vs[i], names, later);
                if (k === "-" || k === "as") i++;
                if (k === "as" && vs[i] !== undefined) binds(vs[i], names, later);
            }
        else if (type === "map_lit")
            for (let i = 0; i + 1 < vs.length; i += 2) {
                const k = t.type[vs[i]] === "kwd_lit" ? partsOf(t, vs[i]) : null;
                const v = vs[i + 1];
                if (k && ["keys", "strs", "syms"].includes(k.name))
                    fs(v).forEach((x) => {
                        names.push(partsOf(t, x)?.name ?? "");
                        none(x);
                    });
                else if (k?.ns === null && k.name === "as") binds(v, names, later);
                else if (k?.ns === null && k.name === "or")
                    fs(v).forEach((x, j, xs) => {
                        if (j % 2 === 0) return none(x);
                        later.push(x);
                        if (plainName(t, xs[j - 1]) !== null) defaults.set(x, plainName(t, xs[j - 1])!);
                    });
                else {
                    binds(vs[i], names, later);
                    later.push(v);
                }
            }
        else mute(n);
    };
    /** A binding form's names in scope, its code walked with them. */
    const bindIn = (n: number | undefined, cx: Cx): Cx => {
        const names: string[] = [];
        const later: number[] = [];
        if (n !== undefined) binds(n, names, later);
        const inner = scope(cx, names);
        later.forEach((x) => code(x, defaults.has(x) ? scope(cx, names.filter((m) => m !== defaults.get(x))) : inner));
        return inner;
    };
    /** `[b e b e]`, each value seen by the names bound before it. */
    const pairs = (vec: number, cx: Cx): Cx => {
        const vs = fs(vec);
        let inner = cx;
        for (let i = 0; i < vs.length; i += 2) {
            if (vs[i + 1] !== undefined) code(vs[i + 1], inner);
            inner = bindIn(vs[i], inner);
        }
        return inner;
    };
    /** A form whose first form should be a binding vector; any other shape reads as unknown. */
    const withVector = (args: readonly number[], cx: Cx, read: (vec: number) => Cx) => (t.type[args[0]] === "vec_lit" ? each(args.slice(1), read(args[0])) : each(args, hide(cx)));

    /** `[params] body…`, or `([params] body…)…`, with a trailing attribute map: metadata, which names no var here but `effects.ts` reads. */
    const sigs = (forms: readonly number[], cx: Cx) => {
        if (t.type[forms[0]] === "vec_lit") return each(forms.slice(1), bindIn(forms[0], cx));
        for (const f of forms) {
            const vs = t.type[f] === "list_lit" ? fs(f) : [];
            if (t.type[vs[0]] === "vec_lit") each(vs.slice(1), bindIn(vs[0], cx));
            else if (t.type[f] !== "map_lit") code(f, hide(cx));
        }
    };
    /** `(fn name? sigs)`: the name is a local of its bodies; a `:- schema` before the parameters is code. */
    const fnForm = (args: readonly number[], cx: Cx) => {
        let i = 0;
        const schemas = () => {
            for (; kwName(t, args[i]) === "-"; i += 2) if (args[i + 1] !== undefined) code(args[i + 1], cx);
        };
        schemas();
        let inner = cx;
        if (t.type[args[i]] === "sym_lit") {
            const name = plainName(t, args[i]);
            none(args[i++]);
            if (name !== null) inner = scope(cx, [name]);
            schemas();
        }
        sigs(args.slice(i), inner);
    };
    /** A record's, type's or reify's protocols and interfaces (code), options, and methods `(m [this args] body)` whose bodies see `fields`. */
    const specs = (forms: readonly number[], cx: Cx, fields: readonly string[]) => {
        for (let i = 0; i < forms.length; i++) {
            const vs = t.type[forms[i]] === "list_lit" ? fs(forms[i]) : null;
            if (vs) {
                mute(vs[0]);
                sigs(vs.slice(1), scope(cx, fields));
            } else if (t.type[forms[i]] === "kwd_lit") mute(forms[++i]);
            else code(forms[i], cx);
        }
    };

    const form = (shape: Shape, vs: readonly number[], cx: Cx) => {
        const args = vs.slice(1);
        switch (shape) {
            case "call":
                return each(args, cx);
            case "macro":
                return each(args, hide(cx, true));
            case "unknown":
                return each(args, hide(cx));
            case "skip":
                return args.forEach(mute);
            case "var":
                return t.type[args[0]] === "sym_lit" ? use(args[0], cx, "value", "var") : mute(args[0]);
            case "def":
                mute(args[0]);
                return each(args.slice(1), cx);
            case "defmulti": {
                // `(defmulti name doc? attrs? dispatch-fn options…)`: the attribute map is metadata, left to `effects.ts`.
                let i = 1;
                while (t.type[args[i]] === "str_lit" || t.type[args[i]] === "map_lit") i++;
                mute(args[0]);
                return each(args.slice(i), cx);
            }
            case "defn": {
                // `(defn name doc? attrs? :- schema? sigs)`: the name is the var, no local; the attribute map is metadata, left to `effects.ts`.
                mute(args[0]);
                let i = 1;
                for (; i < args.length; i++) {
                    if (kwName(t, args[i]) === "-") code(args[++i] ?? -1, cx);
                    else if (t.type[args[i]] !== "str_lit" && t.type[args[i]] !== "map_lit") break;
                }
                return sigs(args.slice(i), cx);
            }
            case "defmethod":
                mute(args[0]);
                each(args.slice(1, 2), cx);
                return fnForm(args.slice(2), cx);
            case "fn":
                return fnForm(args, cx);
            case "let":
                return withVector(args, cx, (vec) => pairs(vec, cx));
            case "if-let":
                // `(if-let [b e] then else)`: the else branch doesn't see the binding.
                if (t.type[args[0]] !== "vec_lit") return each(args, hide(cx));
                code(args[1] ?? -1, pairs(args[0], cx));
                return each(args.slice(2), cx);
            case "binding":
                // `(binding [var value …] body)`: each var as `var` reads it, never a local.
                return withVector(args, cx, (vec) => {
                    fs(vec).forEach((x, i) => (i % 2 ? code(x, cx) : t.type[x] === "sym_lit" ? use(x, cx, "value", "var") : code(x, hide(cx))));
                    return cx;
                });
            case "for":
                return withVector(args, cx, (vec) => {
                    const bs = fs(vec);
                    let inner = cx;
                    for (let i = 0; i < bs.length; i += 2) {
                        const k = kwName(t, bs[i]);
                        if (k === "let") inner = t.type[bs[i + 1]] === "vec_lit" ? pairs(bs[i + 1], inner) : inner;
                        else {
                            if (bs[i + 1] !== undefined) code(bs[i + 1], inner);
                            if (k === null) inner = bindIn(bs[i], inner);
                        }
                    }
                    return inner;
                });
            case "letfn":
                return withVector(args, cx, (vec) => {
                    const fns = fs(vec).filter((x) => t.type[x] === "list_lit");
                    const inner = scope(
                        cx,
                        fns.flatMap((f) => {
                            const head = fs(f)[0];
                            if (head !== undefined) none(head);
                            return plainName(t, head) ?? [];
                        })
                    );
                    fns.forEach((f) => sigs(fs(f).slice(1), inner));
                    return inner;
                });
            case "case":
                // `(case e const result … default?)`: the constants are no code.
                each(args.slice(0, 1), cx);
                return args.slice(1).forEach((x, i, rest) => (i % 2 || i === rest.length - 1 ? code(x, cx) : mute(x)));
            case "try":
                for (const x of args) {
                    const xs = t.type[x] === "list_lit" ? fs(x) : [];
                    const head = plainName(t, xs[0]);
                    if (head === "catch") {
                        // `(catch Class e body…)`.
                        none(xs[0]);
                        mute(xs[1]);
                        each(xs.slice(3), bindIn(xs[2], cx));
                    } else if (head === "finally") {
                        none(xs[0]);
                        each(xs.slice(1), cx);
                    } else code(x, cx);
                }
                return;
            case "as->":
                each(args.slice(0, 1), cx);
                return each(args.slice(2), bindIn(args[1], cx));
            case "this-as":
                return each(args.slice(1), bindIn(args[0], cx));
            case "are":
                // `(are [x y] expr args…)`: the template's names are its own.
                code(args[1] ?? -1, bindIn(args[0], cx));
                return each(args.slice(2), cx);
            case "deftype": {
                mute(args[0]);
                const fields: string[] = [];
                if (args[1] !== undefined) binds(args[1], fields, []);
                return specs(args.slice(2), cx, fields);
            }
            case "extend":
                each(args.slice(0, 1), cx);
                return specs(args.slice(1), cx, []);
            case "proxy":
                // `(proxy [classes] [args] (method [params] body)…)`: each body sees `this`.
                mute(args[0]);
                each(args.slice(1, 2), cx);
                return specs(args.slice(2), cx, ["this"]);
            case "thread":
            case "steps": {
                // `->`, `->>` put the value as written into each step, so a step that may take it as other than code (a binding, a macro's form) holds all of it; `some->`, `cond->` and `doto` bind it to a local first.
                const risky =
                    shape === "thread" &&
                    args.slice(1).some((x) => {
                        const h = t.type[x] === "list_lit" ? (fs(x)[0] ?? -1) : x;
                        const s = symOf(t, h);
                        return !!s && !(s.ns === null && (bound(cx.locals, s.name) || isInterop(s.name))) && !EVALUATES.has(classify(s, cx.top, t.start[h]));
                    });
                const inner = risky ? hide(cx) : cx;
                const head = symOf(t, vs[0])?.name ?? "";
                code(args[0] ?? -1, inner);
                // Each step reads the value it gets first (last for `->>`): `(as-> v name …)` binds `name`, `(case v k …)` reads `k` as a constant; `cond->` has a test before each.
                return args.slice(1).forEach((x, i) => ((head.startsWith("cond") && i % 2 === 0) || t.type[x] !== "list_lit" ? code(x, inner) : list(fs(x), inner, head.endsWith(">>") ? "last" : "first")));
            }
            case "comment":
                // A REPL's scratch, which never runs.
                return args.forEach(mute);
        }
    };

    /** A list; a threading macro's step reads the value it gets in its place (`-1`), first or last. */
    const list = (vs: readonly number[], cx: Cx, thread?: "first" | "last") => {
        const s = symOf(t, vs[0] ?? -1);
        if (!s) return each(vs, cx);
        const ws = thread === "first" ? [vs[0], -1, ...vs.slice(1)] : thread === "last" ? [...vs, -1] : vs;
        // A special form comes before any local or var of its name.
        const special = s.ns === null ? SPECIAL.get(s.name) : undefined;
        if (special) {
            none(vs[0]);
            return form(special, ws, cx);
        }
        if (s.ns === null && (bound(cx.locals, s.name) || isInterop(s.name))) {
            // `Foo.`: the class a record, type or interface of the file makes, unless a local has the name.
            const ctor = !bound(cx.locals, s.name) && /^[^.]+\.$/.test(s.name) ? s.name.slice(0, -1) : null;
            set(vs[0], ctor !== null && !bound(cx.locals, ctor) ? { ns: null, name: ctor, how: "call", mode: "class", hidden: cx.hidden, shown: cx.shown, top: cx.top, at: t.start[vs[0]] } : null);
            return each(vs.slice(1), cx);
        }
        use(vs[0], cx, "call", "code");
        form(classify(s, cx.top, t.start[vs[0]]), ws, cx);
    };

    /** A form inside a syntax quote: its symbols are read when the reader reads them; `~x` is code again. */
    const syntax = (n: number, cx: Cx, quoted: boolean): void => {
        const type = t.type[n];
        if (type === "sym_lit") {
            const s = symOf(t, n)!;
            return quoted || (s.ns === null && (s.name.endsWith("#") || SPECIAL.has(s.name) || isInterop(s.name))) ? none(n) : use(n, cx, "value", "syntax");
        }
        if (type === "unquoting_lit" || type === "unquote_splicing_lit") return code(first(n), cx);
        if (type === "read_cond_lit") return syntax(branchOf(t, n, p), cx, quoted);
        const inner = ["list_lit", "vec_lit", "map_lit", "set_lit", "anon_fn_lit", "ns_map_lit"].includes(type) ? fs(n) : ["syn_quoting_lit", "derefing_lit", "var_quoting_lit", "tagged_or_ctor_lit", "quoting_lit"].includes(type) ? [first(n)] : [];
        inner.forEach((x) => syntax(x, cx, quoted || type === "quoting_lit"));
    };

    const code = (n: number, cx: Cx): void => {
        switch (t.type[n]) {
            case "sym_lit": {
                const s = symOf(t, n)!;
                return s.ns === null && (bound(cx.locals, s.name) || isInterop(s.name) || SPECIAL.has(s.name)) ? none(n) : use(n, cx, "value", "code");
            }
            case "list_lit":
                return list(fs(n), cx);
            case "anon_fn_lit":
                return list(fs(n), scope(cx, ANON));
            case "vec_lit":
            case "map_lit":
            case "set_lit":
            case "ns_map_lit":
                return each(fs(n), cx);
            case "syn_quoting_lit":
                return syntax(first(n), cx, false);
            case "var_quoting_lit":
                return t.type[first(n)] === "sym_lit" ? use(first(n), cx, "value", "var") : mute(first(n));
            case "derefing_lit":
            case "unquoting_lit":
            case "unquote_splicing_lit":
                return code(first(n), cx);
            case "tagged_or_ctor_lit": {
                // `#js {…}` is a JavaScript object of code; another tag's reader may read its form any way.
                let tag = -1;
                for (let c = t.first[n]; c >= 0; c = t.next[c]) if (t.field[c] === "tag") tag = c;
                return code(first(n), plainName(t, tag) === "js" ? cx : hide(cx));
            }
            case "read_cond_lit":
                return code(branchOf(t, n, p), cx);
            case "splicing_read_cond_lit": {
                const b = branchOf(t, n, p);
                return b >= 0 ? each(fs(b), cx) : undefined;
            }
            default:
                // Literals; `'quoted` forms, `#=`, metadata: no code to read.
                mute(n);
        }
    };

    o.tops.forEach((top, i) => {
        if (i < o.end && i !== o.nsTop) return code(top, { locals: null, hidden: false, shown: false, top: i });
        mute(top);
        if (i === o.nsTop) for (const r of o.ns?.refers.values() ?? []) if (r.node >= 0) uses.set(r.node, { ns: r.ns, name: r.name, how: "import", mode: "refer", hidden: false, shown: false, top: i, at: t.start[r.node] });
    });
    return uses;
};
