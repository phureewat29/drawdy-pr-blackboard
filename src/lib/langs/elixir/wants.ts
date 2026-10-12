/**
 * What the read tier fetches for Elixir's names: for each changed file, the
 * file of each module its calls, imports and delegates name, by the
 * convention that `MyApp.HTTPClient` lives in `<root>/my_app/http_client.ex`.
 * Nothing enforces it, so a module is linked only once a file read defines
 * it (`resolver.ts`). A module whose file is missing may be defined inside
 * its parent's: that one is tried next. Only modules of the namespaces the
 * files read define are asked for, not the standard library's or a
 * dependency's. A `use`d module is also looked for in the project's
 * `test/support/` (a case template's place), and the `mix.exs` of each
 * changed file and case template, which bounds what its names may reach.
 */

import type { GFile } from "../../anyfacts.ts";
import type { ModuleContext } from "../../anylink.ts";
import { child } from "../../syntax.ts";
import { underscore } from "./names.ts";
import { nameOf, option, segmentsOf } from "./nodes.ts";
import { outline } from "./outline.ts";
import { mixFolders } from "./resolver.ts";

/** Where a file's modules are found: the `lib/` beside the `test/` a test sits in, else the nearest `lib/` above it, and in a repository of several apps (`lib/<app>/lib/`, `apps/<app>/lib/`) the app named for the module's first part. */
const rootsOf = (path: string, first: string): string[] => {
    const parts = path.split("/");
    const test = parts.indexOf("test");
    let root: string | null = null;
    if (test >= 0) root = [...parts.slice(0, test), "lib", ""].join("/");
    else for (let k = parts.length - 2; k >= 0 && root === null; k--) if (parts[k] === "lib") root = [...parts.slice(0, k + 1), ""].join("/");
    if (root === null) return [];
    const app = /(^|\/)[^/]+\/lib\/$/.test(root) ? root.replace(/[^/]+\/lib\/$/, `${underscore(first)}/lib/`) : root;
    return [...new Set([root, app])];
};

/** The files Elixir's names need, given the files read and what the reads found so far; asked again after each round. */
export const elixirWants = (files: readonly GFile[], ctx: ModuleContext, changed: (path: string) => boolean): string[] => {
    // Each module the files read define, and the file it is in.
    const pathOf = new Map<string, string>();
    for (const f of files) {
        const o = outline(f.flat);
        for (const m of o.mods) if (o.fullName(m)) pathOf.set(o.fullName(m)!, f.path);
    }
    const defined = new Set(pathOf.keys());
    const spaces = new Set([...defined].map((n) => n.split(".")[0]));
    const out: string[] = [];
    for (const f of files) {
        if (!changed(f.path)) continue;
        const t = f.flat;
        const o = outline(t);
        const want = (written: string | null) => {
            // A name marked after a `use` (`?MyApp.X`) is asked for as written: the resolver decides.
            const mod = written?.replace(/^\?/, "") ?? null;
            if (!mod || defined.has(mod) || !spaces.has(mod.split(".")[0])) return;
            const roots = rootsOf(f.path, mod.split(".")[0]);
            for (let segs = mod.split("."); segs.length > 0; segs = segs.slice(0, -1)) {
                const paths = roots.map((r) => `${r}${underscore(segs.join("."))}.ex`);
                out.push(...paths.filter((p) => ctx.exists?.(p) !== false));
                if (!paths.every((p) => ctx.exists?.(p) === false)) return;
            }
        };
        for (let n = 0; n < t.count; n++) {
            if (t.type[n] !== "call") continue;
            const target = child(t, n, "target");
            const segs = target >= 0 && t.type[target] === "dot" ? segmentsOf(t, child(t, target, "left")) : nameOf(t, n) === "defdelegate" ? segmentsOf(t, option(t, n, "to")) : null;
            if (segs) want(o.moduleName(segs, o.visible(n, t.start[n]), n));
        }
        for (const d of o.dirs) if (d.kind === "import" || d.kind === "use") want(o.targetOf(d));
        // `use MyApp.DataCase`: a case template, by convention in `test/support/data_case.ex`.
        const parts = f.path.split("/");
        const test = parts.indexOf("test");
        for (const d of o.dirs) {
            const mod = d.kind === "use" ? o.targetOf(d) : null;
            const path = mod && test >= 0 ? [...parts.slice(0, test), "test", "support", `${underscore(mod.split(".").pop()!)}.ex`].join("/") : null;
            if (path && !defined.has(mod!) && spaces.has(mod!.split(".")[0]) && ctx.exists?.(path) !== false) out.push(path);
        }
    }
    // The `mix.exs` of each changed file and of each case template one uses, where `projectOf` (`resolver.ts`) looks: the folder holding its deepest `lib/` or `test/` first; where that has none, or under `test/`, every folder up at once.
    const known = new Set(ctx.known);
    const there = (dir: string) => known.has(dir ? `${dir}/mix.exs` : "mix.exs") || ctx.exists?.(dir ? `${dir}/mix.exs` : "mix.exs");
    const looked = new Set<string>();
    for (const f of files) {
        if (!changed(f.path)) continue;
        const o = outline(f.flat);
        looked.add(f.path);
        for (const d of o.dirs) if (d.kind === "use" && pathOf.has(o.targetOf(d) ?? "")) looked.add(pathOf.get(o.targetOf(d)!)!);
    }
    for (const path of looked) {
        const { order, first } = mixFolders(path);
        // The first ones at once; the rest once those all turn out missing.
        const asked = order.slice(0, first).some((d) => there(d) !== false) ? order.slice(0, first) : order;
        for (const d of asked) {
            const at = there(d);
            if (at === true) break;
            if (at === undefined) out.push(d ? `${d}/mix.exs` : "mix.exs");
        }
    }
    return [...new Set(out)];
};
