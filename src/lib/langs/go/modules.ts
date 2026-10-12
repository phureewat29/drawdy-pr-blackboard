/**
 * Which files a Go import path names: the folder it leads to in the same
 * module, through go.mod's module line, whose files' package clause names
 * the package.
 */

import type { ModuleContext } from "../../anylink.ts";
import { ignored } from "./build.ts";

export const isTest = (path: string): boolean => path.endsWith("_test.go");

/** The go.mod files above a path, nearest first. */
export const goModsAbove = (path: string): string[] => {
    const dirs = path.split("/").slice(0, -1);
    const out: string[] = [];
    for (let k = dirs.length; k >= 0; k--) out.push([...dirs.slice(0, k), "go.mod"].join("/"));
    return out;
};

/** A file's package clause, read from its text. */
const clauseOf = (text: string): string | null => /^\s*package\s+([A-Za-z_]\w*)/m.exec(text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""))?.[1] ?? null;

/**
 * The files read of the package an import path names: the module from the
 * nearest go.mod read, then the folder under it. Never a test file, a file
 * no build holds, or a `package main`; and none when the files left don't
 * agree on one package name.
 */
export const goModuleFiles = (from: string, spec: string, _level: number, ctx: ModuleContext): string[] => {
    for (const mod of goModsAbove(from)) {
        const text = ctx.text(mod);
        if (text === undefined) continue;
        const m = /^\s*module\s+("?)([^\s"]+)\1/m.exec(text);
        if (!m) return [];
        const modulePath = m[2];
        if (spec !== modulePath && !spec.startsWith(`${modulePath}/`)) return [];
        const root = mod.split("/").slice(0, -1).join("/");
        const dir = [root, spec.slice(modulePath.length).replace(/^\//, "")].filter((x) => x).join("/");
        // A folder under a go.mod of its own is another module, which this one may take at another version.
        const files = [...ctx.known].filter((p) => p.endsWith(".go") && !isTest(p) && p.split("/").slice(0, -1).join("/") === dir && goModsAbove(p).find((m) => ctx.text(m) !== undefined) === mod);
        const kept = files.filter((p) => {
            const body = ctx.text(p);
            return body === undefined || !ignored(p, body);
        });
        const names = new Set(kept.map((p) => clauseOf(ctx.text(p) ?? "")));
        return names.size === 1 && !names.has("main") && !names.has(null) ? kept : [];
    }
    return [];
};
