import { describe, expect, it } from "@jest/globals";
import { fakeFetch } from "../test/fake-fetch.ts";
import { fakeHost } from "../test/fake-host.ts";
import { createParser, languagesOf, PINS } from "./grammars.ts";

/** A host whose kv-storage keeps what it is given, as Drawdy's IndexedDB does. */
const storage = () => {
    const kept = new Map<string, unknown>();
    const host = fakeHost(undefined, {
        "command:kv-storage:get": (req) => (kept.has(req.key) ? { got: kept.get(req.key) } : {}),
        "command:kv-storage:set": (req) => void kept.set(req.key, req.payload),
    });
    return { host, kept };
};

const jsdelivr = (requests: string[]) => requests.filter((url) => url.startsWith("https://cdn.jsdelivr.net/"));

describe("the parser's files", () => {
    it("are pinned to exact versions on jsDelivr", () => {
        expect(Object.values(PINS).map((p) => p.url.replace("https://cdn.jsdelivr.net/npm/", ""))).toEqual([
            "web-tree-sitter@0.27.1/web-tree-sitter.wasm",
            "tree-sitter-typescript@0.23.2/tree-sitter-typescript.wasm",
            "tree-sitter-typescript@0.23.2/tree-sitter-tsx.wasm",
            "tree-sitter-javascript@0.25.0/tree-sitter-javascript.wasm",
        ]);
    });

    it("download once, say so once, and are kept: the next session reads storage and makes no request", async () => {
        const { host, kept } = storage();
        const net = fakeFetch("hono-5513.json");
        const parser = createParser({ ddp: host.ddp, fetch: net.fetch });
        let told = 0;
        await parser.load(["typescript"], () => told++);
        expect([told, jsdelivr(net.requests)]).toEqual([1, [PINS.runtime.url, PINS.typescript.url]]);
        expect([...kept.keys()]).toEqual(["wasm:runtime", "wasm:typescript"]);
        expect(kept.get("wasm:typescript")).toMatchObject({ sha256: PINS.typescript.sha256, blob: expect.any(Blob) });
        // The same session loads nothing again.
        await parser.load(["typescript"], () => told++);
        expect(told).toBe(1);
        // A new session, with no network at all.
        const offline = createParser({ ddp: host.ddp, fetch: async () => Promise.reject(new Error("offline")) });
        await offline.load(["typescript"], () => told++);
        expect(told).toBe(1);
        expect(await offline.parse(() => told++)("a.ts", "export const a = 1")).not.toBeNull();
    });

    it("fail in words on a failed download or a file that isn't its pin, and keep nothing", async () => {
        for (const broken of [
            async () => new Response("", { status: 503 }),
            async () => new Response(new Uint8Array([0, 97, 115, 109])),
        ]) {
            const { host, kept } = storage();
            const parser = createParser({ ddp: host.ddp, fetch: broken });
            await expect(parser.load(["typescript", "javascript"], () => undefined)).rejects.toThrow("Couldn't download the TypeScript and JavaScript parsers from cdn.jsdelivr.net. Try again.");
            expect(kept.size).toBe(0);
        }
    });

    it("download again when storage holds a copy that isn't the pin", async () => {
        const { host, kept } = storage();
        kept.set("wasm:runtime", { sha256: PINS.runtime.sha256, blob: new Blob([new Uint8Array([1, 2, 3])]) });
        const net = fakeFetch("hono-5513.json");
        await createParser({ ddp: host.ddp, fetch: net.fetch }).load(["javascript"], () => undefined);
        expect(jsdelivr(net.requests).sort()).toEqual([PINS.javascript.url, PINS.runtime.url]);
    });

    it("name the language in the reader's words", () => {
        expect([languagesOf(["typescript"]), languagesOf(["tsx", "javascript"]), languagesOf(["javascript"])]).toEqual([
            { parser: "TypeScript parser", code: "TypeScript" },
            { parser: "TypeScript and JavaScript parsers", code: "code" },
            { parser: "JavaScript parser", code: "JavaScript" },
        ]);
    });
});

describe("a parser that won't run", () => {
    it("fails in words, with nothing to try again for", async () => {
        const { host } = storage();
        const parser = createParser({ ddp: host.ddp, fetch: fakeFetch("hono-5513.json").fetch, start: async () => Promise.reject(new Error("CompileError")) });
        await expect(parser.load(["typescript"], () => undefined)).rejects.toThrow("Couldn't parse this pull request's TypeScript.");
    });
});
