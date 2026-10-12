/**
 * The Java files of one resolution, each read as its class-like
 * declarations, and what tells types apart across them. Every cache keyed by
 * a `JFile` or a `JType` is one resolution's: each reads the files anew.
 */

import type { GFile } from "../../anyfacts.ts";
import type { ModuleContext } from "../../anylink.ts";
import { memoize } from "../../fp.ts";
import { child, namedChildren, textOf, type Flat } from "../../syntax.ts";
import type { Unit } from "../pack.ts";
import { headerGap } from "./gaps.ts";
import type { Lib } from "./library.ts";
import { isAnonymousBody, isMember, TYPE_KINDS, TYPE_DECLARATIONS } from "./nodes.ts";
import { outlineOf, type Outline } from "./roots.ts";

/** What a file's lookups see past it: whether a path exists, as far as the reads went (undefined: never asked), and the resolution's files by path. */
export type Program = { exists: (path: string) => boolean | undefined; fileAt: (path: string) => JFile | undefined };

/** A class-like declaration of a file read: named (top-level, a member, local) or anonymous (`new T() { … }`, an enum constant's body). */
export type JType = {
    id: number;
    file: JFile;
    /** The declaration, or an anonymous class's body: the node that opens its scope. */
    node: number;
    name: string;
    kind: "class" | "interface" | "enum" | "record" | "annotation" | "anonymous" | "constant";
    /** The class it is written in. */
    outer: JType | null;
    unit: Unit | undefined;
};

export type JFile = Outline & { f: GFile; t: Flat; byNode: Map<number, JType>; top: Map<string, JType>; program: Program };

/** Reads the files of one resolution: a file's types, numbered across all of them, the first time it is asked for. */
export const readFiles = (files: readonly GFile[], ctx: ModuleContext): ((f: GFile) => JFile) => {
    const known = new Set(ctx.known);
    const byPath = new Map(files.map((f) => [f.path, f]));
    let ids = 0;
    const program: Program = {
        exists: (p) => (ctx.exists ? ctx.exists(p) : known.has(p) ? true : undefined),
        fileAt: (path) => {
            const f = byPath.get(path);
            return f ? jfileOf(f) : undefined;
        },
    };
    const jfileOf = memoize((f: GFile): JFile => {
        const t = f.flat;
        const jf: JFile = { ...outlineOf(f), f, t, byNode: new Map(), top: new Map(), program };
        for (let n = 0; n < t.count; n++) {
            const named = TYPE_DECLARATIONS.has(t.type[n]);
            if (!named && !isAnonymousBody(t, n)) continue;
            let outer: JType | null = null;
            for (let x = t.parent[n]; x >= 0 && !outer; x = t.parent[x]) outer = jf.byNode.get(x) ?? null;
            const kind = named ? TYPE_KINDS[t.type[n] as keyof typeof TYPE_KINDS] : t.type[t.parent[n]] === "enum_constant" ? "constant" : "anonymous";
            const T: JType = { id: ids++, file: jf, node: n, name: named ? textOf(t, child(t, n, "name")) : "", kind, outer, unit: named ? f.unitByNode.get(n) : undefined };
            jf.byNode.set(n, T);
            if (named && t.parent[n] === 0) jf.top.set(T.name, T);
        }
        return jf;
    });
    return jfileOf;
};

/** Caches `read` per file and node; a node asked for again while its value is being made gets `cycle`. */
export const perNode = <V>(cycle: V, read: (jf: JFile, n: number) => V): ((jf: JFile, n: number) => V) => {
    const cache = new WeakMap<JFile, Map<number, V>>();
    return (jf, n) => {
        let byNode = cache.get(jf);
        if (!byNode) cache.set(jf, (byNode = new Map()));
        if (byNode.has(n)) return byNode.get(n)!;
        byNode.set(n, cycle);
        const value = read(jf, n);
        byNode.set(n, value);
        return value;
    };
};

export const isIface = (x: JType | Lib): boolean => ("fqn" in x ? x.iface : x.kind === "interface" || x.kind === "annotation");

/** An anonymous class or an enum constant's body: a class written in an expression, with no header. */
export const isAnonymous = (T: JType): boolean => T.kind === "anonymous" || T.kind === "constant";

/** A type's key, the same whichever file names it: its name with its package's (`org.x.Outer.Inner`); a local or anonymous class's id. */
export const typeKey = (T: JType): string => {
    if (!isMember(T.file.t, T.node)) return `#${T.id}`;
    const names: string[] = [];
    for (let x: JType | null = T; x; x = x.outer) names.unshift(x.name);
    return [...(T.file.pkg ? [T.file.pkg] : []), ...names].join(".");
};

export const keyOfRef = (x: JType | Lib): string => ("fqn" in x ? x.fqn : typeKey(x));

export const pkgOf = (x: JType | Lib): string => ("fqn" in x ? x.fqn.slice(0, x.fqn.lastIndexOf(".")) : x.file.pkg);

/** The top-level class a type is written in. */
export const topOfType = (T: JType): JType => (T.outer ? topOfType(T.outer) : T);

/** The node holding a type's members: its body, or an anonymous class's own. */
const bodyOf = (T: JType): number => (isAnonymous(T) ? T.node : child(T.file.t, T.node, "body"));

/** The declarations right in a type's body, an enum's constants' and its members alike. */
export const memberNodes = (T: JType): number[] => {
    const t = T.file.t;
    return namedChildren(t, bodyOf(T)).flatMap((c) => (t.type[c] === "enum_body_declarations" ? namedChildren(t, c) : [c]));
};

/** The member types a type declares, by name. */
export const memberTypesOf = memoize(
    (T: JType): Map<string, JType> => {
        const t = T.file.t;
        const types = new Map<string, JType>();
        for (const c of memberNodes(T)) if (TYPE_DECLARATIONS.has(t.type[c])) types.set(textOf(t, child(t, c, "name")), T.file.byNode.get(c)!);
        return types;
    },
    { cache: new WeakMap() }
);

/**
 * Whether a class's members aren't all as written: Lombok writes some (its
 * file uses `lombok`), or a parse gap in its header or a member's
 * declaration may hide one or change its parameters (`Class<?> @Nullable
 * ... types` doesn't parse in tree-sitter-java 0.23.5).
 */
export const openOf = memoize(
    (T: JType): boolean => {
        if (T.file.lombok) return true;
        const t = T.file.t;
        if (!isAnonymous(T) && headerGap(t, T.node)) return true;
        const body = bodyOf(T);
        for (let c = body >= 0 ? t.first[body] : -1; c >= 0; c = t.next[c]) {
            for (const m of t.type[c] === "enum_body_declarations" ? namedChildren(t, c) : [c]) {
                if (t.type[m] === "ERROR" || t.start[m] === t.end[m]) return true;
                if (t.type[m] !== "block" && t.type[m] !== "static_initializer" && headerGap(t, m)) return true;
            }
        }
        return false;
    },
    { cache: new WeakMap() }
);
