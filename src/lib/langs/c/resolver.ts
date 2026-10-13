/**
 * C's resolver: the one definition a call names, as the compiler and the
 * linker pick it, proven from the files read. It reads every C file and every
 * header read (headers are C++'s files, so C's and C++'s linkers share this
 * resolver); it draws only from calls in `.c` files (`.C` is C++), and none
 * from or into a `.c` file its build compiles as C++.
 *
 * A call `f(…)` to a bare name links when all of these hold:
 * - `f` is no name the C library or a system header may own (`reserved.ts`),
 *   and no file of the unit, nor a `-D` of its build files, defines or
 *   undefines a macro `f`; nor is it spliced to the line before or after;
 * - the call sits in a function definition the parser read whole, and that
 *   function declares no `f` of its own (a parameter, a local), nor holds an
 *   ERROR node naming it; no `#include` sits in the function before the
 *   call, no macro used before it there may write `f`, and no call to a name
 *   the reads don't declare comes before it with `f` among its arguments
 *   where a header of the unit is unread;
 * - each call whose arguments hold it is a function's, or a macro that
 *   passes the argument on as code in every definition read and whose
 *   expansion writes no `f` of its own; a call around it to a name the reads
 *   don't declare, where a header of the unit is unread, may be a macro of
 *   that header: no line;
 * - the call is in no branch that is never compiled (`#if 0`, `#if (0)`,
 *   `#else` after `#if 1`), and the file's conditionals balance;
 * - the unit's build files were read (`build.ts`), none defines the file's
 *   include guard, and each definition they write has a name they place;
 * - in its translation unit (the file and every header it includes, as far
 *   as the reads resolve them), every declaration of `f` is a function's,
 *   none weak or an alias (by attribute, or by a macro before or after its
 *   declarator whose expansion may be), none written `(f)(…)`, none in
 *   doubt (`decls.ts`: an error, a declarator shaped as a macro's use), and
 *   no macro used at file scope may write `f`.
 *
 * Then the target is:
 * 1. a definition in the same file: the call's conditional branches hold the
 *    definition's, and no header the reads couldn't resolve, nor a system
 *    header that may make `f` a macro, is included between the two (a macro
 *    from it would change one and not the other; one before both changes
 *    both alike);
 * 2. a definition in an included header, static or the one external
 *    definition read: the include comes before the call, in the call's
 *    branches, through headers included unconditionally; the definition is
 *    in no branch of its header but the include guard, and no header the
 *    reads can't see may define that guard; no unresolved header, nor a
 *    system header that may make `f` a macro, between it and the call;
 * 3. else, an external definition in another `.c` file: no system header of
 *    the unit may make `f` a macro, a declaration of `f` comes before the
 *    call, none static, and no header before the call is unresolved; across
 *    every file read there is exactly one definition with external linkage
 *    (its own unit's declarations and headers say so), and no file read may
 *    define it in a way the reads don't show (one the parser rejects and
 *    that names it, a macro's use, an error); in no conditional branch, in
 *    no folder or file named for a platform or a variant the call's isn't,
 *    in no file a build file read compiles in some builds only, its build
 *    files read.
 *
 * A header whose include guard a file of the unit read before it, or a
 * `-D`, defines is skipped: it is read as unresolved. Where a specifier
 * macro decides `static` or `inline` (`MEM_STATIC`), its definitions read
 * are expanded; one the reads don't define, or definitions that disagree,
 * leave it unknown, and an unknown linkage proves nothing. A word an
 * expansion writes that no file read defines is a name where every include
 * of the unit resolves and no system header of it may define the word: only
 * the command line could make it a macro. A C99 `inline` definition without
 * `static` is never a target: the call may use another file's external
 * definition. Out of reach: macros defined on the compiler's command line
 * beyond the build files read (and what configure writes), which files the
 * build compiles into which program where no build file read names them (a
 * test's mock of a function), and link-time substitution.
 */

import type { GFile, GSite } from "../../anyfacts.ts";
import type { ModuleContext, Named, OwnResolver } from "../../anylink.ts";
import { grammarOf } from "../../language.ts";
import { child, textOf, type Flat } from "../../syntax.ts";
import type { Unit } from "../pack.ts";
import { afterSubtree, inError } from "../units-only.ts";
import { declsOf, definitionShapes, spliced, type Decl, type Decls } from "./decls.ts";
import { argumentsAt, attributeSplit, called, IDENT, mayWrite, NO_WRITES, reacher, shapesIn, tokenize, writesOf, type Writes } from "./expand.ts";
import { folderBuild, sourceNames, type BuildCache, type FolderBuild, type Source, type Target } from "./build.ts";
import { dirOf, resolveInclude, type Search } from "./includes.ts";
import { passesArgument, readPreproc, within, withinAlike, type Branch, type Include, type Macro, type Preproc } from "./preproc.ts";
import { definesMacros, reserved, systemMacro } from "./reserved.ts";

/** Files whose text may define macros or declare names for C code. */
const SOURCE = /\.(?:c|h|cc|cpp|cxx|c\+\+|hh|hpp|hxx|h\+\+|inc|def|inl|ipp|tcc|x)$/i;
/** C's source files: `.c`, the case kept, as `.C` is C++. */
const C_SOURCE = /\.c$/;
/** C++'s source files: a definition in one is never a C call's target, and blocks one elsewhere. */
const isCppSource = (path: string) => /\.(?:cc|cpp|cxx|c\+\+)$/i.test(path) || /\.C$/.test(path);
/** A folder or a file name part naming a platform, a processor or a variant: a definition there is one of several the build picks from. */
const PLATFORM = /^(?:win|win32|win64|w32|w64|windows|wince|winnt|nt|msvc|unix|posix|linux|darwin|mac|macos|macosx|osx|apple|ios|bsd|freebsd|netbsd|openbsd|dragonfly|solaris|sunos|illumos|aix|hpux|android|wasm|wasi|emscripten|vms|os2|os400|amiga|amigaos|msdos|dos|djgpp|cygwin|mingw|haiku|qnx|zos|hurd|fuchsia|nacl|vxworks|rtems|nuttx|zephyr|freertos|epoll|kqueue|evport|iocp|uring|devpoll|pthread|pthreads|threads|nothreads|generic|fallback|portable|ref|stub|stubs|dummy|mock|mocks|fake|x86|x86_64|x64|amd64|i386|i686|ia32|arm|arm32|arm64|aarch64|armv7|armv8|neon|sve|sve2|sse|sse2|sse3|ssse3|sse4|sse41|sse42|avx|avx2|avx512|simd|mmx|altivec|vsx|ppc|ppc64|powerpc|mips|mips64|riscv|riscv64|rvv|s390|s390x|sparc|loongarch|loongarch64|lsx|lasx)$/i;
/** Words a specifier macro may expand to that change nothing a call depends on. */
const NEUTRAL = new Set(["extern", "const", "volatile", "register", "auto", "signed", "unsigned", "short", "long", "int", "char", "float", "double", "void", "_Bool", "bool", "__extension__", "__restrict", "__restrict__", "restrict", "_Noreturn", "noreturn", "__cdecl", "__stdcall", "__fastcall", "__thiscall", "__vectorcall", "__export", "__import", "struct", "union", "enum", "_Complex", "_Atomic", "__const", "__const__", "__volatile", "__volatile__", "__signed", "__signed__"]);
/** Words reserved to the implementation that name a type: the compilers' own integer, vector and floating types. Any other a system header may define, as glibc's `__always_inline` or `__weak_symbol`. */
const RESERVED_TYPE = /^(?:__int(?:8|16|32|64|128)|__m\d+[a-z]*|_Float\d+x?|_Decimal\d+|__bf16|__fp16|__float(?:80|128)|__ibm128|__builtin_va_list|__gnuc_va_list|_Imaginary|__ptr32|__ptr64|__w64|__unaligned)$|^__\w*_t$/;
/** Words after a function's declarator that change nothing a call depends on. */
const AFTER_DECLARATOR = new Set(["const", "volatile", "restrict", "__restrict", "__restrict__", "noexcept", "throw", "override", "final"]);
const INLINE = /^(?:inline|__inline|__inline__|__forceinline)$/;
const WEAK = /\b(?:weak|weakref|alias|selectany|ifunc)\b|\b(?:__asm__|__asm|asm)\s*\(/;
/** Words before a `(` that make no call: C's keywords and the attribute words. */
const KEYWORDS = new Set(["if", "while", "for", "switch", "return", "sizeof", "do", "else", "case", "default", "goto", "break", "continue", "typeof", "typeof_unqual", "alignof", "_Alignof", "_Generic", "_Static_assert", "static_assert", "asm", "void", "char", "short", "int", "long", "float", "double", "signed", "unsigned", "const", "volatile", "restrict", "struct", "union", "enum", "static", "extern", "register", "auto", "inline", "_Bool", "bool", "_Atomic", "_Alignas", "alignas", "_Noreturn", "_Thread_local", "thread_local", "defined"]);
/** A placeholder for the argument that holds the call, while a macro's use around it is expanded. */
const HOLE = "\u0001";

const NONE: Named = [];

/** Where something sits in a translation unit: the offsets of the includes leading to its file, then its own. */
type Key = number[];
const cmp = (a: Key, b: Key): number => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
};

/** A file of a translation unit: where it is included, and the branches each include on the way sits in, the first in the unit's own file; `skippable` where its include guard (or an includer's) may be defined by what the reads can't see. */
type TuFile = { path: string; key: Key; includes: Branch[][]; skippable?: true };
/** A unit: its files; the includes that don't resolve; those taken for a library's only by their branch (`lenient`); the headers outside the repository it names, or may (`unknown`: found nowhere). */
type Tu = { files: TuFile[]; unread: { key: Key; why: string }[]; lenient: Key[]; outside: { key: Key; spec: string; lenient?: true; unknown?: true }[] };
type Found = { decl: Decl; path: string; key: Key; file: TuFile };
/** What a declaration's specifiers make it: true, false, or null where configurations differ or a macro is unknown. */
type Spec = { isStatic: boolean | null; isInline: boolean | null; weak: boolean | null };
/** What a C file's build files write: its include search, its macros (`open` where one's name can't be placed, a usage requirement can't be found, or another build system's file is there), whether each build file that may be there was asked for, the headers read before it, and whether it is compiled as C++. */
type Build = { search: Search; defines: Macro[]; open: boolean; known: boolean; forced: string[]; cxx: boolean; key: string };
/** In a function, before or around a call: an `#include`, a macro's use, or a call to a name the reads don't declare; offsets, the arguments' token ranges. */
type Event = { kind: "include" | "macro" | "unknown"; name: string; start: number; end: number; toks: string[]; args: [number, number][]; argAt: [number, number][]; alias?: boolean; writes?: Writes };

/** Where a name in a function is one it declares: a declarator, a parameter (a K&R one's list too), an enumerator, a typedef. */
const DECLARATOR_PARENTS = new Set(["init_declarator", "pointer_declarator", "array_declarator", "function_declarator", "parenthesized_declarator", "attributed_declarator", "parameter_declaration", "parameter_list", "declaration", "enumerator", "type_definition", "field_declaration", "optional_parameter_declaration", "reference_declarator"]);

/** The function definition a node sits in, or -1. */
const enclosingFunction = (t: Flat, n: number): number => {
    for (let p = t.parent[n]; p >= 0; p = t.parent[p]) if (t.type[p] === "function_definition") return p;
    return -1;
};

/** The names a function declares of its own anywhere in it (its parameters, its locals, nested functions and enumerators), and every name an ERROR node in it holds; its own name aside. */
const ownNamesOf = (t: Flat, fn: number): Set<string> => {
    const out = new Set<string>();
    let own = child(t, fn, "declarator");
    while (own >= 0 && t.type[own] !== "identifier") own = child(t, own, "declarator");
    for (let i = fn + 1, end = afterSubtree(t, fn); i < end; i++) {
        if (i === own) continue;
        if (t.type[i] === "ERROR") {
            for (const m of t.text.slice(t.start[i], t.end[i]).matchAll(/[A-Za-z_]\w*/g)) out.add(m[0]);
            continue;
        }
        const p = t.parent[i];
        // A K&R definition's parameter, `int k(helper)`, reads as an unnamed parameter of type `helper`.
        if (t.type[i] === "type_identifier" && t.field[i] === "type" && t.type[p] === "parameter_declaration" && child(t, p, "declarator") < 0) out.add(textOf(t, i));
        // A local typedef's name is a type_identifier: `typedef int f; f(x);` declares x.
        if (t.type[i] !== "identifier" && !(t.type[i] === "type_identifier" && t.field[i] === "declarator")) continue;
        if (DECLARATOR_PARENTS.has(t.type[p]) && t.field[i] !== "value" && t.field[i] !== "function" && t.field[i] !== "size" && t.field[i] !== "argument") out.add(textOf(t, i));
    }
    return out;
};

/** Whether a reserved include guard (`_UTIL_H_`) may be a system header's own, as `<util.h>` or `<sys/util.h>` names it. */
const guardsAlike = (guard: string, spec: string): boolean => {
    const core = guard.replace(/^_+|_+$/g, "").replace(/_+(?:H|INCLUDED|H_INCLUDED)$/i, "").toLowerCase();
    const own = spec.replace(/\.h$/i, "").replace(/[/.-]/g, "_").toLowerCase();
    return core === own || own.endsWith(`_${core}`) || core.endsWith(`_${own}`);
};

/** A cache by key, which can be cleared. */
const memo = <V>(make: (key: string) => V) => {
    const m = new Map<string, V>();
    return Object.assign((key: string): V => (m.has(key) ? m.get(key)! : (m.set(key, make(key)), m.get(key)!)), { clear: () => m.clear() });
};

/** The resolver over one review's C and C++ files: for a call, the unit it names, or why none. */
const createProgram = (files: readonly GFile[], ctx: ModuleContext) => {
    const byPath = new Map(files.map((f) => [f.path, f]));
    const known = new Set(ctx.known);
    /** Every path read: its text, parsed or not (a file the parser rejects). */
    const read = new Set([...(ctx.paths ?? []), ...known, ...byPath.keys()]);
    const text = (path: string): string | undefined => byPath.get(path)?.flat.text ?? ctx.text(path);
    const exists = (path: string): boolean | undefined => (byPath.has(path) || read.has(path) ? true : ctx.exists?.(path));
    const pre = memo((path): Preproc => readPreproc(text(path) ?? ""));
    const decls = memo((path): Decls | null => {
        const f = byPath.get(path);
        return f ? declsOf(f.flat) : null;
    });
    /** The identifiers a file read as text alone holds in its code: its comments, strings and directives aside. */
    const wordsOf = memo((path): Set<string> => {
        const body = text(path) ?? "";
        const out = new Set<string>();
        let from = 0;
        const add = (to: number) => {
            for (const x of tokenize(body, from, to)) if (IDENT.test(x.tok)) out.add(x.tok);
        };
        for (const d of pre(path).directives) {
            add(d.start);
            from = d.end;
        }
        add(body.length);
        return out;
    });
    const macros = new Map<string, Macro[]>();
    const addMacro = (m: Macro) => {
        const list = macros.get(m.name);
        if (list) list.push(m);
        else macros.set(m.name, [m]);
    };
    const lookupAll = (name: string): Macro[] | undefined => macros.get(name);
    /** What the macros a name reaches write, among every definition read. */
    const reachAll = reacher(lookupAll);

    /** What the build files of a folder's C files write, each build file read once for all folders. */
    const buildCache: BuildCache = new Map();
    const folderOf = memo((dir): FolderBuild => folderBuild(dir, text, exists, buildCache));
    /** A C file's build: its include search, its macros, whether its build files were all asked for, the headers read before it, whether compiled as C++. */
    const buildOf = memo((path): Build => {
        const f = folderOf(dirOf(path));
        const cxx = f.cxx === "all" || f.cxx.some((x) => sourceNames(x, path));
        const open = f.openDefines || f.foreign;
        const key = JSON.stringify([[...f.search.dirs].sort(), f.search.open, f.defines.map((d) => `${d.name}(${d.params?.join(",") ?? ""})=${d.body}`).sort(), [...f.forced].sort(), open]);
        return { search: f.search, defines: f.defines, open, known: f.pending.length === 0, forced: f.forced, cxx, key };
    });
    /**
     * Whether a build file read for the caller's or the definition's folder
     * (one the search for a linked target read too) compiles the
     * definition's file in some builds only: names it in a conditional's
     * branch (or a generator expression, a function's body, a Kbuild list, a
     * glob a filter narrows, a name or a folder a variable picks, a default
     * the user may change), or names beside it a source of its stem and a
     * platform's or a variant's word (`io.c` and `io_w32.c`, `win32_io.c`,
     * `win32/io.c`): a build may compile that one instead.
     */
    const builtOnSome = (caller: string, path: string): boolean => {
        const sources = [...new Set([dirOf(caller), dirOf(path)])].flatMap((d) => folderOf(d).sources);
        const named = sources.filter((x) => sourceNames(x, path));
        if (named.length === 0) return false;
        if (named.some((x) => x.conditional)) return true;
        const stem = path.split("/").pop()!.replace(/\.c$/, "");
        return sources.some((x) => {
            if (x.match) return false;
            const parts = x.name.split("/");
            const n = parts.pop()!.replace(/\.c$/, "");
            if (n === stem) return parts.some((p) => PLATFORM.test(p)) && !sourceNames(x, path);
            const word = n.startsWith(stem) ? n.slice(stem.length) : n.endsWith(stem) ? n.slice(0, -stem.length) : "";
            return /^[_.-]|[_.-]$/.test(word) && PLATFORM.test(word.replace(/^[_.-]|[_.-]$/g, ""));
        });
    };
    /**
     * The sources of each program and library the build files of some folders
     * make: those it names and those of the targets it links that the files
     * read make (`sources`), and those of the targets it links in a
     * conditional's branch alone (`branch`).
     */
    const targetsOf = memo((dirs): { sources: Source[]; branch: Source[] }[] => {
        const seen = new Set<string>();
        const targets = dirs.split("\n").flatMap((d) => folderOf(d).targets).filter((t) => {
            const k = `${t.file}\n${t.name}`;
            return !seen.has(k) && !!seen.add(k);
        });
        const byName = new Map(targets.map((t) => [t.name, t]));
        const sourcesOf = (t: Target, walked = new Set<Target>()): Source[] => {
            walked.add(t);
            return [...t.sources, ...t.uses.flatMap((u) => (byName.has(u) && !walked.has(byName.get(u)!) ? sourcesOf(byName.get(u)!, walked) : []))];
        };
        return targets.map((t) => ({ sources: sourcesOf(t), branch: t.branch.flatMap((u) => (byName.has(u) ? sourcesOf(byName.get(u)!, new Set([t])) : [])) }));
    });
    /** The programs and libraries of the caller's and the definition's folders that build the caller's file. */
    const holdersOf = (caller: string, definer: string) => targetsOf([...new Set([dirOf(caller), dirOf(definer)])].join("\n")).filter((t) => t.sources.some((x) => sourceNames(x, caller)));
    /** Whether a C file is built into two or more programs or libraries of different sources, and one doesn't take the definition's file: there, the call may name another. */
    const programsDiffer = (caller: string, definer: string): boolean => {
        const holding = holdersOf(caller, definer).map((t) => t.sources);
        if (holding.length < 2 || holding.every((s) => s.some((x) => sourceNames(x, definer)))) return false;
        // Targets of one list (a static and a shared library of the same files) choose nothing between them.
        return new Set(holding.map((s) => [...new Set(s.map((x) => `${x.from}/${x.name}`))].sort().join("\n"))).size > 1;
    };
    /** Whether a program or library that builds the caller's file takes the definition's file only through a library it links in a conditional's branch (one backend of several). */
    const linkedOnSome = (caller: string, definer: string): boolean => holdersOf(caller, definer).some((t) => !t.sources.some((x) => sourceNames(x, definer)) && t.branch.some((x) => sourceNames(x, definer)));

    /** Whether a macro's expansion may make a declaration weak, an alias, or name its symbol (an asm label): null where a word in it is no macro the reads define, nor one that changes nothing there. */
    const weakOf = (name: string, defsOf: (name: string) => Macro[] | undefined, depth = 0): boolean | null => {
        const defs = defsOf(name);
        if (!defs || depth > 6) return null;
        let out: boolean | null = false;
        for (const m of defs) {
            if (WEAK.test(m.body)) return true;
            const params = new Set(m.params ?? []);
            const { outside, inside } = attributeSplit(m.body);
            // A word inside an attribute is the attribute's own, unless a macro writes it.
            for (const w of [...outside, ...inside.filter((x) => defsOf(x))]) {
                if (params.has(w) || AFTER_DECLARATOR.has(w)) continue;
                const inner = weakOf(w, defsOf, depth + 1);
                if (inner === true) return true;
                if (inner === null) out = null;
            }
        }
        return out;
    };
    /** What a specifier macro may expand to, in each of its definitions read: `static`, `inline`, a weak or alias attribute (`weak?` where a macro in one may write it); null when a word in it is unknown. */
    const expansions = (name: string, depth: number, defsOf: (name: string) => Macro[] | undefined, isType: (name: string) => boolean): Set<string>[] | null => {
        const defs = defsOf(name);
        if (!defs || depth > 6) return null;
        const out: Set<string>[] = [];
        for (const m of defs) {
            if (m.params) return null;
            // Attributes are read for weak and alias words, and for macros that may write one; nothing else in them matters.
            const words = new Set<string>();
            if (WEAK.test(m.body)) words.add("weak");
            const { outside, inside } = attributeSplit(m.body);
            for (const w of inside) {
                if (!defsOf(w)) continue;
                const weak = weakOf(w, defsOf, depth + 1);
                if (weak !== false) words.add(weak ? "weak" : "weak?");
            }
            let options: Set<string>[] = [words];
            for (const w of outside) {
                if (w === "static") options.forEach((o) => o.add("static"));
                else if (INLINE.test(w)) options.forEach((o) => o.add("inline"));
                // A type's name: a keyword's, a compiler's own, a typedef the C library reserves (`size_t`), or one the reads declare as no macro.
                else if (NEUTRAL.has(w) || RESERVED_TYPE.test(w) || (!defsOf(w) && !reserved(w) && (/_t$/.test(w) || isType(w)))) continue;
                else {
                    const inner = expansions(w, depth + 1, defsOf, isType);
                    if (!inner) return null;
                    options = options.flatMap((o) => inner.map((i) => new Set([...o, ...i])));
                }
            }
            out.push(...options);
        }
        return out;
    };
    /**
     * A declaration's `static`, `inline` and weakness, its specifier macros
     * expanded, the identifier read as its type too where it is a macro; a
     * macro after a function's declarator must expand to no weak, alias or
     * asm attribute, and to no word the reads don't define (a system
     * header's `__weak_symbol`): such a word leaves it unknown.
     */
    const specOf = (d: Decl, scope?: string): Spec => {
        const defsOf = scope ? (m: string) => tuMacros(scope).defs.get(m) : lookupAll;
        /**
         * A word a specifier macro writes that no macro of the unit defines,
         * and that changes nothing: a typedef the unit declares, or a name a
         * header of it read as text alone mentions in its code; else any
         * word not reserved to the implementation, where the unit's includes
         * all resolve to files read or to system headers, none of which may
         * define it (`reserved.ts`): only the command line could make it a
         * macro.
         */
        const isType = (w: string) => {
            if (!scope) return false;
            const tu = tuOf(scope);
            if (tuDecls(scope, w).found.some((x) => x.decl.kind === "typedef") || tu.files.some((x) => !byPath.has(x.path) && wordsOf(x.path).has(w))) return true;
            return tu.unread.length === 0 && tu.lenient.length === 0 && !systemMacroName(scope, w);
        };
        let options: Set<string>[] = [new Set()];
        const unknown = (): Spec => ({ isStatic: d.isStatic ? true : null, isInline: d.isInline ? true : null, weak: d.weak ? true : null });
        for (const m of [...d.specMacros, ...(d.typeName && defsOf(d.typeName) ? [d.typeName] : [])]) {
            const e = expansions(m, 0, defsOf, isType);
            if (!e) return unknown();
            options = options.flatMap((o) => e.map((i) => new Set([...o, ...i])));
        }
        let weak: boolean | null = d.weak || options.some((o) => o.has("weak")) ? true : options.some((o) => o.has("weak?")) ? null : false;
        for (const m of d.trailing) {
            if (weak === true) break;
            const w = weakOf(m, defsOf);
            if (w !== false) weak = w;
        }
        const flag = (word: string, explicit: boolean): boolean | null => (explicit || options.every((o) => o.has(word)) ? true : options.some((o) => o.has(word)) ? null : false);
        return { isStatic: flag("static", d.isStatic), isInline: flag("inline", d.isInline), weak };
    };

    /**
     * What an include names: its path; for a computed one, the path each
     * definition read of its macro writes (null where one writes something
     * else). Where no file read defines the macro, the command line may, with
     * any header: null; unless the include sits in a branch that only a
     * macro no file read defines opens (`#ifdef LUA_USER_H` / `#include
     * LUA_USER_H`), where nothing the reads can't see comes before it and
     * every source of the unit's definitions is known (`seen`: no open macro
     * of its build, no usage requirement unread): the command line alone
     * could open it, and it is out of reach.
     */
    const computed = (inc: Include, branches: readonly Branch[], seen: boolean): ({ spec: string; angle: boolean } | null)[] => {
        if (inc.spec) return [{ spec: inc.spec, angle: inc.angle }];
        if (!inc.macro) return [null];
        const defs = macros.get(inc.macro) ?? [];
        if (defs.length === 0) {
            const own = (b: Branch) => b.conds.split("\n")[b.index];
            const needs = (b: Branch) => own(b).split("&&").map((c) => /^(?:defined\((\w+)\)|(\w+))$/.exec(c)?.slice(1).find(Boolean) ?? "");
            return seen && branches.some((b) => own(b) !== "else" && needs(b).some((m) => m && /^[A-Za-z_]/.test(m) && !macros.has(m))) ? [] : [null];
        }
        return defs.map((m) => {
            const v = /^(?:"([^"]+)"|<([^>]+)>)$/.exec(m.body.replace(/\/\*[\s\S]*?\*\//g, "").trim());
            return m.params || !v ? null : { spec: v[1] ?? v[2], angle: !!v[2] };
        });
    };

    /** A C file's translation unit: the headers it includes, each once, as far as they resolve; the includes that don't, where they are. */
    const tuOf = memo((path): Tu => {
        const build = buildOf(path);
        const out: Tu = { files: [], unread: [], lenient: [], outside: [] };
        const seen = new Set([path]);
        // The macros defined before each include, in the order the preprocessor reads: an include guard among them skips its header.
        const defined = new Set(build.defines.map((m) => m.name));
        // A header the build has the compiler read first (`-include`): unread, before every line.
        for (const h of build.forced) out.unread.push({ key: [-1], why: `${h}: read before the file by its build` });
        const visit = (file: string, prefix: Key, chain: Branch[][], skippable: boolean) => {
            const p = pre(file);
            const includes = new Map(p.includes.map((i) => [i.start, i]));
            for (const d of p.directives) {
                if (d.name === "define") defined.add(/^[A-Za-z_]\w*/.exec(d.rest)?.[0] ?? "");
                const inc = includes.get(d.start);
                if (!inc) continue;
                const branches = p.branchesAt(inc.start);
                if (branches.some((b) => b.dead)) continue;
                const key = [...prefix, inc.start];
                for (const target of computed(inc, branches, out.unread.length === 0 && !build.open)) {
                    if (!target) {
                        out.unread.push({ key, why: `an include ${inc.macro ?? "a macro"} names` });
                        continue;
                    }
                    // An angle include found nowhere in a branch is taken for a platform's or a library's only where build files gave the unit's include folders.
                    const r = resolveInclude(file, target.spec, target.angle, exists, build.search, branches.length > 0);
                    if (r.kind !== "file") out.outside.push({ key, spec: target.spec, ...(r.kind === "system" && r.lenient ? { lenient: true as const } : {}), ...(r.kind === "unknown" ? { unknown: true as const } : {}) });
                    if (r.kind === "system") {
                        if (r.lenient) out.lenient.push(key);
                        continue;
                    }
                    if (r.kind === "unknown") {
                        out.unread.push({ key, why: `${target.spec}: ${r.why}` });
                        continue;
                    }
                    const body = text(r.path);
                    if (body === undefined || /^[\w./+-]+\s*$/.test(body)) {
                        // Not read, or a symbolic link, whose blob is the path it points to.
                        out.unread.push({ key, why: `${target.spec}: not read` });
                        continue;
                    }
                    if (seen.has(r.path)) continue;
                    const guard = pre(r.path).guard;
                    if (guard && defined.has(guard)) {
                        out.unread.push({ key, why: `${target.spec}: its include guard is defined before` });
                        continue;
                    }
                    seen.add(r.path);
                    const includes = [...chain, branches];
                    // A guard a header the reads can't resolve may define (one before; a system header, where the guard is its own reserved name, `_UTIL_H`), or the build may: the header may be skipped, and what it includes.
                    const skip = skippable || (!!guard && (out.unread.length > 0 || build.open || (reserved(guard) && out.outside.some((o) => guardsAlike(guard, o.spec)))));
                    out.files.push({ path: r.path, key, includes, ...(skip ? { skippable: true as const } : {}) });
                    visit(r.path, key, includes, skip);
                }
            }
        };
        visit(path, [], [], false);
        return out;
    });

    // Every macro the texts read define, in C and C++ files, in what C files include, and in build files: a specifier macro's every definition is read.
    const scanned = new Set<string>();
    const scan = (path: string) => {
        if (scanned.has(path)) return;
        scanned.add(path);
        for (const m of pre(path).macros) addMacro({ ...m, file: path });
    };
    const builds = new Set<string>();
    const fromBuilds = new Set<string>();
    for (const path of read) {
        if (SOURCE.test(path)) scan(path);
        // The macros the build files of each folder of C files define, each once.
        if (C_SOURCE.test(path) && !builds.has(dirOf(path))) {
            builds.add(dirOf(path));
            for (const m of folderOf(dirOf(path)).defines) {
                const key = `${m.file}\n${m.name}(${m.params?.join(",") ?? ""})=${m.body}`;
                if (fromBuilds.has(key)) continue;
                fromBuilds.add(key);
                addMacro(m);
            }
        }
    }
    // A header only an include reaches may define a macro a computed include names: read units again until no new file turns up.
    for (let round = 0; round < 6; round++) {
        const before = scanned.size;
        for (const f of files) if (grammarOf(f.path) === "c") for (const tf of tuOf(f.path).files) scan(tf.path);
        tuOf.clear();
        if (scanned.size === before) break;
    }

    /** The macros a translation unit's files and build files define, and the names its directives define, undefine or make weak: what may be visible in it. */
    const tuMacros = memo((path): { names: Set<string>; defs: Map<string, Macro[]> } => {
        const names = new Set<string>();
        const defs = new Map<string, Macro[]>();
        const add = (m: Macro) => {
            const list = defs.get(m.name);
            if (list) list.push(m);
            else defs.set(m.name, [m]);
        };
        for (const file of [path, ...tuOf(path).files.map((x) => x.path)]) {
            const p = pre(file);
            for (const n of p.macroNames) names.add(n);
            p.macros.forEach(add);
        }
        for (const m of buildOf(path).defines) {
            names.add(m.name);
            add(m);
        }
        return { names, defs };
    });

    /**
     * The file a C file includes first, before any code or other directive:
     * through it, a header the reads can't resolve (a generated
     * `curl_config.h`) is read the same way at the start of every unit that
     * starts with it and searches the same folders with the same macros.
     */
    const firstInclude = memo((path): string => {
        const p = pre(path);
        const d = p.directives[0];
        if (!d || d.name !== "include" || p.includes.length === 0 || p.includes[0].start !== d.start) return "";
        const before = (text(path) ?? "").slice(0, d.start).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
        if (before.trim() !== "") return "";
        const r = resolveInclude(path, p.includes[0].spec, p.includes[0].angle, exists, buildOf(path).search);
        return r.kind === "file" && text(r.path) !== undefined ? `${r.path}\n${buildOf(path).key}` : "";
    });
    /** Whether every unresolved include of a unit before a place comes through its first include, `first`. */
    const unreadOnlyThrough = (path: string, before: Key, first: string): boolean => {
        const unread = tuOf(path).unread.filter((u) => cmp(u.key, before) < 0);
        if (unread.length === 0) return true;
        if (!first || firstInclude(path) !== first) return false;
        const at = pre(path).includes[0].start;
        return unread.every((u) => u.key.length > 1 && u.key[0] === at);
    };

    /** Where a file's text is at file scope: outside the bodies of the function definitions the parser read whole, and outside directives. */
    const fileScope = (path: string): [number, number][] => {
        const f = byPath.get(path);
        const t = f?.flat;
        const skip: [number, number][] = pre(path).directives.map((d) => [d.start, d.end]);
        if (f && t) {
            for (const def of decls(path)?.definitions ?? []) {
                const body = child(t, def, "body");
                if (body >= 0 && f.unitByNode.has(def)) skip.push([t.start[body], t.end[body]]);
            }
        }
        skip.sort((a, b) => a[0] - b[0]);
        const out: [number, number][] = [];
        let pos = 0;
        for (const [a, b] of skip) {
            if (a > pos) out.push([pos, a]);
            pos = Math.max(pos, b);
        }
        const end = (text(path) ?? "").length;
        if (pos < end) out.push([pos, end]);
        return out;
    };
    /** The names the macros used at a file's scope may write: a definition a macro writes (`STUB(foo, get)`) is none the tree shows. */
    const fileWrites = memo((path): Writes => {
        const body = text(path) ?? "";
        const out = NO_WRITES();
        for (const [from, to] of fileScope(path)) {
            const toks = tokenize(body, from, to).map((x) => x.tok);
            for (let i = 0; i < toks.length; i++) {
                const tok = toks[i];
                const defs = macros.get(tok);
                if (!defs || toks[i - 1] === "." || toks[i - 1] === "->") continue;
                let end = i + 1;
                if (toks[i + 1] === "(" && defs.some((m) => m.params)) {
                    const call = argumentsAt(toks, i + 1);
                    end = call ? call.end : toks.length;
                } else if (defs.every((m) => m.params)) continue;
                writesOf(toks.slice(i, end), reachAll, out, end === i + 1 && called(toks, i));
            }
        }
        return out;
    });

    /**
     * What a file read as text alone (the parser rejected it) may define:
     * each name written at brace depth 0 before a parenthesized list that no
     * `;`, `,` or `=` follows (`int f(void) {`, `int f(void) BEGIN`, K&R's
     * `int f(a) int a; {`), and what the macros used at depth 0 may write.
     * Every branch of every conditional is read, each from the depth its
     * conditional starts at (`#if A` / `#elif B` / `#else` alike). Where the
     * branches of one end at different depths (a brace opened under `#ifdef
     * X` and closed under a later one), the file is read once per branch
     * number instead, each conditional taking that branch (its `#else` past
     * its last, none where it has no `#else`). Where those readings' braces
     * don't balance either, depth is no guide: there, each name whose list is
     * followed, past closing parentheses and further lists, by a `{` or a
     * name, and what every macro used may write.
     */
    const textDefines = memo((path): { names: Set<string>; writes: Writes } => {
        const body = text(path) ?? "";
        const writes = NO_WRITES();
        const names = new Set<string>();
        const uses = (toks: readonly string[], i: number, into: Writes) => {
            const defs = macros.get(toks[i]);
            if (!defs || toks[i - 1] === "." || toks[i - 1] === "->") return;
            const call = toks[i + 1] === "(" && defs.some((m) => m.params) ? argumentsAt(toks, i + 1) : null;
            writesOf(toks.slice(i, call ? call.end : i + 1), reachAll, into, !call && called(toks, i));
        };
        // The tokens between directives, each span with the branch of each conditional open around it; a conditional's directives are spans of their own (`open`: the conditional's number, or -2 for `#elif`, -4 `#else`, -3 `#endif`).
        const conds: { branches: number; final: boolean }[] = [];
        const spans: { toks: string[]; at: [number, number][]; open: number }[] = [];
        const stack: number[] = [];
        let from = 0;
        for (const d of pre(path).directives) {
            spans.push({ toks: tokenize(body, from, d.start).map((x) => x.tok), at: stack.map((c) => [c, conds[c].branches - 1]), open: -1 });
            from = d.end;
            if (/^if(n?def)?$/.test(d.name)) {
                stack.push(conds.length);
                conds.push({ branches: 1, final: false });
                spans.push({ toks: [], at: [], open: conds.length - 1 });
            } else if (/^(?:elif(?:n?def)?|else)$/.test(d.name) && stack.length > 0) {
                const c = conds[stack[stack.length - 1]];
                c.branches++;
                c.final ||= d.name === "else";
                spans.push({ toks: [], at: [], open: d.name === "else" ? -4 : -2 });
            } else if (d.name === "endif" && stack.length > 0) {
                stack.pop();
                spans.push({ toks: [], at: [], open: -3 });
            }
        }
        spans.push({ toks: tokenize(body, from, body.length).map((x) => x.tok), at: stack.map((c) => [c, conds[c].branches - 1]), open: -1 });
        /** The names a token stream defines at depth 0, read from depth `depth`; what its macros there write. */
        const scan = (toks: readonly string[], state: { depth: number; ok: boolean; found: Set<string>; writes: Writes }) => {
            for (let i = 0; i < toks.length && state.ok; i++) {
                const tok = toks[i];
                if (tok === "{") state.depth++;
                else if (tok === "}" && --state.depth < 0) state.ok = false;
                if (state.depth !== 0 || !IDENT.test(tok) || KEYWORDS.has(tok)) continue;
                uses(toks, i, state.writes);
                // `(f)(…)` names f as `f(…)` does.
                const at = toks[i + 1] === "(" ? i + 1 : toks[i - 1] === "(" && toks[i + 1] === ")" && toks[i + 2] === "(" ? i + 2 : -1;
                if (at < 0) continue;
                const call = argumentsAt(toks, at);
                if (!call) {
                    state.ok = false;
                    continue;
                }
                // A list that ends where a directive starts may be a definition's: what follows is the branches'.
                const next = toks[call.end];
                if (next !== undefined && /^[;,=]$/.test(next)) continue;
                state.found.add(tok);
                // A macro's use read as a declarator, `FN(helper)(void)`, may define any name of its arguments.
                if (next === "(") for (const t of toks.slice(at, call.end)) if (IDENT.test(t)) state.found.add(t);
            }
        };
        // Every branch at once, each from its conditional's depth.
        const all = { depth: 0, ok: true, found: new Set<string>(), writes: NO_WRITES() };
        const open: { start: number; ends: number[]; final: boolean }[] = [];
        for (const sp of spans) {
            if (sp.open >= 0) open.push({ start: all.depth, ends: [], final: false });
            else if ((sp.open === -2 || sp.open === -4) && open.length > 0) {
                const top = open[open.length - 1];
                top.ends.push(all.depth);
                all.depth = top.start;
                top.final ||= sp.open === -4;
            } else if (sp.open === -3 && open.length > 0) {
                const top = open.pop()!;
                top.ends.push(all.depth);
                // No `#else`: a build may take no branch, and stay at the depth it started at.
                if (!top.final) top.ends.push(top.start);
                all.depth = top.ends[0];
                if (top.ends.some((e) => e !== top.ends[0])) all.ok = false;
            } else if (sp.open === -1) scan(sp.toks, all);
        }
        const readings = [all];
        if (!all.ok || all.depth !== 0) {
            readings.length = 0;
            // Once per branch number: a conditional takes that branch, its `#else` past its last, none without one.
            const most = Math.max(1, ...conds.map((c) => c.branches + (c.final ? 0 : 1)));
            for (let k = 0; k < most; k++) {
                const take = (c: number) => (k < conds[c].branches ? k : conds[c].final ? conds[c].branches - 1 : -1);
                const r = { depth: 0, ok: true, found: new Set<string>(), writes: NO_WRITES() };
                scan(spans.filter((sp) => sp.open === -1 && sp.at.every(([c, b]) => take(c) === b)).flatMap((sp) => sp.toks), r);
                readings.push(r);
            }
        }
        if (readings.every((r) => r.ok && r.depth === 0)) {
            for (const r of readings) {
                r.found.forEach((n) => names.add(n));
                for (const n of r.writes.names) writes.names.add(n);
                for (const t of r.writes.tokens) writes.tokens.add(t);
                for (const x of r.writes.reaches) writes.reaches.add(x);
            }
        } else {
            const toks = spans.flatMap((sp) => sp.toks);
            for (let i = 0; i < toks.length; i++) if (IDENT.test(toks[i])) uses(toks, i, writes);
            shapesIn(toks, names);
        }
        return { names, writes };
    });

    /** Whether a file may declare a name in a way the reads don't show. */
    const inDoubt = (path: string, name: string): boolean => {
        const d = decls(path);
        // Read as text alone (`.def`, `.inc`, or a file the parser couldn't read): any mention may declare it.
        if (!d) return wordsOf(path).has(name);
        if (d.doubtful.has(name) || mayWrite(fileWrites(path), name)) return true;
        const f = byPath.get(path)!;
        const mentions = (s: string) => new RegExp(`(?<![\\w$])${name}(?![\\w$])`).test(s);
        return d.brokenBodies.some((fn) => !f.unitByNode.has(fn) && mentions(f.flat.text.slice(f.flat.start[fn], f.flat.end[fn])));
    };

    /** Whether a file the parser read may define a name in a way it doesn't show: written as a definition in a region the tree can't read, by a macro used at file scope, or in a body whose errors may swallow one. */
    const mayDefine = (path: string, name: string): boolean => {
        const d = decls(path)!;
        if (d.defShaped.has(name) || mayWrite(fileWrites(path), name)) return true;
        const f = byPath.get(path)!;
        return d.brokenBodies.some((fn) => {
            if (f.unitByNode.has(fn)) return false;
            const found = new Set<string>();
            definitionShapes(f.flat.text, f.flat.start[fn], f.flat.end[fn], found);
            return found.has(name);
        });
    };

    /** Every declaration of a name in a translation unit, with where it is; `doubt` when a file of it may declare the name in a way the reads don't show. */
    const inTu = memo((k): { found: Found[]; doubt: boolean } => {
        const [path, name] = k.split("\n");
        const found: Found[] = [];
        let doubt = false;
        for (const file of [{ path, key: [] as Key, includes: [] as Branch[][] }, ...tuOf(path).files]) {
            if (inDoubt(file.path, name)) doubt = true;
            for (const decl of decls(file.path)?.byName.get(name) ?? []) found.push({ decl, path: file.path, key: [...file.key, decl.at], file });
        }
        return { found, doubt };
    });
    const tuDecls = (path: string, name: string) => inTu(`${path}\n${name}`);

    /** A definition's unit: the card that stands for it. */
    const unitOf = (path: string, d: Decl): Unit | undefined => (d.def >= 0 ? byPath.get(path)?.unitByNode.get(d.def) : undefined);

    /** Whether a header the reads couldn't resolve is included strictly between two places of a unit. */
    const unreadBetween = (tu: Tu, a: Key, b: Key): boolean => {
        const [lo, hi] = cmp(a, b) < 0 ? [a, b] : [b, a];
        return tu.unread.some((u) => cmp(u.key, lo) > 0 && cmp(u.key, hi) < 0);
    };

    /**
     * The external definitions of a name among every file read: those whose
     * linkage is external in their own unit. Null when one can't be told, or
     * when a file read may define the name in a way the reads don't show: a
     * file read as text alone (the parser rejected it) that names it, a
     * macro's use, an error.
     */
    /** For the tools: the file that left a name's external definitions unknown. */
    const unknownBy = new Map<string, string>();
    const externalOf = memo((name): { path: string; decl: Decl }[] | null => {
        const out: { path: string; decl: Decl }[] = [];
        const none = (path: string) => (unknownBy.set(name, path), null);
        for (const path of read) {
            if (!SOURCE.test(path)) continue;
            const f = byPath.get(path);
            if (!f) {
                const defs = textDefines(path);
                if (defs.names.has(name) || mayWrite(defs.writes, name)) return none(path);
                continue;
            }
            if (mayDefine(path, name)) return none(path);
            const defs = (decls(path)?.byName.get(name) ?? []).filter((d) => d.def >= 0 && d.kind === "function");
            if (defs.length === 0) continue;
            if (isCppSource(path)) return none(path);
            const isC = grammarOf(path) === "c" && C_SOURCE.test(path);
            for (const d of defs) {
                const spec = specOf(d, isC ? path : undefined);
                if (spec.isStatic === true) continue;
                if (spec.isStatic === null) return none(path);
                if (!isC) {
                    // A header's: one each unit including it makes, unless inline.
                    if (spec.isInline !== true) out.push({ path, decl: d });
                    continue;
                }
                const own = tuDecls(path, name);
                if (own.doubt) return none(path);
                const linkage = own.found.map((x) => specOf(x.decl, path).isStatic);
                if (linkage.includes(true)) continue;
                if (linkage.includes(null)) return none(path);
                out.push({ path, decl: d });
            }
        }
        return out;
    });

    const platformsOf = (path: string): string[] => path.split(/[/._-]/).filter((s) => PLATFORM.test(s)).map((s) => s.toLowerCase());

    const ownNames = new Map<string, Map<number, Set<string>>>();
    const declaresOwn = (f: GFile, fn: number, name: string): boolean => {
        let m = ownNames.get(f.path);
        if (!m) ownNames.set(f.path, (m = new Map()));
        let names = m.get(fn);
        if (!names) m.set(fn, (names = ownNamesOf(f.flat, fn)));
        return names.has(name);
    };

    /** What the macros a name reaches write, among those a unit may see. */
    const reachOf = memo((path) => reacher((m) => tuMacros(path).defs.get(m)));

    /**
     * Whether a header outside the repository that a unit includes may make a
     * name a macro: one a branch says is a library's (`lenient`) may pull in
     * more. An include found nowhere may be the repository's own header (the
     * unit's unread ones): the rules for those apply instead.
     */
    const macroHeaders = memo((path) => tuOf(path).outside.filter((x) => !x.unknown && definesMacros(x.spec, !!x.lenient)));
    const systemMacroOf = memo((k): boolean => {
        const [path, name] = k.split("\n");
        return macroHeaders(path).some((x) => systemMacro(x.spec, name, !!x.lenient));
    });
    const systemMacroName = (path: string, name: string): boolean => systemMacroOf(`${path}\n${name}`);
    /** Whether such a header is included strictly between two places of a unit. */
    const systemMacroBetween = (path: string, name: string, a: Key, b: Key): boolean => {
        const [lo, hi] = cmp(a, b) < 0 ? [a, b] : [b, a];
        return macroHeaders(path).some((x) => cmp(x.key, lo) > 0 && cmp(x.key, hi) < 0 && systemMacro(x.spec, name, !!x.lenient));
    };

    /** Whether a name the unit may see is declared there as an ordinary identifier, or by the function. */
    const declared = (f: GFile, fn: number, name: string): boolean => {
        if (declaresOwn(f, fn, name) || tuDecls(f.path, name).found.length > 0) return true;
        // A name a header of the unit read as text alone mentions in its code is declared there, though the tree can't say how.
        return tuOf(f.path).files.some((x) => !byPath.has(x.path) && wordsOf(x.path).has(name));
    };

    /**
     * What a function holds before and around its calls, read from its text:
     * each `#include`; each use of a macro the unit may see (a function-like
     * one with its arguments); each call to a name that is no keyword, no
     * C library name, and declared neither in the unit nor in the function,
     * and each such name standing alone as a statement (a macro of a header
     * the reads don't have).
     */
    const eventsOf = memo((k): Event[] => {
        const [path, fnText] = k.split("\n");
        const f = byPath.get(path)!;
        const t = f.flat;
        const fn = Number(fnText);
        // From the function's name on: its parameters and K&R declarations hold uses too.
        let own = child(t, fn, "declarator");
        while (own >= 0 && t.type[own] !== "identifier") own = child(t, own, "declarator");
        const from = own >= 0 ? t.end[own] : t.start[fn];
        const to = t.end[fn];
        const visible = tuMacros(path);
        const events: Event[] = [];
        const toks: { tok: string; at: number }[] = [];
        let pos = from;
        for (const d of pre(path).directives) {
            if (d.start < from || d.start >= to) continue;
            toks.push(...tokenize(t.text, pos, d.start));
            if (/^(?:include|include_next|import)$/.test(d.name)) events.push({ kind: "include", name: "", start: d.start, end: d.end, toks: [], args: [], argAt: [] });
            pos = d.end;
        }
        toks.push(...tokenize(t.text, pos, to));
        const strings = toks.map((x) => x.tok);
        const endOf = (i: number) => (i < toks.length ? toks[i].at : to);
        for (let i = 0; i < toks.length; i++) {
            const tok = strings[i];
            if (!IDENT.test(tok) || strings[i - 1] === "." || strings[i - 1] === "->" || KEYWORDS.has(tok)) continue;
            const call = strings[i + 1] === "(";
            const defs = visible.defs.get(tok) ?? [];
            const event = (kind: Event["kind"]) => {
                const args = call ? argumentsAt(strings, i + 1) : null;
                const end = call ? (args ? args.end : toks.length) : i + 1;
                const argAt = (args?.args ?? []).map(([a, b]): [number, number] => [endOf(a), endOf(b)]);
                // An object-like macro that names a function, called: `FREE(p)` for `#define FREE jv_mem_free`.
                const alias = call && defs.length > 0 && defs.every((m) => !m.params && IDENT.test(m.body.trim())) && called(strings, i);
                events.push({ kind, name: tok, start: toks[i].at, end: endOf(end), toks: strings.slice(i, end), args: args?.args.map(([a, b]): [number, number] => [a - i, b - i]) ?? [], argAt, ...(alias ? { alias } : {}) });
            };
            if (defs.length > 0) {
                if (call || defs.some((m) => !m.params)) event("macro");
                continue;
            }
            if (reserved(tok) || strings[i - 1] === "struct" || strings[i - 1] === "union" || strings[i - 1] === "enum") continue;
            if (visible.names.has(tok) || !declared(f, fn, tok) || systemMacroName(path, tok)) {
                // A name standing alone as a statement, `HOOKS;`, is no C but a macro's use.
                const alone = !call && (strings[i + 1] === ";" || strings[i + 1] === "}") && /^(?:[;{})]|else|do)$/.test(strings[i - 1] ?? ";");
                if (call || alone) event("unknown");
            }
        }
        return events.sort((a, b) => a.start - b.start);
    });

    /** Why a call in a function may name something else than the unit's declarations say: an include, a macro's use or an unknown call before or around it. */
    const inFunction = (f: GFile, fn: number, at: number, name: string): string | null => {
        const tu = tuOf(f.path);
        const unreadBefore = tu.unread.some((u) => cmp(u.key, [at]) < 0) || tu.lenient.some((k) => cmp(k, [at]) < 0);
        const visible = tuMacros(f.path);
        const reach = reachOf(f.path);
        for (const e of eventsOf(`${f.path}\n${fn}`)) {
            if (e.start >= at) break;
            const around = at < e.end;
            if (e.kind === "include") return "an include in the function before the call";
            if (e.kind === "unknown") {
                if (!unreadBefore && !systemMacroName(f.path, e.name)) continue;
                if (around) return "in the arguments of a name the reads don't declare";
                // A call before, with the name among its arguments, or a name alone as a statement, may declare it.
                if (e.toks.includes(name) || e.toks.length === 1) return "after a name the reads don't declare, which may declare it";
                continue;
            }
            if (!around) {
                e.writes ??= e.alias ? writesOf(e.toks.slice(1), reach, writesOf([e.name], reach, NO_WRITES(), true)) : writesOf(e.toks, reach);
                if (mayWrite(e.writes, name)) return "after a macro that may declare the name";
                continue;
            }
            const k = e.argAt.findIndex(([a, b]) => at >= a && at < b);
            if (k < 0) return "in a macro's use";
            const [a, b] = e.args[k];
            const holed = [...e.toks.slice(0, a), HOLE, ...e.toks.slice(b)];
            // An alias called is a function's call: its arguments are passed on as they are.
            if (e.alias) {
                if (mayWrite(writesOf(holed.slice(1), reach, writesOf([e.name], reach, NO_WRITES(), true)), name)) return "in a macro's arguments";
                continue;
            }
            if (!passesArgument(visible.defs.get(e.name) ?? [], k, (m) => (visible.names.has(m) ? (visible.defs.get(m) ?? []) : undefined))) return "in a macro's arguments";
            if (mayWrite(writesOf(holed, reach), name)) return "in a macro's arguments";
        }
        return null;
    };

    /** The unit a call names, or why it names none. */
    const decide = (f: GFile, s: GSite): Unit | string => {
        if (!C_SOURCE.test(f.path) || grammarOf(f.path) !== "c" || s.ref !== "call") return "not a call in a C file";
        const t = f.flat;
        const n = s.node;
        const name = s.name;
        if (reserved(name)) return "a C library name";
        const tu = tuOf(f.path);
        const visible = tuMacros(f.path);
        if (visible.names.has(name)) return "a macro's name";
        if (spliced(t.text, t.start[n], t.end[n])) return "spliced with the line before or after";
        if (inError(t, n)) return "in an ERROR node";
        const fn = enclosingFunction(t, n);
        if (fn < 0 || !f.unitByNode.has(fn)) return "outside a function the parser read whole";
        if (declaresOwn(f, fn, name)) return "the function declares the name";
        const build = buildOf(f.path);
        if (!build.known) return "its build files weren't read";
        if (build.cxx) return "its build compiles it as C++";
        if (build.open) return "its build may define any macro";
        const p = pre(f.path);
        if (p.unbalanced) return "the file's conditionals don't balance";
        if (p.guard && build.defines.some((m) => m.name === p.guard)) return "the file's include guard is defined by its build";
        const at = t.start[n];
        const branches = p.branchesAt(at);
        if (branches.some((b) => b.dead)) return "in a branch never compiled";
        const inside = inFunction(f, fn, at, name);
        if (inside) return inside;
        const { found, doubt } = tuDecls(f.path, name);
        if (doubt) return "a declaration in doubt";
        if (found.some((x) => x.decl.kind !== "function")) return "declared as no function";
        const specs = found.map((x) => specOf(x.decl, f.path));
        if (found.some((x) => x.decl.parenthesized && x.decl.def >= 0) || specs.some((sp) => sp.weak !== false)) return "weak, an alias or (f)";
        const key: Key = [at];
        const defs = found.filter((x) => x.decl.def >= 0);
        if (defs.length > 1) return "defined twice in its unit";
        if (defs.length === 1) {
            const d = defs[0];
            const unit = unitOf(d.path, d.decl);
            if (!unit) return "a definition with no unit";
            const spec = specOf(d.decl, f.path);
            if (spec.isInline !== false && spec.isStatic !== true) return "an inline definition, or one a macro may make inline";
            if (unreadBetween(tu, key, d.key)) return "an unresolved include between call and definition";
            // A system header's macro of the name, included before both, renames call and definition alike.
            if (systemMacroBetween(f.path, name, key, d.key)) return "a system header that may make the name a macro, between call and definition";
            if (d.path === f.path) return withinAlike(p, branches, p.branchesAt(d.decl.at), d.decl.at, at, (m) => visible.defs.get(m)) ? unit : "defined in a branch the call isn't in";
            // In a header the file includes before the call.
            if (cmp(d.key, key) >= 0) return "a header included after the call";
            if (d.file.skippable) return "a header whose include guard what the reads can't see may define";
            if (pre(d.path).branchesAt(d.decl.at).length > 0) return "defined in a header's branch";
            const [top, ...nested] = d.file.includes;
            if (!within(branches, top) || nested.some((b) => b.length > 0)) return "a header included in a branch";
            // A header's definition with external linkage is the one only where no other file read defines the name.
            if (spec.isStatic !== true) {
                const ext = externalOf(name);
                if (!ext || ext.length !== 1 || ext[0].path !== d.path) return "a header's external definition, with others";
            }
            return unit;
        }
        // An external definition in another file: a system header's macro would rename the call and not the definition.
        if (systemMacroName(f.path, name)) return "a name a system header may make a macro";
        if (!found.some((x) => cmp(x.key, key) < 0)) return "no declaration before the call";
        if (specs.some((sp) => sp.isStatic !== false)) return "static, or a macro may make it, with no definition in its unit";
        const first = firstInclude(f.path);
        if (!unreadOnlyThrough(f.path, key, first)) return "an unresolved include before the call";
        const ext = externalOf(name);
        if (!ext) return "a definition whose linkage the reads can't tell, or one they may not show";
        if (ext.length !== 1) return ext.length === 0 ? "no definition read" : "several definitions read";
        const g = ext[0];
        if (g.path === f.path || grammarOf(g.path) !== "c" || !C_SOURCE.test(g.path)) return "defined in a header";
        const gb = buildOf(g.path);
        if (!gb.known) return "the definition's build files weren't read";
        if (gb.cxx || gb.open) return "the definition's build compiles it as C++, or may define any macro";
        if (builtOnSome(f.path, g.path)) return "a build file compiles the definition's file in some builds only";
        if (programsDiffer(f.path, g.path)) return "built into several programs, one without the definition's file";
        if (linkedOnSome(f.path, g.path)) return "a build links the definition's library in some builds only";
        if (!unreadOnlyThrough(g.path, [g.decl.at], first)) return "an unresolved include before the definition";
        if (tuMacros(g.path).names.has(name) || systemMacroName(g.path, name)) return "a macro's name where it is defined";
        const gp = pre(g.path);
        if (gp.guard && gb.defines.some((m) => m.name === gp.guard)) return "the definition's file may be skipped";
        const gs = specOf(g.decl, g.path);
        if (gs.isInline !== false || g.decl.parenthesized || gs.weak !== false) return "an inline, weak or (f) definition";
        if (gp.branchesAt(g.decl.at).length > 0) return "defined in a branch";
        const own = new Set(platformsOf(f.path));
        if (platformsOf(g.path).some((w) => !own.has(w))) return "defined in a platform's or a variant's file";
        return unitOf(g.path, g.decl) ?? "a definition with no unit";
    };
    /** For the tools: which files read may declare a name in a way the reads don't show, and how. */
    const doubtsOf = (name: string): string[] =>
        [...read].flatMap((path) => {
            if (!SOURCE.test(path)) return [];
            const d = decls(path);
            if (!d) {
                const t = textDefines(path);
                const defined = t.names.has(name) || mayWrite(t.writes, name);
                return wordsOf(path).has(name) || defined ? [`${path}: read as text${defined ? ", may define it" : ""}`] : [];
            }
            if (d.doubtful.has(name)) return [`${path}: doubtful${d.defShaped.has(name) ? " as a definition" : ""}`];
            if (mayWrite(fileWrites(path), name)) return [`${path}: a macro at file scope`];
            return inDoubt(path, name) ? [`${path}: a broken body${mayDefine(path, name) ? " as a definition" : ""}`] : [];
        });
    return Object.assign(decide, { tuOf, buildOf, eventsOf, doubtsOf, specOf, tuMacros, unknownBy });
};

/** For the tools and tests: what each call of a review's C files names, the unit or why none. */
export const explainCalls = createProgram;

/** C's and C++'s one resolver: C++'s files are the headers C's units include. */
export const C_FAMILY_RESOLVER: OwnResolver = {
    program: (files, ctx) => {
        const decide = createProgram(files, ctx);
        return (f, s) => {
            const u = decide(f, s);
            return typeof u === "string" ? NONE : [{ ref: "call", units: [u] }];
        };
    },
};
