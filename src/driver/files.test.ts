import { describe, expect, it, jest } from "@jest/globals";
import { createGithub } from "../lib/github.ts";
import { createFileReader } from "./files.ts";

const files: Record<string, string> = { "src/a.ts": "export const a = 1\n", "src/b.ts": "export const b = 2\n", "src/c.ts": "export const c = 3\n" };

/** raw.githubusercontent.com serving `files` at one commit, its requests counted; `down` answers every request with a network error. */
const rawHost = () => {
    const asked: string[] = [];
    let down = false;
    const fetch = jest.fn(async (url: string) => {
        asked.push(url);
        if (down) throw new TypeError("Failed to fetch");
        const path = decodeURIComponent(url.split("/sha1/")[1] ?? "");
        return files[path] === undefined ? new Response("", { status: 404 }) : new Response(files[path]);
    });
    return { github: createGithub(fetch), asked, setDown: (value: boolean) => (down = value) };
};

describe("the files View full file reads", () => {
    it("reads each file at its commit from raw.githubusercontent.com once a session", async () => {
        const { github, asked } = rawHost();
        const read = createFileReader(github);
        expect(await read("honojs/hono", "sha1", "src/a.ts")).toBe(files["src/a.ts"]);
        expect(await read("honojs/hono", "sha1", "src/a.ts")).toBe(files["src/a.ts"]);
        expect(asked).toEqual(["https://raw.githubusercontent.com/honojs/hono/sha1/src/a.ts"]);
        // Asked for twice at once: one request.
        const both = await Promise.all([read("honojs/hono", "sha1", "src/b.ts"), read("honojs/hono", "sha1", "src/b.ts")]);
        expect(both).toEqual([files["src/b.ts"], files["src/b.ts"]]);
        expect(asked).toHaveLength(2);
        // Another repository, a fork say, is another file.
        await read("someone/hono", "sha1", "src/a.ts");
        expect(asked).toHaveLength(3);
    });

    it("answers null when GitHub doesn't send a file, and tries again on the next ask", async () => {
        const { github, asked, setDown } = rawHost();
        const read = createFileReader(github);
        expect(await read("honojs/hono", "sha1", "src/gone.ts")).toBeNull();
        setDown(true);
        expect(await read("honojs/hono", "sha1", "src/a.ts")).toBeNull();
        setDown(false);
        expect(await read("honojs/hono", "sha1", "src/a.ts")).toBe(files["src/a.ts"]);
        expect(asked.filter((url) => url.endsWith("/src/a.ts"))).toHaveLength(2);
        // A path no URL can hold rejects in `raw`: that is nothing sent too.
        expect(await read("honojs/hono", "sha1", "src/\ud800.ts")).toBeNull();
    });

    it("keeps the files last asked for, a file asked again the newest", async () => {
        const { github, asked } = rawHost();
        const read = createFileReader(github, 2);
        await read("honojs/hono", "sha1", "src/a.ts");
        await read("honojs/hono", "sha1", "src/b.ts");
        await read("honojs/hono", "sha1", "src/a.ts");
        await read("honojs/hono", "sha1", "src/c.ts");
        expect(asked).toHaveLength(3);
        // b.ts went when c.ts came: a was asked for after it.
        await read("honojs/hono", "sha1", "src/a.ts");
        expect(asked).toHaveLength(3);
        await read("honojs/hono", "sha1", "src/b.ts");
        expect(asked).toHaveLength(4);
    });
});
