import { describe, expect, it } from "@jest/globals";
import { fakeFetch } from "../test/fake-fetch.ts";
import { fakeHost, keptStorage } from "../test/fake-host.ts";
import { wasmBytes } from "../test/parser.ts";
import { createGrammars, languagesOf, PINS } from "./grammars.ts";

const storage = () => {
    const kept = new Map<string, unknown>();
    return { host: fakeHost(undefined, keptStorage(kept)), kept };
};

const jsdelivr = (requests: string[]) => requests.filter((url) => url.startsWith("https://cdn.jsdelivr.net/"));

describe("the parser's files", () => {
    it("are pinned to exact versions on jsDelivr", () => {
        expect(Object.values(PINS).map((p) => p.url.replace("https://cdn.jsdelivr.net/npm/", ""))).toEqual([
            "web-tree-sitter@0.27.1/web-tree-sitter.wasm",
            "tree-sitter-typescript@0.23.2/tree-sitter-typescript.wasm",
            "tree-sitter-typescript@0.23.2/tree-sitter-tsx.wasm",
            "tree-sitter-javascript@0.25.0/tree-sitter-javascript.wasm",
            "tree-sitter-python@0.25.0/tree-sitter-python.wasm",
            "tree-sitter-go@0.25.0/tree-sitter-go.wasm",
            "tree-sitter-rust@0.24.0/tree-sitter-rust.wasm",
            "tree-sitter-java@0.23.5/tree-sitter-java.wasm",
            "tree-sitter-clojure-orchard@0.2.8/tree-sitter-clojure_orchard.wasm",
            "tree-sitter-elixir@0.3.5/tree-sitter-elixir.wasm",
            "@tree-sitter-grammars/tree-sitter-kotlin@1.1.0/tree-sitter-kotlin.wasm",
            "tree-sitter-php@0.24.2/tree-sitter-php.wasm",
            "tree-sitter-c-sharp@0.23.5/tree-sitter-c_sharp.wasm",
            "tree-sitter-c@0.24.1/tree-sitter-c.wasm",
            "tree-sitter-cpp@0.23.4/tree-sitter-cpp.wasm",
            "tree-sitter-scala@0.24.0/tree-sitter-scala.wasm",
            "tree-sitter-haskell@0.23.1/tree-sitter-haskell.wasm",
        ]);
    });

    it("download once each, saying so first, and are kept: the next session reads storage and makes no request", async () => {
        const { host, kept } = storage();
        const net = fakeFetch("hono-5513.json");
        const grammars = createGrammars({ ddp: host.ddp, fetch: net.fetch });
        let told = 0;
        const runtime = await grammars.bytes("runtime", "TypeScript parser", () => told++);
        await grammars.bytes("typescript", "TypeScript parser", () => told++);
        expect([told, jsdelivr(net.requests)]).toEqual([2, [PINS.runtime.url, PINS.typescript.url]]);
        expect([...kept.keys()]).toEqual(["wasm:runtime", "wasm:typescript"]);
        expect(kept.get("wasm:typescript")).toMatchObject({ sha256: PINS.typescript.sha256, blob: expect.any(Blob) });
        expect(runtime).toEqual(wasmBytes("runtime"));
        // The same session loads nothing again.
        await grammars.bytes("typescript", "TypeScript parser", () => told++);
        expect(told).toBe(2);
        // A new session, with no network at all.
        const offline = createGrammars({ ddp: host.ddp, fetch: async () => Promise.reject(new Error("offline")) });
        expect(await offline.bytes("typescript", "TypeScript parser", () => told++)).toEqual(wasmBytes("typescript"));
        expect(told).toBe(2);
    });

    it("fail in words on a failed download or a file that isn't its pin, keep nothing, and are tried again next time", async () => {
        for (const broken of [async () => new Response("", { status: 503 }), async () => new Response(new Uint8Array([0, 97, 115, 109]))]) {
            const { host, kept } = storage();
            const grammars = createGrammars({ ddp: host.ddp, fetch: broken });
            await expect(grammars.bytes("javascript", "TypeScript and JavaScript parsers", () => undefined)).rejects.toThrow(
                "Couldn't download the TypeScript and JavaScript parsers from cdn.jsdelivr.net. Try again."
            );
            expect(kept.size).toBe(0);
        }
        const { host } = storage();
        let fail = true;
        const net = fakeFetch("hono-5513.json");
        const grammars = createGrammars({ ddp: host.ddp, fetch: async (url) => (fail ? new Response("", { status: 503 }) : net.fetch(url)) });
        await expect(grammars.bytes("runtime", "TypeScript parser", () => undefined)).rejects.toThrow("Couldn't download");
        fail = false;
        expect(await grammars.bytes("runtime", "TypeScript parser", () => undefined)).toEqual(wasmBytes("runtime"));
    });

    it("download again when storage holds a copy that isn't the pin", async () => {
        const { host, kept } = storage();
        kept.set("wasm:runtime", { sha256: PINS.runtime.sha256, blob: new Blob([new Uint8Array([1, 2, 3])]) });
        const net = fakeFetch("hono-5513.json");
        await createGrammars({ ddp: host.ddp, fetch: net.fetch }).bytes("runtime", "JavaScript parser", () => undefined);
        expect(jsdelivr(net.requests)).toEqual([PINS.runtime.url]);
    });

    it("name the language in the reader's words", () => {
        expect([languagesOf(["typescript"]), languagesOf(["tsx", "javascript"]), languagesOf(["javascript"]), languagesOf(["rust", "python", "go"]), languagesOf(["go"]), languagesOf(["java"]), languagesOf(["java", "typescript"])]).toEqual([
            { parser: "TypeScript parser", code: "TypeScript" },
            { parser: "TypeScript and JavaScript parsers", code: "code" },
            { parser: "JavaScript parser", code: "JavaScript" },
            { parser: "Python, Go and Rust parsers", code: "code" },
            { parser: "Go parser", code: "Go" },
            { parser: "Java parser", code: "Java" },
            { parser: "TypeScript and Java parsers", code: "code" },
        ]);
    });
});
