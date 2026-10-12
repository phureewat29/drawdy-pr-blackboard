/**
 * What the read tier fetches for Clojure's names: for each changed file, the
 * file of each namespace its `ns` form requires and each `a.b/f` names, in
 * the roots it sees (`rootsFrom`), each extension its platforms try in order
 * until one answers; for ClojureScript, the Clojure file holding a
 * namespace's macros where the code may use them. Only namespaces that share
 * their first segment with a changed file's are looked for: the others are
 * libraries.
 */

import type { GFile } from "../../anyfacts.ts";
import type { ModuleContext } from "../../anylink.ts";
import { perTree, textOf, type Flat } from "../../syntax.ts";
import { CORE_NS } from "./core.ts";
import { CLJ, extensionsOf, nsPath, platformsOf, rootOf, rootsFrom, type Platform } from "./forms.ts";
import { libraryOf, readOutline, type Outline } from "./outline.ts";

/** The namespaces a file writes whole: `a.b` of `a.b/f`. */
const wholeNames = perTree((t: Flat) => new Set(Array.from({ length: t.count }, (_, n) => (t.type[n] === "sym_ns" ? textOf(t, n) : "")).filter((x) => x.includes("."))));

const outlines = new WeakMap<GFile, Map<string, Outline>>();
const outlineOf = (f: GFile, p: Platform): Outline => {
    const m = outlines.get(f) ?? new Map<string, Outline>();
    outlines.set(f, m);
    if (!m.has(p.key)) m.set(p.key, readOutline(f, p));
    return m.get(p.key)!;
};

export const clojureWants = (files: readonly GFile[], ctx: ModuleContext, changed: (path: string) => boolean): string[] => {
    const byPath = new Map(files.map((f) => [f.path, f]));
    const out = new Set<string>();
    /** In each root, the first path not known missing, asked for when unknown. Gives the file one root holds, "missing" when none does, null while unknown. */
    const want = (ns: string, root: string, p: Platform): GFile | "missing" | null => {
        let found: GFile | "missing" | null = "missing";
        for (const r of rootsFrom(root)) {
            const path = extensionsOf(p).map((ext) => `${r}${nsPath(ns)}.${ext}`).find((x) => byPath.has(x) || ctx.exists?.(x) !== false);
            if (path === undefined) continue;
            if (!byPath.has(path) && ctx.exists?.(path) === undefined) out.add(path);
            found = found === "missing" ? (byPath.get(path) ?? null) : null;
        }
        return found;
    };
    const mine = files.filter((f) => changed(f.path));
    const prefixes = new Set(mine.flatMap((f) => platformsOf(f.path, f.flat).map((p) => outlineOf(f, p).ns?.name.split(".")[0])));
    for (const f of mine) {
        for (const p of platformsOf(f.path, f.flat)) {
            const ns = outlineOf(f, p).ns;
            const root = ns ? rootOf(f.path, ns.name) : null;
            if (!ns || root === null) continue;
            // Each namespace the `ns` form names, and each `a.b/f` written whole.
            for (const name of new Set([...ns.requires, ...[...wholeNames(f.flat)].filter((x) => !ns.aliases.has(x))])) {
                if (!prefixes.has(name.split(".")[0]) || CORE_NS.has(name) || libraryOf(name)) continue;
                const g = want(name, root, p);
                // ClojureScript takes a namespace's macros from its Clojure file when the code asks, or the namespace requires its own.
                if (p.host === "cljs" && (ns.macros.has(name) || g === "missing" || (g && outlineOf(g, p).ns?.macros.has(name)))) want(name, root, CLJ);
            }
        }
    }
    return [...out];
};
