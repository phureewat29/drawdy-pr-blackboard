/** Elixir's linker: the shared file index (`anyfacts.ts`) with Elixir's rule table (`rules.ts`), and a resolver of its own (`resolver.ts`), since a call names a function by module, name and arity; what its names need is read by `wants.ts`. */

import type { RulesLinker } from "../pack.ts";
import { ELIXIR } from "./index.ts";
import { ELIXIR_RESOLVER } from "./resolver.ts";
import { ELIXIR_RULES } from "./rules.ts";
import { elixirWants } from "./wants.ts";

/** The units query: tree-sitter-elixir 0.3.5's `queries/tags.scm`, copied unchanged. */
const UNITS = String.raw`; Definitions

; * modules and protocols
(call
  target: (identifier) @ignore
  (arguments (alias) @name)
  (#any-of? @ignore "defmodule" "defprotocol")) @definition.module

; * functions/macros
(call
  target: (identifier) @ignore
  (arguments
    [
      ; zero-arity functions with no parentheses
      (identifier) @name
      ; regular function clause
      (call target: (identifier) @name)
      ; function clause with a guard clause
      (binary_operator
        left: (call target: (identifier) @name)
        operator: "when")
    ])
  (#any-of? @ignore "def" "defp" "defdelegate" "defguard" "defguardp" "defmacro" "defmacrop" "defn" "defnp")) @definition.function

; References

; ignore calls to kernel/special-forms keywords
(call
  target: (identifier) @ignore
  (#any-of? @ignore "def" "defp" "defdelegate" "defguard" "defguardp" "defmacro" "defmacrop" "defn" "defnp" "defmodule" "defprotocol" "defimpl" "defstruct" "defexception" "defoverridable" "alias" "case" "cond" "else" "for" "if" "import" "quote" "raise" "receive" "require" "reraise" "super" "throw" "try" "unless" "unquote" "unquote_splicing" "use" "with"))

; ignore module attributes
(unary_operator
  operator: "@"
  operand: (call
    target: (identifier) @ignore))

; * function call
(call
  target: [
   ; local
   (identifier) @name
   ; remote
   (dot
     right: (identifier) @name)
  ]) @reference.call

; * pipe into function call
(binary_operator
  operator: "|>"
  right: (identifier) @name) @reference.call

; * modules
(alias) @name @reference.module
`;

export const ELIXIR_LINKER: RulesLinker = {
    kind: "rules",
    packs: [ELIXIR],
    units: UNITS,
    rules: ELIXIR_RULES,
    resolver: ELIXIR_RESOLVER,
    wants: elixirWants,
};
