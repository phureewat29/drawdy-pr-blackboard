/** Kotlin: cards by line patterns, no links yet. */

import { C_FAMILY } from "../c-family.ts";
import type { LanguagePack } from "../pack.ts";

export const KOTLIN: LanguagePack = {
    id: "kt",
    name: "Kotlin",
    extensions: ["kt", "kts"],
    fences: ["kotlin"],
    highlight: { keywords: "fun val var class object interface if else when for while do return break continue try catch finally throw import package as is in out null true false this super override open data sealed suspend companion private public internal protected", comment: "//", blocks: true },
    lines: C_FAMILY,
    tests: [/Tests?\.kt$/],
};
