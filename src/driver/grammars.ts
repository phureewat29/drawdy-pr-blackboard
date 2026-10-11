/**
 * The parser's files: the tree-sitter runtime and the grammars a pull
 * request needs, downloaded once from jsDelivr at pinned versions and kept
 * in kv-storage, each checked against the SHA-256 written here before it
 * reaches WebAssembly. Only the driver reaches kv-storage, so the parser
 * worker asks it for them (`parser.ts`).
 */

import type { Fetch } from "../lib/github.ts";
import * as g from "../lib/guard.ts";
import { sha256 } from "../lib/sha256.ts";
import type { Grammar } from "../lib/syntax.ts";
import type { ParserFile } from "../worker/serve.ts";
import type { Ddp } from "./ddp.ts";
import { inWords } from "./words.ts";

const CDN = "https://cdn.jsdelivr.net/npm/";

/** Every file the parser needs, at the version the tests and the score gate ran. */
export const PINS = {
    runtime: { url: `${CDN}web-tree-sitter@0.27.1/web-tree-sitter.wasm`, sha256: "beca80e44cccbf2299ed4d1e3fa6462a9a6fe818aeebf847547a392227ce4acc" },
    typescript: { url: `${CDN}tree-sitter-typescript@0.23.2/tree-sitter-typescript.wasm`, sha256: "778025db5a8be0e70f8ccc3671e486dfeddd048c25d9e8a70c26de2e1bf6f97d" },
    tsx: { url: `${CDN}tree-sitter-typescript@0.23.2/tree-sitter-tsx.wasm`, sha256: "79e5da75ea62855a0cd67177685f0164eac87d5f630b3cbe1e0a099751ad30f8" },
    javascript: { url: `${CDN}tree-sitter-javascript@0.25.0/tree-sitter-javascript.wasm`, sha256: "5fb488d0cabb4775a594bab85682de5ad6ce83c0d6ac997a9f82dd084d571240" },
} as const satisfies Record<ParserFile, { url: string; sha256: string }>;

const stored = g.object({ sha256: g.string, blob: g.instanceOf(Blob) });

/** What the reader is told a download or a failure is about: `TypeScript`, `JavaScript`, or both. */
export const languagesOf = (grammars: readonly Grammar[]): { parser: string; code: string } => {
    const ts = grammars.some((x) => x !== "javascript");
    const js = grammars.includes("javascript");
    if (ts && js) return { parser: "TypeScript and JavaScript parsers", code: "code" };
    return js ? { parser: "JavaScript parser", code: "JavaScript" } : { parser: "TypeScript parser", code: "TypeScript" };
};

export type Grammars = {
    /**
     * A file's checked bytes: from storage, else from jsDelivr, calling
     * `downloading` before the first byte comes over the network. `words`
     * name what failed (`TypeScript parser`). Rejects in words; a failure is
     * forgotten, so the next open tries again.
     */
    bytes: (name: ParserFile, words: string, downloading: () => void) => Promise<Uint8Array>;
};

export const createGrammars = (deps: { ddp: Ddp; fetch: Fetch }): Grammars => {
    const { ddp, fetch } = deps;
    // The files this session has checked.
    const checked = new Map<ParserFile, Promise<Uint8Array>>();

    const fromStorage = async (name: ParserFile): Promise<Uint8Array | null> => {
        const got = g.parse(stored, (await ddp.tryCall("command:kv-storage:get", { key: `wasm:${name}` }))?.got);
        if (!got || got.sha256 !== PINS[name].sha256) return null;
        const data = new Uint8Array(await got.blob.arrayBuffer());
        return sha256(data) === PINS[name].sha256 ? data : null;
    };
    const download = async (name: ParserFile, words: string): Promise<Uint8Array> => {
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

    return {
        bytes: (name, words, downloading) => {
            let hit = checked.get(name);
            if (!hit) {
                hit = fromStorage(name).then((data) => {
                    if (data) return data;
                    downloading();
                    return download(name, words);
                });
                hit.catch(() => checked.delete(name));
                checked.set(name, hit);
            }
            return hit;
        },
    };
};
