/**
 * Clojure's syntax as tree-sitter-clojure-orchard 0.2.8 writes it: every
 * form is a list, vector, map, symbol or literal, and a form's own forms sit
 * in its `value` field. A `.cljc` file is read once per platform, each
 * reader conditional giving the branch the platform's features pick. And
 * where a namespace's file is: under a source root, at its name's path.
 */

import { perTree, textOf, type Flat } from "../../syntax.ts";

/** A platform a file is read for: its reader features, and its host, which says which files hold a namespace. */
export type Platform = { key: string; features: ReadonlySet<string>; host: "clj" | "cljs" | "cljr" };

export type Sym = { ns: string | null; name: string };

/** A form's own forms as written, comments and `#_` aside; the file's top-level forms for its root. */
export const valuesOf = (t: Flat, n: number): number[] => {
    const out: number[] = [];
    for (let c = t.first[n]; c >= 0; c = t.next[c]) if (n ? t.field[c] === "value" : t.named[c] && t.type[c] !== "comment" && t.type[c] !== "dis_expr") out.push(c);
    return out;
};

/** A symbol's or keyword's namespace and name, metadata aside (`::k` has the namespace `::`); null for any other form. */
export const partsOf = (t: Flat, n: number): Sym | null => {
    let ns: string | null = null;
    let name: string | null = null;
    for (let c = t.first[n]; c >= 0 && (t.type[n] === "sym_lit" || t.type[n] === "kwd_lit"); c = t.next[c]) {
        if (t.field[c] === "namespace") ns = textOf(t, c);
        else if (t.field[c] === "name") name = textOf(t, c);
        else if (t.type[c] === "::") ns = "::";
    }
    return name === null ? null : { ns, name };
};

/** A symbol's namespace and name. */
export const symOf = (t: Flat, n: number): Sym | null => (t.type[n] === "sym_lit" ? partsOf(t, n) : null);

const plain = (t: Flat, n: number | undefined, type: string): string | null => {
    const s = n !== undefined && t.type[n] === type ? partsOf(t, n) : null;
    return s && s.ns === null ? s.name : null;
};
/** An unqualified symbol's name, or null. */
export const plainName = (t: Flat, n: number | undefined) => plain(t, n, "sym_lit");
/** A plain keyword's name, `:as` giving `as`, or null. */
export const kwName = (t: Flat, n: number | undefined) => plain(t, n, "kwd_lit");

/** The name node of a symbol, or -1. */
export const nameNode = (t: Flat, n: number): number => {
    for (let c = t.first[n]; c >= 0; c = t.next[c]) if (t.field[c] === "name" && t.type[c] === "sym_name") return c;
    return -1;
};

/** The branch of `#?(…)` a platform reads: the first whose feature it has, or `:default`; -1 for none. */
export const branchOf = (t: Flat, n: number, p: Platform): number => {
    const vs = valuesOf(t, n);
    for (let i = 0; i + 1 < vs.length; i += 2) {
        const k = kwName(t, vs[i]);
        if (k !== null && (p.features.has(k) || k === "default")) return vs[i + 1];
    }
    return -1;
};

/** A form's own forms as a platform reads them: `#?(…)` gives its branch, `#?@(…)` its branch's forms in line. */
export const formsOf = (t: Flat, n: number, p: Platform): number[] => {
    const out: number[] = [];
    const add = (c: number) => {
        const splice = t.type[c] === "splicing_read_cond_lit";
        const b = splice || t.type[c] === "read_cond_lit" ? branchOf(t, c, p) : -2;
        if (b === -2) out.push(c);
        else if (b >= 0) (splice ? valuesOf(t, b) : [b]).forEach(add);
    };
    valuesOf(t, n).forEach(add);
    return out;
};

/** Every reader feature a file's conditionals name. */
const featuresOf = perTree((t: Flat): Set<string> => {
    const out = new Set<string>();
    for (let n = 0; n < t.count; n++) if (t.type[n] === "read_cond_lit" || t.type[n] === "splicing_read_cond_lit") valuesOf(t, n).forEach((k, i) => i % 2 === 0 && kwName(t, k) !== null && out.add(kwName(t, k)!));
    return out;
});

const platform = (key: string, host: Platform["host"], ...features: string[]): Platform => ({ key, features: new Set(features), host });

/** Clojure's platform, which also defines the macros ClojureScript code uses. */
export const CLJ = platform("clj", "clj", "clj");

/**
 * The platforms a file is read for: `.clj` Clojure's, `.cljs`
 * ClojureScript's, `.cljc` both; ClojureCLR's where a `.cljc` file names
 * `:cljr`; and each with any other feature its conditionals name added
 * (babashka's `:bb`, a build's own), since a build may read it so.
 */
export const platformsOf = (path: string, t: Flat): Platform[] => {
    const ext = path.slice(path.lastIndexOf(".") + 1);
    const base = ext === "cljs" ? [platform("cljs", "cljs", "cljs")] : ext === "cljc" ? [CLJ, platform("cljs", "cljs", "cljs")] : [CLJ];
    const out = [...base];
    for (const f of featuresOf(t)) {
        if (f === "cljr" && ext === "cljc") out.push(platform(f, f, f));
        else if (f !== "clj" && f !== "cljs" && f !== "default" && f !== "cljr") for (const b of base) out.push(platform(`${b.key}+${f}`, b.host, ...b.features, f));
    }
    return out;
};

/** The path a namespace's files take under a source root, without the extension: `a.b-c` is `a/b_c`. */
export const nsPath = (ns: string): string => ns.replace(/-/g, "_").replace(/\./g, "/");

/** A file's source root, its path less its namespace's (`src/` for `src/a/b_c.clj` of `a.b-c`); null when they don't match. */
export const rootOf = (path: string, ns: string): string | null => {
    const tail = nsPath(ns);
    const bare = path.slice(0, path.lastIndexOf("."));
    return bare === tail ? "" : bare.endsWith(`/${tail}`) ? bare.slice(0, bare.length - tail.length) : null;
};

/**
 * The roots a file in `root` finds namespaces in: its own, and from a test
 * root the main one beside it (`test/` and `src/`, `test/clj/` and
 * `src/clj/`, `src/test/clojure/` and `src/main/clojure/`). Other roots
 * belong to builds whose classpath the files don't show.
 */
export const rootsFrom = (root: string): string[] => {
    const maven = /^(.*\/)?src\/test\/([^/]+\/)$/.exec(root);
    const test = /^(.*\/)?test\/((?:[^/]+\/)?)$/.exec(root);
    return maven ? [root, `${maven[1] ?? ""}src/main/${maven[2]}`] : test ? [root, `${test[1] ?? ""}src/${test[2]}`] : [root];
};

/** The extensions a platform loads a namespace from, the first found winning: Clojure's `.clj` before `.cljc`, ClojureScript's `.cljs`, babashka's `.bb`. */
export const extensionsOf = (p: Platform): string[] => (p.host !== "clj" ? [p.host, "cljc"] : p.features.has("bb") ? ["bb", "clj", "cljc"] : ["clj", "cljc"]);
