/**
 * A namespace's `ns` form, read for one platform: the aliases and referred
 * names its `:require`, `:use`, `:require-macros` and `:refer-clojure`
 * clauses give. A clause or option it doesn't know makes the form `odd`:
 * its file's names then resolve to nothing.
 */

import { textOf, type Flat } from "../../syntax.ts";
import { formsOf, kwName, nameNode, plainName, type Platform } from "./forms.ts";

/** A var a name refers to, and the token naming it in the `ns` form, or -1. */
export type Referred = { ns: string; name: string; node: number; macro: boolean };

export type NsInfo = {
    name: string;
    /** Each alias's namespace; a string library (`["react" :as r]`) gets its string. */
    aliases: Map<string, string>;
    /** Aliases `:as-alias` gives, which name keywords only. */
    keywordAliases: Set<string>;
    /** The names referred from other namespaces, by the name they go by here. */
    refers: Map<string, Referred>;
    /** The namespaces whose every public var is referred, less the names excluded, and the names renamed. */
    referAll: { ns: string; exclude: Set<string>; rename: Map<string, string> }[];
    /** ClojureScript: the namespaces whose macros an alias reaches (`:include-macros`, `:refer-macros`, `:require-macros`). */
    macros: Set<string>;
    /** `:refer-clojure`: the core names left out, those kept (null: all), and the names some go by. */
    core: { exclude: Set<string>; only: Set<string> | null; rename: Map<string, string> };
    /** Every namespace it requires or uses, in order. */
    requires: string[];
    /** A clause or option the reading doesn't know. */
    odd: boolean;
};

const FLAGS = new Set(["reload", "reload-all", "verbose"]);
const OPTIONS = new Set(["as", "as-alias", "refer", "rename", "exclude", "only", "refer-macros", "include-macros", "default"]);
const CLAUSES = new Set(["require", "use", "require-macros", "use-macros"]);

/** Reads a `(ns name doc? attrs? clauses…)` form for a platform; null when it names no namespace. */
export const readNs = (t: Flat, form: number, p: Platform): NsInfo | null => {
    const forms = (n: number) => formsOf(t, n, p);
    const names = (n: number) => forms(n).flatMap((x) => plainName(t, x) ?? []);
    /** `{a b …}`, pairs of names. */
    const pairs = (n: number) => {
        const vs = forms(n);
        const out = new Map<string, string>();
        for (let i = 0; i + 1 < vs.length; i += 2) {
            const [a, b] = [plainName(t, vs[i]), plainName(t, vs[i + 1])];
            if (a !== null && b !== null) out.set(a, b);
        }
        return out;
    };
    /** `:k v …` options, the flags aside; null when one has no value or no keyword. */
    const options = (vs: readonly number[]) => {
        const o = new Map<string, number>();
        for (let i = 0; i < vs.length; i++) {
            const k = kwName(t, vs[i]);
            if (k !== null && FLAGS.has(k)) continue;
            if (k === null || vs[i + 1] === undefined) return null;
            o.set(k, vs[++i]);
        }
        return o;
    };
    /** A libspec's namespace: a symbol, or a string naming a JavaScript library. */
    const lib = (n: number | undefined) => (n !== undefined && t.type[n] === "str_lit" ? textOf(t, n) : plainName(t, n));
    const vs = forms(form);
    const name = plainName(t, vs[1]);
    if (name === null) return null;
    const info: NsInfo = { name, aliases: new Map(), keywordAliases: new Set(), refers: new Map(), referAll: [], macros: new Set(), core: { exclude: new Set(), only: null, rename: new Map() }, requires: [], odd: false };
    /** One libspec: `a.b`, `[a.b :as x :refer [f]]`, `"lib"`. */
    const spec = (ns: string, opts: readonly number[], macros: boolean, use: boolean) => {
        info.requires.push(ns);
        const o = options(opts);
        if (!o || [...o.keys()].some((k) => !OPTIONS.has(k))) return void (info.odd = true);
        const named = (k: string) => (o.has(k) ? plainName(t, o.get(k)) : null);
        if (named("as") !== null) info.aliases.set(named("as")!, ns);
        if (named("as-alias") !== null) info.keywordAliases.add(named("as-alias")!);
        if (macros || o.has("include-macros") || o.has("refer-macros")) info.macros.add(ns);
        const rename = o.has("rename") ? pairs(o.get("rename")!) : new Map<string, string>();
        const exclude = new Set(o.has("exclude") ? names(o.get("exclude")!) : []);
        const refer = (x: number, macro: boolean) => {
            const n = plainName(t, x);
            if (n === null) info.odd = true;
            else if (!exclude.has(n)) info.refers.set(rename.get(n) ?? n, { ns, name: n, node: nameNode(t, x), macro });
        };
        // As `clojure.core/refer` reads them: `:refer`'s names, else `:use`'s `:only`, else every public var, less `:exclude`'s; `:require` refers only with `:refer`.
        const r = o.get("refer") ?? (use ? o.get("only") : undefined);
        if (r === undefined ? use : kwName(t, r) === "all") info.referAll.push({ ns, exclude, rename });
        else if (r !== undefined) forms(r).forEach((x) => refer(x, macros));
        if (o.has("refer-macros")) forms(o.get("refer-macros")!).forEach((x) => refer(x, true));
        // `["lib" :default name]`: a JavaScript library's default export.
        if (named("default") !== null) info.refers.set(named("default")!, { ns, name: "default", node: -1, macro: false });
    };
    for (const clause of vs.slice(2)) {
        if (t.type[clause] === "str_lit" || t.type[clause] === "map_lit") continue;
        const parts = t.type[clause] === "list_lit" ? forms(clause) : [];
        const k = kwName(t, parts[0]);
        if (k === "refer-clojure") {
            const o = options(parts.slice(1));
            if (!o) info.odd = true;
            for (const [key, v] of o ?? []) {
                if (key === "exclude") names(v).forEach((s) => info.core.exclude.add(s));
                else if (key === "only") info.core.only = new Set(names(v));
                else if (key === "rename") for (const [from, to] of pairs(v)) info.core.rename.set(to, from);
                else info.odd = true;
            }
        } else if (k !== null && CLAUSES.has(k)) {
            const macros = k.endsWith("macros");
            const use = k.startsWith("use");
            for (const x of parts.slice(1)) {
                const one = lib(x);
                const ps = t.type[x] === "vec_lit" || t.type[x] === "list_lit" ? forms(x) : [];
                const head = lib(ps[0]);
                if (t.type[x] === "kwd_lit") info.odd ||= !FLAGS.has(kwName(t, x) ?? "");
                else if (one !== null) spec(one, [], macros, use);
                else if (head === null) info.odd = true;
                // A vector whose second form is a keyword, or a lone name, is one libspec; anything else a prefix list, `(a [b :as ab] c)`.
                else if (t.type[x] === "vec_lit" && (ps.length === 1 || t.type[ps[1]] === "kwd_lit")) spec(head, ps.slice(1), macros, use);
                else
                    for (const y of ps.slice(1)) {
                        const ys = t.type[y] === "vec_lit" ? forms(y) : [];
                        const sub = lib(y) ?? lib(ys[0]);
                        if (sub === null) info.odd = true;
                        else spec(`${head}.${sub}`, ys.slice(1), macros, use);
                    }
            }
        } else if (k !== "import" && k !== "gen-class") info.odd = true;
    }
    return info;
};

/** The namespace an alias names in a file, or itself; "" for an alias of keywords only. */
export const targetOf = (ns: NsInfo | null, alias: string): string => ns?.aliases.get(alias) ?? (ns?.keywordAliases.has(alias) ? "" : alias);

/** The clojure.core var an unqualified name goes by when the file gives it no other: null when `:refer-clojure`'s `:exclude`, `:only` or `:rename` leaves none. */
export const coreName = (ns: NsInfo | null, name: string): string | null => {
    const c = ns?.core;
    const core = c?.rename.get(name) ?? (c && [...c.rename.values()].includes(name) ? null : name);
    return core === null || c?.exclude.has(core) || (c?.only && !c.only.has(core)) ? null : core;
};
