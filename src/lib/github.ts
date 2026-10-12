/**
 * Reads public pull requests from GitHub without signing in.
 *
 * Two hosts answer cross-origin requests from Drawdy's worker: the REST API
 * (60 requests an hour per IP without a token) and raw.githubusercontent.com
 * (file contents, outside that quota). A pull request's `.diff` URL sends no
 * CORS headers, so the diff comes from the files endpoint instead.
 */

import { limiter } from "./fp.ts";
import * as g from "./guard.ts";

export type PrRef = { owner: string; repo: string; number: number };

export type PrState = "open" | "draft" | "merged" | "closed";

export type PrInfo = {
    ref: PrRef;
    url: string;
    title: string;
    body: string;
    author: string;
    state: PrState;
    headSha: string;
    /** The repository the head commits live in: a fork, or the base repo. */
    headRepo: string;
    additions: number;
    deletions: number;
    changedFiles: number;
};

export type FileStatus = "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";

export type PrFile = {
    path: string;
    previousPath?: string;
    status: FileStatus;
    additions: number;
    deletions: number;
    /** Missing when GitHub leaves out a file's diff, such as a very large or binary one. */
    patch?: string;
};

export type GithubFailure =
    | { kind: "not-found" }
    | { kind: "rate-limited"; resetAt: number | null }
    | { kind: "network" }
    | { kind: "http"; status: number };

export type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
/** GitHub's files endpoint stops at 3000 files. */
const MAX_FILES = 3000;
const PAGE = 100;
/** File list pages in flight at once: a 2,188-file pull request takes 22. */
const PAGES_AT_ONCE = 4;

/** How many requests a pull request's file list takes. */
export const pageCount = (changedFiles: number): number => Math.max(1, Math.ceil(Math.min(changedFiles, MAX_FILES) / PAGE));

const NAME = /^[A-Za-z0-9_.-]+$/;

/**
 * Reads a pull request reference from what a user pastes: a GitHub link
 * (any tab of the PR, with or without the scheme) or `owner/repo#123`.
 */
export const parsePrUrl = (text: string): PrRef | null => {
    const trimmed = text.trim();
    const link = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/i.exec(trimmed);
    const short = /^([^/\s#]+)\/([^/\s#]+)#(\d+)$/.exec(trimmed);
    const m = link ?? short;
    if (!m || !NAME.test(m[1]) || !NAME.test(m[2])) return null;
    const number = Number(m[3]);
    return Number.isSafeInteger(number) && number > 0 ? { owner: m[1], repo: m[2], number } : null;
};

/** `owner/repo#123`, the key PR Blackboard files a pull request under. */
export const prKey = (ref: PrRef): string => `${ref.owner}/${ref.repo}#${ref.number}`.toLowerCase();

export const prLabel = (ref: PrRef): string => `${ref.owner}/${ref.repo}#${ref.number}`;

/** The failure behind an error thrown by this module, if it was one. */
export const githubFailure = (err: unknown): GithubFailure | null =>
    err instanceof Error && typeof err.cause === "object" && err.cause !== null && "kind" in err.cause
        ? (err.cause as GithubFailure)
        : null;

const fail = (failure: GithubFailure, message: string): never => {
    throw new Error(message, { cause: failure });
};

/** A failure, in words for the panel. */
export const explainGithub = (failure: GithubFailure, now = Date.now()): string => {
    switch (failure.kind) {
        case "not-found":
            return "GitHub can't find this PR. Check the link: PR Blackboard opens public PRs only.";
        case "rate-limited": {
            if (failure.resetAt === null) return "GitHub is limiting requests from this network. Try again in a few minutes.";
            const minutes = Math.max(1, Math.ceil((failure.resetAt - now) / 60_000));
            return `This network has used GitHub's 60 requests for this hour. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
        }
        case "network":
            return "PR Blackboard couldn't reach GitHub. Check your connection and try again.";
        case "http":
            return `GitHub answered with an error (${failure.status}). Try again in a moment.`;
    }
};

const userShape = g.object({ login: g.string });
const repoShape = g.nullable(g.object({ full_name: g.string }));
const pullShape = g.object({
    number: g.number,
    html_url: g.string,
    title: g.string,
    body: g.nullable(g.string),
    state: g.oneOf(["open", "closed"] as const),
    draft: g.optional(g.boolean),
    merged: g.optional(g.boolean),
    merged_at: g.optional(g.nullable(g.string)),
    user: g.nullable(userShape),
    base: g.object({ repo: repoShape }),
    head: g.object({ sha: g.string, repo: repoShape }),
    additions: g.number,
    deletions: g.number,
    changed_files: g.number,
});
const fileShape = g.object({
    filename: g.string,
    previous_filename: g.optional(g.string),
    status: g.oneOf(["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"] as const),
    additions: g.number,
    deletions: g.number,
    patch: g.optional(g.string),
});

export type Github = {
    pr: (ref: PrRef) => Promise<PrInfo>;
    /** Every changed file, one request per 100 files; `onPage` hears of each page as it comes. */
    files: (ref: PrRef, count: number, onPage?: () => void) => Promise<PrFile[]>;
    /** A file's text at a commit, or null when it can't be read. Costs no API quota. */
    raw: (repo: string, sha: string, path: string) => Promise<string | null>;
};

export const createGithub = (fetch: Fetch): Github => {
    const getJson = async (url: string): Promise<unknown> => {
        let res: Response;
        try {
            res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
        } catch {
            return fail({ kind: "network" }, `GET ${url} failed`);
        }
        const left = res.headers.get("x-ratelimit-remaining");
        if (res.status === 404) return fail({ kind: "not-found" }, `GET ${url}: 404`);
        if (res.status === 403 || res.status === 429) {
            const reset = Number(res.headers.get("x-ratelimit-reset"));
            const limited = res.status === 429 || left === "0" || res.headers.has("retry-after");
            if (limited) {
                return fail({ kind: "rate-limited", resetAt: Number.isFinite(reset) && reset > 0 ? reset * 1000 : null }, `GET ${url}: rate limited`);
            }
        }
        if (!res.ok) return fail({ kind: "http", status: res.status }, `GET ${url}: ${res.status}`);
        return res.json();
    };

    const repoPath = (ref: PrRef) => `${API}/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`;

    const pr = async (ref: PrRef): Promise<PrInfo> => {
        const raw = await getJson(repoPath(ref));
        const p = g.parse(pullShape, raw);
        if (!p) return fail({ kind: "http", status: 200 }, "PR Blackboard can't read the PR GitHub returned");
        const state: PrState = p.merged || p.merged_at ? "merged" : p.state === "closed" ? "closed" : p.draft ? "draft" : "open";
        return {
            ref,
            url: p.html_url,
            title: p.title,
            body: p.body ?? "",
            author: p.user?.login ?? "ghost",
            state,
            headSha: p.head.sha,
            headRepo: p.head.repo?.full_name ?? p.base.repo?.full_name ?? `${ref.owner}/${ref.repo}`,
            additions: p.additions,
            deletions: p.deletions,
            changedFiles: p.changed_files,
        };
    };

    const page = async (ref: PrRef, n: number): Promise<PrFile[]> => {
        const raw = await getJson(`${repoPath(ref)}/files?per_page=${PAGE}&page=${n}`);
        return (Array.isArray(raw) ? raw : []).flatMap((item) => {
            const f = g.parse(fileShape, item);
            if (!f) return [];
            return [
                {
                    path: f.filename,
                    ...(f.previous_filename ? { previousPath: f.previous_filename } : {}),
                    status: f.status,
                    additions: f.additions,
                    deletions: f.deletions,
                    ...(f.patch !== undefined ? { patch: f.patch } : {}),
                },
            ];
        });
    };

    const files = async (ref: PrRef, count: number, onPage = () => {}): Promise<PrFile[]> => {
        const slot = limiter(PAGES_AT_ONCE);
        // After a failure no other page is asked for: each would cost a request.
        let failure: unknown = null;
        const pageOf = (n: number) =>
            slot(async () => {
                if (failure) throw failure;
                return page(ref, n).then(
                    (got) => (onPage(), got),
                    (err: unknown) => {
                        failure ??= err;
                        throw err;
                    }
                );
            });
        const pages = await Promise.all(Array.from({ length: pageCount(count) }, (_, i) => pageOf(i + 1)));
        return pages.flat();
    };

    const raw = async (repo: string, sha: string, path: string): Promise<string | null> => {
        const url = `${RAW}/${repo}/${sha}/${path.split("/").map(encodeURIComponent).join("/")}`;
        try {
            const res = await fetch(url);
            return res.ok ? await res.text() : null;
        } catch {
            return null;
        }
    };

    return { pr, files, raw };
};
