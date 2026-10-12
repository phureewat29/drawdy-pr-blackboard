/**
 * Every linker (`pack.ts`), one line each: what turns a pack's files into
 * units and links, in the parser worker alone. A pack draws links once its
 * linker is listed here, after a truth gate finds no wrong link and an
 * independent review agrees. Own linkers link first, in this order, then
 * every rule table in one pass.
 */

import { GO_LINKER } from "./go/linker.ts";
import { JAVA_LINKER } from "./java/linker.ts";
import { JS_LINKER } from "./javascript/linker.ts";
import type { Linker } from "./pack.ts";
import { PYTHON_LINKER } from "./python/linker.ts";
import { RUST_LINKER } from "./rust/linker.ts";

export const LINKERS: readonly Linker[] = [JS_LINKER, PYTHON_LINKER, GO_LINKER, RUST_LINKER, JAVA_LINKER];
