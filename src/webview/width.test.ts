/**
 * The panel as Chrome lays it out, at Drawdy's 320 × 534: jsdom has no
 * layout, so these tests run the system Chrome headless, as `npm run
 * preview:board` does, and are skipped where it isn't installed.
 */
import { beforeAll, describe, expect, it } from "@jest/globals";
import type { ModuleStyling } from "@drawdy/driver-protocol";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { themeCss } from "../driver/channel.ts";
import { webviewHtml } from "../driver/webview-html.ts";
import { lexMarkdown, markdownHtml, segments } from "../lib/markdown.ts";
import type { PanelView } from "../shared/protocol.ts";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PANEL = { width: 320, height: 534 };
const DARK: ModuleStyling = {
    theme: "dark",
    background: "#27272a",
    foreground: "#fffffff2",
    surface: "#1f1f23",
    surface2: "#1f1f23",
    mutedForeground: "#ffffffb3",
    primary: "#c5f601",
    primaryForeground: "#090909",
    accent: "#e1ff6d",
    accentForeground: "#090909",
    border: "#ffffff14",
    input: "#ffffff1f",
    ring: "#c5f601",
    destructive: "#fb3748",
    success: "#53c683",
    warning: "#eab308",
    radiusSm: "4px",
    radiusMd: "6px",
    radiusLg: "8px",
};

const CODE_LINE = `const total = ${Array.from({ length: 20 }, (_, i) => `rate${i}(series${i})`).join(" + ")};`.slice(0, 200);
const LONG_URL = `https://github.com/prometheus/prometheus/blob/${"0123456789abcdef".repeat(3)}/promql/${"engine_test_".repeat(10)}.go#L1-L200`;
const DESCRIPTION = [
    "Adds native histogram support for the smoothed and anchored rate modifiers.",
    "",
    "```go",
    CODE_LINE,
    "```",
    "",
    `The whole run: ${LONG_URL}`,
    "",
    "| Benchmark | Before (ms) | After (ms) | Change | Allocations |",
    "|---|---|---|---|---|",
    "| BenchmarkRangeQuery/expr=rate(a_one_hundred[1m]) | 1,234.56 | 1,111.11 | −10.0 % | 12,345 → 11,111 |",
].join("\n");

const base: PanelView = {
    phase: "ready",
    loading: [],
    error: null,
    tag: { label: "prometheus/prometheus#18564", colour: "#E6522C" },
    pr: { title: segments("promql: support native histograms with smoothed/anchored rate"), state: "merged", additions: 667, deletions: 36 },
    total: 8,
    current: -1,
    hasPrevious: false,
    hasNext: true,
    card: { pin: "pr", about: ["roidelapluie · 4 files"], description: markdownHtml(lexMarkdown(DESCRIPTION), "page") },
    rebuildCost: null,
    rebuilding: null,
};
const VIEWS: Record<string, PanelView> = {
    description: base,
    "code card": {
        ...base,
        current: 2,
        hasPrevious: true,
        card: {
            pin: "c",
            name: `handle_${"very_long_snake_case_segment_".repeat(4)}request()`,
            status: "NEW",
            where: `src/${"deeply_nested_directory_name/".repeat(5)}handlers_with_a_long_file_name.py · 1,234–5,678`,
            links: [
                { word: "called by", chips: [{ link: "a", name: `Dispatcher.${"route_".repeat(12)}request()`, colour: 0 }] },
                { word: "calls", chips: [{ link: "b", name: `${"x".repeat(90)}()`, colour: 1 }] },
            ],
            canReadAll: true,
        },
    },
};

type Box = { left: number; right: number; width: number };
type Measure = {
    /** How wide the panel's document lays out: wider than the panel means something spills past its right edge. */
    width: number;
    next: Box;
    codeScrolls: boolean | null;
    tableScrolls: boolean | null;
    link: { lines: number; right: number } | null;
    /** The right edges of the card's name, path and link names. */
    rights: number[];
};

/**
 * Each view in a panel frame of its own, the panel's real page with a stand-in
 * for Drawdy's webview API; each frame posts what it measured once drawn.
 */
const measure = (): Record<string, Measure> => {
    const attr = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const probe = (id: string) => `addEventListener("load", () => setTimeout(() => {
        const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; };
        const shown = (el) => el && el.getClientRects().length > 0;
        const pre = document.querySelector("#pr-body pre");
        const table = document.querySelector("#pr-body table");
        const link = [...document.querySelectorAll("#pr-body .md-link")].find((a) => a.textContent.startsWith("https://"));
        parent.postMessage({ id: ${JSON.stringify(id)}, width: document.documentElement.scrollWidth, next: box(document.getElementById("next")),
            codeScrolls: shown(pre) ? pre.scrollWidth > pre.clientWidth : null, tableScrolls: shown(table) ? table.scrollWidth > table.clientWidth : null,
            link: shown(link) ? { lines: link.getClientRects().length, right: Math.max(...[...link.getClientRects()].map((r) => r.right)) } : null,
            rights: ["name", "path"].map((i) => document.getElementById(i)).concat([...document.querySelectorAll("#links button")]).filter(shown).map((el) => el.getBoundingClientRect().right) }, "*");
    }, 300));`;
    const frames = Object.entries(VIEWS).map(([id, view]) => {
        const api = `window.acquireDrawdyApi = () => ({ postMessage() {}, onMessage(f) { setTimeout(() => f({ type: "view", view: ${JSON.stringify(view).replace(/</g, "\\u003c")} })); return () => {}; } });`;
        const html = webviewHtml(themeCss(DARK)).replace('<script type="module">', `<script>${api}${probe(id)}</script><script type="module">`);
        return `<iframe srcdoc="${attr(html)}" style="width:${PANEL.width}px;height:${PANEL.height}px;border:0"></iframe>`;
    });
    const page = `<!doctype html><body><pre id="out"></pre>${frames.join("")}<script>
        const got = {};
        addEventListener("message", (e) => { got[e.data.id] = e.data; document.getElementById("out").textContent = JSON.stringify(got); });
    </script></body>`;
    const run = spawnSync(CHROME, ["--headless=new", "--disable-gpu", "--window-size=800,600", "--virtual-time-budget=5000", "--dump-dom", `data:text/html;base64,${Buffer.from(page).toString("base64")}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 60_000,
    });
    const out = /<pre id="out">([^<]*)<\/pre>/.exec(run.stdout ?? "")?.[1] ?? "{}";
    return JSON.parse(out.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
};

(existsSync(CHROME) ? describe : describe.skip)("the panel in Chrome, 320 wide", () => {
    let got: Record<string, Measure> = {};
    beforeAll(() => {
        got = measure();
    }, 60_000);

    it("keeps its width with a 200-character code line, a long URL and a wide table in the description", () => {
        const m = got.description;
        expect(CODE_LINE).toHaveLength(200);
        expect(m.width).toBe(PANEL.width);
        expect(m.next.width).toBeGreaterThan(0);
        expect(m.next.left).toBeGreaterThanOrEqual(0);
        expect(m.next.right).toBeLessThanOrEqual(PANEL.width);
    });

    it("scrolls the code block and the table sideways, and wraps the URL", () => {
        const m = got.description;
        expect(m.codeScrolls).toBe(true);
        expect(m.tableScrolls).toBe(true);
        expect(m.link?.lines).toBeGreaterThan(1);
        expect(m.link?.right).toBeLessThanOrEqual(PANEL.width);
    });

    it("keeps its width with a very long name, path and link names on a code card", () => {
        const m = got["code card"];
        expect(m.width).toBe(PANEL.width);
        expect(m.next.right).toBeLessThanOrEqual(PANEL.width);
        expect(m.rights).toHaveLength(4);
        for (const right of m.rights) expect(right).toBeLessThanOrEqual(PANEL.width);
    });
});
