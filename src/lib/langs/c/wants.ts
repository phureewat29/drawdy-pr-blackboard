/**
 * What the read tier fetches for C's calls, asked again after each round:
 *
 * 1. each changed C file's build files and the files they include (their
 *    `-D` flags define macros for every line, and their `-I` flags say where
 *    includes are);
 * 2. the headers each changed C file includes, and theirs: the includer's
 *    folder's file first, then, where that isn't there, each place among the
 *    build files' include folders (`includes.ts`), so the resolver knows
 *    which one exists and reads the one that does;
 * 3. for a call to a name a header of that unit declares, the `.c` file
 *    beside the header (`rax.h`'s `rax.c`), where C code usually defines what
 *    a header declares: its definition is found, and a second one blocks a
 *    line. Its build files and headers are asked for where it defines a name
 *    a changed file calls (its unit tells that definition's linkage) or calls
 *    a function a changed file defines (its calls are lines into the PR);
 *    not for a `.c` that does neither.
 *
 * Nothing enforces the convention: a definition links only once a file read
 * holds it, and no other file read defines the name (`resolver.ts`).
 */

import type { GFile } from "../../anyfacts.ts";
import type { ModuleContext } from "../../anylink.ts";
import { child, textOf } from "../../syntax.ts";
import { folderBuild, type BuildCache, type FolderBuild } from "./build.ts";
import { candidatesOf, dirOf, type Search } from "./includes.ts";
import { readPreproc } from "./preproc.ts";
import { reserved } from "./reserved.ts";

const C_FILE = /\.c$/;
const HEADER = /\.(?:h|hh|hpp|hxx|inc|def)$/i;

/** The names a C file calls bare. */
const calledNames = (f: GFile): Set<string> => {
    const t = f.flat;
    const out = new Set<string>();
    for (let n = 0; n < t.count; n++) {
        if (t.type[n] !== "call_expression") continue;
        const callee = child(t, n, "function");
        if (callee >= 0 && t.type[callee] === "identifier") out.add(textOf(t, callee));
    }
    return out;
};

/** The functions a C file defines. */
const definedNames = (f: GFile): string[] => f.units.filter((u) => u.kind === "function").map((u) => u.name);

export const cWants = (files: readonly GFile[], ctx: ModuleContext, changed: (path: string) => boolean): string[] => {
    const known = new Set(ctx.known);
    const exists = (p: string): boolean | undefined => (known.has(p) ? true : ctx.exists?.(p));
    const out: string[] = [];
    const ask = (p: string) => {
        if (!known.has(p)) out.push(p);
    };
    /** What a folder's build files write, as far as they were read; those not yet asked for (and the files they include) are asked for. */
    const builds = new Map<string, FolderBuild>();
    const cache: BuildCache = new Map();
    const buildOf = (dir: string): FolderBuild => {
        let b = builds.get(dir);
        if (!b) builds.set(dir, (b = folderBuild(dir, ctx.text, exists, cache)));
        b.pending.forEach(ask);
        return b;
    };
    /** A C file's include search, once its build files are read. */
    const searchOf = (path: string): Search | null => {
        const b = buildOf(dirOf(path));
        return b.pending.length > 0 ? null : b.search;
    };
    /** The paths each definition of a macro writes, among the texts and the build files read: for a computed include (`#include RAX_MALLOC_INCLUDE`). */
    const valuesOf = (name: string) => {
        const out: { spec: string; angle: boolean }[] = [];
        const add = (m: { name: string; params: string[] | null; body: string }) => {
            const v = m.name === name && !m.params ? /^(?:"([^"]+)"|<([^>]+)>)$/.exec(m.body.trim()) : null;
            if (v) out.push({ spec: v[1] ?? v[2], angle: !!v[2] });
        };
        for (const p of known) {
            const t = ctx.text(p);
            if (t !== undefined && /#\s*define/.test(t) && t.includes(name)) readPreproc(t).macros.forEach(add);
        }
        for (const b of builds.values()) b.defines.forEach(add);
        return out;
    };
    /** The headers a unit reaches, from its main file: each place an include may resolve to is asked for, and what resolves is followed. */
    const closure = (main: string): Set<string> => {
        const seen = new Set<string>([main]);
        const search = searchOf(main);
        const queue = [main];
        const follow = (p: string) => {
            if (!seen.has(p)) {
                seen.add(p);
                queue.push(p);
            }
        };
        while (queue.length > 0) {
            const path = queue.shift()!;
            const text = ctx.text(path);
            if (text === undefined) continue;
            for (const inc of readPreproc(text).includes.flatMap((i) => (i.spec ? [i] : i.macro ? valuesOf(i.macro) : []))) {
                // The includer's own folder first: no build file is needed to look there.
                const own = candidatesOf(path, inc.spec, inc.angle);
                if (own === "system") continue;
                if (own.own) {
                    const e = exists(own.own);
                    if (e === undefined) {
                        ask(own.own);
                        continue;
                    }
                    if (e) {
                        follow(own.own);
                        continue;
                    }
                }
                if (!search) continue;
                const c = candidatesOf(path, inc.spec, inc.angle, search);
                if (c === "system") continue;
                const pending = c.others.filter((p) => exists(p) === undefined);
                if (pending.length > 0) {
                    pending.forEach(ask);
                    continue;
                }
                const found = c.others.filter((p) => exists(p) === true);
                if (found.length === 1) follow(found[0]);
            }
        }
        return seen;
    };
    const changedC = files.filter((f) => C_FILE.test(f.path) && changed(f.path));
    const reached = new Set(changedC.flatMap((f) => [...closure(f.path)]));
    // A name the C library may own, or one the calling file defines itself, needs no other definition read.
    const called = new Set(
        changedC.flatMap((f) => {
            const own = new Set(definedNames(f));
            return [...calledNames(f)].filter((n) => !reserved(n) && !own.has(n));
        })
    );
    const defined = new Set(changedC.flatMap(definedNames));
    const byPath = new Map(files.map((f) => [f.path, f]));
    // The `.c` beside each header that declares a name a changed file calls; what it needs read for its lines into the PR, or for its definitions.
    for (const h of reached) {
        if (!HEADER.test(h)) continue;
        const text = ctx.text(h);
        if (text === undefined || !(text.match(/[A-Za-z_]\w*(?=\s*\()/g) ?? []).some((n) => called.has(n))) continue;
        const sibling = h.replace(/\.[^./]+$/, ".c");
        const e = exists(sibling);
        if (e === undefined) ask(sibling);
        const g = e ? byPath.get(sibling) : undefined;
        if (!g || changed(sibling)) continue;
        // Its unit tells the linkage of a definition a changed file calls; its calls into a changed file are lines into the PR.
        if (definedNames(g).some((n) => called.has(n)) || [...calledNames(g)].some((n) => defined.has(n))) closure(sibling);
    }
    return [...new Set(out)];
};
