import { describe, expect, it } from "@jest/globals";
import { testParse } from "../test/parser.ts";
import type { PrFile } from "./github.ts";
import { changedSources, pickFiles, readSources } from "./sources.ts";

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
});

describe("the files read", () => {
    it("are every changed code file, and the tests the parser reads, removed ones aside", () => {
        const files = [changed("src/a.ts"), changed("src/a.test.ts"), changed("tests/test_a.py"), changed("app/a.py"), changed("README.md"), { ...changed("src/gone.ts"), status: "removed" as const }];
        expect(changedSources(files).map((f) => f.path)).toEqual(["src/a.ts", "app/a.py", "src/a.test.ts"]);
    });

    it("take a code file the parser doesn't read only with its patch, but for one added whole, whose every line is new", () => {
        const added: PrFile = { path: "src/new.rs", status: "added", additions: 300, deletions: 0 };
        const big: PrFile = { path: "src/big.rs", status: "modified", additions: 3000, deletions: 10 };
        expect(changedSources([added, big, changed("src/small.rs")]).map((f) => f.path)).toEqual(["src/new.rs", "src/small.rs"]);
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
