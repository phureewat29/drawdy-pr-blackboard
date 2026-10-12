/**
 * C's linker: units alone (`units-only.ts`, `units.ts`). A call to a function
 * defined in another file is proven only against every C file in the build,
 * and many calls are to function-like macros, so it draws no lines yet.
 */

import { unitsOnly } from "../units-only.ts";
import { C } from "./index.ts";
import { cLabel, functionUnits, typeUnit } from "./units.ts";

/** The units query: tree-sitter-c 0.24.1's `queries/tags.scm`, copied unchanged. */
const UNITS = String.raw`(struct_specifier name: (type_identifier) @name body:(_)) @definition.class

(declaration type: (union_specifier name: (type_identifier) @name)) @definition.class

(function_declarator declarator: (identifier) @name) @definition.function

(type_definition declarator: (type_identifier) @name) @definition.type

(enum_specifier name: (type_identifier) @name) @definition.type
`;

export const C_LINKER = unitsOnly([C], UNITS, { unit: typeUnit, extraUnits: functionUnits, label: cLabel }, (t, n) => t.type[n] === "preproc_include");
