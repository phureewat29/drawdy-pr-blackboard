/** C#: cards by line patterns, no links yet. */

import { C_FAMILY, C_LIKE } from "../c-family.ts";
import type { LanguagePack } from "../pack.ts";

export const CSHARP: LanguagePack = {
    id: "cs",
    name: "C#",
    extensions: ["cs"],
    fences: ["csharp"],
    highlight: { keywords: `${C_LIKE} using namespace readonly override virtual sealed partial string int bool var get set async await`, comment: "//", blocks: true },
    lines: C_FAMILY,
    tests: [/Tests?\.cs$/],
};
