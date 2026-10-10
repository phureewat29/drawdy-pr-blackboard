/**
 * What one file says, read from its syntax tree: the declarations a card can
 * stand for (units), the scopes and the names each binds, every identifier
 * that refers to something (sites), the file's imports and exports, and the
 * members of its classes and object literals.
 *
 * Units are the declarations a card can stand for: module-level
 * functions, classes, types, values and namespaces; class members that are
 * methods, accessors or function-valued fields; methods of module-level
 * object literals; and `a.b = function` assignments. Functions nested in a
 * function body belong to the outer unit.
 */

import { child, childOfType, children, hasToken, lineOf, namedChildren, prevSibling, textOf, tokensOf, type Flat, type Syntax } from "./syntax.ts";

export const VALUE = 1;
export const TYPE = 2;
export const NS = 4;

export type UnitKind = "function" | "method" | "class" | "type" | "value" | "namespace";

export type Unit = {
    /** `path:nameLine`, the id of the card that stands for it. */
    id: string;
    path: string;
    name: string;
    /** How code reaches it: `Hono.onError`, `EventEmitterPrototype.once`, `module.exports.isAuditMode`. */
    qname: string;
    kind: UnitKind;
    /** Offsets of the declaration (modifiers and decorators in, comments out). */
    start: number;
    end: number;
    startLine: number;
    endLine: number;
    nameLine: number;
    /** First line of the comments attached above it. */
    docLine: number;
    nameStart: number;
    parent?: string;
    /** The declaration node. */
    node: number;
    /** The function, class or object node the unit's value is, when it has one. */
    valueNode: number;
};

export type BindingKind = "var" | "let" | "const" | "param" | "function" | "class" | "import" | "type" | "enum" | "namespace" | "catch" | "typeparam";

export type Binding = {
    name: string;
    meaning: number;
    kind: BindingKind;
    /** The name token. */
    node: number;
    scope: Scope;
    /** Initializer expression, for variables and defaulted parameters. */
    init: number;
    /** Type annotation's type node. */
    typeNode: number;
    /** Where a destructured name sits in its initializer: `const { a: { b } } = x` gives b ["a", "b"]. */
    path?: string[];
    /** The declaration node: function, class, interface, enum, namespace, import specifier. */
    decl: number;
    /** A unit this binding names, at module level. */
    unit?: Unit;
    import?: ImportEntry;
};

export type ScopeKind = "module" | "function" | "arrow" | "block" | "class" | "catch" | "for" | "type";

export type Scope = {
    id: number;
    node: number;
    kind: ScopeKind;
    parent: Scope | null;
    bindings: Map<string, Binding[]>;
};

export type RefKind = "call" | "value" | "type" | "write" | "jsx" | "import" | "export" | "extends";

/** An identifier that refers to something. */
export type Site = {
    /** The name token. */
    node: number;
    start: number;
    line: number;
    name: string;
    ref: RefKind;
    form: "bare" | "member" | "import" | "export" | "require";
    scope: Scope;
    /** Member access: the object expression (`this`, `app`, `this.cursor`). */
    receiver: number;
    /** Import sites: the import entry; require-destructuring sites: the entry and the key path. */
    importEntry?: ImportEntry;
    keyPath?: string[];
    /** Export sites: the local name or the re-export. */
    exportEntry?: ExportEntry;
};

export type ImportEntry = {
    local: string;
    spec: string;
    /** `default`, `*` (namespace), `=` (whole module: require, import =), or a name. */
    imported: string;
    node: number;
    typeOnly: boolean;
    kind: "esm" | "require" | "import-equals";
};

export type ExportEntry =
    | { kind: "local"; name: string; local: string; node: number; nameNode: number }
    | { kind: "expr"; name: string; value: number; node: number }
    | { kind: "reexport"; name: string; spec: string; imported: string; node: number; nameNode: number }
    | { kind: "star"; spec: string; node: number }
    | { kind: "namespace"; name: string; spec: string; node: number };

export type Member = {
    name: string;
    static: boolean;
    kind: "method" | "get" | "set" | "field" | "param" | "this" | "proto" | "pair" | "shorthand" | "signature";
    node: number;
    nameStart: number;
    unit?: Unit;
    /** Value expression: field initializer, assignment right side, pair value. */
    value: number;
    /** Type node of a field or parameter property. */
    typeNode: number;
    /** A `this.x = v` that runs only on some paths (under an if, a ternary, `&&`, a loop, a catch). */
    conditional?: boolean;
};

export type Shape = {
    /** Unique within a pull request: `path#offset`. */
    id: string;
    path: string;
    name: string;
    kind: "class" | "function" | "object" | "interface" | "namespace";
    node: number;
    members: Member[];
    /** `extends` expression of a class, or the extended types of an interface. */
    heritage: number[];
    unit?: Unit;
    /** Spread or computed keys make an object literal's member list incomplete. */
    open: boolean;
};

export type FileFacts = {
    path: string;
    flat: Flat;
    units: Unit[];
    module: Scope;
    scopes: Scope[];
    /** Innermost scope of each node that opens one. */
    scopeOfNode: Map<number, Scope>;
    bindingOfName: Map<number, Binding>;
    sites: Site[];
    imports: ImportEntry[];
    exports: ExportEntry[];
    /** `module.exports = <expr>` or `export = <expr>`: the expression node. */
    moduleExports: number;
    /** Every module specifier: imports, re-exports, require() and import(). */
    specifiers: { spec: string; node: number; reexport: boolean }[];
    /** Shapes by declaration node: classes, constructor functions, object literals, interfaces, namespaces. */
    shapes: Map<number, Shape>;
    /** `const P = X.prototype` and `const P = (X.prototype = {})`: P's name to X's name. */
    protoAliases: Map<string, string>;
    /** Module-level `X.prototype.y = v`, `P.y = v` and `X.y = v` assignments, by X's name. */
    assignments: { owner: string; proto: boolean; name: string; node: number; nameStart: number; value: number; unit?: Unit }[];
};

const FN = new Set(["function_expression", "arrow_function", "generator_function", "function"]);
const WRAPPERS = new Set(["parenthesized_expression", "as_expression", "satisfies_expression", "non_null_expression", "type_assertion"]);

/** The expression inside parentheses, `as`, `satisfies`, `!` and `<T>`. */
export const unwrap = (t: Flat, n: number): number => {
    while (n >= 0 && WRAPPERS.has(t.type[n])) {
        const inner = t.type[n] === "type_assertion" ? namedChildren(t, n).filter((c) => t.type[c] !== "type_arguments").pop() : namedChildren(t, n)[0];
        if (inner === undefined) break;
        n = inner;
    }
    return n;
};
const isFn = (t: Flat, n: number) => n >= 0 && FN.has(t.type[n]);
/** The object literal a module-level initializer builds, directly or as a call's argument (`ObjectFreeze({...})`). */
export const objectOf = (t: Flat, e: number): number => {
    e = unwrap(t, e);
    if (e < 0) return -1;
    if (t.type[e] === "object") return e;
    if (t.type[e] === "call_expression") {
        const args = child(t, e, "arguments");
        if (args >= 0) for (const a of namedChildren(t, args)) if (t.type[unwrap(t, a)] === "object") return unwrap(t, a);
    }
    return -1;
};
/** A property name as written: identifiers as is, strings without quotes. */
export const propName = (t: Flat, n: number): string => {
    if (n < 0) return "?";
    const ty = t.type[n];
    if (ty === "string") {
        const frag = childOfType(t, n, "string_fragment");
        return frag >= 0 ? textOf(t, frag) : "";
    }
    return textOf(t, n);
};
const stringValue = (t: Flat, n: number): string | null => {
    if (n < 0) return null;
    if (t.type[n] === "string") return propName(t, n);
    if (t.type[n] === "template_string" && !namedChildren(t, n).some((c) => t.type[c] === "template_substitution")) return textOf(t, n).slice(1, -1);
    return null;
};

export const analyzeFile = (path: string, t: Flat): FileFacts => {
    const units = unitsOf(path, t);
    const scopes = scopesOf(t, units);
    const mods = modulesOf(t);
    const sites = sitesOf(t, scopes, mods);
    const facts: FileFacts = {
        path,
        flat: t,
        units,
        module: scopes.module,
        scopes: scopes.all,
        scopeOfNode: scopes.scopeOfNode,
        bindingOfName: scopes.bindingOfName,
        sites,
        imports: mods.imports,
        exports: mods.exports,
        moduleExports: mods.moduleExports,
        specifiers: mods.specifiers,
        shapes: new Map(),
        protoAliases: new Map(),
        assignments: [],
    };
    shapesOf(facts, units);
    return facts;
};

/** Every card-sized declaration in a file. */
const unitsOf = (path: string, t: Flat): Unit[] => {
    const units: Unit[] = [];
    const docStartOf = (n: number): number => {
        let first = t.start[n];
        for (let p = prevSibling(t, n); p >= 0 && t.type[p] === "comment"; p = prevSibling(t, p)) {
            const between = t.text.slice(t.end[p], first);
            if ((between.match(/\n/g) ?? []).length > 1) break;
            first = t.start[p];
        }
        return first;
    };
    /** Start of a class member with the decorators right before it, which tree-sitter keeps as siblings. */
    const memberStart = (n: number): number => {
        let first = n;
        for (let p = prevSibling(t, n); p >= 0 && t.type[p] === "decorator"; p = prevSibling(t, p)) first = p;
        return first;
    };
    /** Overload signatures and their implementation are one unit; accessors are not overloads. */
    const overloadable = (n: number) =>
        ["function_declaration", "generator_function_declaration", "function_signature", "method_definition", "method_signature", "abstract_method_signature"].includes(t.type[n]) && !hasToken(t, n, "get") && !hasToken(t, n, "set");
    const make = (node: number, outer: number, nameNode: number, name: string, qname: string, kind: UnitKind, parent: Unit | undefined, valueNode = -1): Unit => {
        const start = t.start[outer];
        // A decorated class member starts at its decorators, which tree-sitter keeps as siblings, and ends with itself.
        const end = Math.max(t.end[outer], t.end[node]);
        const nameStart = nameNode >= 0 ? t.start[nameNode] : start;
        const last = units[units.length - 1];
        if (last && last.name === name && last.parent === parent?.id && last.kind === kind && (kind === "function" || kind === "method") && overloadable(last.node) && overloadable(node)) {
            last.end = end;
            last.endLine = lineOf(t, Math.max(last.start, end - 1));
            last.node = node;
            if (valueNode >= 0) last.valueNode = valueNode;
            return last;
        }
        const u: Unit = {
            id: "",
            path,
            name,
            qname,
            kind,
            start,
            end,
            startLine: lineOf(t, start),
            endLine: lineOf(t, Math.max(start, end - 1)),
            nameLine: lineOf(t, nameStart),
            docLine: lineOf(t, docStartOf(outer)),
            nameStart,
            ...(parent ? { parent: parent.id } : {}),
            node,
            valueNode,
        };
        u.id = `${path}:${u.nameLine}`;
        if (units.some((x) => x.id === u.id)) u.id = `${path}:${u.nameLine}:${name}`;
        units.push(u);
        return u;
    };
    const objectMembers = (obj: number, parent: Unit) => {
        for (const p of namedChildren(t, obj)) {
            const ty = t.type[p];
            if (ty === "method_definition") {
                const nm = child(t, p, "name");
                make(p, p, nm, propName(t, nm), `${parent.qname}.${propName(t, nm)}`, "method", parent, p);
            } else if (ty === "pair") {
                const v = unwrap(t, child(t, p, "value"));
                const k = child(t, p, "key");
                if (isFn(t, v)) make(p, p, k, propName(t, k), `${parent.qname}.${propName(t, k)}`, "method", parent, v);
            }
        }
    };
    const classMembers = (cls: number, parent: Unit) => {
        const body = child(t, cls, "body");
        if (body < 0) return;
        for (const m of namedChildren(t, body)) {
            const ty = t.type[m];
            if (ty === "method_definition" || ty === "method_signature" || ty === "abstract_method_signature") {
                const nm = child(t, m, "name");
                const name = propName(t, nm);
                make(m, memberStart(m), nm, name, `${parent.qname}.${name}`, "method", parent, m);
            } else if (ty === "public_field_definition" || ty === "field_definition") {
                const nm = child(t, m, ty === "field_definition" ? "property" : "name");
                const v = unwrap(t, child(t, m, "value"));
                if (isFn(t, v)) make(m, memberStart(m), nm, propName(t, nm), `${parent.qname}.${propName(t, nm)}`, "method", parent, v);
            }
        }
    };
    const statements = (container: number, parent?: Unit) => {
        const q = (name: string) => (parent ? `${parent.qname}.${name}` : name);
        for (const s of namedChildren(t, container)) {
            let decl = s;
            const outer = s;
            if (t.type[s] === "export_statement") {
                const d = child(t, s, "declaration");
                const v = child(t, s, "value");
                if (d >= 0) decl = d;
                else if (v >= 0) {
                    const e = unwrap(t, v);
                    if (t.type[e] === "identifier") continue;
                    const kw = children(t, s).find((c) => !t.named[c] && t.type[c] === "default") ?? s;
                    if (t.type[e] === "class") {
                        classMembers(e, make(s, s, kw, "default", q("default"), "class", parent, e));
                        continue;
                    }
                    const u = make(s, s, kw, "default", "default", isFn(t, e) ? "function" : "value", parent, e);
                    const obj = objectOf(t, v);
                    if (obj >= 0) objectMembers(obj, u);
                    continue;
                } else {
                    // `export = X`
                    const e = namedChildren(t, s).find((c) => t.type[c] !== "export_clause" && t.type[c] !== "namespace_export" && t.type[c] !== "string" && t.type[c] !== "decorator");
                    if (e === undefined || !hasToken(t, s, "=")) continue;
                    const x = unwrap(t, e);
                    if (t.type[x] === "identifier") continue;
                    const u = make(s, s, s, "default", "default", isFn(t, x) ? "function" : "value", parent, x);
                    const obj = objectOf(t, e);
                    if (obj >= 0) objectMembers(obj, u);
                    continue;
                }
            }
            if (t.type[decl] === "ambient_declaration") {
                // `declare global { ... }`: a namespace named global, as TypeScript reads it.
                const block = childOfType(t, decl, "statement_block");
                if (hasToken(t, decl, "global") && block >= 0) {
                    const kw = children(t, decl).find((c) => !t.named[c] && t.type[c] === "global") ?? decl;
                    statements(block, make(decl, outer, kw, "global", q("global"), "namespace", parent, decl));
                    continue;
                }
                const inner = namedChildren(t, decl).find((c) => t.type[c] !== "comment");
                if (inner === undefined) continue;
                decl = inner;
            }
            const ty = t.type[decl];
            if (ty === "function_declaration" || ty === "generator_function_declaration" || ty === "function_signature") {
                const nm = child(t, decl, "name");
                const name = nm >= 0 ? textOf(t, nm) : "default";
                make(decl, outer, nm >= 0 ? nm : outer, name, q(name), "function", parent, decl);
            } else if (ty === "class_declaration" || ty === "abstract_class_declaration") {
                const nm = child(t, decl, "name");
                const name = nm >= 0 ? textOf(t, nm) : "default";
                classMembers(decl, make(decl, outer, nm >= 0 ? nm : outer, name, q(name), "class", parent, decl));
            } else if (ty === "interface_declaration" || ty === "type_alias_declaration" || ty === "enum_declaration") {
                const nm = child(t, decl, "name");
                make(decl, outer, nm, textOf(t, nm), q(textOf(t, nm)), "type", parent, decl);
            } else if (ty === "internal_module" || ty === "module") {
                const nm = child(t, decl, "name");
                const name = propName(t, nm);
                const u = make(decl, outer, nm, name, q(name), "namespace", parent, decl);
                const body = child(t, decl, "body");
                if (body >= 0) statements(body, u);
            } else if (ty === "lexical_declaration" || ty === "variable_declaration") {
                const decls = namedChildren(t, decl).filter((c) => t.type[c] === "variable_declarator");
                for (const d of decls) {
                    const nm = child(t, d, "name");
                    if (nm < 0 || t.type[nm] !== "identifier") continue;
                    const value = child(t, d, "value");
                    const init = unwrap(t, value);
                    const node = decls.length === 1 ? outer : d;
                    const name = textOf(t, nm);
                    if (init >= 0 && t.type[init] === "class") classMembers(init, make(d, node, nm, name, q(name), "class", parent, init));
                    else if (isFn(t, init)) make(d, node, nm, name, q(name), "function", parent, init);
                    else {
                        const obj = value >= 0 ? objectOf(t, value) : -1;
                        const u = make(d, node, nm, name, q(name), "value", parent, obj);
                        if (obj >= 0) objectMembers(obj, u);
                    }
                }
            } else if (ty === "expression_statement") {
                const e = namedChildren(t, decl)[0];
                if (e === undefined || t.type[e] !== "assignment_expression") continue;
                const lhs = child(t, e, "left");
                const rhsRaw = child(t, e, "right");
                const rhs = unwrap(t, rhsRaw);
                if (t.type[lhs] !== "member_expression" && t.type[lhs] !== "subscript_expression") continue;
                const lhsText = textOf(t, lhs);
                const nameNode = t.type[lhs] === "member_expression" ? child(t, lhs, "property") : child(t, lhs, "index");
                const name = propName(t, nameNode);
                if (isFn(t, rhs)) make(decl, outer, nameNode, name, lhsText, /^(module\.)?exports\./.test(lhsText) ? "function" : "method", parent, rhs);
                else if (rhs >= 0 && t.type[rhs] === "class") classMembers(rhs, make(decl, outer, nameNode, name, lhsText, "class", parent, rhs));
                else if (/^module\.exports$/.test(lhsText)) {
                    const obj = objectOf(t, rhsRaw);
                    if (obj >= 0) objectMembers(obj, make(decl, outer, lhs, "module.exports", "module.exports", "value", parent, obj));
                }
            }
        }
    };
    statements(0);
    return units;
};

/** Scopes, and the names each binds. */
const scopesOf = (t: Flat, units: Unit[]) => {
    let nextId = 0;
    const all: Scope[] = [];
    const scopeOfNode = new Map<number, Scope>();
    const bindingOfName = new Map<number, Binding>();
    const newScope = (node: number, kind: ScopeKind, parent: Scope | null): Scope => {
        const s: Scope = { id: nextId++, node, kind, parent, bindings: new Map() };
        all.push(s);
        scopeOfNode.set(node, s);
        return s;
    };
    const module = newScope(0, "module", null);
    const unitsByName = new Map<string, Unit[]>();
    for (const u of units) if (!u.parent) unitsByName.set(u.name, [...(unitsByName.get(u.name) ?? []), u]);
    const declare = (scope: Scope, nameNode: number, kind: BindingKind, meaning: number, extra: Partial<Binding> = {}): Binding => {
        const name = textOf(t, nameNode);
        const b: Binding = { name, meaning, kind, node: nameNode, scope, init: -1, typeNode: -1, decl: -1, ...extra };
        if (scope === module && !b.unit && kind !== "import") {
            const u = (unitsByName.get(name) ?? []).find((x) => t.start[nameNode] >= x.start && t.start[nameNode] < x.end);
            if (u) b.unit = u;
        }
        const list = scope.bindings.get(name) ?? [];
        list.push(b);
        scope.bindings.set(name, list);
        bindingOfName.set(nameNode, b);
        return b;
    };
    const functionScopeOf = (s: Scope): Scope => {
        let x: Scope | null = s;
        while (x && x.kind !== "function" && x.kind !== "arrow" && x.kind !== "module") x = x.parent;
        return x ?? module;
    };
    /** Names a binding pattern declares, with their key paths. */
    const patternNames = (p: number, path: string[], out: { node: number; path: string[]; init: number }[], init = -1) => {
        if (p < 0) return;
        const ty = t.type[p];
        if (ty === "identifier" || ty === "shorthand_property_identifier_pattern") out.push({ node: p, path: ty === "shorthand_property_identifier_pattern" ? [...path, textOf(t, p)] : path, init });
        else if (ty === "object_pattern") {
            for (const c of namedChildren(t, p)) {
                if (t.type[c] === "shorthand_property_identifier_pattern") out.push({ node: c, path: [...path, textOf(t, c)], init: -1 });
                else if (t.type[c] === "pair_pattern") patternNames(child(t, c, "value"), [...path, propName(t, child(t, c, "key"))], out);
                else if (t.type[c] === "object_assignment_pattern") {
                    const left = child(t, c, "left");
                    if (t.type[left] === "shorthand_property_identifier_pattern") out.push({ node: left, path: [...path, textOf(t, left)], init: child(t, c, "right") });
                    else patternNames(left, path, out);
                } else if (t.type[c] === "rest_pattern") patternNames(namedChildren(t, c)[0] ?? -1, [...path, "..."], out);
            }
        } else if (ty === "array_pattern") {
            namedChildren(t, p).forEach((c, i) => patternNames(c, [...path, String(i)], out));
        } else if (ty === "assignment_pattern") patternNames(child(t, p, "left"), path, out, child(t, p, "right"));
        else if (ty === "rest_pattern") patternNames(namedChildren(t, p)[0] ?? -1, [...path, "..."], out);
    };
    const declarePattern = (scope: Scope, p: number, kind: BindingKind, init: number, typeNode: number) => {
        const names: { node: number; path: string[]; init: number }[] = [];
        patternNames(p, [], names);
        const plain = names.length === 1 && names[0].node === p;
        // A destructured name keeps the whole pattern's initializer and type, and its key path into them.
        for (const n of names) declare(scope, n.node, kind, VALUE, { init, typeNode, ...(plain ? {} : { path: n.path }), decl: p });
    };
    const typeParams = (scope: Scope, n: number) => {
        const tp = child(t, n, "type_parameters");
        if (tp < 0) return;
        for (const p of namedChildren(t, tp)) {
            const nm = child(t, p, "name");
            if (nm >= 0) declare(scope, nm, "typeparam", TYPE);
        }
    };
    const params = (scope: Scope, fn: number) => {
        const single = child(t, fn, "parameter");
        if (single >= 0) declare(scope, single, "param", VALUE);
        const ps = child(t, fn, "parameters");
        if (ps < 0) return;
        for (const p of namedChildren(t, ps)) {
            if (t.type[p] === "required_parameter" || t.type[p] === "optional_parameter") {
                const pat = child(t, p, "pattern");
                const ty = child(t, p, "type");
                const typeNode = ty >= 0 ? (namedChildren(t, ty)[0] ?? -1) : -1;
                if (pat >= 0 && t.type[pat] !== "this") declarePattern(scope, pat, "param", child(t, p, "value"), typeNode);
            } else declarePattern(scope, p, "param", -1, -1);
        }
    };
    const declareImport = (scope: Scope, stmt: number) => {
        for (const c of namedChildren(t, stmt)) {
            if (t.type[c] === "import_clause") {
                for (const k of namedChildren(t, c)) {
                    if (t.type[k] === "identifier") declare(scope, k, "import", VALUE | TYPE | NS, { decl: k });
                    else if (t.type[k] === "namespace_import") {
                        const id = childOfType(t, k, "identifier");
                        if (id >= 0) declare(scope, id, "import", VALUE | TYPE | NS, { decl: k });
                    } else if (t.type[k] === "named_imports") {
                        for (const sp of namedChildren(t, k)) {
                            if (t.type[sp] !== "import_specifier") continue;
                            const alias = child(t, sp, "alias");
                            const nm = child(t, sp, "name");
                            const local = alias >= 0 ? alias : nm;
                            if (local >= 0 && t.type[local] === "identifier") declare(scope, local, "import", VALUE | TYPE | NS, { decl: sp });
                        }
                    }
                }
            } else if (t.type[c] === "import_require_clause") {
                const id = childOfType(t, c, "identifier");
                if (id >= 0) declare(scope, id, "import", VALUE | TYPE | NS, { decl: c });
            }
        }
    };
    const varDecl = (scope: Scope, n: number) => {
        const kindTok = child(t, n, "kind");
        const kind: BindingKind = t.type[n] === "variable_declaration" ? "var" : kindTok >= 0 && t.type[kindTok] === "let" ? "let" : "const";
        const target = kind === "var" ? functionScopeOf(scope) : scope;
        for (const d of namedChildren(t, n)) {
            if (t.type[d] !== "variable_declarator") continue;
            const ty = child(t, d, "type");
            declarePattern(target, child(t, d, "name"), kind, child(t, d, "value"), ty >= 0 ? (namedChildren(t, ty)[0] ?? -1) : -1);
        }
    };
    // Iterative walk; `scopeIndex` holds, per node, the id of the scope it sits in.
    const scopeIndex = new Int32Array(t.count);
    const scopeAt = { get: (n: number): Scope | undefined => all[scopeIndex[n]] };
    const stack: number[] = [0];
    while (stack.length > 0) {
        const n = stack.pop()!;
        const outer = scopeAt.get(n)!;
        const ty = t.type[n];
        let inner = outer;
        switch (ty) {
            case "function_declaration":
            case "generator_function_declaration": {
                const nm = child(t, n, "name");
                if (nm >= 0) declare(outer, nm, "function", VALUE, { decl: n });
                inner = newScope(n, "function", outer);
                typeParams(inner, n);
                params(inner, n);
                break;
            }
            case "function_signature": {
                const nm = child(t, n, "name");
                if (nm >= 0 && !(outer.bindings.get(textOf(t, nm)) ?? []).some((b) => b.kind === "function")) declare(outer, nm, "function", VALUE, { decl: n });
                inner = newScope(n, "type", outer);
                typeParams(inner, n);
                break;
            }
            case "function_expression":
            case "function":
            case "generator_function": {
                inner = newScope(n, "function", outer);
                const nm = child(t, n, "name");
                if (nm >= 0) declare(inner, nm, "function", VALUE, { decl: n });
                typeParams(inner, n);
                params(inner, n);
                break;
            }
            case "arrow_function":
                inner = newScope(n, "arrow", outer);
                typeParams(inner, n);
                params(inner, n);
                break;
            case "method_definition":
            case "method_signature":
            case "abstract_method_signature":
                inner = newScope(n, ty === "method_definition" ? "function" : "type", outer);
                typeParams(inner, n);
                params(inner, n);
                break;
            case "class_declaration":
            case "abstract_class_declaration": {
                const nm = child(t, n, "name");
                if (nm >= 0) declare(outer, nm, "class", VALUE | TYPE, { decl: n });
                inner = newScope(n, "class", outer);
                typeParams(inner, n);
                break;
            }
            case "class": {
                inner = newScope(n, "class", outer);
                const nm = child(t, n, "name");
                if (nm >= 0) declare(inner, nm, "class", VALUE | TYPE, { decl: n });
                typeParams(inner, n);
                break;
            }
            case "interface_declaration":
            case "type_alias_declaration": {
                const nm = child(t, n, "name");
                if (nm >= 0) declare(outer, nm, "type", TYPE, { decl: n });
                inner = newScope(n, "type", outer);
                typeParams(inner, n);
                break;
            }
            case "enum_declaration": {
                const nm = child(t, n, "name");
                if (nm >= 0) declare(outer, nm, "enum", VALUE | TYPE, { decl: n });
                break;
            }
            case "internal_module":
            case "module": {
                const nm = child(t, n, "name");
                if (nm >= 0 && t.type[nm] === "identifier") declare(outer, nm, "namespace", VALUE | TYPE | NS, { decl: n });
                break;
            }
            case "statement_block":
            case "switch_body":
            case "class_static_block": {
                const p = t.parent[n];
                const pt = p >= 0 ? t.type[p] : "";
                // A function's body shares its parameters' scope.
                if (!(t.field[n] === "body" && (pt === "function_declaration" || pt === "function_expression" || pt === "function" || pt === "generator_function" || pt === "generator_function_declaration" || pt === "arrow_function" || pt === "method_definition"))) inner = newScope(n, "block", outer);
                break;
            }
            case "for_statement":
            case "for_in_statement":
                inner = newScope(n, "for", outer);
                if (ty === "for_in_statement") {
                    const kindTok = child(t, n, "kind");
                    if (kindTok >= 0) {
                        const k = t.type[kindTok] === "var" ? "var" : t.type[kindTok] === "let" ? "let" : "const";
                        declarePattern(k === "var" ? functionScopeOf(outer) : inner, child(t, n, "left"), k, -1, -1);
                    }
                }
                break;
            case "catch_clause": {
                inner = newScope(n, "catch", outer);
                const p = child(t, n, "parameter");
                if (p >= 0) declarePattern(inner, p, "catch", -1, -1);
                break;
            }
            case "lexical_declaration":
            case "variable_declaration":
                varDecl(outer, n);
                break;
            case "import_statement":
                declareImport(module, n);
                break;
        }
        for (let c = t.first[n]; c >= 0; c = t.next[c]) {
            scopeIndex[c] = inner.id;
            stack.push(c);
        }
    }
    return { module, all, scopeOfNode, bindingOfName, scopeAt };
};

type Scopes = ReturnType<typeof scopesOf>;

/** Looks a name up from a scope outwards, for a meaning (value, type or namespace). */
export const lookup = (scope: Scope | null, name: string, meaning: number): Binding | null => {
    for (let s = scope; s; s = s.parent) {
        const list = s.bindings.get(name);
        if (!list) continue;
        const b = list.find((x) => x.meaning & meaning);
        if (b) return b;
    }
    return null;
};

/** The module a `require('m')` call names, unless `require` is a local of that name. */
export const requireSpec = (t: Flat, n: number, scope: Scope | null): string | null => {
    n = unwrap(t, n);
    if (n < 0 || t.type[n] !== "call_expression") return null;
    const fn = child(t, n, "function");
    if (fn < 0 || t.type[fn] !== "identifier" || textOf(t, fn) !== "require") return null;
    if (scope && lookup(scope, "require", VALUE)) return null;
    const args = child(t, n, "arguments");
    const first = args >= 0 ? namedChildren(t, args)[0] : undefined;
    return first === undefined ? null : stringValue(t, first);
};

/** Imports, exports and every module specifier. */
const modulesOf = (t: Flat) => {
    const imports: ImportEntry[] = [];
    const exports: ExportEntry[] = [];
    const specifiers: { spec: string; node: number; reexport: boolean }[] = [];
    let moduleExports = -1;
    for (const s of namedChildren(t, 0)) {
        const ty = t.type[s];
        if (ty === "import_statement") {
            const src = child(t, s, "source");
            const spec = stringValue(t, src);
            const typeOnly = children(t, s).some((c) => !t.named[c] && t.type[c] === "type");
            const req = childOfType(t, s, "import_require_clause");
            if (req >= 0) {
                const rs = stringValue(t, child(t, req, "source"));
                const id = childOfType(t, req, "identifier");
                if (rs !== null) {
                    specifiers.push({ spec: rs, node: req, reexport: false });
                    if (id >= 0) imports.push({ local: textOf(t, id), spec: rs, imported: "=", node: id, typeOnly, kind: "import-equals" });
                }
                continue;
            }
            if (spec === null) continue;
            specifiers.push({ spec, node: s, reexport: false });
            const clause = childOfType(t, s, "import_clause");
            if (clause < 0) continue;
            for (const k of namedChildren(t, clause)) {
                if (t.type[k] === "identifier") imports.push({ local: textOf(t, k), spec, imported: "default", node: k, typeOnly, kind: "esm" });
                else if (t.type[k] === "namespace_import") {
                    const id = childOfType(t, k, "identifier");
                    if (id >= 0) imports.push({ local: textOf(t, id), spec, imported: "*", node: id, typeOnly, kind: "esm" });
                } else if (t.type[k] === "named_imports") {
                    for (const sp of namedChildren(t, k)) {
                        if (t.type[sp] !== "import_specifier") continue;
                        const nm = child(t, sp, "name");
                        const alias = child(t, sp, "alias");
                        const specTypeOnly = typeOnly || children(t, sp).some((c) => !t.named[c] && t.type[c] === "type");
                        imports.push({ local: textOf(t, alias >= 0 ? alias : nm), spec, imported: propName(t, nm), node: nm, typeOnly: specTypeOnly, kind: "esm" });
                    }
                }
            }
        } else if (ty === "export_statement") {
            const src = child(t, s, "source");
            const spec = src >= 0 ? stringValue(t, src) : null;
            if (spec !== null) specifiers.push({ spec, node: s, reexport: true });
            const decl = child(t, s, "declaration");
            const value = child(t, s, "value");
            const clause = childOfType(t, s, "export_clause");
            const nsExport = childOfType(t, s, "namespace_export");
            const isDefault = children(t, s).some((c) => !t.named[c] && t.type[c] === "default");
            if (decl >= 0) {
                let d = decl;
                if (t.type[d] === "ambient_declaration") d = namedChildren(t, d)[0] ?? d;
                const dt = t.type[d];
                if (dt === "lexical_declaration" || dt === "variable_declaration") {
                    for (const vd of namedChildren(t, d)) {
                        if (t.type[vd] !== "variable_declarator") continue;
                        const names: number[] = [];
                        const collect = (p: number) => {
                            if (p < 0) return;
                            if (t.type[p] === "identifier" || t.type[p] === "shorthand_property_identifier_pattern") names.push(p);
                            else for (const c of namedChildren(t, p)) if (t.type[c] !== "property_identifier" || t.field[c] !== "key") collect(t.type[c] === "pair_pattern" ? child(t, c, "value") : c);
                        };
                        collect(child(t, vd, "name"));
                        for (const nm of names) exports.push({ kind: "local", name: textOf(t, nm), local: textOf(t, nm), node: s, nameNode: nm });
                    }
                } else {
                    const nm = child(t, d, "name");
                    if (nm >= 0) exports.push({ kind: "local", name: isDefault ? "default" : propName(t, nm), local: propName(t, nm), node: s, nameNode: nm });
                    else if (isDefault) exports.push({ kind: "expr", name: "default", value: d, node: s });
                }
            } else if (value >= 0) {
                exports.push({ kind: "expr", name: "default", value, node: s });
            } else if (clause >= 0) {
                for (const sp of namedChildren(t, clause)) {
                    if (t.type[sp] !== "export_specifier") continue;
                    const nm = child(t, sp, "name");
                    const alias = child(t, sp, "alias");
                    const name = propName(t, alias >= 0 ? alias : nm);
                    if (spec !== null) exports.push({ kind: "reexport", name, spec, imported: propName(t, nm), node: s, nameNode: nm });
                    else exports.push({ kind: "local", name, local: propName(t, nm), node: s, nameNode: nm });
                }
            } else if (nsExport >= 0 && spec !== null) {
                const id = namedChildren(t, nsExport)[0];
                exports.push({ kind: "namespace", name: id !== undefined ? propName(t, id) : "*", spec, node: s });
            } else if (spec !== null) {
                exports.push({ kind: "star", spec, node: s });
            } else if (hasToken(t, s, "=")) {
                const e = namedChildren(t, s).find((c) => t.type[c] !== "decorator");
                if (e !== undefined) moduleExports = e;
            }
        } else if (ty === "expression_statement") {
            const e = namedChildren(t, s)[0];
            if (e === undefined || t.type[e] !== "assignment_expression") continue;
            const lhs = child(t, e, "left");
            const rhs = child(t, e, "right");
            const lt = textOf(t, lhs);
            if (lt === "module.exports") moduleExports = rhs;
            else {
                const m = /^(?:module\.)?exports\.([A-Za-z_$][\w$]*)$/.exec(lt);
                if (m) exports.push({ kind: "expr", name: m[1], value: rhs, node: s });
            }
        }
    }
    // require() and import() anywhere.
    for (let n = 0; n < t.count; n++) {
        if (t.type[n] !== "call_expression") continue;
        const fn = child(t, n, "function");
        if (fn < 0) continue;
        const isImport = t.type[fn] === "import";
        const isRequire = t.type[fn] === "identifier" && textOf(t, fn) === "require";
        if (!isImport && !isRequire) continue;
        const args = child(t, n, "arguments");
        const first = args >= 0 ? namedChildren(t, args)[0] : undefined;
        const spec = first === undefined ? null : stringValue(t, first);
        if (spec !== null) specifiers.push({ spec, node: n, reexport: false });
    }
    return { imports, exports, specifiers, moduleExports };
};

const TYPE_CONTEXT = new Set(["type_query", "nested_type_identifier", "type_annotation", "type_arguments", "implements_clause", "extends_type_clause", "type_predicate", "asserts"]);
const ASSIGN = new Set(["assignment_expression", "augmented_assignment_expression"]);

/** Every identifier that refers to something, and how: a call, a value, a type, a write, an import or an export. */
const sitesOf = (t: Flat, scopes: Scopes, mods: ReturnType<typeof modulesOf>): Site[] => {
    const sites: Site[] = [];
    const importByNode = new Map<number, ImportEntry>();
    for (const i of mods.imports) importByNode.set(i.node, i);
    const exportByName = new Map<number, ExportEntry>();
    for (const e of mods.exports) if (e.kind === "local" || e.kind === "reexport") exportByName.set(e.nameNode, e);
    const scopeOf = (n: number) => scopes.scopeAt.get(n) ?? scopes.module;
    const push = (node: number, name: string, ref: RefKind, form: Site["form"], extra: Partial<Site> = {}) => {
        const start = t.start[node];
        sites.push({ node, start, line: lineOf(t, start), name, ref, form, scope: scopeOf(node), receiver: -1, ...extra });
    };
    /** What a value-position reference is: call, write, JSX tag or plain value. */
    const valueKind = (id: number): RefKind => {
        let e = id;
        const p0 = t.parent[e];
        if (p0 >= 0 && (t.type[p0] === "member_expression" && t.field[e] === "property")) e = p0;
        else if (p0 >= 0 && t.type[p0] === "subscript_expression" && t.field[e] === "index") e = p0;
        while (t.parent[e] >= 0 && (t.type[t.parent[e]] === "parenthesized_expression" || t.type[t.parent[e]] === "non_null_expression" || t.type[t.parent[e]] === "as_expression")) e = t.parent[e];
        const p = t.parent[e];
        if (p < 0) return "value";
        const pt = t.type[p];
        if (pt === "call_expression" && t.field[e] === "function") return "call";
        if (pt === "new_expression" && t.field[e] === "constructor") return "call";
        if (pt === "decorator") return "call";
        if ((pt === "jsx_opening_element" || pt === "jsx_self_closing_element" || pt === "jsx_closing_element") && t.field[e] === "name") return "jsx";
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
                if (requireSpec(t, child(t, a, "value"), null) !== null && nm >= 0 && t.type[nm] !== "identifier") return "import";
                break;
            }
            if (at === "statement_block" || at === "program") break;
        }
        for (let a = t.parent[id]; a > 0; a = t.parent[a]) {
            const at = t.type[a];
            if (at === "extends_clause") return t.field[id] === "value" || t.parent[id] === a ? "extends" : "type";
            if (at === "class_heritage") return "extends";
            if (TYPE_CONTEXT.has(at)) return "type";
            if (at.endsWith("_statement") || at === "statement_block" || at === "arguments" || at === "call_expression" || at === "new_expression" || at === "arrow_function" || at === "pair" || at === "variable_declarator" || at === "assignment_expression" || at === "class_body" || at === "formal_parameters" || at === "binary_expression" || at === "ternary_expression" || at === "member_expression" && TYPE_CONTEXT.has(t.type[t.parent[a]] ?? "") === false) break;
        }
        return null;
    };
    for (let n = 1; n < t.count; n++) {
        const ty = t.type[n];
        if (ty === "identifier") {
            const p = t.parent[n];
            const pt = t.type[p];
            const name = textOf(t, n);
            // Import specifiers: the imported name is a reference to the other module's export.
            if (pt === "import_specifier") {
                if (t.field[n] === "name") {
                    const entry = importByNode.get(n);
                    if (entry) push(n, entry.imported, "import", "import", { importEntry: entry });
                }
                continue;
            }
            if (pt === "import_clause") {
                const entry = importByNode.get(n);
                if (entry) push(n, name, "import", "import", { importEntry: entry });
                continue;
            }
            if (pt === "namespace_import" || pt === "import_require_clause" || pt === "namespace_export") continue;
            if (pt === "export_specifier") {
                if (t.field[n] === "name") {
                    const e = exportByName.get(n);
                    if (e) push(n, name, e.kind === "reexport" ? "import" : "export", "export", { exportEntry: e });
                }
                continue;
            }
            const b = scopes.bindingOfName.get(n);
            if (b) {
                // A destructured require: `const { a: x } = require('m')` names m's export a.
                if (b.path && b.path.length > 0) {
                    const vd = enclosingDeclarator(t, n);
                    if (vd >= 0 && requireSpec(t, child(t, vd, "value"), null) !== null) {
                        const keyNode = t.type[p] === "pair_pattern" ? child(t, p, "key") : n;
                        push(keyNode, b.path[b.path.length - 1], "import", "require", { keyPath: b.path });
                    }
                }
                continue;
            }
            if ((pt === "jsx_opening_element" || pt === "jsx_self_closing_element" || pt === "jsx_closing_element") && /^[a-z]/.test(name)) continue;
            if (pt === "nested_identifier" || pt === "internal_module" || pt === "module") continue;
            if (pt === "nested_type_identifier" && t.field[n] === "module") {
                push(n, name, "type", "bare");
                continue;
            }
            const ctx = contextKind(n);
            push(n, name, ctx ?? valueKind(n), "bare");
        } else if (ty === "type_identifier") {
            if (scopes.bindingOfName.has(n)) continue;
            const p = t.parent[n];
            if (t.type[p] === "nested_type_identifier") {
                if (t.field[n] === "name") push(n, textOf(t, n), contextKind(n) === "import" ? "import" : "type", "member", { receiver: child(t, p, "module") });
                continue;
            }
            const ctx = contextKind(n);
            push(n, textOf(t, n), ctx === "import" || ctx === "export" || ctx === "extends" ? ctx : "type", "bare");
        } else if (ty === "shorthand_property_identifier") {
            push(n, textOf(t, n), contextKind(n) ?? "value", "bare");
        } else if (ty === "shorthand_property_identifier_pattern") {
            if (scopes.bindingOfName.has(n)) {
                const vd = enclosingDeclarator(t, n);
                const b = scopes.bindingOfName.get(n)!;
                if (vd >= 0 && b.path && requireSpec(t, child(t, vd, "value"), null) !== null) push(n, textOf(t, n), "import", "require", { keyPath: b.path });
                continue;
            }
            push(n, textOf(t, n), "write", "bare");
        } else if (ty === "property_identifier" || ty === "private_property_identifier") {
            const p = t.parent[n];
            if (t.type[p] === "member_expression" && t.field[n] === "property") {
                const obj = child(t, p, "object");
                const ctx = contextKind(n);
                push(n, textOf(t, n), ctx === "type" ? "type" : ctx === "import" || ctx === "export" ? ctx : valueKind(n), "member", { receiver: obj });
            }
        } else if (ty === "string" && t.type[t.parent[n]] === "subscript_expression" && t.field[n] === "index") {
            const p = t.parent[n];
            const name = propName(t, n);
            if (/^[A-Za-z_$#][\w$]*$/.test(name)) push(n, name, valueKind(n), "member", { receiver: child(t, p, "object"), start: t.start[n] + 1 });
        }
    }
    return sites;
};

const enclosingDeclarator = (t: Flat, n: number): number => {
    for (let a = t.parent[n]; a >= 0; a = t.parent[a]) {
        const at = t.type[a];
        if (at === "variable_declarator") return a;
        if (at !== "object_pattern" && at !== "pair_pattern" && at !== "array_pattern" && at !== "shorthand_property_identifier_pattern" && at !== "object_assignment_pattern" && at !== "assignment_pattern" && at !== "rest_pattern") return -1;
    }
    return -1;
};

/** Classes, constructor functions, object literals, interfaces and namespaces with their members. */
const shapesOf = (f: FileFacts, units: Unit[]) => {
    const t = f.flat;
    const unitByValue = new Map<number, Unit>();
    const unitByNode = new Map<number, Unit>();
    for (const u of units) {
        unitByNode.set(u.node, u);
        if (u.valueNode >= 0) unitByValue.set(u.valueNode, u);
    }
    const memberUnit = (node: number, valueNode: number) => unitByNode.get(node) ?? (valueNode >= 0 ? unitByValue.get(valueNode) : undefined);
    const shapeId = (n: number) => `${f.path}#${t.start[n]}`;
    // Classes (declarations and expressions, anywhere), interfaces, object literals at module level.
    for (let n = 0; n < t.count; n++) {
        const ty = t.type[n];
        if (ty === "class_declaration" || ty === "abstract_class_declaration" || ty === "class") {
            const nm = child(t, n, "name");
            const shape: Shape = { id: shapeId(n), path: f.path, name: nm >= 0 ? textOf(t, nm) : "default", kind: "class", node: n, members: [], heritage: [], unit: unitByNode.get(n) ?? unitByValue.get(n), open: false };
            const heritage = childOfType(t, n, "class_heritage");
            if (heritage >= 0) {
                for (const h of namedChildren(t, heritage)) {
                    if (t.type[h] === "extends_clause") {
                        const v = child(t, h, "value");
                        if (v >= 0) shape.heritage.push(v);
                    } else if (t.type[h] !== "implements_clause") shape.heritage.push(h);
                }
            }
            const body = child(t, n, "body");
            if (body >= 0) {
                for (const m of namedChildren(t, body)) {
                    const mt = t.type[m];
                    const isStatic = hasToken(t, m, "static");
                    if (mt === "method_definition" || mt === "method_signature" || mt === "abstract_method_signature") {
                        const nm2 = child(t, m, "name");
                        const name = propName(t, nm2);
                        const kind = hasToken(t, m, "get") ? "get" : hasToken(t, m, "set") ? "set" : mt === "method_definition" ? "method" : "signature";
                        shape.members.push({ name, static: isStatic, kind, node: m, nameStart: t.start[nm2], unit: memberUnit(m, m), value: m, typeNode: -1 });
                        if (name === "constructor" && mt === "method_definition") {
                            const ps = child(t, m, "parameters");
                            for (const p of ps >= 0 ? namedChildren(t, ps) : []) {
                                if ((t.type[p] === "required_parameter" || t.type[p] === "optional_parameter") && (childOfType(t, p, "accessibility_modifier") >= 0 || hasToken(t, p, "readonly"))) {
                                    const pat = child(t, p, "pattern");
                                    const typ = child(t, p, "type");
                                    if (pat >= 0 && t.type[pat] === "identifier") shape.members.push({ name: textOf(t, pat), static: false, kind: "param", node: p, nameStart: t.start[pat], value: -1, typeNode: typ >= 0 ? (namedChildren(t, typ)[0] ?? -1) : -1 });
                                }
                            }
                        }
                    } else if (mt === "public_field_definition" || mt === "field_definition") {
                        const nm2 = child(t, m, mt === "field_definition" ? "property" : "name");
                        const v = child(t, m, "value");
                        const typ = child(t, m, "type");
                        shape.members.push({ name: propName(t, nm2), static: isStatic, kind: "field", node: m, nameStart: t.start[nm2], unit: memberUnit(m, unwrap(t, v)), value: v, typeNode: typ >= 0 ? (namedChildren(t, typ)[0] ?? -1) : -1 });
                    }
                }
                // `this.x = v` anywhere in the class's own methods and field initializers.
                collectThisAssignments(t, body, shape, false);
            }
            f.shapes.set(n, shape);
        } else if (ty === "interface_declaration") {
            const nm = child(t, n, "name");
            const shape: Shape = { id: shapeId(n), path: f.path, name: textOf(t, nm), kind: "interface", node: n, members: [], heritage: [], unit: unitByNode.get(n), open: false };
            const ext = childOfType(t, n, "extends_type_clause");
            if (ext >= 0) shape.heritage.push(...namedChildren(t, ext));
            const body = child(t, n, "body");
            if (body >= 0) addTypeMembers(t, body, shape);
            f.shapes.set(n, shape);
        } else if (ty === "object_type") {
            const shape: Shape = { id: shapeId(n), path: f.path, name: "{}", kind: "interface", node: n, members: [], heritage: [], open: false };
            addTypeMembers(t, n, shape);
            f.shapes.set(n, shape);
        } else if (ty === "object") {
            const shape: Shape = { id: shapeId(n), path: f.path, name: "{}", kind: "object", node: n, members: [], heritage: [], unit: unitByValue.get(n), open: false };
            for (const p of namedChildren(t, n)) {
                const pt = t.type[p];
                if (pt === "method_definition") {
                    const nm = child(t, p, "name");
                    const kind = hasToken(t, p, "get") ? "get" : hasToken(t, p, "set") ? "set" : "method";
                    shape.members.push({ name: propName(t, nm), static: false, kind, node: p, nameStart: t.start[nm], unit: memberUnit(p, p), value: p, typeNode: -1 });
                } else if (pt === "pair") {
                    const k = child(t, p, "key");
                    if (t.type[k] === "computed_property_name") {
                        shape.open = true;
                        continue;
                    }
                    const v = child(t, p, "value");
                    shape.members.push({ name: propName(t, k), static: false, kind: "pair", node: p, nameStart: t.start[k], unit: memberUnit(p, unwrap(t, v)), value: v, typeNode: -1 });
                } else if (pt === "shorthand_property_identifier") {
                    shape.members.push({ name: textOf(t, p), static: false, kind: "shorthand", node: p, nameStart: t.start[p], value: p, typeNode: -1 });
                } else if (pt === "spread_element") shape.open = true;
            }
            f.shapes.set(n, shape);
        } else if (ty === "internal_module" || ty === "module") {
            const nm = child(t, n, "name");
            f.shapes.set(n, { id: shapeId(n), path: f.path, name: propName(t, nm), kind: "namespace", node: n, members: [], heritage: [], unit: unitByNode.get(n), open: false });
        }
    }
    // Constructor functions and prototype objects: `X.prototype.y = v`, `P.y = v` (P = X.prototype), `X.y = v`, `this.y = v` in X.
    const prototypeOf = (e: number): string | null => {
        e = unwrap(t, e);
        if (e < 0) return null;
        if (t.type[e] === "assignment_expression") return prototypeOf(child(t, e, "left"));
        if (t.type[e] === "member_expression" && propName(t, child(t, e, "property")) === "prototype") {
            const o = unwrap(t, child(t, e, "object"));
            if (t.type[o] === "identifier") return textOf(t, o);
        }
        return null;
    };
    for (const s of namedChildren(t, 0)) {
        if (t.type[s] === "lexical_declaration" || t.type[s] === "variable_declaration") {
            for (const d of namedChildren(t, s)) {
                if (t.type[d] !== "variable_declarator") continue;
                const nm = child(t, d, "name");
                const owner = prototypeOf(child(t, d, "value"));
                if (owner && nm >= 0 && t.type[nm] === "identifier") f.protoAliases.set(textOf(t, nm), owner);
            }
        }
    }
    const unitAt = (stmt: number, rhs: number) => unitByNode.get(stmt) ?? unitByValue.get(unwrap(t, rhs));
    const visitAssignments = (container: number) => {
        for (const s of namedChildren(t, container)) {
            if (t.type[s] !== "expression_statement") continue;
            const e = namedChildren(t, s)[0];
            // Object.assign(X, { a, b: v }): static members of X.
            if (e !== undefined && t.type[e] === "call_expression" && /^Object(\.a|A)ssign$/.test(textOf(t, child(t, e, "function")))) {
                const args = namedChildren(t, child(t, e, "arguments"));
                const target = args[0] !== undefined ? unwrap(t, args[0]) : -1;
                if (target < 0 || t.type[target] !== "identifier") continue;
                for (const a of args.slice(1)) {
                    const obj = unwrap(t, a);
                    if (t.type[obj] !== "object") continue;
                    for (const p of namedChildren(t, obj)) {
                        if (t.type[p] === "shorthand_property_identifier") f.assignments.push({ owner: textOf(t, target), proto: false, name: textOf(t, p), node: s, nameStart: t.start[p], value: p });
                        else if (t.type[p] === "pair" && t.type[child(t, p, "key")] !== "computed_property_name") {
                            const k = child(t, p, "key");
                            f.assignments.push({ owner: textOf(t, target), proto: false, name: propName(t, k), node: s, nameStart: t.start[k], value: child(t, p, "value") });
                        }
                    }
                }
                continue;
            }
            if (e === undefined || t.type[e] !== "assignment_expression") continue;
            const lhs = child(t, e, "left");
            const rhs = child(t, e, "right");
            if (t.type[lhs] !== "member_expression") continue;
            const prop = child(t, lhs, "property");
            const name = propName(t, prop);
            const obj = unwrap(t, child(t, lhs, "object"));
            if (t.type[obj] === "identifier") {
                const on = textOf(t, obj);
                if (name === "prototype") {
                    // `X.prototype = {...}`: the object's members join X's instance side.
                    const o = objectOf(t, rhs);
                    if (o >= 0) f.assignments.push({ owner: on, proto: true, name: "*", node: s, nameStart: t.start[prop], value: o });
                    continue;
                }
                const alias = f.protoAliases.get(on);
                if (alias) f.assignments.push({ owner: alias, proto: true, name, node: s, nameStart: t.start[prop], value: rhs, unit: unitAt(s, rhs) });
                else f.assignments.push({ owner: on, proto: false, name, node: s, nameStart: t.start[prop], value: rhs, unit: unitAt(s, rhs) });
            } else if (t.type[obj] === "member_expression" && propName(t, child(t, obj, "property")) === "prototype") {
                const o = unwrap(t, child(t, obj, "object"));
                if (t.type[o] === "identifier") f.assignments.push({ owner: textOf(t, o), proto: true, name, node: s, nameStart: t.start[prop], value: rhs, unit: unitAt(s, rhs) });
            }
        }
    };
    visitAssignments(0);
    // Function declarations and function-valued consts at module level are constructor candidates.
    for (const u of units) {
        if (u.parent || u.kind !== "function") continue;
        const fnNode = u.valueNode;
        if (fnNode < 0) continue;
        const shape: Shape = { id: shapeId(fnNode), path: f.path, name: u.name, kind: "function", node: fnNode, members: [], heritage: [], unit: u, open: false };
        const body = child(t, fnNode, "body");
        if (body >= 0) collectThisAssignments(t, body, shape, true);
        f.shapes.set(fnNode, shape);
    }
};

/** Members a type literal or interface body declares. */
const addTypeMembers = (t: Flat, body: number, shape: Shape) => {
    for (const m of namedChildren(t, body)) {
        const mt = t.type[m];
        if (mt === "property_signature" || mt === "method_signature") {
            const nm = child(t, m, "name");
            const typ = child(t, m, "type");
            shape.members.push({ name: propName(t, nm), static: false, kind: mt === "method_signature" ? "signature" : "field", node: m, nameStart: t.start[nm], value: -1, typeNode: typ >= 0 ? (namedChildren(t, typ)[0] ?? -1) : -1 });
        } else if (mt === "index_signature") shape.open = true;
    }
};

const CONDITIONAL = new Set(["if_statement", "else_clause", "ternary_expression", "switch_case", "switch_default", "catch_clause", "for_statement", "for_in_statement", "while_statement", "do_statement"]);

/** `this.x = v` in a class's methods (or a constructor function's body), not inside nested non-arrow functions. */
const collectThisAssignments = (t: Flat, root: number, shape: Shape, isFunction: boolean) => {
    const stack = [root];
    while (stack.length > 0) {
        const n = stack.pop()!;
        const ty = t.type[n];
        if (n !== root && (ty === "function_expression" || ty === "function_declaration" || ty === "generator_function" || ty === "generator_function_declaration" || ty === "class" || ty === "class_declaration" || ty === "function")) continue;
        if (isFunction && n !== root && ty === "method_definition") continue;
        if (ty === "assignment_expression") {
            const lhs = child(t, n, "left");
            if (t.type[lhs] === "member_expression" && t.type[child(t, lhs, "object")] === "this") {
                const prop = child(t, lhs, "property");
                const name = propName(t, prop);
                // Inside a static method, `this` is the class itself. Under a branch, the member is only sometimes set.
                let isStatic = false;
                let conditional = false;
                for (let a = t.parent[n]; a >= 0 && a !== root; a = t.parent[a]) {
                    const at = t.type[a];
                    if (at === "method_definition") {
                        isStatic = hasToken(t, a, "static");
                        break;
                    }
                    if (CONDITIONAL.has(at) || (at === "binary_expression" && /^(&&|\|\||\?\?)$/.test(tokensOf(t, a)[0] ?? ""))) conditional = true;
                }
                if (!shape.members.some((m) => m.name === name && m.kind === "this" && m.value === child(t, n, "right"))) shape.members.push({ name, static: isStatic, kind: "this", node: n, nameStart: t.start[prop], value: child(t, n, "right"), typeNode: -1, ...(conditional ? { conditional } : {}) });
            }
        }
        for (let c = t.first[n]; c >= 0; c = t.next[c]) stack.push(c);
    }
};


/** A file's facts, or null when the parser doesn't read it: no grammar for it, `@flow`, or too many errors. */
export const parseFacts = (syntax: Syntax, path: string, text: string): FileFacts | null => {
    const flat = syntax.parse(path, text);
    return flat ? analyzeFile(path, flat) : null;
};
