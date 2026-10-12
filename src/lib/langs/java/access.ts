/**
 * Access (JLS 6.6). A protected member of another package is reached only
 * as JLS 6.6.2 allows: through the subclass's own type, `this` or `super`.
 */

import { keyOfRef, pkgOf, topOfType, type JFile, type JType } from "./files.ts";
import type { Lib } from "./library.ts";
import type { Access } from "./nodes.ts";
import { classAround } from "./scopes.ts";
import type { Fit } from "./static-types.ts";
import { closureOf } from "./type-names.ts";

/** How a call names its receiver: the code of a class around (`this`, `super`, none written; `view`, that class), a type (a static call), or an expression of a type. */
export type Recv = { kind: "self"; view: JType | null } | { kind: "type" } | { kind: "expr"; type: JType | Lib };

/**
 * Whether code at a node may use a member: a private one inside the
 * top-level class that holds it; a package one from its package; a
 * protected one from its package, or from the body of a subclass, an
 * instance member there through the code's own instance or an expression of
 * that subclass's type. "maybe" where a supertype not read leaves it open.
 */
export const access = (jf: JFile, n: number, m: { access: Access; owner: JType | Lib; isStatic: boolean }, recv: Recv): Fit => {
    if (m.access === "public") return "yes";
    if (m.access === "private") {
        const here = classAround(jf, n);
        return !("fqn" in m.owner) && here !== null && topOfType(here) === topOfType(m.owner) ? "yes" : "no";
    }
    if (pkgOf(m.owner) === jf.pkg) return "yes";
    if (m.access === "package") return "no";
    const owner = keyOfRef(m.owner);
    let open = false;
    for (let S: JType | null = classAround(jf, n); S; S = S.outer) {
        const c = closureOf(S);
        if (!c.keys.has(owner)) {
            if (!c.complete) open = true;
            continue;
        }
        if (m.isStatic || recv.kind !== "expr") return "yes";
        const q = closureOf(recv.type);
        if (q.keys.has(keyOfRef(S))) return "yes";
        if (!q.complete) open = true;
    }
    return open ? "maybe" : "no";
};

/** Whether a static import names a member: one its file may use from the top, a public one or one of its own package's. */
export const importable = (jf: JFile, m: { access: Access; owner: JType | Lib }): boolean => m.access === "public" || (m.access !== "private" && pkgOf(m.owner) === jf.pkg);
