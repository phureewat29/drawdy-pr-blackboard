import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Connect } from "../driver/parser.ts";
import { PACKS } from "../lib/langs/index.ts";
import { linkerOfGrammar, parseFile } from "../lib/linking.ts";
import type { Parse } from "../lib/sources.ts";
import { createSyntax, type Syntax } from "../lib/syntax.ts";
import { serve, type WorkerScope } from "../worker/serve.ts";

const GRAMMARS = PACKS.flatMap((p) => p.grammars ?? []);

/** The pinned wasm files, from the exact-version devDependencies: the bytes the driver downloads. */
export const WASM: Record<string, string> = { runtime: "web-tree-sitter/web-tree-sitter.wasm", ...Object.fromEntries(GRAMMARS.map((g) => [g.name, `${g.package}/${g.file}`])) };

export const wasmBytes = (name: string): Uint8Array => new Uint8Array(readFileSync(join(import.meta.dirname, "../../node_modules", WASM[name])));

let syntax: Promise<Syntax> | null = null;

/** tree-sitter with every grammar loaded, once per process. */
export const testSyntax = (): Promise<Syntax> =>
    (syntax ??= (async () => {
        const s = await createSyntax(wasmBytes("runtime"));
        for (const g of GRAMMARS) await s.add(g.name, wasmBytes(g.name), linkerOfGrammar(g.name));
        return s;
    })());

export const testParse: Parse = async (path, text) => parseFile(await testSyntax(), path, text);

/**
 * The parser worker served from its source on this thread, `start` standing in for tree-sitter's when given, each
 * message copied and delivered later, as a worker's would be.
 */
export const connectSourceWith =
    (start?: (runtime: Uint8Array) => Promise<Syntax>): Connect =>
    (receive) => {
        const scope: WorkerScope = {
            postMessage: (message) => {
                const copy = structuredClone(message);
                setTimeout(() => receive(copy));
            },
            onmessage: null,
        };
        serve(scope, start);
        return {
            post: (message) => {
                const copy = structuredClone(message);
                setTimeout(() => scope.onmessage?.({ data: copy }));
            },
        };
    };

/** The parser worker served from its source on this thread: what the tests and the score gate run in place of its script. */
export const connectSource: Connect = connectSourceWith();
