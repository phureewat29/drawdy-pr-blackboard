import { beforeAll, describe, expect, it } from "@jest/globals";
import { honoFixture, reviewOf } from "../../test/fixture.ts";
import { CARD, firstLineOf, fullFileMessage, fullFileOf, pinCard } from "../card.ts";
import { allLines } from "../diff.ts";
import type { Review } from "../model.ts";

let review: Review;
let raw: ReadonlyMap<string, string>;
beforeAll(async () => {
    const saved = honoFixture();
    raw = saved.raw;
    review = await reviewOf(saved);
});

/** The read tier's limit, as the driver passes it. */
const LIMIT = 400_000;
const pin = (name: string) => review.pins.find((p) => p.name === name)!;
/** A card's whole file as the pane shows it: the file at the head commit, opened at the card's first line. */
const pageOf = (name: string, text: string | null = raw.get(pin(name).path!) ?? null) =>
    fullFileOf(pin(name), review, text, LIMIT, firstLineOf(pinCard(pin(name), review)));
/** The page's lines: each one's number, classes, whether it has the + sign, and its code. */
const linesOf = (html: string) =>
    [...html.matchAll(/<p(?: class="([^"]*)")?><i>(\d+)<\/i>(<b>\+<\/b>)?<code[^>]*>(.*?)<\/code><\/p>/g)].map(([, classes, n, sign, code]) => ({ n: Number(n), classes: classes ?? "", sign: !!sign, code }));
const numbered = (html: string, has: string) => linesOf(html).flatMap((l) => (l.classes.split(" ").includes(has) ? [l.n] : []));

describe("a card's whole file", () => {
    it("shows every line of the file at the head commit, numbered from 1, under its path and the commit it comes from", () => {
        const { html } = pageOf("compose()");
        expect(linesOf(html).map((l) => l.n)).toEqual(Array.from({ length: 77 }, (_, i) => i + 1));
        expect(html).toContain(`<header class="file"><span class="path"><span class="dir">src/</span><span class="base">compose.ts</span></span><span class="where">PR head ${review.pr.headSha.slice(0, 7)} · 77 lines</span></header>`);
        // The code is the file's, escaped.
        expect(linesOf(html)[17].code).toContain("compose = &lt;E");
        expect(html).not.toContain("compose = <E");
    });

    it("marks the PR's added lines as the cards do: tinted, with +, an edit's changed words marked", () => {
        const { html } = pageOf("compose()");
        const added = allLines(review.files.find((f) => f.path === "src/compose.ts")!.hunks).flatMap((l) => (l.t === "add" ? [l.n!] : []));
        expect(added).toEqual([4, 5, 6, 56, 57, 58, 59]);
        expect(numbered(html, "add")).toEqual(added);
        expect(linesOf(html).flatMap((l) => (l.sign ? [l.n] : []))).toEqual(added);
        expect(linesOf(html)[57].code).toBe("            context.error = err<mark>or</mark>");
        // The cards' own rules colour them.
        expect(html).toContain(".add { background: var(--add-bg); } .add > i { background: var(--add-gut); } .add > b { color: var(--add); }");
    });

    it("marks the card's own lines along a rail: a declaration's, a file card's ranges, none for a card about its whole file", () => {
        expect(numbered(pageOf("compose()").html, "own")).toEqual(Array.from({ length: 60 }, (_, i) => 18 + i));
        expect(numbered(pageOf("toError()").html, "own")).toEqual([4, 5]);
        expect(numbered(pageOf("hono-base.ts imports").html, "own")).toEqual([7]);
        expect(numbered(pageOf("compose.test.ts").html, "own")).toEqual([]);
        expect(pageOf("compose()").html).toContain(".lines > p.own > i { color: var(--ink2); box-shadow: inset 3px 0 0 var(--ink3); }");
    });

    it("opens at the card's first line, as Read all opens at its line, else at the first added line", () => {
        expect(numbered(pageOf("compose()").html, "focus")).toEqual([18]);
        expect(numbered(pageOf("hono-base.ts imports").html, "focus")).toEqual([4]);
        expect(numbered(pageOf("compose.test.ts").html, "focus")).toEqual([235]);
        const compose = pin("compose()");
        expect(numbered(fullFileOf(compose, review, raw.get("src/compose.ts")!, LIMIT, null).html, "focus")).toEqual([4]);
        // Read all's script, which runs on its own in the page.
        const { html } = pageOf("compose()");
        const script = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));
        expect(script).toContain('querySelector(".focus")');
        expect(() => new Function(script)).not.toThrow();
    });

    it("is highlighted as the cards are, each colour a short tag, so a long file's page stays small", () => {
        const { html } = pageOf("compose()");
        expect(linesOf(html)[17].code).toBe("<k>export</k> <k>const</k> compose = &lt;E <k>extends</k> <t>Env</t> = <t>Env</t>&gt;(");
        expect(html.slice(html.indexOf('<div class="lines"'))).not.toContain("<span");
        expect(html).toContain("k { color: var(--k); } s { color: var(--s); text-decoration: none; }");
        expect(html).toContain("@media (prefers-color-scheme: dark)");
    });

    it("wraps a long line under its own indent, and gives a short one no style for it", () => {
        const { html } = pageOf("compose()");
        expect(html).toContain('<p class="add"><i>5</i><b>+</b><code style="padding-left:4ch;text-indent:-4ch">  err <k>instanceof</k>');
        expect(html).toContain('<p class="own focus"><i>18</i><code><k>export</k>');
    });

    it("is as tall as its lines, a long line counted per row it wraps to", () => {
        const three = fullFileOf(pin("compose()"), review, "a\nb\nc\n", LIMIT, null);
        expect(three.height(720)).toBe(CARD.header + 3 * CARD.row + CARD.padBottom);
        // 300 characters wrap to 4 rows of a code column 656 wide.
        const long = fullFileOf(pin("compose()"), review, `a\n${"x".repeat(300)}\nc\n`, LIMIT, null);
        expect(long.height(720)).toBe(three.height(720) + 3 * CARD.row);
        expect(pageOf("compose()").height(720)).toBeGreaterThan(77 * CARD.row);
    });

    it("says plainly why it can't show a file: not text, over the read limit, empty, or not sent by GitHub", () => {
        const say = (text: string | null) => fullFileOf(pin("compose()"), review, text, LIMIT, 18).html;
        const header = `<span class="base">compose.ts</span></span><span class="where">PR head ${review.pr.headSha.slice(0, 7)}</span></header>`;
        expect(say("x".repeat(LIMIT + 1))).toContain(`${header}<p class="note">This file is 400,001 characters long, and PR Blackboard shows files up to 400,000.</p>`);
        expect(say("x".repeat(LIMIT))).toContain('<div class="lines"');
        const png = "\u0089PNG\r\n\u001a\n\u0000\u0000\u0000\rIHDR";
        expect(say(png)).toContain('<p class="note">This file isn&#39;t text, so PR Blackboard can&#39;t show it.</p>');
        expect(say(png + "x".repeat(LIMIT))).toContain("This file isn&#39;t text");
        expect(say("")).toContain('<p class="note">This file is empty.</p>');
        expect(say(null)).toContain('<p class="note">PR Blackboard couldn&#39;t read this file from GitHub. Try again in a moment.</p>');
        // While it loads, the same header over the words.
        expect(fullFileMessage("src/compose.ts", review.pr.headSha, "Reading the file…").html).toContain(`${header}<p class="note">Reading the file…</p>`);
    });

    it("drops a Windows line ending, and numbers a file with no last line break as one with it", () => {
        const crlf = fullFileOf(pin("compose()"), review, "a\r\nb\r\nc", LIMIT, null).html;
        expect(linesOf(crlf).map((l) => [l.n, l.code])).toEqual([
            [1, "a"],
            [2, "b"],
            [3, "c"],
        ]);
    });

    it("builds a 5,000-line file's page quickly, under three times the file's size", () => {
        const source = raw.get("src/hono.test.ts")!.split("\n");
        const text = Array.from({ length: 5000 }, (_, i) => source[i % source.length]).join("\n");
        const started = performance.now();
        const { html } = fullFileOf(pin("hono.test.ts"), review, text, LIMIT, 1443);
        const took = performance.now() - started;
        expect(linesOf(html)).toHaveLength(5000);
        expect(html.length).toBeLessThan(text.length * 3);
        // About 30 ms on a laptop; the bound leaves room for a busy machine.
        expect(took).toBeLessThan(1000);
    });
});
