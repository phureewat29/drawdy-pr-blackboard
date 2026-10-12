/** C#: linked by its rule table and a resolver of its own (`linker.ts`). */

import { C_FAMILY, C_LIKE } from "../c-family.ts";
import type { LanguagePack } from "../pack.ts";

export const CSHARP: LanguagePack = {
    id: "cs",
    name: "C#",
    extensions: ["cs"],
    fences: ["csharp"],
    grammars: [{ name: "c_sharp", extensions: ["cs"], package: "tree-sitter-c-sharp", version: "0.23.5", file: "tree-sitter-c_sharp.wasm", sha256: "6f69e1cae44e1c32c1eccc170dc5a9778fb94ff716f71113fe1f8c4299aa2f40", typedMethods: true }],
    highlight: { keywords: `${C_LIKE} using namespace readonly override virtual sealed partial string int bool var get set async await`, comment: "//", blocks: true },
    lines: C_FAMILY,
    tests: [/Tests?\.cs$/],
};
