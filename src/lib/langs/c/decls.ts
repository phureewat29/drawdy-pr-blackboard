/**
 * What a C file, or a header read by C++'s grammar, declares at file scope,
 * by name: functions (defined or not), variables, typedefs and enumerators,
 * all in C's one namespace of ordinary names; with each declaration's
 * storage class, `inline`, weak or alias attributes, the identifiers written
 * among its specifiers (`ZSTDLIB_API size_t f(…)`, `MEM_STATIC unsigned
 * g(…)`, a `LOCAL_INT f(…)` read as its type) and after a function's
 * declarator (`int f(void) WEAK_FN;`), macros whose expansion the resolver
 * reads. Struct, union and enum tags live in a namespace of their own and
 * are left out.
 *
 * File scope is the top level, and what conditionals and `extern "C" {}`
 * hold there. A name is in doubt where the file may declare it in a way the
 * tree doesn't show: written in an ERROR node or an expression at file scope
 * (a macro's use there may declare it), in a declarator holding an error or
 * shaped as a macro's use (`int FN(helper)(void)`), or spliced with the line
 * before or after (`foo_\` / `get`). A function definition whose body holds
 * an error is listed: if its unit isn't trusted, the parser may have
 * swallowed declarations after it.
 */

import type { Flat } from "../../syntax.ts";
import { child, textOf } from "../../syntax.ts";
import { afterSubtree } from "../units-only.ts";
import { shapesIn, tokenize } from "./expand.ts";
import { SPLICE } from "./preproc.ts";

export type DeclKind = "function" | "variable" | "typedef" | "enumerator";

export type Decl = {
    name: string;
    kind: DeclKind;
    /** A function definition: its node; -1 for a declaration. */
    def: number;
    /** The declaration or definition node, and where its name starts. */
    node: number;
    at: number;
    isStatic: boolean;
    isInline: boolean;
    /** Written `(name)(…)`, which only a same-named macro needs. */
    parenthesized: boolean;
    /** An attribute before its body that makes it weak, an alias, an ifunc, or names its symbol (an asm label). */
    weak: boolean;
    /** Identifiers among its specifiers that aren't its type: macros, likely. */
    specMacros: string[];
    /** The identifier read as its type, which a macro may write with `static` (`#define LOCAL_INT static int`). */
    typeName: string | null;
    /** Identifiers after a function's declarator, before its `;`, `,` or body: a macro there may make it weak or name its symbol. */
    trailing: string[];
};

export type Decls = {
    byName: Map<string, Decl[]>;
    /** Names a file-scope ERROR, expression or broken declarator holds. */
    doubtful: Set<string>;
    /** Those of them written as a definition may be: a name and its parenthesized list before a `{` or a name (`int f(void) BEGIN`). */
    defShaped: Set<string>;
    /** Function definitions whose body holds an error. */
    brokenBodies: number[];
    /** Every function definition read at file scope. */
    definitions: number[];
};

/** Nodes that hold file-scope declarations. */
const CONTAINERS = new Set(["translation_unit", "preproc_if", "preproc_ifdef", "preproc_elif", "preproc_elifdef", "preproc_else", "linkage_specification", "declaration_list"]);
const DECLARATORS = new Set(["pointer_declarator", "pointer_type_declarator", "array_declarator", "parenthesized_declarator", "attributed_declarator", "init_declarator", "function_declarator", "reference_declarator"]);
/** Type specifiers written with keywords: after one, no identifier is the type. */
const KEYWORD_TYPES = new Set(["primitive_type", "struct_specifier", "union_specifier", "enum_specifier"]);

/** The identifiers of a subtree's text, as tokens. */
export const namesIn = (t: Flat, n: number, into: Set<string>) => {
    for (const m of t.text.slice(t.start[n], t.end[n]).matchAll(/[A-Za-z_]\w*/g)) into.add(m[0]);
};

export const definitionShapes = (text: string, from: number, to: number, into: Set<string>) => shapesIn(tokenize(text, from, to).map((x) => x.tok), into);

/** Whether a subtree holds an ERROR or MISSING node; a `::` missing from a qualified name aside (`nameOf`), and with `params`, what parameter lists hold. */
export const hasError = (t: Flat, n: number, params = true): boolean => {
    for (let i = n, end = afterSubtree(t, n); i < end; i++) {
        if (!params && t.type[i] === "parameter_list") {
            i = afterSubtree(t, i) - 1;
            continue;
        }
        if (t.type[i] === "ERROR") return true;
        if (t.end[i] === t.start[i] && t.first[i] < 0 && !(t.type[i] === "::" && t.type[t.parent[i]] === "qualified_identifier")) return true;
    }
    return false;
};

/**
 * A declarator's name node, and whether the declarator right around it is a
 * function's (`f(…)`, `*f(…)`), not a pointer's or an array's (`(*f)(…)`).
 * C++'s grammar reads a C header's `API size_t f(…)` as `size_t::f`, a
 * qualified name with no `::` written: `scoped` says the type was read so.
 */
const nameOf = (t: Flat, d: number): { name: number; isFunction: boolean; parenthesized: boolean; scoped: boolean } | null => {
    let x = d;
    let scoped = false;
    const chain: number[] = [];
    for (;;) {
        if (x >= 0 && t.type[x] === "qualified_identifier" && !scoped) {
            const scope = child(t, x, "scope");
            const name = child(t, x, "name");
            if (scope < 0 || name < 0 || t.text.slice(t.end[scope], t.start[name]).includes("::")) return null;
            scoped = true;
            x = name;
            continue;
        }
        if (!(x >= 0 && DECLARATORS.has(t.type[x]))) break;
        // A function returning a function is no C: a macro's use read as a declarator, `FN(helper)(void)`.
        if (t.type[x] === "function_declarator" && chain.length > 0 && t.type[chain[chain.length - 1]] === "function_declarator") return null;
        chain.push(x);
        let inner = child(t, x, "declarator");
        if (inner < 0) for (let c = t.first[x]; c >= 0; c = t.next[c]) if (t.named[c] && (DECLARATORS.has(t.type[c]) || t.type[c] === "identifier" || t.type[c] === "type_identifier" || t.type[c] === "qualified_identifier")) inner = c;
        x = inner;
    }
    if (x < 0 || (t.type[x] !== "identifier" && t.type[x] !== "type_identifier")) return null;
    let k = chain.length - 1;
    let parenthesized = false;
    while (k >= 0 && (t.type[chain[k]] === "parenthesized_declarator" || t.type[chain[k]] === "attributed_declarator" || t.type[chain[k]] === "init_declarator")) {
        if (t.type[chain[k]] === "parenthesized_declarator") parenthesized = true;
        k--;
    }
    const isFunction = k >= 0 && t.type[chain[k]] === "function_declarator";
    return { name: x, isFunction, parenthesized: parenthesized && isFunction, scoped };
};

/** A declaration's specifiers: storage, `inline`, weak or alias attributes, and the identifiers before its type. */
const specifiersOf = (t: Flat, n: number, scoped = false) => {
    let isStatic = false;
    let isInline = false;
    let keywordType = false;
    const idents: string[] = [];
    for (let c = t.first[n]; c >= 0; c = t.next[c]) {
        const ty = t.type[c];
        if (t.field[c] === "declarator" || t.field[c] === "body") continue;
        const text = textOf(t, c);
        if (ty === "storage_class_specifier") {
            if (text === "static") isStatic = true;
            if (/^(?:inline|__inline|__inline__|__forceinline)$/.test(text)) isInline = true;
        } else if (ty === "function_specifier" || /^(?:inline|__inline|__inline__|__forceinline)$/.test(text)) isInline = true;
        else if (ty === "type_identifier" || ty === "identifier") idents.push(text);
        else if (ty === "macro_type_specifier") {
            // `STACK_OF(X509) *f(…)`: a macro writes the type; nothing names it.
            keywordType = true;
            const name = child(t, c, "name");
            if (name >= 0) idents.push(textOf(t, name));
        }
        else if (ty === "ERROR") for (const m of text.matchAll(/[A-Za-z_]\w*/g)) idents.push(m[0]);
        else if (ty === "sized_type_specifier") {
            keywordType = true;
            for (let g = t.first[c]; g >= 0; g = t.next[g]) if (t.type[g] === "type_identifier") idents.push(textOf(t, g));
        } else if (KEYWORD_TYPES.has(ty)) keywordType = true;
    }
    // An attribute anywhere before the body that lets the linker pick another definition or symbol: `__attribute__((weak))`, `[[gnu::alias("f")]]`, `__declspec(selectany)`, an `ifunc`, an asm label (`int f(void) __asm__("g");`).
    const body = child(t, n, "body");
    const weak = /\b(?:weak|weakref|alias|selectany|ifunc)\b|\b(?:__asm__|__asm|asm)\s*\(/.test(t.text.slice(t.start[n], body >= 0 ? t.start[body] : t.end[n]));
    // The last identifier is the type, unless a keyword wrote it or the grammar read it as a scope.
    const typed = !keywordType && !scoped && idents.length > 0;
    return { isStatic, isInline, weak, specMacros: typed ? idents.slice(0, -1) : idents, typeName: typed ? idents[idents.length - 1] : null };
};

/** Words that may follow a function's declarator and name no macro: qualifiers, and the attribute and asm keywords (their arguments skipped). */
const AFTER_DECLARATOR = new Set(["const", "volatile", "restrict", "__restrict", "__restrict__", "noexcept", "throw", "override", "final"]);
const ATTRIBUTE_WORDS = /^(?:__attribute__|__attribute|__declspec|__asm__|__asm|asm|alignas|_Alignas)$/;

/**
 * The identifiers after a function's declarator, from `from` to its `;` or
 * `,` or the body at `to`, the ranges in `skip` (K&R parameter declarations)
 * aside: a macro's use there, `SYM(helper_v2)`, its arguments skipped.
 */
const trailingOf = (text: string, from: number, to: number, skip: [number, number][]): string[] => {
    const out: string[] = [];
    const toks = tokenize(text, from, to).filter((x) => !skip.some(([a, b]) => x.at >= a && x.at < b));
    for (let i = 0; i < toks.length; i++) {
        const tok = toks[i].tok;
        if (tok === ";" || tok === "," || tok === "{" || tok === "=") break;
        if (tok === "[" && toks[i + 1]?.tok === "[") {
            while (i < toks.length && !(toks[i].tok === "]" && toks[i + 1]?.tok === "]")) i++;
            i++;
            continue;
        }
        if (!/^[A-Za-z_]/.test(tok)) continue;
        if (!ATTRIBUTE_WORDS.test(tok) && !AFTER_DECLARATOR.has(tok)) out.push(tok);
        if (toks[i + 1]?.tok === "(") {
            let depth = 0;
            for (i++; i < toks.length; i++) {
                if (toks[i].tok === "(") depth++;
                else if (toks[i].tok === ")" && --depth === 0) break;
            }
        }
    }
    return out;
};

const SPLICED_BEFORE = new RegExp(`${SPLICE}$`);
const SPLICED_AFTER = new RegExp(`^${SPLICE}`);
/** Whether a name is spliced to the line before or after it (spaces may come between the backslash and the line's end): the preprocessor reads another identifier there. */
export const spliced = (text: string, start: number, end: number): boolean => SPLICED_BEFORE.test(text.slice(Math.max(0, start - 64), start)) || SPLICED_AFTER.test(text.slice(end, end + 64));

/** The declarations of a tree at file scope, by name. */
export const declsOf = (t: Flat): Decls => {
    const byName = new Map<string, Decl[]>();
    const doubtful = new Set<string>();
    const defShaped = new Set<string>();
    /** A region the tree can't read: every name in doubt, those shaped as a definition (all, with `all`) as perhaps defined. */
    const doubt = (n: number, all = false) => {
        namesIn(t, n, doubtful);
        if (all) namesIn(t, n, defShaped);
        else definitionShapes(t.text, t.start[n], t.end[n], defShaped);
    };
    const brokenBodies: number[] = [];
    const definitions: number[] = [];
    const add = (d: Decl, nameNode: number) => {
        if (spliced(t.text, t.start[nameNode], t.end[nameNode])) {
            doubtful.add(d.name);
            defShaped.add(d.name);
            return;
        }
        const list = byName.get(d.name);
        if (list) list.push(d);
        else byName.set(d.name, [d]);
    };
    const enumerators = (n: number) => {
        for (let i = n, end = afterSubtree(t, n); i < end; i++) {
            if (t.type[i] !== "enumerator") continue;
            const name = child(t, i, "name");
            if (name >= 0) add({ name: textOf(t, name), kind: "enumerator", def: -1, node: i, at: t.start[name], isStatic: false, isInline: false, parenthesized: false, weak: false, specMacros: [], typeName: null, trailing: [] }, name);
        }
    };
    const visit = (n: number) => {
        for (let c = t.first[n]; c >= 0; c = t.next[c]) {
            const ty = t.type[c];
            if (CONTAINERS.has(ty)) {
                visit(c);
                continue;
            }
            if (ty === "ERROR" || ty === "expression_statement") {
                doubt(c);
                continue;
            }
            // `enum { A, B };` with no declarator: its enumerators are the file's names.
            if (ty === "enum_specifier" || ty === "struct_specifier" || ty === "union_specifier") enumerators(c);
            if (ty !== "declaration" && ty !== "function_definition" && ty !== "type_definition") continue;
            if (ty !== "function_definition") enumerators(c);
            if (ty === "function_definition") {
                const d = child(t, c, "declarator");
                const body = child(t, c, "body");
                if (body >= 0 && hasError(t, body)) brokenBodies.push(c);
                const named = d >= 0 && !hasError(t, d, false) ? nameOf(t, d) : null;
                // A definition with no type is a macro's use read as one (`TEST(name) {`), not C since C99.
                if (!named || child(t, c, "type") < 0) {
                    if (d >= 0) doubt(d, true);
                    continue;
                }
                definitions.push(c);
                // K&R parameter declarations sit between the declarator and the body.
                const skip: [number, number][] = [];
                for (let k = t.first[c]; k >= 0; k = t.next[k]) if (t.type[k] === "declaration" && t.start[k] >= t.end[d]) skip.push([t.start[k], t.end[k]]);
                const trailing = trailingOf(t.text, t.end[d], body >= 0 ? t.start[body] : t.end[c], skip);
                add({ name: textOf(t, named.name), kind: "function", def: c, node: c, at: t.start[named.name], ...specifiersOf(t, c, named.scoped), parenthesized: named.parenthesized, trailing }, named.name);
                continue;
            }
            for (let d = t.first[c]; d >= 0; d = t.next[d]) {
                // An error among a declaration's parts may hide a declarator.
                if (t.type[d] === "ERROR") {
                    doubt(d);
                    continue;
                }
                if (t.field[d] !== "declarator") continue;
                const named = !hasError(t, d, false) ? nameOf(t, d) : null;
                if (!named) {
                    doubt(d);
                    continue;
                }
                const kind: DeclKind = ty === "type_definition" ? "typedef" : named.isFunction ? "function" : "variable";
                // A declaration missing its `;` (the grammar's MISSING one) ends where the text's `;` does.
                const trailing = kind === "function" ? trailingOf(t.text, t.end[d], Math.min(t.text.length, t.end[d] + 2000), []) : [];
                add({ name: textOf(t, named.name), kind, def: -1, node: c, at: t.start[named.name], ...specifiersOf(t, c, named.scoped), parenthesized: named.parenthesized, trailing }, named.name);
            }
        }
    };
    visit(0);
    return { byName, doubtful, defShaped, brokenBodies, definitions };
};
