/** Python's linker: the shared rule-table linker (`anyfacts.ts`, `anylink.ts`) with Python's rule table (`rules.ts`), typing (`typing.ts`) and module lookup (`modules.ts`). */

import type { RulesLinker } from "../pack.ts";
import { PYTHON } from "./index.ts";
import { isPackage, packageMarkers } from "./modules.ts";
import { PYTHON_RULES } from "./rules.ts";
import { PYTHON_RESOLVER } from "./typing.ts";

/** The units query: tree-sitter-python 0.25.0's `queries/tags.scm`, copied unchanged. */
const UNITS = String.raw`(module (expression_statement (assignment left: (identifier) @name) @definition.constant))

(class_definition
  name: (identifier) @name) @definition.class

(function_definition
  name: (identifier) @name) @definition.function

(call
  function: [
      (identifier) @name
      (attribute
        attribute: (identifier) @name)
  ]) @reference.call
`;

export const PYTHON_LINKER: RulesLinker = {
    kind: "rules",
    packs: [PYTHON],
    units: UNITS,
    rules: PYTHON_RULES,
    resolver: PYTHON_RESOLVER,
    isImport: (t, n) => t.type[n] === "import_statement" || t.type[n] === "import_from_statement" || t.type[n] === "future_import_statement",
    isPackage,
    packageMarkers,
};
