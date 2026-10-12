/**
 * What a type name means where it is written (JLS 6.4, 6.5.5), and the
 * supertypes and member types it leads through, which name types in turn.
 * A simple type name is a type parameter, a local class, a member type of a
 * class around it (declared or inherited), a type its file declares, a
 * single-type import, a type of its package, then java.lang's once every
 * root the file sees is known to lack it. An on-demand import proves
 * nothing: its package's type loses to one of the file's own package that
 * the reads may not see (another module's half of a split package, a second
 * class in a file named for another). A package the JDK has is the JDK's
 * whatever a root holds.
 */

import type { GScope } from "../../anyfacts.ts";
import { child } from "../../syntax.ts";
import { isAnonymous, isIface, keyOfRef, memberTypesOf, openOf, pkgOf, type JFile, type JType } from "./files.ts";
import { headerGap } from "./gaps.ts";
import { INTERFACE_OBJECT, JAVA_LANG, jdkPackage, libNamed, OBJECT, type Lib } from "./library.ts";
import { accessOf, namesOf, supertypeNodes, typeParts, type Access } from "./nodes.ts";
import { inRoot, packageFile, rootsSeen, typeFile } from "./roots.ts";
import { inBody, isTypeParam, scopeOf, typesSeen } from "./scopes.ts";

/** What a type name means: a type read, a JDK type known, a type parameter, nothing sure, or nothing (`fqn`: an import's, outside the repository). */
export type TypeRes = { k: "type"; t: JType } | { k: "lib"; lib: Lib } | { k: "param" } | { k: "unknown" } | { k: "none"; fqn?: string };
const UNKNOWN: TypeRes = { k: "unknown" };
export const NONE: TypeRes = { k: "none" };

export const ownerOf = (r: TypeRes): JType | Lib | null => (r.k === "type" ? r.t : r.k === "lib" ? r.lib : null);

/** Top-level type `name` of package `pkg` in the file at `path`: absent (a 404, or a file that doesn't declare it), or unknown (never asked, or too long to read). */
const topAt = (from: JFile, path: string, pkg: string, name: string): JType | "absent" | "unknown" => {
    if (from.program.exists(path) === false) return "absent";
    const jf = from.program.fileAt(path);
    if (!jf) return "unknown";
    return jf.pkg === pkg ? (jf.top.get(name) ?? "absent") : "absent";
};

/** A top-level type as a file sees it: in the roots it sees, its own first; absent when they all lack it (another module's, a library's, or none). */
const typeIn = (from: JFile, pkg: string, name: string, rel: string): JType | "absent" | "unknown" => {
    if (from.root === null) return "unknown";
    for (const r of rootsSeen(from.root)) {
        const got = topAt(from, inRoot(r, rel), pkg, name);
        if (got !== "absent") return got;
    }
    return "absent";
};

/** A type by its parts, `a.b.Outer.Inner`, as a file sees it: an import's names its declared member types alone; none (with its name) when no root it sees holds it. */
export const fqnType = (from: JFile, segs: readonly string[], imported = false): TypeRes => {
    const tf = typeFile(segs);
    if (!tf) return NONE;
    const l = libNamed(segs.join("."));
    if (jdkPackage(tf.pkg)) return l ? { k: "lib", lib: l } : { k: "none", fqn: segs.join(".") };
    const got = typeIn(from, tf.pkg, tf.top, tf.rel);
    // A JDK type known is the JDK's where no root it sees is known to hold a file of its name: the reads never look for `javax.net.ssl.SSLEngine` in the repository.
    if (l && (got === "absent" || (got === "unknown" && from.root !== null && rootsSeen(from.root).every((r) => from.program.exists(inRoot(r, tf.rel)) !== true)))) return { k: "lib", lib: l };
    if (got === "unknown") return UNKNOWN;
    if (got === "absent") return { k: "none", fqn: segs.join(".") };
    let res: TypeRes = { k: "type", t: got };
    for (const name of tf.nested) {
        if (res.k !== "type") return UNKNOWN;
        if (imported) {
            const own = memberTypesOf(res.t).get(name);
            if (!own) return NONE;
            res = { k: "type", t: own };
            continue;
        }
        const m = memberType(res.t, name);
        if (m.found === undefined) return m.complete ? NONE : UNKNOWN;
        res = m.found;
    }
    return res;
};

/** The type a simple name means at a node. */
export const typeName = (jf: JFile, n: number, name: string): TypeRes => {
    const at = jf.t.start[n];
    for (let s: GScope | null = scopeOf(jf, n); s; s = s.parent) {
        const bs = typesSeen(jf, s, name, at);
        if (s.kind === "class") {
            if (bs.some((b) => isTypeParam(jf, b))) return { k: "param" };
            const T = jf.byNode.get(s.node);
            if (!T) return UNKNOWN;
            if (inBody(T, n)) {
                const m = memberType(T, name);
                if (m.found !== undefined) return m.found;
                if (!m.complete) return UNKNOWN;
            }
            continue;
        }
        if (s.kind === "module") break;
        if (bs.length > 0) {
            const b = bs[bs.length - 1];
            const local = jf.byNode.get(jf.t.parent[b.node]);
            return isTypeParam(jf, b) ? { k: "param" } : local ? { k: "type", t: local } : UNKNOWN;
        }
    }
    return topType(jf, name);
};

/**
 * A name at a file's top: a type it declares, a single-type import, a
 * single static import's member type, a type of its package in a root it
 * sees, then java.lang's, once each such root is known to hold none of the
 * name. Past that nothing is sure. A name in lower case, `java` of
 * `java.util.List`, is a package's.
 */
const topType = (jf: JFile, name: string): TypeRes => {
    const own = jf.top.get(name);
    if (own) return { k: "type", t: own };
    const single = jf.singles.find((i) => i.local === name);
    if (single) return fqnType(jf, [...namesOf(single.spec), name], true);
    for (const i of jf.statics.filter((i) => i.local === name)) {
        const c = ownerOf(fqnType(jf, namesOf(i.spec), true));
        if (!c) return UNKNOWN;
        const m = memberType(c, name);
        if (m.found !== undefined) return m.found;
        if (!m.complete) return UNKNOWN;
    }
    if (!/^[A-Z]/.test(name)) return NONE;
    if (jf.root === null) return UNKNOWN;
    const got = typeIn(jf, jf.pkg, name, packageFile(jf.pkg, name));
    if (got !== "absent") return got === "unknown" ? UNKNOWN : { k: "type", t: got };
    if (!JAVA_LANG.has(name)) return UNKNOWN;
    const l = libNamed(`java.lang.${name}`);
    return l ? { k: "lib", lib: l } : { k: "none", fqn: `java.lang.${name}` };
};

/** A type written by its parts at a node: a simple name, `Outer.Inner`, `a.b.Foo`. */
export const resolveParts = (jf: JFile, n: number, parts: readonly string[]): TypeRes => {
    if (parts.length === 0) return NONE;
    let res = typeName(jf, n, parts[0]);
    if (parts.length === 1) return res;
    // A first name that is no type is a package's: `a.b.Foo`.
    if (res.k === "none" && !res.fqn) return fqnType(jf, parts);
    for (const name of parts.slice(1)) {
        if (res.k !== "type" && res.k !== "lib") return res.k === "none" ? UNKNOWN : res;
        const m = memberType(res.k === "type" ? res.t : res.lib, name);
        if (m.found === undefined) return m.complete ? NONE : UNKNOWN;
        res = m.found;
    }
    return res;
};

/** The class a type node names, read where it is written; null for a primitive, an array, a type parameter, a type not read. */
export const typeOfNode = (jf: JFile, n: number): JType | null => {
    const r = resolveParts(jf, n, typeParts(jf.t, n));
    return r.k === "type" ? r.t : null;
};

/** Whether a supertype's member is a type's too: never a private one, nor one of the package's from another package. */
export const inherits = (x: JType | Lib, m: { access: Access; owner: JType | Lib }): boolean => m.access !== "private" && !(m.access === "package" && pkgOf(m.owner) !== pkgOf(x));

/** A member type of a type, declared or inherited (found: unknown, a JDK type's); `complete` when no supertype not known may hold one. */
export const memberType = (x: JType | Lib, name: string, depth = 0): { found?: TypeRes; complete: boolean } => {
    if (depth > 40) return { complete: false };
    if ("fqn" in x) {
        if (x.types.has(name)) {
            const nested = libNamed(`${x.fqn}.${name}`);
            return { found: nested ? { k: "lib", lib: nested } : UNKNOWN, complete: true };
        }
        if (!x.members) return { complete: false };
    } else {
        const own = memberTypesOf(x).get(name);
        if (own) return { found: { k: "type", t: own }, complete: true };
        if (openOf(x)) return { complete: false };
    }
    let complete = true;
    let found: TypeRes | undefined;
    for (const s of supersOf(x)) {
        if (!s) {
            complete = false;
            continue;
        }
        const m = memberType(s, name, depth + 1);
        if (!m.complete) complete = false;
        if (m.found === undefined) continue;
        if (m.found.k === "type" && m.found.t.outer && !inherits(x, { access: accessOf(m.found.t.file.t, m.found.t.node, isIface(m.found.t.outer)), owner: m.found.t.outer })) continue;
        // Two different member types make the name ambiguous.
        found = found === undefined || (found.k === "type" && m.found.k === "type" && found.t === m.found.t) ? m.found : UNKNOWN;
    }
    return { ...(found !== undefined ? { found } : {}), complete };
};

/** Supertypes, read where the declaration is written, where its own members aren't in scope; null for one not known. */
const superCache = new WeakMap<JType | Lib, (JType | Lib | null)[]>();
export const supersOf = (x: JType | Lib): (JType | Lib | null)[] => {
    const hit = superCache.get(x);
    if (hit) return hit;
    // A cycle reads as a supertype not known.
    superCache.set(x, [null]);
    let supers: (JType | Lib | null)[];
    if ("fqn" in x) supers = x.supers.length > 0 ? x.supers.map((s) => libNamed(s) ?? null) : x === OBJECT() || x === INTERFACE_OBJECT() ? [] : [x.iface ? INTERFACE_OBJECT() : OBJECT()];
    else {
        const t = x.file.t;
        const written = supertypeNodes(t, x.node).map((n) => ownerOf(resolveParts(x.file, n, typeParts(t, n))));
        // A header that didn't parse as written may name other supertypes.
        if (!isAnonymous(x) && headerGap(t, x.node)) supers = [null];
        else if (x.kind === "class") supers = child(t, x.node, "superclass") >= 0 ? written : [OBJECT(), ...written];
        else if (x.kind === "interface") supers = written.length > 0 ? written : [INTERFACE_OBJECT()];
        else if (x.kind === "enum") supers = [libNamed("java.lang.Enum")!, ...written];
        else if (x.kind === "record") supers = [libNamed("java.lang.Record")!, ...written];
        else if (x.kind === "annotation") supers = [libNamed("java.lang.annotation.Annotation")!];
        else if (x.kind === "constant") supers = [x.outer];
        // An anonymous class extends a class, or Object and an interface.
        else supers = written[0] && isIface(written[0]) ? [OBJECT(), written[0]] : written.length > 0 ? written : [null];
    }
    superCache.set(x, supers);
    return supers;
};

/** The class a type extends, or null: none (an interface, Object) or not known. */
export const superclassOf = (x: JType | Lib): JType | Lib | null => supersOf(x).find((s) => s === null || !isIface(s)) ?? null;

/** Whether a reference type's every supertype is known, and the keys of them all, itself among them. */
const closures = new WeakMap<JType | Lib, { keys: Set<string>; complete: boolean }>();
export const closureOf = (x: JType | Lib): { keys: Set<string>; complete: boolean } => {
    let hit = closures.get(x);
    if (hit) return hit;
    hit = { keys: new Set([keyOfRef(x)]), complete: true };
    closures.set(x, hit);
    for (const s of supersOf(x)) {
        if (!s) {
            hit.complete = false;
            continue;
        }
        const c = closureOf(s);
        for (const k of c.keys) hit.keys.add(k);
        if (!c.complete) hit.complete = false;
    }
    return hit;
};
