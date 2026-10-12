/** PHP's linker: the shared file index (`anyfacts.ts`) with PHP's rule table (`rules.ts`), and a resolver of its own (`resolver.ts`), since PHP's names follow its namespaces, Composer's autoloader and its classes; what its names need is read by `wants.ts`. */

import type { RulesLinker } from "../pack.ts";
import { PHP } from "./index.ts";
import { PHP_RESOLVER } from "./resolver.ts";
import { PHP_RULES } from "./rules.ts";
import { phpWants } from "./wants.ts";

/** The units query: tree-sitter-php 0.24.2's `queries/tags.scm`, copied unchanged. */
const UNITS = String.raw`(namespace_definition
  name: (namespace_name) @name) @definition.module

(interface_declaration
  name: (name) @name) @definition.interface

(trait_declaration
  name: (name) @name) @definition.interface

(class_declaration
  name: (name) @name) @definition.class

(class_interface_clause [(name) (qualified_name)] @name) @reference.implementation

(property_declaration
  (property_element (variable_name (name) @name))) @definition.field

(function_definition
  name: (name) @name) @definition.function

(method_declaration
  name: (name) @name) @definition.function

(object_creation_expression
  [
    (qualified_name (name) @name)
    (variable_name (name) @name)
  ]) @reference.class

(function_call_expression
  function: [
    (qualified_name (name) @name)
    (variable_name (name)) @name
  ]) @reference.call

(scoped_call_expression
  name: (name) @name) @reference.call

(member_call_expression
  name: (name) @name) @reference.call
`;

/** Read beside a changed file: the repository's root composer.json, where Composer's autoloader finds each class's file. */
export const PHP_LINKER: RulesLinker = {
    kind: "rules",
    packs: [PHP],
    units: UNITS,
    rules: PHP_RULES,
    resolver: PHP_RESOLVER,
    isImport: (t, n) => t.type[n] === "namespace_use_declaration",
    configFiles: () => [["composer.json"]],
    wants: phpWants,
};
