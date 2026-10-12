/**
 * The units of C and C++ files, whose grammars share their declarations
 * (tree-sitter-cpp extends tree-sitter-c): function definitions, whole, and
 * the types `tags.scm` defines with a body.
 *
 * Each grammar's `tags.scm` is used as it ships. Its function captures mark a
 * declarator, a signature that a prototype has too, so they make no unit: a
 * function's unit is its definition, read from the tree with its template
 * header and attributes. A struct, class, union or enum is a unit when it has
 * a body, and a `typedef` stands for the struct it names in place. Declared
 * outside a class body or the file's top level (in a function, a parameter,
 * an expression), a declaration is no unit.
 *
 * The grammars read no preprocessor, so a conditional whose branches each
 * open a brace, or a macro read as part of a definition, can move where a
 * definition seems to start or end. A declaration whose range the parser
 * can't vouch for is no unit (`trusted`): its lines go to its file's card.
 */

import type { UnitRule } from "../../anyfacts.ts";
import { child, textOf, type Flat } from "../../syntax.ts";
import { afterSubtree } from "../units-only.ts";

/** Nodes a declaration can sit in and still be at the top level or a class's member. */
const TRANSPARENT = new Set([
    "translation_unit", "declaration", "field_declaration", "template_declaration", "friend_declaration", "linkage_specification", "declaration_list", "namespace_definition",
    "preproc_if", "preproc_ifdef", "preproc_else", "preproc_elif", "preproc_elifdef",
]);
/** Each record's keyword, and each type's (Maps, since a node's type may be `constructor`). */
const RECORDS = new Map([["struct_specifier", "struct"], ["class_specifier", "class"], ["union_specifier", "union"]]);
const TYPES = new Map([...RECORDS, ["enum_specifier", "enum"]]);

/** The record (struct, class or union) whose body holds a declaration, or -1 at the top level; null where it is no member of either. */
const holder = (t: Flat, n: number): number | null => {
    for (let p = t.parent[n]; p >= 0; p = t.parent[p]) {
        const ty = t.type[p];
        if (ty === "field_declaration_list") return RECORDS.has(t.type[t.parent[p]]) ? t.parent[p] : null;
        if (ty === "translation_unit") return -1;
        if (!TRANSPARENT.has(ty)) return null;
    }
    return null;
};

/** At the top level, or a member of a named record that is. */
const isMember = (t: Flat, n: number): boolean => {
    const h = holder(t, n);
    return h === -1 || (h !== null && child(t, h, "name") >= 0 && isMember(t, h));
};

/** A definition with the template headers right around it. */
const withTemplates = (t: Flat, n: number): number => {
    let outer = n;
    while (t.parent[outer] >= 0 && t.type[t.parent[outer]] === "template_declaration") outer = t.parent[outer];
    return outer;
};

/** The names a declarator chain ends in. */
const NAMES = new Set(["identifier", "field_identifier", "qualified_identifier", "destructor_name", "operator_name", "template_function", "operator_cast"]);
const WRAPPERS = new Set(["pointer_declarator", "reference_declarator", "function_declarator", "attributed_declarator", "parenthesized_declarator"]);

/** The declarator a wrapper holds: its `declarator` field, else its child that is a declarator or a name (`&f(…)` holds `f(…)` in no field). */
const innerDeclarator = (t: Flat, x: number): number => {
    const field = child(t, x, "declarator");
    if (field >= 0) return field;
    for (let c = t.first[x]; c >= 0; c = t.next[c]) if (t.named[c] && (WRAPPERS.has(t.type[c]) || NAMES.has(t.type[c]))) return c;
    return -1;
};

/** A function definition's name, after any `*`, `&` and parentheses: the node naming it, and the scope it is qualified with (`A::f`), or -1. */
const functionName = (t: Flat, def: number): { name: number; scope: number } | null => {
    let x = child(t, def, "declarator");
    // A definition with no parameter list is no function: `class EXPORT Name {` reads as one, named Name.
    let parameters = false;
    while (x >= 0 && WRAPPERS.has(t.type[x])) {
        if (t.type[x] === "function_declarator") parameters = true;
        x = innerDeclarator(t, x);
    }
    if (x < 0 || !(parameters || t.type[x] === "operator_cast" || t.type[x] === "qualified_identifier")) return null;
    let scope = -1;
    while (t.type[x] === "qualified_identifier") {
        scope = child(t, x, "scope");
        x = child(t, x, "name");
        if (x < 0) return null;
    }
    if (!parameters && t.type[x] !== "operator_cast") return null;
    switch (t.type[x]) {
        case "identifier":
        case "field_identifier":
        case "destructor_name":
        case "operator_name":
            return { name: x, scope };
        case "template_function":
            return child(t, x, "name") >= 0 ? { name: child(t, x, "name"), scope } : null;
        case "operator_cast":
            return child(t, x, "type") >= 0 ? { name: child(t, x, "type"), scope } : null;
    }
    return null;
};

/** What holds no brace a compiler reads, each a token: a directive (its name caught) with the lines it continues, a comment, a raw string, a string, a character. And the braces. */
const C_TOKENS = /^[ \t]*#[ \t]*(\w*)(?:\\\r?\n|[^\n])*|\/\/[^\n]*|\/\*(?:[^*]|\*(?!\/))*(?:\*\/)?|R"([^()\\\s]{0,16})\([\s\S]*?\)\2"|"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|[{}]/gm;

/**
 * Whether a span's braces balance as a compiler would read it under two sets
 * of macros: every conditional's first branch taken, and every one's `#else`
 * (none, without one). A conditional that opens or closes outside the span
 * tangles it with the code around it: no balance.
 */
export const bracesBalance = (text: string, from: number, to: number): boolean => {
    /** Per reading, whether each open conditional's current branch is read. */
    const open: [boolean, boolean][] = [];
    const depth = [0, 0];
    for (const [token, directive] of text.slice(from, to).matchAll(C_TOKENS)) {
        if (token === "{" || token === "}") {
            for (const view of [0, 1] as const) {
                if (open.some((c) => !c[view])) continue;
                depth[view] += token === "{" ? 1 : -1;
                if (depth[view] < 0) return false;
            }
        } else if (/^if(n?def)?$/.test(directive)) open.push([true, false]);
        else if (/^(elif(n?def)?|else)$/.test(directive)) {
            if (open.length === 0) return false;
            open[open.length - 1] = [false, directive === "else"];
        } else if (directive === "endif" && !open.pop()) return false;
    }
    return open.length === 0 && depth[0] === 0 && depth[1] === 0;
};

/**
 * Whether the parser's range for a definition can be trusted: its closing
 * brace is a real one, not one the parser supplied; it starts on no line a
 * macro definition continues; no blank line splits it before its body (a
 * macro call above it, read as its type); and its braces balance in both
 * readings of its conditionals.
 */
const trusted = (t: Flat, outer: number, node: number): boolean => {
    for (let i = node, last = afterSubtree(t, node); i < last; i++) if (t.type[i] === "}" && t.start[i] === t.end[i]) return false;
    const start = t.start[outer];
    const end = Math.max(t.end[outer], t.end[node]);
    const lineStart = t.text.lastIndexOf("\n", start - 1);
    if (lineStart > 0 && /\\\r?$/.test(t.text.slice(t.text.lastIndexOf("\n", lineStart - 1) + 1, lineStart))) return false;
    let body = child(t, node, "body");
    if (body < 0 && child(t, node, "type") >= 0) body = child(t, child(t, node, "type"), "body");
    if (/\n[ \t]*\r?\n/.test(t.text.slice(start, body >= 0 ? t.start[body] : t.end[node]))) return false;
    return bracesBalance(t.text, start, end);
};

/** A unit for a `tags.scm` capture: a type with a body, or a typedef. Functions come from their definitions (`functionUnits`). */
export const typeUnit = (t: Flat, capture: string, node: number): UnitRule | null => {
    const ty = t.type[node];
    if (capture === "definition.type" && ty === "type_definition") {
        const name = child(t, node, "declarator");
        return t.type[name] === "type_identifier" && isMember(t, node) && trusted(t, node, node) ? { kind: "type", nameNode: name, outer: node } : null;
    }
    if (!TYPES.has(ty) || child(t, node, "body") < 0 || child(t, node, "name") < 0 || t.type[t.parent[node]] === "type_definition" || !isMember(t, node)) return null;
    const outer = withTemplates(t, node);
    return trusted(t, outer, node) ? { kind: RECORDS.has(ty) ? "class" : "type", nameNode: child(t, node, "name"), outer } : null;
};

/** Units `tags.scm` doesn't define: every function definition, and a named union with a body (it captures only a declaration whose type is a union). */
export const functionUnits = (t: Flat): (UnitRule & { node: number })[] => {
    const out: (UnitRule & { node: number })[] = [];
    for (let n = 0; n < t.count; n++) {
        const ty = t.type[n];
        if (ty === "function_definition") {
            const named = functionName(t, n);
            const outer = withTemplates(t, n);
            if (named && isMember(t, n) && trusted(t, outer, n)) out.push({ kind: "function", nameNode: named.name, outer, node: n });
        } else if (ty === "union_specifier") {
            const u = typeUnit(t, "definition.class", n);
            if (u) out.push({ ...u, node: n });
        }
    }
    return out;
};

/** The last segment of a name, without template arguments: `ns::Box<T>` is Box. */
const lastName = (t: Flat, n: number): string => {
    while (n >= 0 && (t.type[n] === "qualified_identifier" || t.type[n] === "template_type")) n = child(t, n, "name");
    return n >= 0 ? textOf(t, n) : "";
};

/**
 * A unit's card name: `struct point`, `typedef node_t`, `class Wallet`,
 * `Wallet::Get()` for a member or a definition qualified with its class or
 * namespace, `start()` for the rest. A friend defined in a class is no member.
 */
export const cLabel = (t: Flat, u: { node: number; name: string }): string => {
    const ty = t.type[u.node];
    if (ty === "type_definition") return `typedef ${u.name}`;
    if (TYPES.has(ty)) return `${TYPES.get(ty)} ${u.name}`;
    const named = functionName(t, u.node);
    // A conversion operator is named by its type: `operator const char*`.
    const cast = named ? t.parent[named.name] : -1;
    const name = cast >= 0 && t.type[cast] === "operator_cast" ? t.text.slice(t.start[cast], t.start[child(t, cast, "declarator")]).trim() : u.name;
    const scope = named ? lastName(t, named.scope) : "";
    if (scope) return `${scope}::${name}()`;
    const h = t.type[t.parent[withTemplates(t, u.node)]] === "friend_declaration" ? null : holder(t, u.node);
    const owner = h !== null && h >= 0 ? lastName(t, child(t, h, "name")) : "";
    return owner ? `${owner}::${name}()` : `${name}()`;
};
