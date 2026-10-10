/**
 * tree-sitter for the driver: the runtime and the grammars a pull request
 * needs, downloaded once from jsDelivr at pinned versions and kept in
 * kv-storage, each checked against the SHA-256 written here before it
 * reaches WebAssembly. The driver parses, not the panel, so the board works
 * with the panel closed.
 */

import { parseFacts } from "../lib/facts.ts";
import type { Fetch } from "../lib/github.ts";
import { sha256 } from "../lib/sha256.ts";
import type { Parse } from "../lib/sources.ts";
import { createSyntax, grammarOf, type Grammar, type Syntax } from "../lib/syntax.ts";
import * as g from "../lib/guard.ts";
import type { Ddp } from "./ddp.ts";
import { inWords, isInWords } from "./words.ts";

const CDN = "https://cdn.jsdelivr.net/npm/";

/** Every file the parser needs, at the version the tests and the score gate ran. */
export const PINS = {
    runtime: { url: `${CDN}web-tree-sitter@0.27.1/web-tree-sitter.wasm`, sha256: "beca80e44cccbf2299ed4d1e3fa6462a9a6fe818aeebf847547a392227ce4acc" },
    typescript: { url: `${CDN}tree-sitter-typescript@0.23.2/tree-sitter-typescript.wasm`, sha256: "778025db5a8be0e70f8ccc3671e486dfeddd048c25d9e8a70c26de2e1bf6f97d" },
    tsx: { url: `${CDN}tree-sitter-typescript@0.23.2/tree-sitter-tsx.wasm`, sha256: "79e5da75ea62855a0cd67177685f0164eac87d5f630b3cbe1e0a099751ad30f8" },
    javascript: { url: `${CDN}tree-sitter-javascript@0.25.0/tree-sitter-javascript.wasm`, sha256: "5fb488d0cabb4775a594bab85682de5ad6ce83c0d6ac997a9f82dd084d571240" },
} as const;

type FileName = keyof typeof PINS;

const stored = g.object({ sha256: g.string, blob: g.instanceOf(Blob) });

/** What the reader is told a download or a failure is about: `TypeScript`, `JavaScript`, or both. */
export const languagesOf = (grammars: readonly Grammar[]): { parser: string; code: string } => {
    const ts = grammars.some((x) => x !== "javascript");
    const js = grammars.includes("javascript");
    if (ts && js) return { parser: "TypeScript and JavaScript parsers", code: "code" };
    return js ? { parser: "JavaScript parser", code: "JavaScript" } : { parser: "TypeScript parser", code: "TypeScript" };
};

export type Parser = {
    /**
     * Loads the runtime and `grammars`, from storage or jsDelivr. Calls
     * `downloading` once, before the first byte comes over the network.
     * Rejects in words.
     */
    load: (grammars: readonly Grammar[], downloading: () => void) => Promise<void>;
    /** Parses a file, loading its grammar first when an import needs one not loaded yet. */
    parse: (downloading: () => void) => Parse;
};

/** `start` starts tree-sitter from the runtime's bytes; the tests stand in a failing one. */
export const createParser = (deps: { ddp: Ddp; fetch: Fetch; start?: (runtime: Uint8Array) => Promise<Syntax> }): Parser => {
    const { ddp, fetch, start = createSyntax } = deps;
    // What this session has loaded: the files' bytes once checked, and the runtime started.
    const bytes = new Map<FileName, Promise<Uint8Array>>();
    let syntax: Promise<Syntax> | null = null;
    const added = new Map<Grammar, Promise<void>>();

    const fromStorage = async (name: FileName): Promise<Uint8Array | null> => {
        const got = g.parse(stored, (await ddp.tryCall("command:kv-storage:get", { key: `wasm:${name}` }))?.got);
        if (!got || got.sha256 !== PINS[name].sha256) return null;
        const data = new Uint8Array(await got.blob.arrayBuffer());
        return sha256(data) === PINS[name].sha256 ? data : null;
    };
    const download = async (name: FileName, words: string): Promise<Uint8Array> => {
        const failed = inWords(`Couldn't download the ${words} from cdn.jsdelivr.net. Try again.`);
        let res: Response;
        try {
            res = await fetch(PINS[name].url);
        } catch (err) {
            console.warn(`[pr-blackboard] ${PINS[name].url}: ${err instanceof Error ? err.message : String(err)}`);
            throw failed;
        }
        if (!res.ok) {
            console.warn(`[pr-blackboard] ${PINS[name].url}: HTTP ${res.status}`);
            throw failed;
        }
        const data = new Uint8Array(await res.arrayBuffer());
        const got = sha256(data);
        if (got !== PINS[name].sha256) {
            console.warn(`[pr-blackboard] ${PINS[name].url}: SHA-256 ${got}, pinned ${PINS[name].sha256}`);
            throw failed;
        }
        await ddp.tryCall("command:kv-storage:set", { key: `wasm:${name}`, payload: { sha256: got, blob: new Blob([data]) } });
        return data;
    };
    /** A file's checked bytes; a failure is forgotten, so the next open tries again. */
    const bytesOf = (name: FileName, words: string, downloading: () => void): Promise<Uint8Array> => {
        let hit = bytes.get(name);
        if (!hit) {
            hit = fromStorage(name).then((data) => {
                if (data) return data;
                downloading();
                return download(name, words);
            });
            hit.catch(() => bytes.delete(name));
            bytes.set(name, hit);
        }
        return hit;
    };
    const failure = (grammars: readonly Grammar[], err: unknown) => {
        if (isInWords(err)) return err;
        console.error("[pr-blackboard] the parser won't run", err);
        return inWords(`Couldn't parse this pull request's ${languagesOf(grammars).code}.`);
    };

    const load = async (grammars: readonly Grammar[], downloading: () => void) => {
        const words = languagesOf(grammars).parser;
        let told = false;
        const tell = () => {
            if (told) return;
            told = true;
            downloading();
        };
        try {
            const runtime = bytesOf("runtime", words, tell);
            const files = grammars.map((name) => bytesOf(name, words, tell));
            if (!syntax) {
                syntax = runtime.then(start);
                syntax.catch(() => (syntax = null));
            }
            const s = await syntax;
            await Promise.all(
                grammars.map(async (name, i) => {
                    let hit = added.get(name);
                    if (!hit) {
                        hit = files[i].then((data) => s.add(name, data));
                        hit.catch(() => added.delete(name));
                        added.set(name, hit);
                    }
                    await hit;
                })
            );
        } catch (err) {
            throw failure(grammars, err);
        }
    };

    const parse = (downloading: () => void): Parse => async (path, text) => {
        const grammar = grammarOf(path);
        if (!grammar) return null;
        await load([grammar], downloading);
        const s = await syntax!;
        try {
            return parseFacts(s, path, text);
        } catch (err) {
            // One file the parser can't read falls back to the line patterns.
            console.warn(`[pr-blackboard] couldn't parse ${path}`, err);
            return null;
        }
    };

    return { load, parse };
};
