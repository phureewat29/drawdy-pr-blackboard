/**
 * What a pull request's board reads, all from raw.githubusercontent.com at
 * the head commit, which costs no GitHub API quota: the changed files, the
 * `tsconfig.json` or `jsconfig.json` above each JavaScript or TypeScript one
 * (for `paths`), the typings a config names, the `go.mod` above each Go file,
 * and each changed file's direct imports (and for Python, the module an
 * imported module takes an imported name from). Nothing further: a module
 * not read names nothing, so it makes no link.
 *
 * Reading goes through an injected `read`, so the driver fetches, and the
 * tests and the score gate serve saved files. Each path is read at most once.
 */

import { isGeneric, type GFile } from "./anyfacts.ts";
import type { GenericResolver, ModuleContext, ModuleTry } from "./anylink.ts";
import type { FileFacts } from "./facts.ts";
import { limiter } from "./fp.ts";
import type { PrFile } from "./github.ts";
import { languageOf, roleOf, type Language } from "./language.ts";
import { langOf } from "./langs/index.ts";
import { dirOf, joinPath, moduleCandidates, type PathMapping } from "./linker.ts";
import { grammarOf } from "./syntax.ts";

/** A file's text at the head commit, or null when there is none. */
export type Read = (path: string) => Promise<string | null>;

/** A file's facts, or null when no parser reads it: another language, `@flow`, or too many errors. */
export type Parse = (path: string, text: string) => Promise<FileFacts | GFile | null>;

export type Sources = {
    /** Every text read, by path: the files the board can use, and `go.mod`; tsconfig aside. */
    texts: Map<string, string>;
    /** The parsed files, changed files first: JavaScript and TypeScript by `facts.ts`, the rest by their rule tables. */
    facts: Map<string, FileFacts | GFile>;
    /** tsconfig `paths` for a file: those of the nearest config read. */
    paths: (from: string) => readonly PathMapping[];
    /** Whether a path exists at the head commit, as far as the reads went, a file too long to take included: undefined when never asked. */
    exists: (path: string) => boolean | undefined;
};

/** How much is read: changed code and test files, each file's length, imported files, and requests in flight. Every changed file read is parsed. */
export const READ = { code: 40, tests: 40, chars: 400_000, imports: 300, inFlight: 16 } as const;

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
    for (const f of files.filter((f) => main.has(languageOf(f.path)))) {
        const group = groups.get(topDir(f.path));
        if (group) group.push(f);
        else groups.set(topDir(f.path), [f]);
    }
    const queues = [...groups.values()].map((g) => [...g].sort((a, b) => size(b) - size(a))).sort((a, b) => b.reduce((n, f) => n + size(f), 0) - a.reduce((n, f) => n + size(f), 0));
    const picked = new Set<PrFile>();
    while (picked.size < max && queues.some((q) => q.length > 0)) for (const q of queues) if (q.length > 0 && picked.size < max) picked.add(q.shift()!);
    return files.filter((f) => picked.has(f));
};

/**
 * The changed files read whole: code in any language, and tests the parser
 * reads, which can reach the code they test. Code the parser doesn't read is
 * read for its diff's sake, so a file with no patch is left out, but for one
 * added whole: every line of it is new.
 */
export const changedSources = (files: readonly PrFile[]): PrFile[] => {
    const live = files.filter((f) => f.status !== "removed");
    const code = live.filter((f) => roleOf(f.path) === "code" && languageOf(f.path) !== "text" && (grammarOf(f.path) !== null || f.patch !== undefined || f.status === "added"));
    const tests = live.filter((f) => roleOf(f.path) === "test" && grammarOf(f.path) !== null && !langOf(f.path)?.local);
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

/** Lets the worker answer other extensions between files. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export const readSources = async (files: readonly PrFile[], read: Read, parse: Parse): Promise<Sources> => {
    const slot = limiter(READ.inFlight);
    const answers = new Map<string, Promise<string | null>>();
    /** What each answer said of a path: there, or a 404. A failed read says nothing. */
    const found = new Map<string, boolean>();
    /** Each path once; a text too long to use counts as an answer, so an import stops there. */
    const once = (path: string) => {
        let answer = answers.get(path);
        if (!answer)
            answers.set(
                path,
                (answer = slot(() => read(path)).then(
                    (text) => (found.set(path, text !== null), text),
                    () => null
                ))
            );
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
    const mappings = Promise.all(parsedChanged.filter((f) => !langOf(f.path)).map((f) => mappingsFor(dirOf(f.path))));
    const texts = new Map<string, string>();
    const facts = new Map<string, FileFacts | GFile>();
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
    // In path order: configs answer in whatever order the network gives.
    for (const path of [...typings].sort()) {
        if (texts.has(path)) continue;
        const text = await once(path);
        if (usable(text)) await take(path, text);
    }
    // Beside a changed file its rule table reads: the go.mod above a Go file, the nearest that answers.
    const beside = await Promise.all(
        parsedChanged.map(async (f) => {
            const found: [string, string][] = [];
            for (const list of langOf(f.path)?.configFiles?.(f.path) ?? []) {
                for (const c of list) {
                    const text = await once(c);
                    if (text === null) continue;
                    found.push([c, text]);
                    break;
                }
            }
            return found;
        })
    );
    for (const [path, text] of beside.flat()) texts.set(path, text);
    // What makes the folders above a file packages, read upward until one is missing (Python's `__init__.py`): where its imports start.
    const marked = new Map<string, Promise<void>>();
    /** Markers read only as markers, so far: an import of one still parses it. */
    const onlyMarkers = new Set<string>();
    const markers = (path: string): Promise<void> => {
        let hit = marked.get(path);
        if (!hit) {
            marked.set(
                path,
                (hit = (async () => {
                    for (const m of langOf(path)?.packageMarkers?.(path) ?? []) {
                        const text = await once(m);
                        if (text === null) break;
                        if (texts.has(m)) continue;
                        texts.set(m, text);
                        onlyMarkers.add(m);
                    }
                })())
            );
        }
        return hit;
    };
    await Promise.all(parsedChanged.map((f) => markers(f.path)));
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
    const firstAnswer = async (candidates: readonly string[]): Promise<string | null> => {
        const already = candidates.find((c) => known.has(c));
        if (already) return already;
        for (const c of candidates) if ((await once(c)) !== null) return c;
        return null;
    };
    // What a rule table's module lookup sees: every path known to exist, and the texts read.
    const context = { known: new Set([...files.map((f) => f.path), ...texts.keys()]), text: (path: string) => texts.get(path) };
    // A rule table's tries for a module: which files exist decides whether a module is named at all.
    const exists = async (path: string) => known.has(path) || (await once(path)) !== null;
    const firstExisting = async (paths: readonly string[]) => {
        for (const p of paths) if (await exists(p)) return p;
        return null;
    };
    /** The resolver of a language whose modules the read tier tries for its imports: every one but Java's, which says what it wants itself. */
    const moduleResolver = (path: string): GenericResolver | null => {
        const resolver = langOf(path)?.resolver;
        return resolver && "typing" in resolver ? resolver : null;
    };
    const moduleAnswers = async (from: string, spec: string, level: number): Promise<string[]> => {
        const resolver = moduleResolver(from)!;
        const tries: readonly ModuleTry[] = resolver.moduleTries?.(from, spec, level, context) ?? resolver.moduleFiles(from, spec, level, context).map((c) => ({ files: [c] }));
        const out: string[] = [];
        for (const t of tries) {
            if (t.first && (await firstExisting(t.first)) === null) continue;
            const found = await firstExisting(t.files);
            if (found) out.push(found);
        }
        return out;
    };
    const genericImports = async (f: GFile): Promise<string[]> => {
        const lang = langOf(f.path)!;
        await markers(f.path);
        const found = await Promise.all(
            f.imports.map(async (i) => {
                // An import that names nothing needs no read.
                if (i.unproven) return [];
                const mods = await moduleAnswers(f.path, i.spec, i.level);
                if (i.name === null || i.name === "*" || !lang.isPackage || !mods.some((m) => lang.isPackage!(m))) return mods;
                // `from a import b` may name a submodule of the package a.
                return [...mods, ...(await moduleAnswers(f.path, i.spec ? `${i.spec}.${i.name}` : i.name, i.level))];
            })
        );
        return found.flat();
    };
    const imports = parsedChanged
        .flatMap((c) => facts.get(c.path) ?? [])
        .flatMap((f): Promise<string | string[] | null>[] => (isGeneric(f) ? (moduleResolver(f.path) ? [genericImports(f)] : []) : f.specifiers.map((s) => firstAnswer(moduleCandidates(f.path, s.spec, paths(f.path)).candidates))));
    let added = 0;
    const taken = new Set([...texts.keys()].filter((p) => !onlyMarkers.has(p)));
    const readAll = async (targets: readonly Promise<string | string[] | null>[]) => {
        for (const target of targets) {
            for (const path of [(await target) ?? []].flat()) {
                if (taken.has(path) || added >= READ.imports) continue;
                const text = await once(path);
                if (!usable(text)) continue;
                taken.add(path);
                added++;
                await take(path, text);
            }
        }
    };
    await readAll(imports);
    // A name a changed file imports from a module read may live in the module that one imports it from: one more hop.
    const reexports: Promise<string[]>[] = [];
    for (const c of parsedChanged) {
        const f = facts.get(c.path);
        const resolver = moduleResolver(c.path);
        if (!f || !isGeneric(f) || !resolver) continue;
        for (const i of f.imports) {
            if (i.name === null || i.name === "*" || i.unproven) continue;
            const from = facts.get(resolver.moduleFiles(f.path, i.spec, i.level, context).find((p) => facts.has(p)) ?? "");
            if (!from || !isGeneric(from)) continue;
            for (const j of from.imports) if (j.local === i.name && !j.unproven) reexports.push(markers(from.path).then(() => moduleAnswers(from.path, j.spec, j.level)));
        }
    }
    await readAll(reexports);
    // The pull request's files are there at the head, but those it removes or renames away.
    const there = new Map(files.flatMap((f): [string, boolean][] => [[f.path, f.status !== "removed"], ...(f.previousPath && f.previousPath !== f.path ? [[f.previousPath, false] as [string, boolean]] : [])]));
    const existing = (path: string) => (texts.has(path) || found.get(path) === true ? true : (there.get(path) ?? found.get(path)));
    // What a language wants for its names (Java), asked again of every file of it read after each round, until no path is new or the budget is spent.
    const changedPaths = new Set(changed.map((f) => f.path));
    const live: ModuleContext = { known: { [Symbol.iterator]: () => texts.keys() }, text: (path) => texts.get(path), exists: existing };
    const wanting = [...new Set([...facts.values()].flatMap((f) => (isGeneric(f) && langOf(f.path)?.wants ? [langOf(f.path)!] : [])))];
    for (const lang of wanting) {
        for (;;) {
            const own = [...facts.values()].filter((f): f is GFile => isGeneric(f) && langOf(f.path) === lang);
            const fresh = [...new Set(lang.wants!(own, live, (path) => changedPaths.has(path)))].filter((path) => !answers.has(path));
            if (fresh.length === 0 || added >= READ.imports) break;
            const asked = fresh.map((path) => once(path));
            for (const [i, path] of fresh.entries()) {
                const text = await asked[i];
                if (taken.has(path) || added >= READ.imports || !usable(text)) continue;
                taken.add(path);
                added++;
                await take(path, text);
            }
        }
    }
    return { texts, facts, paths, exists: existing };
};
