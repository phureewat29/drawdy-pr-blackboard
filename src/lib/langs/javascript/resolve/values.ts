/** What the linker knows an expression to be, and the few ways values combine. */

import type { Unit } from "../../pack.ts";
import type { FileFacts, Shape } from "../facts.ts";

/** A class or constructor function has two sides: itself (static) and what it builds (instance). */
export type Side = "static" | "instance";

export type Val = {
    /** Declarations it names: what a reference to it links to. */
    units: Unit[];
    /** Object shapes it has, for member lookup. */
    shapes: { shape: Shape; side: Side; file: FileFacts }[];
    /** A module's namespace object. */
    module?: string;
    /** Why nothing is known; absent when the value is known, even if it holds nothing linkable. */
    unknown?: string;
    /** `super`: the prototype chain only, not own properties set in a constructor. */
    protoOnly?: boolean;
    /** An object from outside the read files (a built-in or a package): none of its members is a declaration here. */
    external?: string;
    /** A value of a union type, one of these: a member names what every one of them agrees on (`memberOf`). */
    union?: Val[];
    /** `Object.assign(target, …sources)`'s arguments: a member is the last one's that has it (`memberOf`). */
    assigned?: Val[];
    /** Why a value of several branches may hold any member: one branch is unknown or a package's (`flag ? a : pkg`), so no member is proven (`memberOf`). */
    uncertain?: string;
};

/** Known, and naming nothing. */
export const NONE: Val = { units: [], shapes: [] };
export const unknown = (why: string): Val => ({ units: [], shapes: [], unknown: why });
export const external = (what: string): Val => ({ ...NONE, external: what });
export const namespace = (path: string): Val => ({ units: [], shapes: [], module: path });
export const shaped = (shape: Shape, side: Side, file: FileFacts): Val => ({ units: [], shapes: [{ shape, side, file }] });

export const hasSides = (s: Shape): boolean => s.kind === "class" || s.kind === "function";

/** What a value of several types at once has (`A & B`): the known ones' members, unknown while any is; a union type's among them, a union of all. */
export const intersect = (...vs: Val[]): Val => {
    if (vs.some((v) => v.union || v.assigned)) return { units: [...new Set(vs.flatMap((v) => v.units))], shapes: [], union: vs.flatMap((v) => v.union ?? [v]) };
    const known = vs.filter((v) => !v.unknown);
    if (known.length === 0) return vs[0] ?? unknown("nothing");
    const module = known.find((v) => v.module)?.module;
    const why = vs.find((v) => v.unknown)?.unknown;
    return {
        units: [...new Set(known.flatMap((v) => v.units))],
        shapes: known.flatMap((v) => v.shapes),
        ...(module ? { module } : {}),
        ...(why ? { unknown: why } : {}),
    };
};

/** What one of several values may be (`a ?? b`, `c ? a : b`): their members, none proven while a branch is unknown or a package's. */
export const merge = (...vs: Val[]): Val => {
    if (vs.length === 1) return vs[0];
    const v = intersect(...vs);
    const why = vs.find((x) => x.unknown)?.unknown ?? vs.find((x) => x.external)?.external ?? vs.find((x) => x.uncertain)?.uncertain;
    return why && !v.union ? { ...v, uncertain: why } : v;
};

/** A value seen from one side of each class or constructor function it holds: `new C()` and `C.prototype` see the instance. */
export const asSide = (v: Val, side: Side): Val =>
    v.assigned
        ? asSide(v.assigned[0], side)
        : {
              units: [],
              shapes: v.shapes.map((s) => ({ ...s, side: hasSides(s.shape) ? side : s.side })),
              ...(v.union ? { union: v.union.map((u) => asSide(u, side)) } : {}),
              ...(v.unknown ? { unknown: v.unknown } : {}),
              ...(v.external ? { external: v.external } : {}),
              ...(v.uncertain ? { uncertain: v.uncertain } : {}),
          };

/**
 * A value per file and node, computed once. A node met again while its value
 * is being computed is a cycle, and unknown.
 */
export const perNode = (missing: string, compute: (f: FileFacts, n: number) => Val) => {
    const memo = new Map<FileFacts, Map<number, Val | null>>();
    return (f: FileFacts, n: number): Val => {
        if (n < 0) return unknown(missing);
        let m = memo.get(f);
        if (!m) memo.set(f, (m = new Map()));
        if (m.has(n)) return m.get(n) ?? unknown("cycle");
        m.set(n, null);
        const v = compute(f, n);
        m.set(n, v);
        return v;
    };
};
