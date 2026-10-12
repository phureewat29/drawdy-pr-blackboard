/** Rust's linker: the shared rule-table linker (`anyfacts.ts`, `anylink.ts`) with Rust's rule table (`rules.ts`) and typing (`typing.ts`). Names resolve only inside their own file, since the crate's `mod` tree isn't read. */

import type { RulesLinker } from "../pack.ts";
import { RUST } from "./index.ts";
import { RUST_RULES } from "./rules.ts";
import { RUST_RESOLVER } from "./typing.ts";

/** The units query: tree-sitter-rust 0.24.0's `queries/tags.scm`, copied unchanged. */
const UNITS = String.raw`; ADT definitions

(struct_item
    name: (type_identifier) @name) @definition.class

(enum_item
    name: (type_identifier) @name) @definition.class

(union_item
    name: (type_identifier) @name) @definition.class

; type aliases

(type_item
    name: (type_identifier) @name) @definition.class

; method definitions

(declaration_list
    (function_item
        name: (identifier) @name) @definition.method)

; function definitions

(function_item
    name: (identifier) @name) @definition.function

; trait definitions
(trait_item
    name: (type_identifier) @name) @definition.interface

; module definitions
(mod_item
    name: (identifier) @name) @definition.module

; macro definitions

(macro_definition
    name: (identifier) @name) @definition.macro

; references

(call_expression
    function: (identifier) @name) @reference.call

(call_expression
    function: (field_expression
        field: (field_identifier) @name)) @reference.call

(macro_invocation
    macro: (identifier) @name) @reference.call

; implementations

(impl_item
    trait: (type_identifier) @name) @reference.implementation

(impl_item
    type: (type_identifier) @name
    !trait) @reference.implementation
`;

export const RUST_LINKER: RulesLinker = {
    kind: "rules",
    packs: [RUST],
    units: UNITS,
    rules: RUST_RULES,
    resolver: RUST_RESOLVER,
    isImport: (t, n) => t.type[n] === "use_declaration",
    local: true,
};
