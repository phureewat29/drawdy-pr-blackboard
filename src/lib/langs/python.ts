/**
 * Python's rule table: tree-sitter-python 0.25.0's nodes, its own
 * `tags.scm` for the units, and Python's scoping: functions, lambdas and
 * comprehensions open scopes, a class body's names are seen only by the code
 * right in it and below their definitions (a deferred annotation of its own
 * sees them all), `global` and `nonlocal` redirect a name, and PEP 695's type
 * parameters are the annotations' own. `self` and
 * `super()` mean the class a method is written in, none for a class inside a
 * function; an attribute written to is no use of it. A class's attributes
 * are what its body binds, through its bases in C3 order; `@overload`
 * signatures and a property's setter and deleter join one card. A module is
 * a file (`a/b.py` or `a/b/__init__.py`) under the one root Python searches
 * that holds it, never a standard-library one, and none in a file that
 * changes `sys.path`; `from m import *` takes `__all__`'s names.
 */

import type { Emit, GImport, LangRules, Role } from "../anyfacts.ts";
import type { Field, Hint, ModuleContext, ModuleTry, Resolver, Typing, TypeName } from "../anylink.ts";
import { labelOf } from "../symbols.ts";
import { child, namedChildren, textOf, type Flat } from "../syntax.ts";

const COMPREHENSIONS = new Set(["list_comprehension", "set_comprehension", "dictionary_comprehension", "generator_expression"]);
const PATTERNS = new Set(["pattern_list", "tuple_pattern", "list_pattern", "tuple", "list", "parenthesized_expression", "list_splat_pattern", "list_splat", "as_pattern_target", "expression_list"]);

/** Every name a target binds: `a`, `a, (b, *c)`, but not `x.y` or `x[i]`. */
const targets = (t: Flat, n: number, out: number[] = []): number[] => {
    if (n < 0) return out;
    const ty = t.type[n];
    if (ty === "identifier") out.push(n);
    else if (PATTERNS.has(ty)) for (const c of namedChildren(t, n)) targets(t, c, out);
    return out;
};

/** Every attribute a target sets: `x.y`, `a, x.y = ...`. */
const attributeTargets = (t: Flat, n: number, out: number[] = []): number[] => {
    if (n < 0) return out;
    if (t.type[n] === "attribute") out.push(n);
    else if (PATTERNS.has(t.type[n])) for (const c of namedChildren(t, n)) attributeTargets(t, c, out);
    return out;
};

/** The class a function definition sits in directly, through decorators. */
const classOfMethod = (t: Flat, fn: number): number => {
    let p = t.parent[fn];
    if (p >= 0 && t.type[p] === "decorated_definition") p = t.parent[p];
    if (p >= 0 && t.type[p] === "block") p = t.parent[p];
    return p >= 0 && t.type[p] === "class_definition" ? p : -1;
};

/**
 * Where the code of a class body first sees a name a statement in it binds:
 * the body runs in order, so above the statement (and in its bases) the name
 * is the one outside. Undefined for a statement anywhere else.
 */
const seenInClassFrom = (t: Flat, n: number): number | undefined => {
    let stmt = n;
    if (t.parent[stmt] >= 0 && (t.type[t.parent[stmt]] === "decorated_definition" || t.type[t.parent[stmt]] === "expression_statement")) stmt = t.parent[stmt];
    const block = t.parent[stmt];
    return block >= 0 && t.type[block] === "block" && t.type[t.parent[block]] === "class_definition" ? t.end[stmt] : undefined;
};

/** A definition's decorators, as written after `@` up to their arguments: `staticmethod`, `x.setter`, `typing.overload`. */
const decorators = (t: Flat, def: number): string[] => {
    const p = t.parent[def];
    if (p < 0 || t.type[p] !== "decorated_definition") return [];
    return namedChildren(t, p)
        .filter((c) => t.type[c] === "decorator")
        .map((c) => textOf(t, c).replace(/^@\s*/, "").split("(")[0].trim());
};

const isOverload = (t: Flat, def: number) => decorators(t, def).some((d) => /^(?:[\w.]+\.)?overload$/.test(d));

/** Decorators that make a method a property. */
const PROPERTIES: ReadonlySet<string> = new Set(["property", "cached_property", "functools.cached_property"]);

const PARAM_NAME: Record<string, string> = { default_parameter: "name", typed_default_parameter: "name" };

/** A parameter's name token and its annotation. */
const paramOf = (t: Flat, p: number): { name: number; type: number } | null => {
    const ty = t.type[p];
    if (ty === "identifier") return { name: p, type: -1 };
    if (ty in PARAM_NAME) return { name: child(t, p, PARAM_NAME[ty]), type: child(t, p, "type") };
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
    return out;
};

const importCache = new WeakMap<Flat, GImport[]>();
const imports = (t: Flat) => {
    let hit = importCache.get(t);
    if (!hit) importCache.set(t, (hit = importsOf(t)));
    return hit;
};

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
    if (t.type[n] === "type" || t.type[n] === "splat_type") return typeParameterNames(t, namedChildren(t, n)[0] ?? -1);
    if (t.type[n] === "constrained_type") return typeParameterNames(t, namedChildren(t, n)[0] ?? -1);
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

/** Whether a string is a whole annotation naming one type: `x: "Config"`, a forward reference, never `Literal["config"]`. */
const annotationName = (t: Flat, content: number): boolean => {
    const str = t.parent[content];
    const annotation = str >= 0 ? t.parent[str] : -1;
    return (
        t.type[str] === "string" &&
        annotation >= 0 &&
        t.type[annotation] === "type" &&
        (t.field[annotation] === "type" || t.field[annotation] === "return_type") &&
        namedChildren(t, str).length === 3 &&
        /^[A-Za-z_]\w*$/.test(textOf(t, content))
    );
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

const unwrapType = (t: Flat, n: number): number => {
    while (n >= 0 && (t.type[n] === "type" || t.type[n] === "parenthesized_expression")) n = namedChildren(t, n)[0] ?? -1;
    return n;
};

const typeName = (t: Flat, typeNode: number): TypeName | null => {
    const n = unwrapType(t, typeNode);
    if (n < 0) return null;
    const ty = t.type[n];
    if (ty === "identifier") return { kind: "name", node: n };
    // `"Config"`: a forward reference, read as the name it holds.
    if (ty === "string") {
        const content = namedChildren(t, n)[1];
        return content !== undefined && annotationName(t, content) ? { kind: "name", node: content } : null;
    }
    if (ty === "attribute") return { kind: "qualified", qualifier: child(t, n, "object"), name: textOf(t, child(t, n, "attribute")) };
    // `X | None`, `None | X`.
    if (ty === "binary_operator") {
        const real = [child(t, n, "left"), child(t, n, "right")].map((s) => unwrapType(t, s)).filter((s) => s >= 0 && textOf(t, s) !== "None");
        return real.length === 1 ? typeName(t, real[0]) : null;
    }
    // `Optional[X]` is an X; `Box[T]`, a Box.
    if (ty === "generic_type" || ty === "subscript") {
        const head = namedChildren(t, n)[0];
        if (head === undefined) return null;
        if (!/^(typing\.)?Optional$/.test(textOf(t, head))) return t.type[head] === "identifier" || t.type[head] === "attribute" ? typeName(t, head) : null;
        const args = namedChildren(t, n)
            .slice(1)
            .flatMap((a) => (t.type[a] === "type_parameter" ? namedChildren(t, a) : [a]));
        return args.length === 1 ? typeName(t, args[0]) : null;
    }
    return null;
};

const hint = (t: Flat, e: number): Hint | null => {
    switch (t.type[e]) {
        case "identifier":
            return { kind: "name", node: e };
        case "attribute":
            return { kind: "member", object: child(t, e, "object"), name: textOf(t, child(t, e, "attribute")) };
        case "call": {
            const fn = child(t, e, "function");
            // `super()`, with no arguments: the method's class, read from its bases on.
            if (fn >= 0 && t.type[fn] === "identifier" && textOf(t, fn) === "super" && namedChildren(t, child(t, e, "arguments")).length === 0) return { kind: "super" };
            return { kind: "call", callee: fn };
        }
        case "parenthesized_expression": {
            const inner = namedChildren(t, e)[0];
            return inner !== undefined ? hint(t, inner) : null;
        }
        default:
            return null;
    }
};

/** Instance attributes a class declares: annotated names in its body, and what its own methods set on `self`. */
const fields = (t: Flat, cls: number): Field[] => {
    const out: Field[] = [];
    const body = child(t, cls, "body");
    if (body < 0) return out;
    for (const st of namedChildren(t, body)) {
        if (t.type[st] !== "expression_statement") continue;
        const a = namedChildren(t, st)[0];
        if (a === undefined || t.type[a] !== "assignment") continue;
        const left = child(t, a, "left");
        if (left >= 0 && t.type[left] === "identifier" && child(t, a, "type") >= 0) out.push({ name: textOf(t, left), typeNode: child(t, a, "type"), init: -1, onSelf: false });
    }
    // `self.x = v` in the class's own methods, where self is the method's first parameter.
    const end = t.end[cls];
    for (let n = body; n < t.count && t.start[n] < end; n++) {
        if (t.type[n] !== "assignment" && t.type[n] !== "augmented_assignment") continue;
        // The method around it, through any function nested in that method.
        let fn = t.parent[n];
        while (fn >= 0 && fn !== cls && !(t.type[fn] === "function_definition" && classOfMethod(t, fn) === cls)) fn = t.parent[fn];
        if (fn < 0 || fn === cls) continue;
        const first = namedChildren(t, child(t, fn, "parameters"))[0];
        if (first === undefined || t.type[first] !== "identifier") continue;
        const left = child(t, n, "left");
        for (const target of attributeTargets(t, left)) {
            const obj = child(t, target, "object");
            if (obj < 0 || t.type[obj] !== "identifier" || textOf(t, obj) !== textOf(t, first)) continue;
            const single = target === left && t.type[n] === "assignment";
            const type = single ? child(t, n, "type") : -1;
            out.push({ name: textOf(t, child(t, target, "attribute")), typeNode: type, init: single && type < 0 ? child(t, n, "right") : -1, onSelf: true });
        }
    }
    return out;
};

/**
 * The class whose `self` a node means: a method's first parameter means the
 * class the method is written in, and `super()` the class of the method
 * right around it; in a function nested in a method `super()` means none.
 */
const selfClass = (t: Flat, n: number): number => {
    for (let x = t.parent[n]; x >= 0; x = t.parent[x]) {
        if (t.type[x] === "function_definition") return classOfMethod(t, x);
        if (t.type[x] === "lambda" || t.type[x] === "class_definition") return -1;
    }
    return -1;
};

/** A string literal's text, when it is one plain literal: `"a"`, `'b'`. */
const literal = (t: Flat, n: number): string | null => {
    if (t.type[n] !== "string") return null;
    const parts = namedChildren(t, n);
    if (parts.length === 2) return "";
    return parts.length === 3 && t.type[parts[1]] === "string_content" ? textOf(t, parts[1]) : null;
};

/** What `from m import *` takes from a module: the names of a literal `__all__`, else every name without a leading underscore; "unknown" when `__all__` is built some other way. */
const starCache = new WeakMap<Flat, ((name: string) => boolean) | "unknown">();
const starNames = (f: { flat: Flat }): ((name: string) => boolean) | "unknown" => {
    const t = f.flat;
    let hit = starCache.get(t);
    if (hit) return hit;
    let names: Set<string> | "unknown" | null = null;
    for (let n = 0; n < t.count && names !== "unknown"; n++) {
        const ty = t.type[n];
        if (ty !== "identifier" || textOf(t, n) !== "__all__") continue;
        const p = t.parent[n];
        // Read only: `__all__` in `if name in __all__` proves nothing either way.
        if (!(t.type[p] === "assignment" && t.field[n] === "left") && !(t.type[p] === "augmented_assignment" && t.field[n] === "left") && !(t.type[p] === "attribute" && t.field[n] === "object")) continue;
        if (names !== null || t.type[p] !== "assignment" || t.parent[t.parent[p]] !== 0) {
            names = "unknown";
            break;
        }
        const right = child(t, p, "right");
        const items = right >= 0 && (t.type[right] === "list" || t.type[right] === "tuple") ? namedChildren(t, right).map((c) => literal(t, c)) : [null];
        names = items.every((x) => x !== null) ? new Set(items as string[]) : "unknown";
    }
    hit = names === "unknown" ? "unknown" : names ? (name: string) => (names as Set<string>).has(name) : (name: string) => !name.startsWith("_");
    starCache.set(t, hit);
    return hit;
};

const BUILTINS = new Set(
    "abs all any ascii bin bool breakpoint bytearray bytes callable chr classmethod compile complex delattr dict dir divmod enumerate eval exec filter float format frozenset getattr globals hasattr hash help hex id input int isinstance issubclass iter len list locals map max memoryview min next object oct open ord pow print property range repr reversed round set setattr slice sorted staticmethod str sum super tuple type vars zip __import__ NotImplemented Ellipsis None True False".split(" ")
);

/** Whether a file defers its annotations: `from __future__ import annotations`. */
const deferring = new WeakMap<Flat, boolean>();
const defersAnnotations = (t: Flat): boolean => {
    let hit = deferring.get(t);
    if (hit === undefined) {
        hit = false;
        for (let n = 0; n < t.count && !hit; n++) if (t.type[n] === "future_import_statement" && /\bannotations\b/.test(textOf(t, n))) hit = true;
        deferring.set(t, hit);
    }
    return hit;
};

/** Whether a site sits in a class body's own annotation, `mode: Mode`. */
const inClassAnnotation = (t: Flat, n: number): boolean => {
    let x = n;
    while (x >= 0 && !(t.type[x] === "type" && t.field[x] === "type" && t.type[t.parent[x]] === "assignment")) {
        if (t.type[x] === "function_definition" || t.type[x] === "lambda" || t.type[x] === "class_definition" || t.type[x] === "block") return false;
        x = t.parent[x];
    }
    const stmt = x >= 0 ? t.parent[t.parent[x]] : -1;
    const block = stmt >= 0 ? t.parent[stmt] : -1;
    return stmt >= 0 && t.type[stmt] === "expression_statement" && block >= 0 && t.type[block] === "block" && t.type[t.parent[block]] === "class_definition";
};

const PYTHON_TYPING: Typing = {
    hint,
    typeName,
    // An `@overload` group's result depends on the call: unknown.
    returnType: (t, n) => (t.type[n] === "function_definition" && !isOverload(t, n) ? child(t, n, "return_type") : -1),
    property: (t, n) => t.type[n] === "function_definition" && decorators(t, n).some((d) => /^(?:functools\.)?(?:property|cached_property)$/.test(d)),
    nests: () => true,
    fields: (t, n) => (t.type[n] === "class_definition" ? fields(t, n) : []),
    mro: true,
    builtins: BUILTINS,
    selfClass,
    starNames,
    // Deferred, a class body's annotation is read once the body ran (Python 3.14 defers them all, so without the future import the version decides).
    deferredAnnotation: (t, n) => (inClassAnnotation(t, n) ? (defersAnnotations(t) ? "deferred" : "unknown") : null),
};

/**
 * The standard library's top-level modules (Python 3.14's, and those 3.12
 * and 3.13 removed): an absolute import of one names no repository file, as
 * pyright reads them from typeshed, whatever a folder of the same name holds.
 */
const STDLIB = new Set(
    "__future__ abc aifc annotationlib antigravity argparse array ast asynchat asyncio asyncore atexit audioop base64 bdb binascii bisect builtins bz2 cProfile calendar cgi cgitb chunk cmath cmd code codecs codeop collections colorsys compileall compression concurrent configparser contextlib contextvars copy copyreg crypt csv ctypes curses dataclasses datetime dbm decimal difflib dis distutils doctest email encodings ensurepip enum errno faulthandler fcntl filecmp fileinput fnmatch fractions ftplib functools gc genericpath getopt getpass gettext glob graphlib grp gzip hashlib heapq hmac html http idlelib imaplib imghdr imp importlib inspect io ipaddress itertools json keyword lib2to3 linecache locale logging lzma mailbox mailcap marshal math mimetypes mmap modulefinder msilib msvcrt multiprocessing netrc nis nntplib nt ntpath nturl2path numbers opcode operator optparse os ossaudiodev pathlib pdb pickle pickletools pipes pkgutil platform plistlib poplib posix posixpath pprint profile pstats pty pwd py_compile pyclbr pydoc pydoc_data pyexpat queue quopri random re readline reprlib resource rlcompleter runpy sched secrets select selectors shelve shlex shutil signal site smtpd smtplib sndhdr socket socketserver spwd sqlite3 sre_compile sre_constants sre_parse ssl stat statistics string stringprep struct subprocess sunau symtable sys sysconfig syslog tabnanny tarfile telnetlib tempfile termios textwrap this threading time timeit tkinter token tokenize tomllib trace traceback tracemalloc tty turtle turtledemo types typing unicodedata unittest urllib uu uuid venv warnings wave weakref webbrowser winreg winsound wsgiref xdrlib xml xmlrpc zipapp zipfile zipimport zlib zoneinfo".split(" ")
);

/** The `__init__.py` of a file's folder and of each folder above it, nearest first: read until one is missing, they show where its package starts. */
export const packageMarkers = (path: string): string[] => {
    const dirs = path.split("/").slice(0, -1);
    const out: string[] = [];
    for (let k = dirs.length; k >= 1; k--) out.push([...dirs.slice(0, k), "__init__.py"].join("/"));
    return out;
};

/** What the files known say about where packages start, for one lookup context. */
type Layout = {
    exists: (path: string) => boolean;
    /** Known to be absent: a 404, when the reads report them; else anything not among the files given. */
    missing: (path: string) => boolean;
    /** Whether a file changes `sys.path`, so its absolute imports come from where it says. */
    changesPath: (path: string) => boolean;
    /** The package root of a folder: above its topmost package, or the folder itself when it is no package; null when a marker on the way was never read. */
    rootOf: (dir: readonly string[]) => string | null;
    /** Folders that hold a top-level package of a file known, `""` aside: `src`, `Lib`, a sub-project's `python`. A file whose markers weren't all read places none. */
    sourceRoots: readonly string[];
    /** Every folder and every module (a `.py` path without it) the files known lie in. */
    shown: ReadonlySet<string>;
};
const layouts = new WeakMap<ModuleContext, Layout>();
const layoutOf = (ctx: ModuleContext): Layout => {
    let hit = layouts.get(ctx);
    if (hit) return hit;
    const known = new Set(ctx.known);
    const exists = (path: string) => known.has(path) || ctx.text(path) !== undefined || ctx.exists?.(path) === true;
    const missing = (path: string) => (ctx.exists ? ctx.exists(path) === false : !exists(path));
    const changes = new Map<string, boolean>();
    const changesPath = (path: string) => {
        let hit = changes.get(path);
        if (hit === undefined) changes.set(path, (hit = SYS_PATH.test(code(ctx.text(path) ?? ""))));
        return hit;
    };
    // A folder is a package, isn't, or wasn't looked at (undefined).
    const isPackage = (d: readonly string[]): boolean | undefined => {
        if (d.length === 0) return false;
        const marker = [...d, "__init__.py"].join("/");
        return exists(marker) ? true : missing(marker) ? false : undefined;
    };
    const rootOf = (dir: readonly string[]): string | null => {
        const here = isPackage(dir);
        if (here !== true) return here === false ? dir.join("/") : null;
        let top = dir;
        for (;;) {
            const above = isPackage(top.slice(0, -1));
            if (above === undefined) return null;
            if (!above) return top.slice(0, -1).join("/");
            top = top.slice(0, -1);
        }
    };
    const sourceRoots = new Set<string>();
    const shown = new Set<string>();
    for (const path of known) {
        const segs = path.split("/");
        for (let k = 1; k < segs.length; k++) shown.add(segs.slice(0, k).join("/"));
        if (!path.endsWith(".py")) continue;
        shown.add(path.slice(0, -3));
        const dir = segs.slice(0, -1);
        const root = isPackage(dir) ? rootOf(dir) : null;
        if (root !== null) sourceRoots.add(root);
    }
    if ([...known].some((p) => p.startsWith("src/"))) sourceRoots.add("src");
    sourceRoots.delete("");
    hit = { exists, missing, changesPath, rootOf, sourceRoots: [...sourceRoots].sort(), shown };
    layouts.set(ctx, hit);
    return hit;
};

/** A Python text with its strings and comments blanked: what runs. */
const code = (text: string) => text.replace(/[rRbBuUfF]{0,2}("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|#[^\n]*)/g, " ");

/** A change to `sys.path`: a call that adds to it or takes from it, an assignment, `site.addsitedir`. */
const SYS_PATH = /\bsys\s*\.\s*path\s*(?:\.\s*(?:insert|append|extend|remove|pop|clear)\s*\(|\[[^\]\n]*\]\s*=(?!=)|\+=|=(?!=))|\bsite\s*\.\s*addsitedir\s*\(/;

/** A module's files under a root, its package before its module file, as Python takes them. */
const filesUnder = (root: string, parts: readonly string[]): string[] => {
    const base = [...(root ? [root] : []), ...parts].join("/");
    return [`${base}/__init__.py`, `${base}.py`];
};

/**
 * Repository paths a Python module may be read from. A relative import names
 * the files beside the importing one. An absolute one names a module of the
 * standard library (no file), or files under the roots Python searches: the
 * importing file's package root (or, for a script or a test outside any
 * package, its own folder), the repository's root, and the folders that hold
 * a package of the files known (`src`, CPython's `Lib`). When two roots hold
 * the module, which one runs depends on how Python starts: it names none;
 * nor when a root may hold it, which the reads didn't find out, nor in a file
 * that changes `sys.path`.
 */
const pythonModuleFiles = (from: string, spec: string, level: number, ctx: ModuleContext): string[] => {
    const dir = from.split("/").slice(0, -1);
    const parts = spec ? spec.split(".") : [];
    if (level > 0) {
        const base = [...dir.slice(0, Math.max(0, dir.length - (level - 1))), ...parts].join("/");
        return parts.length === 0 ? [base ? `${base}/__init__.py` : "__init__.py"] : [`${base}/__init__.py`, `${base}.py`];
    }
    if (parts.length === 0 || STDLIB.has(parts[0])) return [];
    const layout = layoutOf(ctx);
    if (layout.changesPath(from)) return [];
    const own = layout.rootOf(dir);
    if (own === null) return [];
    // A root holds the module, doesn't (its files are absent, or its first name is), or might.
    const held: string[][] = [];
    for (const root of new Set([own, "", ...layout.sourceRoots])) {
        const files = filesUnder(root, parts);
        if (files.some(layout.exists)) held.push(files.filter(layout.exists));
        else if (!files.every(layout.missing) && !(parts.length > 1 && filesUnder(root, parts.slice(0, 1)).every(layout.missing))) return [];
    }
    return held.length === 1 ? held[0] : [];
};

/**
 * What the read tier tries for a module: a relative import's files; for an
 * absolute one whose first name a known path shows under a root, every root
 * Python searches, so that a module two roots hold names none. A root is
 * tried deeper only where it holds the first name, as a package or a module
 * (a folder without `__init__.py` doesn't shadow one elsewhere). A name no
 * known path shows is a package from outside, or no link either way.
 */
const pythonModuleTries = (from: string, spec: string, level: number, ctx: ModuleContext): ModuleTry[] => {
    if (level > 0) return [{ files: pythonModuleFiles(from, spec, level, ctx) }];
    const dir = from.split("/").slice(0, -1);
    const parts = spec ? spec.split(".") : [];
    if (parts.length === 0 || STDLIB.has(parts[0])) return [];
    const layout = layoutOf(ctx);
    if (layout.changesPath(from)) return [];
    const roots = [...new Set([layout.rootOf(dir) ?? "", "", ...layout.sourceRoots])];
    const under = (root: string, names: readonly string[]) => [...(root ? [root] : []), ...names].join("/");
    if (!roots.some((root) => layout.shown.has(under(root, parts.slice(0, 1))))) return [];
    // The package where its folder is known, else the module file.
    const likely = (root: string, names: readonly string[]) => {
        const [pkg, mod] = filesUnder(root, names);
        return layout.shown.has(under(root, names)) ? [pkg, mod] : [mod, pkg];
    };
    return roots.map((root) => (parts.length === 1 ? { files: likely(root, parts) } : { first: likely(root, parts.slice(0, 1)), files: likely(root, parts) }));
};

export const PYTHON_RESOLVER: Resolver = { typing: PYTHON_TYPING, moduleFiles: pythonModuleFiles, moduleTries: pythonModuleTries };
