/**
 * What the build files write for the C files they build, read from their
 * text: a Makefile (`Makefile`, `makefile`, `GNUmakefile`, automake's
 * `Makefile.am`) with the fragments it includes, a `CMakeLists.txt` with the
 * files it includes and the variables of those above it, a `meson.build`.
 * They write include folders (`includes.ts`), macros (`-D`, CMake's compile
 * definitions), headers read before every source (`-include`, precompiled
 * headers), the C files compiled as C++, the C files only some builds
 * compile, and the programs each C file is built into. A target or a Meson
 * dependency a folder's build links gives its usage requirements too (its
 * INTERFACE and PUBLIC definitions, options and folders), found among the
 * build files read, else by following `add_subdirectory()` and `subdir()`.
 *
 * A definition whose name the board can't place (written with a variable no
 * file read sets, made by a Make function, in a generator expression it
 * can't read, or in a Make fragment whose name it can't place), a usage
 * requirement it can't find, or another build system's file (Bazel, SCons,
 * Kbuild) leaves the unit's macros open: any name may be one. Flags from the
 * command line, the environment or what configure writes, and packages the
 * build imports (`find_package`, Meson's `dependency()`), are out of reach.
 */

import { dirOf, normalize, type Search } from "./includes.ts";
import type { Macro } from "./preproc.ts";

/** The build files that may write include folders and macros for a C file: in its folder and each one above, up to the repository's root. */
export const BUILD_FILES = ["Makefile", "makefile", "GNUmakefile", "CMakeLists.txt", "meson.build", "Makefile.am"];
export const buildFilesFor = (path: string): string[] => {
    const dirs = [dirOf(path)];
    for (let d = dirs[0]; d; ) dirs.push((d = dirOf(d)));
    return dirs.flatMap((d) => BUILD_FILES.map((b) => (d ? `${d}/${b}` : b)));
};

/** Other build systems' files: in a C file's folder, and at the repository's root. */
const FOREIGN = ["BUILD", "BUILD.bazel", "SConstruct", "SConscript", "Kbuild"];
const FOREIGN_ROOT = ["WORKSPACE", "MODULE.bazel", "SConstruct"];

/**
 * A C file a build file names: as written, from the build file's folder,
 * and whether only some builds take it (a conditional's branch, a generator
 * expression, a function's body); `match` where the name is computed or a
 * glob (`tls_$(TLS).c`, `src/*.c`, a folder `add_subdirectory(${TLS})`
 * names): every file it may name.
 */
export type Source = { name: string; from: string; conditional: boolean; match?: RegExp };

/** A program or library a build makes: the sources it names, the targets and libraries it links in every build (`uses`), and those it links in some (`branch`: in a conditional's branch). */
export type Target = { name: string; file: string; sources: Source[]; uses: string[]; branch: string[] };

/** CMake's variables: every value each is set to, those set in ways the board doesn't follow (and of them, those a `find_…` or `pkg_check_modules` sets: a system's library), and the module folders set above. */
export type CMakeVars = { vars: Map<string, string[]>; unknown: Set<string>; found: Set<string>; moduleDirs: string[] };

/** What a build file writes for the C files it builds. */
export type BuildInfo = {
    /** Include folders, relative to the repository, and whether one couldn't be placed. */
    dirs: string[];
    open: boolean;
    defines: Macro[];
    /** Whether a definition's name couldn't be placed. */
    openDefines: boolean;
    /** The build files it includes; CMake's modules by name, and the folders they are looked for in. */
    includes: { path: string; optional: boolean }[];
    modules: string[];
    moduleDirs: string[];
    /** Headers the compiler reads before each source: `-include`, `-imacros`, `/FI`, precompiled headers. */
    forced: string[];
    /** The C files it compiles as C++, or `all` (`-x c++`, `CC = g++`). */
    cxx: Source[] | "all";
    sources: Source[];
    targets: Target[];
    /** What it links: CMake targets and libraries, Meson dependencies (as variables); and what each target or dependency gives those that link it. */
    links: string[];
    usage: Map<string, BuildInfo>;
    /** Targets it makes, those it imports, and aliases (each target an alias may stand for); whether it makes a library, or gives usage requirements to a target, whose name it can't place. */
    made: Set<string>;
    imported: Set<string>;
    aliases: Map<string, string[]>;
    unnamed: boolean;
    /** Whether it makes a library (no alias, none imported) whose name it can't place: that may be any plain name, none with `::`. */
    unnamedPlain: boolean;
    /** The folders `add_subdirectory()` or `subdir()` reads next; null where one can't be placed. */
    subdirs: (string | null)[];
    /** CMake's variables as they stand after it. */
    cmake: CMakeVars;
};

const emptyInfo = (): BuildInfo => ({
    dirs: [],
    open: false,
    defines: [],
    openDefines: false,
    includes: [],
    modules: [],
    moduleDirs: [],
    forced: [],
    cxx: [],
    sources: [],
    targets: [],
    links: [],
    usage: new Map(),
    made: new Set(),
    imported: new Set(),
    aliases: new Map(),
    unnamed: false,
    unnamedPlain: false,
    subdirs: [],
    cmake: { vars: new Map(), unknown: new Set(), found: new Set(), moduleDirs: [] },
});

/** A definition a build file writes: `1` without a value, as the compiler takes it. */
const defineOf = (name: string, params: string | null, value: string | undefined, file: string): Macro => {
    const list = params === null ? null : params.split(",").map((p) => p.trim()).filter(Boolean);
    const variadic = !!list && list.length > 0 && list[list.length - 1].endsWith("...");
    const body = value === undefined ? "1" : value.replace(/^'([\s\S]*)'$/, "$1").replace(/\\(.)/g, "$1");
    return { name, params: list ? list.map((p) => (p === "..." ? "__VA_ARGS__" : p.replace(/\.\.\.$/, ""))) : null, variadic, body, start: 0, file };
};

/** Where a flag may start: the text's start, or after a space, a quote, a bracket, a comma, `=` or `;`. */
const AT = String.raw`(?:^|(?<=[\s'"(,=[;]))`;
/** A definition (`-DNAME`, `-D NAME=value`, `-D'f(x)=…'`, MSVC's `/DNAME`) or an undefinition (`-UNAME`). */
const DEFINE_FLAG = new RegExp(String.raw`${AT}([-/])([DU])[ \t]*['"]?([A-Za-z_]\w*)(\(([^)]*)\))?(?:=((?:"[^"]*"|'[^']*'|\\.|[^\s'"])*))?(?=[\s'",)\]]|$)`, "g");
/** A definition whose name the text doesn't hold: `-D$(NAME)`, `-D@DEFS@`, `-D${NAME}`, or a string that ends after `-D` and is added to (Meson's `'-D' + name`). */
const OPEN_DEFINE = new RegExp(String.raw`${AT}-D[ \t]*(?:['"]?[$@]|['"]\s*\+)`);
const FORCED = new RegExp(String.raw`${AT}(?:-include|-imacros|/FI)[ \t]*['"]?([^\s'",)]+)`, "g");
const AS_CXX = new RegExp(String.raw`${AT}(?:-x[ \t]*c\+\+|--language=c\+\+|[-/]TP)(?=[\s'",)]|$)`);
/** How many values one CMake argument may stand for, and how long one expansion may grow: past either, the unit's macros are open. */
const VALUES_CAP = 512;
const CHARS_CAP = 65_536;
/** How much a Make file's lines may expand to, all told. */
const EXPANDED_CAP = 1 << 20;
/** A bound an expansion may meet; `hit` once one did. */
type Bound = { hit: boolean };

/** Options whose value is the next argument where written apart (`-include mock.h`, `-D NAME`, `-x c++`). */
const TAKES_NEXT = /^(?:-include|-imacros|-D|-U|-x|\/D|\/U|\/FI|-isystem|-iquote|-I)$/;

/** The compiler flags a text writes: definitions, headers read first, and C compiled as C++. */
const flagsIn = (text: string, file: string, into: BuildInfo) => {
    for (const m of text.matchAll(DEFINE_FLAG)) into.defines.push(defineOf(m[3], m[2] === "U" || m[4] === undefined ? null : m[5], m[2] === "U" ? undefined : m[6], file));
    if (OPEN_DEFINE.test(text)) into.openDefines = true;
    for (const m of text.matchAll(FORCED)) into.forced.push(m[1]);
    if (AS_CXX.test(text)) into.cxx = "all";
};

/** Options as one string each: CMake's `SHELL:` prefix dropped, and an option written apart from its value joined to it (`-include`, `mock.h`). */
const joinOptions = (args: readonly string[]): string[] => {
    const out: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i].replace(/^SHELL:/, "");
        out.push(TAKES_NEXT.test(a) && i + 1 < args.length ? `${a} ${args[++i].replace(/^SHELL:/, "")}` : a);
    }
    return out;
};

/** Whether a Make text, as written, makes a definition or a header read first with a function that builds words (`$(addprefix -D,…)`, `$(patsubst %,-D%,…)`, `$(foreach …)`, `$(call …)`, `$(let …)`): its names can't be placed. One that picks among flags written elsewhere (`$(filter -DX,$(CFLAGS))`) makes none. */
const madeByFunction = (text: string): boolean => {
    for (const m of text.matchAll(/\$\((?:addprefix|addsuffix|patsubst|subst|foreach|call|eval|value|shell|join|file|let)\s/g)) {
        let depth = 0;
        let end = m.index!;
        for (; end < text.length; end++) {
            if (text[end] === "(") depth++;
            else if (text[end] === ")" && --depth === 0) break;
        }
        if (/(?:^|[\s,%'"])(?:-D|-U|\/D|-include|-imacros)/.test(text.slice(m.index!, end + 1))) return true;
    }
    return false;
};

/** CMake's own variables that place a source or a folder (`${CMAKE_CURRENT_SOURCE_DIR}/io.c`): read as where they are, not as a choice. */
const PLACES = /^(?:CMAKE_CURRENT_SOURCE_DIR|CMAKE_CURRENT_LIST_DIR|CMAKE_CURRENT_BINARY_DIR|CMAKE_SOURCE_DIR|CMAKE_BINARY_DIR|PROJECT_SOURCE_DIR|PROJECT_BINARY_DIR|srcdir|abs_srcdir|top_srcdir|abs_top_srcdir|builddir|abs_builddir|top_builddir|abs_top_builddir|CURDIR)$/;

/** The files a computed or globbed name may be, as a pattern over the repository's paths: each variable or `*` one folder's part, `**` any. */
const patternOf = (name: string, from: string): RegExp | undefined => {
    const out: string[] = [];
    for (const seg of (from ? `${from}/${name}` : name).split("/")) {
        if (seg === "" || seg === ".") continue;
        if (seg === ".." && out.length > 0 && !out[out.length - 1].includes("[^/]")) {
            out.pop();
            continue;
        }
        if (seg === "**") {
            out.push(".*");
            continue;
        }
        out.push(
            seg
                .split(/(\$\([^)]*\)|\$\{[^}]*\}|@\w+@|\*|\?)/)
                .map((part, i) => (i % 2 === 1 ? (part === "?" ? "[^/]" : "[^/]*") : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
                .join("")
        );
    }
    return out.length > 0 ? new RegExp(`^${out.join("/")}$`) : undefined;
};

/** The C files a text names, an object (`.o`, `.lo`, `.obj`) standing for its source; one computed with a variable (`tls_$(TLS).c`) is a pattern of variants, only some builds take. */
const sourcesIn = (text: string, from: string, conditional: boolean, into: Source[]) => {
    for (const m of text.matchAll(/[\w./${}()@+-]*[\w)}@]\.(?:c|o|lo|obj)(?![\w.+])/g)) {
        const name = m[0].replace(/\.(?:o|lo|obj)$/, ".c");
        const computed = /\$[({]|@\w+@/.test(name);
        into.push({ name, from, conditional: conditional || computed, ...(computed ? { match: patternOf(name, from) } : {}) });
    }
};

/** A default the user may change (a CMake cache variable's, Make's `?=`) that is a list of C files alone: each is a variant, as is every C file beside it. */
const chosenIn = (text: string, from: string, into: Source[]) => {
    const words = text.trim().split(/[\s;]+/);
    if (words[0] === "" || words.some((w) => !/^[\w./${}()@+-]*[\w)}@]\.(?:c|o|lo|obj)$/.test(w))) return;
    const named: Source[] = [];
    sourcesIn(text, from, true, named);
    for (const s of named) {
        const glob = `${s.name.includes("/") ? s.name.slice(0, s.name.lastIndexOf("/") + 1) : ""}*.c`;
        into.push(s, { name: glob, from, conditional: true, match: patternOf(glob, from) });
    }
};

/**
 * Whether a source a build file names is the file at `path`: by its pattern
 * where it has one; written from the build file's folder; past a variable
 * that places it, any file it may end; a bare name a build file above gives
 * (Make's VPATH), any file of the name under its folder.
 */
export const sourceNames = (s: Source, path: string): boolean => {
    if (s.match) return s.match.test(path);
    const cut = Math.max(s.name.lastIndexOf(")"), s.name.lastIndexOf("}"), s.name.lastIndexOf("@"));
    if (cut >= 0) {
        const rest = s.name.slice(cut + 1).replace(/^\//, "");
        return rest !== "" && (path === rest || path.endsWith(`/${rest}`));
    }
    if (normalize(s.from ? `${s.from}/${s.name}` : s.name) === path) return true;
    return !s.name.includes("/") && path.endsWith(`/${s.name}`) && (s.from === "" || path.startsWith(`${s.from}/`));
};

/** CMake's words around folders and definitions in the commands that set them. */
const CMAKE_WORDS = new Set(["SYSTEM", "BEFORE", "AFTER", "PUBLIC", "PRIVATE", "INTERFACE", "DIRECTORY", "APPEND", "APPEND_STRING", "PROPERTY", "PROPERTIES", "INCLUDE_DIRECTORIES", "COMPILE_DEFINITIONS", "COMPILE_OPTIONS", "COMPILE_FLAGS", "TARGET", "SOURCE", "GLOBAL", "INSTALL", "CACHE", "TEST", "PARENT_SCOPE", "FORCE", "STRING", "BOOL", "PATH", "FILEPATH", "INTERNAL"]);
/** Words of `add_library()` and `add_executable()` before their sources. */
const TARGET_WORDS = new Set(["STATIC", "SHARED", "MODULE", "OBJECT", "INTERFACE", "UNKNOWN", "IMPORTED", "GLOBAL", "ALIAS", "EXCLUDE_FROM_ALL", "WIN32", "MACOSX_BUNDLE"]);

/** A CMake command: its name, lower-cased, and its arguments, quoted and bracket arguments read whole. */
type Command = { name: string; args: string[] };

/** A CMake file's commands, its comments dropped. */
const cmakeCommands = (text: string): Command[] => {
    const out: Command[] = [];
    const re = /#\[(=*)\[[\s\S]*?\]\1\]|#[^\n]*|"(?:\\[\s\S]|[^"\\])*"|([A-Za-z_]\w*)[ \t]*\(/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
        if (!m[2]) continue;
        const args: string[] = [];
        let depth = 1;
        let i = re.lastIndex;
        let word = "";
        let quoted = false;
        const flush = () => {
            if (word || quoted) args.push(word);
            word = "";
            quoted = false;
        };
        while (i < text.length && depth > 0) {
            const c = text[i];
            if (c === '"') {
                const q = /^"((?:\\[\s\S]|[^"\\])*)"?/.exec(text.slice(i, i + 4096))!;
                word += q[1];
                quoted = true;
                i += q[0].length;
                continue;
            }
            const bracket = c === "[" ? /^\[(=*)\[([\s\S]*?)\]\1\]/.exec(text.slice(i)) : null;
            if (bracket) {
                word += bracket[2];
                quoted = true;
                i += bracket[0].length;
                continue;
            }
            if (c === "#") {
                const nl = text.indexOf("\n", i);
                i = nl < 0 ? text.length : nl;
                continue;
            }
            if (c === "$" && text[i + 1] === "<") {
                // A generator expression, read whole: its `$<…>` nest.
                let d = 0;
                let j = i;
                for (; j < text.length; j++) {
                    if (text[j] === "<" && text[j - 1] === "$") d++;
                    else if (text[j] === ">" && --d === 0) break;
                }
                word += text.slice(i, j + 1);
                i = j + 1;
                continue;
            }
            if (c === "(") depth++;
            else if (c === ")" && --depth === 0) break;
            if (/\s/.test(c) || c === "(" || c === ")") flush();
            else word += c;
            i++;
        }
        flush();
        out.push({ name: m[2].toLowerCase(), args });
        re.lastIndex = i + 1;
    }
    return out;
};

/** The top-level parts of a generator expression's text, split at a separator outside nested `$<…>`. */
const splitTop = (s: string, sep: string, once = false): string[] => {
    const parts: string[] = [];
    let part = "";
    let depth = 0;
    for (let k = 0; k < s.length; k++) {
        if (s[k] === "<" && s[k - 1] === "$") depth++;
        else if (s[k] === ">" && depth > 0) depth--;
        if (s[k] === sep && depth === 0 && !(once && parts.length > 0)) {
            parts.push(part);
            part = "";
        } else part += s[k];
    }
    parts.push(part);
    return parts;
};

/** Generator expressions whose value is their argument where their condition holds. */
const CONDITIONS = /^(?:0|1|BOOL|CONFIG|PLATFORM_ID|C_COMPILER_ID|CXX_COMPILER_ID|C_COMPILER_VERSION|CXX_COMPILER_VERSION|COMPILE_LANGUAGE|COMPILE_LANG_AND_ID|LINK_LANGUAGE|AND|OR|NOT|STREQUAL|EQUAL|VERSION_\w+|TARGET_EXISTS|IN_LIST|BUILD_INTERFACE|BUILD_LOCAL_INTERFACE|LINK_ONLY|TARGET_NAME_IF_EXISTS)$/;

/** The values a text with CMake generator expressions may take, or null where one can't be read (`$<TARGET_PROPERTY:…>`) or they pass VALUES_CAP (`bound` met). */
const genexValues = (s: string, bound: Bound = { hit: false }): string[] | null => {
    const at = s.indexOf("$<");
    if (at < 0) return [s];
    // Past the bound nothing more is read: the unit's macros are open.
    if (bound.hit) return null;
    let end = at;
    for (let d = 0; end < s.length; end++) {
        if (s[end] === "<" && s[end - 1] === "$") d++;
        else if (s[end] === ">" && --d === 0) break;
    }
    const [head, arg = ""] = splitTop(s.slice(at + 2, end), ":", true);
    let values: string[] | null;
    if (head === "IF") {
        const parts = splitTop(arg, ",").slice(1).map((p) => genexValues(p, bound));
        values = parts.some((p) => !p) ? null : parts.flatMap((p) => p!);
    } else if (head === "INSTALL_INTERFACE") values = [];
    else if (head.startsWith("$<") || CONDITIONS.test(head)) values = genexValues(arg, bound);
    else return null;
    const rest = genexValues(s.slice(end + 1), bound);
    if (!values || !rest) return null;
    if (values.length * rest.length > VALUES_CAP) {
        bound.hit = true;
        return null;
    }
    return values.flatMap((v) => rest.map((r) => s.slice(0, at) + v + r));
};

/** Commands that set the variables they are given in ways the board doesn't follow. */
const SETTERS = /^(?:get_\w+|find_\w+|foreach|math|cmake_parse_arguments|file|execute_process|pkg_check_modules|pkg_search_module|try_compile|try_run|check_\w+|separate_arguments|configure_file|cmake_path|set_from_env)$/;

/** The parts of a target command's arguments after the target, by scope (`PUBLIC`, `PRIVATE`, `INTERFACE`); `plain` where no scope is written (`target_link_libraries(t a b)`). */
const scoped = (args: readonly string[]): { scope: string; items: string[] }[] => {
    const out: { scope: string; items: string[] }[] = [{ scope: "plain", items: [] }];
    for (const a of args.slice(1)) {
        if (/^(?:BEFORE|AFTER|SYSTEM)$/.test(a)) continue;
        if (/^(?:PUBLIC|PRIVATE|INTERFACE|LINK_PUBLIC|LINK_PRIVATE|LINK_INTERFACE_LIBRARIES)$/.test(a)) out.push({ scope: a === "LINK_PUBLIC" ? "PUBLIC" : a === "LINK_PRIVATE" ? "PRIVATE" : a === "LINK_INTERFACE_LIBRARIES" ? "INTERFACE" : a, items: [] });
        else out[out.length - 1].items.push(a);
    }
    return out.filter((p) => p.items.length > 0);
};
/** Whether a scope passes on to those that link the target. */
const passesOn = (scope: string) => scope !== "PRIVATE";

/**
 * What a build file writes, its folders relative to the repository: a
 * Makefile's `-I`, `-iquote` and `-isystem` flags, with its own variables and
 * `$(srcdir)` / `$(top_srcdir)` expanded; CMake's `include_directories`,
 * `target_include_directories` and `INCLUDE_DIRECTORIES` property, with the
 * variables it and the files above it set (`outer`) and the source-folder
 * variables; Meson's `include_directories`. A build folder
 * (`$(top_builddir)`, `${CMAKE_CURRENT_BINARY_DIR}`) is read as the source
 * folder it mirrors: in a build in the source tree it is that folder, and
 * out of it it holds only what the build writes, which no read finds in
 * either case. A folder written with anything else (a variable set
 * elsewhere) leaves the search open; one outside the repository holds a
 * system's or a library's headers. The macros are every `-D` flag, and
 * CMake's compile definitions.
 */
export const readBuildFile = (buildPath: string, text: string, textOf: (path: string) => string | undefined = () => undefined, outer?: CMakeVars): BuildInfo => {
    const dir = dirOf(buildPath);
    const info = emptyInfo();
    /** Met when an expansion grows past its bound: then the unit's macros are open. */
    const bound: Bound = { hit: false };
    /** The C files the build writes (a custom command's output, a Make rule's target with a recipe): a computed name among them is no variant of the repository's files. */
    const generated: Source[] = [];
    const root = dir ? dir.split("/").map(() => "..").join("/") : ".";
    /** A folder above, as a path from this file's. */
    const up = (d: string) => (d === dir ? "." : dir.split("/").slice(d ? d.split("/").length : 0).map(() => "..").join("/"));
    const place = (rel: string) => normalize(dir ? `${dir}/${rel}` : rel);
    /** A folder into `into`'s; `system` where the compiler searches it after every `-I` folder (`-isystem`, CMake's `SYSTEM`), so it hides none of theirs. */
    const keep = (rel: string, system = false, into: BuildInfo = info) => {
        // A folder outside the repository holds a system's or a library's headers, as the compiler's own folders do.
        if (rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) return;
        if (rel.includes("$") || rel.includes("@")) {
            if (!system) into.open = true;
            return;
        }
        const p = place(rel);
        if (p === null) into.open = true;
        else if (!into.dirs.includes(p)) into.dirs.push(p);
    };
    const name = buildPath.split("/").pop()!;
    const body = text.replace(/\\\r?\n/g, " ");
    if (name === "CMakeLists.txt") {
        // The project's folder is the nearest above with a `project()` call; the top one, the outermost CMake file's.
        const above: string[] = [];
        for (let d = dir; ; d = dirOf(d)) {
            above.push(d);
            if (!d) break;
        }
        const cmake = above.filter((d) => d === dir || textOf(d ? `${d}/CMakeLists.txt` : "CMakeLists.txt") !== undefined);
        const project = cmake.find((d) => /\bproject\s*\(/i.test(d === dir ? body : textOf(d ? `${d}/CMakeLists.txt` : "CMakeLists.txt")!));
        const top = cmake[cmake.length - 1];
        const fixed = new Map<string, string>([["CMAKE_CURRENT_SOURCE_DIR", "."], ["CMAKE_CURRENT_LIST_DIR", "."], ["CMAKE_CURRENT_BINARY_DIR", "."], ["CMAKE_SOURCE_DIR", up(top)], ["CMAKE_BINARY_DIR", up(top)]]);
        if (project !== undefined) for (const v of ["PROJECT_SOURCE_DIR", "PROJECT_BINARY_DIR"]) fixed.set(v, up(project));
        const commands = cmakeCommands(body);
        // Every value each variable is set to, here and above: which one a build takes, the board can't tell.
        const vars = new Map(outer?.vars ?? []);
        const unknown = new Set(outer?.unknown ?? []);
        const found = new Set(outer?.found ?? []);
        info.moduleDirs.push(...(outer?.moduleDirs ?? []));
        const assign = (v: string, values: string[]) => vars.set(v, [...(vars.get(v) ?? []), ...values]);
        const lose = (v: string) => {
            if (/^[A-Za-z_][\w-]*$/.test(v)) unknown.add(v);
        };
        // The files each glob names, and the globs a list filter or removal narrows afterwards: only some builds take what those match.
        const globs = new Map<string, string[]>();
        const narrowed = new Set<string>();
        for (const c of commands) {
            const [first, ...rest] = c.args;
            if (!first) continue;
            if (c.name === "set") assign(first, rest.slice(0, rest.includes("CACHE") ? rest.indexOf("CACHE") : undefined).filter((a) => a !== "PARENT_SCOPE"));
            else if (c.name === "project") assign("PROJECT_NAME", [first]);
            else if (c.name === "list" && rest[0]) {
                if (first === "APPEND" || first === "PREPEND") assign(rest[0], rest.slice(1));
                else if (first === "INSERT") assign(rest[0], rest.slice(2));
                else if (first === "TRANSFORM" || first === "FILTER") lose(rest[0]);
                else if (/^(?:GET|JOIN|SUBLIST|FIND|LENGTH|POP_BACK|POP_FRONT)$/.test(first)) lose(rest[rest.length - 1]);
                if (/^(?:FILTER|REMOVE_ITEM|REMOVE_AT|REMOVE_DUPLICATES|POP_BACK|POP_FRONT|TRANSFORM)$/.test(first)) narrowed.add(rest[0]);
            } else if (c.name === "string") {
                if ((first === "APPEND" || first === "PREPEND") && rest[0]) assign(rest[0], [rest.slice(1).join("")]);
                else rest.forEach(lose);
            } else if (c.name === "foreach") {
                // The loop's variable takes each item it walks: written, or a list's (`IN LISTS L`).
                const at = rest.indexOf("IN");
                const walked = at < 0 ? rest : rest.slice(at + 1).flatMap((a, i, all) => (/^(?:LISTS|ITEMS|ZIP_LISTS)$/.test(a) ? [] : all.slice(0, i).includes("LISTS") && !all.slice(0, i).includes("ITEMS") ? [`\${${a}}`] : [a]));
                assign(first, walked);
            } else if (SETTERS.test(c.name)) {
                c.args.forEach(lose);
                if (/^(?:find_library|find_package|find_path|find_file|find_program|pkg_check_modules|pkg_search_module)$/.test(c.name)) found.add(first);
            }
            if (c.name === "file" && /^GLOB(?:_RECURSE)?$/.test(first) && rest[0]) {
                const patterns = rest.slice(1).filter((a) => !/^(?:LIST_DIRECTORIES|RELATIVE|CONFIGURE_DEPENDS|FOLLOW_SYMLINKS|true|false)$/i.test(a));
                globs.set(rest[0], [...(globs.get(rest[0]) ?? []), ...patterns.map((p) => (first === "GLOB_RECURSE" ? p.replace(/([^/]*)$/, "**/$1") : p))]);
            }
        }
        info.cmake = { vars, unknown, found, moduleDirs: info.moduleDirs };
        const over = (): null => {
            bound.hit = true;
            return null;
        };
        /**
         * A CMake argument with its variables expanded: every value each may
         * hold; null where one isn't set in a way the board follows, or lies
         * more than eight variables deep. A variable met again inside its own
         * values (`set(L ${L} x)`) adds nothing to every value it is set to.
         * Past VALUES_CAP values or CHARS_CAP characters it stops: the bound
         * is met.
         */
        const expandIn = (s: string, path: readonly string[]): string[] | null => {
            if (bound.hit) return null;
            const parts = s.split(/\$\{([A-Za-z_][\w-]*)\}/);
            let acc = [parts[0]];
            for (let i = 1; i < parts.length; i += 2) {
                const v = parts[i];
                let values: string[] = [];
                if (fixed.has(v)) values = [fixed.get(v)!];
                else if (path.includes(v)) values = [""];
                else if (unknown.has(v) || !vars.has(v)) {
                    // CMake's own variables come from the command line or the toolchain: out of reach, as the command line is.
                    if (!/^CMAKE_/.test(v)) return null;
                    values = [""];
                } else {
                    if (path.length >= 8) return null;
                    for (const raw of vars.get(v)!.flatMap((x) => x.split(";"))) {
                        const e = expandIn(raw, [...path, v]);
                        if (!e) return null;
                        for (const x of e) values.push(...x.split(";"));
                        if (values.length > VALUES_CAP) return over();
                    }
                }
                if (values.length === 0) values = [""];
                if (acc.length * values.length > VALUES_CAP) return over();
                const next: string[] = [];
                let size = 0;
                for (const a of acc) {
                    for (const x of values) {
                        const y = a + x + parts[i + 1];
                        size += y.length;
                        next.push(y);
                    }
                }
                if (size > CHARS_CAP) return over();
                acc = next;
            }
            return acc;
        };
        const expand = (s: string): string[] | null => expandIn(s, []);
        const one = (s: string) => {
            const e = expand(s);
            return e && e.length === 1 ? e[0] : null;
        };
        /** A name with only the variables that place it expanded (`${CMAKE_CURRENT_SOURCE_DIR}/io.c`); any other stays a choice. */
        const located = (s: string) => s.replace(/\$\{([A-Za-z_]\w*)\}/g, (all, v) => (fixed.has(v) ? fixed.get(v)! : all));
        /** Each value a definitions argument may hold, its generator expressions and variables read (a condition's variables don't matter); null where one can't be. */
        const values = (raw: string): string[] | null => {
            const out: string[] = [];
            for (const v of genexValues(raw, bound) ?? [null]) {
                for (const x of (v === null ? null : expand(v)) ?? [null]) {
                    for (const part of x === null ? [null] : x.split(";")) {
                        const g = part === null ? null : genexValues(part, bound);
                        if (!g) return null;
                        out.push(...g.flatMap((y) => y.split(";")).filter((y) => y.trim()));
                    }
                }
            }
            return out;
        };
        /** A compile definition: `NAME`, `NAME=value`, `-DNAME`. */
        const define = (raw: string, into: BuildInfo = info) => {
            const all = values(raw);
            if (!all) into.openDefines = true;
            for (const v of all ?? []) {
                const d = /^(?:-D|\/D)?\s*([A-Za-z_]\w*)(\(([^)]*)\))?(?:=([\s\S]*))?$/.exec(v.trim());
                if (d) into.defines.push(defineOf(d[1], d[2] !== undefined ? d[3] : null, d[4], buildPath));
                else into.openDefines = true;
            }
        };
        /** Compile options: their definitions, headers read first, `-x c++`; options held in a variable not set in a way followed are the command line's, as CMake's own are. */
        const flags = (raw: readonly string[], into: BuildInfo = info) => {
            const expanded = raw.flatMap((a) => values(a) ?? [a.replace(/\$\{[^}]*\}/g, " ")]);
            for (const v of joinOptions(expanded)) flagsIn(v, buildPath, into);
        };
        /** A link item's values: each variable's values in turn, a value the board can't place kept as written (a library file's path, a package's variable). */
        const linkValues = (item: string): string[] => {
            const out = new Set<string>();
            // Each variable once: one that names itself (`set(LIBS ${LIBS} m)`) adds nothing to every value it is set to.
            const walked = new Set<string>();
            const todo = [item];
            while (todo.length > 0 && out.size <= VALUES_CAP) {
                const x = todo.pop()!;
                const whole = /^\$\{([A-Za-z_][\w-]*)\}$/.exec(x);
                // A library a `find_…` found is the system's.
                if (whole && found.has(whole[1])) continue;
                if (whole && vars.has(whole[1]) && !unknown.has(whole[1])) {
                    if (walked.has(whole[1])) continue;
                    walked.add(whole[1]);
                    const values = vars.get(whole[1])!.flatMap((v) => v.split(";"));
                    for (let k = values.length - 1; k >= 0; k--) todo.push(values[k]);
                    continue;
                }
                for (const y of expand(x)?.flatMap((z) => z.split(";")) ?? [x]) out.add(y);
            }
            if (out.size > VALUES_CAP) bound.hit = true;
            return [...out];
        };
        /** What a target gives those that link it. */
        const usageOf = (t: string) => {
            let u = info.usage.get(t);
            if (!u) info.usage.set(t, (u = emptyInfo()));
            return u;
        };
        /** A target's sources: each named, and a glob's patterns. */
        const targetOf = (t: string) => {
            let target = info.targets.find((x) => x.name === t);
            if (!target) info.targets.push((target = { name: t, file: buildPath, sources: [], uses: [], branch: [] }));
            return target;
        };
        const addSources = (target: Target, items: readonly string[], inBranch: boolean) => {
            for (const item of items) {
                if (TARGET_WORDS.has(item) || CMAKE_WORDS.has(item)) continue;
                const glob = /^\$\{(\w+)\}$/.exec(item);
                if (glob && globs.has(glob[1])) {
                    for (const p of globs.get(glob[1])!) target.sources.push({ name: p, from: dir, conditional: false, match: patternOf(located(p), dir) });
                    continue;
                }
                for (const x of expand(item) ?? []) {
                    for (const y of x.split(";")) {
                        // An object library's files (`$<TARGET_OBJECTS:core>`) are the target's as a link's are.
                        const objects = /^\$<TARGET_OBJECTS:([^>]+)>$/.exec(y);
                        if (objects) (inBranch ? target.branch : target.uses).push(objects[1]);
                        else sourcesIn(y, dir, false, target.sources);
                    }
                }
            }
        };
        let depth = 0;
        for (const c of commands) {
            const args = c.args;
            if (/^(?:if|foreach|while|function|macro|block)$/.test(c.name)) depth++;
            else if (/^end(?:if|foreach|while|function|macro|block)$/.test(c.name)) depth = Math.max(0, depth - 1);
            if (!/^(?:if|elseif|while|message|option)$/.test(c.name)) for (const a of args) if (!a.includes("\n")) sourcesIn(located(a), dir, depth > 0 || a.includes("$<"), info.sources);
            if (c.name === "set" && args.includes("CACHE") && args[args.indexOf("CACHE") + 1] !== "INTERNAL") chosenIn(args.slice(1, args.indexOf("CACHE")).map(located).join(" "), dir, info.sources);
            if (c.name === "include" && args[0]) {
                const p = one(args[0]);
                if (p === null) info.openDefines = true;
                else if (p.includes("/") || /\.cmake$/i.test(p)) {
                    const at = place(p);
                    if (at !== null && !p.startsWith("/")) info.includes.push({ path: at, optional: args.includes("OPTIONAL") });
                } else info.modules.push(p);
                continue;
            }
            if ((c.name === "set" || c.name === "list") && args.includes("CMAKE_MODULE_PATH")) {
                for (const a of args.slice(args.indexOf("CMAKE_MODULE_PATH") + 1)) {
                    for (const x of expand(a) ?? []) {
                        const at = x && !x.startsWith("/") ? place(x) : null;
                        if (at !== null && !info.moduleDirs.includes(at)) info.moduleDirs.push(at);
                    }
                }
                continue;
            }
            if (c.name === "add_subdirectory" && args[0]) {
                const p = located(args[0]);
                if (/\$\{|\$</.test(p)) {
                    // A folder a variable picks (`backends/${TLS}`): each file under any folder it may name is a variant.
                    info.sources.push({ name: `${p}/**`, from: dir, conditional: true, match: patternOf(`${p}/**`, dir) });
                    info.subdirs.push(null);
                } else info.subdirs.push(place(p));
                continue;
            }
            if (c.name === "add_library" || c.name === "add_executable") {
                const t = one(args[0] ?? "");
                // A program is linked by none; a library whose name a variable holds may be any linked name.
                if (t === null) {
                    // An alias may be any linked name; another library any plain one (only an alias or an imported target is named with `::`); an imported one gives nothing of the build's own.
                    if (args.includes("ALIAS")) info.unnamed = true;
                    else if (!args.includes("IMPORTED")) info.unnamedPlain ||= c.name === "add_library";
                    continue;
                }
                if (args.includes("IMPORTED")) info.imported.add(t);
                else if (args.includes("ALIAS")) info.aliases.set(t, expand(args[args.indexOf("ALIAS") + 1] ?? "") ?? []);
                else {
                    info.made.add(t);
                    addSources(targetOf(t), args.slice(1), depth > 0);
                }
                continue;
            }
            if (c.name === "target_sources") {
                const t = one(args[0] ?? "");
                if (t !== null) addSources(targetOf(t), args.slice(1).filter((a) => !/^(?:PUBLIC|PRIVATE|INTERFACE|FILE_SET|TYPE|BASE_DIRS|FILES|HEADERS|CXX_MODULES)$/.test(a)), depth > 0);
                continue;
            }
            if (c.name === "target_link_libraries" || c.name === "link_libraries") {
                const t = c.name === "link_libraries" ? null : one(args[0] ?? "");
                for (const part of c.name === "link_libraries" ? [{ scope: "plain", items: args }] : scoped(args)) {
                    for (const item of part.items.flatMap((x) => linkValues(x))) {
                        info.links.push(item);
                        // What a target links in every build, and what in some (Windows' alone, as hiredis_ssl links hiredis).
                        if (t !== null) (depth === 0 ? targetOf(t).uses : targetOf(t).branch).push(item);
                        if (t !== null && passesOn(part.scope)) usageOf(t).links.push(item);
                        else if (t === null && c.name !== "link_libraries" && part.scope !== "plain" && passesOn(part.scope)) info.unnamed = true;
                    }
                }
                continue;
            }
            if (c.name === "target_include_directories" || c.name === "include_directories" || (/^set_(?:property|directory_properties|target_properties)$/.test(c.name) && args.includes("INCLUDE_DIRECTORIES"))) {
                const system = args.includes("SYSTEM");
                const t = c.name === "target_include_directories" ? one(args[0] ?? "") : null;
                const parts = c.name === "target_include_directories" ? scoped(args) : [{ scope: "plain", items: args }];
                for (const part of parts) {
                    for (const a of part.items) {
                        if (CMAKE_WORDS.has(a) || (c.name.startsWith("set_") && !/[/.$]/.test(a))) continue;
                        // A folder for those who install the library, not for its build.
                        if (a.startsWith("$<INSTALL_INTERFACE:")) continue;
                        const d = a.replace(/^\$<BUILD_INTERFACE:([^>]*)>$/, "$1");
                        keep(one(d) ?? d, system);
                        if (t !== null && part.scope !== "plain" && passesOn(part.scope)) keep(one(d) ?? d, system, usageOf(t));
                    }
                }
            }
            if (c.name === "add_compile_definitions") args.forEach((a) => define(a));
            else if (c.name === "target_compile_definitions" || c.name === "target_compile_options" || c.name === "target_precompile_headers") {
                const t = one(args[0] ?? "");
                for (const part of scoped(args)) {
                    const items = part.items.filter((a) => !CMAKE_WORDS.has(a) && a !== "REUSE_FROM");
                    if (t === null && passesOn(part.scope)) info.unnamed = true;
                    const intos = t !== null && passesOn(part.scope) ? [info, usageOf(t)] : [info];
                    for (const into of intos) {
                        if (c.name === "target_compile_definitions") items.forEach((a) => define(a, into));
                        else if (c.name === "target_compile_options") flags(items, into);
                        else into.forced.push(...items);
                    }
                }
            } else if (c.name === "add_definitions") {
                const joined = joinOptions(args);
                joined.forEach((a) => (/^(?:[-/]D|\$)/.test(a) ? define(a) : flags([a])));
            } else if (c.name === "add_compile_options") flags(args.filter((a) => !CMAKE_WORDS.has(a)));
            else if (/^set_(?:property|target_properties|source_files_properties|directory_properties)$/.test(c.name)) {
                // `PROPERTY name values…`, or `PROPERTIES name value …` in pairs.
                const multi = args.indexOf("PROPERTIES");
                const at = multi >= 0 ? multi : args.indexOf("PROPERTY");
                if (at < 0) continue;
                const props = args.slice(at + 1);
                // The targets a property is set on (`set_property(TARGET a b …)`, `set_target_properties(a b PROPERTIES …)`): an INTERFACE_ one is what each passes on, not the folder's own.
                const onTargets = c.name === "set_target_properties" ? args.slice(0, at) : c.name === "set_property" && args[0] === "TARGET" ? args.slice(1, at).filter((a) => !/^(?:APPEND|APPEND_STRING)$/.test(a)) : null;
                for (let i = 0; i < props.length; i += multi >= 0 ? 2 : props.length) {
                    const key = props[i];
                    const vals = multi >= 0 ? props.slice(i + 1, i + 2) : props.slice(1);
                    const passed = onTargets && /^INTERFACE_(?:COMPILE_DEFINITIONS|COMPILE_OPTIONS|INCLUDE_DIRECTORIES)$/.test(key) ? onTargets.map((x) => one(x)) : null;
                    if (passed?.some((x) => x === null)) info.unnamed = true;
                    const intos = passed ? passed.flatMap((x) => (x === null ? [] : [usageOf(x)])) : [info];
                    if (/^(?:INTERFACE_)?COMPILE_DEFINITIONS(?:_\w+)?$/.test(key)) for (const into of intos) vals.forEach((v) => define(v, into));
                    else if (/^(?:INTERFACE_)?COMPILE_(?:OPTIONS|FLAGS)$/.test(key)) for (const into of intos) flags(vals, into);
                    else if (key === "INTERFACE_INCLUDE_DIRECTORIES" && passed) for (const into of intos) for (const v of vals.flatMap((x) => x.split(";"))) keep(one(v) ?? v, false, into);
                    else if (key === "LANGUAGE" && vals.some((v) => /^CXX$/i.test(v)) && (c.name === "set_source_files_properties" || args[0] === "SOURCE")) {
                        // The files before the properties: each named, or every one where a variable names them.
                        for (const f of args.slice(c.name === "set_property" ? 1 : 0, at).filter((a) => !CMAKE_WORDS.has(a))) {
                            const e = expand(f);
                            if (!e) info.cxx = "all";
                            else if (info.cxx !== "all") for (const x of e.flatMap((y) => y.split(";"))) if (x) info.cxx.push({ name: x, from: dir, conditional: false });
                        }
                    }
                }
            } else if ((c.name === "set" || c.name === "string" || c.name === "list") && args.some((a) => /^CMAKE_C_FLAGS\w*$/.test(a))) flags(args.filter((a) => !/^(?:APPEND|PREPEND|CMAKE_C_FLAGS\w*)$/.test(a)));
        }
        // A glob a filter narrows later: only some builds take each file it matches.
        for (const [v, patterns] of globs) for (const p of patterns) info.sources.push({ name: p, from: dir, conditional: narrowed.has(v), match: patternOf(located(p), dir) });
        // What the build writes: a custom command's outputs and by-products, `configure_file()`'s and `file()`'s.
        for (const c of commands) {
            const [first, ...rest] = c.args;
            if (c.name === "add_custom_command" || c.name === "add_custom_target") {
                let on = false;
                for (const a of c.args) {
                    if (/^(?:OUTPUT|BYPRODUCTS)$/.test(a)) on = true;
                    else if (/^[A-Z][A-Z_]+$/.test(a)) on = false;
                    else if (on) sourcesIn(located(a), dir, false, generated);
                }
            } else if (c.name === "configure_file" && rest[0]) sourcesIn(located(rest[0]), dir, false, generated);
            else if (c.name === "file" && /^(?:WRITE|APPEND|GENERATE|CONFIGURE|COPY_FILE)$/.test(first ?? "")) {
                const out = /^(?:GENERATE|CONFIGURE)$/.test(first) ? rest[rest.indexOf("OUTPUT") + 1] : first === "COPY_FILE" ? rest[1] : rest[0];
                if (out) sourcesIn(located(out), dir, false, generated);
            }
        }
    } else if (name === "meson.build") {
        for (const m of body.matchAll(/\binclude_directories\s*\(([^)]*)\)/g)) {
            for (const a of m[1].matchAll(/'([^']*)'/g)) keep(a[1]);
            // A folder held in a variable or built by a function: not placed.
            if (/[A-Za-z_]/.test(m[1].replace(/'[^']*'|\b\w+\s*:\s*\w+/g, ""))) info.open = true;
        }
        /** The strings of a text, each a list's item, an option written apart from its value joined to it (`'-include', 'mock.h'`). */
        const items = (s: string) => joinOptions([...s.matchAll(/'((?:\\.|[^'\\])*)'/g)].map((m) => m[1]));
        flagsIn(body, buildPath, info);
        for (const item of items(body)) flagsIn(item, buildPath, info);
        // An option whose value isn't the next string (`'-D', name`, `'-include' + x`): not placed.
        if (/'(?:-[DU]|-include|-imacros)'\s*(?:\+|,(?!\s*')|\])/.test(body)) info.openDefines = true;
        let depth = 0;
        for (const line of body.split("\n")) {
            if (/^\s*(?:if|foreach)\b/.test(line)) depth++;
            else if (/^\s*end(?:if|foreach)\b/.test(line)) depth = Math.max(0, depth - 1);
            for (const s of line.matchAll(/'([^']*\.c)'/g)) info.sources.push({ name: s[1], from: dir, conditional: depth > 0 });
            const sub = /^\s*subdir\s*\(\s*(?:'([^']*)'|(.*?))\s*\)/.exec(line);
            if (sub) info.subdirs.push(sub[1] !== undefined ? place(sub[1]) : null);
        }
        /** A call's arguments, from its `(` at `open` to the `)` that closes it. */
        const callAt = (open: number) => {
            let d = 0;
            for (let k = open; k < body.length; k++) {
                if (body[k] === "(" || body[k] === "[") d++;
                else if ((body[k] === ")" || body[k] === "]") && --d === 0) return body.slice(open + 1, k);
            }
            return body.slice(open + 1);
        };
        /** A keyword argument's value: its list's names and strings. */
        const kwarg = (args: string, key: string): string | null => {
            const m = new RegExp(`\\b${key}\\s*:\\s*`).exec(args);
            if (!m) return null;
            const at = m.index + m[0].length;
            return args[at] === "[" ? callAt(at) : (/^[^,)]*/.exec(args.slice(at))?.[0] ?? "");
        };
        /** The variables a value names, as Meson's names (`@meson:`), its calls and keywords aside. */
        const names = (s: string) =>
            [...s.replace(/'(?:\\.|[^'\\])*'/g, " ").matchAll(/\b([A-Za-z_]\w*)\b(?!\s*\()(?!\s*:)/g)].map((m) => m[1]).filter((n) => !/^(?:true|false|and|or|not|if|else|elif|endif|foreach|endforeach|in)$/.test(n)).map((n) => `@meson:${n}`);
        // Variables: a dependency a file declares gives its compile arguments and folders; `dependency()`, libraries found and subprojects are imported; a list or another variable passes on what it names.
        const listOf = (v: string): string | null => {
            const m = new RegExp(`^\\s*${v}\\s*\\+?=\\s*\\[`, "m").exec(body);
            return m ? callAt(m.index + m[0].length - 1) : null;
        };
        for (const m of body.matchAll(/^\s*([A-Za-z_]\w*)\s*(\+?=)\s*(.*)$/gm)) {
            const v = `@meson:${m[1]}`;
            const call = /^(declare_dependency|dependency|subproject|find_library|\w+\.find_library|\w+\.get_variable|\w+\.dependency|\w+\.find_program)\s*\(/.exec(m[3]);
            if (call && call[1] !== "declare_dependency") {
                info.imported.add(v);
                continue;
            }
            const u = info.usage.get(v) ?? emptyInfo();
            if (call) {
                const args = callAt(m.index! + m[0].length - m[3].length + call[0].length - 1);
                const given = kwarg(args, "compile_args");
                const list = given !== null && /^\s*[A-Za-z_]\w*\s*$/.test(given) ? listOf(given.trim()) : given;
                if (given !== null && list === null) u.openDefines = true;
                for (const item of items(list ?? "")) flagsIn(item, buildPath, u);
                for (const d of [...(kwarg(args, "include_directories") ?? "").matchAll(/'([^']*)'/g)]) keep(d[1], false, u);
                u.links.push(...names(kwarg(args, "dependencies") ?? ""));
            } else u.links.push(...names(m[3].startsWith("[") ? callAt(m.index! + m[0].length - m[3].length) : m[3]));
            info.made.add(v);
            info.usage.set(v, u);
        }
        // What the targets use: each `dependencies:` given.
        for (const m of body.matchAll(/\bdependencies\s*:/g)) {
            const at = m.index! + m[0].length;
            const rest = body.slice(at).trimStart();
            const value = rest.startsWith("[") ? callAt(at + body.slice(at).indexOf("[")) : (/^[^,)]*/.exec(rest)?.[0] ?? "");
            info.links.push(...names(value));
        }
        // The programs and libraries: their sources, positional and `sources:`.
        for (const m of body.matchAll(/\b(?:executable|library|shared_library|static_library|both_libraries|shared_module)\s*\(/g)) {
            const args = callAt(m.index! + m[0].length - 1);
            const target: Target = { name: /'([^']*)'/.exec(args)?.[1] ?? "", file: buildPath, sources: [], uses: [], branch: [] };
            for (const s of args.matchAll(/'([^']*\.c)'/g)) target.sources.push({ name: s[1], from: dir, conditional: false });
            info.targets.push(target);
        }
    } else {
        // Make: the variables its text sets (the fragments it includes read into it), expanded where written.
        const vars = new Map<string, string>([
            ["srcdir", "."],
            ["abs_srcdir", "."],
            ["top_srcdir", root],
            ["abs_top_srcdir", root],
            ["CURDIR", "."],
            // The build folders: in a build in the source tree they are its folders; out of it, they hold only what the build writes.
            ["top_builddir", root],
            ["abs_top_builddir", root],
            ["builddir", "."],
            ["abs_builddir", "."],
        ]);
        const lines = body.split("\n");
        // Flags for aclocal, the linker, libraries and other languages' tools name no include folder.
        const compiles = (l: string) => !/^\s*(?:override\s+|export\s+)?(?:ACLOCAL_AMFLAGS|\w*LDFLAGS|\w*LIBADD|\w*LDADD|\w*LIBS|\w*PERL\w*|\w*PYTHON\w*)\s*[+?:]*=/.test(l);
        for (const l of lines) {
            // A recipe's line, a tab first, is a shell command, not an assignment; another tool's flags are none of the compiler's.
            if (l.startsWith("\t") || !compiles(l)) continue;
            const m = /^\s*(?:override\s+|export\s+)?([A-Za-z_][\w.-]*)\s*(\+|\?|::|:)?=\s*(.*)$/.exec(l);
            if (!m || (vars.has(m[1]) && m[2] === "?")) continue;
            const value = m[3].replace(/\s#.*$/, "").trim();
            vars.set(m[1], m[2] === "+" && vars.has(m[1]) ? `${vars.get(m[1])} ${value}` : value);
            // A C compiler that is a C++ one compiles every C file as C++.
            if (/^(?:CC|HOSTCC)$/.test(m[1]) && /(?:^|[\s/])[\w.-]*(?:g|clang|c)\+\+(?:[-\d.]*)?(?:\s|$)|\$[({]CXX[)}]/.test(value)) info.cxx = "all";
        }
        const expand = makeExpander(vars, bound);
        /** A name with only the variables that place it expanded (`$(srcdir)/io.c`, a folder set in the file); any other stays a choice (`tls_$(TLS).c`). */
        const located = (s: string) => s.replace(/\$[({]([A-Za-z_][\w.-]*)[)}]/g, (all, v) => (PLACES.test(v) || (vars.has(v) && /^\.{0,2}(?:\/[\w.-]+)*$|^[\w.-]+\//.test(vars.get(v)!) && /[./]/.test(vars.get(v)!)) ? expand(vars.get(v) ?? all) : all));
        for (const l of lines.filter(compiles)) for (const m of expand(l).matchAll(/(?:^|\s)(-I|-iquote|-isystem)\s*([^\s'"]+)/g)) keep(m[2], m[1] === "-isystem");
        let depth = 0;
        /** Automake's sources of each program or library (`curl_SOURCES = …`, in a `Makefile.am` only), and a rule's objects (`app: main.o io.o`). */
        const targets = new Map<string, Target>();
        const automake = name === "Makefile.am";
        /** Whether a rule's target is a program or a library (`app`, `libfoo.a`, `$(PROG)`), not an object, a header or a source. */
        const linked = (t: string) => {
            const base = expand(t).split("/").pop()!;
            return /\$[({]/.test(base) || !/\.\w+$/.test(base) || /\.(?:a|so|la|dylib|dll|exe|lib|wasm|js|elf|bin|out)(?:\.\d+)*$/.test(base);
        };
        for (const [i, l] of lines.entries()) {
            if (l.startsWith("\t")) continue;
            // A C file a rule with a recipe makes, or one automake builds, cleans or doesn't ship.
            const made = /^([^\s:=#][^:=#]*?)\s*::?(?!=)([^;]*)(;?)/.exec(l);
            if (made && (made[3] || lines[i + 1]?.startsWith("\t"))) for (const t of made[1].trim().split(/\s+/)) if (/\.c$/.test(t)) sourcesIn(located(t), dir, false, generated);
            const listed = /^\s*(?:BUILT_SOURCES|CLEANFILES|DISTCLEANFILES|MOSTLYCLEANFILES|MAINTAINERCLEANFILES|nodist_\w+_SOURCES)\s*\+?=\s*(.*)$/.exec(l);
            if (listed) sourcesIn(located(listed[1]), dir, false, generated);
        }
        // Targets a rule names that no file is made for (`.PHONY: all o`).
        const phony = new Set(lines.flatMap((l) => /^\.PHONY\s*:(.*)$/.exec(l)?.[1].trim().split(/\s+/) ?? []));
        for (const [i, l] of lines.entries()) {
            // Past the bound the file's macros are open: nothing more to read.
            if (bound.hit) break;
            const recipe = l.startsWith("\t");
            // Make's own include directives are no compiler flag.
            if (!recipe && /^\s*(?:-?include|sinclude)\s/.test(l)) continue;
            const e = expand(l);
            if (!recipe) {
                if (/^\s*(?:ifeq|ifneq|ifdef|ifndef)\b|^\s*if\s+!?\w+\s*$/.test(l)) depth++;
                else if (/^\s*endif\b/.test(l)) depth = Math.max(0, depth - 1);
                // Where written: a variable's value in a branch is the branch's, wherever the variable is used; a list a variable names (Kbuild's `obj-$(CONFIG_X) += x.o`) is a branch too, as automake's sources some builds pick (`EXTRA_app_SOURCES`) are.
                const kbuild = /^\s*[\w.-]*\$[({][^)}]*[)}][\w.$(){}-]*\s*[+:?]?=/.test(l);
                const extra = automake && /^\s*EXTRA_\w+_SOURCES\s*\+?=/.test(l);
                sourcesIn(located(l), dir, depth > 0 || kbuild || extra, info.sources);
                const chosen = /^\s*(?:override\s+|export\s+)?[A-Za-z_][\w.-]*\s*\?=(.*)$/.exec(l);
                if (chosen) chosenIn(located(chosen[1]), dir, info.sources);
                const am = automake ? /^\s*(?:nodist_|dist_)?([A-Za-z_]\w*)_SOURCES\s*\+?=\s*(.*)$/.exec(l) : null;
                // A rule, its prerequisites holding no `=` but in a substitution reference (`$(SRCS:.c=.o)`): not a target's variable.
                const ruled = /^([\w.$(){}/-]+)\s*:(?!=)\s*(.*)$/.exec(l);
                const rule = ruled && !/=/.test(ruled[2].replace(/\$[({][^)}]*[)}]/g, "")) ? ruled : null;
                // A rule makes a program where it links objects with a recipe, and no `.PHONY` names it (lua's `o: $(ALL_O)` makes none).
                const program = !am && rule && !/^\./.test(rule[1]) && !phony.has(rule[1]) && /\.(?:o|c)\b/.test(expand(rule[2])) && linked(rule[1]) && lines[i + 1]?.startsWith("\t");
                const libs = automake ? /^\s*([A-Za-z_]\w*)_(?:LDADD|LIBADD)\s*\+?=\s*(.*)$/.exec(l) : null;
                for (const [t, list] of am && am[1] !== "BUILT" && !extra ? [[am[1], am[2]]] : program ? [[expand(rule[1]), rule[2]]] : libs ? [[libs[1], ""]] : []) {
                    let target = targets.get(t);
                    if (!target) targets.set(t, (target = { name: t, file: buildPath, sources: [], uses: [], branch: [] }));
                    // A program's sources as the file sets them, its own variables expanded; what else it links: a library a rule of the file makes (`$(CORE_T)`), automake's `LDADD`.
                    const all = expand(list);
                    sourcesIn(all, dir, false, target.sources);
                    for (const w of [...all.split(/\s+/), ...(libs ? expand(libs[2]).split(/\s+/) : [])]) if (w && !/\.(?:c|o|lo|obj|h)$/.test(w)) target.uses.push(automake ? w.replace(/[^\w]/g, "_") : w);
                }
            }
            if (!compiles(l)) continue;
            const line = emptyInfo();
            flagsIn(e, buildPath, line);
            info.defines.push(...line.defines);
            // A function that makes a flag as written (`$(addprefix -D,…)`), not one handed flags another line sets (`$(strip $(CFLAGS))`).
            info.openDefines ||= line.openDefines || madeByFunction(l);
            info.forced.push(...line.forced);
            // A recipe's `-x c++` compiles C as C++ where it compiles C files (named, or a rule's `$<`).
            if (line.cxx === "all" && (!recipe || /\.c(?![\w+])|\$[<^?]/.test(e))) info.cxx = "all";
        }
        info.targets.push(...targets.values());
    }
    if (bound.hit) info.openDefines = true;
    const written = new Set(generated.filter((g) => g.match).map((g) => g.name.replace(/^\.\//, "")));
    const kept = (list: Source[]) => list.filter((s) => !(s.match && written.has(s.name.replace(/^\.\//, ""))));
    info.sources = kept(info.sources);
    for (const t of info.targets) t.sources = kept(t.sources);
    return info;
};

/** A Make variable's reference: `$(NAME)`, `${NAME}`, and a substitution reference (`$(SRCS:.c=.o)`, `$(SRCS:%.c=%.o)`). */
const MAKE_REF = /\$[({]([A-Za-z_][\w.-]*)(?::([^=)}]*)=([^)}]*))?[)}]/g;

/** A substitution reference's words: `.c=.o` replaces each word's ending, `%.c=%.o` its pattern. */
const substituted = (text: string, from: string, to: string) =>
    text
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => {
            const pattern = from.includes("%") ? from : `%${from}`;
            const [pre, post] = [pattern.slice(0, pattern.indexOf("%")), pattern.slice(pattern.indexOf("%") + 1)];
            if (w.length < pre.length + post.length || !w.startsWith(pre) || !w.endsWith(post)) return w;
            const stem = w.slice(pre.length, w.length - post.length);
            return to.includes("%") ? to.replace("%", stem) : from.includes("%") ? to : `${stem}${to}`;
        })
        .join(" ");

/**
 * A Make text with the variables it names expanded, six deep, each once:
 * an expansion past CHARS_CAP characters, or a file's past EXPANDED_CAP
 * all told, stops there and meets `bound` (its unit's macros are open).
 * One no file read sets stays as written.
 */
const makeExpander = (vars: ReadonlyMap<string, string>, bound: Bound) => {
    const done = new Map<string, string>();
    let total = 0;
    const top = (s: string): string => {
        // Past the bound nothing more is expanded: the unit's macros are open.
        if (bound.hit) return s;
        const out = expand(s);
        total += out.length;
        if (total > EXPANDED_CAP) bound.hit = true;
        return out;
    };
    const expand = (s: string, depth = 0): string => {
        if (depth > 6 || !s.includes("$")) return s;
        let out = "";
        let at = 0;
        for (const m of s.matchAll(MAKE_REF)) {
            out += s.slice(at, m.index);
            at = m.index! + m[0].length;
            if (!vars.has(m[1])) {
                out += m[0];
                continue;
            }
            const key = `${m[1]}\n${depth}`;
            let value = done.get(key);
            if (value === undefined) done.set(key, (value = expand(vars.get(m[1])!, depth + 1)));
            // A substitution reference over words a function makes (`$(addprefix …)`) stays as written: the words aren't known.
            out += m[2] === undefined ? value : /\$[({]/.test(value) ? m[0] : substituted(value, m[2], m[3]);
            if (out.length > CHARS_CAP) {
                bound.hit = true;
                return out.slice(0, CHARS_CAP);
            }
        }
        return out + s.slice(at);
    };
    return top;
};

/** The variables a Make text sets, each with its last value (`+=` appended). */
const makeVars = (text: string): Map<string, string> => {
    const vars = new Map<string, string>();
    for (const l of text.split("\n")) {
        const m = !l.startsWith("\t") && /^\s*(?:override\s+|export\s+)?([A-Za-z_][\w.-]*)\s*(\+|\?|::|:)?=\s*(.*)$/.exec(l);
        if (m && !(vars.has(m[1]) && m[2] === "?")) vars.set(m[1], m[2] === "+" && vars.has(m[1]) ? `${vars.get(m[1])} ${m[3].trim()}` : m[3].replace(/\s#.*$/, "").trim());
    }
    return vars;
};

/** A Make include directive's files, its text's variables expanded; whether optional (`-include`, `sinclude`, `$(wildcard …)`). Dependency files the build writes, which hold rules and no flags, are left out. */
const makeInclude = (line: string, vars: Map<string, string>): { path: string; optional: boolean }[] | null => {
    const d = !line.startsWith("\t") && /^\s*(-?include|sinclude)\s+(.*)$/.exec(line);
    if (!d) return null;
    const bound: Bound = { hit: false };
    // The including file's own folder, as `$(dir $(lastword $(MAKEFILE_LIST)))` names it.
    let words = makeExpander(vars, bound)(d[2].replace(/\s#.*$/, "").replace(/\$\(dir \$\(lastword \$\(MAKEFILE_LIST\)\)\)\/?/g, "./"));
    // Names past the bound can't be placed.
    if (bound.hit) return [{ path: "$", optional: true }];
    const optional = d[1] !== "include" || words.includes("$(wildcard");
    words = words.replace(/\$\(wildcard\s+((?:[^()]|\([^()]*\))*)\)/g, " $1 ");
    return words
        .split(/\s+/)
        .filter((w) => w && !/[*?[]|\$\((?:patsubst|addsuffix|subst|basename|foreach)\b|DEP|\.(?:d|dep|deps|P|Po|Plo)\)?$|(?:^|\/)\.?depend$/i.test(w))
        .map((w) => ({ path: w, optional }));
};

/** Libraries of the C runtime and the systems, linked by name: no target of the build, nothing passed on. */
const SYSTEM_LIBS = new Set(
    "m c dl rt pthread pthreads util stdc++ c++ c++abi gcc gcc_s atomic gcov socket nsl resolv network net execinfo kvm procstat perfstat kstat sendfile log android ws2_32 wsock32 mswsock advapi32 kernel32 user32 gdi32 shell32 ole32 oleaut32 uuid comdlg32 comctl32 crypt32 secur32 bcrypt ncrypt iphlpapi userenv ntdll normaliz wldap32 winmm dbghelp psapi version shlwapi setupapi cfgmgr32 imagehlp rpcrt4 dnsapi winhttp wininet urlmon iconv intl icucore".split(" ")
);

/** How many folders' build files a search for a linked target may read. */
const SEARCH_LIMIT = 64;

/** What every build file of a folder's C files writes, merged. */
export type FolderBuild = {
    search: Search;
    defines: Macro[];
    openDefines: boolean;
    forced: string[];
    cxx: Source[] | "all";
    sources: Source[];
    targets: Target[];
    /** Another build system's file there (Bazel, SCons, Kbuild): its flags can't be read. */
    foreign: boolean;
    /** The build files read for it; those not asked for yet. */
    files: string[];
    pending: string[];
};

/** Build files read once for every folder that asks: each folder's CMake or Meson file with what it includes, read with the variables of those above it. */
export type BuildCache = Map<string, { info: BuildInfo; files: string[]; pending: string[] }>;

/**
 * The build files of a folder's C files, as the build reads them: those of
 * the folder and each folder above, CMake's variables flowing down from the
 * top; each with the files it includes read into its text (Make's fragments,
 * in the including file's folder; CMake's `include()`d files and modules,
 * through the module folders set above); and what they write, merged, with
 * the usage requirements of what they link. A Make fragment whose name the
 * board can't place leaves the macros open, as a definition whose name
 * can't be placed does; one the repository doesn't hold is written by the
 * build or by configure (`include auto/config.mk`, `-include
 * .make-settings`), whose flags are as out of reach as the command line's.
 * A linked target the files read don't make is looked for by following
 * `add_subdirectory()` (Meson's `subdir()`) from them, up to a limit; one
 * found nowhere they reach is a library of the system, unless a folder
 * couldn't be placed or the limit was met: then the macros are open.
 */
export const folderBuild = (dir: string, text: (path: string) => string | undefined, exists: (path: string) => boolean | undefined, cache: BuildCache = new Map()): FolderBuild => {
    try {
        return readFolder(dir, text, exists, cache);
    } catch {
        // A build file the reader can't take (one made to exhaust it) leaves the folder's macros open; it never fails the board.
        return { search: { dirs: [], open: true }, defines: [], openDefines: true, forced: [], cxx: [], sources: [], targets: [], foreign: false, files: [], pending: [] };
    }
};

const readFolder = (dir: string, text: (path: string) => string | undefined, exists: (path: string) => boolean | undefined, cache: BuildCache): FolderBuild => {
    const out: FolderBuild = { search: { dirs: [], open: false }, defines: [], openDefines: false, forced: [], cxx: [], sources: [], targets: [], foreign: false, files: [], pending: [] };
    const chainOf = (d: string): string[] => {
        const chain: string[] = [];
        for (let x = d; ; x = dirOf(x)) {
            chain.unshift(x);
            if (!x) break;
        }
        return chain;
    };
    const dirs = new Set<string>();
    /** Each definition once, however many times the files write it. */
    const defined = new Set<string>();
    const merge = (info: BuildInfo) => {
        info.dirs.forEach((d) => dirs.add(d));
        out.search.open ||= info.open;
        for (const m of info.defines) {
            const key = `${m.file}\n${m.name}(${m.params?.join(",") ?? ""})=${m.body}`;
            if (!defined.has(key)) {
                defined.add(key);
                out.defines.push(m);
            }
        }
        out.openDefines ||= info.openDefines;
        out.forced.push(...info.forced);
        out.cxx = out.cxx === "all" || info.cxx === "all" ? "all" : [...out.cxx, ...info.cxx];
        out.sources.push(...info.sources);
        out.targets.push(...info.targets);
    };
    /** A file's text, read into `into`'s lists; undefined where not asked yet, null where absent or not read. */
    const readInto = (p: string, into: { files: string[]; pending: string[] }): string | null | undefined => {
        const e = exists(p);
        const t = e ? text(p) : undefined;
        // A file there but not read (past the read's length limit) is as one not asked for yet: its unit draws nothing.
        if (e === undefined || (e && t === undefined)) {
            into.pending.push(p);
            return undefined;
        }
        if (t === undefined) return null;
        into.files.push(p);
        return t;
    };
    /** A fragment's own folder as it names it (CMake's `${CMAKE_CURRENT_LIST_DIR}`, Make's `$(dir $(lastword $(MAKEFILE_LIST)))`), from the including file's folder `d`. */
    const ownDir = (frag: string, d: string) => {
        const rel = dirOf(frag);
        return (d ? (rel === d ? "." : rel.startsWith(`${d}/`) ? rel.slice(d.length + 1) : `${d.split("/").map(() => "..").join("/")}${rel ? `/${rel}` : ""}`) : rel) || ".";
    };
    /** A folder's CMake file with the files it includes, read with the variables of the CMake files above; read once. */
    type Read = { info: BuildInfo; files: string[]; pending: string[] };
    const cmakeAt = (d: string): Read => {
        const key = `cmake\n${d}`;
        const hit = cache.get(key);
        if (hit) return hit;
        const parent: Read | null = d ? cmakeAt(dirOf(d)) : null;
        const outer = parent?.info.cmake;
        // What the files above read, or wait for, this one's reading depends on.
        const got: Read = { info: emptyInfo(), files: [...(parent?.files ?? [])], pending: [...(parent?.pending ?? [])] };
        got.info.cmake = outer ?? got.info.cmake;
        const path = d ? `${d}/CMakeLists.txt` : "CMakeLists.txt";
        const t = readInto(path, got);
        if (typeof t === "string") {
            // The file, then each file it includes after it, with its variables, until nothing new turns up.
            let body = t;
            const seen = new Set([path]);
            let info = readBuildFile(path, body, text, outer);
            for (let round = 0; ; round++) {
                const next = [...info.includes, ...info.modules.flatMap((m) => info.moduleDirs.map((md) => ({ path: `${md}/${m}.cmake`, optional: true })))].filter((inc) => !seen.has(inc.path));
                if (next.length === 0) break;
                // A chain of includes longer than six files may write anything past them.
                if (round === 6) {
                    info.openDefines = true;
                    break;
                }
                let grew = false;
                for (const inc of next) {
                    if (seen.has(inc.path)) continue;
                    seen.add(inc.path);
                    const it = readInto(inc.path, got);
                    if (typeof it !== "string") continue;
                    body += `\n${it.replace(/\$\{CMAKE_CURRENT_LIST_DIR\}/g, ownDir(inc.path, d))}`;
                    grew = true;
                }
                if (!grew) break;
                info = readBuildFile(path, body, text, outer);
            }
            got.info = info;
        }
        cache.set(key, got);
        return got;
    };
    /** A folder's Meson file; read once. */
    const mesonAt = (d: string): Read => {
        const key = `meson\n${d}`;
        const hit = cache.get(key);
        if (hit) return hit;
        const got: Read = { info: emptyInfo(), files: [], pending: [] };
        const path = d ? `${d}/meson.build` : "meson.build";
        const t = readInto(path, got);
        if (typeof t === "string") got.info = readBuildFile(path, t, text);
        cache.set(key, got);
        return got;
    };
    const take = (got: Read) => {
        for (const f of got.files) if (!out.files.includes(f)) out.files.push(f);
        for (const f of got.pending) if (!out.pending.includes(f)) out.pending.push(f);
    };
    const projects: BuildInfo[] = [];
    /** The folders the build files read add, each with its build system: CMake's `add_subdirectory()`, Meson's `subdir()`. */
    const added: { at: string | null; meson: boolean }[] = [];
    for (const d of chainOf(dir)) {
        for (const b of BUILD_FILES) {
            const path = d ? `${d}/${b}` : b;
            if (b === "CMakeLists.txt" || b === "meson.build") {
                const got = b === "CMakeLists.txt" ? cmakeAt(d) : mesonAt(d);
                take(got);
                if (exists(path) === true && got.files.includes(path)) {
                    merge(got.info);
                    projects.push(got.info);
                    added.push(...got.info.subdirs.map((at) => ({ at, meson: b === "meson.build" })));
                }
                continue;
            }
            const t = readInto(path, out);
            if (typeof t !== "string") continue;
            // Make reads a fragment where the file includes it: in a conditional's branch, the fragment is.
            let body = t;
            const seen = new Set([path]);
            for (let round = 0; round <= 6; round++) {
                const vars = makeVars(body.replace(/\\\r?\n/g, " "));
                let grew = false;
                body = body
                    .replace(/\\\r?\n/g, " ")
                    .split("\n")
                    .map((line) => {
                        const incs = makeInclude(line, vars);
                        if (!incs) return line;
                        // A chain of fragments longer than six files may write anything past them.
                        if (round === 6) {
                            if (incs.some((inc) => inc.path.includes("$") || inc.path.includes("@") || !seen.has(normalize(d ? `${d}/${inc.path}` : inc.path) ?? ""))) out.openDefines = true;
                            return "";
                        }
                        const parts: string[] = [];
                        for (const inc of incs) {
                            // A fragment the board can't name leaves the macros open, optional or not; one the repository doesn't hold, configure writes it (`auto/config.mk`), as out of reach as the command line.
                            const at = inc.path.includes("$") || inc.path.includes("@") ? null : normalize(d ? `${d}/${inc.path}` : inc.path);
                            if (at === null) {
                                out.openDefines = true;
                                continue;
                            }
                            if (seen.has(at)) continue;
                            seen.add(at);
                            const it = readInto(at, out);
                            if (typeof it !== "string") continue;
                            parts.push(it.replace(/\$\(dir \$\(lastword \$\(MAKEFILE_LIST\)\)\)\/?/g, `${ownDir(at, d)}/`));
                            grew = true;
                        }
                        return parts.join("\n");
                    })
                    .join("\n");
                if (!grew) break;
            }
            merge(readBuildFile(path, body, text));
        }
    }
    // Another build system's file in the folder, or at the root: its flags aren't read.
    for (const f of [...FOREIGN.map((b) => (dir ? `${dir}/${b}` : b)), ...FOREIGN_ROOT]) {
        const e = exists(f);
        if (e === undefined) out.pending.push(f);
        else if (e) out.foreign = true;
    }
    // What the folder's build links: the usage requirements of the targets and dependencies it finds, passed on in turn.
    const made = new Map<string, BuildInfo>();
    const imported = new Set<string>();
    const aliases = new Map<string, string[]>();
    let unnamed = false;
    let unnamedPlain = false;
    const learn = (info: BuildInfo) => {
        for (const t of info.made) if (!made.has(t)) made.set(t, emptyInfo());
        for (const [t, u] of info.usage) {
            const had = made.get(t) ?? emptyInfo();
            made.set(t, had);
            had.defines.push(...u.defines);
            had.openDefines ||= u.openDefines;
            had.forced.push(...u.forced);
            had.dirs.push(...u.dirs.filter((x) => !had.dirs.includes(x)));
            had.open ||= u.open;
            had.links.push(...u.links);
            if (u.cxx === "all") had.cxx = "all";
        }
        info.imported.forEach((t) => imported.add(t));
        info.aliases.forEach((v, k) => aliases.set(k, v));
        unnamed ||= info.unnamed;
        unnamedPlain ||= info.unnamedPlain;
    };
    projects.forEach(learn);
    const wanted = projects.flatMap((p) => p.links);
    /** The packages the build finds (`find_package(OpenSSL)`, `pkg_check_modules(FOO …)`). */
    const packages = new Set(projects.flatMap((p) => [...p.cmake.found]));
    if (wanted.length > 0) {
        /** What a link item is: nothing to apply (a flag, a library's file, a package, a package's variable), a target or dependency found, or one to look for. */
        const kind = (item: string): "skip" | "found" | "unknown" | "open" => {
            if (!item || /^(?:debug|optimized|general)$/.test(item) || /^-|[/\\]|\.(?:a|so|lib|dylib|framework|tbd|o|obj)$/.test(item)) return "skip";
            if (/\$\{/.test(item)) return /(?:LIBRARIES|LIBRARY|LIBS|LIB|LDFLAGS)\}/.test(item) ? "skip" : "open";
            if (aliases.has(item) || made.has(item)) return "found";
            // A target a package the build finds defines (`OpenSSL::SSL` after `find_package(OpenSSL)`, pkg-config's), or one imported, is the package's; another `::` name is looked for, and is a package's only where no folder makes it.
            if (imported.has(item) || (item.includes("::") && (packages.has(item.split("::")[0]) || item.startsWith("PkgConfig::")))) return "skip";
            return "unknown";
        };
        const applied = new Set<string>();
        const queue = [...wanted];
        const unknown = new Set<string>();
        const resolve = () => {
            while (queue.length > 0) {
                const values = genexValues(queue.shift()!);
                // A link a generator expression hides (`$<TARGET_PROPERTY:…>`) may carry any usage requirement.
                if (!values) out.openDefines = true;
                for (const value of values ?? []) {
                    const item = value.trim();
                    const k = kind(item);
                    if (k === "open") out.openDefines = true;
                    else if (k === "unknown") unknown.add(item);
                    else if (k === "found") {
                        unknown.delete(item);
                        if (applied.has(item)) continue;
                        applied.add(item);
                        // An alias stands for the targets it may name.
                        if (aliases.has(item)) {
                            queue.push(...aliases.get(item)!);
                            continue;
                        }
                        const u = made.get(item)!;
                        merge({ ...u, sources: [], targets: [] });
                        queue.push(...u.links);
                    }
                }
            }
            for (const t of [...unknown]) if (SYSTEM_LIBS.has(t)) unknown.delete(t);
        };
        resolve();
        // One the files read don't make: follow the folders the build adds, until it is found or they run out.
        // Each folder read with the build system that adds it: a CMake folder's `meson.build` is never asked for.
        const chain = chainOf(dir);
        const visited = new Set(chain.flatMap((d) => [`cmake\n${d}`, `meson\n${d}`]));
        const frontier = [...added];
        let searched = 0;
        let complete = true;
        let waiting = false;
        while (unknown.size > 0 && frontier.length > 0) {
            const { at: next, meson } = frontier.shift()!;
            if (next === null) {
                complete = false;
                continue;
            }
            const key = `${meson ? "meson" : "cmake"}\n${next}`;
            if (visited.has(key)) continue;
            if (chain.length + searched >= SEARCH_LIMIT) {
                complete = false;
                break;
            }
            visited.add(key);
            searched++;
            const got = meson ? mesonAt(next) : cmakeAt(next);
            take(got);
            waiting ||= got.pending.length > 0;
            learn(got.info);
            frontier.push(...got.info.subdirs.map((at) => ({ at, meson })));
            // What the files the search read compile, and in which programs, counts as the folder's own files' does.
            out.sources.push(...got.info.sources);
            out.targets.push(...got.info.targets);
            queue.push(...unknown);
            unknown.clear();
            resolve();
        }
        // Found nowhere the build reaches: a CMake name is a library of the system's, where the search saw everything; a Meson variable must be somewhere.
        const left = [...unknown].filter((t) => t.startsWith("@meson:") || !complete || unnamed || (unnamedPlain && !t.includes("::")));
        if (left.length > 0 && !waiting) out.openDefines = true;
    }
    out.search.dirs = [...dirs];
    return out;
};
