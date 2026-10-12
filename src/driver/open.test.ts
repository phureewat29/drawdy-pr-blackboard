import { describe, expect, it } from "@jest/globals";
import { createGithub } from "../lib/github.ts";
import { fakeFetch } from "../test/fake-fetch.ts";
import { fakeHost } from "../test/fake-host.ts";
import { connectSource } from "../test/parser.ts";
import { loadReview } from "./open.ts";
import { createParser } from "./parser.ts";
import type { Progress } from "./progress.ts";
import { createStore } from "./store.ts";

const HONO = { owner: "honojs", repo: "hono", number: 5513 };

/** loadReview on hono#5513 through a fake fetch, with a kv-storage that keeps what it is given. */
const setup = (fetch = fakeFetch("hono-5513.json")) => {
    const kept = new Map<string, unknown>();
    const host = fakeHost(undefined, {
        "command:kv-storage:get": (req) => (kept.has(req.key) ? { got: kept.get(req.key) } : {}),
        "command:kv-storage:set": (req) => void kept.set(req.key, req.payload),
    });
    const deps = (net = fetch.fetch) => ({ github: createGithub(net), store: createStore(host.ddp), parser: createParser({ ddp: host.ddp, fetch: net, connect: connectSource }) });
    const steps: string[] = [];
    const progress: Progress = {
        step: (step, state, words) => void steps.push(`${step} ${state}${words?.count ? ` ${words.count.join(" / ")}` : ""}${state === "done" && words?.note ? ` · ${words.note}` : ""}`),
        reading: (paths, left) => void steps.push(`reading ${paths.length} ${left}`),
        read: (path, state) => void steps.push(`read ${path} ${state}`),
        followed: () => undefined,
        parser: (language, state) => void steps.push(`parser ${language} ${state}`),
    };
    return { kept, deps, steps, progress, requests: fetch.requests };
};
const hosts = (requests: string[]) => requests.map((url) => new URL(url).host);

describe("loadReview", () => {
    it("cold: two GitHub requests, one jsDelivr request per parser file, the download beside the reads, each changed file in reading order, and the board's plan", async () => {
        const { deps, steps, progress, requests } = setup();
        const { review, plan } = await loadReview(deps(), HONO, progress);
        expect(review.links).toHaveLength(10);
        expect(plan?.order).toEqual(review.order);
        expect(hosts(requests).filter((h) => h === "api.github.com")).toHaveLength(2);
        expect(hosts(requests).filter((h) => h === "cdn.jsdelivr.net")).toHaveLength(2);
        // The four changed files are read whole, code before tests, none left out by the read limits.
        const reads = ["read src/compose.ts done", "read src/hono-base.ts done", "read src/compose.test.ts done", "read src/hono.test.ts done"];
        expect(steps.filter((s) => !s.startsWith("parser"))).toEqual(["pr active", "pr done", "reading 4 0", ...reads, "link done"]);
        // One row for TypeScript, under way before the first file is parsed and done once its two files are.
        expect(steps.filter((s) => s.startsWith("parser"))).toEqual(["parser TypeScript active", "parser TypeScript done"]);
        expect(steps.indexOf("parser TypeScript active")).toBeLessThan(steps.indexOf(reads[0]));
    });

    it("counts a big PR's GitHub requests on its step as the file list's pages come", async () => {
        const net = fakeFetch("hono-5513.json");
        // GitHub says 250 files: three pages of the file list, the last two empty here.
        const big = async (url: string) => (url.endsWith("/pulls/5513") ? new Response(JSON.stringify({ ...JSON.parse(await (await net.fetch(url)).text()), changed_files: 250 })) : net.fetch(url));
        const { deps, steps, progress } = setup(net);
        await loadReview(deps(big), HONO, progress);
        expect(steps.filter((s) => s.startsWith("pr"))).toEqual(["pr active", "pr active 1 / 4", "pr active 2 / 4", "pr active 3 / 4", "pr active 4 / 4", "pr done · 4 GitHub requests"]);
    });

    it("warm: the stored review for one GitHub request, nothing from jsDelivr, and no plan made", async () => {
        const { deps, progress, requests } = setup();
        const first = await loadReview(deps(), HONO, progress);
        const from = requests.length;
        const again = await loadReview(deps(), HONO, progress);
        expect(again.review.links).toEqual(first.review.links);
        expect(again.plan).toBeNull();
        expect(hosts(requests.slice(from))).toEqual(["api.github.com"]);
    });

    it("fresh: reads GitHub again past the stored review, and builds the same review", async () => {
        const { deps, progress, requests } = setup();
        const first = await loadReview(deps(), HONO, progress);
        const from = requests.length;
        const again = await loadReview(deps(), HONO, progress, true);
        expect(hosts(requests.slice(from)).filter((h) => h === "api.github.com")).toHaveLength(2);
        expect(hosts(requests.slice(from))).toContain("raw.githubusercontent.com");
        expect(again.review).toEqual(first.review);
        expect(again.plan).not.toBeNull();
    });

    it("a retry after the parser failed reuses the pull request already read, but a fresh read doesn't", async () => {
        const net = fakeFetch("hono-5513.json");
        const { deps, progress, kept } = setup(net);
        const down = async (url: string) => (url.startsWith("https://cdn.jsdelivr.net/") ? new Response("", { status: 503 }) : net.fetch(url));
        await expect(loadReview(deps(down), HONO, progress)).rejects.toThrow("Couldn't download the TypeScript parser from cdn.jsdelivr.net. Try again.");
        expect([...kept.keys()]).toEqual([]);
        await expect(loadReview(deps(down), HONO, progress)).rejects.toThrow("Couldn't download");
        const from = net.requests.length;
        await loadReview(deps(), HONO, progress);
        expect(hosts(net.requests.slice(from)).filter((h) => h === "api.github.com")).toEqual([]);
        const fresh = net.requests.length;
        await loadReview(deps(), HONO, progress, true);
        expect(hosts(net.requests.slice(fresh)).filter((h) => h === "api.github.com")).toHaveLength(2);
    });
});
