/**
 * What the read tier fetches for Kotlin's names. A class lives, by Kotlin's
 * convention, in `<Name>.kt` under its package's folders, so a class a file
 * names is looked for there: in the file's own source root, then its
 * module's common root (main for a test), then the roots of its module's
 * other files read. For a changed file, the classes it imports and the
 * capitalized names it writes that it doesn't declare or import (its
 * package's; a name after a `.` is a member or a nested class, never one);
 * for every file read, its classes' supertypes, round after round. A package
 * that shares no prefix with a package read is a library's: nothing is
 * guessed in it. Two paths per name a round: the next roots once a path is
 * known missing.
 */

import type { GFile } from "../../anyfacts.ts";
import type { ModuleContext } from "../../anylink.ts";
import type { Flat } from "../../syntax.ts";
import { nameOf, stripType, typeParts } from "./nodes.ts";
import { outlineOf, type Outline } from "./outline.ts";
import { rootOf } from "./roots.ts";
import { STD_CLASSES } from "./stdlib.ts";

/** Packages no repository file holds: the JDK's, the standard library's, Android's. */
const LIBRARY = /^(java|javax|kotlin|kotlinx|android|androidx|dalvik|sun|jdk|org\.(junit|jetbrains\.annotations))(\.|$)/;

/** The folder a file's package folders start in, when its path ends with them. */
const baseOf = (path: string, pkg: string): string | null => {
    const dir = path.slice(0, path.lastIndexOf("/") + 1);
    const tail = pkg ? `${pkg.replace(/\./g, "/")}/` : "";
    if (!dir.endsWith(tail)) return null;
    return dir.slice(0, dir.length - tail.length).replace(/\/$/, "");
};

/** The roots a file's names are looked for in, its own first: its source root, its module's common one (main for a test). */
const ownRoots = (path: string, pkg: string): string[] => {
    const out: string[] = [];
    const base = baseOf(path, pkg);
    if (base !== null) out.push(base);
    const r = rootOf(path);
    if (r) {
        const flat = !r.dir.includes("/src/") || /\/(src|test)$/.test(r.dir);
        const prefix = r.module ? `${r.module}/` : "";
        if (flat && /\/(common|jvm|posix|desktop|js|nix|darwin)\/(src|test)$/.test(r.dir)) {
            out.push(`${prefix}common/src`);
            if (r.dir.endsWith("/test")) out.push(r.dir.replace(/\/test$/, "/src"));
        } else {
            if (/Test$/.test(r.set)) out.push(`${prefix}src/${r.set.replace(/Test$/, "Main")}/kotlin`);
            if (r.set === "test") out.push(`${prefix}src/main/kotlin`, `${prefix}src/main/java`);
            if (r.set !== "main" && r.set !== "test") out.push(`${prefix}src/commonMain/kotlin`);
        }
    }
    return [...new Set(out)];
};

/** Capitalized names a file writes in types, calls and qualifiers; not in annotations, nor constants' (`MAX_SIZE`). */
const namesWritten = (t: Flat): Set<string> => {
    const out = new Set<string>();
    for (let n = 0; n < t.count; n++) {
        if (t.type[n] !== "identifier") continue;
        const name = nameOf(t, n);
        if (!/^[A-Z]/.test(name) || /^[A-Z0-9_]+$/.test(name)) continue;
        const p = t.type[t.parent[n]];
        if (p === "import" || p === "qualified_identifier" || p === "package_header") continue;
        if (p === "user_type" && typeParts(t, t.parent[n])[0]?.name !== n) continue;
        // A name after `.` is a member or a nested class of what's before it.
        if (p === "navigation_expression" && t.first[t.parent[n]] !== n) continue;
        let annotation = false;
        for (let x = t.parent[n]; x >= 0 && !annotation; x = t.parent[x]) if (t.type[x] === "annotation") annotation = true;
        if (!annotation) out.add(name);
    }
    return out;
};

export const kotlinWants = (files: readonly GFile[], ctx: ModuleContext, changed: (path: string) => boolean): string[] => {
    const out = new Set<string>();
    const known = new Set<string>(ctx.known);
    const outlines = new Map<GFile, Outline>(files.map((f) => [f, outlineOf(f.flat)]));
    // The top-level classes each package's files read declare.
    const declaredIn = new Map<string, Set<string>>();
    for (const o of outlines.values()) for (const c of o.classes) if (!c.owner) (declaredIn.get(o.pkg) ?? declaredIn.set(o.pkg, new Set()).get(o.pkg)!).add(c.name);
    // Every root a file read lies in.
    const allRoots: string[] = [];
    for (const [f, o] of outlines) {
        const b = baseOf(f.path, o.pkg);
        if (b !== null && !allRoots.includes(b)) allRoots.push(b);
    }
    // The packages read and their prefixes: a package sharing none of its first two segments with them is a library's.
    const repoPkgs = new Set<string>();
    for (const o of outlines.values()) {
        const segs = o.pkg.split(".");
        for (let i = 1; i <= segs.length; i++) repoPkgs.add(segs.slice(0, i).join("."));
    }
    const repoPkg = (pkg: string) => repoPkgs.has(pkg.split(".").slice(0, 2).join(".")) || repoPkgs.has(pkg.split(".")[0]);
    const moduleOf = (root: string) => rootOf(`${root}/x/X.kt`)?.module ?? rootOf(`${root}/`)?.module ?? null;
    /**
     * A class by name, in packages in order (the file's own, then its star
     * imports'): the next two paths, own roots first, not known missing; none
     * once one is read, or once `tries` paths have missed.
     */
    const want = (from: GFile, pkgs: readonly string[], name: string, tries: number) => {
        if (!/^[A-Z]/.test(name)) return;
        const live = pkgs.filter((pkg) => !LIBRARY.test(pkg) && repoPkg(pkg));
        // A file read that declares it already.
        if (live.some((pkg) => declaredIn.get(pkg)?.has(name))) return;
        const own = ownRoots(from.path, outlines.get(from)!.pkg);
        const paths: string[] = [];
        // The file's own roots in every package, then the other roots read of its module.
        const mod = rootOf(from.path)?.module;
        const others = allRoots.filter((r) => !own.includes(r) && mod !== undefined && moduleOf(r) === mod);
        for (const roots of [own, others]) for (const pkg of live) for (const r of roots) paths.push(`${r ? `${r}/` : ""}${pkg ? `${pkg.replace(/\./g, "/")}/` : ""}${name}.kt`);
        if (paths.some((p) => known.has(p))) return;
        let asked = 0;
        let missed = 0;
        for (const p of paths) {
            if (ctx.exists?.(p) === false) {
                if (++missed >= tries) return;
                continue;
            }
            out.add(p);
            if (++asked >= 2) return;
        }
    };
    /** A type name a file writes: through its import, else its package's; a supertype's also through the file's star imports. */
    const wantName = (f: GFile, o: Outline, name: string, declared: Set<string>, supertype: boolean) => {
        if (declared.has(name)) return;
        const imp = o.imports.find((i) => !i.star && (i.alias ?? i.path[i.path.length - 1]) === name);
        if (imp) {
            // `import a.b.Outer.Inner`: Outer's file.
            const segs = imp.path;
            const cls = segs.findIndex((s) => /^[A-Z]/.test(s));
            if (cls >= 0) want(f, [segs.slice(0, cls).join(".")], segs[cls], 4);
            return;
        }
        if (STD_CLASSES.has(name)) return;
        if (supertype) want(f, [o.pkg, ...o.imports.filter((i) => i.star).map((i) => i.path.join("."))], name, 8);
        else want(f, [o.pkg], name, 3);
    };
    for (const f of files) {
        const o = outlines.get(f)!;
        const t = f.flat;
        const declared = new Set(o.decls.map((d) => d.name));
        if (changed(f.path)) for (const name of namesWritten(t)) wantName(f, o, name, declared, false);
        // Each class's supertypes, wherever the file is.
        for (const c of o.classes) {
            for (const s of c.supers) {
                const x = stripType(t, s.type);
                if (x < 0 || t.type[x] !== "user_type") continue;
                const first = typeParts(t, x)[0];
                if (first) wantName(f, o, nameOf(t, first.name), declared, true);
            }
        }
    }
    return [...out];
};
