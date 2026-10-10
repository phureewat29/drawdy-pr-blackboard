import { pageCount } from "../lib/github.ts";
import { segments } from "../lib/markdown.ts";

/**
 * Pull requests from well-known projects to open as examples: hono's
 * first, as its board shows the strings calmly, then the rest in the
 * operator's order, Bun's Rust rewrite last. Each is merged, by the
 * project's creator or a member of its core team, and draws strings on its
 * board: keep it so when changing one.
 * Their titles ship here exactly as GitHub's API gives them, split on
 * backticks as the panel shows them, with each one's changed-file count,
 * so the start view costs no GitHub request and can say what a big one
 * costs. Each project's tag takes its colour: its brand's where it stays
 * clear of the rows beside it, else a free hue.
 */
export const SUGGESTIONS = (
    [
        ["honojs/hono#5513", "fix(hono): handle non-Error throws with onError", "#E36002", 4],
        ["prettier/prettier#20127", "Support configuration files with UTF-8 BOM", "#41A0A1", 5],
        ["colinhacks/zod#6652", "fix(v4): check array, set and map size bounds before parsing elements", "#3A6AFF", 6],
        ["vitejs/vite#23586", "fix: pass queries to `renderBuiltUrl`", "#BD34FE", 4],
        ["nodejs/node#63047", "lib: handle --permission-audit when propagating flags", "#5FA04E", 4],
        ["TanStack/router#8573", "fix(start): align server function transport behavior", "#0891B2", 6],
        ["withastro/astro#17955", "Speed up dev server startup by deferring server app and content config compilation", "#F041FF", 7],
        ["sveltejs/svelte#18736", "perf: speed up parser a little bit", "#FF3E00", 9],
        ["elysiajs/elysia#1734", ":tada: feat: graceful cookie transition", "#F06292", 8],
        ["oven-sh/bun#34519", "node:events: single listeners stored bare like node; copy-on-write arrays", "#A67F38", 7],
        ["sindresorhus/ky#823", "Add `data` property to `HTTPError` with pre-parsed response body", "#288DD4", 6],
        ["excalidraw/excalidraw#12237", "feat(editor): alt-click to cycle the selection through overlapping elements", "#6965DB", 11],
        ["oven-sh/bun#30412", "Rewrite Bun in Rust", "#A67F38", 2188],
    ] as const
).map(([label, title, colour, files]) => {
    const requests = 1 + pageCount(files);
    return {
        url: `https://github.com/${label.replace("#", "/pull/")}`,
        label,
        title: segments(title),
        colour,
        /** What opening it costs of the 60 GitHub requests an hour, when that is more than the usual 2. */
        cost: requests > 2 ? `${requests} of 60 GitHub requests` : null,
    };
});

/** The tag colour of a pull request's project, by its `owner/repo#number`: an example project's, else none. */
export const projectColour = (label: string): string | null =>
    SUGGESTIONS.find((s) => s.label.split("#")[0].toLowerCase() === label.split("#")[0].toLowerCase())?.colour ?? null;
