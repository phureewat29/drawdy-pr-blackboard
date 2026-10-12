/**
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ModuleStyling } from "@drawdy/driver-protocol";
import { themeCss } from "../driver/channel.ts";
import { webviewScript } from "../driver/webview-html.ts";
import { PALETTES } from "../lib/card.ts";
import { STRING_TEXT } from "../lib/layout.ts";
import type { Annotation, CodeCard, LoadStep, PanelView, WebviewToDriver } from "../shared/protocol.ts";
import { PANEL_BODY, PANEL_CSS, PANEL_MD_CSS } from "./markup.ts";
import { createPanel } from "./panel.ts";

/**
 * Rebuilds a function from its source text alone, as the webview receives
 * it: any reference to the module around it would throw when it runs.
 */
const isolate = <F>(fn: F): F => new Function(`return (${String(fn)});`)() as F;

describe("webview script", () => {
    const script = webviewScript();

    it("is valid JavaScript on its own", () => {
        expect(() => new Function(script)).not.toThrow();
    });

    it("calls no compiler helpers, which would not exist in the webview", () => {
        expect(script).not.toMatch(/\b(?:__\w+|_interop\w*|require)\s*\(/);
    });
});

const readyView: PanelView = {
    phase: "ready",
    loading: [],
    annotations: [],
    error: null,
    tag: { label: "honojs/hono#5513", colour: "#E36002" },
    pr: { title: [{ text: "fix(hono): handle non-Error throws with onError", code: false }], state: "merged", additions: 202, deletions: 11 },
    total: 8,
    current: 0,
    hasPrevious: false,
    hasNext: true,
    card: {
        pin: "d",
        name: "#dispatch()",
        status: null,
        where: "src/hono-base.ts · 411–471",
        links: [
            { word: "called by", chips: [{ link: "c", name: "fetch()", colour: 0 }] },
            { word: "calls", chips: [{ link: "h", name: "#handleError()", colour: 0 }, { link: "k", name: "compose()", colour: 1 }] },
            { word: "tested by", chips: [{ link: "t", name: "hono.test.ts", colour: null }] },
        ],
        canReadAll: true,
    },
    rebuildCost: null,
    rebuilding: null,
};
const startView: PanelView = { ...readyView, phase: "start", tag: null, pr: null, card: null, current: -1 };
const NOT_GITHUB = "Only GitHub PR links work, like github.com/owner/repo/pull/123.";
const prCard: PanelView["card"] = { pin: "pr", about: ["usualoma · 4 files"], warnings: [], description: "<p>A value thrown.</p><h3>Behavior change</h3><details><summary>More</summary><p>Hidden.</p></details>" };
const CARD_LIMIT: Annotation = { level: "warning", title: "Card limit reached", detail: "The board holds 32 cards: 7,758 functions and 2,151 files not pinned." };
const NOT_READ: Annotation = { level: "warning", title: "1,517 files not read", detail: "PR Blackboard reads up to 40 code and 40 test files, so some cards have no lines." };
const RATE_LIMITED: Annotation = { level: "failure", title: "GitHub rate limit reached", detail: "This network has used GitHub's 60 requests for this hour. Try again in 12 minutes." };
/** hono#5513 a moment into reading its changed files. */
const reading: LoadStep[] = [
    { key: "pr", label: "Reading the PR", state: "done", meta: "0.4 s" },
    {
        key: "files",
        label: "Reading 4 changed files",
        state: "active",
        meta: "1 / 4",
        rows: [
            { label: "src/compose.ts", state: "done", file: true },
            { label: "src/hono-base.ts", state: "active", file: true },
            { label: "src/compose.test.ts", state: "todo", file: true },
            { label: "README.md", state: "todo", file: true },
        ],
    },
    { key: "link", label: "Finding the lines", state: "todo" },
    { key: "pin", label: "Pinning the cards", state: "todo" },
];
const codeCard = readyView.card as CodeCard;

describe("panel", () => {
    let post: jest.Mock<(message: WebviewToDriver) => void>;
    let panel: ReturnType<typeof createPanel>;
    const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
    const css = PANEL_CSS.replace(/\s+/g, " ");

    beforeEach(() => {
        document.body.innerHTML = PANEL_BODY;
        post = jest.fn<(message: WebviewToDriver) => void>();
        panel = isolate(createPanel)({ post, document });
    });

    it("starts with one paste field asking for a GitHub link and the eight examples under it: no button, no heading, no quota line", () => {
        panel.show(startView);
        const field = $<HTMLInputElement>("start-url");
        expect([field.placeholder, field.getAttribute("aria-label"), field.getAttribute("inputmode"), field.getAttribute("enterkeyhint")]).toEqual([
            "Paste a GitHub PR link",
            "GitHub PR link",
            "url",
            "go",
        ]);
        expect($("start").querySelectorAll("button:not(.prs button)")).toHaveLength(0);
        expect(document.querySelectorAll("h3")).toHaveLength(0);
        expect($("start").textContent).not.toMatch(/\bTry\b|requests left|Open another/);
        for (const gone of ["open", "url", "recent", "start-quota", "notice", "copy", "pr-chip", "card-where", "begin", "pop", "another-url", "another-error", "another"]) expect($(gone)).toBeNull();
        expect(document.querySelector("form, header, label")).toBeNull();
    });

    it("lists the 15 vetted pull requests in the operator's order, each its tag in its project's colour on a line of its own, then its title, and only Bun's rewrite its cost", () => {
        panel.show(startView);
        const rows = [...document.querySelectorAll<HTMLButtonElement>("#try button")];
        expect(rows.map((b) => b.querySelector(".tag")!.textContent)).toEqual([
            "honojs/hono#5513",
            "prettier/prettier#20127",
            "colinhacks/zod#6652",
            "vitejs/vite#23586",
            "nodejs/node#63047",
            "TanStack/router#8573",
            "withastro/astro#17955",
            "sveltejs/svelte#18736",
            "elysiajs/elysia#1734",
            "oven-sh/bun#34519",
            "sindresorhus/ky#823",
            "excalidraw/excalidraw#12237",
            "prometheus/prometheus#18564",
            "python/cpython#152451",
            "oven-sh/bun#30412",
        ]);
        expect(rows.map((b) => b.querySelector<HTMLElement>(".tag")!.style.getPropertyValue("--c"))).toEqual([
            "#E36002", "#41A0A1", "#3A6AFF", "#BD34FE", "#5FA04E", "#0891B2", "#F041FF", "#FF3E00", "#F06292", "#A67F38", "#288DD4", "#6965DB", "#D64B5A", "#3A7AB0", "#A67F38",
        ]);
        expect(rows.slice(0, 14).every((b) => b.firstElementChild!.className === "tag hue")).toBe(true);
        expect([...rows[0].children].map((c) => c.textContent)).toEqual(["honojs/hono#5513", "fix(hono): handle non-Error throws with onError"]);
        expect(rows.map((b) => b.querySelector(".cost")?.textContent ?? null)).toEqual([...Array(14).fill(null), "23 of 60 GitHub requests"]);
        expect([...rows[14].children].map((c) => c.textContent)).toEqual(["oven-sh/bun#3041223 of 60 GitHub requests", "Rewrite Bun in Rust"]);
        // GitHub shows :tada: as the emoji, and a colon pair that names no emoji stays.
        expect(rows[8].children[1].textContent).toBe("🎉 feat: graceful cookie transition");
        expect(rows[9].children[1].textContent).toContain("node:events: single listeners");
        expect([...rows[10].querySelectorAll("code")].map((c) => c.textContent)).toEqual(["data", "HTTPError"]);
        expect(document.body.textContent).not.toContain("mattpocock");
        rows[10].click();
        expect(post).toHaveBeenCalledWith({ type: "open", url: "https://github.com/sindresorhus/ky/pull/823" });
    });

    it("styles the rows as the design says: a grid button, tag above title, the list alone scrolling with shadows only while rows are hidden", () => {
        expect(css).toMatch(/\.prs \{[^}]*margin: 0 -8px;[^}]*gap: 2px;[^}]*min-height: 0; overflow-y: auto;/);
        expect(css).toMatch(/\.prs button \{[^}]*display: grid; justify-items: start; gap: 4px; padding: 6px 8px;[^}]*font-size: 13px;/);
        expect(css).toMatch(/\.scroll \{[^}]*no-repeat local/);
        expect(css).toMatch(/code \{ padding: 0 3px;[^}]*line-height: 1;/);
        expect(css).toMatch(/\.tag\.hue \{ color: color-mix\(in oklab, var\(--c\) 60%, var\(--drawdy-foreground\)\);/);
        expect(css).not.toMatch(/var\(--drawdy-[a-z-]+, /);
    });

    it("opens a pasted link at once and a typed one on Enter, and leaves what is a pull request to the driver", async () => {
        panel.show(startView);
        const field = $<HTMLInputElement>("start-url");
        field.value = " not even a link ";
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
        field.value = "https://github.com/honojs/hono/pull/5513";
        field.dispatchEvent(new Event("paste"));
        await new Promise((done) => setTimeout(done, 0));
        expect(post.mock.calls.map(([m]) => m)).toEqual([
            { type: "open", url: "not even a link" },
            { type: "open", url: "https://github.com/honojs/hono/pull/5513" },
        ]);
    });

    it("shows an error in one slot by the field, keeps the link, and hides the error once the reader types", () => {
        const field = $<HTMLInputElement>("start-url");
        field.value = "https://gitlab.com/a/b/-/merge_requests/1";
        panel.show({ ...startView, error: NOT_GITHUB });
        expect([$("error").hidden, $("error").textContent, field.value]).toEqual([false, NOT_GITHUB, "https://gitlab.com/a/b/-/merge_requests/1"]);
        expect(field.parentElement!.nextElementSibling!.id).toBe("error");
        field.dispatchEvent(new Event("input"));
        expect($("error").hidden).toBe(true);
        panel.show({ ...startView, error: NOT_GITHUB });
        expect($("error").hidden).toBe(true);
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
        panel.show({ ...startView, error: NOT_GITHUB });
        expect($("error").hidden).toBe(false);
    });

    it("shows the pull request's tag while loading, then the steps as a CI job lists them: a mark for each state, and the time each took or its count", () => {
        panel.show({ ...readyView, phase: "loading", loading: reading });
        expect([$("loading-tag").textContent, $("loading-tag").className, $("loading-tag").style.getPropertyValue("--c")]).toEqual(["honojs/hono#5513", "tag hue", "#E36002"]);
        const steps = [...document.querySelectorAll("#load-steps > li")];
        expect($("load-steps").tagName).toBe("OL");
        expect(steps.map((li) => [li.className, li.children[1].firstElementChild!.textContent, li.children[2].textContent])).toEqual([
            ["done", "Reading the PR", "0.4 s"],
            ["active", "Reading 4 changed files", "1 / 4"],
            ["todo", "Finding the lines", ""],
            ["todo", "Pinning the cards", ""],
        ]);
        // Lucide marks: circle-check done, loader-circle turning, circle to do; triangle-alert a warning, circle-x failed.
        expect(steps.map((li) => li.firstElementChild!.innerHTML)).toEqual([
            '<circle cx="12" cy="12" r="10"></circle><path d="m16 9-5.5 5.5L8 12"></path>',
            '<path d="M21 12a9 9 0 1 1-6.219-8.56"></path>',
            '<circle cx="12" cy="12" r="10"></circle>',
            '<circle cx="12" cy="12" r="10"></circle>',
        ]);
        panel.show({ ...readyView, phase: "loading", loading: [{ ...reading[0], state: "warning" }, { ...reading[1], state: "failed", rows: undefined }] });
        expect([...document.querySelectorAll("#load-steps > li")].map((li) => li.firstElementChild!.firstElementChild!.getAttribute("d") ?? li.firstElementChild!.innerHTML)).toEqual([
            "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
            '<circle cx="12" cy="12" r="10"></circle><path d="m15 9-6 6"></path><path d="m9 9 6 6"></path>',
        ]);
        panel.show({ ...readyView, phase: "loading", tag: { label: "someone/else#1", colour: null }, loading: [] });
        expect([$("loading-tag").className, $("loading-tag").style.getPropertyValue("--c")]).toEqual(["tag", ""]);
    });

    it("lists the rows of a step under way under its words: each file by its path, its folder muted, at most 10, then a plain row of how many more", () => {
        const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `packages/excalidraw/components/F${i}.tsx`, state: "todo" as const, file: true as const }));
        panel.show({ ...readyView, phase: "loading", loading: reading });
        const list = document.querySelectorAll("#load-steps > li")[1].querySelector(".rows")!;
        expect([...list.children].map((li) => `${li.className} ${li.textContent}`)).toEqual([
            "done src/compose.ts, done",
            "active src/hono-base.ts, under way",
            "todo src/compose.test.ts, to do",
            "todo README.md, to do",
        ]);
        expect(list.children[1].querySelector(".file")!.innerHTML).toBe('<bdi><span class="dir">src/</span>hono-base.ts</bdi>');
        expect(list.children[3].querySelector(".file")!.innerHTML).toBe("<bdi>README.md</bdi>");
        // Row marks are lighter, and still: only the step's turns. A check, a circle-dot for the one under way, a circle.
        expect([...list.children].map((li) => li.firstElementChild!.innerHTML)).toEqual([
            '<path d="M20 6 9 17l-5-5"></path>',
            '<circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="1"></circle>',
            '<circle cx="12" cy="12" r="10"></circle>',
            '<circle cx="12" cy="12" r="10"></circle>',
        ]);
        expect(css).toContain(".steps .active > svg, .line svg { color: var(--turning); animation: spin .8s linear infinite; }");
        expect(css).not.toMatch(/\.rows [^{]*\{[^}]*animation: spin/);
        panel.show({ ...readyView, phase: "loading", loading: [reading[0], { ...reading[1], label: "Reading 40 changed files", rows: rows(10), more: 2030 }] });
        const more = document.querySelectorAll("#load-steps > li")[1].querySelector(".rows")!.lastElementChild!;
        expect([more.className, more.textContent, more.querySelector("button, a, [tabindex]")]).toEqual(["more", "and 2,030 more", null]);
        expect(document.querySelectorAll(".rows > li:not(.more)")).toHaveLength(10);
        // A language's parser is a row of plain words.
        panel.show({ ...readyView, phase: "loading", loading: [reading[0], { key: "parser", label: "Downloading 2 parsers", state: "active", rows: [{ label: "TypeScript", state: "done" }, { label: "JavaScript", state: "active" }] }] });
        expect([...document.querySelectorAll(".rows > li")].map((li) => `${li.className} ${li.children[1].outerHTML}`)).toEqual(["done <span>TypeScript</span>", "active <span>JavaScript</span>"]);
    });

    it("changes a step in place from view to view, so a turning mark keeps turning, and folds its rows away as it ends", () => {
        panel.show({ ...readyView, phase: "loading", loading: reading });
        const [pr, files] = [...document.querySelectorAll<HTMLElement>("#load-steps > li")];
        const [prMark, filesMark, row] = [pr.firstElementChild, files.firstElementChild, files.querySelector(".rows > li")];
        panel.show({ ...readyView, phase: "loading", loading: [reading[0], { ...reading[1], meta: "2 / 4" }, ...reading.slice(2)] });
        const again = [...document.querySelectorAll<HTMLElement>("#load-steps > li")];
        expect([again[0] === pr, again[1] === files, pr.firstElementChild === prMark, files.firstElementChild === filesMark, files.querySelector(".rows > li") === row]).toEqual([true, true, true, true, true]);
        expect(files.children[2].textContent).toBe("2 / 4");
        // A step that starts takes its place among the others, and the parser's comes between reading the PR and the files.
        panel.show({ ...readyView, phase: "loading", loading: [reading[0], { key: "parser", label: "Downloading the parser", state: "active", rows: [{ label: "TypeScript", state: "active" }] }, ...reading.slice(1)] });
        const withParser = [...document.querySelectorAll<HTMLElement>("#load-steps > li")];
        expect([withParser.map((li) => li.dataset.key), withParser[2] === files]).toEqual([["pr", "parser", "files", "link", "pin"], true]);
        // Ended, its rows fold away; in a document with no motion, at once.
        panel.show({ ...readyView, phase: "loading", loading: [reading[0], { ...reading[1], state: "done", meta: "0.3 s", rows: undefined }, { ...reading[2], state: "active" }, reading[3]] });
        expect(files.querySelector(".rows-wrap")).toBeNull();
        expect(css).toMatch(/\.rows-wrap \{ animation: open \.18s ease-out \.2s both; \}/);
        expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    });

    it("shows the warnings under the steps as CI annotations in one frame, each its title and a plain line", () => {
        panel.show({ ...readyView, phase: "loading", loading: reading, annotations: [NOT_READ, CARD_LIMIT] });
        const notes = [...document.querySelectorAll("#load-notes .warnings .annotation")];
        expect(notes.map((n) => [n.className, n.querySelector(".title")!.textContent, n.querySelector(".detail")!.textContent, n.getAttribute("role")])).toEqual([
            ["annotation warning", "1,517 files not read", NOT_READ.detail, null],
            ["annotation warning", "Card limit reached", CARD_LIMIT.detail, null],
        ]);
        // Lucide triangle-alert, an amber triangle with a dark mark.
        expect(notes[0].firstElementChild!.firstElementChild!.getAttribute("d")).toBe("m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3");
        expect($("load-notes").getAttribute("aria-live")).toBe("polite");
        expect($("load-tools").hidden).toBe(true);
    });

    it("keeps a failed open on the loading view, its failed step and why in the error box, with Home and Try again, which opens the PR again", () => {
        panel.show({ ...readyView, phase: "loading", tag: { label: "oven-sh/bun#30412", colour: "#A67F38" }, loading: [{ key: "pr", label: "Reading the PR", note: "23 GitHub requests", state: "failed", meta: "1.2 s" }, reading[2], reading[3]], annotations: [RATE_LIMITED] });
        const failure = document.querySelector("#load-notes .failures .annotation")!;
        expect([failure.className, failure.getAttribute("role"), failure.querySelector(".title")!.textContent, failure.querySelector(".detail")!.textContent]).toEqual(["annotation failure", "alert", RATE_LIMITED.title, RATE_LIMITED.detail]);
        expect([$("load-tools").hidden, $("retry").textContent, $("load-home").getAttribute("aria-label")]).toEqual([false, "Try again", "Home"]);
        $("retry").click();
        $("load-home").click();
        expect(post.mock.calls.map(([m]) => m)).toEqual([{ type: "open", url: "oven-sh/bun#30412" }, { type: "start" }]);
        // The next open's view hides the toolbar again.
        panel.show({ ...readyView, phase: "loading", loading: reading });
        expect([$("load-tools").hidden, document.querySelector("#load-notes .annotation")]).toEqual([true, null]);
    });

    it("tells a screen reader each step's state in words, and the step under way politely", () => {
        panel.show({ ...readyView, phase: "loading", loading: reading });
        expect([...document.querySelectorAll("#load-steps > li")].map((li) => li.children[1].textContent)).toEqual(["Reading the PR, done", "Reading 4 changed files, under way", "Finding the lines, to do", "Pinning the cards, to do"]);
        expect([$("load-status").textContent, $("load-status").getAttribute("aria-live"), $("load-status").className]).toEqual(["Reading 4 changed files", "polite", "sr"]);
        expect([...document.querySelectorAll("#load-steps svg")].every((svg) => svg.getAttribute("aria-hidden") === "true")).toBe(true);
    });

    it("heads the reading view with the plain tag, the counts and the state, wrapping instead of cutting the tag", () => {
        panel.show(readyView);
        expect(document.querySelector(".pr-top")!.textContent).toBe("honojs/hono#5513+202 −11Merged");
        expect([$("pr-tag").tagName, $("pr-tag").className]).toEqual(["SPAN", "tag hue"]);
        expect([$("pr-add").className, $("pr-del").className]).toEqual(["a", "d"]);
        expect(css).toContain(".pr-top { display: flex; flex-wrap: wrap;");
        expect(css).not.toMatch(/\.pr-top \.tag \{[^}]*ellipsis/);
        panel.show({ ...readyView, tag: { label: "an-organisation-name/a-long-repository#12345", colour: null } });
        expect($("pr-tag").textContent).toBe("an-organisation-name/a-long-repository#12345");
        // The panel's + and − and its chips take the cards' colours in the same theme.
        for (const theme of ["light", "dark"] as const) {
            const vars = themeCss({ theme } as ModuleStyling);
            for (const k of ["add", "del", "add-gut", "blue", "md-link", "md-code-bg", "md-border", "add-bg", "del-bg", "k", "s", "n", "c", "f", "t"]) expect(vars).toContain(`--${k}: ${PALETTES[theme][k]};`);
            STRING_TEXT[theme].forEach((colour, i) => expect(vars).toContain(`--string-${i}: ${colour};`));
        }
        expect(document.body.textContent).not.toContain("↗");
    });

    it("shows the current card: its name and chip, its plain path, Read all only when it hides some, and its links by kind, each name in its string's colour", () => {
        panel.show(readyView);
        expect([$("position").textContent, $("name").textContent, $("name").className]).toEqual(["1 / 8", "#dispatch()", "mono"]);
        expect([$("path").tagName, $("path").textContent]).toEqual(["DIV", "src/hono-base.ts\u00a0·\u00a0411–471"]);
        expect([$("read-all").hidden, $("read-all").textContent]).toEqual([false, "Read all"]);
        const cells = [...$("links").children].map((c) => c.textContent);
        expect(cells).toEqual(["called by", "fetch()", "calls", "#handleError()", "", "compose()", "tested by", "hono.test.ts"]);
        const buttons = [...$("links").querySelectorAll("button")];
        // A name with a string takes its colour as the panel reads it; a link with no string, none.
        expect(buttons.map((b) => b.getAttribute("style"))).toEqual(["color: var(--string-0)", "color: var(--string-0)", "color: var(--string-1)", null]);
        expect(css).toContain("#links button:hover { text-decoration-color: currentColor; }");
        expect(css).not.toMatch(/#links button:hover \{[^}]*background/);
        buttons[2].click();
        $("read-all").click();
        expect(post.mock.calls.map(([m]) => m)).toEqual([{ type: "follow", link: "k" }, { type: "read-all" }]);
        panel.show({ ...readyView, current: -1, card: { ...codeCard, pin: "f", name: "fetch()", status: "UNCHANGED", canReadAll: false } });
        expect([$("position").textContent, $("read-all").hidden]).toEqual(["– / 8", true]);
        // The chip sits right after the name.
        expect($("name").lastElementChild!.outerHTML).toBe('<span class="status UNCHANGED">UNCHANGED</span>');
    });

    it("breaks long names and paths at camel humps and after a slash", () => {
        panel.show({ ...readyView, card: { ...codeCard, name: "type PointerDownState", where: "packages/excalidraw/types.ts · 1256–1341" } });
        expect($("name").innerHTML).toBe("type Pointer<wbr>Down<wbr>State");
        expect($("path").innerHTML).toContain("packages/<wbr>excalidraw/<wbr>types.ts");
    });

    it("shows at the PR card who opened it and how big it is, then the whole description, scrolling in the card area, or that there is none", () => {
        panel.show({ ...readyView, current: -1, card: prCard });
        expect([$("card").hidden, $("card-head").hidden, $("path").hidden, $("links").hidden, $("about").hidden, $("pr-body").hidden]).toEqual([false, true, true, true, false, false]);
        expect($("about").textContent).toBe("usualoma · 4 files");
        expect([$("pr-body").className, $("pr-body").querySelector("h3")?.textContent, $("pr-body").querySelector("details > summary")?.textContent]).toEqual(["md scroll", "Behavior change", "More"]);
        expect(css).toContain("#pr-body { flex: 0 1 auto; min-height: 0; overflow-y: auto;");
        // No `Description` row and no `Read all`: the card area is the description.
        expect(`${$("about").textContent}${$("pr-body").textContent}`).not.toMatch(/Read all|Description/);
        // It scrolls back to its top whenever the PR card becomes current, and keeps the reader's place while it stays.
        $("pr-body").scrollTop = 120;
        panel.show({ ...readyView, current: -1, card: prCard, rebuilding: "Reading the PR" });
        expect($("pr-body").scrollTop).toBe(120);
        panel.show(readyView);
        panel.show({ ...readyView, current: -1, card: prCard });
        expect($("pr-body").scrollTop).toBe(0);
        panel.show({ ...readyView, current: -1, card: { pin: "pr", about: ["someone · 1 file"], warnings: [], description: null } });
        expect([$("about").innerHTML, $("pr-body").innerHTML, $("pr-notes").hidden]).toEqual(["someone · 1 file", '<p class="none">No description provided.</p>', true]);
        expect(PANEL_MD_CSS).toContain("#pr-body pre { padding: 8px 12px; overflow-x: auto;");
    });

    it("keeps what the board can't show at the PR card, as the loading view said it, between who opened it and the description", () => {
        panel.show({ ...readyView, current: -1, card: { ...(prCard as Exclude<PanelView["card"], CodeCard | null>), warnings: [CARD_LIMIT, NOT_READ] } });
        expect([$("pr-notes").hidden, [...$("pr-notes").querySelectorAll(".title")].map((t) => t.textContent)]).toEqual([false, ["Card limit reached", "1,517 files not read"]]);
        expect([...$("card").children].map((c) => c.id).filter((id) => ["about", "pr-notes", "pr-body"].includes(id))).toEqual(["about", "pr-notes", "pr-body"]);
        panel.show(readyView);
        expect($("pr-notes").hidden).toBe(true);
    });

    it("ends the reading view in one toolbar: Home, Rebuild, a rule, Overview, Description, then Previous, the position and Next", () => {
        panel.show(readyView);
        const bar = document.querySelector("#ready .tools .bar")!;
        expect([...bar.children].map((c) => c.id || c.className)).toEqual(["home", "rebuild", "sep", "overview", "description", "spacer", "previous", "position", "next"]);
        expect([...bar.querySelectorAll("button")].map((b) => [b.id, b.getAttribute("aria-label"), b.dataset.tip, b.title])).toEqual([
            ["home", "Home", "Home: open another PR", ""],
            ["rebuild", "Rebuild", "Rebuild this board from GitHub", ""],
            ["overview", "Overview", "Overview: the whole board", ""],
            ["description", "Description", "Description", ""],
            ["previous", "Previous card", "Previous (←)", ""],
            ["next", "Next card", "Next (→)", ""],
        ]);
        // Lucide house, refresh-cw, scan, file-text and the chevrons; no text button and no nav row left.
        expect([...bar.querySelectorAll("button svg")].map((svg) => svg.firstElementChild!.getAttribute("d"))).toEqual([
            "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8",
            "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",
            "M3 7V5a2 2 0 0 1 2-2h2",
            "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
            "m15 18-6-6 6-6",
            "m9 18 6-6-6-6",
        ]);
        expect([...bar.querySelectorAll("button")].every((b) => b.textContent === "")).toBe(true);
        expect(document.querySelector(".nav, #another")).toBeNull();
        expect(css).toContain("#ready { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; grid-template-columns: minmax(0, 1fr); }");
        expect(css).not.toContain(".nav {");
        expect(document.body.textContent).not.toMatch(/[‹›]|Open another|Overview/);
    });

    it("marks Description while the PR card is current, and never Overview; Previous is off at step 1 and at the PR card", () => {
        panel.show({ ...readyView, current: -1, hasPrevious: false, card: prCard });
        expect([$("description").getAttribute("aria-current"), $("overview").getAttribute("aria-current"), $("position").textContent]).toEqual(["true", null, "– / 8"]);
        expect([$<HTMLButtonElement>("previous").disabled, $<HTMLButtonElement>("next").disabled]).toEqual([true, false]);
        panel.show(readyView);
        expect([$("description").getAttribute("aria-current"), $<HTMLButtonElement>("previous").disabled]).toEqual([null, true]);
        panel.show({ ...readyView, current: 7, hasPrevious: true, hasNext: false });
        expect([$<HTMLButtonElement>("previous").disabled, $<HTMLButtonElement>("next").disabled, $("position").textContent]).toEqual([false, true, "8 / 8"]);
    });

    it("goes Home to the start view with the field focused", () => {
        panel.show(readyView);
        expect($("ready").querySelector("input")).toBeNull();
        $("home").click();
        expect(post).toHaveBeenLastCalledWith({ type: "start" });
        panel.show(startView);
        expect(document.activeElement).toBe($("start-url"));
        // Only Home moves the focus: a start view for any other reason leaves it alone.
        $("start-url").blur();
        panel.show(readyView);
        panel.show(startView);
        expect(document.activeElement).not.toBe($("start-url"));
    });

    it("rebuilds at once for 2 requests; past that, holds Rebuild down on the first press with the cost on its line, until the second press, Esc or another control", () => {
        panel.show(readyView);
        $("rebuild").click();
        expect(post).toHaveBeenLastCalledWith({ type: "rebuild" });
        post.mockClear();
        const costly = { ...readyView, rebuildCost: { files: 2188, requests: 23 } };
        panel.show(costly);
        $("rebuild").click();
        expect(post).not.toHaveBeenCalled();
        expect([$("rebuild").classList.contains("armed"), $("tools-line").hidden, $("tools-line").textContent]).toEqual([
            true,
            false,
            "Rebuilding reads 2,188 files: 23 of 60 GitHub requests. Press Rebuild again to start.",
        ]);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect([$("rebuild").classList.contains("armed"), $("tools-line").hidden]).toEqual([false, true]);
        $("rebuild").click();
        $("overview").click();
        expect($("rebuild").classList.contains("armed")).toBe(false);
        $("rebuild").click();
        $("rebuild").click();
        expect(post.mock.calls.map(([m]) => m)).toEqual([{ type: "close" }, { type: "overview" }, { type: "rebuild" }]);
    });

    it("turns Rebuild off the moment it asks for a rebuild, so a second press asks nothing more, until the driver's views say it ended", () => {
        panel.show(readyView);
        $("rebuild").click();
        $("rebuild").click();
        expect(post.mock.calls.map(([m]) => m)).toEqual([{ type: "rebuild" }]);
        expect($<HTMLButtonElement>("rebuild").disabled).toBe(true);
        panel.show({ ...readyView, rebuilding: "Reading the PR" });
        $("rebuild").click();
        expect([post.mock.calls.length, $<HTMLButtonElement>("rebuild").disabled]).toEqual([1, true]);
        panel.show(readyView);
        expect($<HTMLButtonElement>("rebuild").disabled).toBe(false);
        // Past 2 requests, the second press is the one that asks, and it turns Rebuild off too.
        panel.show({ ...readyView, rebuildCost: { files: 2188, requests: 23 } });
        $("rebuild").click();
        $("rebuild").click();
        $("rebuild").click();
        expect([post.mock.calls.length, $<HTMLButtonElement>("rebuild").disabled, $("rebuild").classList.contains("armed")]).toEqual([2, true, false]);
    });

    it("says a rebuild's step under way on the toolbar's line, the loading view's mark turning, with Rebuild off; and an error there", () => {
        panel.show({ ...readyView, rebuilding: "Reading 4 changed files" });
        expect([$("tools-line").hidden, $("tools-line").textContent, $("tools-line").getAttribute("role"), $<HTMLButtonElement>("rebuild").disabled]).toEqual([false, "Reading 4 changed files", "status", true]);
        expect($("tools-line").querySelector("svg path")!.getAttribute("d")).toBe("M21 12a9 9 0 1 1-6.219-8.56");
        expect(css).toContain(".steps .active > svg, .line svg { color: var(--turning); animation: spin .8s linear infinite; }");
        const limited = "This network has used GitHub's 60 requests for this hour. Try again in 12 minutes.";
        panel.show({ ...readyView, error: limited });
        expect([$("tools-line").hidden, $("tools-error").hidden, $("tools-error").textContent, $("tools-error").getAttribute("role"), $("error").hidden]).toEqual([true, false, limited, "alert", true]);
        panel.show(readyView);
        expect($("tools-error").hidden).toBe(true);
    });

    it("shows tooltips above the buttons, after a moment under the pointer and at once on keyboard focus, and a ring that reads on white", () => {
        expect(css).toContain("[data-tip]::after { content: attr(data-tip); position: absolute; bottom: calc(100% + 8px);");
        expect(css).toContain("[data-tip]:hover::after { opacity: 1; transition-delay: .4s; }");
        expect(css).toContain("[data-tip]:focus-visible::after { opacity: 1; transition-delay: 0s; }");
        expect(css).toContain(":focus-visible { outline: 2px solid color-mix(in oklab, var(--drawdy-ring) 55%, var(--drawdy-foreground)); outline-offset: 2px; }");
    });

    it("clears the field once a pull request opens, and keeps it, with the error under it, when one fails", () => {
        panel.show(startView);
        const field = $<HTMLInputElement>("start-url");
        field.value = "nope";
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
        panel.show({ ...startView, phase: "loading", loading: [] });
        panel.show({ ...startView, error: NOT_GITHUB });
        expect([field.value, $("error").hidden, $("error").textContent]).toEqual(["nope", false, NOT_GITHUB]);
        field.value = "https://github.com/vitejs/vite/pull/23586";
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
        panel.show({ ...startView, phase: "loading", loading: [] });
        panel.show({ ...readyView, tag: { label: "vitejs/vite#23586", colour: "#BD34FE" } });
        expect(field.value).toBe("");
        panel.show(startView);
        expect($("error").hidden).toBe(true);
    });

    it("closes Read all on Esc", () => {
        panel.show(readyView);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(post).toHaveBeenLastCalledWith({ type: "close" });
    });

    it("steps with the buttons and ← → outside the field, and takes no other keys", () => {
        panel.show(readyView);
        $("next").click();
        for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "j", "k", "Home"]) document.dispatchEvent(new KeyboardEvent("keydown", { key }));
        $("overview").click();
        $("description").click();
        expect(post.mock.calls.map(([m]) => m)).toEqual([{ type: "next" }, { type: "previous" }, { type: "next" }, { type: "overview" }, { type: "description" }]);
    });

    it("leaves ← and → to the description and the links while focus is in them, so a wide code block or table scrolls sideways", () => {
        const wide = '<pre><code><div class="l">const wide = 1;</div></code></pre><table><tr><td>a</td></tr></table>';
        panel.show({ ...readyView, current: -1, card: { pin: "pr", about: ["usualoma · 4 files"], warnings: [], description: wide } });
        const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
        key(document.querySelector("#pr-body pre")!, "ArrowRight");
        key(document.querySelector("#pr-body table")!, "ArrowLeft");
        key($("pr-body"), "ArrowRight");
        panel.show(readyView);
        key(document.querySelector("#links button")!, "ArrowRight");
        expect(post).not.toHaveBeenCalled();
        key($("next"), "ArrowRight");
        key(document.body, "ArrowLeft");
        expect(post.mock.calls.map(([m]) => m)).toEqual([{ type: "next" }, { type: "previous" }]);
    });

    it("renders inline code in the pull request's title as code", () => {
        panel.show({ ...readyView, pr: { ...readyView.pr!, title: [{ text: "Add ", code: false }, { text: "data", code: true }] } });
        expect($("pr-title").innerHTML).toBe("Add <code>data</code>");
    });
});
