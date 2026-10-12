/** Go's linker: the shared rule-table linker (`anyfacts.ts`, `anylink.ts`) with Go's rule table (`rules.ts`), typing (`typing.ts`), modules (`modules.ts`) and build constraints (`build.ts`). */

import type { RulesLinker } from "../pack.ts";
import { GO } from "./index.ts";
import { goModsAbove } from "./modules.ts";
import { GO_RULES } from "./rules.ts";
import { GO_RESOLVER } from "./typing.ts";

/** The units query: tree-sitter-go 0.25.0's `queries/tags.scm`, copied unchanged. */
const UNITS = String.raw`(
  (comment)* @doc
  .
  (function_declaration
    name: (identifier) @name) @definition.function
  (#strip! @doc "^//\\s*")
  (#set-adjacent! @doc @definition.function)
)

(
  (comment)* @doc
  .
  (method_declaration
    name: (field_identifier) @name) @definition.method
  (#strip! @doc "^//\\s*")
  (#set-adjacent! @doc @definition.method)
)

(call_expression
  function: [
    (identifier) @name
    (parenthesized_expression (identifier) @name)
    (selector_expression field: (field_identifier) @name)
    (parenthesized_expression (selector_expression field: (field_identifier) @name))
  ]) @reference.call

(type_spec
  name: (type_identifier) @name) @definition.type

(type_identifier) @name @reference.type

(package_clause "package" (package_identifier) @name)

(type_declaration (type_spec name: (type_identifier) @name type: (interface_type)))

(type_declaration (type_spec name: (type_identifier) @name type: (struct_type)))

(import_declaration (import_spec) @name)

(var_declaration (var_spec name: (identifier) @name))

(const_declaration (const_spec name: (identifier) @name))
`;

/** The `go.mod` above a changed file, the nearest that answers, which says where its module's imports start. */
const configFiles = (path: string): string[][] => [goModsAbove(path)];

export const GO_LINKER: RulesLinker = {
    kind: "rules",
    packs: [GO],
    units: UNITS,
    rules: GO_RULES,
    resolver: GO_RESOLVER,
    isImport: (t, n) => t.type[n] === "import_declaration",
    configFiles,
};
