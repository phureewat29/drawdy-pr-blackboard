/** C#'s linker: the shared file index (`anyfacts.ts`) with C#'s rule table (`rules.ts`), and a resolver of its own (`resolver.ts`), since C#'s names follow the C# spec; what its names need is read by `wants.ts`, beside the project file above a changed file. */

import type { RulesLinker } from "../pack.ts";
import { CSHARP } from "./index.ts";
import { projectCandidates } from "./msbuild.ts";
import { CSHARP_RESOLVER } from "./resolver.ts";
import { CSHARP_RULES, isUsing } from "./rules.ts";
import { csharpWants } from "./wants.ts";

/** tree-sitter-c-sharp 0.23.5's `queries/tags.scm`, copied unchanged; the rule table adds the survey's declarations (`extraUnits`). */
const TAGS = String.raw`(class_declaration name: (identifier) @name) @definition.class

(class_declaration (base_list (_) @name)) @reference.class

(interface_declaration name: (identifier) @name) @definition.interface

(interface_declaration (base_list (_) @name)) @reference.interface

(method_declaration name: (identifier) @name) @definition.method

(object_creation_expression type: (identifier) @name) @reference.class

(type_parameter_constraints_clause (identifier) @name) @reference.class

(type_parameter_constraint (type type: (identifier) @name)) @reference.class

(variable_declaration type: (identifier) @name) @reference.class

(invocation_expression function: (member_access_expression name: (identifier) @name)) @reference.send

(namespace_declaration name: (identifier) @name) @definition.module

(namespace_declaration name: (identifier) @name) @module
`;


export const CSHARP_LINKER: RulesLinker = {
    kind: "rules",
    packs: [CSHARP],
    units: TAGS,
    rules: CSHARP_RULES,
    resolver: CSHARP_RESOLVER,
    isImport: isUsing,
    configFiles: (path) => [projectCandidates(path)],
    wants: csharpWants,
};
