/**
 * What Python's resolver reads of an expression or a type. `self` and
 * `super()` mean the class a method is written in, none for a class inside a
 * function. A class's attributes are what its body binds, through its bases
 * in C3 order, and `from m import *` takes `__all__`'s names.
 */

import type { Field, Hint, Resolver, Typing, TypeName } from "../../anylink.ts";
import { child, namedChildren, perTree, textOf, type Flat } from "../../syntax.ts";
import { pythonModuleFiles, pythonModuleTries } from "./modules.ts";
import { annotationName, attributeTargets, classOfMethod, decorators, inClassBody, isOverload } from "./nodes.ts";

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
const starNamesOf = perTree((t: Flat): ((name: string) => boolean) | "unknown" => {
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
    return names === "unknown" ? "unknown" : names ? (name: string) => (names as Set<string>).has(name) : (name: string) => !name.startsWith("_");
});

const BUILTINS = new Set(
    "abs all any ascii bin bool breakpoint bytearray bytes callable chr classmethod compile complex delattr dict dir divmod enumerate eval exec filter float format frozenset getattr globals hasattr hash help hex id input int isinstance issubclass iter len list locals map max memoryview min next object oct open ord pow print property range repr reversed round set setattr slice sorted staticmethod str sum super tuple type vars zip __import__ NotImplemented Ellipsis None True False".split(" ")
);

/** Whether a file defers its annotations: `from __future__ import annotations`. */
const defersAnnotations = perTree((t: Flat): boolean => {
    for (let n = 0; n < t.count; n++) if (t.type[n] === "future_import_statement" && /\bannotations\b/.test(textOf(t, n))) return true;
    return false;
});

/** Nodes an annotation never reaches past. */
const ANNOTATION_BOUNDS = new Set(["function_definition", "lambda", "class_definition", "block"]);

/** The nearest node at or above a site that `is` takes, short of a function, a lambda, a class or a block; -1 past one. */
const annotationAt = (t: Flat, n: number, is: (x: number) => boolean): number => {
    for (let x = n; x >= 0; x = t.parent[x]) {
        if (is(x)) return x;
        if (ANNOTATION_BOUNDS.has(t.type[x])) return -1;
    }
    return -1;
};

/** Whether a site sits in a class body's own annotation, `mode: Mode`. */
const inClassAnnotation = (t: Flat, n: number): boolean => {
    const x = annotationAt(t, n, (x) => t.type[x] === "type" && t.field[x] === "type" && t.type[t.parent[x]] === "assignment");
    const stmt = x >= 0 ? t.parent[t.parent[x]] : -1;
    return stmt >= 0 && t.type[stmt] === "expression_statement" && inClassBody(t, stmt);
};

/** Whether a site sits in a parameter's or the result's annotation of a function written right in a class body. */
const inMethodAnnotation = (t: Flat, n: number): boolean => {
    const x = annotationAt(t, n, (x) => t.type[x] === "type");
    if (x < 0) return false;
    const p = t.parent[x];
    const fn = t.type[p] === "function_definition" && t.field[x] === "return_type" ? p : (t.type[p] === "typed_parameter" || t.type[p] === "typed_default_parameter") && t.field[x] === "type" ? t.parent[t.parent[p]] : -1;
    if (fn < 0 || t.type[fn] !== "function_definition") return false;
    const up = t.parent[fn];
    return inClassBody(t, up >= 0 && t.type[up] === "decorated_definition" ? up : fn);
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
    starNames: (f) => starNamesOf(f.flat),
    // Deferred, a class body's annotation is read once the body ran (Python 3.14 defers them all, so without the future import the version decides).
    // A method's annotations, deferred, are read in the module (`get_type_hints`) or the class (type checkers): a class binding below them names nothing sure.
    deferredAnnotation: (t, n) => (inClassAnnotation(t, n) ? (defersAnnotations(t) ? "deferred" : "unknown") : inMethodAnnotation(t, n) ? "unknown" : null),
};

export const PYTHON_RESOLVER: Resolver = { typing: PYTHON_TYPING, moduleFiles: pythonModuleFiles, moduleTries: pythonModuleTries };
