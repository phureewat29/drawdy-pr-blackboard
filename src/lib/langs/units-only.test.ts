import { describe, expect, it } from "@jest/globals";
import { testParse } from "../../test/parser.ts";
import type { PrFile, PrInfo } from "../github.ts";
import { analyse, readAndLink } from "../model.ts";

const pr: PrInfo = {
    ref: { owner: "o", repo: "r", number: 1 },
    url: "https://github.com/o/r/pull/1",
    title: "Cards, no lines",
    body: "",
    author: "a",
    state: "open",
    headSha: "h",
    headRepo: "o/r",
    additions: 0,
    deletions: 0,
    changedFiles: 0,
};

/** Each file's head text, and a patch that adds it whole. */
const added = (files: Record<string, string>): PrFile[] =>
    Object.entries(files).map(([path, text]) => {
        const lines = text.replace(/\n$/, "").split("\n");
        return { path, status: "added", additions: lines.length, deletions: 0, patch: `@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}` };
    });

/** In each language, `run` calls `helper` in its own file; Python's `app.py` calls a `helper` of its own and imports a name the Kotlin file defines. */
const FILES: Record<string, string> = {
    "app/app.py": "from util import helper\n\ndef run():\n    return helper()\n\ndef other():\n    return run()\n",
    "app/util.py": "def helper():\n    return 1\n",
    "src/main/kotlin/Client.kt": "package app\n\nfun helper(): Int = 1\n\nfun run(): Int = helper()\n",
    "src/net.c": "static int helper(void)\n{\n    return 1;\n}\n\nint run(void)\n{\n    return helper();\n}\n",
    "src/wallet.cpp": "namespace wallet {\nint helper() { return 1; }\n\nint run() { return helper(); }\n}\n",
    "src/Main.scala": "object Main:\n  def helper(): Int = 1\n\n  def run(): Int = helper()\n",
    "src/Plan.hs": "module Plan where\n\nhelper :: Int\nhelper = 1\n\nrun :: Int\nrun = helper + 1\n",
};

const UNITS_ONLY = /\.(kt|cpp|scala|hs)$/;

describe("A language read for its units alone", () => {
    it("resolves no name in its files, and no other language's name resolves into them", async () => {
        const read = async (path: string) => FILES[path] ?? null;
        const files = added(FILES);
        const { refs, facts } = await readAndLink(pr, files, read, testParse);
        for (const path of Object.keys(FILES).filter((p) => UNITS_ONLY.test(p))) expect([path, facts.get(path)?.units.map((u) => u.name)]).toEqual([path, path.endsWith(".scala") ? ["Main", "helper", "run"] : ["helper", "run"]]);
        expect(refs.filter((r) => UNITS_ONLY.test(r.path) || r.units.some((u) => UNITS_ONLY.test(u.path)))).toEqual([]);
        // C draws its lines now: `run` calls the `static` helper of its own file.
        expect(refs.filter((r) => r.path === "src/net.c").map((r) => `${r.line} ${r.ref} ${r.units[0].name}`)).toEqual(["8 call helper"]);
        // Python's links stand as before.
        expect(refs.filter((r) => r.path === "app/app.py" && r.ref === "call").map((r) => `${r.line} ${r.units[0].path}:${r.units[0].name}`)).toEqual(["4 app/util.py:helper", "7 app/app.py:run"]);
    });

    it("gives each changed declaration a card and draws no line from or to one", async () => {
        const read = async (path: string) => FILES[path] ?? null;
        const { review } = await analyse(pr, added(FILES), read, testParse);
        const cards = review.pins.filter((p) => p.path && UNITS_ONLY.test(p.path)).map((p) => `${p.path} ${p.name}`);
        expect(cards).toEqual([
            "src/main/kotlin/Client.kt helper()",
            "src/main/kotlin/Client.kt run()",
            "src/wallet.cpp helper()",
            "src/wallet.cpp run()",
            "src/Main.scala object Main",
            "src/Main.scala Main.helper()",
            "src/Main.scala Main.run()",
            "src/Plan.hs helper",
            "src/Plan.hs run",
            "src/main/kotlin/Client.kt Client.kt, other lines",
            "src/wallet.cpp wallet.cpp, other lines",
            "src/Plan.hs Plan.hs, other lines",
        ]);
        const onUnitsOnly = new Set(review.pins.filter((p) => p.path && UNITS_ONLY.test(p.path)).map((p) => p.id));
        expect(review.links.filter((l) => onUnitsOnly.has(l.from) || onUnitsOnly.has(l.to))).toEqual([]);
        expect(review.links.length).toBeGreaterThan(0);
    });

    it("reads no test file of its own, which would link nothing, and names its cases from its diff", async () => {
        const test = { "okhttp/src/jvmTest/kotlin/okhttp3/CallTest.kt": "class CallTest {\n  @Test\n  fun headersCanBeLarge() {\n  }\n}\n" };
        const asked: string[] = [];
        const read = async (path: string) => (asked.push(path), { ...FILES, ...test }[path] ?? null);
        const { review } = await analyse(pr, added({ "src/main/kotlin/Client.kt": FILES["src/main/kotlin/Client.kt"], ...test }), read, testParse);
        expect(asked).toEqual(["src/main/kotlin/Client.kt"]);
        expect(review.pins.filter((p) => p.kind === "test").map((p) => p.name)).toEqual(["CallTest.kt"]);
        expect(review.files.find((f) => f.role === "test")!.cases.map((c) => c.name)).toEqual(["headersCanBeLarge"]);
    });
});
