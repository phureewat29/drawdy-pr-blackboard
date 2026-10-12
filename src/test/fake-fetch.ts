import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PINS } from "../driver/grammars.ts";
import { readSaved } from "./fixture.ts";
import { WASM } from "./parser.ts";

/**
 * GitHub and jsDelivr for a PR saved in the fixtures' shape (`readSaved`): the API's two answers,
 * raw.githubusercontent.com from its `raw`, every other path a 404, and the pinned wasm files from the exact-version
 * devDependencies. Records every URL asked for; any other host fails.
 */
export const fakeFetch = (file: string) => {
    const saved = readSaved(file);
    const requests: string[] = [];
    const raw = `https://raw.githubusercontent.com/${saved.pull.head.repo.full_name}/${saved.pull.head.sha}/`;
    const wasm = new Map(Object.entries(PINS).map(([name, pin]) => [pin.url as string, join(import.meta.dirname, "../../node_modules", WASM[name as keyof typeof WASM])]));
    const fetch = async (url: string): Promise<Response> => {
        requests.push(url);
        if (url.startsWith(raw)) {
            const text = saved.raw[decodeURIComponent(url.slice(raw.length))];
            return text === undefined ? new Response("", { status: 404 }) : new Response(text);
        }
        const pin = wasm.get(url);
        if (pin) return new Response(readFileSync(pin));
        const api = /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/pulls\/\d+(\/files\?per_page=100&page=(\d+))?$/.exec(url);
        if (api?.[2]) return new Response(JSON.stringify(saved.files.slice((Number(api[2]) - 1) * 100, Number(api[2]) * 100)), { headers: { "x-ratelimit-remaining": "58" } });
        if (api) return new Response(JSON.stringify(saved.pull), { headers: { "x-ratelimit-remaining": "59" } });
        throw new Error(`fetch outside GitHub and jsDelivr: ${url}`);
    };
    return { fetch, requests };
};
