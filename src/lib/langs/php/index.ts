/** PHP: linked by its rule table and a resolver of its own (`linker.ts`). */

import { C_FAMILY, C_LIKE } from "../c-family.ts";
import type { LanguagePack } from "../pack.ts";

/** Its grammar reads HTML around `<?php … ?>` too (templates, config stubs), unlike `tree-sitter-php_only.wasm`, which reads PHP alone. */
export const PHP: LanguagePack = {
    id: "php",
    name: "PHP",
    extensions: ["php"],
    grammars: [{ name: "php", extensions: ["php"], package: "tree-sitter-php", version: "0.24.2", file: "tree-sitter-php.wasm", sha256: "d4df6a6ff08c87c3ec4f9cbb785fe09998a0cb570e03f57d7b19b3acfb146aa7", typedMethods: true }],
    highlight: { keywords: `${C_LIKE} echo namespace use fn match array`, comment: "//", blocks: true },
    lines: C_FAMILY,
    tests: [/Test\.php$/],
    naming: { member: "::" },
};
