/**
 * @jest-environment jsdom
 */
import { describe, expect, it } from "@jest/globals";
import { honoFixture } from "../test/fixture.ts";
import { EVERY_BLOCK } from "../test/synthetic.ts";
import { MAX_BODY, emojify, escapeText, lexMarkdown, markdownBlocks, markdownHeight, markdownHtml, segments, segmentsHtml } from "./markdown.ts";

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

    it("folds a details block to ▸ and its summary on the card, nested ones counted, and opens it in Read all", () => {
        const onCard = dom(card(EVERY_BLOCK));
        expect([...onCard.querySelectorAll(".md-details")].map((d) => d.textContent)).toEqual(["▸ Benchmarks"]);
        expect(onCard.textContent).not.toContain("Nested text");
        expect(onCard.textContent).not.toContain("Outer text");
        expect(onCard.querySelector("details")).toBeNull();
        const inPage = dom(page(EVERY_BLOCK));
        expect([...inPage.querySelectorAll("details > summary")].map((s) => s.textContent)).toEqual(["Benchmarks", "Inner"]);
        expect(inPage.querySelector("details details")?.textContent).toContain("Nested text.");
        expect(inPage.querySelector("details")?.textContent).toContain("Outer text.");
    });

    it("closes a details block the description left open", () => {
        expect(page("<details><summary>Open</summary>\n\nNever closed.")).toMatch(/<\/details>$/);
        expect(card("<details><summary>Open</summary>\n\nNever closed.")).toBe('<p class="md-details">▸ <strong>Open</strong></p>');
    });

    it("cuts a huge description at 20 000 characters before lexing", () => {
        const huge = `${"word ".repeat(13_000)}TAIL`;
        expect(huge.length).toBeGreaterThan(65_000);
        const html = card(huge);
        expect(html).not.toContain("TAIL");
        expect(html.length).toBeLessThan(MAX_BODY + 100);
    });

    it("estimates heights from GitHub's metrics, a little over", () => {
        expect(markdownHeight(lexMarkdown(""), 608)).toBe(0);
        expect(markdownHeight(lexMarkdown("A made-up pull request for testing the board layout."), 608)).toBe(Math.ceil(21 * 1.03));
        const hono = markdownHeight(lexMarkdown(honoFixture().pr.body), 608);
        expect(hono).toBeGreaterThan(500);
        expect(hono).toBeLessThan(700);
        expect(markdownHeight(lexMarkdown("<details><summary>X</summary>\n\nlong\n\nlong\n\n</details>"), 608)).toBe(Math.ceil(21 * 1.03));
    });

    it("lets a heading's margin above collapse into the block before it, and gives the first block none", () => {
        // h2: 34 tall, 24 above, 16 below.
        expect(markdownBlocks(lexMarkdown("## First\n\nText.\n\n## Second\n\nText."), 608)).toEqual([34 + 16, 21 + 16, 34 + 24, 21 + 16]);
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
