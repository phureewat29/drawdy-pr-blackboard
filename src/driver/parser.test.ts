import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { planBoard } from "../lib/layout.ts";
import { fakeFetch } from "../test/fake-fetch.ts";
import { fakeHost, keptStorage } from "../test/fake-host.ts";
import { excalidrawFixture, honoFixture, reviewOf } from "../test/fixture.ts";
import { connectSource } from "../test/parser.ts";
import { serve, unreadCount } from "../worker/serve.ts";
import type { PrFile } from "../lib/github.ts";
import { workerScriptFile, SCRIPT_FILE } from "../../scripts/worker.ts";
import { createParser, onThisThread, type Connect, type ParserProgress } from "./parser.ts";
import { quiet } from "./progress.ts";

const storage = () => fakeHost(undefined, keptStorage());

/** A built board as JSON, its plan's maps as entries. */
const json = (value: unknown) => JSON.stringify(value, (_key, v: unknown) => (Object.prototype.toString.call(v) === "[object Map]" ? [...(v as Map<unknown, unknown>)] : v));

/** What the parser tells the loading view, each in words. */
const told = () => {
    const seen: string[] = [];
    const progress: ParserProgress = {
        parser: (language, state) => void seen.push(`${language} ${state}`),
        reading: (paths, left) => void seen.push(`reading ${paths.join(" ")} · ${left} left`),
        read: (path, state) => void seen.push(`${path} ${state}`),
        followed: (files) => void seen.push(`followed ${files}`),
    };
    return { seen, progress };
};

const jsdelivr = (requests: string[]) => requests.filter((url) => url.startsWith("https://cdn.jsdelivr.net/")).length;

/** Each parser starts tree-sitter and compiles its grammars afresh. */
const SLOW = 30_000;

const code = (n: number, dir = "src"): PrFile[] => Array.from({ length: n }, (_, i) => ({ path: `${dir}/f${i}.ts`, status: "modified", additions: 3, deletions: 1, patch: "@@ -1 +1 @@" }));
const tests = (n: number): PrFile[] => Array.from({ length: n }, (_, i) => ({ path: `test/t${i}.test.ts`, status: "modified", additions: 2, deletions: 0, patch: "@@ -1 +1 @@" }));

describe("the read limits", () => {
    it("leave out past 40 code files and 40 test files, and count nothing they don't touch", () => {
        expect(unreadCount([...code(12), ...tests(3)])).toBe(0);
        expect(unreadCount([...code(45), ...tests(3)])).toBe(5);
        expect(unreadCount([...code(40, "a"), ...code(40, "b"), ...tests(44)])).toBe(44);
        // Docs and removed files were never to be read.
        expect(unreadCount([...code(40), { path: "README.md", status: "modified", additions: 1, deletions: 0, patch: "" }, { ...code(1, "gone")[0], status: "removed" }])).toBe(0);
    });
});

describe("the parser", () => {
    it("reads, parses and links on the worker's side: the review the tests build, and its board's plan", async () => {
        const { pr, files } = honoFixture();
        const net = fakeFetch("hono-5513.json");
        const { seen, progress } = told();
        const built = await createParser({ ddp: storage().ddp, fetch: net.fetch, connect: connectSource }).analyse(pr, files, progress);
        const local = await reviewOf(honoFixture());
        expect(built.review.links).toEqual(local.links);
        expect(built.review.order).toEqual(local.order);
        expect(json(built.plan)).toEqual(json(planBoard(local)));
        // TypeScript's parser downloads beside the reads, once: under way before the first file is parsed, and done.
        const rows = seen.filter((s) => s.startsWith("TypeScript"));
        expect(rows).toEqual(["TypeScript active", "TypeScript done"]);
        expect(seen.indexOf("TypeScript active")).toBeLessThan(seen.indexOf("src/compose.ts done"));
        // The changed files it reads whole, none left out by the read limits, then each as it is read and parsed, in that order: code, then tests.
        expect(seen.filter((s) => s.startsWith("reading"))).toEqual(["reading src/compose.ts src/hono-base.ts src/compose.test.ts src/hono.test.ts · 0 left"]);
        expect(seen.filter((s) => s.endsWith(" done") && s.startsWith("src/"))).toEqual(["src/compose.ts done", "src/hono-base.ts done", "src/compose.test.ts done", "src/hono.test.ts done"]);
        expect(jsdelivr(net.requests)).toBe(2);
    }, SLOW);

    it("keeps only what the board and Read all need: no diff of a file without a card", async () => {
        const { pr, files } = excalidrawFixture();
        const built = await createParser({ ddp: storage().ddp, fetch: fakeFetch("excalidraw-12237.json").fetch, connect: connectSource }).analyse(pr, files, quiet);
        const carded = new Set(built.review.pins.map((p) => p.path));
        expect(built.review.files.filter((f) => !carded.has(f.path)).every((f) => f.hunks.length === 0)).toBe(true);
        expect(built.review.files.filter((f) => carded.has(f.path)).every((f) => f.hunks.length > 0 || !f.hasPatch)).toBe(true);
    }, SLOW);

    it("fails in words when the parser's files can't be had, and then when the parser won't run", async () => {
        const { pr, files } = honoFixture();
        const net = fakeFetch("hono-5513.json");
        const down = async (url: string) => (url.startsWith("https://cdn.jsdelivr.net/") ? new Response("", { status: 503 }) : net.fetch(url));
        await expect(createParser({ ddp: storage().ddp, fetch: down, connect: connectSource }).analyse(pr, files, quiet)).rejects.toThrow(
            "Couldn't download the TypeScript parser from cdn.jsdelivr.net. Try again."
        );
        const wontRun = onThisThread((scope) => serve(scope, async () => Promise.reject(new Error("CompileError"))));
        await expect(createParser({ ddp: storage().ddp, fetch: net.fetch, connect: wontRun }).analyse(pr, files, quiet)).rejects.toThrow("Couldn't parse this PR's TypeScript.");
    }, SLOW);

    it("runs its script on this thread when the worker breaks, and builds the same board", async () => {
        const { pr, files } = honoFixture();
        let started = 0;
        const breaks: Connect = (_fetch, _receive, broken) => {
            started++;
            setTimeout(() => broken(new Error("no worker here")));
            return { post: () => undefined, close: () => undefined };
        };
        const built = await createParser({ ddp: storage().ddp, fetch: fakeFetch("hono-5513.json").fetch, connect: breaks }).analyse(pr, files, quiet);
        const source = await createParser({ ddp: storage().ddp, fetch: fakeFetch("hono-5513.json").fetch, connect: connectSource }).analyse(pr, files, quiet);
        expect(started).toBe(1);
        expect(json(built)).toEqual(json(source));
    }, SLOW);

    it("tells each changed file in reading order, one not found and one too long to use as such, and counts the other files read", async () => {
        const { pr, files } = honoFixture();
        const net = fakeFetch("hono-5513.json");
        const raw = "https://raw.githubusercontent.com/honojs/hono/";
        const odd = async (url: string) =>
            url.startsWith(raw) && url.endsWith("/src/hono-base.ts") ? new Response("", { status: 404 }) : url.startsWith(raw) && url.endsWith("/src/compose.ts") ? new Response("x".repeat(400_001)) : net.fetch(url);
        const { seen, progress } = told();
        await createParser({ ddp: storage().ddp, fetch: odd, connect: connectSource }).analyse(pr, files, progress);
        expect(seen.filter((s) => s.startsWith("src/"))).toEqual(["src/compose.ts long", "src/hono-base.ts missing", "src/compose.test.ts done", "src/hono.test.ts done"]);
        const followed = seen.filter((s) => s.startsWith("followed")).map((s) => Number(s.split(" ")[1]));
        expect(followed.length).toBeGreaterThan(0);
        expect(followed).toEqual(followed.map((_, i) => i + 1));
    }, SLOW);

    it("has a script that is current with its sources: npm run worker writes it", async () => {
        expect(readFileSync(SCRIPT_FILE, "utf8") === (await workerScriptFile())).toBe(true);
    }, SLOW);
});
