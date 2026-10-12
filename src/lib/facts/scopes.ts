/** A file's scopes and the names each binds. */

import type { Binding, BindingKind, Scope, ScopeKind, Unit } from "../facts.ts";
import { groupBy } from "../fp.ts";
import { child, childOfType, namedChildren, textOf, type Flat } from "../syntax.ts";
import { annotatedType, propName } from "./nodes.ts";

/** What a name means, as flags: an import may be any of them. */
export const VALUE = 1;
export const TYPE = 2;
export const NS = 4;
const ANY = VALUE | TYPE | NS;

export type Scopes = {
    module: Scope;
    /** Every scope, by id. */
    all: Scope[];
    /** Per node, the id of the scope it sits in. */
    scopeIds: Int32Array;
    bindingOfName: Map<number, Binding>;
};

/** Looks a name up from a scope outwards, for a meaning (value, type or namespace). */
export const lookup = (scope: Scope | null, name: string, meaning: number): Binding | null => {
    for (let s = scope; s; s = s.parent) {
        const b = s.bindings.get(name)?.find((x) => x.meaning & meaning);
        if (b) return b;
    }
    return null;
};

const FUNCTION_BODY_OWNERS = new Set(["function_declaration", "function_expression", "function", "generator_function", "generator_function_declaration", "arrow_function", "method_definition"]);

/** `var`, `let` or `const`, from a declaration's keyword. */
const variableKind = (t: Flat, keyword: number): BindingKind => (t.type[keyword] === "var" ? "var" : t.type[keyword] === "let" ? "let" : "const");

/** The names a binding pattern declares, each with its key path: `{ a: { b } }` gives b ["a", "b"]. */
const patternNames = (t: Flat, p: number, path: string[] = []): { node: number; path: string[] }[] => {
    switch (t.type[p]) {
        case "identifier":
            return [{ node: p, path }];
        case "shorthand_property_identifier_pattern":
            return [{ node: p, path: [...path, textOf(t, p)] }];
        case "object_pattern":
            return namedChildren(t, p).flatMap((c) => {
                switch (t.type[c]) {
                    case "pair_pattern":
                        return patternNames(t, child(t, c, "value"), [...path, propName(t, child(t, c, "key"))]);
                    case "object_assignment_pattern":
                        return patternNames(t, child(t, c, "left"), path);
                    case "shorthand_property_identifier_pattern":
                    case "rest_pattern":
                        return patternNames(t, c, path);
                    default:
                        return [];
                }
            });
        case "array_pattern":
            return namedChildren(t, p).flatMap((c, i) => patternNames(t, c, [...path, String(i)]));
        case "assignment_pattern":
            return patternNames(t, child(t, p, "left"), path);
        case "rest_pattern":
            return patternNames(t, namedChildren(t, p)[0] ?? -1, [...path, "..."]);
        default:
            return [];
    }
};

export const scopesOf = (t: Flat, units: readonly Unit[]): Scopes => {
    const all: Scope[] = [];
    const bindingOfName = new Map<number, Binding>();
    const open = (kind: ScopeKind, parent: Scope | null): Scope => {
        const s: Scope = { id: all.length, kind, parent, bindings: new Map() };
        all.push(s);
        return s;
    };
    const module = open("module", null);
    // A module-level name stands for the unit whose range holds it.
    const topUnits = groupBy(
        units.filter((u) => !u.parent),
        (u) => u.name
    );

    const declare = (scope: Scope, nameNode: number, kind: BindingKind, meaning: number, extra: Partial<Binding> = {}) => {
        const name = textOf(t, nameNode);
        const b: Binding = { name, meaning, kind, node: nameNode, init: -1, typeNode: -1, decl: -1, ...extra };
        if (scope === module && kind !== "import") {
            const unit = (topUnits[name] ?? []).find((u) => t.start[nameNode] >= u.start && t.start[nameNode] < u.end);
            if (unit) b.unit = unit;
        }
        const list = scope.bindings.get(name);
        if (list) list.push(b);
        else scope.bindings.set(name, [b]);
        bindingOfName.set(nameNode, b);
    };
    /** A declaration's own name, bound in a scope. */
    const declareName = (scope: Scope, decl: number, kind: BindingKind, meaning: number) => {
        const nm = child(t, decl, "name");
        if (nm >= 0) declare(scope, nm, kind, meaning, { decl });
    };
    /** A destructured name keeps the whole pattern's initializer and type, and its key path into them. */
    const declarePattern = (scope: Scope, p: number, kind: BindingKind, init: number, typeNode: number) => {
        const names = patternNames(t, p);
        const plain = names.length === 1 && names[0].node === p;
        for (const n of names) declare(scope, n.node, kind, VALUE, { init, typeNode, ...(plain ? {} : { path: n.path }), decl: p });
    };
    const functionScopeOf = (s: Scope): Scope => {
        let x: Scope | null = s;
        while (x && x.kind !== "function" && x.kind !== "arrow" && x.kind !== "module") x = x.parent;
        return x ?? module;
    };
    const typeParams = (scope: Scope, n: number): Scope => {
        for (const p of namedChildren(t, child(t, n, "type_parameters"))) {
            const nm = child(t, p, "name");
            if (nm >= 0) declare(scope, nm, "typeparam", TYPE);
        }
        return scope;
    };
    /** A function's type parameters and parameters, in its own scope. */
    const signature = (scope: Scope, fn: number): Scope => {
        typeParams(scope, fn);
        const single = child(t, fn, "parameter");
        if (single >= 0) declare(scope, single, "param", VALUE);
        for (const p of namedChildren(t, child(t, fn, "parameters"))) {
            if (t.type[p] !== "required_parameter" && t.type[p] !== "optional_parameter") declarePattern(scope, p, "param", -1, -1);
            else {
                const pattern = child(t, p, "pattern");
                if (pattern >= 0 && t.type[pattern] !== "this") declarePattern(scope, pattern, "param", child(t, p, "value"), annotatedType(t, p));
            }
        }
        return scope;
    };
    const variables = (scope: Scope, n: number) => {
        const kind = t.type[n] === "variable_declaration" ? "var" : variableKind(t, child(t, n, "kind"));
        const target = kind === "var" ? functionScopeOf(scope) : scope;
        for (const d of namedChildren(t, n)) if (t.type[d] === "variable_declarator") declarePattern(target, child(t, d, "name"), kind, child(t, d, "value"), annotatedType(t, d));
    };
    const imports = (stmt: number) => {
        const imported = (nameNode: number, decl: number) => {
            if (nameNode >= 0) declare(module, nameNode, "import", ANY, { decl });
        };
        for (const c of namedChildren(t, stmt)) {
            if (t.type[c] === "import_require_clause") imported(childOfType(t, c, "identifier"), c);
            if (t.type[c] !== "import_clause") continue;
            for (const k of namedChildren(t, c)) {
                if (t.type[k] === "identifier") imported(k, k);
                else if (t.type[k] === "namespace_import") imported(childOfType(t, k, "identifier"), k);
                else if (t.type[k] === "named_imports") {
                    for (const sp of namedChildren(t, k)) {
                        if (t.type[sp] !== "import_specifier") continue;
                        const alias = child(t, sp, "alias");
                        const local = alias >= 0 ? alias : child(t, sp, "name");
                        if (t.type[local] === "identifier") imported(local, sp);
                    }
                }
            }
        }
    };

    /** Binds what a node declares and gives the scope its children sit in. */
    const enter = (n: number, outer: Scope): Scope => {
        switch (t.type[n]) {
            case "function_declaration":
            case "generator_function_declaration":
                declareName(outer, n, "function", VALUE);
                return signature(open("function", outer), n);
            case "function_signature": {
                // An overload's signature binds nothing beside its implementation.
                const nm = child(t, n, "name");
                if (nm >= 0 && !(outer.bindings.get(textOf(t, nm)) ?? []).some((b) => b.kind === "function")) declare(outer, nm, "function", VALUE, { decl: n });
                return typeParams(open("type", outer), n);
            }
            case "function_expression":
            case "function":
            case "generator_function": {
                const inner = open("function", outer);
                declareName(inner, n, "function", VALUE);
                return signature(inner, n);
            }
            case "arrow_function":
                return signature(open("arrow", outer), n);
            case "method_definition":
                return signature(open("function", outer), n);
            case "method_signature":
            case "abstract_method_signature":
                return signature(open("type", outer), n);
            case "class_declaration":
            case "abstract_class_declaration":
                declareName(outer, n, "class", VALUE | TYPE);
                return typeParams(open("class", outer), n);
            case "class": {
                const inner = open("class", outer);
                declareName(inner, n, "class", VALUE | TYPE);
                return typeParams(inner, n);
            }
            case "interface_declaration":
            case "type_alias_declaration":
                declareName(outer, n, "type", TYPE);
                return typeParams(open("type", outer), n);
            case "enum_declaration":
                declareName(outer, n, "enum", VALUE | TYPE);
                return outer;
            case "internal_module":
            case "module": {
                const nm = child(t, n, "name");
                if (t.type[nm] === "identifier") declare(outer, nm, "namespace", ANY, { decl: n });
                return outer;
            }
            case "statement_block":
            case "switch_body":
            case "class_static_block":
                // A function's body shares its parameters' scope.
                return t.field[n] === "body" && FUNCTION_BODY_OWNERS.has(t.type[t.parent[n]]) ? outer : open("block", outer);
            case "for_statement":
                return open("for", outer);
            case "for_in_statement": {
                const inner = open("for", outer);
                const keyword = child(t, n, "kind");
                if (keyword >= 0) {
                    const kind = variableKind(t, keyword);
                    declarePattern(kind === "var" ? functionScopeOf(outer) : inner, child(t, n, "left"), kind, -1, -1);
                }
                return inner;
            }
            case "catch_clause": {
                const inner = open("catch", outer);
                const p = child(t, n, "parameter");
                if (p >= 0) declarePattern(inner, p, "catch", -1, -1);
                return inner;
            }
            case "lexical_declaration":
            case "variable_declaration":
                variables(outer, n);
                return outer;
            case "import_statement":
                imports(n);
                return outer;
            default:
                return outer;
        }
    };

    // Each node with the scope it sits in, from a stack. Children are pushed in order and so visited
    // last to first: of two declarations of a name in one scope, the later is bound first.
    const scopeIds = new Int32Array(t.count);
    const stack = [0];
    while (stack.length > 0) {
        const n = stack.pop()!;
        const inner = enter(n, all[scopeIds[n]]);
        for (let c = t.first[n]; c >= 0; c = t.next[c]) {
            scopeIds[c] = inner.id;
            stack.push(c);
        }
    }
    return { module, all, scopeIds, bindingOfName };
};
