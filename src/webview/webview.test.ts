/**
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ModuleStyling } from "@drawdy/driver-protocol";
import { themeCss } from "../driver/channel.ts";
import { webviewScript } from "../driver/webview-html.ts";
import { PALETTES } from "../lib/card.ts";
import type { PanelView, WebviewToDriver } from "../shared/protocol.ts";
import { PANEL_BODY, PANEL_CSS } from "./markup.ts";
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
    error: null,
    tag: { label: "honojs/hono#5513", colour: "#E36002" },
    pr: { title: [{ text: "fix(hono): handle non-Error throws with onError", code: false }], state: "merged", additions: 202, deletions: 11 },
    total: 9,
    current: 1,
    hasPrevious: true,
    hasNext: true,
    card: {
        pin: "d",
        name: "#dispatch()",
        status: null,
        where: "src/hono-base.ts · 411–471",
        links: [
            { word: "called by", chips: [{ link: "c", name: "fetch()" }] },
            { word: "calls", chips: [{ link: "h", name: "#handleError()" }, { link: "k", name: "compose()" }] },
            { word: "tested by", chips: [{ link: "t", name: "hono.test.ts" }] },
        ],
        canReadAll: true,
    },
    rebuildCost: null,
    rebuilding: null,
};
const startView: PanelView = { ...readyView, phase: "start", tag: null, pr: null, card: null, current: -1 };
const NOT_GITHUB = "Only GitHub pull request links work, like github.com/owner/repo/pull/123.";

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
            "Paste a GitHub pull request link",
            "GitHub pull request link",
            "url",
            "go",
        ]);
        expect($("start").querySelectorAll("button:not(.prs button)")).toHaveLength(0);
        expect(document.querySelectorAll("h3")).toHaveLength(0);
        expect($("start").textContent).not.toMatch(/\bTry\b|requests left|Open another/);
        for (const gone of ["open", "url", "recent", "start-quota", "notice", "copy", "pr-chip", "card-where", "begin", "pop", "another-url", "another-error"]) expect($(gone)).toBeNull();
        expect(document.querySelector("form, header, label")).toBeNull();
    });

    it("lists the 13 vetted pull requests in the operator's order, each its tag in its project's colour on a line of its own, then its title, and only Bun's rewrite its cost", () => {
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
            "oven-sh/bun#30412",
        ]);
        expect(rows.map((b) => b.querySelector<HTMLElement>(".tag")!.style.getPropertyValue("--c"))).toEqual([
            "#E36002", "#41A0A1", "#3A6AFF", "#BD34FE", "#5FA04E", "#0891B2", "#F041FF", "#FF3E00", "#F06292", "#A67F38", "#288DD4", "#6965DB", "#A67F38",
        ]);
        expect(rows.slice(0, 12).every((b) => b.firstElementChild!.className === "tag hue")).toBe(true);
        expect([...rows[0].children].map((c) => c.textContent)).toEqual(["honojs/hono#5513", "fix(hono): handle non-Error throws with onError"]);
        expect(rows.map((b) => b.querySelector(".cost")?.textContent ?? null)).toEqual([...Array(12).fill(null), "23 of 60 GitHub requests"]);
        expect([...rows[12].children].map((c) => c.textContent)).toEqual(["oven-sh/bun#3041223 of 60 GitHub requests", "Rewrite Bun in Rust"]);
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

    it("shows the pull request's tag while loading, then the steps", () => {
        panel.show({ ...readyView, phase: "loading", loading: [{ label: "Reading the pull request", state: "done" }, { label: "Reading 4 changed files", state: "active" }, { label: "Pinning the cards", state: "todo" }] });
        expect([$("loading-tag").textContent, $("loading-tag").className, $("loading-tag").style.getPropertyValue("--c")]).toEqual(["honojs/hono#5513", "tag hue", "#E36002"]);
        expect([...document.querySelectorAll("#load-steps li")].map((li) => `${li.className} ${li.textContent}`)).toEqual(["done Reading the pull request", "active Reading 4 changed files", "todo Pinning the cards"]);
        // Lucide marks: circle-check done, loader-circle turning, circle to do.
        expect([...document.querySelectorAll("#load-steps li")].map((li) => li.firstElementChild!.innerHTML)).toEqual([
            '<circle cx="12" cy="12" r="10"></circle><path d="m16 9-5.5 5.5L8 12"></path>',
            '<path d="M21 12a9 9 0 1 1-6.219-8.56"></path>',
            '<circle cx="12" cy="12" r="10"></circle>',
        ]);
        panel.show({ ...readyView, phase: "loading", tag: { label: "someone/else#1", colour: null }, loading: [] });
        expect([$("loading-tag").className, $("loading-tag").style.getPropertyValue("--c")]).toEqual(["tag", ""]);
    });

    it("shows a first open's download step beside the reads, its note muted", () => {
        panel.show({
            ...readyView,
            phase: "loading",
            loading: [
                { label: "Reading the pull request", state: "done" },
                { label: "Downloading the TypeScript parser", note: "first time only", state: "active" },
                { label: "Reading 4 changed files", state: "active" },
                { label: "Pinning the cards", state: "todo" },
            ],
        });
        const steps = [...document.querySelectorAll("#load-steps li")];
        expect(steps.map((li) => `${li.className} ${li.textContent}`)).toEqual([
            "done Reading the pull request",
            "active Downloading the TypeScript parser · first time only",
            "active Reading 4 changed files",
            "todo Pinning the cards",
        ]);
        expect(steps[1].querySelector(".note")!.textContent).toBe(" · first time only");
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
            for (const k of ["add", "del", "add-gut", "blue"]) expect(vars).toContain(`--${k}: ${PALETTES[theme][k]};`);
        }
        expect(document.body.textContent).not.toContain("↗");
    });

    it("shows the current card: its name and chip, its plain path, Read all only when it hides some, and its links by kind", () => {
        panel.show(readyView);
        expect([$("position").textContent, $("name").textContent, $("name").className]).toEqual(["2 / 9", "#dispatch()", "mono"]);
        expect([$("path").tagName, $("path").textContent]).toEqual(["DIV", "src/hono-base.ts\u00a0·\u00a0411–471"]);
        expect([$("read-all").hidden, $("read-all").textContent]).toEqual([false, "Read all"]);
        const cells = [...$("links").children].map((c) => c.textContent);
        expect(cells).toEqual(["called by", "fetch()", "calls", "#handleError()", "", "compose()", "tested by", "hono.test.ts"]);
        const buttons = [...$("links").querySelectorAll("button")];
        buttons[2].click();
        $("read-all").click();
        expect(post.mock.calls.map(([m]) => m)).toEqual([{ type: "follow", link: "k" }, { type: "read-all" }]);
        panel.show({ ...readyView, current: -1, card: { ...readyView.card!, pin: "f", name: "fetch()", status: "UNCHANGED", canReadAll: false } });
        expect([$("position").textContent, $("read-all").hidden]).toEqual(["– / 9", true]);
        // The chip sits right after the name.
        expect($("name").lastElementChild!.outerHTML).toBe('<span class="status UNCHANGED">UNCHANGED</span>');
    });

    it("breaks long names and paths at camel humps and after a slash", () => {
        panel.show({ ...readyView, card: { ...readyView.card!, name: "type PointerDownState", where: "packages/excalidraw/types.ts · 1256–1341" } });
        expect($("name").innerHTML).toBe("type Pointer<wbr>Down<wbr>State");
        expect($("path").innerHTML).toContain("packages/<wbr>excalidraw/<wbr>types.ts");
    });

    it("shows no name or path for the PR card, which the header names, but always `Description` and Read all, or that there is none", () => {
        const pr: PanelView["card"] = { pin: "pr", name: "The pull request", status: null, where: "", links: [], canReadAll: false };
        panel.show({ ...readyView, current: 0, hasPrevious: false, card: pr });
        expect([$("card").hidden, $("name").textContent, $("read-all").hidden]).toEqual([false, "No description provided.", true]);
        panel.show({ ...readyView, current: 0, hasPrevious: false, card: { ...pr, canReadAll: true } });
        expect([$("card").hidden, $("name").hidden, $("path").hidden, $("read-all").hidden, $("links").hidden]).toEqual([false, false, true, false, true]);
        expect([$("name").textContent, $("name").className]).toEqual(["Description", "about"]);
        expect([$<HTMLButtonElement>("previous").disabled, $<HTMLButtonElement>("next").disabled]).toEqual([true, false]);
        expect([$("next").title, $("previous").title]).toEqual(["Next (→)", "Previous (←)"]);
        panel.show({ ...readyView, current: 8, hasNext: false });
        expect($<HTMLButtonElement>("next").disabled).toBe(true);
    });

    it("ends the reading view in a quiet Open another, which goes back to the start view with the field focused", () => {
        panel.show(readyView);
        expect([$("another").tagName, $("another").textContent, $("another").parentElement!.className]).toEqual(["BUTTON", "Open another", "another"]);
        expect($("ready").querySelector("input")).toBeNull();
        expect(css).toContain("#ready > .another { grid-row: 4; }");
        $("another").click();
        expect(post).toHaveBeenLastCalledWith({ type: "start" });
        panel.show(startView);
        expect(document.activeElement).toBe($("start-url"));
        // Only Open another moves the focus: a start view for any other reason leaves it alone.
        $("start-url").blur();
        panel.show(readyView);
        panel.show(startView);
        expect(document.activeElement).not.toBe($("start-url"));
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

    it("draws Previous and Next with Lucide chevrons, and Esc closes Read all", () => {
        panel.show(readyView);
        expect([$("previous").querySelector("path")!.getAttribute("d"), $("next").querySelector("path")!.getAttribute("d")]).toEqual(["m15 18-6-6 6-6", "m9 18 6-6-6-6"]);
        expect(document.body.textContent).not.toMatch(/[‹›]/);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(post).toHaveBeenLastCalledWith({ type: "close" });
    });

    it("steps with the buttons and ← → outside the field, and takes no other keys", () => {
        panel.show(readyView);
        $("next").click();
        for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "j", "k", "Home"]) document.dispatchEvent(new KeyboardEvent("keydown", { key }));
        $("overview").click();
        expect(post.mock.calls.map(([m]) => m)).toEqual([{ type: "next" }, { type: "previous" }, { type: "next" }, { type: "overview" }]);
    });

    it("renders inline code in the pull request's title as code", () => {
        panel.show({ ...readyView, pr: { ...readyView.pr!, title: [{ text: "Add ", code: false }, { text: "data", code: true }] } });
        expect($("pr-title").innerHTML).toBe("Add <code>data</code>");
    });
});
