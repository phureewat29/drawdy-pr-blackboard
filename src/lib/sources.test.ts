import { describe, expect, it } from "@jest/globals";
import { testParse } from "../test/parser.ts";
import type { PrFile } from "./github.ts";
import { changedSources, pickFiles, READ, readSources } from "./sources.ts";

const changed = (path: string, additions = 1): PrFile => ({ path, status: "modified", additions, deletions: 0, patch: "@@ -1,1 +1,1 @@\n+x" });

describe("readSources", () => {
    it("reads the changed files, the config above them, and their direct imports, each path once, candidates in order", async () => {
        const repo: Record<string, string> = {
            "tsconfig.json": '{ "compilerOptions": { "baseUrl": ".", "paths": { "@lib/*": ["lib/*"] } } }',
            "src/app.ts": 'import { a } from "./util"\nimport { b } from "@lib/b"\nimport { c } from "./dir"\nimport x from "react"\nexport const run = () => a + b + c',
            "src/app.test.ts": 'import { run } from "./app"\nrun()',
            "src/util.ts": 'import { deep } from "./deep"\nexport const a = deep',
            "src/deep.ts": "export const deep = 1",
            "lib/b.ts": "export const b = 2",
            "src/dir/index.ts": "export const c = 3",
        };
        const asked: string[] = [];
        const read = async (path: string) => {
            asked.push(path);
            return repo[path] ?? null;
        };
        const sources = await readSources([changed("src/app.ts"), changed("src/app.test.ts"), changed("README.md")], read, testParse);
        expect(new Set(asked).size).toBe(asked.length);
        expect([...sources.texts.keys()]).toEqual(["src/app.ts", "src/app.test.ts", "src/util.ts", "lib/b.ts", "src/dir/index.ts"]);
        expect(asked).not.toContain("src/deep.ts");
        expect(asked.filter((p) => p.startsWith("src/dir"))).toEqual(["src/dir.ts", "src/dir.tsx", "src/dir.d.ts", "src/dir.mts", "src/dir.cts", "src/dir.js", "src/dir.jsx", "src/dir.mjs", "src/dir.cjs", "src/dir/index.ts"]);
        expect(asked.filter((p) => p.endsWith("config.json"))).toEqual(["src/tsconfig.json", "src/jsconfig.json", "tsconfig.json"]);
        expect(asked.some((p) => p.includes("react"))).toBe(false);
        expect(sources.paths("src/app.ts")).toEqual([{ pattern: "@lib/*", targets: ["lib/*"] }]);
    });

    it("reads the go.mod above a Go file, and for a Python file the `__init__.py` above it and its imports: the module's file, a package's submodule, and where a package takes a name from", async () => {
        const repo: Record<string, string> = {
            "go.mod": "module example.com/m\n",
            "srv/a.go": "package srv\n\nfunc A() {}\n",
            "app/__init__.py": "",
            "app/run.py": "from .util import helper\nfrom app.models import User\n",
            "app/util.py": "def helper():\n    pass\n",
            "app/models/__init__.py": "from .user import User\n",
            "app/models/user.py": "class User:\n    pass\n",
        };
        const asked: string[] = [];
        const read = async (path: string) => {
            asked.push(path);
            return repo[path] ?? null;
        };
        const sources = await readSources([changed("srv/a.go"), changed("app/run.py")], read, testParse);
        expect(new Set(asked).size).toBe(asked.length);
        expect(asked.filter((p) => p.endsWith("go.mod"))).toEqual(["srv/go.mod", "go.mod"]);
        expect([...sources.texts.keys()]).toEqual(["srv/a.go", "app/run.py", "go.mod", "app/__init__.py", "app/util.py", "app/models/__init__.py", "app/models/user.py"]);
        expect(asked).toEqual(expect.arrayContaining(["app/models.py", "app/models/User.py"]));
        expect(asked.some((p) => p.includes("tsconfig"))).toBe(false);
    });

    it("reads a Python file's `__init__.py` upward until one is missing; a module where a known path shows its name, under every root Python searches, and deeper only where a root holds its first name", async () => {
        const repo: Record<string, string> = {
            "app/__init__.py": "",
            "app/api/__init__.py": "",
            "app/api/run.py": "import json\nimport numpy\nimport utils\nfrom app.models import User\n",
            "app/models.py": "class User:\n    pass\n",
            "utils.py": "def load():\n    pass\n",
            "src/utils.py": "def load():\n    pass\n",
        };
        const asked: string[] = [];
        const read = async (path: string) => {
            asked.push(path);
            return repo[path] ?? null;
        };
        const sources = await readSources([changed("app/api/run.py"), changed("src/utils.py")], read, testParse);
        expect(asked).toEqual(expect.arrayContaining(["app/api/__init__.py", "app/__init__.py", "src/__init__.py", "utils.py", "src/utils/__init__.py", "app/models.py", "src/app.py", "src/app/__init__.py"]));
        expect(asked).not.toContain("__init__.py");
        expect(asked.some((p) => p.includes("json") || p.includes("numpy") || p.startsWith("src/app/models"))).toBe(false);
        expect([...sources.facts.keys()]).toEqual(expect.arrayContaining(["utils.py", "src/utils.py", "app/models.py"]));
    });

    it("reads for a Java file its imports' files and its package's types it names, java.lang's names among them, src/main's from src/test, and every class's supertypes, round after round; a JDK package is looked for nowhere", async () => {
        const repo: Record<string, string> = {
            "src/main/java/org/x/App.java":
                "package org.x;\n\nimport java.util.List;\nimport org.x.util.Strings;\nimport org.junit.Test;\nimport static org.x.util.Strings.join;\n\nclass App extends Base {\n    Helper h;\n    void run() { Strings.join(\"a\"); new Helper(); String s; }\n}\n",
            "src/main/java/org/x/Base.java": "package org.x;\n\nclass Base extends Root {}\n",
            "src/main/java/org/x/Root.java": "package org.x;\n\nclass Root {}\n",
            "src/main/java/org/x/Helper.java": "package org.x;\n\nclass Helper {}\n",
            "src/main/java/org/x/Unused.java": "package org.x;\n\nclass Unused {}\n",
            "src/main/java/org/x/util/Strings.java": "package org.x.util;\n\npublic class Strings {\n    public static String join(String a) { return a; }\n}\n",
            "src/test/java/org/x/AppTest.java": "package org.x;\n\nclass AppTest {\n    void t() { new App().run(); new Fixture(); }\n}\n",
            "src/test/java/org/x/Fixture.java": "package org.x;\n\nclass Fixture {}\n",
        };
        const asked: string[] = [];
        const read = async (path: string) => {
            asked.push(path);
            return repo[path] ?? null;
        };
        const sources = await readSources([changed("src/main/java/org/x/App.java"), changed("src/test/java/org/x/AppTest.java")], read, testParse);
        expect(new Set(asked).size).toBe(asked.length);
        expect([...sources.texts.keys()]).toEqual([
            "src/main/java/org/x/App.java",
            "src/test/java/org/x/AppTest.java",
            "src/main/java/org/x/util/Strings.java",
            "src/main/java/org/x/Base.java",
            "src/main/java/org/x/Helper.java",
            "src/test/java/org/x/Fixture.java",
            "src/main/java/org/x/Root.java",
        ]);
        expect(asked).toEqual(expect.arrayContaining(["src/test/java/org/x/App.java", "src/main/java/org/junit/Test.java", "src/main/java/org/x/String.java"]));
        expect(asked.some((p) => p.includes("java/util") || p.includes("Unused"))).toBe(false);
    });

    it("reads a Java name in the roots the file sees alone, never another module's nor a package imported on demand, java.lang's names in a declaration's header, and a supertype a nested type of the same name doesn't hide", async () => {
        const repo: Record<string, string> = {
            "core/src/main/java/org/x/Core.java": "package org.x;\n\npublic class Core {}\n",
            "core/src/main/java/org/x/Other.java": "package org.x;\n\npublic class Other {}\n",
            "core/src/main/java/org/x/util/Tool.java": "package org.x.util;\n\npublic class Tool {}\n",
            "it/src/main/java/org/x/Builder.java": "package org.x;\n\npublic interface Builder {}\n",
            "it/src/main/java/org/x/Lib.java": "package org.x;\n\npublic class Lib {\n    public void take(Integer i) {}\n}\n",
            "it/src/test/java/org/x/UseTest.java":
                "package org.x;\n\nimport java.util.*;\nimport org.x.util.*;\n\nclass UseTest {\n    void t() { new Core(); new Tool(); List<String> l; new Lib(); }\n}\n",
            "it/src/test/java/org/x/Made.java": "package org.x;\n\nclass Made implements Builder {\n    static class Builder {}\n}\n",
        };
        const asked: string[] = [];
        const read = async (path: string) => {
            asked.push(path);
            return repo[path] ?? null;
        };
        const sources = await readSources([changed("core/src/main/java/org/x/Other.java"), changed("it/src/test/java/org/x/UseTest.java"), changed("it/src/test/java/org/x/Made.java")], read, testParse);
        expect(new Set(asked).size).toBe(asked.length);
        expect([...sources.texts.keys()].sort()).toEqual([
            "core/src/main/java/org/x/Other.java",
            "it/src/main/java/org/x/Builder.java",
            "it/src/main/java/org/x/Lib.java",
            "it/src/test/java/org/x/Made.java",
            "it/src/test/java/org/x/UseTest.java",
        ]);
        // UseTest's names in its own roots, test then main; Lib's header's java.lang name in Lib's.
        expect(asked).toEqual(expect.arrayContaining(["it/src/test/java/org/x/Core.java", "it/src/main/java/org/x/Core.java", "it/src/main/java/org/x/List.java", "it/src/main/java/org/x/String.java", "it/src/main/java/org/x/Integer.java"]));
        expect(asked.some((p) => p.startsWith("core/src/main/java/org/x/C") || p.includes("/util/") || p.endsWith("/java/util/List.java"))).toBe(false);
    });

    it("parses every changed Python, Go and Rust file it reads, however much there is: only READ.chars leaves a file out", async () => {
        const files = Array.from({ length: 9 }, (_, i): PrFile => ({ path: `src/f${i}.rs`, status: "modified", additions: 100 + i, deletions: 0, patch: "@@ -1,1 +1,1 @@\n+x" }));
        const parsed: string[] = [];
        const text = (path: string) => (path === "src/f0.rs" ? "x".repeat(READ.chars + 1) : path.endsWith(".rs") ? "x".repeat(READ.chars - 10_000) : path === "src/a.ts" ? "export const a = 1" : null);
        const sources = await readSources([...files, changed("src/a.ts")], async (path) => text(path), async (path) => {
            parsed.push(path);
            return null;
        });
        expect(parsed.sort()).toEqual(["src/a.ts", ...files.slice(1).map((f) => f.path)]);
        expect(sources.texts.has("src/f0.rs")).toBe(false);
    });
});

describe("the files read", () => {
    it("are every changed code file, and the tests the parser reads, removed ones aside", () => {
        const files = [changed("src/a.ts"), changed("src/a.test.ts"), changed("tests/test_a.py"), changed("app/a.py"), changed("README.md"), { ...changed("src/gone.ts"), status: "removed" as const }];
        expect(changedSources(files).map((f) => f.path)).toEqual(["src/a.ts", "app/a.py", "src/a.test.ts", "tests/test_a.py"]);
    });

    it("leave out a Rust test in a file of its own: its names reach no other file", () => {
        expect(changedSources([changed("src/lib.rs"), changed("tests/parse.rs"), changed("pkg/a_test.go")]).map((f) => f.path)).toEqual(["src/lib.rs", "pkg/a_test.go"]);
    });

    it("take a code file the parser doesn't read only with its patch, but for one added whole, whose every line is new", () => {
        const added: PrFile = { path: "src/New.kt", status: "added", additions: 300, deletions: 0 };
        const big: PrFile = { path: "src/Big.kt", status: "modified", additions: 3000, deletions: 10 };
        const parsed: PrFile = { path: "src/Big.java", status: "modified", additions: 3000, deletions: 10 };
        expect(changedSources([added, big, parsed, changed("src/Small.kt")]).map((f) => f.path)).toEqual(["src/New.kt", "src/Big.java", "src/Small.kt"]);
    });

    it("on a big pull request, are the largest changes in its main languages, spread across top-level directories, tooling folders aside", () => {
        const files = [
            ...Array.from({ length: 30 }, (_, i) => changed(`src/core/f${i}.rs`, 100 + i)),
            ...Array.from({ length: 30 }, (_, i) => changed(`packages/js/f${i}.rs`, 50 + i)),
            ...Array.from({ length: 30 }, (_, i) => changed(`.claude/workflows/w${i}.workflow.js`, 500)),
            changed("scripts/tiny.ts", 1),
        ];
        const picked = changedSources(files);
        expect(picked).toHaveLength(40);
        expect(picked.every((f) => f.path.endsWith(".rs"))).toBe(true);
        expect(picked.filter((f) => f.path.startsWith("src/"))).toHaveLength(20);
        expect(picked.some((f) => f.path === "src/core/f29.rs")).toBe(true);
        expect(pickFiles(files.slice(0, 3), 40)).toEqual(files.slice(0, 3));
    });
});
