/**
 * Kotlin's rule table: the units query and card names of the units-only pack
 * (unchanged, so cards keep their ids), and the sites: every identifier that
 * may name a declaration, as a bare name, a member after `.`, `?.` or `::`,
 * or a name in a type. Declarations' names, labels, named arguments' names
 * and the package header are no sites; an import's last name is one.
 */

import type { GImport, LangRules, Role, UnitRule } from "../../anyfacts.ts";
import { child, textOf, type Flat } from "../../syntax.ts";
import { inError, laidOut } from "../units-only.ts";
import { argOf, callAround, code, kid, navOf, token } from "./nodes.ts";

/** The units query. tree-sitter-kotlin 1.1.0 ships no `tags.scm`. */
export const UNITS = String.raw`(class_declaration name: (identifier) @name) @definition.class
(object_declaration name: (identifier) @name) @definition.object
(companion_object) @definition.object
(function_declaration name: (identifier) @name) @definition.function
(secondary_constructor) @definition.constructor
`;

const TYPES = new Set(["class_declaration", "object_declaration", "companion_object"]);
const BODIES = new Set(["class_body", "enum_class_body"]);

/** The type declaration whose body holds a node, or -1: an object expression's body, an enum entry's, a block. */
const ownerOf = (t: Flat, n: number): number => {
    const body = t.parent[n];
    return body >= 0 && BODIES.has(t.type[body]) && TYPES.has(t.type[t.parent[body]]) ? t.parent[body] : -1;
};

/** A declaration at the top of the file, or a member of a type that is one. */
const isMember = (t: Flat, n: number): boolean => {
    const p = t.parent[n];
    if (p >= 0 && t.type[p] === "source_file") return true;
    const owner = ownerOf(t, n);
    return owner >= 0 && isMember(t, owner);
};

/** The class a member is called through: a companion's members through the class around it. */
const callerType = (t: Flat, n: number): number => {
    let owner = ownerOf(t, n);
    if (owner >= 0 && t.type[owner] === "companion_object") owner = ownerOf(t, owner);
    return owner >= 0 && t.type[owner] !== "companion_object" ? owner : -1;
};

/** A node's keyword or punctuation child, or -1. */
const tokenOf = (t: Flat, n: number, tok: string): number => {
    for (let c = t.first[n]; c >= 0; c = t.next[c]) if (!t.named[c] && t.type[c] === tok) return c;
    return -1;
};

/** The type an extension function extends, by its last name without arguments (`Map.Entry<K, V>` is Entry), or -1. */
const receiverName = (t: Flat, fn: number): number => {
    const name = child(t, fn, "name");
    let receiver = -1;
    for (let c = t.first[fn]; c >= 0 && c !== name; c = t.next[c]) if (t.type[c] === "user_type" || t.type[c] === "nullable_type") receiver = c;
    if (receiver >= 0 && t.type[receiver] === "nullable_type") receiver = t.first[receiver] >= 0 && t.type[t.first[receiver]] === "user_type" ? t.first[receiver] : -1;
    let last = -1;
    for (let c = receiver >= 0 ? t.first[receiver] : -1; c >= 0; c = t.next[c]) if (t.type[c] === "identifier") last = c;
    return last;
};

/** A unit's range is the parser's only when the code's layout agrees (`laidOut`). */
const agrees = laidOut({
    comments: new Set(["line_comment", "block_comment"]),
    strings: new Set(["string_literal", "multiline_string_literal", "character_literal"]),
    declares: /^(@|(?:public|private|internal|protected|open|override|abstract|final|sealed|data|enum|annotation|inner|value|inline|suspend|tailrec|operator|infix|external|expect|actual|const|lateinit|companion|fun|class|interface|object|constructor|init|val|var|typealias)\b)/,
});

/** The node a unit is named by: its name, or the keyword of a companion or constructor that has none. */
const unitName = (t: Flat, node: number): number => {
    switch (t.type[node]) {
        case "companion_object":
            return child(t, node, "name") >= 0 ? child(t, node, "name") : tokenOf(t, node, "companion");
        case "secondary_constructor":
            return tokenOf(t, node, "constructor");
    }
    return child(t, node, "name");
};

const isEnum = (t: Flat, n: number): boolean => {
    const modifiers = t.first[n] >= 0 && t.type[t.first[n]] === "modifiers" ? t.first[n] : -1;
    for (let c = modifiers >= 0 ? t.first[modifiers] : -1; c >= 0; c = t.next[c]) if (t.type[c] === "class_modifier" && textOf(t, c) === "enum") return true;
    return false;
};

/** Whether the parser recovered from an error right after a node: the next of its siblings, comments aside, is an ERROR node. */
const errorAfter = (t: Flat, n: number): boolean => {
    let x = t.next[n];
    while (x >= 0 && /comment/.test(t.type[x])) x = t.next[x];
    return x >= 0 && t.type[x] === "ERROR";
};

const unit = (t: Flat, _capture: string, node: number): UnitRule | null => {
    if (inError(t, node)) return null;
    const name = unitName(t, node);
    if (name < 0 || !isMember(t, node) || !agrees(t, node, t.end[node], t.start[name])) return null;
    if (errorAfter(t, node)) return null;
    const kind = t.type[node] === "function_declaration" || t.type[node] === "secondary_constructor" ? "function" : "class";
    return { kind, nameNode: name, outer: node };
};

const label: LangRules["label"] = (t, u) => {
    const n = u.node;
    switch (t.type[n]) {
        case "class_declaration":
            return `${tokenOf(t, n, "interface") >= 0 ? "interface" : isEnum(t, n) ? "enum class" : "class"} ${u.name}`;
        case "object_declaration":
            return `object ${u.name}`;
        case "companion_object":
            return child(t, n, "name") >= 0 ? `companion object ${u.name}` : "companion object";
        case "secondary_constructor": {
            const owner = callerType(t, n);
            return owner >= 0 ? `${textOf(t, child(t, owner, "name"))}()` : "constructor()";
        }
    }
    const receiver = receiverName(t, n);
    const owner = receiver >= 0 ? receiver : callerType(t, n) >= 0 ? child(t, callerType(t, n), "name") : -1;
    return owner >= 0 ? `${textOf(t, owner)}.${u.name}()` : `${u.name}()`;
};

/** Parents whose identifier child is a declaration's name. */
const DECLARES = new Set(["class_declaration", "object_declaration", "companion_object", "function_declaration", "variable_declaration", "class_parameter", "parameter", "type_parameter", "type_alias", "enum_entry", "catch_block", "setter"]);
/** Parents whose identifier child names nothing a link can reach: labels, a package, an import's path and alias, a type constraint's parameter. */
const SKIPS = new Set(["this_expression", "super_expression", "return_expression", "package_header", "qualified_identifier", "import", "type_constraint", "jump_expression", "break_expression", "continue_expression"]);

const role = (t: Flat, n: number): Role => {
    const p = t.parent[n];
    const pt = t.type[p];
    if (DECLARES.has(pt) || SKIPS.has(pt)) return { kind: pt === "type_constraint" || SKIPS.has(pt) ? "skip" : "decl" };
    if (pt === "value_argument" && argOf(t, p).name !== null && code(t, p)[0] === n) return { kind: "skip" };
    if (pt === "navigation_expression") {
        const nav = navOf(t, p);
        if (nav && nav.name === n) return { kind: "member", receiver: nav.receiver, expr: p };
        return { kind: "bare", expr: n };
    }
    if (pt === "callable_reference") {
        const ids = code(t, p);
        const last = ids[ids.length - 1];
        if (last === n) {
            const recv = ids.length > 1 ? ids[0] : -1;
            return recv >= 0 ? { kind: "member", receiver: recv, expr: p } : { kind: "bare", expr: p };
        }
        return { kind: "bare", expr: n };
    }
    if (pt === "infix_expression") {
        const ids = code(t, p);
        if (ids.length === 3 && ids[1] === n) return { kind: "member", receiver: ids[0], expr: p };
    }
    return { kind: "bare", expr: n };
};

const imports = (t: Flat): GImport[] => {
    const out: GImport[] = [];
    for (let c = t.first[0]; c >= 0; c = t.next[c]) {
        if (t.type[c] !== "import") continue;
        const q = kid(t, c, "qualified_identifier");
        if (q < 0) continue;
        const ids = code(t, q).filter((i) => t.type[i] === "identifier");
        if (ids.length === 0) continue;
        const star = token(t, c, "*") >= 0;
        const alias = code(t, c).find((x) => t.type[x] === "identifier") ?? -1;
        const last = ids[ids.length - 1];
        const spec = ids.slice(0, star ? ids.length : -1).map((i) => textOf(t, i)).join(".");
        out.push({ local: star ? "" : textOf(t, alias >= 0 ? alias : last), spec, level: 0, name: star ? "*" : textOf(t, last), node: star ? -1 : last, bind: alias >= 0 ? alias : last, stmt: c });
    }
    return out;
};

export const KOTLIN_RULES: LangRules = {
    unit,
    label,
    scope: () => null,
    binds: () => undefined,
    identifiers: new Set(["identifier"]),
    role,
    isCallee: (t, expr) => callAround(t, expr) >= 0,
    isType: (t, n) => t.type[t.parent[n]] === "user_type",
    imports,
};

/** Whether a top-level node imports. */
export const isImport = (t: Flat, n: number): boolean => t.type[n] === "import";
