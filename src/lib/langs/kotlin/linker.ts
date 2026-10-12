/**
 * Kotlin's linker: units alone (`units-only.ts`). Its calls can't be proven
 * from the files a board reads (a bare call in a lambda with a receiver may
 * mean the receiver's method, extensions need the receiver's type), so it
 * draws no lines yet.
 */

import type { UnitRule } from "../../anyfacts.ts";
import { child, textOf, type Flat } from "../../syntax.ts";
import { laidOut, unitsOnly } from "../units-only.ts";
import { KOTLIN } from "./index.ts";

/** The units query. tree-sitter-kotlin 1.1.0 ships no `tags.scm`. */
const UNITS = String.raw`(class_declaration name: (identifier) @name) @definition.class
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
const tokenOf = (t: Flat, n: number, token: string): number => {
    for (let c = t.first[n]; c >= 0; c = t.next[c]) if (!t.named[c] && t.type[c] === token) return c;
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
const nameOf = (t: Flat, node: number): number => {
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

const unit = (t: Flat, _capture: string, node: number): UnitRule | null => {
    const name = nameOf(t, node);
    if (name < 0 || !isMember(t, node) || !agrees(t, node, t.end[node], t.start[name])) return null;
    const kind = t.type[node] === "function_declaration" || t.type[node] === "secondary_constructor" ? "function" : "class";
    return { kind, nameNode: name, outer: node };
};

const label = (t: Flat, u: { node: number; name: string }): string => {
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

export const KOTLIN_LINKER = unitsOnly([KOTLIN], UNITS, { unit, label }, (t, n) => t.type[n] === "import");
