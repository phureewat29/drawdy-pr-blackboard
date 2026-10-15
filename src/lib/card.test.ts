import { beforeAll, describe, expect, it } from "@jest/globals";
import { excalidrawFixture, honoFixture, reviewOf } from "../test/fixture.ts";
import { twoThreads } from "../test/synthetic.ts";
import { CARD, PALETTES, cardHtml, foldAt, foldsOf, fullFileRow, linkGroups, pinCard, prCard, prCardHtml, readAllOf, unpinnedText, type CardModel, type Row } from "./card.ts";
import { headerName } from "./card/grid.ts";
import { changedSpan } from "./card/lines.ts";
import { declarationRows } from "./card/rows.ts";
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
            "  411", "⋯4", "  416", "⋯25", " →442", "⋯6", "  449", "  450", "− 450", "+→451", "  452", "  453", "  454", " →455", "⋯12", " →468", "⋯3 Read all", "full",
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

describe("header names", () => {
    const method = (name: string, path = "homeassistant/components/mcp_server/config_flow.py") => ({ kind: "change" as const, name, path });

    it("cut a method's type from the left, never the method, when the name doesn't fit 52 % of the header", () => {
        expect(headerName(method("ModelContextServerProtocolConfigFlow.async_step_user()"), 880)).toBe("…ntextServerProtocolConfigFlow.async_step_user()");
        expect(headerName(method("GetAddrInfoRequestWithAVeryLongTypeName::then()", "src/dns.rs"), 480)).toBe("…VeryLongTypeName::then()");
        expect(headerName(method("Server.Start()", "srv/s.go"), 480)).toBe("Server.Start()");
    });

    it("show the method alone when fewer than 8 characters of its type would stay", () => {
        expect(headerName(method("ModelContextServerProtocolConfigFlow.async_step_user()"), 480)).toBe("async_step_user()");
        expect(headerName(method("_ApplyInferredDiscriminator._infer_discriminator_values_for_choice()", "pydantic/_internal/_discriminated_union.py"), 880)).toBe("_infer_discriminator_values_for_choice()");
    });

    it("cut a property's name the same way, and leave a JavaScript name, a class and a file to the header's own cut", () => {
        expect(headerName(method("TrainingArgumentsForAVeryLongModel._no_sync_in_gradient_accumulation", "src/training_args.py"), 880)).toBe("…VeryLongModel._no_sync_in_gradient_accumulation");
        const long = "averyveryveryverylongnamespace.handleEveryErrorThrownInsideTheHandler()";
        expect(headerName(method(long, "src/hono-base.ts"), 480)).toBe(long);
        expect(headerName(method("class ModelContextServerProtocolConfigFlowWithOptions", "a.py"), 480)).toBe("class ModelContextServerProtocolConfigFlowWithOptions");
        expect(headerName({ kind: "test", name: "test_model_context_server_protocol_config_flow.py", path: "tests/test_model_context_server_protocol_config_flow.py" }, 480)).toBe("test_model_context_server_protocol_config_flow.py");
    });

    it("cut only on the card: Read all keeps the whole name", () => {
        const p = { ...pin("toError()"), name: "ModelContextServerProtocolConfigFlow.async_step_user()", path: "a/config_flow.py" };
        const narrow = { ...card("toError()"), width: 480 };
        expect(cardHtml(narrow, p)).toContain('<span class="name">async_step_user()</span>');
        expect(readAllOf(p, { ...review, files: [] }, null).html).toContain('<span class="name">ModelContextServerProtocolConfigFlow.async_step_user()</span>');
    });

    it("widen a Python, Go, Rust or Java card to fit its whole name, up to 880, so a short type stays", () => {
        const sized = (name: string, path: string) => pinCard({ ...pin("toError()"), name, path, head: [], from: 1, to: 1 }, { files: [], links: [] });
        const rust = sized("Printer::print_semicolon_if_needed()", "src/js_printer/lib.rs");
        expect(rust.width).toBe(Math.ceil((36 * 9.2) / 0.52 + 28) + 1);
        expect(headerName({ kind: "change", name: "Printer::print_semicolon_if_needed()", path: "src/js_printer/lib.rs" }, rust.width)).toBe("Printer::print_semicolon_if_needed()");
        expect(sized("ModelContextServerProtocolConfigFlow.async_get_options_flow()", "a/config_flow.py").width).toBe(880);
        // JavaScript and TypeScript cards keep their widths.
        expect(sized("averyveryveryverylongnamespace.handleEveryError()", "src/hono-base.ts").width).toBe(220 + (49 + "src/hono-base.ts".length) * 7);
    });
});

describe("a class card", () => {
    it("shows only its own lines: the lines of cards nested in it fold, with the blank lines above them", async () => {
        const source = "class Flow:\n    VERSION = 1\n\n    def first(self):\n        return self.second()\n\n    def second(self):\n        return 2\n";
        const lines = source.split("\n").slice(0, -1);
        const { pr } = honoFixture();
        const flow = await reviewOf({
            pr: { ...pr, changedFiles: 1 },
            files: [{ path: "app/flow.py", status: "added", additions: lines.length, deletions: 0, patch: `@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}` }],
            raw: new Map([["app/flow.py", source]]),
        });
        const named = (name: string) => flow.pins.find((p) => p.name === name)!;
        expect(flow.pins.map((p) => p.name)).toEqual(expect.arrayContaining(["class Flow", "Flow.first()", "Flow.second()"]));
        expect(pinCard(named("class Flow"), flow).rows.map(text)).toEqual(["+ 1", "+ 2", "⋯6 Read all", "full"]);
        expect(pinCard(named("Flow.first()"), flow).rows.map(text)).toEqual(["+ 4", "+→5", "full"]);
        // Without the nested cards on the board, the class shows all its lines: the whole file, so no View full file.
        expect(pinCard(named("class Flow"), { ...flow, pins: [named("class Flow")] }).rows.map(text)).toEqual(["+ 1", "+ 2", "+ 3", "+ 4", "+ 5", "+ 6", "+ 7", "+ 8"]);
    });
});

describe("card headers", () => {
    const html = (name: string) => cardHtml(card(name), pin(name));

    it("carry no link rows, file dots, CHANGED, FILE or counts in words", () => {
        for (const p of review.pins.filter((x) => x.kind !== "pr")) {
            const page = cardHtml(pinCard(p, review), p);
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

    it("carry both themes and show the one the reader's frame prefers, so each reader sees their own, live as they switch", () => {
        const page = html("compose()");
        expect(page).toContain(":root { color-scheme: light dark; --bg: #ffffff;");
        expect(page).toContain("@media (prefers-color-scheme: dark) { :root { --bg: #1f1f23;");
        for (const theme of ["light", "dark"] as const) for (const [k, v] of Object.entries(PALETTES[theme])) expect(page).toContain(`--${k}: ${v};`);
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
        const html = cardHtml(fetch, pin("fetch()"));
        expect(html).toContain('<body class="context">');
        expect(html).toContain("border: 1.5px dashed");
        expect(html).toContain("UNCHANGED");
        expect(html).not.toContain("<b>+</b>");
    });

    it("show an unchanged caller from a file the pull request leaves alone: its code, on the card and in Read all", () => {
        const fetch = pin("fetch()");
        const elsewhere = { ...review, files: review.files.filter((f) => f.path !== fetch.path) };
        const rows = pinCard(fetch, elsewhere).rows;
        expect(rows.some((r) => r.kind === "info")).toBe(false);
        expect(rows.map(text)).toEqual(card("fetch()").rows.map(text));
        expect(readAllOf(fetch, elsewhere, null).html).toContain("fetch");
        expect(readAllOf(fetch, elsewhere, null).html).not.toContain("couldn't read");
    });

    it("fold tests to their case names, each with its bare line number in the gutter, cases nested under their group", () => {
        const tests = card("hono.test.ts");
        expect(tests.rows.filter((r) => r.kind === "case")).toHaveLength(7);
        const html = cardHtml(card("compose.test.ts"), pin("compose.test.ts"));
        expect(html).not.toContain("l. ");
        expect(html).toMatch(/<div class="case group"><i>\d+<\/i><b class="a">\+<\/b><span>compose with non-Error throws<\/span><\/div>/);
        const nested = card("compose.test.ts").rows.filter((r) => r.kind === "case" && !r.test.group);
        expect(nested.length).toBeGreaterThan(0);
        expect(nested.every((r) => r.kind === "case" && r.depth === 1)).toBe(true);
        expect(html).toContain('<span style="padding-left:12px">');
    });

    it("end in Read all whenever they hide code: a test card's bodies, or the end of a line cut at the card's edge", () => {
        // The last row before View full file.
        const last = (name: string) => card(name).rows.filter((r) => r.kind !== "full").pop()!;
        expect(last("compose.test.ts")).toEqual({ kind: "info", text: "Test code · Read all", readAll: true });
        // Every row that opens Read all has the fold row's shape: ⋯, then what it hides, then Read all underlined; View full file follows.
        for (const name of ["compose.test.ts", "toError()", "compose()"])
            expect(cardHtml(card(name), pin(name))).toMatch(/<div class="fold( cases)?"><span class="dots">⋯<\/span> [^<]+ · <span class="ra">Read all<\/span><\/div><div class="fold full( cases)?">/);
        expect(last("hono.test.ts")).toMatchObject({ kind: "info", readAll: true });
        // toError()'s one changed line runs past an 880-wide card; Read all opens at it.
        const toError = card("toError()");
        expect(toError.width).toBe(CARD.maxWidth);
        expect(last("toError()")).toMatchObject({ kind: "fold", tail: true, cut: true, count: 1, from: 5 });
        // Its last row but one, over View full file.
        expect(foldsOf(toError)).toEqual([[CARD.header + (toError.rows.length - 2) * CARD.row, 5]]);
        expect(cardHtml(toError, pin("toError()"))).toContain('1 line cut short · <span class="ra">Read all</span>');
        // A card that fits its lines adds no such row.
        expect(card("#handleError()").rows.some((r) => r.kind === "fold" && r.cut)).toBe(false);
    });

    it("show a file's excerpt with no row repeating the line numbers", () => {
        expect(card("hono-base.ts imports").rows.map((r) => r.kind)).toEqual([...Array(card("hono-base.ts imports").rows.length - 1).fill("line"), "full"]);
    });

    it("escape code", () => {
        const html = cardHtml(card("compose()"), pin("compose()"));
        expect(html).toContain("compose = &lt;E");
        expect(html).not.toContain("compose = <E");
    });
});

describe("View full file", () => {
    it("ends every code, test and file card: a fold row's shape, a file where ⋯ stands, its top kept for the card's mark", () => {
        for (const p of review.pins.filter((x) => x.kind !== "pr")) {
            const c = pinCard(p, review);
            expect([p.name, c.rows[c.rows.length - 1]]).toEqual([p.name, { kind: "full" }]);
            expect(fullFileRow(c)).toBe(CARD.header + (c.rows.length - 1) * CARD.row);
        }
        const html = cardHtml(card("compose()"), pin("compose()"));
        expect(html).toMatch(/<div class="fold full"><svg class="icon" [^>]+>(<path [^>]+\/>){4}<\/svg> <span class="ra">View full file<\/span><\/div><\/div><\/body>/);
        // Under the case names on a test card, as its Read all row is.
        expect(cardHtml(card("compose.test.ts"), pin("compose.test.ts"))).toContain('<div class="fold full cases">');
    });

    it("is left off a card that shows every line of its file at the head commit, and off a file the PR deletes", async () => {
        const { pr } = honoFixture();
        const files = [
            // Added whole: the patch holds every line, so the card shows the whole file.
            { path: "config.json", status: "added" as const, additions: 3, deletions: 0, patch: '@@ -0,0 +1,3 @@\n+{\n+  "a": 1\n+}' },
            // Read, three lines long: its one hunk shows all three.
            { path: "src/side.ts", status: "modified" as const, additions: 1, deletions: 1, patch: "@@ -1,3 +1,3 @@\n setup()\n-run(1)\n+run(2)\n stop()" },
            // Never read: the diff shows lines 1 to 3, but nothing says the file ends there.
            { path: "small.yml", status: "modified" as const, additions: 1, deletions: 1, patch: "@@ -1,3 +1,3 @@\n a: 1\n-b: 2\n+b: 3\n c: 4" },
            { path: "old.md", status: "removed" as const, additions: 0, deletions: 2, patch: "@@ -1,2 +0,0 @@\n-# Old\n-gone" },
        ];
        const r = await reviewOf({ pr: { ...pr, changedFiles: files.length }, files, raw: new Map([["src/side.ts", "setup()\nrun(2)\nstop()\n"]]) });
        expect(r.files.map((f) => [f.path, f.lines])).toEqual([["config.json", 3], ["src/side.ts", 3], ["small.yml", undefined], ["old.md", undefined]]);
        const kinds = (path: string) => pinCard(r.pins.find((p) => p.path === path)!, r).rows.map((row) => row.kind);
        expect(kinds("config.json")).toEqual(["line", "line", "line"]);
        expect(kinds("src/side.ts")).toEqual(["line", "line", "line", "line"]);
        expect(kinds("small.yml")).toEqual(["line", "line", "line", "line", "full"]);
        expect(kinds("old.md")).toEqual(["line", "line"]);
        // Had the file a fourth line, the same card would leave it out, and offer the whole file.
        const longer = { ...r, files: r.files.map((f) => (f.path === "src/side.ts" ? { ...f, lines: 4 } : f)) };
        expect(pinCard(longer.pins.find((p) => p.path === "src/side.ts")!, longer).rows.map((row) => row.kind)).toEqual(["line", "line", "line", "line", "full"]);
    });

    it("stays on a card about an unchanged file, whose length the review doesn't hold", () => {
        const fetch = pin("fetch()");
        const elsewhere = { ...review, files: review.files.filter((f) => f.path !== fetch.path) };
        expect(pinCard(fetch, elsewhere).rows.map((r) => r.kind).pop()).toBe("full");
    });
});

describe("PR card", () => {
    it("has the header every card has, then the title, author and counts, then the description as Markdown", () => {
        const html = prCardHtml(review);
        expect(html).toContain('<header><span class="prchip">honojs/hono#5513</span><span class="state"');
        expect(html).toContain('>Merged</span></header>');
        expect(html).not.toContain("↗");
        expect(html).toContain("usualoma · 4 files · ");
        expect(html).toContain('<div class="md"><p>A value thrown from a handler or middleware that is not an <code>Error</code> instance');
        expect(html).not.toContain("not pinned");
        expect(html).not.toContain("<script");
    });

    it("is 640 wide and shows hono's whole description, its height the whole estimate: no fold row, Read all or fade", () => {
        const m = prCard(review);
        expect([m.width, m.titleLines]).toEqual([640, 1]);
        expect(m.estimate).toBe(blocksHeight(markdownBlocks(lexMarkdown(review.pr.body), 608)));
        expect(m.height).toBe(56 + 16 + 26 + 24 + 33 + m.estimate + 16);
        expect(m.height).toBe(779);
        const html = prCardHtml(review);
        expect(html).toContain(`.desc { max-height: ${m.estimate}px; overflow: hidden; }`);
        // The last block shows, and nothing folds or fades.
        expect(html).toContain("The author should do the following");
        for (const gone of ["Read all", "⋯", 'class="more"', "linear-gradient"]) expect(html).not.toContain(gone);
    });

    it("shows a short description whole, and none at all, with no rule, when the pull request has none", () => {
        const short = { ...review, pr: { ...review.pr, body: "Fixes the thing." } };
        expect(prCardHtml(short)).toContain('<div class="md"><p>Fixes the thing.</p></div>');
        const none = { ...review, pr: { ...review.pr, body: "" } };
        expect([prCard(none).estimate, prCard(none).height]).toEqual([0, 56 + 16 + 26 + 24 + 16]);
        expect(prCardHtml(none)).not.toContain('class="rule"');
    });

    it("grows with a long description, block by block, and shows a block taller than the old fold whole", () => {
        const body = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} says one short thing.`).join("\n\n") + "\n\n```\n" + Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n") + "\n```";
        const long = { ...review, pr: { ...review.pr, body } };
        const m = prCard(long);
        expect(m.estimate).toBe(blocksHeight(markdownBlocks(lexMarkdown(body), 608)));
        expect(m.estimate).toBeGreaterThan(2000);
        expect(m.height).toBe(56 + 16 + 26 + 24 + 33 + m.estimate + 16);
        const html = prCardHtml(long);
        expect([html.includes("Paragraph 59 says"), html.includes("line 39"), html.includes("linear-gradient")]).toEqual([true, true, false]);
    });

    it("shows a details block open, its summary a bold line over what it holds: nothing on a card opens", () => {
        const html = prCardHtml({ ...review, pr: { ...review.pr, body: "<details><summary>More</summary>\n\nHidden text.\n\n</details>" } });
        expect(html).toContain('<p class="md-details"><strong>More</strong></p><p>Hidden text.</p>');
        expect(html).not.toMatch(/<(details|summary)\b/);
    });

    it("renders inline code in the title as code", () => {
        const html = prCardHtml({ ...review, pr: { ...review.pr, title: "Add `data` property" } });
        expect(html).toContain("Add <code>data</code> property</h1>");
    });

    it("says what the card limit left off, and makes room for it", () => {
        expect(unpinnedText({ functions: 28, files: 2 })).toBe("28 functions and 2 files not pinned");
        expect(unpinnedText({ functions: 1, files: 0 })).toBe("1 function not pinned");
        expect(unpinnedText({ functions: 0, files: 1 })).toBe("1 file not pinned");
        expect(unpinnedText({ functions: 0, files: 0 })).toBeNull();
        const short = { ...review, unpinned: { functions: 3, files: 0 } };
        expect(prCardHtml(short)).toContain('<div class="unpinned">3 functions not pinned</div>');
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
        read = readAllOf(compose(), review, 56).html;
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
        expect(readAllOf(compose(), review, null).html).not.toContain("focus ");
    });

    it("shows a test or file card's whole diff, gaps between hunks folded", () => {
        const tests = readAllOf(pin("hono.test.ts"), review, null).html;
        expect(tests).toContain('<span class="where">src/hono.test.ts</span>');
        expect(tests).toMatch(/<div class="gap"><span class="dots">⋯<\/span> \d+ lines<\/div>/);
        expect(tests).not.toContain("lines 1–");
    });

    it("is as tall as its page: a short function short, a long one past the pane's 640, a long line counted per row it wraps to", () => {
        const toError = readAllOf(pin("toError()"), review, null);
        expect(toError.height(720)).toBeLessThan(200);
        expect(toError.height(520)).toBeGreaterThan(toError.height(720) - 1);
        expect(readAllOf(compose(), review, null).height(720)).toBeGreaterThan(640);
    });
});
