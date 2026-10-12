/**
 * The languages the generic linker reads, by grammar, each a rule table:
 * what the file index (`anyfacts.ts`) and the resolver (`anylink.ts`) read,
 * how a module names repository files, and what the read tier fetches beside
 * a changed file. JavaScript and TypeScript have no table: `facts.ts` and
 * `linker.ts` read them. A language with no table here keeps its cards from
 * line patterns (`symbols.ts`) and draws no strings.
 */

import { indexFile, type GFile, type LangRules } from "../anyfacts.ts";
import type { ModuleContext, Resolver } from "../anylink.ts";
import { parseFacts, type FileFacts } from "../facts.ts";
import { grammarOf, type Grammar, type Syntax } from "../syntax.ts";
import { goModsAbove } from "./go/modules.ts";
import { GO } from "./go/rules.ts";
import { GO_RESOLVER } from "./go/typing.ts";
import { JAVA_RESOLVER } from "./java/resolver.ts";
import { JAVA } from "./java/rules.ts";
import { javaWants } from "./java/wants.ts";
import { isPackage, packageMarkers } from "./python/modules.ts";
import { PYTHON } from "./python/rules.ts";
import { PYTHON_RESOLVER } from "./python/typing.ts";
import { RUST } from "./rust/rules.ts";
import { RUST_RESOLVER } from "./rust/typing.ts";

export type Lang = {
    rules: LangRules;
    resolver: Resolver;
    /** Files read beside a changed file, the first that answers in each list: `go.mod` above a Go file. */
    configFiles?: (path: string) => string[][];
    /** Whether a module's file is a package, whose imported names may be its submodules: Python's `__init__.py`. */
    isPackage?: (path: string) => boolean;
    /** Files that make a folder a package, nearest first, read until one is missing: the `__init__.py` above a Python file. */
    packageMarkers?: (path: string) => string[];
    /** Names resolve only inside their own file (Rust, whose crate `mod` tree isn't read): a test file of its own links nothing, so isn't read. */
    local?: true;
    /**
     * The files the language's names need, given the files of it read and
     * what the reads found so far (Java's imports, its package's types and
     * supertypes): asked again after each round of reads, until no path is
     * new or `READ.imports` is spent. `changed`: whether the PR changes a file.
     */
    wants?: (files: readonly GFile[], ctx: ModuleContext, changed: (path: string) => boolean) => string[];
};

const LANGS: Partial<Record<Grammar, Lang>> = {
    python: { rules: PYTHON, resolver: PYTHON_RESOLVER, isPackage, packageMarkers },
    go: { rules: GO, resolver: GO_RESOLVER, configFiles: (path) => [goModsAbove(path)] },
    rust: { rules: RUST, resolver: RUST_RESOLVER, local: true },
    java: { rules: JAVA, resolver: JAVA_RESOLVER, wants: javaWants },
};

/** The rule table that reads a file, or undefined for JavaScript, TypeScript and the languages without one. */
export const langOf = (path: string): Lang | undefined => {
    const g = grammarOf(path);
    return g ? LANGS[g] : undefined;
};

/** A file's facts: from its rule table, else from `facts.ts`; null when no parser reads it (`readable`). */
export const parseFile = (syntax: Syntax, path: string, text: string): FileFacts | GFile | null => {
    const lang = langOf(path);
    if (!lang) return parseFacts(syntax, path, text);
    const flat = syntax.parse(path, text);
    return flat ? indexFile(path, flat, lang.rules) : null;
};
