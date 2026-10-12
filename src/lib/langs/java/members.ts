/**
 * A type's members (JLS 8.2, 8.4.8, 9.4.1): those it declares, the implicit
 * ones (an enum's `values()`, a record's accessors and fields), and those
 * it inherits. A supertype not read (outside the repository, or the JDK's
 * that `jdk.ts` doesn't list) may hold any member, and so may a class the
 * parser left a gap in or one Lombok writes members into: then a set of
 * members is not `complete`.
 */

import { memoize, once, pushTo } from "../../fp.ts";
import { child, namedChildren, textOf, type Flat } from "../../syntax.ts";
import type { Unit } from "../pack.ts";
import { isIface, memberNodes, openOf, type JType } from "./files.ts";
import { classTypeVar } from "./generics.ts";
import type { Lib } from "./library.ts";
import { accessOf, CONSTRUCTORS, dimsOf, hasModifier, parametersOf, type Access } from "./nodes.ts";
import { keyOfParams, loneVars, paramTypes, staticType } from "./signatures.ts";
import { libParam, refTo, type SType } from "./static-types.ts";
import { inherits, supersOf, typeOfNode } from "./type-names.ts";

/** A method or constructor: declared, implicit (`values()`, a record's accessor), or a JDK type's. */
export type JMethod = {
    name: string;
    owner: JType | Lib;
    /** Its declaration, or -1. */
    node: number;
    unit: Unit | undefined;
    n: number;
    varargs: boolean;
    isStatic: boolean;
    abstract: boolean;
    access: Access;
    /** Its parameter types (`org.x.Box,int,java.lang.String`, a local class as `#id`), or null where one of them can't be told apart from other types. */
    key: () => string | null;
    /** Its parameters' static types, a varargs one as its array. */
    params: () => SType[];
};

/** A field: its type, and where that is a type variable of the class declaring it, the variable's name, which a subclass's supertype clause may bind. */
export type JField = { owner: JType | Lib; access: Access; isStatic: boolean; type: () => JType | null; static: () => SType; typeVar: () => string | null };

export type Members = { methods: Map<string, JMethod[]>; ctors: JMethod[]; fields: Map<string, JField> };

/** A type's methods of a name, and whether no supertype not known may hold another. */
export type MethodSet = { list: JMethod[]; complete: boolean };

/** A record's components. */
export const recordComponents = (T: JType): number[] => parametersOf(T.file.t, T.node);

const declaredMethod = (T: JType, decl: number, components: readonly number[]): JMethod => {
    const t = T.file.t;
    const ty = t.type[decl];
    const ps = parametersOf(t, decl);
    const compact = ty === "compact_constructor_declaration";
    const isStatic = hasModifier(t, decl, "static");
    const iface = isIface(T);
    return {
        name: CONSTRUCTORS.has(ty) ? T.name : textOf(t, child(t, decl, "name")),
        owner: T,
        node: decl,
        unit: T.file.f.unitByNode.get(decl),
        n: compact ? components.length : ps.length,
        varargs: (compact ? components : ps).some((c) => t.type[c] === "spread_parameter"),
        isStatic,
        abstract: ty === "annotation_type_element_declaration" || hasModifier(t, decl, "abstract") || (iface && child(t, decl, "body") < 0 && !isStatic && !hasModifier(t, decl, "default") && !hasModifier(t, decl, "private")),
        access: accessOf(t, decl, iface),
        key: once(() => keyOfParams(T.file, compact ? components : ps)),
        params: once(() => (compact ? paramTypes(T.file, components) : paramTypes(T.file, ps, loneVars(t, decl, ps)))),
    };
};

const declaredField = (T: JType, typeNode: number, dims: number, isStatic: boolean, access: Access): JField => ({
    owner: T,
    access,
    isStatic,
    type: once(() => (typeNode >= 0 && dims === 0 ? typeOfNode(T.file, typeNode) : null)),
    static: once(() => staticType(T.file, typeNode, dims)),
    typeVar: once(() => (dims === 0 && !isStatic ? classTypeVar(T, typeNode) : null)),
});

/** A method no declaration writes, of parameter types `key`: an enum's `values()`, a record's accessor (`at`, its component). */
const implicitMethod = (T: JType, name: string, n: number, isStatic: boolean, key: string, at?: { node: number; unit: Unit | undefined }): JMethod => ({
    name,
    owner: T,
    node: at?.node ?? -1,
    unit: at?.unit,
    n,
    varargs: false,
    isStatic,
    abstract: false,
    access: "public",
    key: () => key,
    params: () => (key ? key.split(",").map(libParam) : []),
});

/** What a type declares, the implicit members included. */
export const membersOf = memoize(
    (T: JType): Members => {
        const found: Members = { methods: new Map(), ctors: [], fields: new Map() };
        const t = T.file.t;
        const iface = isIface(T);
        const addMethod = (m: JMethod) => pushTo(found.methods, m.name, m);
        const components = T.kind === "record" ? recordComponents(T) : [];
        for (const c of memberNodes(T)) {
            const ty = t.type[c];
            if (ty === "method_declaration" || ty === "annotation_type_element_declaration") addMethod(declaredMethod(T, c, components));
            else if (CONSTRUCTORS.has(ty)) found.ctors.push(declaredMethod(T, c, components));
            else if (ty === "field_declaration" || ty === "constant_declaration") {
                for (let d = t.first[c]; d >= 0; d = t.next[d]) {
                    const name = t.field[d] === "declarator" ? child(t, d, "name") : -1;
                    if (name >= 0) found.fields.set(textOf(t, name), declaredField(T, child(t, c, "type"), dimsOf(t, child(t, d, "dimensions")), iface || hasModifier(t, c, "static"), accessOf(t, c, iface)));
                }
            } else if (ty === "enum_constant") found.fields.set(textOf(t, child(t, c, "name")), { owner: T, access: "public", isStatic: true, type: () => T, static: () => refTo(T), typeVar: () => null });
        }
        if (T.kind === "enum") {
            addMethod(implicitMethod(T, "values", 0, true, ""));
            addMethod(implicitMethod(T, "valueOf", 1, true, "java.lang.String"));
        }
        for (const c of components) {
            const name = textOf(t, componentName(t, c));
            found.fields.set(name, declaredField(T, t.type[c] === "formal_parameter" ? child(t, c, "type") : -1, 0, false, "private"));
            // An accessor the record doesn't declare is implicit: declared by its component, so on the record's card, and of the component's type.
            if (!(found.methods.get(name) ?? []).some((m) => m.n === 0)) addMethod(implicitMethod(T, name, 0, false, "", { node: c, unit: T.unit }));
        }
        return found;
    },
    { cache: new WeakMap() }
);

/** A record component's name token: a varargs one's is its declarator's. */
const componentName = (t: Flat, c: number): number => {
    const name = child(t, c, "name");
    return name >= 0 ? name : (namedChildren(t, namedChildren(t, c).find((x) => t.type[x] === "variable_declarator") ?? -1)[0] ?? c);
};

/** A JDK type's methods, by name. */
const libMethods = memoize(
    (x: Lib): Map<string, JMethod[]> => {
        const made = new Map<string, JMethod[]>();
        for (const m of x.methods) pushTo(made, m.name, { ...m, owner: x, node: -1, unit: undefined, key: () => m.key, params: once(() => m.params.map(libParam)) });
        return made;
    },
    { cache: new WeakMap() }
);

const declaredMethods = (x: JType | Lib, name: string): JMethod[] => ("fqn" in x ? libMethods(x).get(name) : membersOf(x).methods.get(name)) ?? [];

/**
 * A type's methods of a name, declared and inherited. An interface's static
 * method is no member of what extends it. A declared method hides an
 * inherited one of the same parameter types, and a class's concrete method
 * an interface's.
 */
const methodCache = new WeakMap<JType | Lib, Map<string, MethodSet>>();
export const methodsOf = (x: JType | Lib, name: string): MethodSet => {
    let byName = methodCache.get(x);
    if (!byName) methodCache.set(x, (byName = new Map()));
    const hit = byName.get(name);
    if (hit) return hit;
    // A cycle reads as not known.
    byName.set(name, { list: [], complete: false });
    const own = declaredMethods(x, name);
    let complete = "fqn" in x ? x.members : !openOf(x);
    const inherited: JMethod[] = [];
    for (const s of supersOf(x)) {
        if (!s) {
            complete = false;
            continue;
        }
        const set = methodsOf(s, name);
        if (!set.complete) complete = false;
        for (const m of set.list) if (inherits(x, m) && !(m.isStatic && isIface(m.owner)) && !inherited.includes(m)) inherited.push(m);
    }
    const same = (a: JMethod, b: JMethod) => a.n === b.n && a.varargs === b.varargs && a.key() !== null && a.key() === b.key();
    const all = [...own, ...inherited.filter((m) => !own.some((d) => same(d, m)))];
    const found = { list: all.filter((m) => !(isIface(m.owner) && all.some((c) => c !== m && !isIface(c.owner) && !c.abstract && same(c, m)))), complete };
    byName.set(name, found);
    return found;
};

/** A field of a type, declared or inherited ("unknown": a JDK type's, or ambiguous). */
export const fieldOf = (x: JType | Lib, name: string, depth = 0): { found?: JField | "unknown"; complete: boolean } => {
    if (depth > 40) return { complete: false };
    if ("fqn" in x) {
        if (x.fields.has(name)) return { found: "unknown", complete: true };
        if (!x.members) return { complete: false };
    } else {
        const own = membersOf(x).fields.get(name);
        if (own) return { found: own, complete: true };
        if (openOf(x)) return { complete: false };
    }
    let complete = true;
    let found: JField | "unknown" | undefined;
    for (const s of supersOf(x)) {
        if (!s) {
            complete = false;
            continue;
        }
        const m = fieldOf(s, name, depth + 1);
        if (!m.complete) complete = false;
        if (m.found === undefined || (m.found !== "unknown" && !inherits(x, m.found))) continue;
        found = found === undefined || found === m.found ? m.found : "unknown";
    }
    return { ...(found !== undefined ? { found } : {}), complete };
};
