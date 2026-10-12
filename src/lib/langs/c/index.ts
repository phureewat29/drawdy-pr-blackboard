/** C, with C++ and Objective-C until they have packs of their own: cards by line patterns, no links yet. */

import { C_FAMILY } from "../c-family.ts";
import type { LanguagePack } from "../pack.ts";

export const C: LanguagePack = {
    id: "c",
    name: "C",
    extensions: ["c", "h", "cc", "cpp", "hpp", "m"],
    fences: ["cpp"],
    highlight: { keywords: "if else for while do switch case break continue default return struct union enum typedef static const void int char long short unsigned signed float double sizeof include define NULL true false class public private protected template typename namespace using virtual auto", comment: "//", blocks: true },
    lines: C_FAMILY,
};
