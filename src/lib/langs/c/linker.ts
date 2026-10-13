/**
 * C's linker: its units (`units.ts`), read as before, and calls to a bare
 * name as its sites; which definition each names is the resolver's
 * (`resolver.ts`), which C++'s linker shares, since C's headers are C++'s
 * files; what it needs read beside a changed file is `wants.ts`'s.
 */

import type { LangRules, Role } from "../../anyfacts.ts";
import type { Flat } from "../../syntax.ts";
import type { RulesLinker } from "../pack.ts";
import { unitsOnly } from "../units-only.ts";
import { C } from "./index.ts";
import { C_FAMILY_RESOLVER } from "./resolver.ts";
import { cLabel, functionUnits, typeUnit } from "./units.ts";
import { cWants } from "./wants.ts";

/** The units query: tree-sitter-c 0.24.1's `queries/tags.scm`, copied unchanged. */
const UNITS = String.raw`(struct_specifier name: (type_identifier) @name body:(_)) @definition.class

(declaration type: (union_specifier name: (type_identifier) @name)) @definition.class

(function_declarator declarator: (identifier) @name) @definition.function

(type_definition declarator: (type_identifier) @name) @definition.type

(enum_specifier name: (type_identifier) @name) @definition.type
`;

const isImport = (t: Flat, n: number) => t.type[n] === "preproc_include";

/** The units, as a language with units alone reads them: none the parser's recovery leaves in doubt. */
const UNIT_RULES = unitsOnly([C], UNITS, { unit: typeUnit, extraUnits: functionUnits, label: cLabel }, isImport).rules;

/** A call's callee written as a bare name: `f(…)`. */
const isCallee = (t: Flat, n: number) => t.field[n] === "function" && t.type[t.parent[n]] === "call_expression";

const SKIP: Role = { kind: "skip" };

export const C_RULES: LangRules = {
    ...UNIT_RULES,
    identifiers: new Set(["identifier"]),
    role: (t, n) => (isCallee(t, n) ? { kind: "bare", expr: n } : SKIP),
    isCallee,
};

export const C_LINKER: RulesLinker = {
    kind: "rules",
    packs: [C],
    units: UNITS,
    rules: C_RULES,
    resolver: C_FAMILY_RESOLVER,
    wants: cWants,
    isImport,
};
