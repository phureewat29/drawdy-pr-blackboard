/** Java: linked by its rule table and a resolver of its own (`linker.ts`). */

import { C_FAMILY, C_LIKE } from "../c-family.ts";
import type { LanguagePack } from "../pack.ts";

export const JAVA: LanguagePack = {
    id: "java",
    name: "Java",
    extensions: ["java"],
    grammars: [{ name: "java", extensions: ["java"], package: "tree-sitter-java", version: "0.23.5", file: "tree-sitter-java.wasm", sha256: "4fdeac4ca6ca089f06c6f7e562abcac1733cd465728cc7031ebb73c2019122c4", typedMethods: true }],
    highlight: { keywords: `${C_LIKE} final abstract synchronized throws boolean int long double float char byte short`, comment: "//", blocks: true },
    lines: C_FAMILY,
    tests: [/Tests?\.java$/],
};
