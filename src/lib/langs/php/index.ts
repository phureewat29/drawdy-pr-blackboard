/** PHP: cards by line patterns, no links yet. */

import { C_FAMILY, C_LIKE } from "../c-family.ts";
import type { LanguagePack } from "../pack.ts";

export const PHP: LanguagePack = {
    id: "php",
    name: "PHP",
    extensions: ["php"],
    highlight: { keywords: `${C_LIKE} function echo namespace use fn match array`, comment: "//", blocks: true },
    lines: C_FAMILY,
};
