/**
 * Every linker (`pack.ts`), one line each: what turns a pack's files into
 * units and links, in the parser worker alone. A linker of units alone
 * (`units-only.ts`) gives a pack's files a card per declaration and no
 * links; a pack draws links once a linker that resolves names is listed
 * here, after a truth gate finds no wrong link and an independent review
 * agrees. Own linkers link first, in this order, then every rule table in
 * one pass.
 */

import { C_LINKER } from "./c/linker.ts";
import { CPP_LINKER } from "./cpp/linker.ts";
import { CSHARP_LINKER } from "./csharp/linker.ts";
import { GO_LINKER } from "./go/linker.ts";
import { HASKELL_LINKER } from "./haskell/linker.ts";
import { JAVA_LINKER } from "./java/linker.ts";
import { JS_LINKER } from "./javascript/linker.ts";
import { KOTLIN_LINKER } from "./kotlin/linker.ts";
import type { Linker } from "./pack.ts";
import { PHP_LINKER } from "./php/linker.ts";
import { PYTHON_LINKER } from "./python/linker.ts";
import { RUST_LINKER } from "./rust/linker.ts";
import { SCALA_LINKER } from "./scala/linker.ts";

export const LINKERS: readonly Linker[] = [JS_LINKER, PYTHON_LINKER, GO_LINKER, RUST_LINKER, JAVA_LINKER, CSHARP_LINKER, PHP_LINKER, KOTLIN_LINKER, C_LINKER, CPP_LINKER, SCALA_LINKER, HASKELL_LINKER];
