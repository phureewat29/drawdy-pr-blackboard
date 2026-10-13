/**
 * C: a card per declaration from its parser, and a line from each call it
 * can prove (`linker.ts`, `resolver.ts`). Headers are C++'s (`../cpp/`):
 * that grammar reads C's as well, and C's fails on most C++ headers, so C's
 * lines read headers through C++'s files. Objective-C (`.m`) reads by line
 * patterns alone.
 */

import { C_FAMILY, C_KEYWORDS } from "../c-family.ts";
import type { LanguagePack } from "../pack.ts";

export const C: LanguagePack = {
    id: "c",
    name: "C",
    extensions: ["c", "m"],
    grammars: [{ name: "c", extensions: ["c"], package: "tree-sitter-c", version: "0.24.1", file: "tree-sitter-c.wasm", sha256: "c852c2a85ebf2beb636aa3b0ef7f7e70458684d74f6741b20dcb296885bed9f9" }],
    highlight: { keywords: C_KEYWORDS, comment: "//", blocks: true },
    lines: C_FAMILY,
    tests: [/_tests?\.c$/],
};
