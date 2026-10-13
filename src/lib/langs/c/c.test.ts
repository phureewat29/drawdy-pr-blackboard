import { describe, expect, it } from "@jest/globals";
import { testParse } from "../../../test/parser.ts";
import { isGeneric, type GFile } from "../../anyfacts.ts";
import type { ModuleContext } from "../../anylink.ts";
import { resolveAny } from "../../anylink.ts";
import { rulesOf } from "../../linking.ts";
import { folderBuild, readBuildFile } from "./build.ts";
import { candidatesOf, resolveInclude } from "./includes.ts";
import { declaratorParams } from "./expand.ts";
import { constantOf, passesArgument, readPreproc, withinAlike } from "./preproc.ts";
import { explainCalls } from "./resolver.ts";
import { cWants } from "./wants.ts";

const parse = async (files: Record<string, string>): Promise<GFile[]> => {
    const parsed: GFile[] = [];
    for (const [path, text] of Object.entries(files)) {
        const f = /\.(c|h|cpp|C)$/.test(path) ? await testParse(path, text) : null;
        if (f && isGeneric(f)) parsed.push(f);
    }
    return parsed;
};

/** Every call that links, as `path:line card (its file)`: the files given are all there is, any other path a 404. */
const calls = async (files: Record<string, string>): Promise<string[]> => {
    const parsed = await parse(files);
    const labels = new Map(parsed.flatMap((f) => [...f.labels]));
    return resolveAny(parsed, (f) => rulesOf(f.path)!.resolver, (path) => files[path], (path) => path in files, () => Object.keys(files)).flatMap((r) => r.units.map((u) => `${r.path}:${r.line} ${labels.get(u.id)}${u.path === r.path ? "" : ` (${u.path})`}`));
};

/** Why the call to `name` on a line names no definition (or the unit it names). */
const why = async (files: Record<string, string>, path: string, line: number, name: string): Promise<string> => {
    const parsed = await parse(files);
    const decide = explainCalls(parsed, { known: parsed.map((f) => f.path), text: (p) => files[p], exists: (p) => p in files, paths: Object.keys(files) });
    const f = parsed.find((x) => x.path === path)!;
    const s = f.sites.find((x) => x.line === line && x.name === name);
    if (!s) return "no site";
    const r = decide(f, s);
    return typeof r === "string" ? r : r.id;
};

/** A function's definition and a caller, around a body. */
const fn = (head: string, body = "return 0;") => `${head}\n{\n    ${body}\n}\n`;

/** Plain functions after a sample, so its few parse errors stay under the share the parser is trusted with; plain prototypes for a header. */
const pad = Array.from({ length: 30 }, (_, i) => fn(`int filler${i}(int x)`, `return x + ${i};`)).join("");
const decls = Array.from({ length: 30 }, (_, i) => `int filler${i}(int x);\n`).join("");

describe("C's calls in one file", () => {
    it("link to the file's own definition, static or not, before or after the call, and a recursive call to itself", async () => {
        const found = await calls({
            "src/a.c": `static int later(int);\n\n${fn("static int helper(int x)", "return x + 1;")}\n${fn("int run(int x)", "return helper(x) + later(x) + run(x - 1);")}\n${fn("static int later(int x)")}`,
        });
        expect(found).toEqual(["src/a.c:10 helper()", "src/a.c:10 later()", "src/a.c:10 run()"]);
    });

    it("link nothing where the function declares the name (a parameter, a local, a pointer), or an ERROR node in it may", async () => {
        const found = await calls({
            "src/a.c": `${fn("static int helper(void)")}\n${fn("int p(int (*helper)(void))", "return helper();")}\n${fn("int l(void)", "int (*helper)(void) = 0;\n    return helper();")}`,
        });
        expect(found).toEqual([]);
    });

    it("link nothing where a local typedef or a K&R parameter takes the name", async () => {
        expect(await calls({ "src/a.c": `${fn("static int helper(int x)")}${fn("int t(void)", "typedef int helper;\n    helper(y);\n    return 0;")}` })).toEqual([]);
        expect(await calls({ "src/a.c": `${fn("static int helper(void)")}${fn("int k(helper)", "return helper();")}` })).toEqual([]);
    });

    it("link nothing to a name some file of the unit makes a macro, or undefines, wherever it is", async () => {
        const base = fn("static int helper(void)") + fn("int run(void)", "return helper();");
        expect(await calls({ "src/a.c": `${base}#define helper() 1\n` })).toEqual([]);
        expect(await calls({ "src/a.c": `#include "m.h"\n${base}`, "src/m.h": "#undef helper\n" })).toEqual([]);
        // A macro in a file the unit doesn't include changes nothing here.
        expect(await calls({ "src/a.c": base, "src/b.c": "#define helper() 1\n" })).toEqual(["src/a.c:7 helper()"]);
    });

    it("link nothing to a name the C library or a system header may own, though the file defines it", async () => {
        expect(await calls({ "src/a.c": fn("static int strlen(const char *s)") + fn("int run(void)", 'return strlen("x");') })).toEqual([]);
        expect(await why({ "src/a.c": fn("static int __x(void)") + fn("int run(void)", "return __x();") }, "src/a.c", 7, "__x")).toBe("a C library name");
    });

    it("link to a definition in a conditional only from the same branch, or one with the same conditions and nothing between redefining their names", async () => {
        const files = (between: string) => ({
            "src/a.c": `#ifdef USE_X\n${fn("static int x(void)")}#endif\n${fn("int a(void)", "return x();")}#ifdef USE_X\n${fn("int b(void)", "return x();")}${between}${fn("int c(void)", "return 0;")}#endif\n#ifdef USE_X\n${fn("int d(void)", "return x();")}#endif\n`,
        });
        expect(await calls(files(""))).toEqual(["src/a.c:14 x()", "src/a.c:24 x()"]);
        expect(await calls(files("#undef USE_X\n"))).toEqual(["src/a.c:14 x()"]);
        expect(await why(files(""), "src/a.c", 9, "x")).toBe("defined in a branch the call isn't in");
    });

    it("link nothing from a branch never compiled, or to a name defined twice", async () => {
        expect(await calls({ "src/a.c": `${fn("static int x(void)")}#if 0\n${fn("int a(void)", "return x();")}#endif\n` })).toEqual([]);
        expect(await calls({ "src/a.c": `#ifdef A\n${fn("static int x(void)", "return 1;")}#else\n${fn("static int x(void)", "return 2;")}#endif\n${fn("int a(void)", "return x();")}` })).toEqual([]);
    });

    it("link nothing to a weak or aliased definition, by attribute or by a macro that writes one, nor to one written `(f)(…)`", async () => {
        expect(await calls({ "src/a.c": `__attribute__((weak)) ${fn("int x(void)")}${fn("int a(void)", "return x();")}` })).toEqual([]);
        expect(await calls({ "src/a.c": `#define WEAK __attribute__((weak))\nWEAK ${fn("int x(void)")}${fn("int a(void)", "return x();")}${pad}` })).toEqual([]);
        expect(await calls({ "src/a.c": `${fn("static int (x)(void)")}${fn("int a(void)", "return x();")}` })).toEqual([]);
        // An asm label gives the call another symbol than the definition's.
        expect(await why({ "src/h.h": `int x(void) __asm__("real_x");\n${decls}`, "src/a.c": `#include "h.h"\n${fn("int x(void)")}${fn("int a(void)", "return x();")}` }, "src/a.c", 8, "x")).toBe("weak, an alias or (f)");
    });

    it("link nothing to a C99 inline definition, or one a specifier macro may make inline, but to a static inline one", async () => {
        expect(await calls({ "src/a.c": `${fn("inline int x(void)")}${fn("int a(void)", "return x();")}` })).toEqual([]);
        expect(await calls({ "src/a.c": `#ifdef NDEBUG\n#define API inline\n#else\n#define API static inline\n#endif\nAPI ${fn("int x(void)")}${fn("int a(void)", "return x();")}${pad}` })).toEqual([]);
        expect(await calls({ "src/a.c": `#define API static inline\nAPI ${fn("int x(void)")}${fn("int a(void)", "return x();")}${pad}` })).toEqual(["src/a.c:8 x()"]);
    });
});

describe("C's calls inside a macro's arguments", () => {
    const at = (macro: string, call = "M(x())") => ({ "src/a.c": `${macro}\n${fn("static int x(void)")}${fn("int a(void)", `return ${call};`)}` });

    it("link where every definition of the macro passes the argument on as code", async () => {
        expect(await calls(at("#define M(e) ((e) + 1)"))).toEqual(["src/a.c:8 x()"]);
        expect(await calls(at("#define M(fmt, ...) printf(fmt, __VA_ARGS__)", 'M("%d", 1, x())'))).toEqual(["src/a.c:8 x()"]);
    });

    it("link nothing where a definition stringifies or pastes it, reads it as a member, drops it, or names the function itself", async () => {
        for (const macro of ["#define M(e) #e", "#define M(e) e##_t", "#define M(e) s->e", "#define M(e) 0", "#define M(e) (x, e)", "#ifdef A\n#define M(e) (e)\n#else\n#define M(e) 0\n#endif"]) expect([macro, await calls(at(macro))]).toEqual([macro, []]);
    });

    it("follow the argument into the macros the body calls with it: one that stringifies it, or a parameter called, passes nothing on", async () => {
        expect(await calls(at("#define S(y) #y\n#define M(x) S(x)"))).toEqual([]);
        expect(await calls(at("#define P(y) (y)\n#define M(x) P(x)"))).toEqual(["src/a.c:9 x()"]);
        expect(await calls(at("#define M(f, x) f(x)", "M(DROP, x())"))).toEqual([]);
    });

    it("read the macro's use from the text where the tree misreads it as a declaration", async () => {
        // lua's `assert_code(l_mem m = size(o));`: the tree reads a declaration typed by a macro, and the macro drops it unless asserts are on.
        const files = { "src/a.c": `#ifdef DEBUG\n#define assert_code(c) c\n#else\n#define assert_code(c) ((void)0)\n#endif\n${fn("static int size(int o)")}${fn("int a(int o)", "assert_code(long m = size(o));\n    return 0;")}${pad}` };
        expect(await why(files, "src/a.c", 12, "size")).toBe("in a macro's arguments");
    });

    it("count the arguments as the preprocessor does, at commas outside parentheses only", async () => {
        // `M({1, 2}, x())` passes three arguments, and the third is dropped.
        expect(await calls(at("#define M(a, b, c) (a b)", "M({1, 2}, x())"))).toEqual([]);
        expect(passesArgument(readPreproc("#define M(a, b) (b)\n").macros, 1)).toBe(true);
    });
});

describe("C's calls to a header's definitions", () => {
    const header = "#ifndef UTIL_H\n#define UTIL_H\nstatic inline int twice(int x) { return 2 * x; }\n#endif\n";

    it("link to a static inline function of a header included before the call, its include guard aside", async () => {
        expect(await calls({ "src/a.c": `#include "util.h"\n${fn("int a(void)", "return twice(1);")}`, "src/util.h": header })).toEqual(["src/a.c:4 twice() (src/util.h)"]);
    });

    it("link nothing where the header is included after the call, in a branch the call isn't in, or defines it in a branch", async () => {
        expect(await calls({ "src/a.c": `${fn("int a(void)", "return twice(1);")}#include "util.h"\n`, "src/util.h": header })).toEqual([]);
        expect(await calls({ "src/a.c": `#ifdef FAST\n#include "util.h"\n#endif\n${fn("int a(void)", "return twice(1);")}`, "src/util.h": header })).toEqual([]);
        expect(await calls({ "src/a.c": `#include "util.h"\n${fn("int a(void)", "return twice(1);")}`, "src/util.h": `#ifdef FAST\n${header}#endif\n` })).toEqual([]);
    });

    it("link nothing where a header the reads can't resolve is included between the definition and the call", async () => {
        const files = { "src/a.c": `#include "util.h"\n#include "gen.h"\n${fn("int a(void)", "return twice(1);")}`, "src/util.h": header };
        expect(await why(files, "src/a.c", 5, "twice")).toBe("an unresolved include between call and definition");
    });
});

describe("C's calls to another file's definitions", () => {
    const H = "#ifndef NET_H\n#define NET_H\nint net_send(int fd);\n#endif\n";
    const NET = `#include "net.h"\n${fn("int net_send(int fd)", "return fd;")}`;
    const CALLER = `#include "net.h"\n${fn("int run(void)", "return net_send(1);")}`;

    it("link to the one external definition read, its prototype included before the call", async () => {
        expect(await calls({ "src/net.h": H, "src/net.c": NET, "src/app.c": CALLER })).toEqual(["src/app.c:4 net_send() (src/net.c)"]);
    });

    it("link nothing with no declaration before the call, a static one, or two definitions read", async () => {
        expect(await calls({ "src/net.c": NET.replace('#include "net.h"\n', ""), "src/app.c": fn("int run(void)", "return net_send(1);") })).toEqual([]);
        expect(await calls({ "src/net.h": H.replace("int net_send", "static int net_send"), "src/net.c": NET, "src/app.c": CALLER })).toEqual([]);
        expect(await calls({ "src/net.h": H, "src/net.c": NET, "tests/mock_net.c": fn("int net_send(int fd)", "return 0;"), "src/app.c": CALLER })).toEqual([]);
    });

    it("link nothing to a definition in a conditional, a platform's file, made static by its own unit, or in a C++ file", async () => {
        expect(await calls({ "src/net.h": H, "src/net.c": `#include "net.h"\n#ifdef _WIN32\n${fn("int net_send(int fd)")}#endif\n`, "src/app.c": CALLER })).toEqual([]);
        expect(await calls({ "src/net.h": H, "src/unix/net.c": `#include "../net.h"\n${fn("int net_send(int fd)")}`, "src/app.c": CALLER })).toEqual([]);
        expect(await calls({ "src/net.h": H, "src/own.h": "static int net_send(int fd);\n", "src/net.c": `#include "own.h"\n${fn("int net_send(int fd)")}`, "src/app.c": CALLER })).toEqual([]);
        expect(await calls({ "src/net.h": H, "src/net.cpp": `extern "C" ${fn("int net_send(int fd)")}`, "src/app.c": CALLER })).toEqual([]);
    });

    it("link nothing where a macro of the name is visible where it is defined", async () => {
        expect(await calls({ "src/net.h": H, "src/net.c": `#define net_send net_send_v2\n${NET}`, "src/app.c": CALLER })).toEqual([]);
    });

    it("link nothing past a header the reads can't resolve, unless both units start with the same header through which alone it comes", async () => {
        const setup = '#include "config.h"\n';
        const files = { "src/setup.h": setup, "src/net.h": H, "src/net.c": `#include "setup.h"\n${NET}`, "src/app.c": `#include "setup.h"\n${CALLER}` };
        expect(await calls(files)).toEqual(["src/app.c:5 net_send() (src/net.c)"]);
        expect(await why({ ...files, "src/app.c": `#include "net.h"\n#include "setup.h"\n${fn("int run(void)", "return net_send(1);")}` }, "src/app.c", 5, "net_send")).toBe("an unresolved include before the call");
        expect(await why({ ...files, "src/app.c": `#include "gen.h"\n${CALLER}` }, "src/app.c", 5, "net_send")).toBe("an unresolved include before the call");
    });

    it("read a specifier macro's expansion: `API` to a non-static or static; a word no file read defines, a name where every include resolves", async () => {
        const api = (def: string, before = "") => ({ "src/api.h": `${before}${def}\n#include "net.h"\n`, "src/net.h": `#ifndef NET_H\n#define NET_H\nAPI int net_send(int fd);\n${decls}#endif\n`, "src/net.c": `#include "api.h"\nAPI ${fn("int net_send(int fd)")}${pad}`, "src/app.c": `#include "api.h"\n${fn("int run(void)", "return net_send(1);")}` });
        expect(await calls(api("#define API __attribute__((visibility(\"default\")))"))).toEqual(["src/app.c:4 net_send() (src/net.c)"]);
        expect(await calls(api("#define API static"))).toEqual([]);
        // Only the command line could make `EXPORTED` a macro; with a header unread, that header could.
        expect(await calls(api("#define API EXPORTED"))).toEqual(["src/app.c:4 net_send() (src/net.c)"]);
        expect(await calls(api("#define API EXPORTED", '#include "gen.h"\n'))).toEqual([]);
    });
});

describe("C's units", () => {
    it("are read through C++'s grammar in a header, its `API size_t f(…)` read as a declaration of f", async () => {
        const files = { "lib/zstd.h": "#ifndef ZSTD_H\n#define ZSTD_H\n#define ZSTDLIB_API\nZSTDLIB_API size_t ZSTD_compressBound(size_t n);\n#endif\n", "lib/compress.c": `#include "zstd.h"\n${fn("size_t ZSTD_compressBound(size_t n)", "return n;")}`, "lib/app.c": `#include "zstd.h"\n${fn("size_t run(void)", "return ZSTD_compressBound(1);")}` };
        expect(await calls(files)).toEqual(["lib/app.c:4 ZSTD_compressBound() (lib/compress.c)"]);
    });

    it("doubt a name an ERROR node or a file-scope expression holds, or a header read as text alone mentions", async () => {
        expect(await why({ "src/a.c": `DECLARE(helper);\n${fn("static int helper(void)")}${fn("int a(void)", "return helper();")}` }, "src/a.c", 8, "helper")).toBe("a declaration in doubt");
        expect(await why({ "src/a.c": `#include "x.def"\n${fn("static int helper(void)")}${fn("int a(void)", "return helper();")}`, "src/x.def": "X(helper)\n" }, "src/a.c", 8, "helper")).toBe("a declaration in doubt");
    });

    it("are no function declared as a variable, a pointer, a typedef or an enumerator", async () => {
        expect(await calls({ "src/h.h": "extern int (*hook)(void);\n", "src/a.c": `#include "h.h"\n${fn("int hook_impl(void)")}${fn("int a(void)", "return hook();")}` })).toEqual([]);
        expect(await why({ "src/a.c": `enum { helper = 1 };\n${fn("int a(void)", "return helper();")}` }, "src/a.c", 4, "helper")).toBe("declared as no function");
    });
});

describe("C's includes", () => {
    const has = (paths: string[]) => (p: string) => paths.includes(p);
    const search = (...dirs: string[]) => ({ dirs, open: false });

    it("are the includer's folder's file first, then the one place among the build files' folders that holds it; no folder is guessed", () => {
        expect(resolveInclude("src/a.c", "b.h", false, has(["src/b.h", "b.h"]))).toEqual({ kind: "file", path: "src/b.h" });
        expect(resolveInclude("src/x/a.c", "b.h", false, has(["src/b.h"]), search("src"))).toEqual({ kind: "file", path: "src/b.h" });
        expect(resolveInclude("src/x/a.c", "b.h", false, has(["src/b.h", "include/b.h"]), search("src", "include"))).toEqual({ kind: "unknown", why: "found in several folders" });
        // With no build file naming `src/`, a header in a folder above is no candidate.
        expect(resolveInclude("src/x/a.c", "b.h", false, has(["src/b.h"]))).toEqual({ kind: "unknown", why: "not found" });
    });

    it("look for an angle include in the build files' folders alone; found nowhere it is unknown, or outside the repository in a branch", () => {
        expect(resolveInclude("src/a.c", "curl/curl.h", true, has(["include/curl/curl.h"]), search("include"))).toEqual({ kind: "file", path: "include/curl/curl.h" });
        expect(resolveInclude("src/a.c", "curl/curl.h", true, has(["include/curl/curl.h"]))).toEqual({ kind: "unknown", why: "not found" });
        expect(resolveInclude("src/a.c", "libssh2.h", true, has([]), search("include"), true)).toEqual({ kind: "system", lenient: true });
        expect(resolveInclude("src/a.c", "stdio.h", true, () => undefined)).toEqual({ kind: "system" });
        expect(candidatesOf("src/a.c", "stdio.h", false)).toEqual({ own: "src/stdio.h", others: [] });
    });

    it("trust only the includer's folder where a build file writes a folder it can't place", () => {
        const open = { dirs: ["src"], open: true };
        expect(resolveInclude("src/app/main.c", "util.h", false, has(["src/util.h"]), open)).toEqual({ kind: "unknown", why: "an include folder the build files don't place" });
        expect(resolveInclude("src/app/main.c", "util.h", false, has(["src/app/util.h"]), open)).toEqual({ kind: "file", path: "src/app/util.h" });
    });

    it("read the include folders a Makefile, CMake and Meson write; a variable set elsewhere leaves the search open", () => {
        const make = readBuildFile("src/Makefile", "DEPS=../deps\nCFLAGS+= -I$(DEPS)/hiredis -I ../deps/lua/src -I/usr/local/include -I$(UNKNOWN)/x\n");
        expect([make.dirs, make.open]).toEqual([["deps/hiredis", "deps/lua/src"], true]);
        // A build folder is the source folder it mirrors; a system folder hides no `-I` folder's header.
        const am = readBuildFile("lib/Makefile.am", "AM_CPPFLAGS = -I$(top_srcdir)/include -I$(top_builddir)/lib -isystem $(LIBFOO)/include\nrun:\n\tsrcdir=$(srcdir) ./x\n");
        expect([am.dirs, am.open]).toEqual([["include", "lib"], false]);
        const cmake = (text: string, above?: string) => readBuildFile("lib/CMakeLists.txt", text, (p) => (p === "CMakeLists.txt" ? above : undefined));
        expect(cmake('include_directories("${PROJECT_SOURCE_DIR}/include")\ntarget_include_directories(curl PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}" ${PROJECT_BINARY_DIR}/lib $<BUILD_INTERFACE:${PROJECT_SOURCE_DIR}/lib>)\n', "project(curl C)\n").dirs).toEqual(["include", "lib"]);
        // With no `project()` read above, the project's folder can't be placed.
        expect(cmake('include_directories("${PROJECT_SOURCE_DIR}/include")\n').open).toBe(true);
        expect(readBuildFile("src/meson.build", "inc = include_directories('.', '../vendor')\n").dirs).toEqual(["src", "vendor"]);
    });

    it("follow a computed include to each path its macro's definitions write; one whose macro no file read defines is unread, unless only such a macro opens its branch", async () => {
        const files = { "src/a.c": `#ifndef ALLOC_H\n#define ALLOC_H "alloc.h"\n#endif\n#include ALLOC_H\n${fn("int a(void)", "return twice(1);")}`, "src/alloc.h": "static inline int twice(int x) { return 2 * x; }\n" };
        expect(await calls(files)).toEqual(["src/a.c:7 twice() (src/alloc.h)"]);
        // Before both the definition and the call, it changes neither apart.
        expect(await calls({ "src/a.c": `#include USER_H\n${fn("static int x(void)")}${fn("int a(void)", "return x();")}` })).toEqual(["src/a.c:8 x()"]);
        const between = (open: string, before = "") => ({ "src/a.c": `${before}${fn("static int x(void)")}${open}${fn("int a(void)", "return x();")}` });
        expect(await why(between("#include USER_H\n"), "src/a.c", 8, "x")).toBe("an unresolved include between call and definition");
        // Only the command line could open `#ifdef USER_H`: out of reach; but a header the reads can't see, before it, could define USER_H.
        expect(await calls(between("#ifdef USER_H\n#include USER_H\n#endif\n"))).toEqual(["src/a.c:10 x()"]);
        expect(await calls(between("#if defined(USE_SYSTEM_H)\n#include SYSTEM_H_PATH\n#endif\n"))).toEqual(["src/a.c:10 x()"]);
        expect(await why(between("#ifdef USER_H\n#include USER_H\n#endif\n", '#include "gen.h"\n'), "src/a.c", 11, "x")).toBe("an unresolved include between call and definition");
    });

    it("read a guarded computed include as the command line's only where every source of the unit's definitions is known: a linked target's definition writes it, one not found leaves the macros open", async () => {
        const a = { "src/a.c": `${fn("static int x(void)")}#ifdef USER_H\n#include USER_H\n#endif\n${fn("int a(void)", "return x();")}` };
        const app = (hooks: string) => ({ ...a, "CMakeLists.txt": `project(p C)\n${hooks}\nadd_executable(app src/a.c)\ntarget_link_libraries(app PRIVATE hooks)\n` });
        const interface_ = { "hooks/CMakeLists.txt": "add_library(hooks INTERFACE)\ntarget_compile_definitions(hooks INTERFACE USER_H=<hooks.h>)\n" };
        expect(await why({ ...app("add_subdirectory(hooks)"), ...interface_ }, "src/a.c", 10, "x")).toBe("an unresolved include between call and definition");
        expect(await why({ ...app("add_subdirectory(${HOOKS_DIR} hooks)"), ...interface_ }, "src/a.c", 10, "x")).toBe("its build may define any macro");
        // A linked target that gives nothing leaves the include the command line's.
        expect(await calls({ ...app("add_subdirectory(hooks)"), "hooks/CMakeLists.txt": "add_library(hooks INTERFACE)\n" })).toEqual(["src/a.c:10 x()"]);
    });

    it("name no header with `#include_next`: the next one on the include path is the build's to know", () => {
        expect(readPreproc("#include_next <util.h>\n").includes.map((i) => [i.spec, i.angle])).toEqual([["", true]]);
    });

    it("read a header that is a symbolic link (its blob the path it points to) as one not read", async () => {
        const files = { "src/a.c": `#include "util.h"\n${fn("int a(void)", "return twice(1);")}`, "src/util.h": "../include/util.h" };
        expect(await why(files, "src/a.c", 4, "twice")).toBe("no declaration before the call");
    });
});

describe("C's conditional branches", () => {
    it("are read from the text, not the tree: `#ifdef __cplusplus` / `extern \"C\" {` holds nothing after its `#endif`", () => {
        const p = readPreproc('#ifndef A_H\n#define A_H\n#ifdef __cplusplus\nextern "C" {\n#endif\nint f(void);\n#endif\n');
        expect(p.branchesAt(p.directives[4].end + 1)).toEqual([]);
    });

    it("are alike when written alike with nothing between redefining their names or including a header", () => {
        const p = readPreproc("#ifdef A\nx\n#endif\n#ifdef A\ny\n#endif\n#include \"h.h\"\n#ifdef A\nz\n#endif\n");
        const at = (s: string) => p.branchesAt(readPreproc("").directives.length + "#ifdef A\nx\n#endif\n#ifdef A\ny\n#endif\n#include \"h.h\"\n#ifdef A\nz\n#endif\n".indexOf(s));
        expect(withinAlike(p, at("y"), at("x"), 9, 30)).toBe(true);
        expect(withinAlike(p, at("z"), at("x"), 9, 60)).toBe(false);
    });
});

describe("C's reads", () => {
    it("ask for each changed file's build files, then its includes' places, then the `.c` beside a header that declares a called name", async () => {
        const files: Record<string, string> = { "src/app.c": '#include "net.h"\n' + fn("int run(void)", "return net_send(1);"), "src/net.h": "int net_send(int fd);\n", "src/net.c": fn("int net_send(int fd)") };
        const asked = new Set<string>();
        const parsed = await parse({ "src/app.c": files["src/app.c"] });
        const ctx = (): ModuleContext => ({ known: [...asked].filter((p) => p in files).concat("src/app.c"), text: (p) => (asked.has(p) || p === "src/app.c" ? files[p] : undefined), exists: (p) => (asked.has(p) ? p in files : p === "src/app.c" ? true : undefined) });
        const rounds: string[][] = [];
        for (let i = 0; i < 6; i++) {
            const want = cWants(parsed, ctx(), (p) => p === "src/app.c").filter((p) => !asked.has(p));
            if (want.length === 0) break;
            rounds.push(want);
            want.forEach((p) => asked.add(p));
        }
        // Another build system's files are asked for in the file's folder and at the root.
        expect(rounds[0]).toEqual(["Makefile", "makefile", "GNUmakefile", "CMakeLists.txt", "meson.build", "Makefile.am", "src/Makefile", "src/makefile", "src/GNUmakefile", "src/CMakeLists.txt", "src/meson.build", "src/Makefile.am", "src/BUILD", "src/BUILD.bazel", "src/SConstruct", "src/SConscript", "src/Kbuild", "WORKSPACE", "MODULE.bazel", "SConstruct", "src/net.h"]);
        expect(rounds[1]).toEqual(["src/net.c"]);
        expect(rounds.length).toBe(2);
    });

    it("ask for the fragments a build file includes, once it is read", async () => {
        const files: Record<string, string> = { "src/app.c": fn("int run(void)"), "src/Makefile": "include config.mk\n", "src/config.mk": "CFLAGS += -DX\n", "CMakeLists.txt": "include(cmake/defs.cmake)\n", "cmake/defs.cmake": "add_compile_definitions(Y)\n" };
        const asked = new Set<string>(["src/app.c"]);
        const parsed = await parse({ "src/app.c": files["src/app.c"] });
        const rounds: string[][] = [];
        for (let i = 0; i < 6; i++) {
            const ctx: ModuleContext = { known: [...asked].filter((p) => p in files), text: (p) => (asked.has(p) ? files[p] : undefined), exists: (p) => (asked.has(p) ? p in files : undefined) };
            const want = cWants(parsed, ctx, (p) => p === "src/app.c").filter((p) => !asked.has(p));
            if (want.length === 0) break;
            rounds.push(want);
            want.forEach((p) => asked.add(p));
        }
        expect(rounds.slice(1)).toEqual([["cmake/defs.cmake", "src/config.mk"]]);
        expect(folderBuild("src", (p) => files[p], (p) => p in files).defines.map((d) => d.name)).toEqual(["Y", "X"]);
    });

    it("ask for the headers of a `.c` beside a header only where it defines a name a changed file calls, or calls a function one defines", async () => {
        const run = async (net: string) => {
            const files: Record<string, string> = { "src/app.c": '#include "net.h"\n' + fn("int run(void)", "return net_send(1);") + fn("int on_data(int x)", "return x;"), "src/net.h": `int net_send(int fd);\nint on_data(int x);\n`, "src/net.c": net, "src/extra.h": "int extra(void);\n" };
            const asked = new Set<string>(["src/app.c"]);
            const parsedOf = async () => parse(Object.fromEntries([...asked].filter((p) => p in files && p.endsWith(".c")).map((p) => [p, files[p]])));
            for (let i = 0; i < 6; i++) {
                const ctx: ModuleContext = { known: [...asked].filter((p) => p in files), text: (p) => (asked.has(p) ? files[p] : undefined), exists: (p) => (asked.has(p) ? p in files : undefined) };
                const want = cWants(await parsedOf(), ctx, (p) => p === "src/app.c").filter((p) => !asked.has(p));
                if (want.length === 0) break;
                want.forEach((p) => asked.add(p));
            }
            return [...asked];
        };
        // net.c defines neither what app.c calls nor calls app.c's: its headers aren't asked for.
        expect(await run(`#include "net.h"\n#include "extra.h"\n${fn("int net_close(int fd)")}`)).not.toContain("src/extra.h");
        // It defines `net_send`, which app.c calls: its unit tells that definition's linkage.
        expect(await run(`#include "net.h"\n#include "extra.h"\n${fn("int net_send(int fd)")}`)).toContain("src/extra.h");
        // It calls app.c's `on_data`: its calls are lines into the PR.
        expect(await run(`#include "net.h"\n#include "extra.h"\n${fn("int net_close(int fd)", "return on_data(fd);")}`)).toContain("src/extra.h");
    });
});

describe("C's macros that write definitions and locals", () => {
    const FOO_H = "#ifndef FOO_H\n#define FOO_H\nint foo_get(void);\n#endif\n";
    const FOO_C = `#include "foo.h"\n${fn("int foo_get(void)", "return 1;")}`;
    const at = (main: string, more: Record<string, string> = {}) => ({ "src/foo.h": FOO_H, "src/foo.c": FOO_C, "src/main.c": `${main}${pad}`, ...more });

    it("link nothing where a macro used at file scope may write a definition of the name: pasted, in its body, or around a declarator", async () => {
        expect(await why(at(`#define STUB(m, f) static int m##_##f(void) { return 42; }\nSTUB(foo, get)\n#include "foo.h"\n${fn("int run(void)", "return foo_get();")}`), "src/main.c", 6, "foo_get")).toBe("a declaration in doubt");
        expect(await why(at(`#define FOO_STUB static int foo_get(void) { return 42; }\nFOO_STUB\n#include "foo.h"\n${fn("int run(void)", "return foo_get();")}`), "src/main.c", 6, "foo_get")).toBe("a declaration in doubt");
        expect(await why(at(`#define FN(n) n\n${fn("static int FN(foo_get)(void)", "return 42;")}#include "foo.h"\n${fn("int run(void)", "return foo_get();")}`), "src/main.c", 9, "foo_get")).toBe("a declaration in doubt");
        // A body that starts with the name takes its type from before the use.
        expect(await why(at(`#define FOO_DEF foo_get(void) { return 42; }\nstatic int FOO_DEF\n#include "foo.h"\n${fn("int run(void)", "return foo_get();")}`), "src/main.c", 6, "foo_get")).toBe("a declaration in doubt");
    });

    it("read a name after an attribute, or a declarator in a macro's argument (`DEF(helper(void))`), as one a macro may write", async () => {
        expect(await why(at(`#define STUB static int __attribute__((unused)) foo_get(void) { return 42; }\nSTUB\n#include "foo.h"\n${fn("int run(void)", "return foo_get();")}`), "src/main.c", 6, "foo_get")).toBe("a declaration in doubt");
        expect(await why(at(`#define DEF(sig) static int sig { return 42; }\nDEF(foo_get(void))\n#include "foo.h"\n${fn("int run(void)", "return foo_get();")}`), "src/main.c", 6, "foo_get")).toBe("a declaration in doubt");
        expect(await why(at(`#define DEF(T, sig) static T sig { return 42; }\nDEF(int, foo_get(void))\n#include "foo.h"\n${fn("int run(void)", "return foo_get();")}`), "src/main.c", 6, "foo_get")).toBe("a declaration in doubt");
        // Another file's: no line to the one definition the tree shows.
        const alt = { "src/alt.c": `#include "foo.h"\n#define DEF(sig) int sig { return 2; }\nDEF(foo_get(void))\n${pad}` };
        expect(await why(at(`#include "foo.h"\n${fn("int run(void)", "return foo_get();")}`, alt), "src/main.c", 4, "foo_get")).toBe("a definition whose linkage the reads can't tell, or one they may not show");
    });

    it("read a macro's argument as a declarator where the macro's body places it as one (`DEF(helper())`, `DEF(helper(ctx_t))`, `DEF(helper(PARAMS))`), in another macro's body too", async () => {
        const def = "#define DEF(sig) int sig { return 2; }\n";
        const main = `#include "foo.h"\n${fn("int run(void)", "return foo_get();")}`;
        for (const text of [`${def}DEF(foo_get())`, `typedef int ctx_t;\n${def}DEF(foo_get(ctx_t))`, `#define PARAMS void\n${def}DEF(foo_get(PARAMS))`, `${def}#define STUB DEF(foo_get(void))\nSTUB`, "#define DEF2(sig) int __attribute__((used)) sig { return 2; }\nDEF2(foo_get())"])
            expect([text, await why(at(main, { "src/alt.c": `#include "foo.h"\n${text}\n${pad}` }), "src/main.c", 4, "foo_get")]).toEqual([text, "a definition whose linkage the reads can't tell, or one they may not show"]);
        // Through another macro, as the macros a unit sees define it: read anew for each set of macros.
        const [defMacro, wrap] = readPreproc("#define DEF(sig) int sig { return 2; }\n#define WRAP(x) DEF(x)\n").macros;
        expect([...declaratorParams(wrap, () => undefined)]).toEqual([]);
        expect([...declaratorParams(wrap, (n) => (n === "DEF" ? [defMacro] : undefined))]).toEqual([0]);
        // A body that reads the argument as a value writes no definition.
        expect(await calls(at(main, { "src/alt.c": `#include "foo.h"\n#define SIZE(e) enum { size_ = sizeof(e) };\nSIZE(foo_get())\n${pad}` }))).toEqual(["src/main.c:4 foo_get() (src/foo.c)"]);
    });

    it("link nothing to the one definition read where another file's macros may write one too (X-macros)", async () => {
        const ops = { "src/ops.h": "#define OPS X(add) X(sub)\nint op_add(int a, int b);\n", "src/ops_x.c": '#include "ops.h"\n#define X(n) int op_##n(int a, int b) { return a * b; }\nOPS\n', "src/ops.c": `#include "ops.h"\n${fn("int op_add(int a, int b)", "return a + b;")}`, "src/main.c": `#include "ops.h"\n${fn("int run(void)", "return op_add(1, 2);")}` };
        expect(await why(ops, "src/main.c", 4, "op_add")).toBe("a definition whose linkage the reads can't tell, or one they may not show");
    });

    it("link nothing after a macro in the function that may declare the name, nor inside one whose body may, pasted or through another macro", async () => {
        const body = (pre: string, call = "return helper();") => ({ "src/main.c": `${fn("static int helper(void)", "return 1;")}${fn("static int other(void)", "return 7;")}${pre}\n${fn("int run(void)", call)}${pad}` });
        expect(await why(body("#define HOOK(n) int (*n)(void) = other", "HOOK(helper);\n    return helper();"), "src/main.c", 13, "helper")).toBe("after a macro that may declare the name");
        expect(await why(body("#define LOCAL(a, b) int (*a##b)(void) = other", "LOCAL(hel, per);\n    return helper();"), "src/main.c", 13, "helper")).toBe("after a macro that may declare the name");
        expect(await why(body("#define DECL int (*helper)(void) = other;\n#define WRAP(x) do { DECL x; } while (0)", "int r = 0;\n    WRAP(r = helper());\n    return r;"), "src/main.c", 14, "helper")).toBe("in a macro's arguments");
        // A macro that only calls what it is given, or names a function it calls (`FREE(p)` for `#define FREE helper`), declares nothing.
        expect(await calls(body("#define PAIR(a, b) ((a) + (b))", "return PAIR(helper(), other()) + helper();"))).toEqual(["src/main.c:12 helper()", "src/main.c:12 other()", "src/main.c:12 helper()"]);
        expect(await calls(body("#define FREE other", "FREE();\n    return other();"))).toEqual(["src/main.c:13 other()"]);
    });

    it("link nothing after an `#include` in the function", async () => {
        const files = { "src/main.c": `${fn("static int helper(void)", "return 1;")}${fn("int run(void)", "int r;\n#include \"locals.h\"\n    r = helper();\n    return r;")}${pad}`, "src/locals.h": "int (*helper)(void) = 0;\n" };
        expect(await why(files, "src/main.c", 9, "helper")).toBe("an include in the function before the call");
    });

    it("link nothing inside, or after a statement of, a name no file read declares where a header of the unit is unread: a macro of that header", async () => {
        const files = (header: string, call: string) => ({ "src/main.c": `#include <wrap.h>\n${header}${fn("static int helper(void)", "return 1;")}${fn("int run(void)", call)}${pad}` });
        expect(await why(files("", "int r = 0;\n    WRAP(r = helper());\n    return r;"), "src/main.c", 9, "helper")).toBe("in the arguments of a name the reads don't declare");
        expect(await why(files("", "LOG(\"%d\", helper());\n    return 0;"), "src/main.c", 8, "helper")).toBe("in the arguments of a name the reads don't declare");
        expect(await why(files("", "USE_OTHER;\n    return helper();"), "src/main.c", 9, "helper")).toBe("after a name the reads don't declare, which may declare it");
        // A function the reads declare is called: its arguments are passed on.
        expect(await calls(files("int wrap(int);\n", "return wrap(helper());"))).toEqual(["src/main.c:9 helper()"]);
    });
});

describe("C's conditions that read alike", () => {
    const files = (between: string, cond = "ENABLED") => ({ "src/main.c": `#define BASE 0\n#define ENABLED BASE\n#if ${cond}\n${fn("static int helper(void)", "return 42;")}#endif\n${between}#if ${cond}\n${fn("int run(void)", "return helper();")}#endif\n` });

    it("differ where a macro they read redefines a name its body reads, a pragma restores one, or they read the line", async () => {
        expect(await calls(files(""))).toEqual(["src/main.c:12 helper()"]);
        expect(await calls(files("#undef BASE\n#define BASE 1\n"))).toEqual([]);
        expect(await calls(files('#pragma pop_macro("ENABLED")\n'))).toEqual([]);
        expect(await calls(files('_Pragma("pop_macro(\\"ENABLED\\")")\n'))).toEqual([]);
        expect(await calls(files("", "__LINE__ > 4"))).toEqual([]);
    });

    it("are never compiled where the condition is 0 whatever is defined: `#if (0)`, `#if 0L`, `#if 0 && X`, and `#else` after `#if 1 || X`", async () => {
        for (const cond of ["(0)", "0L", "0 && defined(X)", "!1"]) expect([cond, await calls({ "src/a.c": `${fn("static int x(void)")}#if ${cond}\n${fn("int a(void)", "return x();")}#endif\n` })]).toEqual([cond, []]);
        expect(await calls({ "src/a.c": `${fn("static int x(void)")}#if 1 || X\n#else\n${fn("int a(void)", "return x();")}#endif\n` })).toEqual([]);
        expect([constantOf("(1 << 4) > 8"), constantOf("FOO + 1"), constantOf("0 && FOO"), constantOf("1u"), constantOf("defined(A) ? 2 : 2")]).toEqual([1n, null, 0n, null, 2n]);
    });
});

describe("C's include guards", () => {
    const util = (guard: string, body: string) => `#ifndef ${guard}\n#define ${guard}\n${body}#endif\n`;

    it("take no definition from a header whose guard a header the reads can't resolve may define, or a system header may as its own", async () => {
        const util = (guard: string, before: string) => ({ "src/util.h": `#ifndef ${guard}\n#define ${guard}\n${fn("static inline int helper(void)", "return 2;")}#endif\n`, "src/main.c": `${before}#include "util.h"\n${fn("int run(void)", "return helper();")}` });
        const skip = "a header whose include guard what the reads can't see may define";
        expect(await why(util("UTIL_H", "#include <cfg.h>\n"), "src/main.c", 5, "helper")).toBe(skip);
        expect(await why(util("_SYS_QUEUE_H_", "#include <sys/queue.h>\n"), "src/main.c", 5, "helper")).toBe(skip);
        expect(await calls(util("_MY_UTIL_H_", "#include <sys/queue.h>\n"))).toEqual(["src/main.c:5 helper() (src/util.h)"]);
    });

    it("skip a header whose guard a file before it defines: another header's, or the includer's", async () => {
        const two = { "src/a/util.h": util("UTIL_H", "int helper(void);\n"), "src/b/util.h": util("UTIL_H", fn("static inline int helper(void)", "return 2;")), "src/main.c": `#include "a/util.h"\n#include "b/util.h"\n${fn("int run(void)", "return helper();")}` };
        expect(await why(two, "src/main.c", 5, "helper")).toBe("an unresolved include before the call");
        const before = { "src/x.h": util("X_H", fn("static inline int helper(void)", "return 2;")), "src/main.c": `#define X_H\n#include "x.h"\n${fn("int run(void)", "return helper();")}` };
        expect(await why(before, "src/main.c", 5, "helper")).toBe("no declaration before the call");
        // Included first, the header is read.
        expect(await calls({ ...before, "src/main.c": `#include "x.h"\n${fn("int run(void)", "return helper();")}` })).toEqual(["src/main.c:4 helper() (src/x.h)"]);
    });
});

describe("C's build files", () => {
    const FOO = { "src/foo.h": "#ifndef FOO_H\n#define FOO_H\nint foo_get(void);\n#endif\n", "src/foo.c": `#include "foo.h"\n${fn("int foo_get(void)", "return 1;")}`, "tests/test_foo.c": `#include "../src/foo.h"\n${fn("int test(void)", "return foo_get();")}` };

    it("define the macros of their `-D` flags and compile definitions in each unit they build", async () => {
        expect(await calls(FOO)).toEqual(["tests/test_foo.c:4 foo_get() (src/foo.c)"]);
        expect(await why({ ...FOO, "tests/Makefile": "CFLAGS += -I../src -Dfoo_get=mock_foo_get\n" }, "tests/test_foo.c", 4, "foo_get")).toBe("a macro's name");
        expect(await why({ ...FOO, "CMakeLists.txt": "add_executable(t tests/test_foo.c)\ntarget_compile_definitions(t PRIVATE foo_get=mock_foo_get)\n" }, "tests/test_foo.c", 4, "foo_get")).toBe("a macro's name");
    });

    it("read `makefile` and `GNUmakefile`, and the fragments a Makefile or a CMake file includes", async () => {
        const mock = "CFLAGS += -I../src -Dfoo_get=mock_foo_get\n";
        for (const [name, build] of [
            ["makefile", { "tests/makefile": mock }],
            ["GNUmakefile", { "tests/GNUmakefile": mock }],
            ["a Make fragment", { "tests/Makefile": "include mocks.mk\nCFLAGS += -I../src $(MOCKS)\n", "tests/mocks.mk": "MOCKS = -Dfoo_get=mock_foo_get\n" }],
            ["a CMake file", { "CMakeLists.txt": "include(cmake/defs.cmake)\nadd_executable(t tests/test_foo.c)\n", "cmake/defs.cmake": "add_compile_definitions(foo_get=mock_foo_get)\n" }],
            ["a CMake module", { "CMakeLists.txt": "list(APPEND CMAKE_MODULE_PATH ${CMAKE_CURRENT_SOURCE_DIR}/cmake)\ninclude(Defs)\n", "cmake/Defs.cmake": "add_definitions(-Dfoo_get=mock_foo_get)\n" }],
        ] as const)
            expect([name, await why({ ...FOO, ...build }, "tests/test_foo.c", 4, "foo_get")]).toEqual([name, "a macro's name"]);
    });

    it("read a header the build has the compiler read first (`-include`, `-imacros`, a precompiled header) as one not read, before every line", async () => {
        const builds: Record<string, string>[] = [{ "tests/Makefile": "CFLAGS += -I../src -include mock.h\n" }, { "tests/Makefile": "CFLAGS += -imacros mock.h\n" }, { "tests/CMakeLists.txt": "add_executable(t test_foo.c)\ntarget_precompile_headers(t PRIVATE mock.h)\n" }];
        for (const build of builds)
            expect(await why({ ...FOO, ...build, "tests/mock.h": "#define foo_get mock_foo_get\n" }, "tests/test_foo.c", 4, "foo_get")).toBe("an unresolved include before the call");
    });

    it("place a definition written in a variable, a generator expression or MSVC's `/D`; one whose name it can't place leaves the unit's macros open", async () => {
        const cmake = (defs: string) => ({ ...FOO, "tests/CMakeLists.txt": `add_executable(t test_foo.c)\n${defs}\n` });
        for (const defs of ["target_compile_definitions(t PRIVATE $<$<CONFIG:Debug>:foo_get=mock_foo_get>)", "target_compile_definitions(t PRIVATE $<IF:$<BOOL:${MOCK}>,foo_get=mock_foo_get,NOMOCK>)", "list(APPEND DEFS foo_get=mock_foo_get)\ntarget_compile_definitions(t PRIVATE ${DEFS})", "add_compile_options(/Dfoo_get=mock_foo_get)"])
            expect([defs, await why(cmake(defs), "tests/test_foo.c", 4, "foo_get")]).toEqual([defs, "a macro's name"]);
        const open = "its build may define any macro";
        expect(await why(cmake("target_compile_definitions(t PRIVATE ${MOCK_DEFS})"), "tests/test_foo.c", 4, "foo_get")).toBe(open);
        expect(await why(cmake("target_compile_definitions(t PRIVATE $<TARGET_PROPERTY:mocks,COMPILE_DEFINITIONS>)"), "tests/test_foo.c", 4, "foo_get")).toBe(open);
        expect(await why({ ...FOO, "tests/meson.build": "name = 'foo_get'\nexecutable('t', 'test_foo.c', c_args: ['-D' + name + '=mock_foo_get'])\n" }, "tests/test_foo.c", 4, "foo_get")).toBe(open);
        expect(await why({ ...FOO, "tests/Makefile": "CFLAGS += -D$(NAME)=mock_$(NAME)\n" }, "tests/test_foo.c", 4, "foo_get")).toBe(open);
        // A fragment the repository doesn't hold is configure's, as out of reach as the command line; one whose name can't be placed is open.
        expect(await calls({ ...FOO, "tests/Makefile": "include auto/config.mk\n" })).toEqual(["tests/test_foo.c:4 foo_get() (src/foo.c)"]);
        expect(await why({ ...FOO, "tests/Makefile": "include $(CONFIG_DIR)/config.mk\n" }, "tests/test_foo.c", 4, "foo_get")).toBe(open);
    });

    it("join an option written apart from its value (`-include mock.h`, `-D NAME`, `-x c++`), CMake's `SHELL:` dropped, Meson's list items too", async () => {
        const mock = { "tests/mock.h": "#define foo_get mock_foo_get\n" };
        const cmake = (options: string) => ({ "tests/CMakeLists.txt": `add_executable(t test_foo.c)\ntarget_compile_options(t PRIVATE ${options})\n` });
        const meson = (args: string) => ({ "tests/meson.build": `executable('t', 'test_foo.c', c_args: [${args}])\n` });
        for (const build of [cmake("-include mock.h"), cmake('"SHELL:-include mock.h"'), meson("'-include', 'mock.h'"), { "tests/Makefile": "CFLAGS += -include  mock.h\n" }])
            expect([build, await why({ ...FOO, ...mock, ...build }, "tests/test_foo.c", 4, "foo_get")]).toEqual([build, "an unresolved include before the call"]);
        for (const build of [cmake("-D foo_get=mock_foo_get"), cmake('"SHELL:-D foo_get=mock_foo_get"'), meson("'-D', 'foo_get=mock_foo_get'"), { "tests/Makefile": "CFLAGS += -D foo_get=mock_foo_get\n" }])
            expect([build, await why({ ...FOO, ...build }, "tests/test_foo.c", 4, "foo_get")]).toEqual([build, "a macro's name"]);
        for (const build of [cmake("-x c++"), cmake('"SHELL:-x c++"'), meson("'-x', 'c++'"), { "tests/Makefile": "CFLAGS += -xc++\n" }])
            expect([build, await why({ ...FOO, ...build }, "tests/test_foo.c", 4, "foo_get")]).toEqual([build, "its build compiles it as C++"]);
    });

    it("leave the macros open where a Make function makes a definition, or an optional fragment's name can't be placed", async () => {
        const open = "its build may define any macro";
        for (const flags of ["$(addprefix -D,$(MOCKS))", "$(patsubst %,-D%,$(MOCKS))", "$(foreach m,$(MOCKS),$(addprefix -D,$(m)))"])
            expect([flags, await why({ ...FOO, "tests/Makefile": `MOCKS = foo_get=mock_foo_get\nCFLAGS += ${flags}\n` }, "tests/test_foo.c", 4, "foo_get")]).toEqual([flags, open]);
        expect(await why({ ...FOO, "tests/Makefile": "-include $(BUILD_DIR)/mocks.mk\n" }, "tests/test_foo.c", 4, "foo_get")).toBe(open);
        // A function handed flags another line writes makes none; an optional fragment the repository doesn't hold is configure's.
        expect(await calls({ ...FOO, "tests/Makefile": "CFLAGS += -DNDEBUG\nifneq ($(strip $(CFLAGS)),)\nALL = $(filter -D%,$(CFLAGS))\nendif\n" })).toEqual(["tests/test_foo.c:4 foo_get() (src/foo.c)"]);
        expect(await calls({ ...FOO, "tests/Makefile": "-include config.mk\n" })).toEqual(["tests/test_foo.c:4 foo_get() (src/foo.c)"]);
    });

    it("look for a CMake module in the module folders the CMake files above set", async () => {
        const files = { ...FOO, "CMakeLists.txt": "project(p C)\nlist(APPEND CMAKE_MODULE_PATH ${CMAKE_CURRENT_SOURCE_DIR}/cmake)\nadd_subdirectory(tests)\n", "cmake/MockDefs.cmake": "add_compile_definitions(foo_get=mock_foo_get)\n", "tests/CMakeLists.txt": "include(MockDefs)\nadd_executable(t test_foo.c)\n" };
        expect(await why(files, "tests/test_foo.c", 4, "foo_get")).toBe("a macro's name");
    });

    it("apply what a linked target or a Meson dependency gives those that link it, in turn, found in the files read or in the folders the build adds", async () => {
        const root = "project(p C)\nadd_subdirectory(src)\nadd_subdirectory(mocks)\nadd_subdirectory(tests)\n";
        const linked = (mocks: string, link = "mocks") => ({ ...FOO, "CMakeLists.txt": root, "mocks/CMakeLists.txt": mocks, "tests/CMakeLists.txt": `add_executable(t test_foo.c)\ntarget_link_libraries(t PRIVATE ${link})\n` });
        for (const mocks of ["add_library(mocks INTERFACE)\ntarget_compile_definitions(mocks INTERFACE foo_get=mock_foo_get)\n", "add_library(mocks mocks.c)\ntarget_compile_definitions(mocks PUBLIC foo_get=mock_foo_get)\n", "add_library(defs INTERFACE)\ntarget_compile_options(defs INTERFACE -Dfoo_get=mock_foo_get)\nadd_library(mocks INTERFACE)\ntarget_link_libraries(mocks INTERFACE defs)\n"])
            expect([mocks, await why(linked(mocks), "tests/test_foo.c", 4, "foo_get")]).toEqual([mocks, "a macro's name"]);
        // A private definition is the library's own, a public one of another name changes nothing here (curl's `CURL_STATICLIB UNITTESTS`), and a name no folder the build adds makes is a library of the system's.
        expect(await calls(linked("add_library(mocks mocks.c)\ntarget_compile_definitions(mocks PRIVATE foo_get=mock_foo_get)\n"))).toEqual(["tests/test_foo.c:4 foo_get() (src/foo.c)"]);
        expect(await calls(linked("add_library(mocks mocks.c)\ntarget_compile_definitions(mocks PUBLIC CURL_STATICLIB UNITTESTS)\n"))).toEqual(["tests/test_foo.c:4 foo_get() (src/foo.c)"]);
        expect(await calls(linked("", "z"))).toEqual(["tests/test_foo.c:4 foo_get() (src/foo.c)"]);
        // A list that names itself (`set(LIBS ${LIBS} m)`) is walked once.
        const libs = Array.from({ length: 40 }, (_, i) => `set(LIBS \${LIBS} lib${i})\n`).join("");
        expect(await calls({ ...linked(""), "tests/CMakeLists.txt": `${libs}add_executable(t test_foo.c)\ntarget_link_libraries(t PRIVATE \${LIBS})\n` })).toEqual(["tests/test_foo.c:4 foo_get() (src/foo.c)"]);
        // One the build may make in a folder it can't place leaves the macros open.
        expect(await why({ ...linked(""), "CMakeLists.txt": `${root}add_subdirectory(\${MOCK_DIR} more)\n` }, "tests/test_foo.c", 4, "foo_get")).toBe("its build may define any macro");
        const meson = (mocks: string, deps = "mock_dep") => ({ ...FOO, "meson.build": "project('p', 'c')\nsubdir('mocks')\nsubdir('tests')\n", "mocks/meson.build": mocks, "tests/meson.build": `executable('t', 'test_foo.c', dependencies: [${deps}])\n` });
        expect(await why(meson("mock_dep = declare_dependency(compile_args: ['-Dfoo_get=mock_foo_get'])\n"), "tests/test_foo.c", 4, "foo_get")).toBe("a macro's name");
        expect(await calls(meson("mock_dep = dependency('mocks')\n"))).toEqual(["tests/test_foo.c:4 foo_get() (src/foo.c)"]);
        expect(await why(meson("", "other_dep"), "tests/test_foo.c", 4, "foo_get")).toBe("its build may define any macro");
    });

    it("leave the macros open in a folder another build system builds: Bazel's or SCons' files there or at the root, Kbuild's there", async () => {
        for (const file of ["tests/BUILD", "tests/BUILD.bazel", "tests/SConscript", "tests/SConstruct", "tests/Kbuild", "WORKSPACE", "MODULE.bazel", "SConstruct"])
            expect([file, await why({ ...FOO, [file]: "\n" }, "tests/test_foo.c", 4, "foo_get")]).toEqual([file, "its build may define any macro"]);
    });

    it("draw nothing from or into a C file the build compiles as C++", async () => {
        const cxx = (files: string) => ({ ...FOO, "CMakeLists.txt": `add_executable(t tests/test_foo.c src/foo.c)\nset_source_files_properties(${files} PROPERTIES LANGUAGE CXX)\n` });
        expect(await why(cxx("tests/test_foo.c"), "tests/test_foo.c", 4, "foo_get")).toBe("its build compiles it as C++");
        expect(await why(cxx("src/foo.c"), "tests/test_foo.c", 4, "foo_get")).toBe("the definition's build compiles it as C++, or may define any macro");
        expect(await why({ ...FOO, "Makefile": "CC = g++\n" }, "tests/test_foo.c", 4, "foo_get")).toBe("its build compiles it as C++");
    });

    it("must be read before a unit's calls link", async () => {
        const parsed = await parse(FOO);
        const decide = explainCalls(parsed, { known: parsed.map((f) => f.path), text: (p) => FOO[p as keyof typeof FOO], exists: (p) => (p in FOO ? true : /Makefile|CMake|meson/.test(p) ? undefined : false) });
        const f = parsed.find((x) => x.path === "tests/test_foo.c")!;
        expect(decide(f, f.sites.find((s) => s.name === "foo_get")!)).toBe("its build files weren't read");
        // One there but not read (past the read's length limit) is no absent one.
        const big = { ...FOO, "tests/Makefile": "CFLAGS += -Dfoo_get=mock_foo_get\n" };
        const unread = explainCalls(await parse(big), { known: [], text: (p) => (p === "tests/Makefile" ? undefined : big[p as keyof typeof big]), exists: (p) => p in big });
        const g = parsed.find((x) => x.path === "tests/test_foo.c")!;
        expect(unread(g, g.sites.find((s) => s.name === "foo_get")!)).toBe("its build files weren't read");
    });

    it("leave the macros open past six included files, CMake's or Make's", async () => {
        /** A build file that includes a chain of `n` files, the last of which renames the call. */
        const cmake = (n: number) => ({
            ...FOO,
            "tests/CMakeLists.txt": "include(${CMAKE_CURRENT_LIST_DIR}/c0.cmake)\nadd_executable(t test_foo.c)\n",
            ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`tests/c${i}.cmake`, i < n - 1 ? `include(\${CMAKE_CURRENT_LIST_DIR}/c${i + 1}.cmake)\n` : "add_compile_definitions(foo_get=mock_foo_get)\n"])),
        });
        const make = (n: number) => ({ ...FOO, "tests/Makefile": "include m0.mk\n", ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`tests/m${i}.mk`, i < n - 1 ? `include m${i + 1}.mk\n` : "CFLAGS += -Dfoo_get=mock_foo_get\n"])) });
        expect(await why(cmake(6), "tests/test_foo.c", 4, "foo_get")).toBe("a macro's name");
        expect(await why(cmake(8), "tests/test_foo.c", 4, "foo_get")).toBe("its build may define any macro");
        expect(await why(make(6), "tests/test_foo.c", 4, "foo_get")).toBe("a macro's name");
        expect(await why(make(8), "tests/test_foo.c", 4, "foo_get")).toBe("its build may define any macro");
    });

    it("look for a `::` link name among the folders the build adds: a package's only where none makes it", async () => {
        const root = "project(p C)\nadd_subdirectory(src)\nadd_subdirectory(mocks)\nadd_subdirectory(tests)\n";
        const linked = (mocks: string, link: string, more = "") => ({ ...FOO, "CMakeLists.txt": `${more}${root}`, "mocks/CMakeLists.txt": mocks, "tests/CMakeLists.txt": `add_executable(t test_foo.c)\ntarget_link_libraries(t PRIVATE ${link})\n` });
        const alias = "add_library(mocks INTERFACE)\nadd_library(mocks::mocks ALIAS mocks)\ntarget_compile_definitions(mocks INTERFACE foo_get=mock_foo_get)\n";
        expect(await why(linked(alias, "mocks::mocks"), "tests/test_foo.c", 4, "foo_get")).toBe("a macro's name");
        expect(await calls(linked("", "OpenSSL::SSL", "find_package(OpenSSL)\n"))).toEqual(["tests/test_foo.c:4 foo_get() (src/foo.c)"]);
        expect(await calls(linked("", "Other::lib"))).toEqual(["tests/test_foo.c:4 foo_get() (src/foo.c)"]);
        expect(await why({ ...linked("", "Other::lib"), "CMakeLists.txt": `${root}add_subdirectory(\${MORE_DIR} more)\n` }, "tests/test_foo.c", 4, "foo_get")).toBe("its build may define any macro");
    });

    it("give a target's INTERFACE_ properties to those that link it, not to its own folder", async () => {
        const root = "project(p C)\nadd_subdirectory(src)\nadd_subdirectory(mocks)\nadd_subdirectory(tests)\n";
        const linked = (mocks: string) => ({ ...FOO, "CMakeLists.txt": root, "mocks/CMakeLists.txt": `add_library(mocks INTERFACE)\n${mocks}`, "tests/CMakeLists.txt": "add_executable(t test_foo.c)\ntarget_link_libraries(t PRIVATE mocks)\n" });
        for (const mocks of ["set_property(TARGET mocks PROPERTY INTERFACE_COMPILE_DEFINITIONS foo_get=mock_foo_get)\n", "set_target_properties(mocks PROPERTIES INTERFACE_COMPILE_OPTIONS -Dfoo_get=mock_foo_get)\n", "set_property(TARGET mocks APPEND PROPERTY INTERFACE_COMPILE_DEFINITIONS foo_get=mock_foo_get)\n"])
            expect([mocks, await why(linked(mocks), "tests/test_foo.c", 4, "foo_get")]).toEqual([mocks, "a macro's name"]);
        // The folder that sets it keeps its own calls.
        const own = { ...linked("set_property(TARGET mocks PROPERTY INTERFACE_COMPILE_DEFINITIONS foo_get=mock_foo_get)\n"), "mocks/use.c": `#include "../src/foo.h"\n${fn("int use(void)", "return foo_get();")}` };
        expect(await why(own, "mocks/use.c", 4, "foo_get")).toBe("src/foo.c:2");
    });

    it("leave the macros open where GNU make 4.4's `$(let …)` makes a definition", async () => {
        expect(await why({ ...FOO, "tests/Makefile": "CFLAGS += $(let p,-D,$(p)foo_get=mock_foo_get)\n" }, "tests/test_foo.c", 4, "foo_get")).toBe("its build may define any macro");
    });

    it("leave a unit's macros open, and the board whole, where reading its build files throws", async () => {
        const files = { ...FOO, "tests/Makefile": "CFLAGS += -DNDEBUG\n" };
        const parsed = await parse(files);
        const decide = explainCalls(parsed, {
            known: parsed.map((f) => f.path),
            text: (p) => {
                if (p === "tests/Makefile") throw new Error("a read that fails");
                return files[p as keyof typeof files];
            },
            exists: (p) => p in files,
        });
        const f = parsed.find((x) => x.path === "tests/test_foo.c")!;
        expect(decide(f, f.sites.find((s) => s.name === "foo_get")!)).toBe("its build may define any macro");
    });
});

describe("C's build files made to exhaust the reader", () => {
    const FOO = { "src/foo.h": "#ifndef FOO_H\n#define FOO_H\nint foo_get(void);\n#endif\n", "src/foo.c": `#include "foo.h"\n${fn("int foo_get(void)", "return 1;")}`, "tests/test_foo.c": `#include "../src/foo.h"\n${fn("int test(void)", "return foo_get();")}` };
    const range = (n: number) => Array.from({ length: n }, (_, i) => i);
    /** Why the call draws no line, and how long the board took to say so. */
    const timed = async (files: Record<string, string>) => {
        const t0 = performance.now();
        const out = await why({ ...FOO, ...files }, "tests/test_foo.c", 4, "foo_get");
        return { why: out, fast: performance.now() - t0 < 2000 };
    };
    const open = { why: "its build may define any macro", fast: true };
    const line = { why: "src/foo.c:2", fast: true };

    it("stop a CMake argument past 512 values: the unit's macros are open", async () => {
        const list = (n: number) => range(n).map((i) => `v${i}`).join(" ");
        expect(await timed({ "tests/CMakeLists.txt": `set(L ${list(20)})\nadd_executable(t test_foo.c)\ntarget_compile_definitions(t PRIVATE ${"${L}".repeat(8)})\n` })).toEqual(open);
        expect(await timed({ "tests/CMakeLists.txt": `set(L ${list(8)})\nadd_executable(t test_foo.c)\ntarget_compile_definitions(t PRIVATE ${"${L}".repeat(6)})\n` })).toEqual(open);
        expect(await timed({ "tests/CMakeLists.txt": `add_executable(t test_foo.c)\ntarget_compile_definitions(t PRIVATE ${"$<IF:$<CONFIG:Debug>,A,B>".repeat(20)})\n` })).toEqual(open);
        expect(await timed({ "tests/CMakeLists.txt": `set(L ${list(20)})\ninclude_directories(${"${L}/".repeat(8)}x)\nadd_executable(t test_foo.c)\n` })).toEqual(open);
        // A list that names itself, or a pair that name each other, add nothing to their values.
        expect(await timed({ "tests/CMakeLists.txt": "set(A ${A} x)\nset(A ${A} y)\nset(B ${C} b)\nset(C ${B} c)\nadd_executable(t test_foo.c)\ntarget_compile_definitions(t PRIVATE ${A} ${B})\n" })).toEqual(line);
    });

    it("stop a Make expansion past 64 KB: the unit's macros are open", async () => {
        const chain = (refs: number, levels: number) => `X0 = -DA=1\n${range(levels).map((i) => `X${i + 1} = ${range(refs).map(() => `$(X${i})`).join(" ")}`).join("\n")}\nCFLAGS += $(X${levels})\n`;
        expect(await timed({ "tests/Makefile": chain(10, 5) })).toEqual(open);
        expect(await timed({ "tests/Makefile": chain(4, 8) })).toEqual(open);
        expect(await timed({ "tests/Makefile": `${chain(10, 4)}${range(50).map((i) => `t${i}: ; @echo $(X4)`).join("\n")}\n` })).toEqual(open);
        expect(await timed({ "tests/Makefile": chain(10, 3) })).toEqual(line);
    });

    it("read a definition written twenty thousand times once", async () => {
        expect(await timed({ "tests/Makefile": `${range(20000).map(() => "CFLAGS += -DA=1").join("\n")}\n` })).toEqual(line);
    });
});

describe("C's declarations through macros", () => {
    const H = (decl: string) => ({ "src/foo.h": `#ifndef FOO_H\n#define FOO_H\n${decl}\n${decls}#endif\n`, "src/foo.c": `#include "foo.h"\n${fn("int helper(void)", "return 1;")}`, "src/main.c": `#include "foo.h"\n${fn("int run(void)", "return helper();")}` });

    it("doubt a macro after a function's declarator that may make it weak or name its symbol, or one the reads don't define", async () => {
        expect(await calls(H("int helper(void);"))).toEqual(["src/main.c:4 helper() (src/foo.c)"]);
        expect(await calls(H("#define SYM(x) __asm__(#x)\nint helper(void) SYM(helper_v2);"))).toEqual([]);
        expect(await calls(H("#define WEAK_FN __attribute__((weak))\nint helper(void) WEAK_FN;"))).toEqual([]);
        expect(await calls(H("int helper(void) UNKNOWN_ATTR;"))).toEqual([]);
        expect(await calls(H("#define NOTHROW __attribute__((nothrow))\nint helper(void) NOTHROW;"))).toEqual(["src/main.c:4 helper() (src/foo.c)"]);
    });

    it("read a word only a system header may define, in a macro after a declarator or among the specifiers, as unknown linkage (`__weak_symbol`)", async () => {
        expect(await calls(H("#include <sys/weakdefs.h>\n#define WEAK_FN __weak_symbol\nint helper(void) WEAK_FN;"))).toEqual([]);
        const files = { ...H("int helper(void);"), "src/foo.c": `#include <sys/weakdefs.h>\n#include "foo.h"\n#define WEAK_DEFAULT __weak_symbol\nWEAK_DEFAULT ${fn("int helper(void)", "return 1;")}` };
        expect(await why(files, "src/main.c", 4, "helper")).toBe("a definition whose linkage the reads can't tell, or one they may not show");
    });

    it("read a macro taken for the type as specifiers: one that writes `static` makes the definition no external one", async () => {
        const files = { ...H("int helper(void);"), "src/foo.c": `#define LOCAL_INT static int\nLOCAL_INT ${fn("helper(void)", "return 1;")}#include "foo.h"\n${pad}` };
        expect(await why(files, "src/main.c", 4, "helper")).toBe("no definition read");
    });
});

describe("C's files the parser rejects, and variants", () => {
    const H = "#ifndef FOO_H\n#define FOO_H\nint helper(void);\n#endif\n";
    const MAIN = `#include "foo.h"\n${fn("int run(void)", "return helper();")}`;

    it("count a definition the text of a rejected file may hold: no line to the one parsed", async () => {
        const rejected = `#include "foo.h"\n#define BEGIN {\n#define END }\nint helper(void) BEGIN return 2; END\n${"static int x(void) BEGIN return 2; END\n".repeat(3)}`;
        expect(await why({ "src/foo.h": H, "src/foo.c": `#include "foo.h"\n${fn("int helper(void)", "return 1;")}`, "src/alt.c": rejected, "src/main.c": MAIN }, "src/main.c", 4, "helper")).toBe("a definition whose linkage the reads can't tell, or one they may not show");
        // One that only calls it defines nothing.
        const caller = `#include "foo.h"\n#define BEGIN {\n#define END }\nint other(void) BEGIN return helper(); END\n${"static int x(void) BEGIN return 2; END\n".repeat(3)}`;
        expect(await calls({ "src/foo.h": H, "src/foo.c": `#include "foo.h"\n${fn("int helper(void)", "return 1;")}`, "src/alt.c": caller, "src/main.c": MAIN })).toEqual(["src/main.c:4 helper() (src/foo.c)"]);
    });

    it("read every branch of a rejected file's conditionals, `#elif`'s too", async () => {
        const rejected = `#include "foo.h"\n#define BEGIN {\n#define END }\n#if defined(A)\nint other_a(void) BEGIN return 1; END\n#elif defined(B)\nint helper(void) BEGIN return 2; END\n#else\nint other_c(void) BEGIN return 3; END\n#endif\n${"static int x(void) BEGIN return 2; END\n".repeat(3)}`;
        expect(await why({ "src/foo.h": H, "src/foo.c": `#include "foo.h"\n${fn("int helper(void)", "return 1;")}`, "src/alt.c": rejected, "src/main.c": MAIN }, "src/main.c", 4, "helper")).toBe("a definition whose linkage the reads can't tell, or one they may not show");
    });

    it("link nothing to a file a build file read compiles in some builds only: in a conditional's branch, or beside a platform's or a variant's file of its stem", async () => {
        const io = { "src/foo.h": H, "src/foo.c": `#include "foo.h"\n${fn("int helper(void)")}`, "src/main.c": MAIN };
        const some = "a build file compiles the definition's file in some builds only";
        expect(await why({ ...io, "CMakeLists.txt": "if(WIN32)\n  set(IO src/foo_w32.c)\nelse()\n  set(IO src/foo.c)\nendif()\nadd_executable(p src/main.c ${IO})\n" }, "src/main.c", 4, "helper")).toBe(some);
        expect(await why({ ...io, "src/Makefile": "OBJS = main.o foo.o\nWIN_OBJS = foo_win32.o\n" }, "src/main.c", 4, "helper")).toBe(some);
        expect(await calls({ ...io, "CMakeLists.txt": "add_executable(p src/main.c src/foo.c)\n" })).toEqual(["src/main.c:4 helper() (src/foo.c)"]);
    });

    it("link nothing into a file a computed name, a Kbuild list, a glob a filter narrows or a folder a variable picks may name; a computed name the build writes is no variant", async () => {
        const tls = { "src/tls.h": "#ifndef TLS_H\n#define TLS_H\nint tls_init(void);\n#endif\n", "src/tls_openssl.c": `#include "tls.h"\n${fn("int tls_init(void)")}`, "src/main.c": `#include "tls.h"\n${fn("int run(void)", "return tls_init();")}` };
        const some = "a build file compiles the definition's file in some builds only";
        const builds: Record<string, string>[] = [
            { "src/Makefile": "TLS ?= openssl\nSRCS = main.c tls_$(TLS).c\n" },
            { "src/CMakeLists.txt": "add_executable(app main.c tls_${TLS}.c)\n" },
            { "src/Makefile": "obj-y += main.o\nobj-$(CONFIG_OPENSSL) += tls_openssl.o\n" },
            { "src/CMakeLists.txt": 'file(GLOB SRCS *.c)\nlist(FILTER SRCS EXCLUDE REGEX "gnutls")\nadd_executable(app ${SRCS})\n' },
            { "src/Makefile.am": "bin_PROGRAMS = app\napp_SOURCES = main.c\nEXTRA_app_SOURCES = tls_openssl.c tls_gnutls.c\n" },
            { "src/CMakeLists.txt": 'set(TLS_SOURCE tls_gnutls.c CACHE STRING "TLS backend")\nadd_executable(app main.c ${TLS_SOURCE})\n' },
            { "src/Makefile": "TLS_SRC ?= tls_openssl.c\nSRCS = main.c $(TLS_SRC)\n" },
        ];
        for (const build of builds) expect([build, await why({ ...tls, ...build }, "src/main.c", 4, "tls_init")]).toEqual([build, some]);
        const backend = { "src/tls.h": tls["src/tls.h"], "src/main.c": tls["src/main.c"], "src/backends/openssl/tls.c": `#include "../../tls.h"\n${fn("int tls_init(void)")}`, "src/CMakeLists.txt": "add_subdirectory(backends/${TLS})\nadd_executable(app main.c)\n" };
        expect(await why(backend, "src/main.c", 4, "tls_init")).toBe(some);
        // A glob nothing narrows takes every file it matches; a source the build writes from a computed name (curl's `${BUNDLE}.c`) names none of them; a list no file read sets is the command line's, out of reach.
        expect(await calls({ ...tls, "src/CMakeLists.txt": "add_executable(app main.c ${TLS_SOURCE})\n" })).toEqual(["src/main.c:4 tls_init() (src/tls_openssl.c)"]);
        expect(await calls({ ...tls, "src/CMakeLists.txt": "file(GLOB SRCS *.c)\nadd_executable(app ${SRCS})\n" })).toEqual(["src/main.c:4 tls_init() (src/tls_openssl.c)"]);
        expect(await calls({ ...tls, "src/CMakeLists.txt": 'add_custom_command(OUTPUT "${BUNDLE}.c" COMMAND gen > "${BUNDLE}.c")\nadd_executable(${BUNDLE} "${BUNDLE}.c")\n' })).toEqual(["src/main.c:4 tls_init() (src/tls_openssl.c)"]);
        expect(await calls({ ...tls, "src/Makefile.am": "BUNDLE = units\nnodist_units_SOURCES = $(BUNDLE).c\nUTILS = main.c tls_openssl.c\n$(BUNDLE).c: $(UTILS)\n\tgen $(UTILS) > $@\n" })).toEqual(["src/main.c:4 tls_init() (src/tls_openssl.c)"]);
    });

    it("link nothing into a file one of the programs the caller is built into doesn't take, nor one the caller's own build names in a branch", async () => {
        const tls = { "src/tls.h": "#ifndef TLS_H\n#define TLS_H\nint tls_init(void);\n#endif\n", "src/tls_openssl.c": `#include "tls.h"\n${fn("int tls_init(void)")}`, "src/main.c": `#include "tls.h"\n${fn("int run(void)", "return tls_init();")}` };
        const several = "built into several programs, one without the definition's file";
        expect(await why({ ...tls, "src/CMakeLists.txt": "add_executable(app_openssl main.c tls_openssl.c)\nadd_executable(app_gnutls main.c tls_gnutls.c)\n" }, "src/main.c", 4, "tls_init")).toBe(several);
        expect(await why({ ...tls, "src/Makefile": "app_openssl: main.o tls_openssl.o\n\t$(CC) -o $@ $^\napp_gnutls: main.o tls_gnutls.o\n\t$(CC) -o $@ $^\n" }, "src/main.c", 4, "tls_init")).toBe(several);
        // Objects a variable lists (redis's `REDIS_CLI_OBJ`), and a program whose other sources a variable no file read sets holds: neither names the definition's file.
        expect(await why({ ...tls, "src/Makefile": "SERVER_OBJ = main.o tls_openssl.o\nCLI_OBJ = main.o cli.o\nserver: $(SERVER_OBJ)\n\t$(CC) -o $@ $^\ncli: $(CLI_OBJ)\n\t$(CC) -o $@ $^\n" }, "src/main.c", 4, "tls_init")).toBe(several);
        expect(await why({ ...tls, "src/CMakeLists.txt": "add_executable(app main.c ${EXTRA_SOURCES})\nadd_executable(app_openssl main.c tls_openssl.c)\n" }, "src/main.c", 4, "tls_init")).toBe(several);
        // A program takes the sources of a library the file makes and it links (lua's `$(CORE_T)`); targets of one list choose nothing between them.
        const lua = "CORE_T = libcore.a\nCORE_O = tls_openssl.o\n.PHONY: o\no: main.o $(CORE_O)\napp: main.o $(CORE_T)\n\t$(CC) -o $@ $^\nluac: main.o $(CORE_T)\n\t$(CC) -o $@ $^\n$(CORE_T): $(CORE_O)\n\t$(AR) rcu $@ $?\n";
        expect(await calls({ ...tls, "src/Makefile": lua })).toEqual(["src/main.c:4 tls_init() (src/tls_openssl.c)"]);
        expect(await calls({ ...tls, "src/CMakeLists.txt": "add_library(core_static STATIC main.c)\nadd_library(core_shared SHARED main.c)\n" })).toEqual(["src/main.c:4 tls_init() (src/tls_openssl.c)"]);
        // A rule that compiles an object or writes a header, a plain Makefile's `ALL_SOURCES` (redis's), and automake's sources the build writes make no program.
        expect(await calls({ ...tls, "src/Makefile": "SERVER_OBJ = main.o tls_openssl.o\nALL_SOURCES = main.c cli.c\nserver: $(SERVER_OBJ)\n\t$(CC) -o $@ $^\n" })).toEqual(["src/main.c:4 tls_init() (src/tls_openssl.c)"]);
        expect(await calls({ ...tls, "src/Makefile": "SSL_OBJ = tls_openssl.o\napp: main.o $(SSL_OBJ)\n\t$(CC) -o $@ $^\nmain.o: main.c tls.h\n$(SSL_OBJ): tls_openssl.c tls.h\nmain.h: main.c\n" })).toEqual(["src/main.c:4 tls_init() (src/tls_openssl.c)"]);
        expect(await calls({ ...tls, "src/Makefile.am": "lib_LTLIBRARIES = libtls.la\nlibtls_la_SOURCES = main.c tls_openssl.c\nBUILT_SOURCES = main.c\n" })).toEqual(["src/main.c:4 tls_init() (src/tls_openssl.c)"]);
        // An object library's files are a program's (`$<TARGET_OBJECTS:core>`); a plain Makefile's substitution references name its objects.
        expect(await why({ ...tls, "src/CMakeLists.txt": "add_library(core OBJECT main.c)\nadd_executable(app_openssl $<TARGET_OBJECTS:core> tls_openssl.c)\nadd_executable(app_gnutls $<TARGET_OBJECTS:core> tls_gnutls.c)\n" }, "src/main.c", 4, "tls_init")).toBe(several);
        for (const ref of ["$(SRC_O:.c=.o)", "$(SRC_O:%.c=%.o)"])
            expect([ref, await why({ ...tls, "src/Makefile": `SRC_O = main.c tls_openssl.c\nSRC_G = main.c tls_gnutls.c\napp_openssl: ${ref}\n\t$(CC) -o $@ $^\napp_gnutls: ${ref.replace("SRC_O", "SRC_G")}\n\t$(CC) -o $@ $^\n` }, "src/main.c", 4, "tls_init")]).toEqual([ref, several]);
        // One program that links one backend's library or another's, in a conditional's branch.
        const backends = "add_library(tls_openssl_lib tls_openssl.c)\nadd_library(tls_gnutls_lib tls_gnutls.c)\nadd_executable(app main.c)\n";
        expect(await why({ ...tls, "src/CMakeLists.txt": `${backends}if(USE_OPENSSL)\n  target_link_libraries(app tls_openssl_lib)\nelse()\n  target_link_libraries(app tls_gnutls_lib)\nendif()\n` }, "src/main.c", 4, "tls_init")).toBe("a build links the definition's library in some builds only");
        expect(await calls({ ...tls, "src/CMakeLists.txt": `${backends}target_link_libraries(app tls_openssl_lib)\n` })).toEqual(["src/main.c:4 tls_init() (src/tls_openssl.c)"]);
        const io = { "lib/io.h": "#ifndef IO_H\n#define IO_H\nint io_open(void);\n#endif\n", "lib/io.c": `#include "io.h"\n${fn("int io_open(void)")}`, "app/main.c": `#include "../lib/io.h"\n${fn("int run(void)", "return io_open();")}` };
        const branch = "if(WIN32)\n  set(IO ../lib/io_w32.c)\nelse()\n  set(IO ../lib/io.c)\nendif()\n";
        expect(await why({ ...io, "app/CMakeLists.txt": `${branch}add_executable(app main.c \${IO})\n` }, "app/main.c", 4, "io_open")).toBe("a build file compiles the definition's file in some builds only");
        expect(await calls({ ...io, "app/CMakeLists.txt": "add_executable(app main.c ../lib/io.c)\n" })).toEqual(["app/main.c:4 io_open() (lib/io.c)"]);
    });

    it("link nothing to a definition in a file named for a platform, a processor or a variant the call's isn't", async () => {
        for (const file of ["src/io_w32.c", "src/x86/foo.c", "src/foo_generic.c", "src/foo_pthread.c"]) expect([file, await calls({ "src/foo.h": H, [file]: `#include "${file.split("/").length > 2 ? "../" : ""}foo.h"\n${fn("int helper(void)")}`, "src/main.c": MAIN })]).toEqual([file, []]);
    });

    it("read a `.C` file as C++'s: its calls draw nothing", async () => {
        expect(await why({ "src/main.C": `${fn("static int helper(int x)")}${fn("int run()", "return helper(1);")}` }, "src/main.C", 7, "helper")).toBe("not a call in a C file");
    });
});

describe("C's system headers and spliced lines", () => {
    it("link nothing to a name a system header the unit includes may make a macro (curses' `refresh`, Windows' capitalized names)", async () => {
        const screen = { "Makefile": "CFLAGS += -Isrc\n", "src/screen.h": "int refresh(void);\nint CreateThing(void);\nint create_thing(void);\n", "src/screen.c": `#include "screen.h"\n${fn("int refresh(void)")}${fn("int CreateThing(void)")}${fn("int create_thing(void)")}` };
        expect(await why({ ...screen, "src/ui.c": `#include "screen.h"\n#ifdef USE_CURSES\n#include <curses.h>\n#endif\n${fn("int draw(void)", "return refresh();")}` }, "src/ui.c", 7, "refresh")).toBe("a name a system header may make a macro");
        const win = `#include "screen.h"\n#ifdef _WIN32\n#include <windows.h>\n#endif\n${fn("int draw(void)", "return CreateThing() + create_thing();")}`;
        expect(await calls({ ...screen, "src/ui.c": win })).toEqual(["src/ui.c:7 create_thing() (src/screen.c)"]);
    });

    it("link nothing to a name a library's header in a branch may make a macro: one listed (GLEW's), or one named as the header, or capitalized where windows.h may come", async () => {
        const gl = (header: string, calls_: string) => ({ "Makefile": "CFLAGS += -Isrc\n", "src/shim.h": "int glCreateThing(void);\nint foo_open(void);\nint FooOpen(void);\nint bar_open(void);\n", "src/shim.c": `#include "shim.h"\n${fn("int glCreateThing(void)")}${fn("int foo_open(void)")}${fn("int FooOpen(void)")}${fn("int bar_open(void)")}`, "src/render.c": `#include "shim.h"\n#ifdef USE_LIB\n#include <${header}>\n#endif\n${fn("int draw(void)", calls_)}` });
        expect(await why(gl("GL/glew.h", "return glCreateThing();"), "src/render.c", 7, "glCreateThing")).toBe("a name a system header may make a macro");
        expect(await calls(gl("foo/foo.h", "return foo_open() + FooOpen() + bar_open();"))).toEqual(["src/render.c:7 bar_open() (src/shim.c)"]);
        expect(await calls(gl("curl/curl.h", "return FooOpen() + bar_open();"))).toEqual(["src/render.c:7 bar_open() (src/shim.c)"]);
    });

    it("read hiredis's compatibility headers as a library's that may make its names macros, and an unlisted library header named for compatibility as one that may make any", async () => {
        const sds = { "Makefile": "CFLAGS += -Isrc\n", "src/sds.h": "char *sdsnew(const char *s);\nint other_new(void);\n", "src/sds.c": `#include "sds.h"\n${fn("char *sdsnew(const char *s)")}${fn("int other_new(void)")}` };
        const cli = (header: string) => ({ ...sds, "src/cli.c": `#include "sds.h"\n#ifdef USE_LIB\n#include <${header}>\n#endif\n${fn("int run(void)", 'return !!sdsnew("x") + other_new();')}` });
        expect(await calls(cli("hiredis/sdscompat.h"))).toEqual(["src/cli.c:7 other_new() (src/sds.c)"]);
        expect(await calls(cli("foo/foo_compat.h"))).toEqual([]);
        expect(await calls(cli("foo/foo.h"))).toEqual(["src/cli.c:7 sdsnew() (src/sds.c)", "src/cli.c:7 other_new() (src/sds.c)"]);
    });

    it("link to a name a system header may make a macro where the header comes before both the call and the definition, in the same file: a macro renames both", async () => {
        // `<zlib.h>`, a library's header where a branch holds it, may make `gz_compress` a macro.
        const zlib = "#ifdef HAVE_ZLIB\n#include <zlib.h>\n#endif\n";
        const ui = (before: string, between: string) => ({ "Makefile": "CFLAGS += -Isrc\n", "src/ui.c": `${before}${fn("static int gz_compress(int x)", "return x;")}${between}${fn("int draw(void)", "return gz_compress(3);")}` });
        expect(await calls(ui(zlib, ""))).toEqual(["src/ui.c:10 gz_compress()"]);
        expect(await why(ui("", zlib), "src/ui.c", 10, "gz_compress")).toBe("a system header that may make the name a macro, between call and definition");
    });

    it("read a directive after a comment begun on a line before, where nothing but space comes before the comment", async () => {
        expect(readPreproc("/* a\n   b */ #define X 1\nint y; /* c\n   d */ #define Z 2\n/* e */ /* f\n */ #define W 3\n").macros.map((m) => m.name)).toEqual(["X", "W"]);
        const foo = { "src/foo.h": "int foo_get(void);\nint foo_alt(void);\n", "src/foo.c": `#include "foo.h"\n${fn("int foo_get(void)")}${fn("int foo_alt(void)")}` };
        expect(await why({ ...foo, "src/main.c": `#include "foo.h"\n/* a comment\n   over two lines */ #define foo_get foo_alt\n${fn("int run(void)", "return foo_get();")}${pad}` }, "src/main.c", 6, "foo_get")).toBe("a macro's name");
    });

    it("splice a backslash and spaces before a line's end, as GCC and clang do", async () => {
        const foo = { "src/foo.h": "int foo_get(void);\nint get(void);\nint foo_alt(void);\n", "src/foo.c": `#include "foo.h"\n${fn("int foo_get(void)")}${fn("int get(void)")}${fn("int foo_alt(void)")}` };
        expect(await why({ ...foo, "src/main.c": `#include "foo.h"\n${fn("int run(void)", "return foo_\\  \nget();")}${pad}` }, "src/main.c", 5, "get")).toBe("spliced with the line before or after");
        expect(await why({ ...foo, "src/main.c": `#include "foo.h"\n#def\\ \nine foo_get foo_alt\n${fn("int run(void)", "return foo_get();")}${pad}` }, "src/main.c", 6, "foo_get")).toBe("a macro's name");
    });

    it("link nothing from a name spliced with the line before or after it; a directive's lines are spliced", async () => {
        const foo = { "src/foo.h": "int foo_get(void);\nint get(void);\nint foo_alt(void);\n", "src/foo.c": `#include "foo.h"\n${fn("int foo_get(void)")}${fn("int get(void)")}${fn("int foo_alt(void)")}` };
        expect(await why({ ...foo, "src/main.c": `#include "foo.h"\n${fn("int run(void)", "return foo_\\\nget();")}${pad}` }, "src/main.c", 5, "get")).toBe("spliced with the line before or after");
        expect(await why({ ...foo, "src/main.c": `#include "foo.h"\n#define foo_\\\nget foo_alt\n${fn("int run(void)", "return foo_get();")}${pad}` }, "src/main.c", 6, "foo_get")).toBe("a macro's name");
        expect(readPreproc("%:define X 1\n/* c */ #define Y 2\n").macros.map((m) => m.name)).toEqual(["X", "Y"]);
    });
});
