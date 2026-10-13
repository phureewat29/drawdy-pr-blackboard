/**
 * Files whose tree-sitter reading the linker doesn't trust, and what they
 * may still declare. tree-sitter-kotlin 1.1.0 reads some code otherwise than
 * the compiler with no ERROR node; the syntax differ (the compiler's parse
 * against tree-sitter's, on okhttp, coil and ktor) found these, each with a
 * sign the tree carries:
 *
 * - a declaration read as an expression: `annotation class X`, `@A\nclass X {`,
 *   `public fun X.f() {` after some lines, `expect object X {`, `const val X`
 *   after a binary literal with underscores, a `when` guard's `if`: a hard
 *   keyword left as an identifier;
 * - a class body read as a trailing lambda of the delegate: `: I by d {`;
 * - an expression where only declarations stand (a file's or a class body's
 *   top level), as `context(A)` before a declaration on its own line is read;
 *   but annotations alone on lines before a top-level declaration
 *   (`@OptIn(X::class)` read as `@OptIn` and `(X::class)`) are that
 *   declaration's, and the outline gives them to it.
 *
 * Such a file draws nothing; and since what it declares isn't read for sure,
 * a name it may declare (any word in it) is unknown in its package.
 */

import { child, type Flat } from "../../syntax.ts";
import { code, kid, nameOf } from "./nodes.ts";

/**
 * Kotlin's hard keywords, never an identifier unless backquoted. tree-sitter
 * reads `null`, `true`, `false`, `break` and `continue` as identifiers, and
 * the `class` of `X::class`: those are no sign.
 */
const HARD = new Set(["as", "class", "do", "else", "for", "fun", "if", "in", "interface", "is", "object", "package", "return", "super", "this", "throw", "try", "typealias", "typeof", "val", "var", "when", "while"]);

/** Where only declarations stand, and what may stand there. */
const DECLARATION_LEVEL = new Set(["source_file", "class_body", "enum_class_body"]);
const DECLARATIONS = new Set(["package_header", "import", "import_list", "file_annotation", "shebang_line", "line_comment", "block_comment", "class_declaration", "object_declaration", "function_declaration", "property_declaration", "type_alias", "companion_object", "anonymous_initializer", "secondary_constructor", "enum_entry", "getter", "setter"]);

/** Whether a tree carries a sign of a reading the compiler wouldn't make. */
export const misread = (t: Flat): boolean => {
    if (t.errors > 0) return true;
    for (let n = 0; n < t.count; n++) {
        const ty = t.type[n];
        if (t.named[n] && t.parent[n] >= 0 && DECLARATION_LEVEL.has(t.type[t.parent[n]]) && !DECLARATIONS.has(ty) && !leadingAnnotations(t, n)) return true;
        if (ty === "identifier" && HARD.has(t.text.slice(t.start[n], t.end[n])) && !classLiteral(t, n)) return true;
        if (ty === "explicit_delegation" && code(t, n).some((c) => t.type[c] === "call_expression" && code(t, c).some((x) => t.type[x] === "annotated_lambda"))) return true;
    }
    return false;
};

/** Whether a node is annotations alone, read apart from the declaration after them: `@A`, `@A(…)` as `@A` and `(…)`, several. */
export const leadingAnnotations = (t: Flat, n: number): boolean => {
    if (t.type[n] !== "annotated_expression" || !annotationsOnly(t, n)) return false;
    let next = t.next[n];
    while (next >= 0 && (!t.named[next] || /comment/.test(t.type[next]) || (t.type[next] === "annotated_expression" && annotationsOnly(t, next)))) next = t.next[next];
    return next >= 0 && DECLARATIONS.has(t.type[next]) && !/comment|package_header|import/.test(t.type[next]);
};

const annotationsOnly = (t: Flat, n: number): boolean => code(t, n).every((c) => t.type[c] === "annotation" || t.type[c] === "parenthesized_expression" || (t.type[c] === "annotated_expression" && annotationsOnly(t, c)));

/** Whether an identifier is the `class` of `X::class`. */
const classLiteral = (t: Flat, n: number): boolean => {
    if (t.text.slice(t.start[n], t.end[n]) !== "class") return false;
    const p = t.parent[n];
    if (p < 0 || (t.type[p] !== "navigation_expression" && t.type[p] !== "callable_reference")) return false;
    for (let c = t.first[p]; c >= 0 && c !== n; c = t.next[c]) if (!t.named[c] && t.type[c] === "::") return true;
    return false;
};

/** A file's package by its header line, read as text. */
export const packageOfText = (text: string): string => /^\s*package\s+([\w.`]+)/m.exec(text.replace(/\/\*[\s\S]*?\*\//g, ""))?.[1]?.replace(/`/g, "") ?? "";

/**
 * The names a file's text may declare, read with patterns rather than the
 * tree: after `fun`, `val` or `var` (past type parameters and an extension's
 * receiver), after `class`, `interface`, `object` or `typealias`. Comments and
 * strings count too: more names only make more lookups unknown. With
 * `callables`, functions and properties alone.
 */
export const declaredNames = (text: string, callables = false): Set<string> => {
    const out = new Set<string>();
    const funs = /\b(?:fun|val|var)\s+(?:<[^>{}()=]*>\s*)?(?:[\w.?<>, *]+\.)?(?:`([^`\n]+)`|([A-Za-z_]\w*))/g;
    const classes = /\b(?:class|interface|object|typealias)\s+(?:`([^`\n]+)`|([A-Za-z_]\w*))/g;
    for (const re of callables ? [funs] : [funs, classes]) for (const m of text.matchAll(re)) out.add(m[1] ?? m[2]);
    return out;
};

/**
 * The functions and properties a file's tree declares with a contract that
 * may smart cast (`returns(true) implies (x is T)`, `(x is T) holdsIn
 * block`): after a call of one, or a read or write of one through an
 * accessor, what it's called with and on may be more than their declared
 * types. Each `implies` or `holdsIn` whose block checks a type names the
 * function or the accessor's property around it; null when one stands in
 * neither (then any declaration of the file may be one).
 */
export const castersOfTree = (t: Flat): string[] | null => {
    const out: string[] = [];
    for (let n = 0; n < t.count; n++) {
        if (t.type[n] !== "identifier" || !/^(implies|holdsIn)$/.test(nameOf(t, n))) continue;
        let x = t.parent[n];
        while (x >= 0 && t.type[x] !== "lambda_literal" && !STOPS.has(t.type[x])) x = t.parent[x];
        const block = x >= 0 && t.type[x] === "lambda_literal" ? x : t.parent[n];
        let is = false;
        for (let y = block; y < t.count && t.start[y] < t.end[block]; y++) if (t.type[y] === "is_expression") is = true;
        if (!is) continue;
        while (x >= 0 && !STOPS.has(t.type[x])) x = t.parent[x];
        const ty = x >= 0 ? t.type[x] : "";
        const prop = ty === "getter" || ty === "setter" ? kid(t, t.parent[x], "variable_declaration") : -1;
        const id = ty === "function_declaration" ? child(t, x, "name") : prop >= 0 ? kid(t, prop, "identifier") : -1;
        if (id < 0) return null;
        out.push(nameOf(t, id));
    }
    return out;
};

/** What a contract's block stands in: a function, an accessor, or code a contract can't be written in. */
const STOPS = new Set(["function_declaration", "getter", "setter", "anonymous_function", "secondary_constructor", "anonymous_initializer", "class_body", "enum_class_body", "source_file"]);

/** The functions and properties a file's text may declare with such a contract, when its tree isn't trusted: any it may declare, if it writes `implies` or `holdsIn`. */
export const castersOfText = (text: string): string[] => (/\b(implies|holdsIn)\b/.test(text) ? [...declaredNames(text, true)] : []);

/**
 * The classes a Java file read may declare, and its package: Kotlin code of
 * that package sees them before its star imports, and the Kotlin linker
 * reads no Java. Any word after `class`, `interface`, `enum` or `record`.
 */
export const javaClasses = (text: string): { pkg: string; names: Set<string> } => {
    const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(text.replace(/\/\*[\s\S]*?\*\//g, ""))?.[1] ?? "";
    const names = new Set<string>();
    for (const m of text.matchAll(/\b(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
    return { pkg, names };
};
