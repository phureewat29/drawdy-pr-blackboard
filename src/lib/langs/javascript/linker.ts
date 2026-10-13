/**
 * The JavaScript and TypeScript linker, a linker of its own: each file's
 * facts (`facts.ts`), Vue and Svelte components' script blocks among them
 * (`components.ts`); for a PR, the tsconfig `paths` and typings above its
 * changed files (`tsconfig.ts`) and the file each import names; then what
 * every name refers to (`resolve.ts`).
 */

import { textOf, type Flat } from "../../syntax.ts";
import type { OwnLinker, OwnSession } from "../pack.ts";
import { componentReading } from "./components.ts";
import { factsOf, type FileFacts } from "./facts.ts";
import { JAVASCRIPT, TYPESCRIPT } from "./index.ts";
import { repairCallSignatures } from "./repair.ts";
import { builtinRule, resolveAll } from "./resolve.ts";
import { dirOf, implementations, moduleCandidates, type PathMapping } from "./resolve/paths.ts";
import { tsconfigs } from "./tsconfig.ts";

/** `import`, `export … from`, and a `const x = require(…)` alone. */
const isImport = (t: Flat, n: number): boolean => {
    const ty = t.type[n];
    const text = textOf(t, n);
    return (
        ty === "import_statement" ||
        (ty === "export_statement" && /\bfrom\s*["']/.test(text) && !/^export\s+(default\s+)?(async\s+)?(function|class|const|let|var|interface|type|enum)\b/.test(text)) ||
        ((ty === "lexical_declaration" || ty === "variable_declaration") && /^\s*(const|let|var)\b[^=]*=\s*require\s*\(\s*["'][^"']+["']\s*\)\s*;?\s*$/.test(text))
    );
};

/**
 * One PR: the nearest config above each changed file, read beside the
 * changed files; the typings the configs name, in path order; the file each
 * import names through the configs' `paths`; then the links.
 */
const session = (read: (path: string) => Promise<string | null>): OwnSession => {
    const configs = tsconfigs(read);
    let mappings: Promise<unknown> = Promise.resolve();
    let paths: (from: string) => readonly PathMapping[] = () => [];
    /** What each followed import's candidates answered with, by importing file and specifier: the file it names, read or not. */
    const answers = new Map<string, string | null>();
    return {
        start: (changed) => {
            mappings = Promise.all(changed.map((path) => configs.mappingsFor(dirOf(path))));
        },
        more: async () => {
            await mappings;
            return [...configs.typings].sort();
        },
        settle: async () => {
            paths = await configs.settle();
        },
        imports: (f: FileFacts, first) =>
            f.specifiers.map(async (spec) => {
                let answer = await first(moduleCandidates(f.path, spec, paths(f.path)).candidates);
                // A declaration file stands for the JavaScript beside it, the code that runs: that one, when it's there.
                if (answer !== null && implementations(answer).length > 0) answer = (await first(implementations(answer))) ?? answer;
                answers.set(`${f.path}\0${spec}`, answer);
                return answer;
            }),
        link: (files: readonly FileFacts[], pr, changed, exists) =>
            resolveAll(files, changed, { paths, builtin: builtinRule(pr.ref, changed), answered: (from, spec) => answers.get(`${from}\0${spec}`), ...(exists ? { exists } : {}) }),
    };
};

export const JS_LINKER: OwnLinker = {
    kind: "own",
    packs: [TYPESCRIPT, JAVASCRIPT],
    prepare: (grammar, text) => (grammar === "typescript" ? repairCallSignatures(text) : text),
    // Vue and Svelte components: their script blocks, read as the language their tag says (`components.ts`).
    blocks: { extensions: ["vue", "svelte"], read: (path, text) => componentReading(path, text) ?? null },
    isImport,
    index: factsOf,
    session,
};
