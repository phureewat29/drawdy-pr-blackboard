import { describe, expect, it } from "@jest/globals";
import { createGithub } from "../lib/github.ts";
import { fakeFetch } from "../test/fake-fetch.ts";
import { fakeHost } from "../test/fake-host.ts";
import { createParser } from "./grammars.ts";
import { loadReview, type LoadStep } from "./open.ts";
import { createStore } from "./store.ts";

const HONO = { owner: "honojs", repo: "hono", number: 5513 };

/** loadReview on hono#5513 through a fake fetch, with a kv-storage that keeps what it is given. */
const setup = (fetch = fakeFetch("hono-5513.json")) => {
    const kept = new Map<string, unknown>();
    const host = fakeHost(undefined, {
        "command:kv-storage:get": (req) => (kept.has(req.key) ? { got: kept.get(req.key) } : {}),
        "command:kv-storage:set": (req) => void kept.set(req.key, req.payload),
    });
    const deps = (net = fetch.fetch) => ({ github: createGithub(net), store: createStore(host.ddp), parser: createParser({ ddp: host.ddp, fetch: net }) });
    const steps: string[] = [];
    const progress = (step: LoadStep, state: string) => steps.push(`${step} ${state}`);
    return { kept, deps, steps, progress, requests: fetch.requests };
};
const hosts = (requests: string[]) => requests.map((url) => new URL(url).host);

describe("loadReview", () => {
    it("cold: two GitHub requests, one jsDelivr request per parser file, the download step beside the reads", async () => {
        const { deps, steps, progress, requests } = setup();
        const review = await loadReview(deps(), HONO, progress);
        expect(review.links).toHaveLength(10);
        expect(hosts(requests).filter((h) => h === "api.github.com")).toHaveLength(2);
        expect(hosts(requests).filter((h) => h === "cdn.jsdelivr.net")).toHaveLength(2);
        expect(steps).toEqual(expect.arrayContaining(["pr active", "pr done", "files active", "parser active", "parser done", "files done"]));
        expect(steps.indexOf("parser active")).toBeLessThan(steps.indexOf("files done"));
    });

    it("warm: the stored review for one GitHub request, and nothing from jsDelivr", async () => {
        const { deps, progress, requests } = setup();
        const first = await loadReview(deps(), HONO, progress);
        const from = requests.length;
        const again = await loadReview(deps(), HONO, progress);
        expect(again.links).toEqual(first.links);
        expect(hosts(requests.slice(from))).toEqual(["api.github.com"]);
    });

    it("a retry after the parser failed reuses the pull request already read: no GitHub request", async () => {
        const net = fakeFetch("hono-5513.json");
        const { deps, progress, kept } = setup(net);
        const down = async (url: string) => (url.startsWith("https://cdn.jsdelivr.net/") ? new Response("", { status: 503 }) : net.fetch(url));
        await expect(loadReview(deps(down), HONO, progress)).rejects.toThrow("Couldn't download the TypeScript parser from cdn.jsdelivr.net. Try again.");
        expect([...kept.keys()]).toEqual([]);
        const from = net.requests.length;
        await loadReview(deps(), HONO, progress);
        expect(hosts(net.requests.slice(from)).filter((h) => h === "api.github.com")).toEqual([]);
    });
});
