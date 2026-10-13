/** The whole files a card's `View full file` row opens: read from raw.githubusercontent.com when first asked for, and kept for the session. */

import type { Github } from "../lib/github.ts";

/** A file's text at a commit, or null when GitHub doesn't send it. */
export type ReadFile = (repo: string, sha: string, path: string) => Promise<string | null>;

/** How many files the session keeps: the last ones asked for. */
const KEEP = 24;

/**
 * Reads files at a commit with `github.raw`, which costs no API quota. Each is read once while it is kept; asking
 * for it again makes it the newest. A failed read is not kept, so the next click tries again.
 */
export const createFileReader = (github: Pick<Github, "raw">, keep = KEEP): ReadFile => {
    const kept = new Map<string, Promise<string | null>>();
    return (repo, sha, path) => {
        const key = `${repo}@${sha}:${path}`;
        const known = kept.get(key);
        if (known) {
            kept.delete(key);
            kept.set(key, known);
            return known;
        }
        // `raw` rejects for a path it can't put in a URL: that reads as nothing sent too.
        const text = github.raw(repo, sha, path).catch(() => null);
        kept.set(key, text);
        void text.then((got) => {
            if (got === null && kept.get(key) === text) kept.delete(key);
        });
        while (kept.size > keep) kept.delete(kept.keys().next().value!);
        return text;
    };
};
