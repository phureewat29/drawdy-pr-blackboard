import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrFile, PrInfo, PrRef } from "../lib/github.ts";
import { analyse, type Review } from "../lib/model.ts";
import { testParse } from "./parser.ts";

/**
 * A PR saved from GitHub, by its file in lib/fixtures or its absolute path: `pull` and `files` as the API answers
 * them, and `raw`, every file the read tier fetches that answers, by path. A path not in `raw` is a 404.
 */
export const readSaved = (file: string) => JSON.parse(readFileSync(file.startsWith("/") ? file : join(import.meta.dirname, "../lib/fixtures", file), "utf8"));

const load = (json: any, ref: PrRef) => {
    const pr: PrInfo = {
        ref,
        url: json.pull.html_url,
        title: json.pull.title,
        body: json.pull.body ?? "",
        author: json.pull.user.login,
        state: json.pull.merged ? "merged" : json.pull.state === "closed" ? "closed" : "open",
        headSha: json.pull.head.sha,
        headRepo: json.pull.head.repo.full_name,
        additions: json.pull.additions,
        deletions: json.pull.deletions,
        changedFiles: json.pull.changed_files,
    };
    const files: PrFile[] = json.files.map((f: any) => ({
        path: f.filename,
        ...(f.previous_filename ? { previousPath: f.previous_filename } : {}),
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        ...(f.patch !== undefined ? { patch: f.patch } : {}),
    }));
    const raw = new Map<string, string>(Object.entries(json.raw ?? {}));
    return { pr, files, raw, json };
};

export type SavedPr = { pr: PrInfo; files: readonly PrFile[]; raw: ReadonlyMap<string, string> };

/** The review PR Blackboard builds for a saved pull request, its files read from `raw`. */
export const reviewOf = async (saved: SavedPr): Promise<Review> => (await analyse(saved.pr, saved.files, async (path) => saved.raw.get(path) ?? null, testParse)).review;

/** honojs/hono#5513, saved from GitHub with the files its board reads. */
export const honoFixture = () => load(readSaved("hono-5513.json"), { owner: "honojs", repo: "hono", number: 5513 });

/** excalidraw/excalidraw#12237: 31 changed declarations in one thread, the stress case for strings and Markdown. */
export const excalidrawFixture = () => load(readSaved("excalidraw-12237.json"), { owner: "excalidraw", repo: "excalidraw", number: 12237 });

/** Any PR saved in the fixtures' shape, by its file's absolute path: for previewing a board before it becomes a fixture. */
export const savedPr = (path: string) => {
    const json = readSaved(path);
    const [, owner, repo, number] = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(json.pull.html_url)!;
    return load(json, { owner, repo, number: Number(number) });
};
