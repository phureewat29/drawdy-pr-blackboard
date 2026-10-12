/**
 * Go's rule table: tree-sitter-go 0.25.0's nodes, its own `tags.scm` for the
 * units (functions, methods, types), and Go's scoping: imports belong to a
 * file, blocks, `if`, `for`, `switch` and `select` open scopes, and a generic
 * type's or a method receiver's type parameters are their own.
 */

import type { Emit, GImport, LangRules, Role } from "../../anyfacts.ts";
import { labelOf } from "../../symbols.ts";
import { child, hasToken, namedChildren, perTree, textOf, type Flat } from "../../syntax.ts";
import { GO } from "./index.ts";
import { receiverType, typeName } from "./nodes.ts";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The names an import path's package may go by when no alias is given: `yaml.v3` is yaml, `go-isatty` is isatty, `v2` is its parent. */
const packageNames = (path: string): string[] => {
    const segs = path.split("/");
    let last = segs[segs.length - 1] ?? "";
    if (/^v[0-9]+$/.test(last) && segs.length > 1) last = segs[segs.length - 2];
    const out = new Set<string>([last, last.split(".")[0], last.replace(/^go[-_]/, ""), last.replace(/[-_.]go$/, ""), last.replace(/[-.]/g, ""), last.replace(/[-.]/g, "_")]);
    return [...out].filter((n) => IDENT.test(n));
};

const importsOf = (t: Flat): GImport[] => {
    const out: GImport[] = [];
    for (let n = 0; n < t.count; n++) {
        if (t.type[n] !== "import_spec") continue;
        const pathNode = child(t, n, "path");
        const spec = textOf(t, pathNode).replace(/^["`]|["`]$/g, "");
        const name = child(t, n, "name");
        if (name >= 0 && t.type[name] === "dot") out.push({ local: "", spec, level: 0, name: "*", node: -1, bind: -1, stmt: n });
        else if (name >= 0 && t.type[name] === "blank_identifier") continue;
        else if (name >= 0) out.push({ local: textOf(t, name), spec, level: 0, name: null, node: -1, bind: name, stmt: n });
        // No name written: the package's own name binds, which only its files tell; these are guesses for them to confirm.
        else for (const local of packageNames(spec)) out.push({ local, spec, level: 0, name: null, node: -1, bind: pathNode, stmt: n, implicit: true });
    }
    return out;
};

const imports = perTree(importsOf);

const idsOf = (t: Flat, list: number): number[] => (list < 0 ? [] : t.type[list] === "identifier" ? [list] : namedChildren(t, list).filter((c) => t.type[c] === "identifier"));

/** A parameter list's names, each with its type. */
const params = (t: Flat, list: number, emit: Emit) => {
    for (const p of namedChildren(t, list)) {
        if (t.type[p] !== "parameter_declaration" && t.type[p] !== "variadic_parameter_declaration") continue;
        const type = child(t, p, "type");
        for (let c = t.first[p]; c >= 0; c = t.next[c]) if (t.field[c] === "name" && t.type[c] === "identifier") emit(c, "param", t.type[p] === "parameter_declaration" ? { typeNode: type } : {});
    }
};

/** `left := right`: each name with its own value, or the call's result in order, seen from the end of the statement on. */
const shortVars = (t: Flat, left: number, right: number, from: number, emit: Emit) => {
    const names = idsOf(t, left);
    const values = right < 0 ? [] : t.type[right] === "expression_list" ? namedChildren(t, right) : [right];
    names.forEach((id, i) => {
        if (values.length === names.length) emit(id, "local", { init: values[i], from });
        else if (values.length === 1) emit(id, "local", { init: values[0], initResult: i, from });
        else emit(id, "local", { from });
    });
};

const binds = (t: Flat, n: number, emit: Emit) => {
    switch (t.type[n]) {
        case "function_declaration":
            emit(child(t, n, "name"), "def", { unitNode: n });
            params(t, child(t, n, "parameters"), emit);
            params(t, child(t, n, "result"), emit);
            return;
        case "method_declaration": {
            params(t, child(t, n, "receiver"), emit);
            // `func (l *List[T]) Each(v T)`: the receiver's type arguments declare the method's type parameters.
            let recv = receiverType(t, n);
            while (recv >= 0 && (t.type[recv] === "pointer_type" || t.type[recv] === "parenthesized_type")) recv = namedChildren(t, recv)[0] ?? -1;
            if (recv >= 0 && t.type[recv] === "generic_type") {
                for (const arg of namedChildren(t, child(t, recv, "type_arguments"))) {
                    const id = t.type[arg] === "type_elem" ? namedChildren(t, arg)[0] : arg;
                    if (id !== undefined && t.type[id] === "type_identifier") emit(id, "param");
                }
            }
            params(t, child(t, n, "parameters"), emit);
            params(t, child(t, n, "result"), emit);
            return;
        }
        case "func_literal":
            params(t, child(t, n, "parameters"), emit);
            params(t, child(t, n, "result"), emit);
            return;
        case "type_parameter_declaration":
            for (const c of namedChildren(t, n)) if (t.field[c] === "name" || t.type[c] === "identifier") emit(c, "param");
            return;
        case "type_spec":
        case "type_alias":
            emit(child(t, n, "name"), "type", { unitNode: n });
            return;
        // A local is seen from the end of its statement on: before it, and in its own value, the name means the one outside.
        case "var_spec":
        case "const_spec": {
            const names: number[] = [];
            for (let c = t.first[n]; c >= 0; c = t.next[c]) if (t.field[c] === "name") names.push(c);
            const type = child(t, n, "type");
            const value = child(t, n, "value");
            const values = value < 0 ? [] : namedChildren(t, value);
            names.forEach((id, i) => emit(id, "local", { typeNode: type, from: t.end[n], ...(values.length === names.length ? { init: values[i] } : values.length === 1 ? { init: values[0], initResult: i } : {}) }));
            return;
        }
        case "short_var_declaration":
            shortVars(t, child(t, n, "left"), child(t, n, "right"), t.end[n], emit);
            return;
        case "range_clause":
        case "receive_statement":
            if (hasToken(t, n, ":=")) for (const id of idsOf(t, child(t, n, "left"))) emit(id, "local", { from: t.end[n] });
            return;
        case "type_switch_statement": {
            const value = child(t, n, "value");
            for (const id of idsOf(t, child(t, n, "alias"))) emit(id, "local", value >= 0 ? { from: t.end[value] } : {});
            return;
        }
        case "import_spec":
            for (const i of imports(t)) if (i.stmt === n && i.bind >= 0) emit(i.bind, "import", { import: i, name: i.local });
            return;
    }
};

const role = (t: Flat, n: number): Role => {
    const p = t.parent[n];
    if (p < 0) return { kind: "bare", expr: n };
    const pt = t.type[p];
    const f = t.field[n];
    const ty = t.type[n];
    if (pt === "selector_expression" && f === "field") return { kind: "member", receiver: child(t, p, "operand"), expr: p };
    if (pt === "qualified_type" && f === "name") return { kind: "member", receiver: child(t, p, "package"), expr: p };
    if (ty === "field_identifier") return { kind: "skip" };
    // A struct literal's keys name fields, not package-level declarations.
    if (pt === "literal_element" && t.field[p] === "key") return { kind: "skip" };
    if (pt === "method_declaration" && f === "name") return { kind: "decl" };
    // A parameter's name declares it, in a function type or an interface's method too, where no scope binds it.
    if ((pt === "parameter_declaration" || pt === "variadic_parameter_declaration") && f === "name") return { kind: "decl" };
    if (pt === "package_clause") return { kind: "skip" };
    if (ty === "identifier" && textOf(t, n) === "_") return { kind: "skip" };
    return { kind: "bare", expr: n };
};

const isCallee = (t: Flat, e: number) => {
    const p = t.parent[e];
    return p >= 0 && t.type[p] === "call_expression" && t.field[e] === "function";
};

const TYPE_PARENTS = new Set(["pointer_type", "qualified_type", "slice_type", "array_type", "map_type", "channel_type", "generic_type", "type_arguments", "parameter_declaration", "field_declaration", "type_spec", "type_alias", "composite_literal", "var_spec", "type_case", "type_assertion_expression", "type_conversion_expression"]);
const isType = (t: Flat, n: number) => t.type[n] === "type_identifier" || (t.type[n] === "package_identifier" && t.type[t.parent[n]] === "qualified_type") || (TYPE_PARENTS.has(t.type[t.parent[n]]) && t.field[n] === "type");

const unit: LangRules["unit"] = (t, capture, node) => {
    const ty = t.type[node];
    if (capture === "definition.function" && ty === "function_declaration") return { kind: "function", nameNode: child(t, node, "name"), outer: node };
    if (capture === "definition.method" && ty === "method_declaration") return { kind: "method", nameNode: child(t, node, "name"), outer: node };
    if (capture === "definition.type" && (ty === "type_spec" || ty === "type_alias")) {
        // A lone `type X ...` takes its `type` keyword and doc comment; one in a `type ( ... )` group starts at itself.
        const p = t.parent[node];
        const lone = p >= 0 && t.type[p] === "type_declaration" && namedChildren(t, p).filter((c) => t.type[c] === "type_spec" || t.type[c] === "type_alias").length === 1;
        return { kind: "type", nameNode: child(t, node, "name"), outer: lone ? p : node };
    }
    return null;
};

const FUNCTIONS: ReadonlySet<string> = new Set(["function_declaration", "method_declaration", "func_literal"]);
const BLOCKS: ReadonlySet<string> = new Set(["block", "if_statement", "for_statement", "expression_switch_statement", "type_switch_statement", "select_statement", "communication_case", "expression_case", "type_case", "default_case"]);

export const GO_RULES: LangRules = {
    unit,
    label: (t, u) => {
        const recv = u.kind === "method" ? typeName(t, receiverType(t, u.node)) : null;
        const owner = recv?.kind === "name" ? textOf(t, recv.node) : recv?.kind === "qualified" ? recv.name : undefined;
        return labelOf({ name: u.name, kind: u.kind, ...(owner ? { parent: owner } : {}) }, GO.id);
    },
    scope: (t, n) => {
        const ty = t.type[n];
        if (FUNCTIONS.has(ty)) return "function";
        if (BLOCKS.has(ty)) return "block";
        // A generic type's parameters are its own.
        if ((ty === "type_spec" || ty === "type_alias") && child(t, n, "type_parameters") >= 0) return "block";
        return null;
    },
    binds,
    identifiers: new Set(["identifier", "type_identifier", "field_identifier", "package_identifier"]),
    role,
    isCallee,
    isType,
    imports,
};
