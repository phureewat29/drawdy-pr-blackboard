import { beforeAll, describe, expect, it } from "@jest/globals";
import { excalidrawFixture, honoFixture, reviewOf } from "../test/fixture.ts";
import { twoThreads } from "../test/synthetic.ts";
import { CARD, cardHtml, changedSpan, declarationRows, foldAt, foldsOf, linkGroups, pinCard, prCard, prCardHtml, readAllOf, unpinnedText, type CardModel, type Row } from "./card.ts";
import type { Review } from "./model.ts";
import { blocksHeight, lexMarkdown, markdownBlocks } from "./markdown.ts";

let review: Review;
beforeAll(async () => {
    review = await reviewOf(honoFixture());
});
const pin = (name: string) => review.pins.find((p) => p.name === name)!;
const card = (name: string) => pinCard(pin(name), review);
const text = (r: Row) => (r.kind === "line" ? `${r.line.t === "add" ? "+" : r.line.t === "del" ? "−" : " "}${r.call ? "→" : " "}${r.line.n ?? r.line.o}` : r.kind === "fold" ? `⋯${r.count}${r.tail ? " Read all" : ""}` : r.kind);

describe("change cards", () => {
    let dispatch: CardModel;
    beforeAll(() => {
        dispatch = card("#dispatch()");
    });

    it("keep the first line, the changes with two lines around, and every call row, folding the rest", () => {
        expect(dispatch.rows.map(text)).toEqual([
            "  411", "⋯4", "  416", "⋯25", " →442", "⋯6", "  449", "  450", "− 450", "+→451", "  452", "  453", "  454", " →455", "⋯12", " →468", "⋯3 Read all",
        ]);
        expect(dispatch.rows.length).toBeLessThanOrEqual(CARD.maxRows);
    });

    it("start each string at the row that makes the link", () => {
        const row = (id: string) => dispatch.rows[dispatch.anchors[id]];
        const handleError = row("calls:src/hono-base.ts:411>src/hono-base.ts:405");
        expect(handleError.kind === "line" && handleError.line.n).toBe(451);
        const compose = row("calls:src/hono-base.ts:411>src/compose.ts:18");
        expect(compose.kind === "line" && compose.line.n).toBe(455);
    });

    it("list their fold rows by top and the line Read all opens at, so a click finds them from the card's mark", () => {
        const folds = foldsOf(dispatch);
        expect(folds.map(([y]) => (y - CARD.header) / CARD.row)).toEqual(dispatch.rows.flatMap((r, i) => (r.kind === "fold" ? [i] : [])));
        expect(folds[0][1]).toBe(412);
        expect(foldAt(folds, folds[1][0] + 19)).toEqual(folds[1]);
        expect(foldAt(folds, folds[1][0] + 20)).toBeNull();
    });

    it("size to the longest kept line, 480 to 880, on the 20 px grid", () => {
        for (const p of review.pins.filter((x) => x.kind !== "pr")) {
            const c = pinCard(p, review);
            expect(c.width).toBeGreaterThanOrEqual(CARD.minWidth);
            expect(c.width).toBeLessThanOrEqual(CARD.maxWidth);
            expect(c.height).toBe(CARD.header + c.rows.length * CARD.row + CARD.padBottom);
        }
    });
});

describe("folds", () => {
    let boards: Review[];
    beforeAll(async () => {
        boards = await Promise.all([honoFixture(), excalidrawFixture(), twoThreads()].map(reviewOf));
    });

    it("never fold a single line, at the end of a card too: it shows in the fold's place", () => {
        for (const r of boards) for (const p of r.pins.filter((x) => x.kind !== "pr")) expect(pinCard(p, r).rows.filter((row) => row.kind === "fold" && !row.cut && row.count === 1)).toEqual([]);
    });
});

describe("card headers", () => {
    const html = (name: string) => cardHtml(card(name), pin(name), "light");

    it("carry no link rows, file dots, CHANGED, FILE or counts in words", () => {
        for (const p of review.pins.filter((x) => x.kind !== "pr")) {
            const page = cardHtml(pinCard(p, review), p, "light");
            for (const cut of ['class="lk"', 'class="links"', 'class="dot"', ">CHANGED<", ">FILE<", "×"]) expect([p.name, page.includes(cut)]).toEqual([p.name, false]);
        }
    });

    it("write the TESTS chip in the card's background colour, readable on its blue in both themes", () => {
        expect(html("compose.test.ts")).toContain(".chip.test { background: var(--blue); color: var(--bg); }");
    });

    it("mark a new function with a green NEW chip, and nothing on changed code", () => {
        expect(html("toError()")).toContain('<span class="chip new">NEW</span>');
        expect(html("toError()")).toMatch(/\.chip\.new \{ background: var\(--add-gut\); color: var\(--add\); \}/);
        expect(html("#dispatch()")).not.toContain('class="chip');
    });

    it("end with the counts: no link, since nothing on a card can open a page", () => {
        expect(html("compose()")).toMatch(/<span class="counts">.*<\/span><\/header>/);
        expect(html("compose()")).not.toContain("↗");
    });

    it("name the file by its path in the repo", () => {
        expect(html("compose()")).toContain('<span class="where">src/compose.ts · 18–77</span>');
    });

    it("take the theme they are pinned in, whatever the browser prefers", () => {
        expect(html("compose()")).toContain("color-scheme: light;");
        expect(cardHtml(card("compose()"), pin("compose()"), "dark")).toContain("color-scheme: dark; --bg: #1f1f23;");
        expect(html("compose()")).not.toContain("prefers-color-scheme");
    });
});

describe("the panel's link lines", () => {
    it("name every link of a card by kind, drawn or not, a context link by what its references do", () => {
        const lines = (name: string) => linkGroups(pin(name), review).map((g) => `${g.word} ${g.links.map((l) => l.name).join(" · ")}`);
        expect(lines("#dispatch()")).toEqual(["called by fetch()", "calls #handleError() · compose()"]);
        expect(lines("compose()")).toEqual(["called by #dispatch()", "tested by compose.test.ts", "imported by hono-base.ts", "calls toError()"]);
        expect(lines("toError()")).toEqual(["called by #handleError() · compose()", "imported by hono-base.ts"]);
        expect(lines("hono-base.ts imports")).toEqual(["imports compose() · toError()"]);
        expect(lines("hono.test.ts")).toEqual(["tests fetch() · onError()"]);
        expect(lines("fetch()")).toEqual(["tested by hono.test.ts", "calls #dispatch()"]);
        expect(linkGroups(pin("fetch()"), review).flatMap((g) => g.word)).not.toContain("mentions");
    });
});

describe("other cards", () => {
    it("show an unchanged caller with a dashed border drawn by the page, and no +/− gutter", () => {
        const fetch = card("fetch()");
        expect(fetch.rows.length).toBeLessThanOrEqual(CARD.contextRows);
        const html = cardHtml(fetch, pin("fetch()"), "light");
        expect(html).toContain('<body class="context">');
        expect(html).toContain("border: 1.5px dashed");
        expect(html).toContain("UNCHANGED");
        expect(html).not.toContain("<b>+</b>");
    });

    it("fold tests to their case names, each with its bare line number in the gutter, cases nested under their group", () => {
        const tests = card("hono.test.ts");
        expect(tests.rows.filter((r) => r.kind === "case")).toHaveLength(7);
        const html = cardHtml(card("compose.test.ts"), pin("compose.test.ts"), "light");
        expect(html).not.toContain("l. ");
        expect(html).toMatch(/<div class="case group"><i>\d+<\/i><b class="a">\+<\/b><span>compose with non-Error throws<\/span><\/div>/);
        const nested = card("compose.test.ts").rows.filter((r) => r.kind === "case" && !r.test.group);
        expect(nested.length).toBeGreaterThan(0);
        expect(nested.every((r) => r.kind === "case" && r.depth === 1)).toBe(true);
        expect(html).toContain('<span style="padding-left:12px">');
    });

    it("end in Read all whenever they hide code: a test card's bodies, or the end of a line cut at the card's edge", () => {
        const last = (name: string) => card(name).rows[card(name).rows.length - 1];
        expect(last("compose.test.ts")).toEqual({ kind: "info", text: "Test code · Read all", readAll: true });
        // Every row that opens Read all has the fold row's shape: ⋯, then what it hides, then Read all underlined.
        for (const name of ["compose.test.ts", "toError()", "compose()"]) expect(cardHtml(card(name), pin(name), "light")).toMatch(/<div class="fold( cases)?"><span class="dots">⋯<\/span> [^<]+ · <span class="ra">Read all<\/span><\/div><\/div>/);
        expect(last("hono.test.ts")).toMatchObject({ kind: "info", readAll: true });
        // toError()'s one changed line runs past an 880-wide card; Read all opens at it.
        const toError = card("toError()");
        expect(toError.width).toBe(CARD.maxWidth);
        expect(last("toError()")).toMatchObject({ kind: "fold", tail: true, cut: true, count: 1, from: 5 });
        expect(foldsOf(toError)).toEqual([[CARD.header + (toError.rows.length - 1) * CARD.row, 5]]);
        expect(cardHtml(toError, pin("toError()"), "light")).toContain('1 line cut short · <span class="ra">Read all</span>');
        // A card that fits its lines adds no such row.
        expect(card("#handleError()").rows.some((r) => r.kind === "fold" && r.cut)).toBe(false);
    });

    it("show a file's excerpt with no row repeating the line numbers", () => {
        expect(card("hono-base.ts imports").rows.every((r) => r.kind === "line")).toBe(true);
    });

    it("escape code", () => {
        const html = cardHtml(card("compose()"), pin("compose()"), "light");
        expect(html).toContain("compose = &lt;E");
        expect(html).not.toContain("compose = <E");
    });
});

describe("PR card", () => {
    it("has the header every card has, then the title, author and counts, then the description as Markdown", () => {
        const html = prCardHtml(review, "light");
        expect(html).toContain('<header><span class="prchip">honojs/hono#5513</span><span class="state"');
        expect(html).toContain('>Merged</span></header>');
        expect(html).not.toContain("↗");
        expect(html).toContain("usualoma · 4 files · ");
        expect(html).toContain('<div class="md"><p>A value thrown from a handler or middleware that is not an <code>Error</code> instance');
        expect(html).not.toContain("not pinned");
        expect(html).not.toContain("<script");
    });

    it("is 640 wide, cuts hono's long description after its last whole block that fits, never on a heading, and ends in ⋯ Read all", () => {
        const m = prCard(review);
        const all = lexMarkdown(review.pr.body);
        expect([m.width, m.titleLines, m.cut]).toEqual([640, 1, false]);
        expect(m.estimate).toBeGreaterThan(500);
        expect(m.tokens.length).toBeLessThan(all.length);
        expect(m.tokens.at(-1)!.type).not.toBe("heading");
        expect(m.description).toBe(blocksHeight(markdownBlocks(all, 608).slice(0, m.tokens.length)));
        expect(m.description).toBeLessThanOrEqual(500);
        // The next block would not have fitted whole.
        expect(blocksHeight(markdownBlocks(all, 608).slice(0, m.tokens.length + 2))).toBeGreaterThan(500);
        // The fold row follows the text as Chrome lays it out, up to a tenth higher than estimated: a click from there opens Read all.
        expect(m.fold).toBe(m.height - 32 - 16 - Math.ceil(m.description * 0.1));
        expect(m.height).toBe(56 + 16 + 26 + 24 + 33 + m.description + 32 + 16);
        const html = prCardHtml(review, "dark");
        expect(html).toContain('<div class="more"><span class="dots">⋯</span> <span class="ra">Read all</span></div>');
        expect(html).toContain(`.desc { position: relative; max-height: ${m.description}px; overflow: hidden; }`);
        // Only the blocks it shows: nothing is cut halfway.
        expect(html).toContain("A non-Error thrown from a handler");
        expect(html).not.toContain("The author should do the following");
    });

    it("shows a short description whole, and none at all, with no rule, when the pull request has none", () => {
        const short = { ...review, pr: { ...review.pr, body: "Fixes the thing." } };
        expect([prCard(short).fold, prCard(short).cut]).toEqual([null, false]);
        expect(prCardHtml(short, "light")).not.toContain("Read all");
        const none = { ...review, pr: { ...review.pr, body: "" } };
        expect(prCard(none).description).toBe(0);
        expect(prCardHtml(none, "light")).not.toContain('class="rule"');
    });

    it("shows a description that fits in 500 whole, with no fold row: Read all would show nothing more", () => {
        const body = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} says one short thing.`).join("\n\n");
        const m = prCard({ ...review, pr: { ...review.pr, body } });
        expect(m.estimate).toBeGreaterThan(360);
        expect(m.estimate).toBeLessThanOrEqual(500);
        expect([m.description, m.cut, m.fold, m.tokens.length]).toEqual([m.estimate, false, null, 12]);
        // A little past 500, by less than the fold row would take: still whole, as a fold row would hide no more than it takes.
        const over = Array.from({ length: 14 }, (_, i) => `Paragraph ${i} says one short thing.`).join("\n\n");
        const n = prCard({ ...review, pr: { ...review.pr, body: over } });
        expect(n.estimate).toBeGreaterThan(500);
        expect([n.description, n.fold, n.tokens.length]).toEqual([n.estimate, null, 14]);
    });

    it("cuts inside a first block too long for the card, under a fade, the only one it draws", () => {
        const body = "```\n" + Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n") + "\n```\n\nAfter.";
        const m = prCard({ ...review, pr: { ...review.pr, body } });
        expect([m.description, m.cut, m.fold]).toEqual([500, true, m.height - 32 - 16]);
        expect(prCardHtml({ ...review, pr: { ...review.pr, body } }, "light")).toContain("height: 48px; background: linear-gradient");
        expect(prCardHtml(review, "light")).not.toContain("linear-gradient");
    });

    it("renders inline code in the title as code", () => {
        const html = prCardHtml({ ...review, pr: { ...review.pr, title: "Add `data` property" } }, "light");
        expect(html).toContain("Add <code>data</code> property</h1>");
    });

    it("says what the card limit left off, and makes room for it", () => {
        expect(unpinnedText({ functions: 28, files: 2 })).toBe("28 functions and 2 files not pinned");
        expect(unpinnedText({ functions: 1, files: 0 })).toBe("1 function not pinned");
        expect(unpinnedText({ functions: 0, files: 1 })).toBe("1 file not pinned");
        expect(unpinnedText({ functions: 0, files: 0 })).toBeNull();
        const short = { ...review, unpinned: { functions: 3, files: 0 } };
        expect(prCardHtml(short, "light")).toContain('<div class="unpinned">3 functions not pinned</div>');
        expect(prCard(short).height).toBe(prCard(review).height + 20);
    });
});

describe("changedSpan", () => {
    it("finds the stretch between the common start and end", () => {
        expect(changedSpan("catch((err: Error) => x)", "catch((err: unknown) => x)")).toEqual({ start: 12, endA: 17, endB: 19 });
    });

    it("gives up when two lines share too little to be worth marking", () => {
        expect(changedSpan("return a", "throw new Error(b)")).toBeNull();
    });
});

describe("Read all", () => {
    let read: string;
    const compose = () => pin("compose()");
    beforeAll(() => {
        read = readAllOf(compose(), review, "dark", 56).html;
    });

    it("shows the card's header, then the whole declaration, unified and wrapped, with no folds or tools", () => {
        const rows = declarationRows(compose(), review.files.find((f) => f.path === "src/compose.ts")!, review);
        expect(rows.every((r) => r.kind === "line")).toBe(true);
        expect(rows.filter((r) => r.kind === "line" && r.line.t !== "del")).toHaveLength(77 - 18 + 1);
        expect(read).toContain("white-space: pre-wrap");
        expect(read).toContain("color-scheme: dark");
        // ✕ is the overlay's own button, drawn over the header's right end.
        expect(read).toContain('<header><span class="name">compose()</span><span class="where">src/compose.ts · 18–77</span><span class="counts"><span class="a">+4</span> <span class="d">−3</span></span></header>');
        for (const cut of ["data-do=", 'class="splitv"', "<button"]) expect(read).not.toContain(cut);
    });

    it("marks the rows that call another card with →, as the card does", () => {
        const onCard = card("compose()").rows.filter((r) => r.kind === "line" && r.call).map((r) => r.kind === "line" && r.line.n);
        const inReadAll = declarationRows(compose(), review.files.find((f) => f.path === "src/compose.ts")!, review)
            .filter((r) => r.kind === "line" && r.call)
            .map((r) => r.kind === "line" && r.line.n);
        expect(onCard.length).toBeGreaterThan(0);
        expect(inReadAll).toEqual(onCard);
        expect(read).toContain("<u>→</u>");
    });

    it("wraps a long line under its own indent", () => {
        expect(read).toMatch(/<code style="padding-left:6ch;text-indent:-6ch">/);
    });

    it("opens at the folded lines, or the first change, with a script that runs on its own", () => {
        expect(read).toContain('class="r focus ');
        const script = read.slice(read.lastIndexOf("<script>") + 8, read.lastIndexOf("</script>"));
        expect(() => new Function(script)).not.toThrow();
        expect(readAllOf(compose(), review, "light", null).html).not.toContain("focus ");
    });

    it("shows the PR card's title, meta and whole description, details open to a click", () => {
        const page = readAllOf(pin("The pull request"), review, "light", null).html;
        expect(page).toContain('<span class="prchip">honojs/hono#5513</span>');
        expect(page).toContain("<h3>Behavior change</h3>");
        expect(page).not.toContain('class="desc"');
        const details = readAllOf(pin("The pull request"), { ...review, pr: { ...review.pr, body: "<details><summary>More</summary>\n\nHidden text.\n\n</details>" } }, "light", null).html;
        expect(details).toContain("<details><summary>More</summary><p>Hidden text.</p></details>");
    });

    it("shows a test or file card's whole diff, gaps between hunks folded", () => {
        const tests = readAllOf(pin("hono.test.ts"), review, "light", null).html;
        expect(tests).toContain('<span class="where">src/hono.test.ts</span>');
        expect(tests).toMatch(/<div class="gap"><span class="dots">⋯<\/span> \d+ lines<\/div>/);
        expect(tests).not.toContain("lines 1–");
    });

    it("is as tall as its page: a short function short, a long one past the overlay's 640, a long line counted per row it wraps to", () => {
        const toError = readAllOf(pin("toError()"), review, "dark", null);
        expect(toError.height(720)).toBeLessThan(200);
        expect(toError.height(520)).toBeGreaterThan(toError.height(720) - 1);
        expect(readAllOf(compose(), review, "dark", null).height(720)).toBeGreaterThan(640);
        const description = readAllOf(pin("The pull request"), review, "light", null);
        expect(description.height(720)).toBeGreaterThan(prCard(review).height);
        expect(readAllOf(pin("The pull request"), { ...review, pr: { ...review.pr, body: "<details><summary>More</summary>\n\nHidden.\n\n</details>" } }, "light", null).height(720)).toBe(Infinity);
    });
});
