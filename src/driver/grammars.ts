/**
 * The parser's files: the tree-sitter runtime and the grammars a PR needs, downloaded once from jsDelivr at pinned
 * versions and kept in kv-storage, each checked against the SHA-256 written here before it reaches WebAssembly.
 * Only the driver reaches kv-storage, so the parser worker asks it for them (`parser.ts`).
 */

import type { Fetch } from "../lib/github.ts";
import * as g from "../lib/guard.ts";
import { PACKS } from "../lib/langs/index.ts";
import { packOfGrammar } from "../lib/language.ts";
import { sha256 } from "../lib/sha256.ts";
import type { ParserFile } from "../worker/serve.ts";
import type { Ddp } from "./ddp.ts";
import { inWords } from "./words.ts";

const CDN = "https://cdn.jsdelivr.net/npm/";

/** Every file the parser needs, at the version the tests and the score gate ran: the tree-sitter runtime, then each pack's grammars (`langs/`). */
export const PINS: Record<ParserFile, { url: string; sha256: string }> = {
    runtime: { url: `${CDN}web-tree-sitter@0.27.1/web-tree-sitter.wasm`, sha256: "beca80e44cccbf2299ed4d1e3fa6462a9a6fe818aeebf847547a392227ce4acc" },
    ...Object.fromEntries(PACKS.flatMap((p) => p.grammars ?? []).map((x) => [x.name, { url: `${CDN}${x.package}@${x.version}/${x.file}`, sha256: x.sha256 }])),
};

const stored = g.object({ sha256: g.string, blob: g.instanceOf(Blob) });

/** The languages that have grammars, in the order the reader is told them. */
const ORDER = PACKS.filter((p) => p.grammars).map((p) => p.name);

/** What the reader is told a download or a failure is about: `TypeScript parser`, `Python and Go parsers`; one language's code by its name. */
export const languagesOf = (grammars: readonly string[]): { parser: string; code: string } => {
    const names = ORDER.filter((name) => grammars.some((g) => packOfGrammar(g)?.name === name));
    if (names.length === 0) return { parser: "parser", code: "code" };
    if (names.length === 1) return { parser: `${names[0]} parser`, code: names[0] };
    return { parser: `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} parsers`, code: "code" };
};

export type Grammars = {
    /**
     * A file's checked bytes: from storage, else from jsDelivr, calling `downloading` before it downloads. `words` name what failed
     * (`TypeScript parser`). Rejects in words; a failure is forgotten, so the next open tries again.
     */
    bytes: (name: ParserFile, words: string, downloading: () => void) => Promise<Uint8Array>;
};

export const createGrammars = (deps: { ddp: Ddp; fetch: Fetch }): Grammars => {
    const { ddp, fetch } = deps;
    const checked = new Map<ParserFile, Promise<Uint8Array>>();

    const fromStorage = async (name: ParserFile): Promise<Uint8Array | null> => {
        const got = g.parse(stored, (await ddp.tryCall("command:kv-storage:get", { key: `wasm:${name}` }))?.got);
        if (!got || got.sha256 !== PINS[name].sha256) return null;
        const data = new Uint8Array(await got.blob.arrayBuffer());
        return sha256(data) === PINS[name].sha256 ? data : null;
    };
    const download = async (name: ParserFile, words: string): Promise<Uint8Array> => {
        const { url, sha256: pinned } = PINS[name];
        const failed = (why: string) => {
            console.warn(`[pr-blackboard] ${url}: ${why}`);
            return inWords(`Couldn't download the ${words} from cdn.jsdelivr.net. Try again.`);
        };
        let res: Response;
        try {
            res = await fetch(url);
        } catch (err) {
            throw failed(err instanceof Error ? err.message : String(err));
        }
        if (!res.ok) throw failed(`HTTP ${res.status}`);
        const data = new Uint8Array(await res.arrayBuffer());
        const got = sha256(data);
        if (got !== pinned) throw failed(`SHA-256 ${got}, pinned ${pinned}`);
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
