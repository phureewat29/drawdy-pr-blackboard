import { describe, expect, it } from "@jest/globals";
import { testParse } from "../../../test/parser.ts";
import { isGeneric, type GFile } from "../../anyfacts.ts";
import { parsePatch } from "../../diff.ts";
import { grammarOf, languageOf, roleOf } from "../../language.ts";
import { changedSymbols } from "../../symbols.ts";
import { bracesBalance } from "./units.ts";

const index = async (path: string, text: string): Promise<GFile> => {
    const f = await testParse(path, text);
    if (!f || !isGeneric(f)) throw new Error(`${path} wasn't read by a rule table`);
    return f;
};

/** Each unit as `label lines`, from its first comment to its last line. */
const units = (f: GFile) => f.units.map((u) => `${f.labels.get(u.id)} ${u.docLine}-${u.endLine}`);

/** Plain functions after a sample, so its few errors stay under the share the parser is trusted with. */
const filler = Array.from({ length: 40 }, (_, i) => `int filler${i}(int x)\n{\n    return x + ${i};\n}\n`).join("\n");

const LIST = `#include <stdlib.h>
#include "list.h"

/* A point. */
struct point {
    int x;
    int y;
};

typedef struct node {
    struct node *next;
    int key;
} node_t;

typedef struct {
    int a;
} anon_t;

union value {
    int i;
    double d;
};

enum color { RED, GREEN };

typedef void (*callback_t)(int);

int prototype(int x);

/* Finds the node with a key. */
static node_t *find(node_t *head, int key)
{
    struct local { int z; } scratch;
    while (head && head->key != key)
        head = head->next;
    return head;
}

void (*on_signal(int sig))(int)
{
    return NULL;
}

int apply(int fn(int), int x) { return fn(x); }

#ifdef HAVE_TRACE
static void trace(const char *msg) { (void)msg; }
#endif
`;

describe("C's units", () => {
    it("are function definitions, whole, and the structs, unions, enums and typedefs with a body, each with the comment above it", async () => {
        const f = await index("src/list.c", LIST);
        expect(units(f)).toEqual([
            "struct point 4-8",
            "typedef node_t 10-13",
            "typedef anon_t 15-17",
            "union value 19-22",
            "enum color 24-24",
            "find() 30-37",
            "on_signal() 39-42",
            "apply() 44-44",
            "trace() 47-47",
        ]);
    });

    it("make no unit of a prototype, a function pointer's typedef, a struct inside a function, or a parameter that is a function; its sites are the calls to a bare name", async () => {
        const f = await index("src/list.c", LIST);
        const names = f.units.map((u) => u.name);
        expect(names).not.toContain("prototype");
        expect(names).not.toContain("callback_t");
        expect(names).not.toContain("local");
        expect(names).not.toContain("fn");
        expect([f.sites.map((s) => `${s.line} ${s.ref} ${s.name}`), f.imports, f.scopes.length]).toEqual([["44 call fn"], [], 1]);
    });

    it("leave out a definition the parser read with a macro call above it as its type, split from it by a blank line", async () => {
        const f = await index("lib/huf.c", `HUF_DGEN(decompress_body)\n\nstatic size_t decompress(void *dst)\n{\n    return 0;\n}\n\nstatic int ok(void)\n{\n    return 1;\n}\n\n${filler}`);
        expect(units(f).slice(0, 2)).toEqual(["ok() 8-11", "filler0() 13-16"]);
    });

    it("leave out a definition whose closing brace the parser supplied", async () => {
        const f = await index("src/a.c", `${filler}\nint broken(int x)\n{\n    if (x) {\n        return 0;\n    }\n    return x;\n\nint after(void)\n{\n    return 1;\n}\n`);
        expect(f.units.map((u) => u.name)).not.toContain("broken");
        expect(f.units.length).toBe(40);
    });

    it("leave a file the parser can't trust to the line patterns", async () => {
        // An export macro before each declaration, as zstd writes them: most of the file is an error.
        const text = "ZSTDLIB_API size_t ZSTD_compress(void* dst, size_t cap,\n                               const void* src, size_t size,\n                               int level);\nZSTDLIB_API size_t ZSTD_freeCCtx(ZSTD_CCtx* cctx) {\n    return 0;\n}\n";
        expect(await testParse("lib/zstd.c", text)).toBeNull();
        const { symbols } = changedSymbols("lib/zstd.c", "c", text.split("\n"), parsePatch("@@ -5,1 +5,1 @@\n-    return 1;\n+    return 0;"));
        expect(symbols.map((s) => `${s.label} ${s.start}-${s.end}`)).toEqual(["ZSTD_freeCCtx() 4-6"]);
    });
});

describe("C's braces, read as a compiler would read them", () => {
    it("balance through every first branch of a conditional, and through every `#else`", () => {
        const text = "{\n#if A\n  if (a) {\n#else\n  if (b) {\n#endif\n    go();\n  }\n}";
        expect(bracesBalance(text, 0, text.length)).toBe(true);
    });

    it("don't over a span that stops at a brace closing a block inside it: where the parser, lost among a conditional's branches, ended a function early", () => {
        // The shape of curl's netrc.c, where tree-sitter ended Curl_netrc_scan nine lines early: each branch closes a block and opens another.
        const text = "int f(int a)\n{\n  if (a) {\n    a++;\n#if A\n  }\n  else {\n    a--;\n#elif B\n  }\n  else {\n    a -= 2;\n#endif\n  }\n  return a;\n}\n";
        expect(bracesBalance(text, 0, text.length)).toBe(true);
        expect(bracesBalance(text, 0, text.indexOf("  }\n  return a;") + 3)).toBe(false);
    });

    it("ignore braces in comments, strings, characters, raw strings and directives", () => {
        const text = '{\n  // {\n  /* { */\n  s = "{";\n  c = \'{\';\n  r = R"x({)x";\n#define OPEN {\n  n = 1\'000;\n}';
        expect(bracesBalance(text, 0, text.length)).toBe(true);
    });

    it("don't, where a conditional opens or closes outside the span", () => {
        expect(bracesBalance("{\n#endif\n}", 0, 10)).toBe(false);
        expect(bracesBalance("{\n#if A\n}", 0, 9)).toBe(false);
    });
});

describe("C's files", () => {
    it("are `.c` files, read by C's grammar; headers read as C++", () => {
        expect(["a.c", "a.h", "a.m"].map((p) => [languageOf(p), grammarOf(p)])).toEqual([
            ["c", "c"],
            ["cpp", "cpp"],
            ["c", null],
        ]);
    });

    it("are tests when named for one", () => {
        expect(["src/list_test.c", "src/list_tests.c", "src/list.c"].map(roleOf)).toEqual(["test", "test", "code"]);
    });
});
