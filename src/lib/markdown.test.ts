/**
 * @jest-environment jsdom
 */
import { describe, expect, it, jest } from "@jest/globals";
import { excalidrawFixture, honoFixture } from "../test/fixture.ts";
import { EVERY_BLOCK } from "../test/synthetic.ts";
import { Lexer } from "../vendor/marked.ts";
import { INLINE, emojify, escapeText, lexMarkdown, markdownBlocks, markdownHeight, markdownHtml, segments, segmentsHtml, type MdToken } from "./markdown.ts";

/** The rendered HTML parsed as a browser would, to read what a reader sees. */
const dom = (html: string) => {
    const root = document.createElement("div");
    root.innerHTML = html;
    return root;
};

const card = (body: string) => markdownHtml(lexMarkdown(body), "card");
const page = (body: string) => markdownHtml(lexMarkdown(body), "page");

describe("Markdown on the PR card", () => {
    it("renders hono's description: paragraphs, inline code, a nested list, headings and a task list", () => {
        const html = card(honoFixture().pr.body);
        const root = dom(html);
        expect(root.querySelector("p code")?.textContent).toBe("Error");
        expect(root.querySelectorAll("ul ul li")).toHaveLength(1);
        expect([...root.querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["Behavior change", "The author should do the following, if applicable"]);
        expect(root.querySelectorAll("li.md-task .md-box.on")).toHaveLength(3);
        expect(root.querySelector("input")).toBeNull();
    });

    it("renders every block GitHub does", () => {
        const root = dom(card(EVERY_BLOCK));
        expect(root.querySelector("h1")?.textContent).toBe("Parse options and render output");
        expect(root.querySelector("h2")?.textContent).toBe("What changed");
        expect(root.querySelector("strong")?.textContent).toBe("once");
        expect(root.querySelector("em")?.textContent).toBe("validated");
        expect(root.querySelector("del")?.textContent).toBe("cached");
        expect(root.querySelector(".md-link")?.textContent).toBe("the guide");
        expect(root.querySelectorAll("ol li")).toHaveLength(3);
        expect(root.querySelectorAll("li.md-task")).toHaveLength(2);
        expect(root.querySelectorAll("li.md-task .md-box.on")).toHaveLength(1);
        expect(root.querySelector("pre .l .f")?.textContent).toBe("parseOptions");
        expect([...root.querySelectorAll("pre .l.add, pre .l.del")].map((l) => l.className)).toEqual(["l del", "l add"]);
        expect([...root.querySelectorAll("th")].map((th) => [th.textContent, th.getAttribute("style")])).toEqual([
            ["Flag", "text-align:left"],
            ["Default", "text-align:right"],
        ]);
        expect(root.querySelectorAll("tbody tr")).toHaveLength(2);
        expect(root.querySelector("blockquote em")?.textContent).toBe("emphasis");
        expect(root.querySelector("blockquote.md-alert.warning p strong")?.textContent).toBe("Warning");
        expect(root.querySelector("blockquote.md-alert")?.textContent).toBe("WarningFlags are now case-sensitive.");
        expect(root.querySelector("hr")).not.toBeNull();
    });

    it("lets no raw HTML, script or handler through, and fetches nothing", () => {
        for (const html of [card(EVERY_BLOCK), page(EVERY_BLOCK)]) {
            const root = dom(html);
            expect(root.querySelectorAll("script, iframe, img, a, input, style")).toHaveLength(0);
            expect([...root.querySelectorAll("*")].flatMap((el) => [...el.attributes].map((a) => a.name)).filter((name) => name.startsWith("on"))).toEqual([]);
            expect(html).not.toMatch(/<(script|iframe|img)\b/i);
            expect(html).not.toContain("alert(");
            expect(html).not.toContain("Thanks for the pull request");
            expect(root.querySelector("p br")?.parentElement?.textContent).toBe("Centredtext");
        }
    });

    it("shows images as chips, a bare attachment link as Attachment, and entities as their characters", () => {
        const root = dom(card(EVERY_BLOCK));
        expect([...root.querySelectorAll(".md-chip")].map((c) => c.textContent)).toEqual(["Image: a screenshot of the output", "Image: raw image", "Attachment"]);
        expect(root.textContent).toContain("R&D says 5 < 6.");
        expect(escapeText("a &amp; b & c <d>")).toBe("a &amp; b &amp; c &lt;d&gt;");
    });

    it("shows a details block open on the card, each summary a bold line over what it holds, and a real one in the panel", () => {
        const onCard = dom(card(EVERY_BLOCK));
        expect([...onCard.querySelectorAll(".md-details > strong")].map((d) => d.textContent)).toEqual(["Benchmarks", "Inner"]);
        expect(onCard.textContent).toContain("Nested text.");
        expect(onCard.textContent).toContain("Outer text.");
        expect(onCard.querySelector("details, summary")).toBeNull();
        const inPage = dom(page(EVERY_BLOCK));
        expect([...inPage.querySelectorAll("details > summary")].map((s) => s.textContent)).toEqual(["Benchmarks", "Inner"]);
        expect(inPage.querySelector("details details")?.textContent).toContain("Nested text.");
        expect(inPage.querySelector("details")?.textContent).toContain("Outer text.");
    });

    it("closes a details block the description left open, and a summary", () => {
        expect(page("<details><summary>Open</summary>\n\nNever closed.")).toMatch(/<\/details>$/);
        expect(card("<details><summary>Open</summary>\n\nNever closed.")).toBe('<p class="md-details"><strong>Open</strong></p><p>Never closed.</p>');
        expect(card("<details><summary>Open")).toBe('<p class="md-details"><strong>Open</strong></p>');
    });

    it("shows a description whole, however long GitHub lets it be, and one marked can't lex as plain text", () => {
        const huge = `${"word ".repeat(13_100)}TAIL`;
        expect(huge.length).toBeGreaterThan(65_500);
        expect(card(huge)).toContain("TAIL");
        // marked recurses once per nested quote: thousands overflow its stack.
        const deep = `${"> ".repeat(6_000)}deep & <b>`;
        expect(card(deep)).toBe(`<p>${"&gt; ".repeat(6_000)}deep &amp; &lt;b&gt;</p>`);
        expect(markdownHeight(lexMarkdown(deep), 608)).toBeGreaterThan(21);
    });

    it("estimates heights from GitHub's metrics, a little over", () => {
        expect(markdownHeight(lexMarkdown(""), 608)).toBe(0);
        expect(markdownHeight(lexMarkdown("A made-up pull request for testing the board layout."), 608)).toBe(Math.ceil(21 * 1.03));
        const hono = markdownHeight(lexMarkdown(honoFixture().pr.body), 608);
        expect(hono).toBeGreaterThan(500);
        expect(hono).toBeLessThan(700);
        // A details block counts as the card shows it, open: its summary a line, then each block it holds.
        expect(markdownHeight(lexMarkdown("<details><summary>X</summary>\n\nlong\n\nlong\n\n</details>"), 608)).toBe(Math.ceil((3 * (21 + 16) - 16) * 1.03));
        expect(markdownBlocks(lexMarkdown("<details><summary>X</summary>Body text</details>"), 608)).toEqual([2 * (21 + 16)]);
    });

    it("lets a heading's margin above collapse into the block before it, and gives the first block none", () => {
        // h2: 34 tall, 24 above, 16 below.
        expect(markdownBlocks(lexMarkdown("## First\n\nText.\n\n## Second\n\nText."), 608)).toEqual([34 + 16, 21 + 16, 34 + 24, 21 + 16]);
    });
});

describe("lexing a description", () => {
    const fill = (unit: string, n: number) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);

    it("lexes hono's and excalidraw's descriptions exactly as marked does", () => {
        for (const body of [honoFixture().pr.body, excalidrawFixture().pr.body, EVERY_BLOCK]) {
            expect(lexMarkdown(body)).toEqual((Lexer.lex(body, { gfm: true }) as MdToken[]).filter((t) => t.type !== "space"));
        }
    });

    it("shows a long run dense with emphasis as typed, at once, in a paragraph, a list item, a cell, a heading or an alert", () => {
        // marked alone takes about 12 s over the paragraph, and 0.8 s over each of the others.
        const run = fill("*a _b ", 65_000);
        const t0 = performance.now();
        const html = [run, `- ${run.slice(0, 16_000)}`, `| a |\n|---|\n| ${run.slice(0, 16_000)} |`, `## ${run.slice(0, 16_000)}`, `> [!NOTE]\n> ${run.slice(0, 16_000)}`].map(page);
        expect(performance.now() - t0).toBeLessThan(1000);
        // The alert's own label is the only bold left.
        expect(html.map((h) => /<em>|<strong>/.test(h.replace("<p><strong>Note</strong></p>", "")))).toEqual([false, false, false, false, false]);
        expect(html[0] === `<p>${run.trim()}</p>`).toBe(true);
        expect(dom(html[4]).querySelector(".md-alert.note")!.textContent).toContain("*a _b *a _b");
    });

    it("lexes a long run with few delimiters, and a short dense one, until the description has spent its budget on dense runs", () => {
        expect(page(`${"word ".repeat(3000)}*kept* \`code\``)).toContain("<em>kept</em> <code>code</code>");
        const dense = fill("*a* _b_ ", INLINE.short);
        const paragraphs = [...dom(page(Array.from({ length: 12 }, () => dense).join("\n\n"))).querySelectorAll("p")];
        expect(paragraphs.map((p) => p.querySelector("em") !== null)).toEqual([...Array(8).fill(true), ...Array(4).fill(false)]);
    });

    it("counts only `*`, `_` and `~`: code spans and links lex whatever their number", () => {
        // A changelog joined by single newlines, one run of 3,009 characters with 270 backticks and brackets.
        const changes = Array.from({ length: 30 }, (_, i) => `Fix \`parse_type_${i}\` in \`src/parser/type_${i}.rs\` ([#${12000 + i}](https://github.com/acme/widget/pull/${12000 + i}))`).join("\n");
        // A 3.3 KB Rust paragraph of code spans and links.
        const prose = Array.from({ length: 28 }, (_, i) => `The \`try_parse_ts_${i}\` helper now calls \`skip_trivia\` before \`bump_any\`, see [the spec](https://tc39.es/ecma262/#sec-${i}).`).join(" ");
        for (const [body, codes, links] of [[`## Changes\n\n${changes}`, 60, 30], [prose, 84, 28]] as const) {
            const html = page(body);
            expect([html.match(/<code>/g)?.length, html.match(/class="md-link"/g)?.length, html.includes("`")]).toEqual([codes, links, false]);
        }
        const t0 = performance.now();
        const html = page(`${"*".repeat(200)}${"lorem ipsum dolor sit amet ".repeat(2420)}`);
        expect(performance.now() - t0).toBeLessThan(1000);
        expect(html.startsWith(`<p>${"*".repeat(200)}lorem`)).toBe(true);
    });

    it("lexes each alert's lead once, at lexing, against the description's budget: rendering lexes nothing", () => {
        const alerts = Array.from({ length: 12 }, () => `> [!NOTE]\n> ${fill("*a* _b_ ", 1900)}`).join("\n\n");
        const tokens = lexMarkdown(alerts);
        const lexing = [jest.spyOn(Lexer, "lexInline"), jest.spyOn(Lexer.prototype, "inlineTokens"), jest.spyOn(Lexer.prototype, "blockTokens")];
        try {
            const [html] = [markdownHtml(tokens, "page"), markdownHtml(tokens, "card")];
            expect(lexing.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0]);
            const leads = [...dom(html).querySelectorAll(".md-alert")].map((a) => a.querySelectorAll("p")[1]);
            expect(leads.map((p) => p.querySelector("em") !== null)).toEqual([...Array(8).fill(true), ...Array(4).fill(false)]);
            expect(leads[11].textContent!.startsWith("*a* _b_")).toBe(true);
        } finally {
            for (const spy of lexing) spy.mockRestore();
        }
        expect(page("> [!WARNING]  \n> `code` first [link](u).")).toBe('<blockquote class="md-alert warning"><p><strong>Warning</strong></p><p><code>code</code> first <span class="md-link" title="u">link</span>.</p></blockquote>');
        expect(page("> [!TIP] same line *em*")).toBe('<blockquote class="md-alert tip"><p><strong>Tip</strong></p><p>same line <em>em</em></p></blockquote>');
    });

    it("lexes each description once while it is among the last few, and gives every caller the same tokens", () => {
        const blocks = jest.spyOn(Lexer.prototype, "blockTokens");
        try {
            const body = `Once, *at* ${Date.now()}.`;
            const first = lexMarkdown(body);
            expect(lexMarkdown(body)).toBe(first);
            expect(blocks.mock.calls.filter(([src]) => src === body)).toHaveLength(1);
            for (let i = 0; i < 4; i++) lexMarkdown(`${body} ${i}`);
            expect(lexMarkdown(body)).not.toBe(first);
            expect(lexMarkdown(body)).toEqual(first);
            expect(blocks.mock.calls.filter(([src]) => src === body)).toHaveLength(2);
        } finally {
            blocks.mockRestore();
        }
    });
});

describe("titles", () => {
    it("split on backticks into text and code, for the card and the panel", () => {
        expect(segments("Add `data` property to `HTTPError`")).toEqual([
            { text: "Add ", code: false },
            { text: "data", code: true },
            { text: " property to ", code: false },
            { text: "HTTPError", code: true },
        ]);
        expect(segmentsHtml(segments("Escape `<b>` & <i>"))).toBe("Escape <code>&lt;b&gt;</code> &amp; &lt;i&gt;");
    });

    it("show GitHub's emoji shortcodes as GitHub does, in titles and descriptions, never in code, and leave unknown names", () => {
        expect(emojify(":tada: feat: graceful cookie transition")).toBe("🎉 feat: graceful cookie transition");
        expect(emojify("node:events: single listeners")).toBe("node:events: single listeners");
        expect(segments(":rocket: ship `:tada:`")).toEqual([
            { text: "🚀 ship ", code: false },
            { text: ":tada:", code: true },
        ]);
        expect(markdownHtml(lexMarkdown("Done :sparkles: and `:bug:`"), "card")).toBe("<p>Done ✨ and <code>:bug:</code></p>");
    });
});
