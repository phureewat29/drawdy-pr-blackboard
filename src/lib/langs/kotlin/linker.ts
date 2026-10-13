/**
 * Kotlin's linker: the shared file index (`anyfacts.ts`) with Kotlin's rule
 * table (`rules.ts`), and a resolver of its own (`program.ts`), since
 * Kotlin's names follow its own lookup: locals, implicit receivers, then
 * the file's imports, its package and the default imports. What its names
 * need beside a changed file is read by `wants.ts`.
 */

import type { OwnResolver } from "../../anylink.ts";
import type { RulesLinker } from "../pack.ts";
import { KOTLIN } from "./index.ts";
import { kotlinProgram } from "./program.ts";
import { isImport, KOTLIN_RULES, UNITS } from "./rules.ts";
import { kotlinWants } from "./wants.ts";

const resolver: OwnResolver = { program: (files, ctx) => kotlinProgram(files, ctx) };

export const KOTLIN_LINKER: RulesLinker = {
    kind: "rules",
    packs: [KOTLIN],
    units: UNITS,
    rules: KOTLIN_RULES,
    resolver,
    isImport,
    wants: kotlinWants,
};
