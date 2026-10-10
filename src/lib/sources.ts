/**
 * What a pull request's board reads, all from raw.githubusercontent.com at
 * the head commit, which costs no GitHub API quota: the changed files, the
 * `tsconfig.json` or `jsconfig.json` above each JavaScript or TypeScript one
 * (for `paths`), the typings a config names, and each changed file's direct
 * imports. Nothing past the direct imports: a module not read names nothing,
 * so it makes no link.
 *
 * Reading goes through an injected `read`, so the driver fetches, and the
 * tests and the score gate serve saved files. Each path is read at most once.
 */

import type { FileFacts } from "./facts.ts";
import type { PrFile } from "./github.ts";
import { languageOf, roleOf, type Language } from "./language.ts";
import { dirOf, joinPath, moduleCandidates, type PathMapping } from "./linker.ts";
import { grammarOf } from "./syntax.ts";

/** A file's text at the head commit, or null when there is none. */
export type Read = (path: string) => Promise<string | null>;

/** A file's facts, or null when no parser reads it: another language, `@flow`, or too many errors. */
export type Parse = (path: string, text: string) => Promise<FileFacts | null>;

export type Sources = {
    /** Every text read, by path: the changed files the board can use, configs aside. */
    texts: Map<string, string>;
    /** The parsed files, changed files first. */
    facts: Map<string, FileFacts>;
    /** tsconfig `paths` for a file: those of the nearest config read. */
    paths: (from: string) => readonly PathMapping[];
};

/** How much is read: changed code and test files, each file's length, imported files, and requests in flight. */
export const READ = { code: 40, tests: 40, chars: 400_000, imports: 300, inFlight: 8 } as const;

/** The parts of a path above its file: `src/js/node` gives `src`. */
const topDir = (path: string) => (path.includes("/") ? path.split("/")[0] : "");

/**
 * Up to `max` files, chosen by what matters, not by what sorts first: the
 * pull request's main languages (those with a tenth or more of the changed
 * lines), the largest changes in each top-level directory in turn. Within
 * the limit, every file in GitHub's order.
 */
export const pickFiles = (files: readonly PrFile[], max: number): PrFile[] => {
    if (files.length <= max) return [...files];
    const size = (f: PrFile) => f.additions + f.deletions;
    const total = files.reduce((n, f) => n + size(f), 0);
    const byLanguage = new Map<Language, number>();
    for (const f of files) byLanguage.set(languageOf(f.path), (byLanguage.get(languageOf(f.path)) ?? 0) + size(f));
    const main = new Set([...byLanguage].filter(([, n]) => n >= total / 10).map(([lang]) => lang));
    const groups = new Map<string, PrFile[]>();
    for (const f of files.filter((f) => main.has(languageOf(f.path)))) groups.set(topDir(f.path), [...(groups.get(topDir(f.path)) ?? []), f]);
    const queues = [...groups.values()].map((g) => [...g].sort((a, b) => size(b) - size(a))).sort((a, b) => b.reduce((n, f) => n + size(f), 0) - a.reduce((n, f) => n + size(f), 0));
    const picked = new Set<PrFile>();
    while (picked.size < max && queues.some((q) => q.length > 0)) for (const q of queues) if (q.length > 0 && picked.size < max) picked.add(q.shift()!);
    return files.filter((f) => picked.has(f));
};

/** The changed files read whole: code in any language, and tests the parser reads. */
export const changedSources = (files: readonly PrFile[]): PrFile[] => {
    const live = files.filter((f) => f.status !== "removed");
    const code = live.filter((f) => roleOf(f.path) === "code" && languageOf(f.path) !== "text" && (grammarOf(f.path) !== null || f.patch !== undefined));
    const tests = live.filter((f) => roleOf(f.path) === "test" && grammarOf(f.path) !== null);
    return [...pickFiles(code, READ.code), ...pickFiles(tests, READ.tests)];
};

/** tsconfig and jsconfig, read with comments and trailing commas allowed. */
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

type Config = { dir: string; baseUrl?: string; paths?: Record<string, string[]>; pathsDir?: string };

/** A pool of `size` slots: at most that many jobs run at once. */
const limiter = (size: number) => {
    let running = 0;
    const waiting: (() => void)[] = [];
    return async <T>(job: () => Promise<T>): Promise<T> => {
        if (running >= size) await new Promise<void>((resolve) => waiting.push(resolve));
        running++;
        try {
            return await job();
        } finally {
            running--;
            waiting.shift()?.();
        }
    };
};

/** Lets the worker answer other extensions between files. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export const readSources = async (files: readonly PrFile[], read: Read, parse: Parse): Promise<Sources> => {
    const slot = limiter(READ.inFlight);
    const answers = new Map<string, Promise<string | null>>();
    /** Each path once; a text too long to use counts as an answer, so an import stops there. */
    const once = (path: string) => {
        let answer = answers.get(path);
        if (!answer) answers.set(path, (answer = slot(() => read(path)).catch(() => null)));
        return answer;
    };
    const usable = (text: string | null): text is string => text !== null && text.length <= READ.chars;

    // The nearest config above each parsed changed file, its relative `extends` followed, and the typings it names.
    const typings = new Set<string>();
    const configs = new Map<string, Promise<Config | null>>();
    const loadConfig = (path: string, depth = 0): Promise<Config | null> => {
        let hit = configs.get(path);
        if (!hit) configs.set(path, (hit = configUncached(path, depth)));
        return hit;
    };
    const configUncached = async (path: string, depth: number): Promise<Config | null> => {
        const text = await once(path);
        if (text === null) return null;
        let json: { extends?: unknown; files?: unknown; include?: unknown; compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
        try {
            json = parseJsonc(text) as typeof json;
        } catch {
            return null;
        }
        const dir = dirOf(path);
        const ext = typeof json.extends === "string" ? json.extends : null;
        const base = ext && (ext.startsWith("./") || ext.startsWith("../")) && depth < 4 ? await loadConfig(joinPath(dir, ext.endsWith(".json") ? ext : `${ext}.json`), depth + 1) : null;
        // Declaration files a config names one by one (`files`, or `include` entries without wildcards): global typings.
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

    const changed = changedSources(files);
    const parsedChanged = changed.filter((f) => grammarOf(f.path) !== null);
    const mappings = Promise.all(parsedChanged.map((f) => mappingsFor(dirOf(f.path))));
    const texts = new Map<string, string>();
    const facts = new Map<string, FileFacts>();
    const take = async (path: string, text: string) => {
        texts.set(path, text);
        const f = await parse(path, text);
        if (f) facts.set(path, f);
        await breathe();
    };
    const changedTexts = changed.map((f) => once(f.path));
    for (const [i, f] of changed.entries()) {
        const text = await changedTexts[i];
        if (usable(text)) await take(f.path, text);
    }
    await mappings;
    for (const path of typings) {
        if (texts.has(path)) continue;
        const text = await once(path);
        if (usable(text)) await take(path, text);
    }
    // Read before any import: a candidate already here wins without a request.
    const known = new Set(texts.keys());
    /** For a file in a directory with no config read: the nearest one read, with no new reads. */
    const paths = (from: string): readonly PathMapping[] => {
        for (let d = dirOf(from); ; d = dirOf(d)) {
            if (byDir.has(d)) return resolvedMappings.get(d) ?? [];
            if (!d) return [];
        }
    };
    const resolvedMappings = new Map<string, PathMapping[]>();
    for (const [dir, m] of byDir) resolvedMappings.set(dir, await m);

    // Each import tries its candidates in order, a 404 a miss, until one answers.
    const resolveImport = async (from: string, spec: string): Promise<string | null> => {
        const { candidates } = moduleCandidates(from, spec, paths(from));
        const already = candidates.find((c) => known.has(c));
        if (already) return already;
        for (const c of candidates) if ((await once(c)) !== null) return c;
        return null;
    };
    const imports = parsedChanged.flatMap((c) => facts.get(c.path) ?? []).flatMap((f) => f.specifiers.map((s) => resolveImport(f.path, s.spec)));
    let added = 0;
    for (const target of imports) {
        const path = await target;
        if (!path || texts.has(path) || added >= READ.imports) continue;
        const text = await once(path);
        if (!usable(text)) continue;
        added++;
        await take(path, text);
    }
    return { texts, facts, paths };
};
