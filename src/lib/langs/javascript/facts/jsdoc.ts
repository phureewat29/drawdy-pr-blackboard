/**
 * JSDoc types in JavaScript, which TypeScript reads as declared types: a `@type {T}` doc comment before
 * a declaration or a parameter, and a function's `@param {T} name`. Only the type's text is read here;
 * the evaluator says what it names.
 */

import { child, namedChildren, perTree, textOf, type Flat } from "../../../syntax.ts";

const FUNCTIONS = new Set(["function_expression", "arrow_function", "generator_function", "function", "function_declaration", "generator_function_declaration", "method_definition"]);

/** The doc comment (`/**`) right before a node, nothing but whitespace between; -1 when there is none. */
const docBefore = (t: Flat, n: number): number => {
    const p = t.parent[n];
    if (n < 0 || p < 0) return -1;
    let prev = -1;
    for (let c = t.first[p]; c >= 0 && c !== n; c = t.next[c]) prev = c;
    if (prev < 0 || t.type[prev] !== "comment" || !textOf(t, prev).startsWith("/**")) return -1;
    return /^\s*$/.test(t.text.slice(t.end[prev], t.start[n])) ? prev : -1;
};

/** The node a declaration's doc comment sits before: a statement, and the `export` around it. */
const hostOf = (t: Flat, n: number): number => (t.type[t.parent[n]] === "export_statement" ? t.parent[n] : n);

/** The type in braces right after `at` in a doc comment, its own braces balanced: `{{ a: B }}` gives `{ a: B }`. */
const braced = (s: string, at: number): { type: string; end: number } | null => {
    const open = s.indexOf("{", at);
    if (open < 0 || !/^\s*$/.test(s.slice(at, open))) return null;
    let depth = 0;
    for (let i = open; i < s.length; i++) {
        if (s[i] === "{") depth++;
        else if (s[i] === "}" && --depth === 0) return { type: s.slice(open + 1, i).trim(), end: i + 1 };
    }
    return null;
};

/** The `@type` a doc comment before a node gives, or null. */
const typeTag = (t: Flat, n: number): string | null => {
    const c = docBefore(t, n);
    if (c < 0) return null;
    const text = textOf(t, c);
    const m = /@type\b/.exec(text);
    return m ? (braced(text, m.index + m[0].length)?.type ?? null) : null;
};

/** The node a function's doc comment sits before: the function, its variable's statement, its property, or the assignment that holds it. */
const functionHost = (t: Flat, fn: number): number => {
    if (t.type[fn] === "function_declaration" || t.type[fn] === "generator_function_declaration" || t.type[fn] === "method_definition") return hostOf(t, fn);
    const p = t.parent[fn];
    switch (t.type[p]) {
        case "variable_declarator":
            return hostOf(t, t.parent[p]);
        case "pair":
        case "field_definition":
            return p;
        case "assignment_expression":
            return t.type[t.parent[p]] === "expression_statement" ? t.parent[p] : -1;
        case "export_statement":
            return p;
        default:
            return -1;
    }
};

/** The JSDoc type a variable's declaration gives it: the `@type` of the doc comment before its statement, for its first declarator. */
export const variableDocType = (t: Flat, declarator: number): string | null => {
    if (t.type[declarator] !== "variable_declarator") return null;
    const statement = t.parent[declarator];
    return namedChildren(t, statement).find((c) => t.type[c] === "variable_declarator") === declarator ? typeTag(t, hostOf(t, statement)) : null;
};

/** The JSDoc type a parameter has: a `@type` doc comment right before it, else its function's `@param {T} name`. */
export const paramDocType = (t: Flat, name: number): string | null => {
    // A plain name, or one with a default: `x`, `x = …`.
    const param = t.type[t.parent[name]] === "assignment_pattern" && child(t, t.parent[name], "left") === name ? t.parent[name] : name;
    const params = t.parent[param];
    const fn = t.type[params] === "formal_parameters" ? t.parent[params] : params;
    if (!FUNCTIONS.has(t.type[fn]) || (t.type[params] !== "formal_parameters" && child(t, fn, "parameter") !== param)) return null;
    const own = t.type[params] === "formal_parameters" ? typeTag(t, param) : null;
    if (own !== null) return own;
    const doc = docBefore(t, functionHost(t, fn));
    if (doc < 0) return null;
    const text = textOf(t, doc);
    const wanted = textOf(t, name);
    const tag = /@(?:param|arg|argument)\b/g;
    for (let m = tag.exec(text); m; m = tag.exec(text)) {
        const type = braced(text, m.index + m[0].length);
        if (!type) continue;
        const nm = /^\s*\[?\s*([A-Za-z_$][\w$]*)(?![\w$.])/.exec(text.slice(type.end));
        if (nm?.[1] === wanted) return type.type;
    }
    return null;
};

/** The JSDoc type of a class field declared without a value: a `@type` doc comment before `x;`. */
export const fieldDocType = (t: Flat, field: number): string | null => typeTag(t, field);

/** The JSDoc type a member's declaration gives it: a class field's, a `this.x = …`'s or a property's `@type`. */
export const memberDocType = (t: Flat, value: number): string | null => {
    const p = t.parent[value];
    if (t.type[p] === "field_definition" || t.type[p] === "pair") return typeTag(t, p);
    if (t.type[p] === "assignment_expression" && t.type[t.parent[p]] === "expression_statement") return typeTag(t, t.parent[p]);
    return null;
};

const SCOPES = new Set([...FUNCTIONS, "class_declaration", "class", "program"]);

/** The node a class's doc comment sits before: the class, or the statement its expression is the value of. */
const classHost = (t: Flat, c: number): number => (t.type[c] === "class_declaration" ? hostOf(t, c) : t.type[t.parent[c]] === "variable_declarator" ? hostOf(t, t.parent[t.parent[c]]) : -1);

/** The `@template` names of the functions and classes around a node, which a JSDoc type there names before anything in scope. */
export const templatesAt = (t: Flat, at: number): Set<string> => {
    const names = new Set<string>();
    for (let a = t.parent[at]; a >= 0; a = t.parent[a]) {
        const host = FUNCTIONS.has(t.type[a]) ? functionHost(t, a) : t.type[a] === "class_declaration" || t.type[a] === "class" ? classHost(t, a) : -1;
        const doc = host >= 0 ? docBefore(t, host) : -1;
        if (doc < 0) continue;
        const text = textOf(t, doc);
        const tag = /@template\b/g;
        for (let m = tag.exec(text); m; m = tag.exec(text)) {
            const constraint = braced(text, m.index + m[0].length);
            const list = /^\s*([A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*)/.exec(text.slice(constraint ? constraint.end : m.index + m[0].length));
            for (const name of list ? list[1].split(",") : []) names.add(name.trim());
        }
    }
    return names;
};

/** Each `@typedef` and `@callback` name of a file's doc comments, by the function, class or program it is declared in. */
const typedefs = perTree((t: Flat): { name: string; scope: number }[] => {
    const out: { name: string; scope: number }[] = [];
    for (let n = 0; n < t.count; n++) {
        if (t.type[n] !== "comment" || !textOf(t, n).startsWith("/**")) continue;
        const text = textOf(t, n);
        const tag = /@(typedef|callback)\b/g;
        for (let m = tag.exec(text); m; m = tag.exec(text)) {
            const type = m[1] === "typedef" ? braced(text, m.index + m[0].length) : null;
            const name = /^\s*([A-Za-z_$][\w$]*)/.exec(text.slice(type ? type.end : m.index + m[0].length));
            let scope = t.parent[n];
            while (scope >= 0 && !SCOPES.has(t.type[scope])) scope = t.parent[scope];
            if (name) out.push({ name: name[1], scope });
        }
    }
    return out;
});

/** Whether a name is a `@typedef` declared in a function, class or file around a node: one TypeScript takes for the type, not an import or a class of that name. */
export const typedefAt = (t: Flat, at: number, name: string): boolean => {
    const around = new Set<number>();
    for (let a = at; a >= 0; a = t.parent[a]) around.add(a);
    return typedefs(t).some((d) => d.name === name && (d.scope < 0 || around.has(d.scope)));
};

/** A JSDoc type split at its top-level `|`, `null`, `undefined` and `void` aside, each without `!`, `?` or `=`. */
export const docTypeParts = (type: string): string[] => {
    const parts: string[] = [];
    let depth = 0;
    let from = 0;
    for (let i = 0; i <= type.length; i++) {
        const ch = type[i];
        if (ch === "(" || ch === "<" || ch === "{" || ch === "[") depth++;
        else if (ch === ")" || ch === ">" || ch === "}" || ch === "]") depth--;
        else if (i === type.length || (ch === "|" && depth === 0)) {
            parts.push(type.slice(from, i).trim().replace(/^[!?]/, "").replace(/=$/, "").trim());
            from = i + 1;
        }
    }
    return parts.filter((p) => p !== "" && !/^(null|undefined|void)$/.test(p));
};
