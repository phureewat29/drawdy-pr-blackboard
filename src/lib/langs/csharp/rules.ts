/**
 * C#'s rule table: tree-sitter-c-sharp 0.23.5's nodes, its `tags.scm` for
 * classes, interfaces and methods, and beside it (`extraUnits`) what the
 * language survey's units query adds: structs, records, enums, constructors
 * and properties. Members of a type inside a method are no card: C# has none
 * but local functions, which belong to the code around them. A site inside
 * `#if`, `#elif` or `#else` names nothing: some builds don't compile it.
 */

import type { Emit, LangRules, Role } from "../../anyfacts.ts";
import { child, hasToken, textOf, type Flat } from "../../syntax.ts";
import { bare, code, conditionOf, conditional, isMember, isVar, paramsOf, TYPE_DECLARATIONS, TYPE_KINDS, valueOf } from "./nodes.ts";

const DEFINITIONS: Record<string, string> = { "definition.class": "class_declaration", "definition.interface": "interface_declaration", "definition.method": "method_declaration" };

const unit: LangRules["unit"] = (t, capture, node) => {
    if (DEFINITIONS[capture] !== t.type[node] || !isMember(t, node)) return null;
    return { kind: TYPE_DECLARATIONS.has(t.type[node]) ? "class" : "function", nameNode: child(t, node, "name"), outer: node };
};

/** The declarations the survey's units query adds to the tags': structs, records and enums as types, constructors and properties as members. */
const EXTRA: Record<string, "class" | "function"> = { struct_declaration: "class", record_declaration: "class", enum_declaration: "class", constructor_declaration: "function", property_declaration: "function" };

const extraUnits: LangRules["extraUnits"] = (t) => {
    const out: { kind: "class" | "function"; nameNode: number; outer: number; node: number }[] = [];
    for (let n = 0; n < t.count; n++) {
        const kind = EXTRA[t.type[n]];
        if (kind && isMember(t, n) && child(t, n, "name") >= 0) out.push({ kind, nameNode: child(t, n, "name"), outer: n, node: n });
    }
    return out;
};

/** `class Foo`, `Foo.Run()`, `Foo.Name`, a constructor `Foo()`. */
const label: LangRules["label"] = (t, u, parent) => {
    const ty = t.type[u.node];
    if (TYPE_DECLARATIONS.has(ty)) return `${TYPE_KINDS[ty as keyof typeof TYPE_KINDS]} ${u.name}`;
    if (ty === "constructor_declaration" || !parent) return `${u.name}()`;
    return ty === "property_declaration" ? `${parent.name}.${u.name}` : `${parent.name}.${u.name}()`;
};

const FUNCTIONS: ReadonlySet<string> = new Set([
    "method_declaration",
    "constructor_declaration",
    "destructor_declaration",
    "operator_declaration",
    "conversion_operator_declaration",
    "local_function_statement",
    "lambda_expression",
    "anonymous_method_expression",
    "property_declaration",
    "indexer_declaration",
    "event_declaration",
    "accessor_declaration",
    "delegate_declaration",
]);

/** Scopes of locals: a switch statement's sections share one (C# spec 13.8.3). */
const BLOCKS: ReadonlySet<string> = new Set(["block", "for_statement", "foreach_statement", "using_statement", "fixed_statement", "catch_clause", "switch_body", "switch_expression_arm", "query_expression"]);

/** Statements whose declarations are locals: a field's or an event's are members. */
const LOCAL_DECLARATIONS: ReadonlySet<string> = new Set(["local_declaration_statement", "using_statement", "for_statement", "fixed_statement"]);

/** Pattern and deconstruction designations: locals of no written type. */
const DESIGNATIONS: ReadonlySet<string> = new Set(["var_pattern", "tuple_pattern", "parenthesized_variable_designation"]);

/** The names a node binds, each as C# compares it (`@x` is `x`). */
const binds = (t: Flat, n: number, write: Emit) => {
    const emit: Emit = (node, kind, opts = {}) => write(node, kind, { ...opts, name: opts.name ?? bare(textOf(t, node)) });
    const ty = t.type[n];
    switch (ty) {
        case "type_parameter":
            emit(child(t, n, "name"), "type");
            return;
        case "parameter_list":
        case "bracketed_parameter_list": {
            for (let c = t.first[n]; c >= 0; c = t.next[c]) {
                if (t.type[c] === "parameter" && child(t, c, "name") >= 0) emit(child(t, c, "name"), "param", isVar(t, child(t, c, "type")) ? {} : { typeNode: child(t, c, "type") });
                else if (t.field[c] === "name") {
                    const p = paramsOf(t, n).find((x) => x.name === bare(textOf(t, c)));
                    emit(c, "param", p && p.type >= 0 ? { typeNode: p.type } : {});
                }
            }
            return;
        }
        case "implicit_parameter":
            emit(n, "param");
            return;
        case "accessor_declaration": {
            // A setter's value.
            const kw = child(t, n, "name");
            if (kw >= 0 && ["set", "init", "add", "remove"].includes(textOf(t, kw))) emit(kw, "param", { name: "value" });
            return;
        }
        case "variable_declarator": {
            const decl = t.parent[n];
            if (t.type[decl] !== "variable_declaration" || !LOCAL_DECLARATIONS.has(t.type[t.parent[decl]])) return;
            const name = child(t, n, "name");
            if (name < 0) return;
            const type = child(t, decl, "type");
            const value = valueOf(t, n);
            emit(name, "local", isVar(t, type) ? (value >= 0 ? { init: value } : {}) : { typeNode: type });
            return;
        }
        case "foreach_statement": {
            const left = child(t, n, "left");
            const type = child(t, n, "type");
            if (left >= 0 && t.type[left] === "identifier") emit(left, "local", isVar(t, type) ? {} : { typeNode: type });
            return;
        }
        case "catch_declaration":
        case "declaration_expression":
        case "declaration_pattern":
        case "recursive_pattern": {
            const name = child(t, n, "name");
            const type = child(t, n, "type");
            if (name >= 0) emit(name, "local", isVar(t, type) || type < 0 ? {} : { typeNode: type });
            return;
        }
        case "from_clause":
        case "let_clause":
        case "join_clause":
        case "join_into_clause": {
            const id = child(t, n, "name") >= 0 ? child(t, n, "name") : (code(t, n).find((c) => t.type[c] === "identifier") ?? -1);
            if (id >= 0) emit(id, "local");
            return;
        }
        case "local_function_statement":
            emit(child(t, n, "name"), "def");
            return;
        // A query's continuation, `into g`: a range variable of the rest of the query.
        case "query_expression":
            for (const c of code(t, n)) if (t.type[c] === "identifier") emit(c, "local");
            return;
    }
    if (DESIGNATIONS.has(ty)) for (const c of code(t, n)) if (t.type[c] === "identifier") emit(c, "local");
};

/** Nodes whose `name` declares something: no use of it. */
const NAMED: ReadonlySet<string> = new Set([
    ...TYPE_DECLARATIONS,
    "delegate_declaration",
    "method_declaration",
    "constructor_declaration",
    "destructor_declaration",
    "property_declaration",
    "event_declaration",
    "enum_member_declaration",
    "variable_declarator",
    "parameter",
    "parameter_list",
    "bracketed_parameter_list",
    "type_parameter",
    "local_function_statement",
    "catch_declaration",
    "declaration_expression",
    "declaration_pattern",
    "recursive_pattern",
    "var_pattern",
    "tuple_pattern",
    "parenthesized_variable_designation",
    "from_clause",
    "tuple_element",
    "accessor_declaration",
    "extern_alias_directive",
    "using_directive",
    "argument",
]);

/** What holds no code names: usings, namespaces' names, attributes, labels. */
const NO_CODE: ReadonlySet<string> = new Set([
    "using_directive",
    "extern_alias_directive",
    "attribute_list",
    "global_attribute",
    "labeled_statement",
    "goto_statement",
    "preproc_if",
    "preproc_elif",
    "preproc_pragma",
    "preproc_line",
    "preproc_define",
    "preproc_undef",
    "type_parameter_constraints_clause",
    "calling_convention",
]);

/**
 * Whether a node sits in code whose names this table doesn't read: a using
 * directive, a namespace's name, an attribute, `nameof(…)`, a property
 * pattern's member names (`{ Name: "x" }`, of the pattern's type), a
 * top-level statement (in a `Program` class other files may add to).
 */
const noCode = (t: Flat, n: number): boolean => {
    for (let x = n, p = t.parent[n]; p >= 0; x = p, p = t.parent[p]) {
        if (NO_CODE.has(t.type[p]) && !(t.type[p].startsWith("preproc") && t.field[x] !== "condition")) return true;
        if (t.type[p] === "global_statement") return true;
        if (t.type[p] === "subpattern" && code(t, p)[0] === x && code(t, p).length > 1) return true;
        if ((t.type[p] === "namespace_declaration" || t.type[p] === "file_scoped_namespace_declaration") && t.field[x] === "name") return true;
        if (t.type[p] === "invocation_expression" && t.field[x] === "arguments") {
            const fn = child(t, p, "function");
            if (fn >= 0 && t.type[fn] === "identifier" && textOf(t, fn) === "nameof") return true;
        }
    }
    return false;
};

const inAccessor = (t: Flat, n: number): boolean => {
    for (let x = t.parent[n]; x > 0; x = t.parent[x]) if (t.type[x] === "accessor_declaration" || t.type[x] === "property_declaration") return true;
    return false;
};

/** The node a member access or a binding names a member of: `x` of `x.f`, `x?.f`. */
const receiverOf = (t: Flat, access: number): number => {
    if (t.type[access] === "member_access_expression") return child(t, access, "expression") >= 0 ? child(t, access, "expression") : (t.first[access] >= 0 ? t.first[access] : -1);
    // `x?.f`: the binding sits in the conditional access whose condition is x.
    const cond = t.parent[access];
    return t.type[cond] === "conditional_access_expression" ? conditionOf(t, cond) : -1;
};

const role = (t: Flat, n: number): Role => {
    const p = t.parent[n];
    if (p < 0 || conditional(t, n) || noCode(t, n)) return { kind: "skip" };
    const pt = t.type[p];
    const ty = t.type[n];
    if (ty === "this" || ty === "base") return pt === "constructor_initializer" ? { kind: "bare", expr: n } : { kind: "skip" };
    if (ty === "new") return pt === "implicit_object_creation_expression" ? { kind: "bare", expr: p } : { kind: "skip" };
    if (t.field[n] === "name" && NAMED.has(pt)) return { kind: "decl" };
    if (pt === "foreach_statement" && t.field[n] === "left") return { kind: "decl" };
    if ((pt === "let_clause" || pt === "join_clause" || pt === "join_into_clause" || pt === "query_expression") && t.field[n] === "") return { kind: "decl" };
    if (pt === "explicit_interface_specifier" || pt === "alias_qualified_name") return { kind: "skip" };
    if (textOf(t, n) === "_" || isVar(t, n)) return { kind: "skip" };
    // `new { Name = x }`, `r with { Name = x }`: Name is a member of the type made; `field` in an accessor, its backing field.
    if ((pt === "anonymous_object_creation_expression" || pt === "with_initializer") && t.next[n] >= 0 && t.type[t.next[n]] === "=") return { kind: "decl" };
    if (textOf(t, n) === "field" && inAccessor(t, n)) return { kind: "skip" };
    // A generic name's site is its identifier; where it stands is its parent's.
    const e = pt === "generic_name" ? p : n;
    const ep = t.parent[e];
    const ept = t.type[ep];
    if ((ept === "member_access_expression" || ept === "member_binding_expression") && t.field[e] === "name") {
        const recv = receiverOf(t, ep);
        return recv >= 0 ? { kind: "member", receiver: recv, expr: e } : { kind: "skip" };
    }
    if (ept === "qualified_name" && t.field[e] === "name") return { kind: "path", receiver: child(t, ep, "qualifier"), expr: e };
    // `new T { P = … }`, `x with { P = … }`: P is a member of what is made.
    if (ept === "assignment_expression" && t.field[e] === "left" && t.type[t.parent[ep]] === "initializer_expression") {
        const made = t.parent[t.parent[ep]];
        if (t.type[made] === "object_creation_expression" || t.type[made] === "implicit_object_creation_expression") return { kind: "member", receiver: made, expr: e };
        return { kind: "skip" };
    }
    return { kind: "bare", expr: e };
};

/** The node an invocation calls through: past `x.` and `x?.` and a generic name's type arguments. */
const callee = (t: Flat, e: number): number => {
    let x = e;
    if (t.type[t.parent[x]] === "generic_name") x = t.parent[x];
    const p = t.parent[x];
    if (t.type[p] === "member_access_expression" && t.field[x] === "name") x = p;
    else if (t.type[p] === "member_binding_expression" && t.field[x] === "name") x = t.parent[p];
    return x;
};

const isCallee = (t: Flat, e: number): boolean => {
    const ty = t.type[e];
    if (ty === "this" || ty === "base" || ty === "implicit_object_creation_expression") return true;
    const x = callee(t, e);
    const p = t.parent[x];
    if (t.type[p] === "invocation_expression" && t.field[x] === "function") return true;
    return creationOf(t, e) >= 0 || primaryBase(t, e) >= 0;
};

/** The creation a type name is the class of, `new Foo()`, `new A.Foo()`, `new Foo<int>()`, or -1. */
export const creationOf = (t: Flat, n: number): number => {
    let x = t.type[t.parent[n]] === "generic_name" ? t.parent[n] : n;
    if (t.type[t.parent[x]] === "qualified_name" && t.field[x] === "name") x = t.parent[x];
    const p = t.parent[x];
    return t.type[p] === "object_creation_expression" && t.field[x] === "type" ? p : -1;
};

/** The arguments a base type of a primary constructor passes, `class C(int x) : B(x)`, or -1. */
export const primaryBase = (t: Flat, n: number): number => {
    let x = t.type[t.parent[n]] === "generic_name" ? t.parent[n] : n;
    if (t.type[t.parent[x]] === "qualified_name" && t.field[x] === "name") x = t.parent[x];
    const p = t.parent[x];
    if (t.type[p] === "primary_constructor_base_type") return code(t, p).find((c) => t.type[c] === "argument_list") ?? -1;
    if (t.type[p] !== "base_list" || t.next[x] < 0) return -1;
    let nx = t.next[x];
    while (nx >= 0 && !t.named[nx]) nx = t.next[nx];
    return nx >= 0 && t.type[nx] === "argument_list" ? nx : -1;
};

const TYPE_PARENTS: ReadonlySet<string> = new Set(["type_argument_list", "base_list", "nullable_type", "array_type", "pointer_type", "ref_type", "scoped_type", "type_parameter_constraint", "primary_constructor_base_type", "typeof_expression"]);

/** Whether an identifier sits in a type. */
const isType = (t: Flat, n: number): boolean => {
    let x = t.type[t.parent[n]] === "generic_name" ? t.parent[n] : n;
    while (t.type[t.parent[x]] === "qualified_name") x = t.parent[x];
    const f = t.field[x];
    return f === "type" || f === "returns" || TYPE_PARENTS.has(t.type[t.parent[x]]) || ((t.type[t.parent[x]] === "as_expression" || t.type[t.parent[x]] === "is_expression") && f === "right");
};

export const CSHARP_RULES: LangRules = {
    unit,
    extraUnits,
    label,
    scope: (t, n) => {
        const ty = t.type[n];
        if (TYPE_DECLARATIONS.has(ty)) return "class";
        if (FUNCTIONS.has(ty)) return "function";
        return BLOCKS.has(ty) ? "block" : null;
    },
    binds,
    identifiers: new Set(["identifier", "this", "base", "new"]),
    role,
    isCallee,
    isType,
    imports: () => [],
};

/** Whether a top-level node imports: a using directive. */
export const isUsing = (t: Flat, n: number): boolean => t.type[n] === "using_directive" || t.type[n] === "extern_alias_directive" || (t.type[n] === "global_statement" && hasToken(t, n, "using"));
