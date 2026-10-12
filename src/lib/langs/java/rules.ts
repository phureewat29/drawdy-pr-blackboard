/**
 * Java's rule table: tree-sitter-java 0.23.5's nodes, its own `tags.scm` for
 * classes, interfaces and methods, and the constructors, enums, records and
 * annotation types it leaves out. A local or anonymous class's members are
 * no card: they belong to the code around them.
 */

import type { Emit, GImport, LangRules, Role } from "../../anyfacts.ts";
import { child, namedChildren, perTree, type Flat } from "../../syntax.ts";
import { anonymousBody, TYPE_BODIES, code, CONSTRUCTORS, creationOf, dotted, isAnnotation, isAnonymousBody, isMember, isType, isVar, TYPE_KINDS, spreadType, TYPE_DECLARATIONS } from "./nodes.ts";

const unit: LangRules["unit"] = (t, capture, node) => {
    const ty = t.type[node];
    const type = (capture === "definition.class" && ty === "class_declaration") || (capture === "definition.interface" && ty === "interface_declaration");
    if (!(type || (capture === "definition.method" && ty === "method_declaration")) || !isMember(t, node)) return null;
    return { kind: type ? "class" : "function", nameNode: child(t, node, "name"), outer: node };
};

/** Whether a node sits in an arrow case's label, `case Foo f ->`, whose names are that case's alone. */
const inArrowCase = (t: Flat, n: number): boolean => {
    for (let x = t.parent[n]; x >= 0; x = t.parent[x]) {
        if (t.type[x] === "switch_label") return t.type[t.parent[x]] === "switch_rule";
        if (t.type[x] !== "pattern" && t.type[x] !== "type_pattern") return false;
    }
    return false;
};

const binds = (t: Flat, n: number, emit: Emit) => {
    const ty = t.type[n];
    if (TYPE_DECLARATIONS.has(ty)) {
        // A local class is seen from its declaration to the end of its block.
        const p = t.type[t.parent[n]];
        emit(child(t, n, "name"), "type", { unitNode: n, ...(p === "program" || TYPE_BODIES.has(p) ? {} : { from: t.start[n] }) });
        return;
    }
    switch (ty) {
        case "type_parameter": {
            const id = namedChildren(t, n).find((c) => t.type[c] === "type_identifier");
            if (id !== undefined) emit(id, "type");
            return;
        }
        // A variable's written type, its array dimensions read beside it (`String... xs`, `int x[]`).
        case "formal_parameter": {
            const name = child(t, n, "name");
            const type = child(t, n, "type");
            if (name >= 0 && t.type[name] === "identifier") emit(name, "param", isVar(t, type) ? {} : { typeNode: type });
            return;
        }
        case "spread_parameter": {
            const d = namedChildren(t, n).find((c) => t.type[c] === "variable_declarator");
            const name = d !== undefined ? child(t, d, "name") : -1;
            const type = spreadType(t, n);
            if (name >= 0 && t.type[name] === "identifier") emit(name, "param", type >= 0 ? { typeNode: type } : {});
            return;
        }
        case "catch_formal_parameter": {
            const name = child(t, n, "name");
            const types = code(t, namedChildren(t, n).find((c) => t.type[c] === "catch_type") ?? -1);
            if (name >= 0 && t.type[name] === "identifier") emit(name, "local", types.length === 1 ? { typeNode: types[0] } : {});
            return;
        }
        case "local_variable_declaration": {
            const type = child(t, n, "type");
            for (let c = t.first[n]; c >= 0; c = t.next[c]) {
                if (t.field[c] !== "declarator") continue;
                const name = child(t, c, "name");
                if (name < 0 || t.type[name] !== "identifier") continue;
                const value = child(t, c, "value");
                // In scope from its own declarator on.
                const typed = isVar(t, type) ? (value >= 0 ? { init: value } : {}) : { typeNode: type };
                emit(name, "local", { from: t.start[c], ...typed });
            }
            return;
        }
        case "enhanced_for_statement": {
            const name = child(t, n, "name");
            const type = child(t, n, "type");
            const body = child(t, n, "body");
            if (name >= 0 && t.type[name] === "identifier") emit(name, "local", { from: body >= 0 ? t.start[body] : t.end[n], ...(isVar(t, type) ? {} : { typeNode: type }) });
            return;
        }
        case "resource": {
            const name = child(t, n, "name");
            if (name < 0 || t.type[name] !== "identifier") return;
            const type = child(t, n, "type");
            emit(name, "local", { from: t.end[n], ...(isVar(t, type) ? { init: child(t, n, "value") } : { typeNode: type }) });
            return;
        }
        case "lambda_expression": {
            const ps = child(t, n, "parameters");
            if (ps >= 0 && t.type[ps] === "identifier") emit(ps, "param");
            else if (ps >= 0 && t.type[ps] === "inferred_parameters") for (const c of namedChildren(t, ps)) if (t.type[c] === "identifier") emit(c, "param");
            return;
        }
        // A pattern's variable is in scope as its condition flows: from the pattern to the end of its block, its name is a local of no known type.
        case "instanceof_expression": {
            const name = child(t, n, "name");
            if (name >= 0 && t.type[name] === "identifier") emit(name, "local", { from: t.start[n] });
            return;
        }
        case "type_pattern": {
            const id = namedChildren(t, n).find((c) => t.type[c] === "identifier");
            const type = code(t, n).find((c) => c !== id && t.type[c] !== "modifiers");
            if (id !== undefined) emit(id, "local", inArrowCase(t, n) && type !== undefined ? { typeNode: type } : { from: t.start[n] });
            return;
        }
        case "record_pattern_component": {
            const id = namedChildren(t, n).find((c) => t.type[c] === "identifier");
            if (id !== undefined) emit(id, "local", { from: t.start[n] });
            return;
        }
    }
};

/** Nodes whose `name` declares something: no use of it. */
const NAMED = new Set([
    ...TYPE_DECLARATIONS,
    "method_declaration",
    "constructor_declaration",
    "compact_constructor_declaration",
    "annotation_type_element_declaration",
    "variable_declarator",
    "enum_constant",
    "formal_parameter",
    "catch_formal_parameter",
    "enhanced_for_statement",
    "resource",
    "instanceof_expression",
]);

/** Top-level declarations whose names are no code: the package clause, imports (they make sites of their own), a module's. */
const NO_CODE = new Set(["package_declaration", "import_declaration", "module_declaration"]);

/** The top-level node holding a node. */
const topOf = (t: Flat, n: number): number => {
    let x = n;
    while (t.parent[x] > 0) x = t.parent[x];
    return x;
};

const role = (t: Flat, n: number): Role => {
    const p = t.parent[n];
    if (p < 0) return { kind: "skip" };
    const pt = t.type[p];
    const f = t.field[n];
    const ty = t.type[n];
    // `this(…)` and `super(…)` call a constructor; any other `this` or `super` is a receiver.
    if (ty === "this" || ty === "super") return pt === "explicit_constructor_invocation" && f === "constructor" ? { kind: "bare", expr: n } : { kind: "skip" };
    if (f === "name" && NAMED.has(pt)) return { kind: "decl" };
    if (NO_CODE.has(t.type[topOf(t, n)]) || isVar(t, n)) return { kind: "skip" };
    if (ty === "identifier" && (pt === "labeled_statement" || pt === "break_statement" || pt === "continue_statement")) return { kind: "skip" };
    if (pt === "element_value_pair" && f === "key") return { kind: "skip" };
    // `case RED:` names a constant of the switch's own type.
    if (pt === "switch_label" && ty === "identifier") return { kind: "skip" };
    if (pt === "method_invocation" && f === "name") {
        // `X.super.m()`: the receiver is the `super` written after X.
        const sup = namedChildren(t, p).find((c) => t.type[c] === "super" && t.field[c] !== "object");
        const obj = child(t, p, "object");
        return sup !== undefined ? { kind: "member", receiver: sup, expr: n } : obj >= 0 ? { kind: "member", receiver: obj, expr: n } : { kind: "bare", expr: n };
    }
    if (pt === "field_access" && f === "field") return { kind: "member", receiver: child(t, p, "object"), expr: n };
    if (pt === "method_reference") {
        const parts = code(t, p);
        return parts.length > 1 && n === parts[parts.length - 1] ? { kind: "member", receiver: parts[0], expr: n } : { kind: "bare", expr: n };
    }
    if (pt === "scoped_type_identifier") {
        const parts = code(t, p).filter((c) => !isAnnotation(t, c));
        return parts.length > 1 && n === parts[parts.length - 1] ? { kind: "path", receiver: parts[0], expr: n } : { kind: "bare", expr: n };
    }
    // `@a.b.Ann`.
    if (pt === "scoped_identifier" && f === "name") return { kind: "path", receiver: child(t, p, "scope"), expr: n };
    return { kind: "bare", expr: n };
};

const isCallee = (t: Flat, e: number): boolean => {
    const p = t.parent[e];
    if (p < 0) return false;
    const pt = t.type[p];
    if (pt === "method_invocation") return t.field[e] === "name";
    if (pt === "explicit_constructor_invocation") return t.field[e] === "constructor";
    // `new Foo()` names the type and calls its constructor (the resolver says both); a method reference `Foo::bar` is a value, called later if at all.
    const creation = creationOf(t, e);
    return creation >= 0 && anonymousBody(t, creation) === undefined;
};

const imports = perTree((t: Flat): GImport[] => {
    const out: GImport[] = [];
    for (const n of namedChildren(t, 0)) {
        if (t.type[n] !== "import_declaration") continue;
        const path = namedChildren(t, n).find((c) => t.type[c] === "scoped_identifier" || t.type[c] === "identifier");
        if (path === undefined) continue;
        const segs = dotted(t, path);
        if (namedChildren(t, n).some((c) => t.type[c] === "asterisk")) {
            out.push({ local: "", spec: segs.join("."), level: 0, name: "*", node: -1, bind: -1, stmt: n });
            continue;
        }
        const last = t.type[path] === "scoped_identifier" ? child(t, path, "name") : path;
        out.push({ local: segs[segs.length - 1], spec: segs.slice(0, -1).join("."), level: 0, name: segs[segs.length - 1], node: last, bind: last, stmt: n });
    }
    return out;
});

/** The keyword a type's card names it by: `class Foo`, `@interface Tag`. */
const keywordOf = (type: string): string => {
    const kind = TYPE_KINDS[type as keyof typeof TYPE_KINDS];
    return kind === "annotation" ? "@interface" : kind;
};

/** The nodes that open a block scope. An old-style switch is one block: a local of one group is seen in the next. */
const BLOCKS: ReadonlySet<string> = new Set(["block", "switch_block", "switch_rule", "for_statement", "enhanced_for_statement", "catch_clause", "try_with_resources_statement"]);

export const JAVA: LangRules = {
    unit,
    extraUnits: (t) => {
        const out: { kind: "class" | "function"; nameNode: number; outer: number; node: number }[] = [];
        for (let n = 0; n < t.count; n++) {
            const ty = t.type[n];
            const kind = ty === "enum_declaration" || ty === "record_declaration" || ty === "annotation_type_declaration" ? "class" : CONSTRUCTORS.has(ty) || ty === "annotation_type_element_declaration" ? "function" : null;
            if (kind && isMember(t, n)) out.push({ kind, nameNode: child(t, n, "name"), outer: n, node: n });
        }
        return out;
    },
    // `class Foo`, `Foo.run()`, a constructor `Foo()`.
    label: (t, u, parent) => {
        const ty = t.type[u.node];
        if (TYPE_DECLARATIONS.has(ty)) return `${keywordOf(ty)} ${u.name}`;
        return CONSTRUCTORS.has(ty) || !parent ? `${u.name}()` : `${parent.name}.${u.name}()`;
    },
    scope: (t, n) => {
        const ty = t.type[n];
        if (TYPE_DECLARATIONS.has(ty) || isAnonymousBody(t, n)) return "class";
        if (ty === "method_declaration" || CONSTRUCTORS.has(ty) || ty === "lambda_expression") return "function";
        if (BLOCKS.has(ty)) return "block";
        return null;
    },
    binds,
    identifiers: new Set(["identifier", "type_identifier", "this", "super"]),
    role,
    isCallee,
    isType,
    imports,
};
