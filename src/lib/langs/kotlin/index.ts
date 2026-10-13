/**
 * Kotlin: a card per declaration from its parser and lines its own resolver
 * proves (`linker.ts`). A member's card is named for its type, `Request.newBuilder()`. Scripts
 * (`.kts`, mostly Gradle's build files) keep the line patterns, so a Java
 * PR that touches one downloads no Kotlin parser. Tests are files named for
 * one, and those in a multiplatform test source set (`src/jvmTest/`).
 */

import { C_FAMILY } from "../c-family.ts";
import type { CaseRule, LanguagePack } from "../pack.ts";

const TEST_FUN = /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|internal|private|protected|override|open|suspend)\s+)*fun\s+(`[^`]+`|\w+)\s*\(/;

/** A JUnit or kotlin.test case: a function under `@Test`, on its line or the next. */
const kotlinCase: CaseRule = (line, next) => {
    if (!/^\s*@(?:Test|ParameterizedTest|RepeatedTest|TestFactory)\b/.test(line)) return undefined;
    const m = TEST_FUN.exec(line) ?? TEST_FUN.exec(next ?? "");
    return m ? { name: m[1].replace(/`/g, ""), group: false } : undefined;
};

export const KOTLIN: LanguagePack = {
    id: "kt",
    name: "Kotlin",
    extensions: ["kt", "kts"],
    fences: ["kotlin"],
    grammars: [{ name: "kotlin", extensions: ["kt"], package: "@tree-sitter-grammars/tree-sitter-kotlin", version: "1.1.0", file: "tree-sitter-kotlin.wasm", sha256: "7009d69453bc8735e438b2818a633efb21c88f99782769abba60dffedfab73f7", typedMethods: true }],
    highlight: { keywords: "fun val var class object interface if else when for while do return break continue try catch finally throw import package as is in out null true false this super override open data sealed suspend companion private public internal protected", comment: "//", blocks: true },
    lines: C_FAMILY,
    tests: [/Tests?\.kt$/, /(^|\/)src\/\w+Test\/.+\.kt$/],
    cases: kotlinCase,
    naming: { member: "." },
};
