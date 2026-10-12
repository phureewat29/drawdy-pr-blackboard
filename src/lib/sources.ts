/**
 * What a PR's board reads, all from raw.githubusercontent.com at the head
 * commit, which costs no GitHub API quota: the changed files, what each
 * one's linker reads beside it (the `tsconfig.json` above a TypeScript file
 * and the typings it names, the `go.mod` above a Go file, the `__init__.py`
 * files above a Python one), and each changed file's direct imports (and for
 * Python, the module an imported module takes an imported name from).
 * Nothing further: a module not read names nothing, so it makes no link.
 *
 * Reading goes through an injected `read`, so the driver fetches, and the
 * tests and the score gate serve saved files. Each path is read at most once.
 */

import { isGeneric, type GFile } from "./anyfacts.ts";
import type { GenericResolver, ModuleContext, ModuleTry } from "./anylink.ts";
import { groupBy, limiter, mapValues, sortBy, sumBy } from "./fp.ts";
import type { PrFile } from "./github.ts";
import { LINKERS } from "./langs/linkers.ts";
import type { Facts, OwnLinker, OwnSession } from "./langs/pack.ts";
import { grammarOf, languageOf, roleOf } from "./language.ts";
import { linkerOf, rulesOf } from "./linking.ts";

/** A file's text at the head commit, or null when there is none. */
export type Read = (path: string) => Promise<string | null>;

/** A file's facts, or null when no parser reads it: another language, `@flow`, or too many errors. */
export type Parse = (path: string, text: string) => Promise<Facts | null>;

export type Sources = {
    /** Every text read, by path: the files the board can use, `go.mod` and the package markers; tsconfig aside. */
    texts: Map<string, string>;
    /** The parsed files, changed files first, each by its linker. */
    facts: Map<string, Facts>;
    /** Whether a path exists at the head commit, as far as the reads went, a file too long to take included: undefined when never asked. */
    exists: (path: string) => boolean | undefined;
    /** Each own linker's reading of the PR, which links its files (JavaScript's and TypeScript's tsconfig `paths`). */
    sessions: ReadonlyMap<OwnLinker, OwnSession>;
};

/** How much is read: changed code and test files, each file's length, imported files, and requests in flight. Every changed file read is parsed. */
export const READ = { code: 40, tests: 40, chars: 400_000, imports: 300, inFlight: 16 } as const;

/** A path's top-level directory, "" at the root. */
const topDir = (path: string) => (path.includes("/") ? path.split("/")[0] : "");

/**
 * Up to `max` files, by what matters, not by what sorts first: the largest
 * changes in the PR's main languages (a tenth or more of its lines), each
 * top-level directory in turn; in GitHub's order.
 */
export const pickFiles = (files: readonly PrFile[], max: number): PrFile[] => {
    if (files.length <= max) return [...files];
    const size = (f: PrFile) => f.additions + f.deletions;
    const total = sumBy(files, size);
    const byLanguage = mapValues(
        groupBy(files, (f) => languageOf(f.path)),
        (fs) => sumBy(fs, size)
    );
    const main = files.filter((f) => byLanguage[languageOf(f.path)] >= total / 10);
    const byDir = groupBy(main, (f) => topDir(f.path));
    // The directories with the most changes first, a tie in the order they first appear.
    const queues = sortBy(
        [...new Set(main.map((f) => topDir(f.path)))].map((dir) => byDir[dir]),
        (q) => -sumBy(q, size)
    ).map((q) => sortBy(q, (f) => -size(f)));
    const picked = new Set<PrFile>();
    while (picked.size < max && queues.some((q) => q.length > 0)) for (const q of queues) if (q.length > 0 && picked.size < max) picked.add(q.shift()!);
    return files.filter((f) => picked.has(f));
};

/**
 * The changed files read whole: code, and tests the parser reads, which can
 * reach the code they test. Code no parser reads is read for its diff, so one
 * without a patch is left out, unless added whole.
 */
export const changedSources = (files: readonly PrFile[]): PrFile[] => {
    const live = files.filter((f) => f.status !== "removed");
    const code = live.filter((f) => roleOf(f.path) === "code" && languageOf(f.path) !== "text" && (grammarOf(f.path) !== null || f.patch !== undefined || f.status === "added"));
    const tests = live.filter((f) => roleOf(f.path) === "test" && grammarOf(f.path) !== null && !linkerOf(f.path)?.local);
    return [...pickFiles(code, READ.code), ...pickFiles(tests, READ.tests)];
};

/** Lets the worker answer other extensions between files. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const usable = (text: string | null): text is string => text !== null && text.length <= READ.chars;

/** Reads each path at most once, `READ.inFlight` at a time; a failed read answers null. */
const reader = (read: Read) => {
    const slot = limiter(READ.inFlight);
    const answers = new Map<string, Promise<string | null>>();
    /** What each answer said of a path: there, or a 404. A failed read says nothing. */
    const found = new Map<string, boolean>();
    const once = (path: string): Promise<string | null> => {
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
    return { once, found, asked: (path: string) => answers.has(path) };
};

/** The resolver of a rule table whose modules the read tier tries for its imports: every one but Java's, which says what it wants itself. */
const moduleResolver = (path: string): GenericResolver | null => {
    const resolver = rulesOf(path)?.resolver;
    return resolver && "typing" in resolver ? resolver : null;
};

export const readSources = async (files: readonly PrFile[], read: Read, parse: Parse): Promise<Sources> => {
    const { once, found, asked } = reader(read);
    // Each own linker's reading of the PR, started before anything is read.
    const sessions = new Map(LINKERS.flatMap((l) => (l.kind === "own" ? [[l, l.session(once)] as const] : [])));
    const texts = new Map<string, string>();
    const facts = new Map<string, Facts>();
    const take = async (path: string, text: string) => {
        texts.set(path, text);
        const f = await parse(path, text);
        if (f) facts.set(path, f);
        await breathe();
    };

    // The changed files, in order, each own linker starting what it reads beside its own (the nearest tsconfig above each); then what it reads next (the typings the configs name).
    const changed = changedSources(files);
    const parsedChanged = changed.filter((f) => grammarOf(f.path) !== null);
    for (const [l, session] of sessions) session.start?.(parsedChanged.filter((f) => linkerOf(f.path) === l).map((f) => f.path));
    const changedTexts = changed.map((f) => once(f.path));
    for (const [i, f] of changed.entries()) {
        const text = await changedTexts[i];
        if (usable(text)) await take(f.path, text);
    }
    for (const session of sessions.values()) {
        for (const path of (await session.more?.()) ?? []) {
            if (texts.has(path)) continue;
            const text = await once(path);
            if (usable(text)) await take(path, text);
        }
    }

    // Beside a changed file, what its rule table reads: the go.mod above a Go file, the nearest that answers.
    const beside = await Promise.all(
        parsedChanged.map(async (f) => {
            const got: [string, string][] = [];
            for (const list of rulesOf(f.path)?.configFiles?.(f.path) ?? []) {
                for (const c of list) {
                    const text = await once(c);
                    if (text === null) continue;
                    got.push([c, text]);
                    break;
                }
            }
            return got;
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
                    for (const m of rulesOf(path)?.packageMarkers?.(path) ?? []) {
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
    for (const session of sessions.values()) await session.settle?.();
    /** Each import tries its candidates in order, a 404 a miss, until one answers. */
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
    const moduleAnswers = async (from: string, spec: string, level: number): Promise<string[]> => {
        const resolver = moduleResolver(from)!;
        const tries: readonly ModuleTry[] = resolver.moduleTries?.(from, spec, level, context) ?? resolver.moduleFiles(from, spec, level, context).map((c) => ({ files: [c] }));
        const out: string[] = [];
        for (const t of tries) {
            if (t.first && (await firstExisting(t.first)) === null) continue;
            const file = await firstExisting(t.files);
            if (file) out.push(file);
        }
        return out;
    };
    const genericImports = async (f: GFile): Promise<string[]> => {
        const lang = rulesOf(f.path)!;
        await markers(f.path);
        const answers = await Promise.all(
            f.imports.map(async (i) => {
                // An import that names nothing needs no read.
                if (i.unproven) return [];
                const mods = await moduleAnswers(f.path, i.spec, i.level);
                if (i.name === null || i.name === "*" || !lang.isPackage || !mods.some((m) => lang.isPackage!(m))) return mods;
                // `from a import b` may name a submodule of the package a.
                return [...mods, ...(await moduleAnswers(f.path, i.spec ? `${i.spec}.${i.name}` : i.name, i.level))];
            })
        );
        return answers.flat();
    };

    // The files the changed files import, beyond them: at most `READ.imports`, in the order their imports are written.
    let added = 0;
    const taken = new Set([...texts.keys()].filter((p) => !onlyMarkers.has(p)));
    const room = (path: string) => !taken.has(path) && added < READ.imports;
    const takeImported = async (path: string, text: string | null) => {
        if (!room(path) || !usable(text)) return;
        taken.add(path);
        added++;
        await take(path, text);
    };
    const readAll = async (targets: readonly Promise<string | string[] | null>[]) => {
        for (const target of targets) for (const path of [(await target) ?? []].flat()) if (room(path)) await takeImported(path, await once(path));
    };
    await readAll(
        parsedChanged
            .flatMap((c) => facts.get(c.path) ?? [])
            .flatMap((f): Promise<string | string[] | null>[] => {
                const l = linkerOf(f.path);
                if (l?.kind === "own") return sessions.get(l)!.imports(f, firstAnswer);
                return isGeneric(f) && moduleResolver(f.path) ? [genericImports(f)] : [];
            })
    );
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

    // The PR's files are there at the head, but those it removes or renames away.
    const there = new Map(files.flatMap((f): [string, boolean][] => [[f.path, f.status !== "removed"], ...(f.previousPath && f.previousPath !== f.path ? [[f.previousPath, false] as [string, boolean]] : [])]));
    const existing = (path: string) => (texts.has(path) || found.get(path) === true ? true : (there.get(path) ?? found.get(path)));
    // What a language wants for its names (Java), asked again of every file of it read after each round, until no path is new or the budget is spent.
    const changedPaths = new Set(changed.map((f) => f.path));
    const live: ModuleContext = { known: { [Symbol.iterator]: () => texts.keys() }, text: (path) => texts.get(path), exists: existing };
    const wanting = [...new Set([...facts.values()].flatMap((f) => (isGeneric(f) && rulesOf(f.path)?.wants ? [rulesOf(f.path)!] : [])))];
    for (const lang of wanting) {
        for (;;) {
            const own = [...facts.values()].filter((f): f is GFile => isGeneric(f) && rulesOf(f.path) === lang);
            const fresh = [...new Set(lang.wants!(own, live, (path) => changedPaths.has(path)))].filter((path) => !asked(path));
            if (fresh.length === 0 || added >= READ.imports) break;
            const answers = fresh.map((path) => once(path));
            for (const [i, path] of fresh.entries()) await takeImported(path, await answers[i]);
        }
    }
    return { texts, facts, exists: existing, sessions };
};
