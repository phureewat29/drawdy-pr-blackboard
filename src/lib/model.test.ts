import { beforeAll, describe, expect, it } from "@jest/globals";
import { honoFixture, reviewOf } from "../test/fixture.ts";
import { crowded, sixtyFunctions, syntheticPr, twoThreads } from "../test/synthetic.ts";
import type { PrFile } from "./github.ts";
import { stepsOf } from "./layout.ts";
import { LIMITS, type Review } from "./model.ts";

/** A pull request of a few files, each one hunk, with the head texts given. */
const small = (heads: Record<string, string>, patches: Record<string, string>) => {
    const { pr } = honoFixture();
    const files: PrFile[] = Object.entries(patches).map(([path, patch]) => ({
        path,
        status: "modified",
        additions: patch.split("\n").filter((l) => l.startsWith("+")).length,
        deletions: patch.split("\n").filter((l) => l.startsWith("-")).length,
        patch,
    }));
    return reviewOf({ pr: { ...pr, changedFiles: files.length }, files, raw: new Map(Object.entries(heads)) });
};

describe("buildReview on hono#5513", () => {
    let review: Review;
    const nameOf = (id: string) => review.pins.find((p) => p.id === id)!.name;
    beforeAll(async () => {
        review = await reviewOf(honoFixture());
    });

    it("pins the PR card, each changed function, the unchanged caller, the tests and the imports", () => {
        expect(review.pins.map((p) => `${p.kind} ${p.name} ${p.lane}`)).toEqual([
            "pr The pull request flow",
            "change toError() flow",
            "change compose() flow",
            "change #handleError() flow",
            "change #dispatch() flow",
            "change onError() rest",
            "context fetch() flow",
            "file hono-base.ts imports under",
            "test compose.test.ts under",
            "test hono.test.ts rest",
        ]);
    });

    it("finds one thread from #dispatch(), callers left of what they call", () => {
        expect(review.bands).toEqual([{ entries: ["src/hono-base.ts:411"] }]);
        const columns = Object.fromEntries(review.pins.filter((p) => p.lane === "flow").map((p) => [p.name, p.column]));
        expect(columns).toEqual({ "The pull request": 0, "fetch()": 0, "#dispatch()": 1, "#handleError()": 2, "compose()": 2, "toError()": 3 });
    });

    it("links the cards by resolved references, each from the row that makes it, and nothing from the PR card", () => {
        const links = review.links.map((l) => `${l.kind} ${nameOf(l.from)} → ${nameOf(l.to)} @${l.at ?? "-"}`);
        expect(links).toEqual([
            "calls compose() → toError() @57",
            "imports hono-base.ts imports → compose() @7",
            "imports hono-base.ts imports → toError() @7",
            "calls #handleError() → toError() @406",
            "calls #dispatch() → #handleError() @451",
            "calls #dispatch() → compose() @455",
            "context fetch() → #dispatch() @489",
            "tests compose.test.ts → compose() @259",
            "tests hono.test.ts → fetch() @771",
            "tests hono.test.ts → onError() @1474",
        ]);
        expect(review.links.find((l) => l.kind === "context")!.reads).toBe("calls");
        expect(review.unpinned).toEqual({ functions: 0, files: 0 });
    });

    it("walks the cards in board order, nine steps, never the unchanged caller", () => {
        expect(stepsOf(review).map(nameOf)).toEqual([
            "The pull request",
            "#dispatch()",
            "#handleError()",
            "compose()",
            "toError()",
            "compose.test.ts",
            "hono-base.ts imports",
            "onError()",
            "hono.test.ts",
        ]);
    });

    it("links a test only to what it imports and uses, never by its file's name, and a link into the unchanged caller places nothing", () => {
        // hono.test.ts is hono-base.ts's test file, but it never reaches the private #dispatch().
        const tests = review.links.filter((l) => l.from === "test:src/hono.test.ts").map((l) => nameOf(l.to));
        expect(tests).toEqual(["fetch()", "onError()"]);
        expect(review.pins.find((p) => p.name === "hono.test.ts")!.lane).toBe("rest");
    });
});

describe("buildReview on made-up pull requests", () => {
    it("finds two threads, breaks a cycle, and sends lone changes and unlinked docs to the bottom row", async () => {
        const two = await reviewOf(twoThreads());
        const name = (id: string) => two.pins.find((x) => x.id === id)!.name;
        expect(two.bands.map((b) => b.entries.map(name))).toEqual([["parseOptions()"], ["renderOutput()"]]);
        expect(two.pins.filter((x) => x.kind === "context")).toEqual([]);
        expect(two.pins.find((x) => x.name === "padCells()")!.column).toBe(3);
        expect(two.links.filter((l) => l.kind === "calls").length).toBe(7);
        expect(two.links.filter((l) => l.kind === "tests").map((l) => `${name(l.from)} → ${name(l.to)}`)).toEqual([
            "options.test.ts → parseOptions()",
            "options.test.ts → normalizeFlag()",
            "render.test.ts → writeBanner()",
        ]);
        expect(two.pins.filter((x) => x.lane === "rest").map((x) => x.name)).toEqual(["writeBanner()", "README.md", "render.test.ts"]);
        expect(two.pins.find((x) => x.name === "options.test.ts")).toMatchObject({ lane: "under", band: 0 });
    });

    it("lays out whole files when it can't read enough declarations, docs and config linking to nothing", async () => {
        const docs = await small({}, { "README.md": "@@ -1,1 +1,3 @@\n-a\n+b\n+c\n+d", "package.json": "@@ -1,1 +1,1 @@\n-x\n+y" });
        expect(docs.mode).toBe("files");
        expect(docs.bands).toEqual([]);
        expect(docs.links).toEqual([]);
        expect(docs.pins.map((p) => p.name)).toEqual(["The pull request", "README.md", "package.json"]);
    });

    it("holds at most 32 cards, the PR card included, threads first, and counts the rest on the PR card", async () => {
        const many = await reviewOf(crowded());
        expect(many.pins).toHaveLength(LIMITS.cards);
        expect(many.pins.filter((x) => x.lane === "flow" && x.kind === "change")).toHaveLength(18);
        expect(many.pins.some((x) => x.path?.endsWith(".md"))).toBe(false);
        expect(many.unpinned).toEqual({ functions: 1, files: 16 });
        expect(many.links.every((l) => many.pins.some((p) => p.id === l.from) && many.pins.some((p) => p.id === l.to))).toBe(true);
    });

    it("leaves 29 of sixty functions off a board, and a dropped file on top of them", async () => {
        const review = await reviewOf(sixtyFunctions());
        expect(review.pins.length).toBeLessThanOrEqual(LIMITS.cards);
        expect(review.unpinned).toEqual({ functions: 29, files: 0 });
        expect((await reviewOf(sixtyFunctions(true))).unpinned).toEqual({ functions: 29, files: 1 });
    });

    it("keeps the cards nearest a thread's entry when the thread doesn't fit whole", async () => {
        const long = syntheticPr("feat: a long chain", [
            { path: "src/chain.ts", functions: Array.from({ length: 40 }, (_, i) => ({ name: `link${i}`, calls: i < 39 ? [`link${i + 1}`] : [], change: "changed" as const })) },
        ]);
        const review = await reviewOf(long);
        expect(review.pins).toHaveLength(LIMITS.cards);
        expect(review.pins.filter((p) => p.kind === "change").map((p) => p.name)).toEqual(Array.from({ length: 31 }, (_, i) => `link${i}()`));
        expect(review.unpinned).toEqual({ functions: 9, files: 0 });
    });

    it("keeps cards that share strings when a thread has more entries than the board has room", async () => {
        const star = syntheticPr("feat: forty callers of one helper", [
            {
                path: "src/star.ts",
                functions: [
                    ...Array.from({ length: 40 }, (_, i) => ({ name: `caller${i}`, calls: ["hub"], change: "changed" as const })),
                    { name: "hub", calls: ["leaf"], change: "changed" as const },
                    { name: "leaf", change: "changed" as const },
                ],
            },
        ]);
        const review = await reviewOf(star);
        expect(review.pins).toHaveLength(LIMITS.cards);
        expect(review.pins.map((p) => p.name)).toEqual(expect.arrayContaining(["hub()", "leaf()"]));
        expect(review.links).toHaveLength(30);
    });
});

describe("other languages", () => {
    it("draw calls between changed functions and imports from import lines, but no uses and no tests", async () => {
        const review = await small(
            {
                "app/run.py": "from .util import helper\n\ndef run(x):\n    value = helper(x)\n    return limit\n",
                "app/util.py": "limit = 3\n\ndef helper(x):\n    return x + limit\n",
            },
            {
                "app/run.py": "@@ -1,5 +1,5 @@\n from .util import helper\n \n def run(x):\n-    value = x\n+    value = helper(x)\n     return limit",
                "app/util.py": "@@ -1,4 +1,4 @@\n limit = 3\n \n def helper(x):\n-    return x\n+    return x + limit",
                "tests/test_run.py": "@@ -1,2 +1,3 @@\n from app.run import run\n+def test_run():\n+    assert run(1) == 2",
            }
        );
        expect(review.links.map((l) => `${l.kind} ${l.from} → ${l.to}`)).toEqual(["calls app/run.py:3 → app/util.py:3"]);
        expect(review.pins.find((p) => p.kind === "test")!.lane).toBe("rest");
    });
});

describe("a file added whole without its patch", () => {
    it("is read anyway: every line is new, so its declarations are cards and their calls link", async () => {
        const { pr } = honoFixture();
        const text = "pub struct Request {\n    id: u32,\n}\n\nimpl Request {\n    pub fn new(id: u32) -> Self {\n        Self::check(id);\n        Self { id }\n    }\n\n    fn check(id: u32) {}\n}\n";
        const files: PrFile[] = [{ path: "src/request.rs", status: "added", additions: 12, deletions: 0 }];
        const review = await reviewOf({ pr: { ...pr, changedFiles: 1 }, files, raw: new Map([["src/request.rs", text]]) });
        expect(review.files[0]).toMatchObject({ hasPatch: true });
        expect(review.files[0].hunks.flatMap((h) => h.lines).every((l) => l.t === "add")).toBe(true);
        expect(review.pins.filter((p) => p.kind === "change").map((p) => `${p.name} ${p.status}`)).toEqual(expect.arrayContaining(["Request::new() new", "Request::check() new"]));
        const name = (id: string) => review.pins.find((p) => p.id === id)!.name;
        expect(review.links.map((l) => `${l.kind} ${name(l.from)} → ${name(l.to)}`)).toEqual(["calls Request::new() → Request::check()"]);
    });
});

describe("the two Vite cases", () => {
    it("gives a line deleted right before a declaration to that declaration: no file card repeats it", async () => {
        const review = await small(
            { "src/asset.ts": "export const a = 2\n\n/** Doc. */\nexport function render(x: number) {\n  return x\n}\n" },
            { "src/asset.ts": "@@ -1,7 +1,6 @@\n-export const a = 1\n+export const a = 2\n \n-// old note\n /** Doc. */\n export function render(x: number) {\n-  return x + 1\n+  return x\n }" }
        );
        expect(review.pins.map((p) => p.name)).toEqual(["The pull request", "a", "render()"]);
        expect(review.pins.find((p) => p.name === "render()")).toMatchObject({ from: 3, del: 2, add: 1 });
    });

    it("names a change inside a multi-line import after the file's imports, with an imports string", async () => {
        const review = await small(
            {
                "src/css.ts": 'import {\n  first,\n  second,\n} from "./asset"\n\nexport function css() {\n  return first() + second()\n}\n',
                "src/asset.ts": "export function first() {\n  return 1\n}\n\nexport function second() {\n  return 2\n}\n",
            },
            {
                "src/css.ts": '@@ -1,8 +1,8 @@\n import {\n   first,\n-  third,\n+  second,\n } from "./asset"\n \n export function css() {\n-  return first() + third()\n+  return first() + second()',
                "src/asset.ts": "@@ -1,7 +1,7 @@\n export function first() {\n-  return 0\n+  return 1\n }\n \n export function second() {\n-  return 3\n+  return 2\n }",
            }
        );
        expect(review.pins.find((p) => p.kind === "file")!.name).toBe("css.ts imports");
        expect(review.links.filter((l) => l.from === "file:src/css.ts").map((l) => `${l.kind} → ${l.to}`)).toEqual(["imports → src/asset.ts:5"]);
    });
});
