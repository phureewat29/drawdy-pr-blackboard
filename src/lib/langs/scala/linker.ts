/**
 * Scala's linker: units alone (`units-only.ts`). Implicits, givens, `apply`
 * and type-class syntax decide its calls, so it draws no lines yet.
 *
 * A unit is a declaration at the top level, or a member of a named class,
 * object, trait, enum, given, package or extension that is one: a local `val`
 * or `def`, or one in an object expression, is no unit. Package clauses,
 * class parameters and enum cases, which `tags.scm` also defines, are none
 * either. An indented body runs on over the blank lines and comments after
 * it, so a unit ends at its last token, or its `end` marker.
 */

import type { UnitRule } from "../../anyfacts.ts";
import { child, hasToken, lineOf, textOf, type Flat } from "../../syntax.ts";
import { codeEnd, docAbove, laidOut, unitsOnly, type Layout } from "../units-only.ts";
import { SCALA } from "./index.ts";

/** The units query: tree-sitter-scala 0.24.0's `queries/tags.scm`, copied unchanged. */
const UNITS = String.raw`; Definitions

(package_clause
  name: (package_identifier) @name) @definition.module

(trait_definition
  name: (identifier) @name) @definition.interface

(enum_definition
  name: (identifier) @name) @definition.enum

(simple_enum_case
  name: (identifier) @name) @definition.class

(full_enum_case
  name: (identifier) @name) @definition.class

(class_definition
  name: (identifier) @name) @definition.class

(object_definition
  name: (identifier) @name) @definition.object

(function_definition
  name: (identifier) @name) @definition.function

(val_definition
  pattern: (identifier) @name) @definition.variable

(given_definition
  name: (identifier) @name) @definition.variable

(var_definition
  pattern: (identifier) @name) @definition.variable

(val_declaration
  name: (identifier) @name) @definition.variable

(var_declaration
  name: (identifier) @name) @definition.variable

(type_definition
  name: (type_identifier) @name) @definition.type

(class_parameter
  name: (identifier) @name) @definition.property

; References 

(call_expression
  (identifier) @name) @reference.call

(instance_expression
  (type_identifier) @name) @reference.interface

(instance_expression
  (generic_type
    (type_identifier) @name)) @reference.interface

(extends_clause
  (type_identifier) @name) @reference.class

(extends_clause
  (generic_type
    (type_identifier) @name)) @reference.class

`;

const LAYOUT: Layout = {
    comments: new Set(["comment", "block_comment"]),
    strings: new Set(["string", "interpolated_string_expression", "character_literal"]),
    declares: /^(@|(?:private|protected|final|override|implicit|lazy|sealed|abstract|inline|transparent|opaque|open|infix|def|val|var|class|object|trait|enum|given|type|package|extension|import|export)\b|case\s+(?:class|object)\b)/,
};
const doc = docAbove(LAYOUT.comments);
/** A unit's range is the parser's only when the code's layout agrees (`laidOut`). */
const agrees = laidOut(LAYOUT);

const KINDS = new Map<string, UnitRule["kind"]>([
    ["class_definition", "class"],
    ["object_definition", "class"],
    ["trait_definition", "class"],
    ["enum_definition", "class"],
    ["package_object", "class"],
    ["function_definition", "function"],
    ["val_definition", "value"],
    ["var_definition", "value"],
    ["val_declaration", "value"],
    ["var_declaration", "value"],
    ["given_definition", "value"],
    ["type_definition", "type"],
]);

/** The bodies that hold members, and what holds them. */
const BODIES = new Set(["template_body", "enum_body", "with_template_body"]);
const OWNERS = new Set(["class_definition", "object_definition", "trait_definition", "enum_definition", "given_definition", "package_object", "package_clause"]);

/** The declaration whose body holds a node: its class, object, trait, enum, given, package or extension; -1 at the top level; null where it is in neither. */
const ownerOf = (t: Flat, n: number): number | null => {
    const p = t.parent[n];
    if (p < 0) return null;
    if (t.type[p] === "compilation_unit") return -1;
    if (t.type[p] === "extension_definition") return p;
    return BODIES.has(t.type[p]) && OWNERS.has(t.type[t.parent[p]]) ? t.parent[p] : null;
};

/** At the top level, or a member of a named declaration that is one. */
const isMember = (t: Flat, n: number): boolean => {
    const owner = ownerOf(t, n);
    if (owner === null) return false;
    if (owner < 0) return true;
    return (t.type[owner] === "extension_definition" || child(t, owner, "name") >= 0) && isMember(t, owner);
};

const nameOf = (t: Flat, n: number): number => {
    const name = child(t, n, "name");
    return name >= 0 ? name : child(t, n, "pattern");
};

/** Where a declaration ends: at its last token, or its `end` marker (`end Foo`) right after it. */
const endOf = (t: Flat, n: number, name: number): number => {
    const end = codeEnd(t, n, LAYOUT);
    const marker = t.next[n];
    const what = marker >= 0 && t.type[marker] === "end" ? t.next[marker] : -1;
    return what >= 0 && lineOf(t, t.start[what]) === lineOf(t, t.start[marker]) && textOf(t, what) === textOf(t, name) ? t.end[what] : end;
};

const unitOf = (t: Flat, node: number): UnitRule | null => {
    const kind = KINDS.get(t.type[node]);
    const name = nameOf(t, node);
    if (!kind || name < 0 || t.type[name] !== (t.type[node] === "type_definition" ? "type_identifier" : "identifier") || !isMember(t, node)) return null;
    const end = endOf(t, node, name);
    return agrees(t, node, end, t.start[name]) ? { kind, nameNode: name, outer: node, end, doc: doc(t, t.start[node]) } : null;
};

/** The type an extension's methods extend, by its name without arguments, or "". */
const extended = (t: Flat, ext: number): string => {
    const params = child(t, ext, "parameters");
    let p = params >= 0 ? t.first[params] : -1;
    while (p >= 0 && t.type[p] !== "parameter") p = t.next[p];
    let type = p >= 0 ? child(t, p, "type") : -1;
    if (type >= 0 && t.type[type] === "generic_type") type = child(t, type, "type");
    return type >= 0 && t.type[type] === "type_identifier" ? textOf(t, type) : "";
};

const label = (t: Flat, u: { node: number; name: string }): string => {
    const n = u.node;
    switch (t.type[n]) {
        case "class_definition":
            return `${hasToken(t, n, "case") ? "case class" : "class"} ${u.name}`;
        case "object_definition":
            return `${hasToken(t, n, "case") ? "case object" : "object"} ${u.name}`;
        case "trait_definition":
            return `trait ${u.name}`;
        case "enum_definition":
            return `enum ${u.name}`;
        case "package_object":
            return `package object ${u.name}`;
        case "type_definition":
            return `type ${u.name}`;
        case "given_definition":
            return `given ${u.name}`;
    }
    const owner = ownerOf(t, n);
    const type = owner === null || owner < 0 ? "" : t.type[owner] === "extension_definition" ? extended(t, owner) : textOf(t, child(t, owner, "name"));
    // An auxiliary constructor, `def this(…)`, is named as Java's are: `Config()`.
    if (u.name === "this" && type) return `${type}()`;
    const name = t.type[n] === "function_definition" ? `${u.name}()` : u.name;
    return type && t.type[owner!] !== "package_clause" ? `${type}.${name}` : name;
};

/** Package objects, which tags.scm doesn't define. */
const packageObjects = (t: Flat): (UnitRule & { node: number })[] => {
    const out: (UnitRule & { node: number })[] = [];
    for (let n = 0; n < t.count; n++) {
        const u = t.type[n] === "package_object" ? unitOf(t, n) : null;
        if (u) out.push({ ...u, node: n });
    }
    return out;
};

export const SCALA_LINKER = unitsOnly(
    [SCALA],
    UNITS,
    {
        unit: (t, _capture, node) => unitOf(t, node),
        extraUnits: packageObjects,
        label,
    },
    (t, n) => t.type[n] === "import_declaration"
);
