import { sumBy } from "../lib/fp.ts";
import type { PrFile, PrInfo } from "../lib/github.ts";

/** A function in a synthetic source file: what it calls, and how it changed. */
export type FakeFunction = {
    name: string;
    calls?: string[];
    /** Unchanged lines in its body, before the calls. */
    body?: number;
    change?: "new" | "changed" | "none";
    /** Makes one line this long, for a wide card. */
    wide?: number;
};

export type FakeFile = { path: string; functions?: FakeFunction[]; text?: string[]; tests?: string[] };

/** `to` as an import from `from`'s directory: `./options`, `../src/options`. */
const relative = (from: string, to: string) => {
    const a = from.split("/").slice(0, -1);
    const b = to.replace(/\.ts$/, "").split("/");
    let i = 0;
    while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
    const up = a.slice(i).map(() => "..");
    return [...(up.length > 0 ? up : ["."]), ...b.slice(i)].join("/");
};

/**
 * A pull request made up for tests and the preview: TypeScript files of
 * functions that call each other, test files that import and call them, and
 * docs. Each file's patch is one hunk over the whole file.
 */
export const syntheticPr = (title: string, files: readonly FakeFile[], body = "A made-up pull request for testing the board layout.") => {
    const prFiles: PrFile[] = [];
    const raw = new Map<string, string>();
    const home = new Map(files.flatMap((f) => (f.functions ?? []).map((fn) => [fn.name, f.path] as const)));
    for (const f of files) {
        const head: string[] = [];
        const base: string[] = [];
        const patch: string[] = [];
        const line = (text: string, kind: "ctx" | "add" | "del") => {
            if (kind !== "del") head.push(text);
            if (kind !== "add") base.push(text);
            patch.push(`${kind === "add" ? "+" : kind === "del" ? "-" : " "}${text}`);
        };
        if (f.functions) {
            line(`// ${f.path}`, "ctx");
            for (const fn of f.functions) {
                const kind = fn.change === "new" ? "add" : "ctx";
                line("", kind);
                line(`export function ${fn.name}(input: number): number {`, kind);
                for (let i = 0; i < (fn.body ?? 3); i++) line(`  const step${i} = input + ${i}`, kind);
                if (fn.wide) line(`  const label = "${"x".repeat(fn.wide)}"`, kind);
                if (fn.change === "changed") {
                    line(`  const total = input * 1`, "del");
                    line(`  const total = input * 2`, "add");
                } else line(`  const total = input * 2`, kind);
                for (const callee of fn.calls ?? []) line(`  ${callee}(total)`, kind);
                line(`  return total`, kind);
                line(`}`, kind);
            }
        } else if (f.tests) {
            for (const path of [...new Set(f.tests.map((name) => home.get(name)).filter((x) => x !== undefined))]) {
                line(`import { ${f.tests.filter((name) => home.get(name) === path).join(", ")} } from "${relative(f.path, path)}"`, "ctx");
            }
            line(`describe("${f.path}", () => {`, "ctx");
            for (const name of f.tests) {
                line(`  it("checks ${name}", () => {`, "add");
                line(`    expect(${name}(1)).toBe(2)`, "add");
                line(`  })`, "add");
            }
            line(`})`, "ctx");
        } else {
            for (const text of f.text ?? ["Docs."]) line(text, "add");
        }
        const add = patch.filter((l) => l.startsWith("+")).length;
        const del = patch.filter((l) => l.startsWith("-")).length;
        prFiles.push({
            path: f.path,
            status: "modified",
            additions: add,
            deletions: del,
            patch: `@@ -1,${base.length} +1,${head.length} @@\n${patch.join("\n")}`,
        });
        if (f.functions || f.tests) raw.set(f.path, head.join("\n"));
    }
    const pr: PrInfo = {
        ref: { owner: "example", repo: "synthetic", number: 1 },
        url: "https://github.com/example/synthetic/pull/1",
        title,
        body,
        author: "tester",
        state: "open",
        headSha: "head",
        headRepo: "example/synthetic",
        additions: sumBy(prFiles, (f) => f.additions),
        deletions: sumBy(prFiles, (f) => f.deletions),
        changedFiles: prFiles.length,
    };
    return { pr, files: prFiles, raw };
};

/**
 * A description with every Markdown block GitHub renders, and the HTML a
 * description may hold that must never reach a card as it is.
 */
export const EVERY_BLOCK = [
    "<!-- Thanks for the pull request! Fill in the template below. -->",
    "# Parse options and render output",
    "Options are read **once**, _validated_, ~~cached~~ and passed down. See [the guide](https://example.com/guide) and `parseOptions()`; R&amp;D says 5 &lt; 6.",
    "## What changed",
    "- `readFlags()` normalizes each flag\n  - nested: `normalizeFlag()` is new\n- `validateOptions()` rejects unknown keys",
    "1. Read\n2. Validate\n3. Render",
    "- [x] Tests\n- [ ] Docs",
    "### Example",
    "```ts\nconst options = parseOptions(argv);\nrenderOutput(options); // prints rows\n```",
    "```diff\n- const total = input * 1\n+ const total = input * 2\n```",
    "| Flag | Default |\n|:-----|--------:|\n| `--wide` | false |\n| `--rows` | 20 |",
    "> A quote with *emphasis*.",
    "> [!WARNING]\n> Flags are now case-sensitive.",
    "---",
    "![a screenshot of the output](https://example.com/shot.png) and <img src=\"https://example.com/x.png\" alt=\"raw image\" onerror=\"alert(1)\">",
    "https://github.com/user-attachments/assets/0f1e2d3c-aaaa-bbbb-cccc-123456789abc",
    "<details><summary>Benchmarks</summary>\n\n<details><summary>Inner</summary>\n\nNested text.\n\n</details>\n\nOuter text.\n\n</details>",
    "<script>alert('x')</script><iframe src=\"https://example.com\"></iframe><p align=\"center\" onclick=\"steal()\">Centred<br>text</p>",
].join("\n\n");

/** Two threads, a cycle, a column of mixed widths, tests and docs, and a description with every Markdown block. */
export const twoThreads = () =>
    syntheticPr("feat: parse options and render output", [
        {
            path: "src/options.ts",
            functions: [
                { name: "parseOptions", calls: ["readFlags", "validateOptions"], change: "changed" },
                { name: "readFlags", calls: ["normalizeFlag"], change: "changed", wide: 90 },
                { name: "validateOptions", calls: ["normalizeFlag"], change: "changed" },
                { name: "normalizeFlag", change: "new" },
            ],
        },
        {
            path: "src/render.ts",
            functions: [
                { name: "renderOutput", calls: ["formatRows"], change: "changed" },
                { name: "formatRows", calls: ["padCells"], change: "changed" },
                { name: "padCells", calls: ["formatRows"], change: "changed" },
                { name: "writeBanner", change: "changed" },
            ],
        },
        { path: "src/options.test.ts", tests: ["parseOptions", "normalizeFlag"] },
        { path: "src/render.test.ts", tests: ["writeBanner"] },
        { path: "README.md", text: ["Use parseOptions to read flags."] },
    ], EVERY_BLOCK);

/** More changes than a board holds: three threads, lone functions and docs past the 32-card limit. */
export const crowded = () => {
    const files: FakeFile[] = [];
    for (let t = 0; t < 3; t++) {
        files.push({
            path: `src/thread${t}.ts`,
            functions: Array.from({ length: 6 }, (_, i) => ({ name: `step${t}x${i}`, calls: i < 5 ? [`step${t}x${i + 1}`] : [], change: "changed" as const })),
        });
    }
    for (let i = 0; i < 14; i++) files.push({ path: `src/lone${String(i).padStart(2, "0")}.ts`, functions: [{ name: `alone${i}`, change: "changed" }] });
    for (let i = 0; i < 16; i++) files.push({ path: `docs/page${String(i).padStart(2, "0")}.md`, text: [`Page ${i}.`] });
    return syntheticPr("refactor: split the pipeline into steps", files);
};

/** Sixty changed functions in four files, none calling another; with `docs`, a README too. */
export const sixtyFunctions = (docs = false) =>
    syntheticPr("chore: touch sixty functions", [
        ...Array.from({ length: 4 }, (_, f) => ({
            path: `src/part${f}.ts`,
            functions: Array.from({ length: 15 }, (_, i) => ({ name: `part${f}fn${i}`, change: "changed" as const })),
        })),
        ...(docs ? [{ path: "README.md", text: ["Notes."] }] : []),
    ]);
