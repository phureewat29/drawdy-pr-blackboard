/**
 * What a position in Java code sees of the scopes the file index read
 * (JLS 6.3). A class's header (its type parameters, supertypes and
 * annotations) sees the names around the class, not its members; a
 * record's components are the one exception.
 */

import type { GBinding, GScope } from "../../anyfacts.ts";
import { child } from "../../syntax.ts";
import { isAnonymous, type JFile, type JType } from "./files.ts";

export const scopeOf = (jf: JFile, n: number): GScope => jf.f.scopes[jf.f.enclosing[n]];

/** The bindings of a scope a position sees: each from where it starts; a try's resource only in its own try block, never its catch or finally (JLS 14.20.3). */
const visible = (jf: JFile, bs: GBinding[] | undefined, at: number): GBinding[] =>
    (bs ?? []).filter((b) => {
        if (b.from !== undefined && b.from > at) return false;
        const t = jf.t;
        if (t.type[t.parent[b.node]] !== "resource") return true;
        const body = child(t, t.parent[t.parent[t.parent[b.node]]], "body");
        return body >= 0 && at < t.end[body];
    });

/** The locals and parameters of a name a scope binds that a position sees. */
export const variablesSeen = (jf: JFile, s: GScope, name: string, at: number): GBinding[] => visible(jf, s.names.get(name), at).filter((b) => b.kind === "local" || b.kind === "param");

/** The classes and type variables of a name a scope binds that a position sees. */
export const typesSeen = (jf: JFile, s: GScope, name: string, at: number): GBinding[] => visible(jf, s.names.get(name), at).filter((b) => b.kind === "type");

export const isTypeParam = (jf: JFile, b: GBinding): boolean => jf.t.type[jf.t.parent[b.node]] === "type_parameter";

/** Whether a node is where a class's members are in scope: its body, and a record's components; not the rest of its header. */
export const inBody = (T: JType, n: number): boolean => {
    if (isAnonymous(T)) return true;
    const t = T.file.t;
    const within = (x: number) => x >= 0 && t.start[x] <= t.start[n] && t.end[n] <= t.end[x];
    return within(child(t, T.node, "body")) || (T.kind === "record" && within(child(t, T.node, "parameters")));
};

/** The innermost class around a node. */
export const classAround = (jf: JFile, n: number): JType | null => {
    for (let s: GScope | null = scopeOf(jf, n); s; s = s.parent) if (s.kind === "class") return jf.byNode.get(s.node) ?? null;
    return null;
};

/** The `type_parameter` that declares a type variable's name at a node, or -1. */
export const typeParameterOf = (jf: JFile, n: number, name: string): number => {
    for (let s: GScope | null = scopeOf(jf, n); s; s = s.parent) {
        const bs = typesSeen(jf, s, name, jf.t.start[n]);
        if (bs.length > 0) return isTypeParam(jf, bs[bs.length - 1]) ? jf.t.parent[bs[bs.length - 1].node] : -1;
    }
    return -1;
};
