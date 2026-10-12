/**
 * What the read tier fetches for PHP's names: the files a changed file's
 * sites lead to, found by resolving them over the files read so far. Each
 * class a lookup needs and no file read declares is wanted at the first
 * file of Composer's PSR-4 map not known to be missing; asked again after
 * each round of reads, a class's parents, traits and interfaces, the
 * classes its receivers' declared types name, follow as lookups reach them.
 */

import type { RulesLinker } from "../pack.ts";
import { createProgram } from "./program.ts";
import { resolveAll } from "./resolver.ts";

export const phpWants: NonNullable<RulesLinker["wants"]> = (files, ctx, changed) => {
    const out = new Set<string>();
    const p = createProgram(files, ctx, (path) => out.add(path));
    for (const f of files) if (changed(f.path)) resolveAll(p, f);
    return [...out];
};
