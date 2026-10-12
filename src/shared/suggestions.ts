import { segments } from "../lib/markdown.ts";

/**
 * PRs from well-known projects to open as examples: hono's first, as its board shows the strings calmly. Each is
 * merged, by the project's creator or a member of its core team, and draws strings on its board: keep it so when
 * changing one. Each opens with the usual 2 GitHub requests; a bigger one, such as Bun's 2,188-file rewrite at 23 of
 * the 60 an hour, stays off the list. Their titles ship exactly as GitHub's API gives them, so the start view costs
 * no GitHub request. Each project's tag takes its brand's colour where it stays clear of the rows beside it, else a
 * free hue.
 */
export const SUGGESTIONS = (
    [
        ["honojs/hono#5513", "fix(hono): handle non-Error throws with onError", "#E36002"],
        ["prettier/prettier#20127", "Support configuration files with UTF-8 BOM", "#41A0A1"],
        ["colinhacks/zod#6652", "fix(v4): check array, set and map size bounds before parsing elements", "#3A6AFF"],
        ["vitejs/vite#23586", "fix: pass queries to `renderBuiltUrl`", "#BD34FE"],
        ["nodejs/node#63047", "lib: handle --permission-audit when propagating flags", "#5FA04E"],
        ["TanStack/router#8573", "fix(start): align server function transport behavior", "#0891B2"],
        ["withastro/astro#17955", "Speed up dev server startup by deferring server app and content config compilation", "#F041FF"],
        ["sveltejs/svelte#18736", "perf: speed up parser a little bit", "#FF3E00"],
        ["elysiajs/elysia#1734", ":tada: feat: graceful cookie transition", "#F06292"],
        ["oven-sh/bun#34519", "node:events: single listeners stored bare like node; copy-on-write arrays", "#A67F38"],
        ["sindresorhus/ky#823", "Add `data` property to `HTTPError` with pre-parsed response body", "#288DD4"],
        ["excalidraw/excalidraw#12237", "feat(editor): alt-click to cycle the selection through overlapping elements", "#6965DB"],
        ["prometheus/prometheus#18564", "promql: support native histograms with smoothed/anchored rate", "#D64B5A"],
        ["python/cpython#152451", "gh-133031: Support non-ASCII characters in curses.textpad.Textbox", "#3A7AB0"],
    ] as const
).map(([label, title, colour]) => ({
    url: `https://github.com/${label.replace("#", "/pull/")}`,
    label,
    title: segments(title),
    colour,
}));

/** The tag colour of a PR's project, by its `owner/repo#number`: an example project's, else none. */
export const projectColour = (label: string): string | null =>
    SUGGESTIONS.find((s) => s.label.split("#")[0].toLowerCase() === label.split("#")[0].toLowerCase())?.colour ?? null;
