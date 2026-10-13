/** A file's imports and exports, and every module it names. */

import { child, childOfType, hasToken, namedChildren, textOf, type Flat } from "../../../syntax.ts";
import type { ExportEntry, FileFacts, ImportEntry, Scope } from "../facts.ts";
import { assignmentIn, firstStringArgument, propName, stringValue, unwrap } from "./nodes.ts";
import { lookup, VALUE } from "./scopes.ts";

export type Modules = Pick<FileFacts, "imports" | "exports" | "specifiers" | "moduleExports">;

/** The module a `require('m')` call names, unless `require` is a local of that name. */
export const requireSpec = (t: Flat, n: number, scope: Scope | null): string | null => {
    n = unwrap(t, n);
    if (t.type[n] !== "call_expression") return null;
    const fn = child(t, n, "function");
    if (t.type[fn] !== "identifier" || textOf(t, fn) !== "require") return null;
    if (scope && lookup(scope, "require", VALUE)) return null;
    return firstStringArgument(t, n);
};

/** The names a declaration exports from its binding pattern, `export const { a, b: c } = x` giving a and c. */
const declaredNames = (t: Flat, p: number): number[] => {
    if (p < 0) return [];
    if (t.type[p] === "identifier" || t.type[p] === "shorthand_property_identifier_pattern") return [p];
    return namedChildren(t, p)
        .filter((c) => t.type[c] !== "property_identifier" || t.field[c] !== "key")
        .flatMap((c) => declaredNames(t, t.type[c] === "pair_pattern" ? child(t, c, "value") : c));
};

/** `exportsFrom`, for a component: the top-level statements whose exports count (its outer block's); its code is never CommonJS. */
export const modulesOf = (t: Flat, exportsFrom?: (statement: number) => boolean): Modules => {
    const imports: ImportEntry[] = [];
    const exports: ExportEntry[] = [];
    const specifiers: Modules["specifiers"] = [];
    let moduleExports = -1;

    const importStatement = (s: number) => {
        // `import x = require('m')`
        const req = childOfType(t, s, "import_require_clause");
        if (req >= 0) {
            const spec = stringValue(t, child(t, req, "source"));
            const id = childOfType(t, req, "identifier");
            if (spec === null) return;
            specifiers.push(spec);
            if (id >= 0) imports.push({ local: textOf(t, id), spec, imported: "=", node: id });
            return;
        }
        const spec = stringValue(t, child(t, s, "source"));
        if (spec === null) return;
        specifiers.push(spec);
        for (const k of namedChildren(t, childOfType(t, s, "import_clause"))) {
            if (t.type[k] === "identifier") imports.push({ local: textOf(t, k), spec, imported: "default", node: k });
            else if (t.type[k] === "namespace_import") {
                const id = childOfType(t, k, "identifier");
                if (id >= 0) imports.push({ local: textOf(t, id), spec, imported: "*", node: id });
            } else if (t.type[k] === "named_imports") {
                for (const sp of namedChildren(t, k)) {
                    if (t.type[sp] !== "import_specifier") continue;
                    const nm = child(t, sp, "name");
                    const alias = child(t, sp, "alias");
                    imports.push({ local: textOf(t, alias >= 0 ? alias : nm), spec, imported: propName(t, nm), node: nm });
                }
            }
        }
    };

    const exportedDeclaration = (decl: number, isDefault: boolean) => {
        const d = t.type[decl] === "ambient_declaration" ? (namedChildren(t, decl)[0] ?? decl) : decl;
        if (t.type[d] === "lexical_declaration" || t.type[d] === "variable_declaration") {
            for (const vd of namedChildren(t, d)) {
                if (t.type[vd] !== "variable_declarator") continue;
                for (const nm of declaredNames(t, child(t, vd, "name"))) exports.push({ kind: "local", name: textOf(t, nm), local: textOf(t, nm), nameNode: nm });
            }
            return;
        }
        const nm = child(t, d, "name");
        if (nm >= 0) exports.push({ kind: "local", name: isDefault ? "default" : propName(t, nm), local: propName(t, nm), nameNode: nm });
        else if (isDefault) exports.push({ kind: "expr", name: "default", value: d });
    };

    const exportStatement = (s: number) => {
        const spec = stringValue(t, child(t, s, "source"));
        if (spec !== null) specifiers.push(spec);
        const decl = child(t, s, "declaration");
        const value = child(t, s, "value");
        const clause = childOfType(t, s, "export_clause");
        const namespace = childOfType(t, s, "namespace_export");
        if (decl >= 0) exportedDeclaration(decl, hasToken(t, s, "default"));
        else if (value >= 0) exports.push({ kind: "expr", name: "default", value });
        else if (clause >= 0) {
            for (const sp of namedChildren(t, clause)) {
                if (t.type[sp] !== "export_specifier") continue;
                const nm = child(t, sp, "name");
                const alias = child(t, sp, "alias");
                const name = propName(t, alias >= 0 ? alias : nm);
                if (spec !== null) exports.push({ kind: "reexport", name, spec, imported: propName(t, nm), nameNode: nm });
                else exports.push({ kind: "local", name, local: propName(t, nm), nameNode: nm });
            }
        } else if (spec !== null) {
            const id = namedChildren(t, namespace)[0];
            if (namespace >= 0) exports.push({ kind: "namespace", name: id !== undefined ? propName(t, id) : "*", spec });
            else exports.push({ kind: "star", spec });
        } else if (hasToken(t, s, "=")) {
            // `export = x`
            const e = namedChildren(t, s).find((c) => t.type[c] !== "decorator");
            if (e !== undefined) moduleExports = e;
        }
    };

    /** `module.exports = x` and `exports.a = x`. */
    const commonJsExport = (s: number) => {
        const e = assignmentIn(t, s);
        if (e < 0) return;
        const lhs = textOf(t, child(t, e, "left"));
        const rhs = child(t, e, "right");
        if (lhs === "module.exports") moduleExports = rhs;
        else {
            const m = /^(?:module\.)?exports\.([A-Za-z_$][\w$]*)$/.exec(lhs);
            if (m) exports.push({ kind: "expr", name: m[1], value: rhs });
        }
    };

    for (const s of namedChildren(t, 0)) {
        if (t.type[s] === "import_statement") importStatement(s);
        else if (t.type[s] === "export_statement" && (!exportsFrom || exportsFrom(s))) exportStatement(s);
        else if (t.type[s] === "expression_statement" && !exportsFrom) commonJsExport(s);
    }
    // require() and import() anywhere.
    for (let n = 0; n < t.count; n++) {
        if (t.type[n] !== "call_expression") continue;
        const fn = child(t, n, "function");
        if (t.type[fn] !== "import" && !(t.type[fn] === "identifier" && textOf(t, fn) === "require")) continue;
        const spec = firstStringArgument(t, n);
        if (spec !== null) specifiers.push(spec);
    }
    return { imports, exports, specifiers, moduleExports };
};
