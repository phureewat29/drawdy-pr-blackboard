/** Java's linker: the shared file index (`anyfacts.ts`) with Java's rule table (`rules.ts`), and a resolver of its own (`resolver.ts`), since Java's names follow the JLS; what its names need is read by `wants.ts`. */

import type { RulesLinker } from "../pack.ts";
import { JAVA } from "./index.ts";
import { JAVA_RESOLVER } from "./resolver.ts";
import { JAVA_RULES } from "./rules.ts";
import { javaWants } from "./wants.ts";

/** The units query: tree-sitter-java 0.23.5's `queries/tags.scm`, copied unchanged. */
const UNITS = String.raw`(class_declaration
  name: (identifier) @name) @definition.class

(method_declaration
  name: (identifier) @name) @definition.method

(method_invocation
  name: (identifier) @name
  arguments: (argument_list) @reference.call)

(interface_declaration
  name: (identifier) @name) @definition.interface

(type_list
  (type_identifier) @name) @reference.implementation

(object_creation_expression
  type: (type_identifier) @name) @reference.class

(superclass (type_identifier) @name) @reference.class
`;

export const JAVA_LINKER: RulesLinker = {
    kind: "rules",
    packs: [JAVA],
    units: UNITS,
    rules: JAVA_RULES,
    resolver: JAVA_RESOLVER,
    isImport: (t, n) => t.type[n] === "import_declaration",
    wants: javaWants,
};
