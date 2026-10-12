/** What kind of file a path is, from its name alone: the pack that reads it (`langs/`), the grammar that parses it, and the part it plays in a PR. */

import { PACKS } from "./langs/index.ts";
import type { LanguagePack } from "./langs/pack.ts";

/** A pack's id (`ts`, `py`), or `text` for a file no pack reads. */
export type Language = string;

const BY_ID = new Map(PACKS.map((p) => [p.id, p]));
const EXTENSIONS: Record<string, Language> = Object.fromEntries(PACKS.flatMap((p) => p.extensions.map((e) => [e, p.id])));
/** Names a Markdown code fence gives a language by, besides its extensions. */
const FENCES: Record<string, Language> = Object.fromEntries(PACKS.flatMap((p) => (p.fences ?? []).map((f) => [f, p.id])));
const GRAMMARS = new Map(PACKS.flatMap((p) => (p.grammars ?? []).flatMap((g) => g.extensions.map((e) => [e, g.name] as const))));
const GRAMMAR_PACKS = new Map(PACKS.flatMap((p) => (p.grammars ?? []).map((g) => [g.name, p] as const)));

export const packById = (id: Language): LanguagePack | undefined => BY_ID.get(id);

/** The pack whose grammar this is. */
export const packOfGrammar = (grammar: string): LanguagePack | undefined => GRAMMAR_PACKS.get(grammar);

/** A file name's extension, lowercase; "" for none. */
const extensionOf = (name: string): string => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");

export const languageOf = (path: string): Language => {
    const name = path.split("/").pop() ?? path;
    const named = PACKS.find((p) => p.names?.test(name));
    if (named) return named.id;
    return EXTENSIONS[extensionOf(name)] ?? "text";
};

const TYPED = new Set(PACKS.flatMap((p) => (p.grammars ?? []).flatMap((g) => (g.typedMethods ? g.extensions : []))));

/** Whether a file's method cards are named with their type, `Server.Start()`, as its grammar's linker names them (`Grammar.typedMethods`). */
export const typedMethods = (path: string): boolean => TYPED.has(extensionOf(path.split("/").pop() ?? path));

/** The language of a fenced code block, from its info string: `ts`, `typescript`, `tsx title="x"`. */
export const languageOfFence = (info: string | undefined): Language => {
    const name = (info ?? "").trim().split(/\s+/)[0].toLowerCase();
    return FENCES[name] ?? EXTENSIONS[name] ?? "text";
};

/** Which grammar reads a file, by extension; null when none applies. */
export const grammarOf = (path: string): string | null => GRAMMARS.get(path.split(".").pop()?.toLowerCase() ?? "") ?? null;

/**
 * The part a file plays in a PR, which decides where its card goes
 * and whether it starts folded:
 * - `code`: the change itself;
 * - `test`: tests, folded to their case names;
 * - `docs` and `config`: shown after the code;
 * - `generated`: lockfiles, builds, snapshots and vendored code, folded.
 */
export type FileRole = "code" | "test" | "docs" | "config" | "generated";

const GENERATED = [
    /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock|Pipfile\.lock|Gemfile\.lock|composer\.lock|Podfile\.lock|flake\.lock)$/,
    /(^|\/)(dist|build|out|vendor|third_party|node_modules|generated|__generated__)\//,
    /\.(min\.(js|css)|map|snap|pb\.go|lock)$/,
    /(^|\/)__snapshots__\//,
    /\.generated\.[^/]+$/,
];

/** Test folders and suffixes every language shares, then each pack's own (`_test.go`). */
const TEST = [/(^|\/)(__tests__|__mocks__|tests?|spec|specs|e2e|testdata|fixtures)\//i, /\.(test|spec|e2e)\.[^/]+$/i, ...PACKS.flatMap((p) => p.tests ?? [])];

const DOCS = [/\.(md|mdx|rst|txt|adoc)$/i, /(^|\/)(docs?|documentation)\//i, /(^|\/)(LICENSE|CHANGELOG|README|CONTRIBUTING)(\.[^/]*)?$/i];

const CONFIG = [
    /\.(json|jsonc|ya?ml|toml|ini|cfg|conf|env|properties|lock)$/i,
    /(^|\/)\.[^/]+$/,
    /(^|\/)[^/]*\.config\.[^/]+$/,
    /(^|\/)(Dockerfile|Makefile|Procfile)$/,
    // Tooling and agent folders (`.github/`, `.claude/`, `.vscode/`, `.devcontainer/`): not the change itself.
    /(^|\/)\.[^/]+\//,
];

export const roleOf = (path: string): FileRole => {
    if (GENERATED.some((re) => re.test(path))) return "generated";
    if (TEST.some((re) => re.test(path))) return "test";
    if (DOCS.some((re) => re.test(path))) return "docs";
    if (CONFIG.some((re) => re.test(path))) return "config";
    return "code";
};
