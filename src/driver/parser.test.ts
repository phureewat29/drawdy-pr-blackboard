import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { planBoard } from "../lib/layout.ts";
import { fakeFetch } from "../test/fake-fetch.ts";
import { fakeHost } from "../test/fake-host.ts";
import { excalidrawFixture, honoFixture, reviewOf } from "../test/fixture.ts";
import { connectSource } from "../test/parser.ts";
import { serve } from "../worker/serve.ts";
import { workerScriptFile, SCRIPT_FILE } from "../../scripts/worker.ts";
import { createParser, onThisThread, type Connect } from "./parser.ts";

/** A host whose kv-storage keeps what it is given. */
const storage = () => {
    const kept = new Map<string, unknown>();
    return fakeHost(undefined, {
        "command:kv-storage:get": (req) => (kept.has(req.key) ? { got: kept.get(req.key) } : {}),
        "command:kv-storage:set": (req) => void kept.set(req.key, req.payload),
    });
};

/** A built board as JSON, its plan's maps as entries. */
const json = (value: unknown) => JSON.stringify(value, (_key, v: unknown) => (Object.prototype.toString.call(v) === "[object Map]" ? [...(v as Map<unknown, unknown>)] : v));

const steps = () => {
    const seen: string[] = [];
    return { seen, step: (state: string, words?: { label: string; note: string }) => seen.push(words ? `${state} ${words.label} · ${words.note}` : state) };
};

const jsdelivr = (requests: string[]) => requests.filter((url) => url.startsWith("https://cdn.jsdelivr.net/")).length;

/** Each parser starts tree-sitter and compiles its grammars afresh. */
const SLOW = 30_000;

describe("the parser", () => {
    it("reads, parses and links on the worker's side: the review the tests build, and its board's plan", async () => {
        const { pr, files } = honoFixture();
        const net = fakeFetch("hono-5513.json");
        const { seen, step } = steps();
        const built = await createParser({ ddp: storage().ddp, fetch: net.fetch, connect: connectSource }).analyse(pr, files, step);
        const local = await reviewOf(honoFixture());
        expect(built.review.links).toEqual(local.links);
        expect(built.review.order).toEqual(local.order);
        expect(json(built.plan)).toEqual(json(planBoard(local)));
        // It says once that it downloads the parser, beside the reads, then that the download is done.
        expect(seen).toEqual(["active Downloading the TypeScript parser · first time only", "done"]);
        expect(jsdelivr(net.requests)).toBe(2);
    }, SLOW);

    it("keeps only what the board and Read all need: no diff of a file without a card", async () => {
        const { pr, files } = excalidrawFixture();
        const built = await createParser({ ddp: storage().ddp, fetch: fakeFetch("excalidraw-12237.json").fetch, connect: connectSource }).analyse(pr, files, () => undefined);
        const carded = new Set(built.review.pins.map((p) => p.path));
        expect(built.review.files.filter((f) => !carded.has(f.path)).every((f) => f.hunks.length === 0)).toBe(true);
        expect(built.review.files.filter((f) => carded.has(f.path)).every((f) => f.hunks.length > 0 || !f.hasPatch)).toBe(true);
    }, SLOW);

    it("fails in words when the parser's files can't be had, and then when the parser won't run", async () => {
        const { pr, files } = honoFixture();
        const net = fakeFetch("hono-5513.json");
        const down = async (url: string) => (url.startsWith("https://cdn.jsdelivr.net/") ? new Response("", { status: 503 }) : net.fetch(url));
        await expect(createParser({ ddp: storage().ddp, fetch: down, connect: connectSource }).analyse(pr, files, () => undefined)).rejects.toThrow(
            "Couldn't download the TypeScript parser from cdn.jsdelivr.net. Try again."
        );
        const wontRun = onThisThread((scope) => serve(scope, async () => Promise.reject(new Error("CompileError"))));
        await expect(createParser({ ddp: storage().ddp, fetch: net.fetch, connect: wontRun }).analyse(pr, files, () => undefined)).rejects.toThrow("Couldn't parse this pull request's TypeScript.");
    }, SLOW);

    it("runs its script on this thread when the worker breaks, and builds the same board", async () => {
        const { pr, files } = honoFixture();
        let started = 0;
        const breaks: Connect = (_fetch, _receive, broken) => {
            started++;
            setTimeout(() => broken(new Error("no worker here")));
            return { post: () => undefined, close: () => undefined };
        };
        const built = await createParser({ ddp: storage().ddp, fetch: fakeFetch("hono-5513.json").fetch, connect: breaks }).analyse(pr, files, () => undefined);
        const source = await createParser({ ddp: storage().ddp, fetch: fakeFetch("hono-5513.json").fetch, connect: connectSource }).analyse(pr, files, () => undefined);
        expect(started).toBe(1);
        expect(json(built)).toEqual(json(source));
    }, SLOW);

    it("has a script that is current with its sources: npm run worker writes it", async () => {
        expect(readFileSync(SCRIPT_FILE, "utf8") === (await workerScriptFile())).toBe(true);
    }, SLOW);
});
