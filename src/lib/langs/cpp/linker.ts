/**
 * C++'s linker: units alone, read as C's are (`../c/units.ts`), with classes,
 * their members and qualified definitions (`Wallet::Get()`). Overloads by
 * type, templates, argument-dependent lookup and macros decide its calls, so
 * it draws no lines yet.
 */

import { cLabel, functionUnits, typeUnit } from "../c/units.ts";
import { unitsOnly } from "../units-only.ts";
import { CPP } from "./index.ts";

/** The units query: tree-sitter-cpp 0.23.4's `queries/tags.scm`, copied unchanged. */
const UNITS = String.raw`(struct_specifier name: (type_identifier) @name body:(_)) @definition.class

(declaration type: (union_specifier name: (type_identifier) @name)) @definition.class

(function_declarator declarator: (identifier) @name) @definition.function

(function_declarator declarator: (field_identifier) @name) @definition.function

(function_declarator declarator: (qualified_identifier scope: (namespace_identifier) @local.scope name: (identifier) @name)) @definition.method

(type_definition declarator: (type_identifier) @name) @definition.type

(enum_specifier name: (type_identifier) @name) @definition.type

(class_specifier name: (type_identifier) @name) @definition.class
`;

export const CPP_LINKER = unitsOnly([CPP], UNITS, { unit: typeUnit, extraUnits: functionUnits, label: cLabel }, (t, n) => t.type[n] === "preproc_include" || t.type[n] === "using_declaration");
