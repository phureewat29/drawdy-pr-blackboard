/** Swift: cards by line patterns, no links yet. */

import { C_FAMILY } from "../c-family.ts";
import type { LanguagePack } from "../pack.ts";

export const SWIFT: LanguagePack = {
    id: "swift",
    name: "Swift",
    extensions: ["swift"],
    highlight: { keywords: "func let var class struct enum protocol extension if else guard for while repeat return break continue switch case default import self Self nil true false init deinit throws throw try catch async await public private internal fileprivate static", comment: "//", blocks: true },
    lines: C_FAMILY,
    tests: [/Tests?\.swift$/],
};
