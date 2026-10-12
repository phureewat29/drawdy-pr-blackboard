/**
 * Member lookup (C# spec 12.5): the members of a name a type has, level by
 * level from the type up its base classes, each level the members one type
 * declares that the site may use. An interface's levels are its own
 * members, then those of all its base interfaces as one level. A class
 * reaches no interface's members by name. A level not known (a base not
 * read, a partial declaration, a member inside `#if`) ends the walk with
 * the lookup incomplete.
 */

import type { GScope } from "../../anyfacts.ts";
import { membersOf, openOf, type CFile, type CMember, type CType } from "./files.ts";
import { derives, knownChain, OBJECT, RECORD_MADE, scopeOf, supersOf, type Fit, type Lib } from "./types.ts";

const isLib = (x: CType | Lib): x is Lib => "lib" in x;

/** One type's members of a name (an interface's base interfaces' together); a library type's (`lib`), whose members aren't read. */
export type Level = { owner: CType; members: CMember[] } | { lib: Lib };

export type Lookup = { levels: Level[]; complete: boolean };

/** How code reaches a member: through its own instance (`this`, `base`, a bare name), a type, or another value. */
export type Via = "self" | "type" | "value";

/** The types around a node, innermost first. */
export const typesAround = (cf: CFile, n: number): CType[] => {
    const out: CType[] = [];
    for (let s: GScope | null = scopeOf(cf, n); s; s = s.parent) if (s.kind === "class") out.push(cf.byNode.get(s.node)!);
    return out.filter((x) => x !== undefined);
};

/**
 * Whether code at a node may use a member (C# spec 7.5): a private one in
 * the text of its type; a protected one there or in a class deriving from
 * it, an instance one through that class's own instance; anything else of
 * the project. "maybe" where a base not read leaves it open.
 */
export const access = (cf: CFile, n: number, m: CMember, via: Via): Fit => {
    if (m.access === "public" || m.access === "internal" || m.access === "protected internal") return "yes";
    const around = typesAround(cf, n);
    if (around.includes(m.owner)) return "yes";
    if (m.access === "private") return "no";
    let open = false;
    for (const S of around) {
        if (derives(S, m.owner)) return m.isStatic || via !== "value" ? "yes" : "maybe";
        if (!knownChain(S)) open = true;
    }
    return open ? "maybe" : "no";
};

/** The members of a name one type declares that a site may use; null when one may be inside `#if` or its access isn't known. */
const usableOf = (T: CType, name: string, cf: CFile, n: number, via: Via): CMember[] | null => {
    const found = (membersOf(T).get(name) ?? []).filter((m) => !m.explicit && m.kind !== "ctor");
    if (found.some((m) => m.conditional)) return null;
    const usable: CMember[] = [];
    for (const m of found) {
        const a = access(cf, n, m, via);
        if (a === "maybe") return null;
        if (a === "yes") usable.push(m);
    }
    return usable;
};

/** A type's levels for a name, as a site sees them; `stop` once a level holds one. */
export const lookup = (T: CType, name: string, cf: CFile, n: number, via: Via, stop = false): Lookup => {
    const levels: Level[] = [];
    if (T.kind === "interface") return interfaceLookup(T, name, cf, n);
    let X: CType | Lib | null | undefined = T;
    for (let depth = 0; depth < 30; depth++) {
        if (X === null || X === undefined) return { levels, complete: X === undefined };
        if (isLib(X)) {
            if (X.names === null) return { levels, complete: false };
            if (X.names.has(name)) levels.push({ lib: X });
            if (X.base === null) return { levels, complete: true };
            X = X.base;
            continue;
        }
        if (openOf(X)) return { levels, complete: false };
        const usable = usableOf(X, name, cf, n, via);
        if (usable === null) return { levels, complete: false };
        // A record's members the compiler writes, beside or instead of those of the name it declares: not read.
        if (X.kind === "record" && RECORD_MADE.has(name)) levels.push({ lib: { lib: "record", names: RECORD_MADE, base: null } });
        if (usable.length > 0) levels.push({ owner: X, members: usable });
        if (stop && levels.length > 0) return { levels, complete: true };
        X = supersOf(X).base;
    }
    return { levels, complete: false };
};

/** An interface's levels: its own members, then all its base interfaces' (C# spec 12.5: every base interface is searched), then object's. */
const interfaceLookup = (T: CType, name: string, cf: CFile, n: number): Lookup => {
    if (openOf(T)) return { levels: [], complete: false };
    const own = usableOf(T, name, cf, n, "value");
    if (own === null) return { levels: [], complete: false };
    const levels: Level[] = own.length > 0 ? [{ owner: T, members: own }] : [];
    const rest: CMember[] = [];
    const seen = new Set<CType>([T]);
    const queue = [T];
    while (queue.length > 0) {
        for (const b of supersOf(queue.shift()!).ifaces) {
            if (b === null || openOf(b)) return { levels, complete: false };
            if (seen.has(b)) continue;
            seen.add(b);
            queue.push(b);
            const ms = usableOf(b, name, cf, n, "value");
            if (ms === null) return { levels, complete: false };
            rest.push(...ms);
        }
    }
    if (rest.length > 0) levels.push({ owner: rest[0].owner, members: rest });
    if (OBJECT.names!.has(name)) levels.push({ lib: OBJECT });
    return { levels, complete: true };
};
