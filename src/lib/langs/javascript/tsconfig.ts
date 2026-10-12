/** tsconfig.json and jsconfig.json: the `paths` that apply to a file, and the typings a config names one by one. */

import { dirOf, joinPath, type PathMapping } from "./resolve/paths.ts";

/** A config read with comments and trailing commas allowed. */
const parseJsonc = (text: string): unknown => {
    let out = "";
    let inString = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inString) {
            out += c;
            if (c === "\\") out += text[++i] ?? "";
            else if (c === '"') inString = false;
            continue;
        }
        if (c === '"') {
            inString = true;
            out += c;
        } else if (c === "/" && text[i + 1] === "/") {
            while (i < text.length && text[i] !== "\n") i++;
            out += "\n";
        } else if (c === "/" && text[i + 1] === "*") {
            i += 2;
            while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
            i++;
        } else out += c;
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
};

type Json = { extends?: unknown; files?: unknown; include?: unknown; compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
type Config = { dir: string; baseUrl?: string; paths?: Record<string, string[]>; pathsDir?: string };

/** The configs above some files, read through `read`, each path once. */
export const tsconfigs = (read: (path: string) => Promise<string | null>) => {
    /** Declaration files a config names one by one (`files`, or `include` entries without wildcards): global typings. */
    const typings = new Set<string>();
    const configs = new Map<string, Promise<Config | null>>();
    /** A config, its relative `extends` followed four deep. */
    const loadConfig = (path: string, depth = 0): Promise<Config | null> => {
        let hit = configs.get(path);
        if (!hit) configs.set(path, (hit = configUncached(path, depth)));
        return hit;
    };
    const configUncached = async (path: string, depth: number): Promise<Config | null> => {
        const text = await read(path);
        if (text === null) return null;
        let json: Json;
        try {
            json = parseJsonc(text) as Json;
        } catch {
            return null;
        }
        const dir = dirOf(path);
        const ext = typeof json.extends === "string" ? json.extends : null;
        const base = ext && (ext.startsWith("./") || ext.startsWith("../")) && depth < 4 ? await loadConfig(joinPath(dir, ext.endsWith(".json") ? ext : `${ext}.json`), depth + 1) : null;
        for (const entry of [...(Array.isArray(json.files) ? json.files : []), ...(Array.isArray(json.include) ? json.include : [])]) {
            if (typeof entry === "string" && entry.endsWith(".d.ts") && !/[*?]/.test(entry)) typings.add(joinPath(dir, entry));
        }
        const co = json.compilerOptions ?? {};
        return {
            dir,
            ...(co.baseUrl !== undefined ? { baseUrl: joinPath(dir, co.baseUrl) } : base?.baseUrl !== undefined ? { baseUrl: base.baseUrl } : {}),
            ...(co.paths ? { paths: co.paths, pathsDir: dir } : base?.paths ? { paths: base.paths, pathsDir: base.pathsDir ?? base.dir } : {}),
        };
    };
    const byDir = new Map<string, Promise<PathMapping[]>>();
    /** The `paths` of the nearest config at or above a directory, targets joined to its `baseUrl`. */
    const mappingsFor = (dir: string): Promise<PathMapping[]> => {
        let hit = byDir.get(dir);
        if (!hit) byDir.set(dir, (hit = mappingsUncached(dir)));
        return hit;
    };
    const mappingsUncached = async (dir: string): Promise<PathMapping[]> => {
        for (const name of ["tsconfig.json", "jsconfig.json"]) {
            const c = await loadConfig(dir ? `${dir}/${name}` : name);
            if (!c) continue;
            const root = c.baseUrl ?? c.pathsDir ?? c.dir;
            return Object.entries(c.paths ?? {}).map(([pattern, targets]) => ({ pattern, targets: targets.map((x) => joinPath(root, x)) }));
        }
        return dir ? mappingsFor(dirOf(dir)) : [];
    };
    /** Once the configs asked for have answered: a file's `paths`, those of the nearest directory asked about above it, with no new reads. */
    const settle = async (): Promise<(from: string) => readonly PathMapping[]> => {
        const mappings = new Map<string, PathMapping[]>();
        for (const [dir, m] of byDir) mappings.set(dir, await m);
        return (from) => {
            for (let d = dirOf(from); ; d = dirOf(d)) {
                if (byDir.has(d)) return mappings.get(d) ?? [];
                if (!d) return [];
            }
        };
    };
    return { typings, mappingsFor, settle };
};
