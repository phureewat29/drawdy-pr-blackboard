/**
 * What a Kotlin file declares, as the resolver reads it: its package, its
 * imports, and its declarations outside function bodies (classes, objects,
 * functions, properties, constructors, type aliases), each with its owner,
 * modifiers and written types. Declarations inside a function body are
 * locals: the resolver meets them in the code around a name.
 */

import { perTree, textOf, type Flat } from "../../syntax.ts";
import { annotationName, argOf, code, classKind, kid, modifiersOf, nameOf, token } from "./nodes.ts";
import { leadingAnnotations } from "./doubt.ts";

export type Param = { name: string; node: number; type: number; def: boolean; vararg: boolean };

export type DeclKind = "class" | "interface" | "enum" | "annotation" | "object" | "companion" | "entry" | "fun" | "prop" | "ctor" | "alias";

export type Decl = {
    kind: DeclKind;
    name: string;
    node: number;
    /** The name's node; for a companion or a constructor with none, its keyword. */
    nameNode: number;
    mods: Set<string>;
    /** The class-like declaration it is a member of, or null at the top. */
    owner: ClassDecl | null;
    /** A function's or a constructor's parameters; a property's none. */
    params: Param[];
    /** An extension's receiver type, or -1. */
    receiver: number;
    /** The written type: a property's, a function's result; -1 when none is written. */
    type: number;
    /** A property's initializer, or a function's expression body, or -1. */
    init: number;
    typeParams: string[];
    /** A property: written `var`, or with a getter or a delegate (its value isn't what it was set to). */
    mutable?: boolean;
    getter?: boolean;
    delegated?: boolean;
    /** A property declared by a primary constructor's `val`/`var` parameter. */
    fromParam?: boolean;
    /** The annotations it writes, by their last name (`Deprecated`, `KtorDsl`). */
    annotations: string[];
    /** `@Deprecated(level = DeprecationLevel.HIDDEN)`: no call sees it. */
    hidden?: boolean;
};

export type Super = { type: number; call: number; by: boolean };

export type ClassDecl = Decl & {
    /** The class body (`class_body`, `enum_class_body`), or -1. */
    body: number;
    /** Its members by name: functions, properties, nested classes and objects, enum entries. */
    members: Map<string, Decl[]>;
    supers: Super[];
    companion: ClassDecl | null;
    /** Its constructors: the primary (written, or implied when the class writes no constructor), then the secondary ones. */
    ctors: Decl[];
    /** Whether it writes a primary constructor, or has one implied (no constructor written). */
    primary: boolean;
};

export type Import = { path: string[]; alias: string | null; star: boolean; node: number; nameNode: number };

export type Outline = {
    pkg: string;
    imports: Import[];
    /** Every declaration outside function bodies, in order. */
    decls: Decl[];
    /** Top-level declarations by name. */
    top: Map<string, Decl[]>;
    classes: ClassDecl[];
    /** The declaration each declaration node is. */
    byNode: Map<number, Decl>;
};

const push = <V>(m: Map<string, V[]>, k: string, v: V) => {
    const a = m.get(k);
    if (a) a.push(v);
    else m.set(k, [v]);
};

/** A `type_parameters` node's names. */
const typeParamsOf = (t: Flat, n: number): string[] => {
    const tp = kid(t, n, "type_parameters");
    return tp < 0 ? [] : code(t, tp).flatMap((p) => (t.type[p] === "type_parameter" ? [nameOf(t, kid(t, p, "identifier"))] : []));
};

const TYPES = new Set(["user_type", "nullable_type", "function_type", "parenthesized_type", "non_nullable_type"]);

/** A function's parameters: `function_value_parameters` holds each parameter's modifiers before it and its default after it. */
export const paramsOf = (t: Flat, list: number): Param[] => {
    const out: Param[] = [];
    if (list < 0) return out;
    let vararg = false;
    let last: Param | null = null;
    let afterEq = false;
    for (let c = t.first[list]; c >= 0; c = t.next[c]) {
        const ty = t.type[c];
        if (ty === "parameter_modifiers") vararg = textOf(t, c).split(/\s+/).includes("vararg");
        else if (ty === "parameter") {
            const name = kid(t, c, "identifier");
            const type = code(t, c).find((x) => TYPES.has(t.type[x])) ?? -1;
            last = { name: name >= 0 ? nameOf(t, name) : "", node: c, type, def: false, vararg };
            out.push(last);
            vararg = false;
            afterEq = false;
        } else if (!t.named[c] && ty === "=") afterEq = true;
        else if (t.named[c] && afterEq && last) {
            last.def = true;
            afterEq = false;
        }
    }
    return out;
};

/** A primary constructor's parameters; a `val`/`var` one also declares a property. */
const classParamsOf = (t: Flat, ctor: number): { params: Param[]; props: number[] } => {
    const params: Param[] = [];
    const props: number[] = [];
    const list = kid(t, ctor, "class_parameters");
    if (list < 0) return { params, props };
    for (const p of code(t, list)) {
        if (t.type[p] !== "class_parameter") continue;
        const name = kid(t, p, "identifier");
        const type = code(t, p).find((x) => TYPES.has(t.type[x])) ?? -1;
        const mods = modifiersOf(t, p);
        params.push({ name: name >= 0 ? nameOf(t, name) : "", node: p, type, def: token(t, p, "=") >= 0, vararg: mods.has("vararg") });
        if (token(t, p, "val") >= 0 || token(t, p, "var") >= 0) props.push(p);
    }
    return { params, props };
};

const blank = (kind: DeclKind, name: string, node: number, nameNode: number, mods: Set<string>, owner: ClassDecl | null): Decl => ({ kind, name, node, nameNode, mods, owner, params: [], receiver: -1, type: -1, init: -1, typeParams: [], annotations: [] });

/** The type written before a function's or property's name: its receiver. */
const receiverOf = (t: Flat, n: number, before: number): number => {
    let r = -1;
    for (let c = t.first[n]; c >= 0 && c !== before; c = t.next[c]) if (TYPES.has(t.type[c])) r = c;
    return r;
};

const read = (t: Flat): Outline => {
    const header = kid(t, 0, "package_header");
    const pkg = header >= 0 ? code(t, header).map((q) => code(t, q).map((i) => nameOf(t, i)).join(".")).join(".") : "";
    const imports: Import[] = [];
    const decls: Decl[] = [];
    const top = new Map<string, Decl[]>();
    const classes: ClassDecl[] = [];
    const byNode = new Map<number, Decl>();

    for (const c of code(t, 0)) {
        if (t.type[c] !== "import") continue;
        const q = kid(t, c, "qualified_identifier");
        if (q < 0) continue;
        const ids = code(t, q).filter((i) => t.type[i] === "identifier");
        const star = token(t, c, "*") >= 0 || /\.\s*\*\s*$/.test(textOf(t, c));
        const aliasNode = code(t, c).find((x) => t.type[x] === "identifier") ?? -1;
        imports.push({ path: ids.map((i) => nameOf(t, i)), alias: aliasNode >= 0 ? nameOf(t, aliasNode) : null, star, node: c, nameNode: ids[ids.length - 1] ?? -1 });
    }

    const add = (d: Decl) => {
        annotate(t, d);
        decls.push(d);
        byNode.set(d.node, d);
        if (d.owner) push(d.owner.members, d.name, d);
        else push(top, d.name, d);
    };

    const classOf = (n: number, kind: DeclKind, owner: ClassDecl | null): ClassDecl => {
        const nameNode = t.type[n] === "companion_object" ? (code(t, n).find((x) => t.type[x] === "identifier") ?? token(t, n, "companion")) : kid(t, n, "identifier");
        const name = t.type[n] === "companion_object" && t.type[nameNode] !== "identifier" ? "Companion" : nameOf(t, nameNode);
        const body = code(t, n).find((x) => t.type[x] === "class_body" || t.type[x] === "enum_class_body") ?? -1;
        const mods = modifiersOf(t, n);
        // `fun interface`: its `fun` is a token of the declaration, not a modifier.
        if (t.type[n] === "class_declaration" && token(t, n, "fun") >= 0) mods.add("fun");
        const cls: ClassDecl = { ...blank(kind, name, n, nameNode, mods, owner), typeParams: typeParamsOf(t, n), body, members: new Map(), supers: [], companion: null, ctors: [], primary: false };
        const specs = kid(t, n, "delegation_specifiers");
        for (const s of specs >= 0 ? code(t, specs) : []) {
            const inner = code(t, s).find((x) => t.type[x] !== "annotation") ?? -1;
            if (inner < 0) continue;
            if (t.type[inner] === "constructor_invocation") cls.supers.push({ type: code(t, inner).find((x) => TYPES.has(t.type[x])) ?? -1, call: inner, by: false });
            else if (t.type[inner] === "explicit_delegation") cls.supers.push({ type: code(t, inner).find((x) => TYPES.has(t.type[x])) ?? -1, call: -1, by: true });
            else cls.supers.push({ type: inner, call: -1, by: false });
        }
        return cls;
    };

    const walkClass = (cls: ClassDecl) => {
        const n = cls.node;
        const pc = kid(t, n, "primary_constructor");
        if (pc >= 0) {
            const { params, props } = classParamsOf(t, pc);
            const ctor = { ...blank("ctor", cls.name, pc, cls.nameNode, modifiersOf(t, pc), null), params };
            annotate(t, ctor);
            cls.ctors.push(ctor);
            byNode.set(pc, ctor);
            cls.primary = true;
            for (const p of props) {
                const name = kid(t, p, "identifier");
                if (name < 0) continue;
                const prop: Decl = { ...blank("prop", nameOf(t, name), p, name, modifiersOf(t, p), cls), type: code(t, p).find((x) => TYPES.has(t.type[x])) ?? -1, mutable: token(t, p, "var") >= 0, fromParam: true };
                add(prop);
            }
        }
        if (cls.body < 0) {
            if (pc < 0 && (cls.kind === "class" || cls.kind === "enum")) addImplied(cls);
            return;
        }
        for (const m of code(t, cls.body)) walkMember(m, cls);
        if (pc < 0 && cls.ctors.length === 0 && (cls.kind === "class" || cls.kind === "enum")) addImplied(cls);
    };

    const addImplied = (cls: ClassDecl) => {
        cls.ctors.push({ ...blank("ctor", cls.name, cls.node, cls.nameNode, new Set(), null) });
        cls.primary = true;
    };

    const walkMember = (m: number, owner: ClassDecl | null) => {
        switch (t.type[m]) {
            case "class_declaration": {
                const cls = classOf(m, classKind(t, m), owner);
                add(cls);
                classes.push(cls);
                walkClass(cls);
                return;
            }
            case "object_declaration":
            case "companion_object": {
                const cls = classOf(m, t.type[m] === "object_declaration" ? "object" : "companion", owner);
                add(cls);
                classes.push(cls);
                if (cls.kind === "companion" && owner) owner.companion = cls;
                walkClass(cls);
                return;
            }
            case "enum_entry": {
                if (!owner) return;
                const name = kid(t, m, "identifier");
                if (name < 0) return;
                add({ ...blank("entry", nameOf(t, name), m, name, modifiersOf(t, m), owner) });
                return;
            }
            case "function_declaration": {
                const name = code(t, m).find((x) => t.field[x] === "name") ?? -1;
                if (name < 0) return;
                const params = kid(t, m, "function_value_parameters");
                const d: Decl = { ...blank("fun", nameOf(t, name), m, name, modifiersOf(t, m), owner), params: paramsOf(t, params), receiver: receiverOf(t, m, name), typeParams: typeParamsOf(t, m) };
                // The result type follows the parameters.
                for (let c = params >= 0 ? t.next[params] : -1; c >= 0; c = t.next[c]) {
                    if (TYPES.has(t.type[c])) d.type = c;
                    if (t.type[c] === "function_body") {
                        const body = code(t, c)[0] ?? -1;
                        if (body >= 0 && t.type[body] !== "block") d.init = body;
                        break;
                    }
                }
                add(d);
                return;
            }
            case "property_declaration": {
                const v = kid(t, m, "variable_declaration");
                if (v < 0) return;
                const name = kid(t, v, "identifier");
                if (name < 0) return;
                const d: Decl = { ...blank("prop", nameOf(t, name), m, name, modifiersOf(t, m), owner), receiver: receiverOf(t, m, v), typeParams: typeParamsOf(t, m), type: code(t, v).find((x) => TYPES.has(t.type[x])) ?? -1 };
                d.mutable = token(t, m, "var") >= 0;
                d.getter = kid(t, m, "getter") >= 0;
                d.delegated = kid(t, m, "property_delegate") >= 0;
                // The initializer follows `=`.
                for (let c = t.first[m], eq = false; c >= 0; c = t.next[c]) {
                    if (!t.named[c] && t.type[c] === "=") eq = true;
                    else if (eq && t.named[c]) {
                        d.init = c;
                        break;
                    }
                }
                add(d);
                return;
            }
            case "secondary_constructor": {
                if (!owner) return;
                const kw = token(t, m, "constructor");
                const d: Decl = { ...blank("ctor", owner.name, m, kw, modifiersOf(t, m), null), params: paramsOf(t, kid(t, m, "function_value_parameters")) };
                annotate(t, d);
                owner.ctors.push(d);
                byNode.set(m, d);
                decls.push(d);
                return;
            }
            case "type_alias": {
                const name = code(t, m).find((x) => t.field[x] === "type" && t.type[x] === "identifier") ?? -1;
                if (name < 0) return;
                add({ ...blank("alias", nameOf(t, name), m, name, modifiersOf(t, m), owner), typeParams: typeParamsOf(t, m) });
                return;
            }
        }
    };

    for (const c of code(t, 0)) walkMember(c, null);
    return { pkg, imports, decls, top, classes, byNode };
};

/**
 * A declaration's annotations by last name, and whether one hides it
 * (`@Deprecated(…, level = DeprecationLevel.HIDDEN)`): its modifiers', and
 * those tree-sitter reads apart on the lines before a top-level declaration
 * (`@A(x)` as `@A` and `(x)`).
 */
const annotate = (t: Flat, d: Decl) => {
    const take = (a: number, args: number) => {
        const name = annotationName(t, a);
        if (!name) return;
        d.annotations.push(name);
        if (name === "Deprecated" && (args >= 0 ? hidesArgs(t, args) : hidesLevel(t, a))) d.hidden = true;
    };
    const m = kid(t, d.node, "modifiers");
    if (m >= 0) for (const a of code(t, m)) if (t.type[a] === "annotation") take(a, -1);
    // Annotations read apart, before the declaration.
    const apart = (x: number) => {
        const kids = code(t, x);
        kids.forEach((c, i) => {
            if (t.type[c] === "annotation") take(c, t.type[kids[i + 1]] === "parenthesized_expression" ? kids[i + 1] : -1);
            else if (t.type[c] === "annotated_expression") apart(c);
        });
    };
    const before: number[] = [];
    if (t.parent[d.node] >= 0) for (let c = t.first[t.parent[d.node]]; c >= 0 && c !== d.node; c = t.next[c]) before.push(c);
    for (let i = before.length - 1; i >= 0; i--) {
        const x = before[i];
        if (!t.named[x] || /comment/.test(t.type[x])) continue;
        if (!leadingAnnotations(t, x)) break;
        apart(x);
    }
};

/** Whether `@Deprecated`'s arguments read apart as `(…)` set its level to HIDDEN: `(level = DeprecationLevel.HIDDEN)`. */
const hidesArgs = (t: Flat, paren: number): boolean => /\blevel\s*=\s*([\w.]*\.)?HIDDEN\s*$/.test(textOf(t, paren).replace(/^\(|\)$/g, "").trim());

/** Whether a `@Deprecated` annotation's level, `level = DeprecationLevel.HIDDEN` or its third argument, hides the declaration. */
const hidesLevel = (t: Flat, a: number): boolean => {
    const inv = kid(t, a, "constructor_invocation");
    const vargs = inv >= 0 ? kid(t, inv, "value_arguments") : -1;
    if (vargs < 0) return false;
    const args = code(t, vargs).filter((x) => t.type[x] === "value_argument");
    const level = args.find((x) => argOf(t, x).name === "level") ?? (args.length >= 3 && args.slice(0, 3).every((x) => argOf(t, x).name === null) ? args[2] : -1);
    return level >= 0 && /(^|\.)\s*HIDDEN$/.test(textOf(t, argOf(t, level).value).trim());
};

export const outlineOf = perTree(read);

/** A class-like declaration's kind: the kinds that are classes, objects or interfaces. */
export const CLASSY = new Set<DeclKind>(["class", "interface", "enum", "annotation", "object", "companion"]);

export const isClass = (d: Decl): d is ClassDecl => CLASSY.has(d.kind);

