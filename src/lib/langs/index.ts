/**
 * Every language pack (`pack.ts`), one line each. The order is the order the
 * reader is told parsers in ("Python and Go parsers") and the order each
 * pack's test-case rule is tried. A pack with no linker in `linkers.ts` gets
 * cards from its line patterns and no links. This list goes to the driver
 * too: it holds no parser code.
 */

import { C } from "./c/index.ts";
import { CSHARP } from "./csharp/index.ts";
import { FORMATS } from "./formats.ts";
import { GO } from "./go/index.ts";
import { JAVA } from "./java/index.ts";
import { JAVASCRIPT, TYPESCRIPT } from "./javascript/index.ts";
import { KOTLIN } from "./kotlin/index.ts";
import type { LanguagePack } from "./pack.ts";
import { PHP } from "./php/index.ts";
import { PYTHON } from "./python/index.ts";
import { RUBY } from "./ruby/index.ts";
import { RUST } from "./rust/index.ts";
import { SWIFT } from "./swift/index.ts";

export const PACKS: readonly LanguagePack[] = [TYPESCRIPT, JAVASCRIPT, PYTHON, GO, RUST, JAVA, KOTLIN, SWIFT, RUBY, PHP, CSHARP, C, ...FORMATS];
