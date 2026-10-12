/**
 * Type variables (JLS 4.4, 4.5.2). A type variable is what a subclass's
 * supertype clauses bind it to. Its bound stands for it only on the class's
 * own receiver (`this`, `super`, an unqualified name): an expression's type,
 * read without its type arguments, gives no bound.
 */

import { child, namedChildren, textOf } from "../../syntax.ts";
import { typeKey, type JFile, type JType } from "./files.ts";
import type { Lib } from "./library.ts";
import type { JField } from "./members.ts";
import { code, supertypeNodes, typeParts } from "./nodes.ts";
import { typeParameterOf } from "./scopes.ts";
import { refTo, type SType } from "./static-types.ts";
import { closureOf, NONE, resolveParts } from "./type-names.ts";

/** A class's type parameters' names, in order. */
const typeParamsOf = (T: JType): string[] => {
    const t = T.file.t;
    return code(t, child(t, T.node, "type_parameters"))
        .map((tp) => namedChildren(t, tp).find((c) => t.type[c] === "type_identifier") ?? -1)
        .map((id) => (id >= 0 ? textOf(t, id) : ""));
};

/** The type variable of class T a type node names, `MM` of `class Test<MM>`, or null: a method's own variable, any other type. */
export const classTypeVar = (T: JType, n: number): string | null => {
    const t = T.file.t;
    if (n < 0 || t.type[n] !== "type_identifier") return null;
    const tp = typeParameterOf(T.file, n, textOf(t, n));
    return tp >= 0 && t.parent[t.parent[tp]] === T.node ? textOf(t, n) : null;
};

type View = { k: "type"; t: JType } | { k: "var"; name: string } | null;

const sameView = (a: View, b: View): boolean => a?.k === b?.k && (a?.k === "type" ? a.t === (b as typeof a).t : a?.name === (b as typeof a)?.name);

/**
 * What type variable `name` of class C means as a member of X, a subtype of
 * C: the class X's supertype clauses bind it to, or a type variable of X's
 * own; null where a raw type, a wildcard, any other argument, or two paths
 * that disagree leave it unknown.
 */
const viewOf = (X: JType, C: JType, name: string, depth = 0): View => {
    if (X === C) return { k: "var", name };
    if (depth > 20) return null;
    const t = X.file.t;
    let found: View | undefined;
    for (const sn of supertypeNodes(t, X.node)) {
        const r = resolveParts(X.file, sn, typeParts(t, sn));
        if (r.k !== "type" || !closureOf(r.t).keys.has(typeKey(C))) continue;
        const up = viewOf(r.t, C, name, depth + 1);
        let here: View = up?.k === "type" ? up : null;
        if (up?.k === "var") {
            const params = typeParamsOf(r.t);
            const generic = t.type[sn] === "generic_type" ? namedChildren(t, sn).find((c) => t.type[c] === "type_arguments") : undefined;
            const args = generic === undefined ? [] : code(t, generic);
            const arg = args.length === params.length ? (args[params.indexOf(up.name)] ?? -1) : -1;
            const a = arg >= 0 ? resolveParts(X.file, arg, typeParts(t, arg)) : NONE;
            here = a.k === "type" ? { k: "type", t: a.t } : a.k === "param" && classTypeVar(X, arg) !== null ? { k: "var", name: textOf(t, arg) } : null;
        }
        if (found !== undefined && !sameView(found, here)) return null;
        found = here;
    }
    return found ?? null;
};

/**
 * The class a member's type variable means as a member of S: what S's
 * supertype clauses bind it to (`class Test extends Box<Real>`), or, where
 * it is S's own variable and free (`free`: in S's code, through `this` or
 * `super`), its one bound. Elsewhere a receiver of S's type may bind S's
 * own variables to anything (`Box<Sub> b`): then nothing.
 */
export const viewType = (S: JType | Lib | null, C: JType | Lib, name: string | null, free: boolean): JType | null => {
    if (!S || !name || "fqn" in S || "fqn" in C) return null;
    const v = viewOf(S, C, name);
    if (v?.k !== "var") return v?.k === "type" ? v.t : null;
    if (!free) return null;
    const t = S.file.t;
    const tp = code(t, child(t, S.node, "type_parameters")).find((c) => textOf(t, namedChildren(t, c).find((x) => t.type[x] === "type_identifier") ?? c) === v.name);
    return tp === undefined ? null : boundOf(S.file, tp);
};

/** A type variable's one bound, whose members are the variable's (JLS 4.4); null for none, several, or one not read. */
export const boundOf = (jf: JFile, tp: number): JType | null => {
    const t = jf.t;
    const bound = namedChildren(t, tp).find((c) => t.type[c] === "type_bound");
    const types = bound === undefined ? [] : code(t, bound);
    if (types.length !== 1) return null;
    const r = resolveParts(jf, types[0], typeParts(t, types[0]));
    return r.k === "type" ? r.t : null;
};

/** A field's type as a member of S, through `this` or `super` in S's code (`free`) or an expression of S's type. */
export const fieldType = (S: JType | Lib, fd: JField, free: boolean): JType | null => fd.type() ?? viewType(S, fd.owner, fd.typeVar(), free);

export const fieldStatic = (S: JType | Lib, fd: JField, free: boolean): SType => {
    const v = fd.typeVar() ? viewType(S, fd.owner, fd.typeVar(), free) : null;
    return v ? refTo(v) : fd.static();
};
