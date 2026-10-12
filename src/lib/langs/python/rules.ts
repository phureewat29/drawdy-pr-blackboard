/**
 * Python's rule table: tree-sitter-python 0.25.0's nodes, its own
 * `tags.scm` for the units, and Python's scoping: functions, lambdas and
 * comprehensions open scopes, a class body's names are seen only by the code
 * right in it and below their definitions (a deferred annotation of its own
 * sees them all), `global` and `nonlocal` redirect a name, and PEP 695's type
 * parameters are the annotations' own. An attribute written to is no use of
 * it. `@overload` signatures and a property's setter and deleter join one
 * card. An absolute import that may run after its file changes `sys.path`
 * (below the first change, or in a function) names nothing.
 */

import type { Emit, GImport, LangRules, Role } from "../../anyfacts.ts";
import { labelOf } from "../../symbols.ts";
import { child, namedChildren, perTree, textOf, type Flat } from "../../syntax.ts";
import { annotationName, classOfMethod, decorators, inClassBody, isOverload, PATTERNS, targets } from "./nodes.ts";
import { firstPathChange } from "./sys-path.ts";

const COMPREHENSIONS = new Set(["list_comprehension", "set_comprehension", "dictionary_comprehension", "generator_expression"]);

/**
 * Where the code of a class body first sees a name a statement in it binds:
 * the body runs in order, so above the statement (and in its bases) the name
 * is the one outside. Undefined for a statement anywhere else.
 */
const seenInClassFrom = (t: Flat, n: number): number | undefined => {
    let stmt = n;
    if (t.parent[stmt] >= 0 && (t.type[t.parent[stmt]] === "decorated_definition" || t.type[t.parent[stmt]] === "expression_statement")) stmt = t.parent[stmt];
    return inClassBody(t, stmt) ? t.end[stmt] : undefined;
};

/** Decorators that make a method a property. */
const PROPERTIES: ReadonlySet<string> = new Set(["property", "cached_property", "functools.cached_property"]);

/** A parameter's name token and its annotation. */
const paramOf = (t: Flat, p: number): { name: number; type: number } | null => {
    const ty = t.type[p];
    if (ty === "identifier") return { name: p, type: -1 };
    if (ty === "default_parameter" || ty === "typed_default_parameter") return { name: child(t, p, "name"), type: child(t, p, "type") };
    if (ty === "typed_parameter") {
        const id = namedChildren(t, p).find((c) => t.type[c] === "identifier" || t.type[c] === "list_splat_pattern" || t.type[c] === "dictionary_splat_pattern");
        if (id === undefined) return null;
        const name = t.type[id] === "identifier" ? id : (namedChildren(t, id)[0] ?? -1);
        return name >= 0 ? { name, type: t.type[id] === "identifier" ? child(t, p, "type") : -1 } : null;
    }
    if (ty === "list_splat_pattern" || ty === "dictionary_splat_pattern") {
        const id = namedChildren(t, p)[0];
        return id !== undefined ? { name: id, type: -1 } : null;
    }
    return null;
};

const importsOf = (t: Flat): GImport[] => {
    const out: GImport[] = [];
    const ids = (n: number) => namedChildren(t, n).filter((c) => t.type[c] === "identifier");
    const flat = (n: number) => textOf(t, n).replace(/\s+/g, "");
    for (let n = 0; n < t.count; n++) {
        const ty = t.type[n];
        if (ty === "import_statement") {
            for (const c of namedChildren(t, n)) {
                if (t.type[c] === "dotted_name") {
                    // `import a.b.c` binds `a`, the package.
                    const first = ids(c)[0];
                    if (first !== undefined) out.push({ local: textOf(t, first), spec: textOf(t, first), level: 0, name: null, node: -1, bind: first, stmt: n });
                } else if (t.type[c] === "aliased_import") {
                    const alias = child(t, c, "alias");
                    out.push({ local: textOf(t, alias), spec: flat(child(t, c, "name")), level: 0, name: null, node: -1, bind: alias, stmt: n });
                }
            }
        } else if (ty === "import_from_statement") {
            const mod = child(t, n, "module_name");
            let spec = "";
            let level = 0;
            if (mod >= 0 && t.type[mod] === "relative_import") {
                const prefix = namedChildren(t, mod).find((c) => t.type[c] === "import_prefix");
                level = prefix !== undefined ? textOf(t, prefix).length : 0;
                const d = namedChildren(t, mod).find((c) => t.type[c] === "dotted_name");
                spec = d !== undefined ? flat(d) : "";
            } else if (mod >= 0) spec = flat(mod);
            for (const c of namedChildren(t, n)) {
                if (c === mod) continue;
                if (t.type[c] === "wildcard_import") out.push({ local: "", spec, level, name: "*", node: c, bind: -1, stmt: n });
                else if (t.type[c] === "dotted_name") {
                    const last = ids(c).pop();
                    if (last !== undefined) out.push({ local: textOf(t, last), spec, level, name: flat(c), node: last, bind: last, stmt: n });
                } else if (t.type[c] === "aliased_import") {
                    const last = ids(child(t, c, "name")).pop();
                    const alias = child(t, c, "alias");
                    if (last !== undefined) out.push({ local: textOf(t, alias), spec, level, name: flat(child(t, c, "name")), node: last, bind: alias, stmt: n });
                }
            }
        }
    }
    // Where the file changes `sys.path`: an absolute import runs before that only at module level above the first change (a function can't run before it's defined).
    const first = firstPathChange(t);
    if (first >= 0) for (const i of out) if (i.level === 0 && (t.start[i.stmt] > first || inFunction(t, i.stmt))) i.unproven = true;
    return out;
};

/** Whether a node is inside a function or a lambda, whose code runs when called. */
const inFunction = (t: Flat, n: number): boolean => {
    for (let x = t.parent[n]; x >= 0; x = t.parent[x]) if (t.type[x] === "function_definition" || t.type[x] === "lambda") return true;
    return false;
};

const imports = perTree(importsOf);

const binds = (t: Flat, n: number, emit: Emit) => {
    switch (t.type[n]) {
        case "function_definition": {
            emit(child(t, n, "name"), "def", { unitNode: n, from: seenInClassFrom(t, n) });
            const cls = classOfMethod(t, n);
            const decos = decorators(t, n);
            let first = true;
            for (const p of namedChildren(t, child(t, n, "parameters"))) {
                const x = paramOf(t, p);
                if (!x || x.name < 0) continue;
                if (first && cls >= 0 && !decos.includes("staticmethod") && t.type[p] === "identifier") emit(x.name, decos.includes("classmethod") ? "selfclass" : "self");
                else emit(x.name, "param", { typeNode: x.type });
                first = false;
            }
            return;
        }
        case "lambda":
            for (const p of namedChildren(t, child(t, n, "parameters"))) {
                const x = paramOf(t, p);
                if (x && x.name >= 0) emit(x.name, "param");
            }
            return;
        case "class_definition":
            emit(child(t, n, "name"), "type", { unitNode: n, from: seenInClassFrom(t, n) });
            return;
        case "type_alias_statement":
            emit(aliasName(t, n), "type", { unitNode: n });
            return;
        case "assignment": {
            const left = child(t, n, "left");
            const ids = targets(t, left);
            const single = ids.length === 1 && ids[0] === left;
            // A module-level `X = ...` is a unit (`tags.scm`'s definition.constant): its binding names it.
            const atModule = t.parent[n] >= 0 && t.type[t.parent[n]] === "expression_statement" && t.parent[t.parent[n]] === 0;
            const from = seenInClassFrom(t, n);
            for (const id of ids) emit(id, "local", single ? { init: child(t, n, "right"), typeNode: child(t, n, "type"), ...(atModule ? { unitNode: n } : {}), from } : { from });
            return;
        }
        case "augmented_assignment":
            for (const id of targets(t, child(t, n, "left"))) emit(id, "local");
            return;
        case "for_statement":
        case "for_in_clause":
            for (const id of targets(t, child(t, n, "left"))) emit(id, "local");
            return;
        case "as_pattern": {
            const alias = child(t, n, "alias");
            for (const id of targets(t, alias >= 0 && t.type[alias] === "as_pattern_target" ? alias : -1)) emit(id, "local");
            if (alias >= 0 && t.type[alias] === "identifier") emit(alias, "local");
            return;
        }
        case "named_expression":
            emit(child(t, n, "name"), "local", { to: "function" });
            return;
        case "global_statement":
            for (const id of namedChildren(t, n)) if (t.type[id] === "identifier") emit(id, "global");
            return;
        case "nonlocal_statement":
            for (const id of namedChildren(t, n)) if (t.type[id] === "identifier") emit(id, "nonlocal");
            return;
        case "case_pattern":
            // `case x:` captures; `case Color.RED:` and `case Point(x=0):` bind nothing they name.
            for (const c of namedChildren(t, n)) {
                if (t.type[c] !== "dotted_name") continue;
                const ids = namedChildren(t, c);
                if (ids.length === 1 && t.type[ids[0]] === "identifier") emit(ids[0], "local");
            }
            return;
        // `def f[T, *Ts, **P]`, `class Box[T: int]`: PEP 695's type parameters, not `list[T]`'s arguments.
        case "type_parameter":
            if (t.field[n] === "type_parameters") for (const c of namedChildren(t, n)) for (const id of typeParameterNames(t, c)) emit(id, "param");
            return;
        case "import_statement":
        case "import_from_statement":
            for (const i of imports(t)) if (i.stmt === n && i.bind >= 0) emit(i.bind, "import", { import: i });
            return;
    }
};

/** The name a `type X = ...` statement declares. */
const aliasName = (t: Flat, n: number): number => namedChildren(t, child(t, n, "left"))[0] ?? -1;

/** The name a declared type parameter binds: `T`, `T: int`, `*Ts`, `**P`. */
const typeParameterNames = (t: Flat, n: number): number[] => {
    if (n < 0) return [];
    if (t.type[n] === "identifier") return [n];
    if (t.type[n] === "type" || t.type[n] === "splat_type" || t.type[n] === "constrained_type") return typeParameterNames(t, namedChildren(t, n)[0] ?? -1);
    return [];
};

/** Whether a node is written to: an assignment's target, through tuples and lists, or what `del` deletes. */
const written = (t: Flat, n: number): boolean => {
    let x = n;
    while (t.parent[x] >= 0 && PATTERNS.has(t.type[t.parent[x]])) x = t.parent[x];
    const p = t.parent[x];
    if (p < 0) return false;
    if ((t.type[p] === "assignment" || t.type[p] === "augmented_assignment" || t.type[p] === "for_statement") && t.field[x] === "left") return true;
    return t.type[p] === "delete_statement";
};

const role = (t: Flat, n: number): Role => {
    if (t.type[n] === "string_content") return annotationName(t, n) ? { kind: "bare", expr: n } : { kind: "skip" };
    const p = t.parent[n];
    if (p < 0) return { kind: "bare", expr: n };
    const pt = t.type[p];
    const f = t.field[n];
    // `a.run = f` and `del a.run` write the attribute: no use of what it held.
    if (pt === "attribute" && f === "attribute") return written(t, p) ? { kind: "skip" } : { kind: "member", receiver: child(t, p, "object"), expr: p };
    if (pt === "keyword_argument" && f === "name") return { kind: "skip" };
    if (pt === "dotted_name" || pt === "relative_import" || pt === "aliased_import" || pt === "import_prefix") return { kind: "skip" };
    if (pt === "global_statement" || pt === "nonlocal_statement") return { kind: "skip" };
    if ((pt === "function_definition" || pt === "class_definition") && f === "name") return { kind: "decl" };
    return { kind: "bare", expr: n };
};

const isCallee = (t: Flat, e: number) => {
    const p = t.parent[e];
    return p >= 0 && t.type[p] === "call" && t.field[e] === "function";
};

const isType = (t: Flat, n: number) => {
    for (let x = t.parent[n], k = 0; x >= 0 && k < 8; x = t.parent[x], k++) {
        if (t.type[x] === "type") return true;
        if (t.type[x] === "block" || t.type[x] === "call") return false;
    }
    return false;
};

/** The units `tags.scm` defines: classes, functions (methods inside classes), and module-level constants. */
const unit: LangRules["unit"] = (t, capture, node) => {
    const outerOf = (n: number) => (t.parent[n] >= 0 && t.type[t.parent[n]] === "decorated_definition" ? t.parent[n] : n);
    if (capture === "definition.class" && t.type[node] === "class_definition") return { kind: "class", nameNode: child(t, node, "name"), outer: outerOf(node) };
    if (capture === "definition.function" && t.type[node] === "function_definition") return { kind: "function", nameNode: child(t, node, "name"), outer: outerOf(node) };
    if (capture === "definition.constant" && t.type[node] === "assignment") {
        const left = child(t, node, "left");
        if (left < 0 || t.type[left] !== "identifier") return null;
        return { kind: "value", nameNode: left, outer: t.parent[node] };
    }
    return null;
};

export const PYTHON: LangRules = {
    unit,
    // `type X = ...` (PEP 695) declares a type, though `tags.scm` predates it.
    extraUnits: (t) => {
        const out: { kind: "type"; nameNode: number; outer: number; node: number }[] = [];
        for (let n = 0; n < t.count; n++) if (t.type[n] === "type_alias_statement" && aliasName(t, n) >= 0) out.push({ kind: "type", nameNode: aliasName(t, n), outer: n, node: n });
        return out;
    },
    // An `@overload` signature joins the definitions after it; a property's setter and deleter join its getter.
    continues: (t, previous, node) => {
        if (t.type[previous] !== "function_definition" || t.type[node] !== "function_definition") return false;
        const name = textOf(t, child(t, node, "name"));
        return isOverload(t, previous) || decorators(t, node).some((d) => d === `${name}.setter` || d === `${name}.deleter`);
    },
    // A property reads as a value, so its card drops the `()`: `Dependant.is_gen_callable`.
    label: (t, u, parent) => {
        const label = labelOf({ name: u.name, kind: u.kind, ...(parent ? { parent: parent.name } : {}) }, "py");
        return u.kind === "method" && decorators(t, u.node).some((d) => PROPERTIES.has(d)) ? label.replace(/\(\)$/, "") : label;
    },
    scope: (t, n) => {
        const ty = t.type[n];
        if (ty === "function_definition" || ty === "lambda") return "function";
        if (ty === "class_definition") return "class";
        if (COMPREHENSIONS.has(ty) || (ty === "type_alias_statement" && child(t, n, "type_parameters") >= 0)) return "block";
        return null;
    },
    // A default value is read where the function is defined, and so is an annotation, but where the function declares type parameters (PEP 695), which annotations see.
    outside: (t, n) => {
        const f = t.field[n];
        const p = t.type[t.parent[n]];
        if ((p === "default_parameter" || p === "typed_default_parameter") && f === "value") return true;
        const annotation = ((p === "typed_parameter" || p === "typed_default_parameter") && f === "type") || (p === "function_definition" && f === "return_type");
        if (!annotation) return false;
        const fn = p === "function_definition" ? t.parent[n] : t.parent[t.parent[t.parent[n]]];
        return !(fn >= 0 && t.type[fn] === "function_definition" && child(t, fn, "type_parameters") >= 0);
    },
    binds,
    identifiers: new Set(["identifier", "string_content"]),
    role,
    isCallee,
    isType,
    imports,
    classOf: (t, n) => {
        if (t.type[n] !== "class_definition") return null;
        const sup = child(t, n, "superclasses");
        // `Base[T]` derives from Base; `object` adds nothing.
        const bases = sup >= 0 ? namedChildren(t, sup).filter((c) => t.type[c] !== "keyword_argument" && textOf(t, c) !== "object") : [];
        return { bases: bases.map((b) => (t.type[b] === "subscript" ? child(t, b, "value") : b)) };
    },
};
