import type { Fetch } from "../lib/github.ts";

/** What PR Blackboard may request, as the README's Privacy section says: GitHub's API and raw files, and the parser's files on jsDelivr. */
const ALLOWED = ["https://api.github.com/", "https://raw.githubusercontent.com/", "https://cdn.jsdelivr.net/npm/"];

/**
 * The one function that reaches the network, for every request PR Blackboard makes: the GitHub API through the quota
 * watcher (`quota.ts`), the files the parser worker reads, and the parser's files. Any other URL is refused.
 */
export const fetchGithubOrJsdelivr: Fetch = (url, init) => (ALLOWED.some((prefix) => url.startsWith(prefix)) ? fetch(url, init) : Promise.reject(new Error(`PR Blackboard requests only GitHub and jsDelivr, not ${url}`)));
