/** Every identifier in a file that refers to something, and how: a call, a value, a type, a write, an import or an export. */

import type { ExportEntry, RefKind, Site } from "../facts.ts";
import { child, lineOf, textOf, type Flat } from "../syntax.ts";
import { requireSpec, type Modules } from "./modules.ts";
import { propName, unwrap } from "./nodes.ts";
import type { Scopes } from "./scopes.ts";

const TYPE_CONTEXT = new Set(["type_query", "nested_type_identifier", "type_annotation", "type_arguments", "implements_clause", "extends_type_clause", "type_predicate", "asserts"]);
/** Nodes no type context reaches past. */
const CONTEXT_ENDS = new Set(["statement_block", "arguments", "call_expression", "new_expression", "arrow_function", "pair", "variable_declarator", "assignment_expression", "class_body", "formal_parameters", "binary_expression", "ternary_expression"]);
const ASSIGN = new Set(["assignment_expression", "augmented_assignment_expression"]);
const JSX_TAGS = new Set(["jsx_opening_element", "jsx_self_closing_element", "jsx_closing_element"]);
/** What a reference sees through to the expression it is used as. */
const SEE_THROUGH = new Set(["parenthesized_expression", "non_null_expression", "as_expression"]);
const PATTERNS = new Set(["object_pattern", "pair_pattern", "array_pattern", "shorthand_property_identifier_pattern", "object_assignment_pattern", "assignment_pattern", "rest_pattern"]);

/** The declarator a name in a binding pattern belongs to, or -1. */
const enclosingDeclarator = (t: Flat, n: number): number => {
    for (let a = t.parent[n]; a >= 0; a = t.parent[a]) {
        if (t.type[a] === "variable_declarator") return a;
        if (!PATTERNS.has(t.type[a])) return -1;
    }
    return -1;
};

/** Whether a declarator destructures a `require()`. */
const requires = (t: Flat, declarator: number) => declarator >= 0 && requireSpec(t, child(t, declarator, "value"), null) !== null;

export const sitesOf = (t: Flat, scopes: Scopes, modules: Modules): Site[] => {
    const sites: Site[] = [];
    const importByNode = new Map(modules.imports.map((i) => [i.node, i]));
    const exportByName = new Map<number, ExportEntry>();
    for (const e of modules.exports) if (e.kind === "local" || e.kind === "reexport") exportByName.set(e.nameNode, e);
    const push = (node: number, name: string, ref: RefKind, form: Site["form"], extra: Partial<Site> = {}) => {
        const start = t.start[node];
        sites.push({ node, start, line: lineOf(t, start), name, ref, form, scope: scopes.all[scopes.scopeIds[node]], receiver: -1, ...extra });
    };

    /** What a value-position reference is: a call, a write, a JSX tag or a plain value. */
    const valueKind = (id: number): RefKind => {
        let e = id;
        const p0 = t.parent[e];
        if ((t.type[p0] === "member_expression" && t.field[e] === "property") || (t.type[p0] === "subscript_expression" && t.field[e] === "index")) e = p0;
        while (SEE_THROUGH.has(t.type[t.parent[e]])) e = t.parent[e];
        const pt = t.type[t.parent[e]];
        if ((pt === "call_expression" && t.field[e] === "function") || (pt === "new_expression" && t.field[e] === "constructor") || pt === "decorator") return "call";
        if (JSX_TAGS.has(pt) && t.field[e] === "name") return "jsx";
        if (ASSIGN.has(pt) && t.field[e] === "left") return "write";
        return "value";
    };
    /** Import, export, type and `extends` positions, which outrank how the value is used. */
    const contextKind = (id: number): RefKind | null => {
        for (let a = t.parent[id]; a >= 0; a = t.parent[a]) {
            const at = t.type[a];
            if (at === "import_statement") return "import";
            if (at === "export_statement") {
                if (child(t, a, "declaration") >= 0) break;
                const v = child(t, a, "value");
                if (v >= 0) {
                    if (unwrap(t, v) === id) return "export";
                    break;
                }
                return child(t, a, "source") >= 0 ? "import" : "export";
            }
            if (at === "variable_declarator") {
                const nm = child(t, a, "name");
                if (requires(t, a) && nm >= 0 && t.type[nm] !== "identifier") return "import";
                break;
            }
            if (at === "statement_block" || at === "program") break;
        }
        for (let a = t.parent[id]; a > 0; a = t.parent[a]) {
            const at = t.type[a];
            if (at === "extends_clause") return t.field[id] === "value" || t.parent[id] === a ? "extends" : "type";
            if (at === "class_heritage") return "extends";
            if (TYPE_CONTEXT.has(at)) return "type";
            if (at.endsWith("_statement") || CONTEXT_ENDS.has(at) || (at === "member_expression" && !TYPE_CONTEXT.has(t.type[t.parent[a]] ?? ""))) break;
        }
        return null;
    };

    const identifier = (n: number) => {
        const p = t.parent[n];
        const pt = t.type[p];
        const name = textOf(t, n);
        switch (pt) {
            // An import specifier's imported name refers to the other module's export.
            case "import_specifier": {
                const entry = importByNode.get(n);
                if (t.field[n] === "name" && entry) push(n, entry.imported, "import", "import", { importEntry: entry });
                return;
            }
            case "import_clause": {
                const entry = importByNode.get(n);
                if (entry) push(n, name, "import", "import", { importEntry: entry });
                return;
            }
            case "namespace_import":
            case "import_require_clause":
            case "namespace_export":
            case "nested_identifier":
            case "internal_module":
            case "module":
                return;
            case "export_specifier": {
                const e = exportByName.get(n);
                if (t.field[n] === "name" && e) push(n, name, e.kind === "reexport" ? "import" : "export", "export", { exportEntry: e });
                return;
            }
        }
        const b = scopes.bindingOfName.get(n);
        if (b) {
            // A destructured require: `const { a: x } = require('m')` names m's export a.
            if (b.path && b.path.length > 0 && requires(t, enclosingDeclarator(t, n))) push(pt === "pair_pattern" ? child(t, p, "key") : n, b.path[b.path.length - 1], "import", "require", { keyPath: b.path });
            return;
        }
        // An intrinsic element, `<div>`, names nothing.
        if (JSX_TAGS.has(pt) && /^[a-z]/.test(name)) return;
        if (pt === "nested_type_identifier" && t.field[n] === "module") push(n, name, "type", "bare");
        else push(n, name, contextKind(n) ?? valueKind(n), "bare");
    };
    const typeIdentifier = (n: number) => {
        if (scopes.bindingOfName.has(n)) return;
        const p = t.parent[n];
        const ctx = contextKind(n);
        if (t.type[p] !== "nested_type_identifier") push(n, textOf(t, n), ctx === "import" || ctx === "export" || ctx === "extends" ? ctx : "type", "bare");
        else if (t.field[n] === "name") push(n, textOf(t, n), ctx === "import" ? "import" : "type", "member", { receiver: child(t, p, "module") });
    };
    /** `{ a } = require('m')` names m's export a; any other shorthand pattern writes its name. */
    const shorthandPattern = (n: number) => {
        const b = scopes.bindingOfName.get(n);
        if (!b) push(n, textOf(t, n), "write", "bare");
        else if (b.path && requires(t, enclosingDeclarator(t, n))) push(n, textOf(t, n), "import", "require", { keyPath: b.path });
    };
    const property = (n: number) => {
        const p = t.parent[n];
        if (t.type[p] !== "member_expression" || t.field[n] !== "property") return;
        const ctx = contextKind(n);
        push(n, textOf(t, n), ctx === "type" ? "type" : ctx === "import" || ctx === "export" ? ctx : valueKind(n), "member", { receiver: child(t, p, "object") });
    };
    /** `x["name"]`, an identifier as a string: the site starts after the quote. */
    const stringIndex = (n: number) => {
        const p = t.parent[n];
        const name = propName(t, n);
        if (t.type[p] === "subscript_expression" && t.field[n] === "index" && /^[A-Za-z_$#][\w$]*$/.test(name)) push(n, name, valueKind(n), "member", { receiver: child(t, p, "object"), start: t.start[n] + 1 });
    };

    for (let n = 1; n < t.count; n++) {
        switch (t.type[n]) {
            case "identifier":
                identifier(n);
                break;
            case "type_identifier":
                typeIdentifier(n);
                break;
            case "shorthand_property_identifier":
                push(n, textOf(t, n), contextKind(n) ?? "value", "bare");
                break;
            case "shorthand_property_identifier_pattern":
                shorthandPattern(n);
                break;
            case "property_identifier":
            case "private_property_identifier":
                property(n);
                break;
            case "string":
                stringIndex(n);
                break;
        }
    }
    return sites;
};
