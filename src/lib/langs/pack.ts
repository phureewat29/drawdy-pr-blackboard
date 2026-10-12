/**
 * The contract between PR Blackboard's core and its languages. Each language
 * is a pack: a folder in `src/lib/langs/` whose `index.ts` exports a
 * `LanguagePack`, plain data that says how its files look, and, once its
 * links are proven, whose `linker.ts` exports a `Linker`, how the parser
 * worker reads them into units and references.
 *
 * `index.ts` lists every pack (`PACKS`) and `linkers.ts` every linker
 * (`LINKERS`). The core reads languages through these two lists and this
 * file, and imports no language itself. A pack reaches the driver and the
 * parser worker alike, so it holds no parser code; a linker reaches the
 * parser worker only (`scripts/check.ts` fails otherwise).
 */

import type { GFile, LangRules } from "../anyfacts.ts";
import type { ModuleContext, Resolver } from "../anylink.ts";
import type { PrInfo } from "../github.ts";
import type { Flat } from "../syntax.ts";

export type LanguagePack = {
    /** Short and stable, as reviews store it (`ReviewFile.lang`): the language's usual extension, `py`, `rs`, `rb`. */
    id: string;
    /** What the reader is told: `Python`, in "Downloading the Python parser". */
    name: string;
    /** File extensions, lowercase, without the dot. */
    extensions: readonly string[];
    /** Whole file names, without folders: `/^Dockerfile$/i`. */
    names?: RegExp;
    /** Names a Markdown code fence gives it by besides its extensions: `python`, `golang`. */
    fences?: readonly string[];
    /** The tree-sitter grammars that parse its files, each pinned; with none, its files get cards from `lines` and no links. */
    grammars?: readonly Grammar[];
    /** How its code is coloured; `false` shows it as plain text. Without it, strings, numbers, calls and type names are coloured. */
    highlight?: Highlight | false;
    /** Cards by line patterns, for its files no parser reads. */
    lines?: Lines;
    /** Test files by name, beside the folders (`tests/`) and suffixes (`.test.ts`) every language shares: `_test.go`. */
    tests?: readonly RegExp[];
    /** The test cases a test file's changed lines add or remove, by name. */
    cases?: CaseRule;
    /** How a card joins a member's type to its name. */
    naming?: Naming;
};

/** A tree-sitter grammar, downloaded from jsDelivr at a pinned version and checked against its SHA-256 before it runs. */
export type Grammar = {
    /** What the parser worker asks the driver for, and what kv-storage keeps it as (`wasm:<name>`). */
    name: string;
    /** The extensions it parses, among its pack's. */
    extensions: readonly string[];
    /** The npm package and exact version that hold the wasm file, as jsDelivr serves it. */
    package: string;
    version: string;
    /** The wasm file's path in the package. */
    file: string;
    /** The wasm file's SHA-256, in hex. */
    sha256: string;
    /** Its linker names a method's card with its type (`Server.Start()`): the card's header fits the whole name, and one too narrow drops the type, never the method. */
    typedMethods?: true;
};

export type Highlight = {
    /** Keywords, separated by spaces. */
    keywords?: string;
    /** What starts a line comment: `//`, `#`, `--`. */
    comment?: string;
    /** Whether `/*` opens a block comment. */
    blocks?: true;
    /** `false`: a capitalised word is no type name (SQL). */
    types?: false;
};

/** The kinds of declaration a card can stand for. */
export type UnitKind = "function" | "method" | "class" | "type" | "value" | "namespace";

/** A line pattern: a declaration's first line, by its shape. */
export type LinePattern = {
    re: RegExp;
    kind: UnitKind;
    /** The group holding the name, 1 by default. */
    group?: number;
    /** The group naming the type a method belongs to: Go's receiver. */
    owner?: number;
    /** It holds members: a class, an impl block. */
    container?: boolean;
    /** Only a direct member of a container: a method. */
    inClassOnly?: boolean;
    /** Only at column 0: a module-level value. */
    topOnly?: boolean;
    /** A class field typed as a function across lines (`fetch: (`): only counts when the closing line opens a body. */
    arrowField?: boolean;
};

/** How the line patterns (`symbols.ts`) read a language. */
export type Lines = {
    /** Tried in order on each line; the first that matches declares. */
    patterns?: readonly LinePattern[];
    /** Every pattern starts with a keyword (`def`, `func`, `fn`), so a name after it is never a statement such as `if`. */
    keywordLed?: true;
    /** A line at a declaration's own indent that doesn't end it: Go's labels, which gofmt puts at column 0. */
    inside?: RegExp;
    /** Comment lines beside `//`, `/*` and `*`, which every language shares: `#` lines, Python's docstrings. */
    comments?: RegExp;
};

/**
 * A test case a changed line names: its name, and whether it groups other
 * cases (`describe`). `null`: the line is a case of the language's but names
 * none; `undefined`: it is none of the language's. Every pack's rule is tried
 * on every test file's lines, in `PACKS` order, the first answer winning.
 */
export type CaseRule = (line: string, next: string | undefined) => { name: string; group: boolean } | null | undefined;

export type Naming = {
    /** What joins a member's type to its name: `.` gives `Store.delete()`, `::` gives `Request::new()`. Without it, `delete()`. */
    member?: string;
    /** The word before a container's name: `impl` gives `impl Request`. Without it, `class`. */
    container?: string;
};

/** A declaration a card can stand for. */
export type Unit = {
    /** `path:nameLine`, the id of the card that stands for it. */
    id: string;
    path: string;
    name: string;
    /** How code reaches it: `Hono.onError`, `EventEmitterPrototype.once`, `module.exports.isAuditMode`. */
    qname: string;
    kind: UnitKind;
    /** Offsets of the declaration (modifiers and decorators in, comments out). */
    start: number;
    end: number;
    startLine: number;
    endLine: number;
    nameLine: number;
    /** First line of the comments attached above it. */
    docLine: number;
    nameStart: number;
    /** The id of the unit it is a member of. */
    parent?: string;
    /** The declaration node. */
    node: number;
    /** The function, class or object node the unit's value is, when it has one. */
    valueNode: number;
};

/** How a reference refers: `call` reads as calls, `import` and `export` as imports, any other as uses. */
export type RefKind = "call" | "value" | "type" | "write" | "jsx" | "import" | "export" | "extends";

/** A reference that resolved: where it is, how it refers, and the units it names; `alt`, the one whose card stands for them where they have none (a constructor's class). */
export type Ref = { path: string; start: number; line: number; ref: RefKind; units: Unit[]; alt?: Unit };

/** What the core reads of a parsed file, whichever linker read it; `labels`, the card name of each unit that has its own, by unit id. */
export type Facts = { path: string; flat: Flat; units: Unit[]; labels?: ReadonlyMap<string, string> };

/** How the parser worker reads a language's files into units and references. */
export type Linker = RulesLinker | OwnLinker;

type LinkerBase = {
    /** The packs whose files it reads, which it links together. */
    packs: readonly LanguagePack[];
    /** The text the parser reads in place of a file's, the same length, for a gap in a grammar: TypeScript's call signatures. */
    prepare?: (grammar: string, text: string) => string;
    /** Whether a node at a file's top level imports: a file card whose changed lines all sit in such nodes says `imports`. */
    isImport?: (t: Flat, node: number) => boolean;
    /** Names resolve only inside their own file (Rust, whose crate `mod` tree isn't read): a test file of its own links nothing, so isn't read. */
    local?: true;
};

/**
 * A language the shared linker reads through a rule table: the file index
 * (`anyfacts.ts`) and the resolver (`anylink.ts`) know no language, the
 * table says how this one reads. Every such language is linked in one pass.
 */
export type RulesLinker = LinkerBase & {
    kind: "rules";
    /** The units query: its `definition.*` captures are the declarations a card can stand for. The grammar's own `tags.scm`. */
    units: string;
    rules: LangRules;
    resolver: Resolver;
    /** Files read beside a changed file, the first that answers in each list: `go.mod` above a Go file. */
    configFiles?: (path: string) => string[][];
    /** Whether a module's file is a package, whose imported names may be its submodules: Python's `__init__.py`. */
    isPackage?: (path: string) => boolean;
    /** Files that make a folder a package, nearest first, read until one is missing: the `__init__.py` above a Python file. */
    packageMarkers?: (path: string) => string[];
    /**
     * The files the language's names need, given the files of it read and
     * what the reads found so far (Java's imports, its package's types and
     * supertypes): asked again after each round of reads, until no path is
     * new or `READ.imports` is spent. `changed`: whether the PR changes a file.
     */
    wants?: (files: readonly GFile[], ctx: ModuleContext, changed: (path: string) => boolean) => string[];
};

/** A language with a linker of its own (JavaScript and TypeScript): it indexes, follows and links its files itself. Its hooks take the facts its `index` made. */
export type OwnLinker = LinkerBase & {
    kind: "own";
    /** A parsed file's facts. */
    index(path: string, t: Flat): Facts;
    /** One PR's reading and linking, started before anything is read; `read` reads a path at the head commit once. */
    session(read: (path: string) => Promise<string | null>): OwnSession;
};

/** What an own linker does for one PR, at set points of the read tier (`sources.ts`), then at the link step. */
export type OwnSession = {
    /** Before the changed files are read: those of its packs that parse, in reading order. */
    start?(paths: readonly string[]): void;
    /** Once the changed files are read: more files to read and parse, in this order (the typings a tsconfig names). */
    more?(): Promise<readonly string[]>;
    /** Once the files beside the changed ones are read, before any import is followed. */
    settle?(): Promise<void>;
    /** The files a changed file imports, one answer per import: `first` gives the first of some candidates already read, else the first that exists. */
    imports(f: Facts, first: (candidates: readonly string[]) => Promise<string | null>): Promise<string | null>[];
    /** Every reference in its files that names a unit, files in reading order. */
    link(files: readonly Facts[], pr: PrInfo, changed: ReadonlySet<string>): Ref[];
};
