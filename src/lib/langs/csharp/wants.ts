/**
 * What the read tier fetches for C#'s names. A type its file doesn't
 * declare is provable only in the same folder (`types.ts`), where C#'s
 * convention puts it in a file named for it: for a changed file, each name
 * that may be a type, `<folder>/<Name>.cs`; for every file read, its types'
 * base types the same way, round after round. Beside that, the MSBuild
 * files that say whether its project compiles a file (`msbuild.ts`).
 */

import type { GFile } from "../../anyfacts.ts";
import type { ModuleContext } from "../../anylink.ts";
import { child, textOf, type Flat } from "../../syntax.ts";
import { projectOf } from "./msbuild.ts";
import { bare, code, dotted, TYPE_DECLARATIONS } from "./nodes.ts";

/** Whether an identifier may name a type: in a type, before `.`, or made by `new`. */
const mayBeType = (t: Flat, n: number): boolean => {
    let x = t.type[t.parent[n]] === "generic_name" ? t.parent[n] : n;
    const p = t.parent[x];
    const pt = t.type[p];
    if (pt === "member_access_expression") return t.field[x] === "expression";
    if (pt === "qualified_name") return t.field[x] === "qualifier";
    while (t.type[t.parent[x]] === "nullable_type" || t.type[t.parent[x]] === "array_type") x = t.parent[x];
    const f = t.field[x];
    return f === "type" || f === "returns" || f === "right" || ["type_argument_list", "base_list", "primary_constructor_base_type", "typeof_expression", "type_parameter_constraint"].includes(t.type[t.parent[x]]);
};

export const csharpWants = (files: readonly GFile[], ctx: ModuleContext, changed: (path: string) => boolean): string[] => {
    const out = new Set<string>();
    for (const f of files) {
        const p = projectOf(f.path, ctx);
        for (const w of p?.want ?? []) out.add(w);
        const t = f.flat;
        const dir = f.path.split("/").slice(0, -1).join("/");
        const declared = new Set<string>();
        for (let n = 0; n < t.count; n++) if (TYPE_DECLARATIONS.has(t.type[n]) || t.type[n] === "delegate_declaration") declared.add(bare(textOf(t, child(t, n, "name"))));
        const look = (name: string) => {
            if (/^[A-Z]/.test(name) && !declared.has(name)) out.add(dir ? `${dir}/${name}.cs` : `${name}.cs`);
        };
        if (changed(f.path)) for (const s of f.sites) if (t.type[s.node] === "identifier" && mayBeType(t, s.node)) look(bare(s.name));
        for (let n = 0; n < t.count; n++) {
            if (t.type[n] !== "base_list") continue;
            const first = code(t, n)[0];
            if (first !== undefined) look(dotted(t, t.type[first] === "primary_constructor_base_type" ? child(t, first, "type") : first)[0] ?? "");
        }
    }
    return [...out];
};
