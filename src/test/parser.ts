import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFacts } from "../lib/facts.ts";
import type { Parse } from "../lib/sources.ts";
import { createSyntax, type Grammar, type Syntax } from "../lib/syntax.ts";

/** The pinned wasm files, from the exact-version devDependencies: the bytes the driver downloads. */
export const WASM: Record<Grammar | "runtime", string> = {
    runtime: "web-tree-sitter/web-tree-sitter.wasm",
    typescript: "tree-sitter-typescript/tree-sitter-typescript.wasm",
    tsx: "tree-sitter-typescript/tree-sitter-tsx.wasm",
    javascript: "tree-sitter-javascript/tree-sitter-javascript.wasm",
};

export const wasmBytes = (name: Grammar | "runtime"): Uint8Array => new Uint8Array(readFileSync(join(import.meta.dirname, "../../node_modules", WASM[name])));

let syntax: Promise<Syntax> | null = null;

/** tree-sitter with every grammar loaded, once per process. */
export const testSyntax = (): Promise<Syntax> =>
    (syntax ??= (async () => {
        const s = await createSyntax(wasmBytes("runtime"));
        for (const g of ["typescript", "tsx", "javascript"] as const) await s.add(g, wasmBytes(g));
        return s;
    })());

export const testParse: Parse = async (path, text) => parseFacts(await testSyntax(), path, text);
