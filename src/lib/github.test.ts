import { describe, expect, it } from "@jest/globals";
import { createGithub, explainGithub, githubFailure, parsePrUrl, prKey } from "./github.ts";

describe("parsePrUrl", () => {
    it.each([
        ["https://github.com/honojs/hono/pull/5513", 5513],
        ["github.com/honojs/hono/pull/5513/files", 5513],
        ["https://github.com/honojs/hono/pull/5513#discussion_r1", 5513],
        ["  http://www.github.com/honojs/hono/pull/7?w=1 ", 7],
        ["honojs/hono#12", 12],
    ])("reads %s", (text, number) => {
        expect(parsePrUrl(text)).toEqual({ owner: "honojs", repo: "hono", number });
    });

    it.each(["https://github.com/honojs/hono/issues/1", "https://gitlab.com/a/b/pull/1", "hono#1", "https://github.com/a/b/pull/0", ""])("rejects %s", (text) => {
        expect(parsePrUrl(text)).toBeNull();
    });

    it("files pull requests under one key whatever the case, which reads back as the pull request", () => {
        expect(prKey({ owner: "HonoJS", repo: "Hono", number: 1 })).toBe("honojs/hono#1");
        expect(parsePrUrl(prKey({ owner: "HonoJS", repo: "Hono", number: 1 }))).toEqual({ owner: "honojs", repo: "hono", number: 1 });
    });
});

const pull = {
    number: 9,
    html_url: "https://github.com/a/b/pull/9",
    title: "Add a thing",
    body: null,
    state: "closed",
    draft: false,
    merged: true,
    user: { login: "ada" },
    base: { ref: "main", sha: "b", repo: { full_name: "a/b" } },
    head: { ref: "thing", sha: "h", repo: { full_name: "fork/b" } },
    additions: 2,
    deletions: 1,
    changed_files: 150,
};

describe("createGithub", () => {
    it("reads a pull request, with its state and the repository its commits live in", async () => {
        const github = createGithub(async () => new Response(JSON.stringify(pull), { headers: { "x-ratelimit-remaining": "41" } }));
        const pr = await github.pr({ owner: "a", repo: "b", number: 9 });
        expect(pr).toMatchObject({ state: "merged", author: "ada", headRepo: "fork/b", body: "", changedFiles: 150 });
    });

    it("pages through the files, 100 at a time", async () => {
        const urls: string[] = [];
        const github = createGithub(async (url) => {
            urls.push(url);
            const page = Number(new URL(url).searchParams.get("page"));
            const count = page === 1 ? 100 : 50;
            return new Response(JSON.stringify(Array.from({ length: count }, (_, i) => ({ filename: `f${page}-${i}.ts`, status: "modified", additions: 1, deletions: 0 }))));
        });
        const files = await github.files({ owner: "a", repo: "b", number: 9 }, 150);
        expect(files).toHaveLength(150);
        expect(urls).toHaveLength(2);
        expect(files[0]).not.toHaveProperty("patch");
    });

    it("says when the hourly quota is spent, and when it comes back", async () => {
        const resetAt = Date.now() + 12 * 60_000;
        const github = createGithub(async () =>
            new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(resetAt / 1000)) } })
        );
        const err = await github.pr({ owner: "a", repo: "b", number: 9 }).catch((e: unknown) => e);
        const failure = githubFailure(err);
        expect(failure?.kind).toBe("rate-limited");
        expect(explainGithub(failure!, Date.now())).toMatch(/^This network has used GitHub's 60 requests for this hour\. Try again in 1[12] minutes\.$/);
    });

    it("treats a missing pull request as possibly private", async () => {
        const github = createGithub(async () => new Response("{}", { status: 404 }));
        const failure = githubFailure(await github.pr({ owner: "a", repo: "b", number: 9 }).catch((e: unknown) => e));
        expect(explainGithub(failure!)).toBe("GitHub can't find this pull request. Check the link: PR Blackboard opens public pull requests only.");
    });

    it("reports a network failure, and reads raw files without throwing", async () => {
        const github = createGithub(async () => {
            throw new TypeError("Failed to fetch");
        });
        expect(githubFailure(await github.pr({ owner: "a", repo: "b", number: 9 }).catch((e: unknown) => e))?.kind).toBe("network");
        await expect(github.raw("a/b", "h", "src/x.ts")).resolves.toBeNull();
    });

    it("encodes each part of a raw file's path", async () => {
        const urls: string[] = [];
        const github = createGithub(async (url) => {
            urls.push(url);
            return new Response("text");
        });
        await github.raw("a/b", "h", "docs/a file#1.md");
        expect(urls[0]).toBe("https://raw.githubusercontent.com/a/b/h/docs/a%20file%231.md");
    });
});
