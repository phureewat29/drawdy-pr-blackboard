import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { DriverCommandIssuer, DriverSubscriptionEvent, ModuleStyling } from "@drawdy/driver-protocol";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectColour } from "../shared/suggestions.ts";
import { parse } from "../lib/guard.ts";
import { webviewToDriver, type CodeCard, type LoadStep, type PanelView } from "../shared/protocol.ts";
import { fakeFetch } from "../test/fake-fetch.ts";
import { fakeHost } from "../test/fake-host.ts";
import { STRING_COLOURS } from "../lib/layout.ts";
import { Lexer } from "../vendor/marked.ts";
import { createRuntime, rebuildCostOf } from "./runtime.ts";

const fakeGithub = fakeFetch("hono-5513.json").fetch;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until `ready` holds, for at most `ms`: opening a pull request takes a few turns of the event loop. */
const until = async (ready: () => boolean, ms = 2000) => {
    for (let i = 0; i < ms / 10 && !ready(); i++) await wait(10);
};

const boot = async (options: { panel?: boolean; extra?: Record<string, (req: any) => unknown> } = {}) => {
    let handle: (event: DriverSubscriptionEvent) => Promise<void> = async () => undefined;
    const message = (body: unknown) => handle({ type: "subscription:webview:message", subscriptionId: "t", body: { webviewDomId: "pr-blackboard:panel", message: body } } as DriverSubscriptionEvent);
    const host = fakeHost({ width: 1920, height: 1080 }, {
        "command:webview:create": () => {
            setTimeout(() => void message({ type: "ready" }));
            return { created: true };
        },
        "command:webview:post-message": () => ({ posted: true }),
        "command:kv-storage:get": () => ({}),
        "command:kv-storage:set": () => undefined,
        "command:dom:create-action-button": () => ({ created: true }),
        ...options.extra,
    });
    const issueCommand = (async (request: { type: string; req?: unknown }) => {
        try {
            return { ...request, res: { value: await host.ddp.call(request.type as never, request.req as never) } };
        } catch (err) {
            return { ...request, res: { error: { type: "runtime", message: String(err) } } };
        }
    }) as unknown as DriverCommandIssuer;
    const runtime = createRuntime({
        issueCommand,
        manifest: { driverId: "a.pr-blackboard", driverName: "PR Blackboard", driverVersion: "0", permissions: [] } as never,
        styling: host.styling as ModuleStyling,
        generateId: (() => {
            let n = 0;
            return () => `id${n++}`;
        })(),
    });
    handle = runtime.handle;
    await runtime.start();
    const openPanel = async () => {
        await handle({ type: "subscription:dom:element-clicked", subscriptionId: "t", body: { domElementId: "pr-blackboard:open", clientX: 0, clientY: 0 } } as DriverSubscriptionEvent);
        await wait(20);
    };
    if (options.panel !== false) await openPanel();
    const view = (): PanelView => host.calls.filter((c) => c.type === "command:webview:post-message" && c.req.message.type === "view").pop()!.req.message.view;
    const click = (ids: string[], at: { x: number; y: number }) =>
        handle({ type: "subscription:scene:click", subscriptionId: "t", body: { drawdyElementIds: ids, cursor: { canvasSpace: at, domSpace: at } } } as unknown as DriverSubscriptionEvent);
    return { host, handle, message, view, click, openPanel };
};

/** The ids and rects of a pinned board's cards, by pin id. */
const cardsOf = (host: ReturnType<typeof fakeHost>) =>
    new Map([...host.elements].filter(([, e]) => e.schema.type === "component").map(([id, e]) => [e.schema.meta.prBlackboard.pin as string, { id, rect: e.rect, mark: e.schema.meta.prBlackboard }]));

describe("the runtime on hono#5513", () => {
    const realFetch = globalThis.fetch;
    beforeAll(() => {
        globalThis.fetch = fakeGithub as typeof fetch;
    });
    afterAll(() => {
        globalThis.fetch = realFetch;
    });

    it("registers its button and no context menu", async () => {
        const { host } = await boot();
        expect(host.calls.some((c) => c.type === "command:dom:create-action-button")).toBe(true);
        expect(host.calls.some((c) => c.type.includes("context-menu"))).toBe(false);
    });

    it("pins the board in one call, moves the camera only after it, once, and makes the PR card current", async () => {
        // jsDelivr takes a moment, as over a network, so the download shows beside the reads.
        globalThis.fetch = (async (url: string) => {
            if (url.startsWith("https://cdn.jsdelivr.net/")) await wait(60);
            return fakeGithub(url);
        }) as typeof fetch;
        const { host, message, view } = await boot();
        const from = host.calls.length;
        await message({ type: "open", url: "https://github.com/honojs/hono/pull/5513" });
        await until(() => host.calls.some((c) => c.type === "command:camera:fly-to-rect"));
        globalThis.fetch = fakeGithub as typeof fetch;
        const types = host.calls.slice(from).map((c) => c.type);
        const add = types.indexOf("command:scene:add-drawdy-elements");
        expect(types.filter((t) => t === "command:scene:add-drawdy-elements")).toHaveLength(1);
        expect(types.slice(0, add)).not.toContain("command:camera:fly-to-rect");
        expect(types.slice(add).filter((t) => t === "command:camera:fly-to-rect")).toHaveLength(1);
        // The board lands with the description in the panel: not a step, so – / 8, Previous off, Next on.
        expect(view()).toMatchObject({ phase: "ready", current: -1, total: 8, hasPrevious: false, hasNext: true, card: { pin: "pr", about: ["usualoma · 4 files"], warnings: [] } });
        expect(view().card).toHaveProperty("description", expect.stringContaining("<h3>Behavior change</h3>"));
        // Cards take the theme Drawdy shows the reader who pins them.
        const pinned = host.calls.find((c) => c.type === "command:scene:add-drawdy-elements")!.req.elements;
        const cards = pinned.filter((e: any) => e.type === "component").map((e: any) => e.schema.children[0].child.srcDoc as string);
        expect(cards.every((html: string) => html.includes("color-scheme: dark;"))).toBe(true);
        expect(pinned.find((e: any) => e.meta.prBlackboard.part === "pr").meta.prBlackboard.theme).toBe("dark");
        const views: LoadStep[][] = host.calls.filter((c) => c.type === "command:webview:post-message" && c.req.message.view?.phase === "loading").map((c) => c.req.message.view.loading);
        // As a CI job: every step ended, each with the time it took, and no `first time only`; pinning showed under way before.
        expect(views.at(-1)!.map((l) => `${l.state} ${l.label}${l.note ? ` · ${l.note}` : ""}`)).toEqual(["done Reading the PR", "done Downloading the parser", "done Reading 4 changed files", "done Finding the lines", "done Pinning 10 cards"]);
        expect(views.at(-1)!.every((l) => /^\d+\.\d s$/.test(l.meta ?? ""))).toBe(true);
        expect(views.some((steps) => steps.at(-1)!.state === "active" && steps.at(-1)!.label === "Pinning 10 cards")).toBe(true);
        // The download runs beside the reads, a row for TypeScript, while the changed files are listed under theirs.
        const beside = views.find((steps) => steps[1].key === "parser" && steps[1].state === "active" && steps[2].state === "active")!;
        expect(beside[1].rows).toEqual([{ label: "TypeScript", state: "active" }]);
        expect(beside[2].rows!.map((r) => r.label)).toEqual(["src/compose.ts", "src/hono-base.ts", "src/compose.test.ts", "src/hono.test.ts"]);
    });

    it("picks up a board already pinned with the PR card current, as after pinning", async () => {
        const first = await boot();
        await first.message({ type: "open", url: "https://github.com/honojs/hono/pull/5513" });
        await until(() => first.host.calls.some((c) => c.type === "command:camera:fly-to-rect"));
        // A reload: a new runtime over the same board; the reader opens the panel.
        const { host, openPanel, view } = await boot({ panel: false });
        for (const [id, e] of first.host.elements) host.elements.set(id, e);
        const from = host.calls.length;
        await openPanel();
        await until(() => view().phase === "ready");
        expect(view()).toMatchObject({ phase: "ready", current: -1, hasNext: true, card: { pin: "pr" } });
        expect(host.calls.slice(from).map((c) => c.type)).not.toContain("command:camera:fly-to-rect");
    });

    it("closes Read all on Esc in the panel", async () => {
        const { host, message, view } = await boot();
        await message({ type: "open", url: "https://github.com/honojs/hono/pull/5513" });
        await until(() => host.calls.some((c) => c.type === "command:camera:fly-to-rect"));
        await message({ type: "next" });
        await until(() => view().current === 0);
        await message({ type: "read-all" });
        // From the overview, Read all first brings the camera to where it reads.
        await until(() => host.calls.some((c) => c.type === "command:dom:upsert-floating-element"));
        const from = host.calls.length;
        await message({ type: "close" });
        await wait(20);
        expect(host.calls.slice(from).map((c) => c.type)).toContain("command:dom:remove-floating-element");
    });
});

describe("the reading view on hono#5513", () => {
    const realFetch = globalThis.fetch;
    beforeAll(() => {
        globalThis.fetch = fakeGithub as typeof fetch;
    });
    afterAll(() => {
        globalThis.fetch = realFetch;
    });

    const opened = async (extra: Record<string, (req: any) => unknown> = {}) => {
        const booted = await boot({ extra });
        await booted.message({ type: "open", url: "https://github.com/honojs/hono/pull/5513" });
        await until(() => booted.host.calls.some((c) => c.type === "command:camera:fly-to-rect"));
        return booted;
    };

    it("names each link in its string's colour, from the string's mark, and a link with no string in none", async () => {
        const { host, message, view } = await opened();
        const colours = new Map([...host.elements.values()].filter((e) => e.schema.type === "arrow").map((e) => [e.schema.meta.prBlackboard.link as string, e.schema.color as string]));
        for (let i = 0; i < 3; i++) {
            const at = view().current;
            await message({ type: "next" });
            await until(() => view().current !== at);
        }
        const card = view().card as CodeCard;
        expect(card.name).toBe("compose()");
        const chips = card.links.flatMap((row) => row.chips);
        expect(chips.map((c) => [c.name, c.colour === null ? null : STRING_COLOURS[c.colour]])).toEqual(chips.map((c) => [c.name, colours.get(c.link) ?? null]));
        // hono-base.ts imports compose(), but its string finds no route: the panel names it uncoloured.
        expect(chips.find((c) => c.name === "hono-base.ts")).toMatchObject({ colour: null });
        expect(chips.filter((c) => c.colour !== null).length).toBeGreaterThan(1);
    });

    it("makes the PR card current on Description and flies the camera to it; the steps go on from there", async () => {
        const { host, message, view } = await opened();
        await message({ type: "next" });
        await until(() => view().current === 0);
        await message({ type: "next" });
        await until(() => view().current === 1);
        expect(view()).toMatchObject({ current: 1, hasPrevious: true });
        const flights = () => host.calls.filter((c) => c.type === "command:camera:fly-to-rect").length;
        const flown = flights();
        await message({ type: "description" });
        await until(() => view().card?.pin === "pr" && flights() > flown);
        expect(view()).toMatchObject({ current: -1, hasPrevious: false, hasNext: true, card: { pin: "pr" } });
        expect(flights()).toBe(flown + 1);
        await message({ type: "next" });
        await until(() => view().current === 0);
        expect(view()).toMatchObject({ current: 0, card: { name: "#dispatch()" } });
    });

    it("shows a failed action's error on the toolbar's line, in the reading view, until the next action", async () => {
        let refuse = false;
        const { message, view } = await opened({
            "command:dom:upsert-floating-element": () => {
                if (refuse) throw new Error("no room");
                return { created: true };
            },
        });
        refuse = true;
        await message({ type: "next" });
        await until(() => view().current === 0);
        await message({ type: "read-all" });
        await until(() => view().error !== null);
        expect(view()).toMatchObject({ phase: "ready", card: { name: "#dispatch()" }, error: expect.stringContaining("no room") });
        await message({ type: "next" });
        expect(view().error).toBeNull();
    });
});

describe("the runtime and GitHub", () => {
    const realFetch = globalThis.fetch;
    beforeAll(() => {
        globalThis.fetch = fakeGithub as typeof fetch;
    });
    afterAll(() => {
        globalThis.fetch = realFetch;
    });

    it("says which links work when one isn't a GitHub pull request, in the start view, the only place errors show", async () => {
        const { host, message, view } = await boot();
        await message({ type: "open", url: "https://gitlab.com/a/b/-/merge_requests/1" });
        expect(view()).toMatchObject({ phase: "start", error: "Only GitHub PR links work, like github.com/owner/repo/pull/123." });
        await message({ type: "open", url: "https://github.com/honojs/hono/pull/5513" });
        await until(() => host.calls.some((c) => c.type === "command:camera:fly-to-rect"));
        await message({ type: "open", url: "not a link" });
        expect(view()).toMatchObject({ phase: "start", error: expect.stringMatching(/^Only GitHub/) });
    });

    it("goes back to the start view on Home, Read all closed and the board kept, and a click on one of its cards reads it again", async () => {
        const { host, message, view, click } = await boot();
        await message({ type: "open", url: "https://github.com/honojs/hono/pull/5513" });
        await until(() => host.calls.some((c) => c.type === "command:camera:fly-to-rect"));
        await message({ type: "next" });
        await until(() => view().card?.pin !== "pr");
        await message({ type: "read-all" });
        await until(() => host.calls.some((c) => c.type === "command:dom:upsert-floating-element"));
        const from = host.calls.length;
        await message({ type: "start" });
        await wait(20);
        expect([view().phase, view().error]).toEqual(["start", null]);
        expect(host.calls.slice(from).map((c) => c.type)).toContain("command:dom:remove-floating-element");
        expect(host.calls.slice(from).filter((c) => /^command:scene:(remove|delete)/.test(c.type))).toEqual([]);
        const card = cardsOf(host).get("src/compose.ts:18")!;
        await click([card.id], { x: card.rect.x + 40, y: card.rect.y + 20 });
        await wait(20);
        expect(view()).toMatchObject({ phase: "ready", error: null, card: { name: "compose()" } });
        // Hono's tag keeps its project's colour.
        expect(view().tag).toEqual({ label: "honojs/hono#5513", colour: "#E36002" });
    });

    it("flies to a pull request already on the board at its head commit, silently, and pins nothing more", async () => {
        const { host, message, view } = await boot();
        await message({ type: "open", url: "https://github.com/honojs/hono/pull/5513" });
        await until(() => host.calls.some((c) => c.type === "command:camera:fly-to-rect"));
        const adds = () => host.calls.filter((c) => c.type === "command:scene:add-drawdy-elements").length;
        const flights = () => host.calls.filter((c) => c.type === "command:camera:fly-to-rect").length;
        const before = flights();
        await message({ type: "open", url: "https://github.com/honojs/hono/pull/5513" });
        await until(() => flights() > before);
        expect([adds(), view().phase, view().error]).toEqual([1, "ready", null]);
    });

    it("works from the board after a reload with the panel never opened: a fold row opens Read all, a label follows its string", async () => {
        const first = await boot();
        await first.message({ type: "open", url: "https://github.com/honojs/hono/pull/5513" });
        await until(() => first.host.calls.some((c) => c.type === "command:camera:fly-to-rect"));
        // A reload: a new runtime over the same board, the panel never opened.
        const { host, click } = await boot({ panel: false });
        for (const [id, e] of first.host.elements) host.elements.set(id, e);
        const subscribed = host.calls.map((c) => c.type);
        for (const type of ["subscription:scene:click", "subscription:scene:elements-removed", "subscription:scene:elements-replaced", "subscription:keyboard:control-keys"]) expect(subscribed).toContain(type);
        expect(subscribed).not.toContain("subscription:camera:moved-rapid");
        const compose = cardsOf(host).get("src/compose.ts:18")!;
        const fold = (compose.mark.folds as [number, number][])[0];
        const from = host.calls.length;
        await click([compose.id], { x: compose.rect.x + 100, y: compose.rect.y + fold[0] + 10 });
        await until(() => host.calls.slice(from).some((c) => c.type === "command:dom:upsert-floating-element"));
        const types = host.calls.slice(from).map((c) => c.type);
        expect(types[0]).toBe("command:scene:get-drawdy-elements");
        expect(types).toContain("command:dom:upsert-floating-element");
        expect(types).toContain("subscription:camera:moved-rapid");
        const label = [...host.elements].find(([, e]) => e.schema.meta?.prBlackboard?.part === "label")![0];
        const before = host.calls.length;
        await click([label], { x: 0, y: 0 });
        await wait(20);
        expect(host.calls.slice(before).map((c) => c.type)).toContain("command:camera:fly-to-rect");
    });

    it("picks up the board with the card last clicked current when the panel opens", async () => {
        const first = await boot();
        await first.message({ type: "open", url: "https://github.com/honojs/hono/pull/5513" });
        await until(() => first.host.calls.some((c) => c.type === "command:camera:fly-to-rect"));
        const { host, click, openPanel, view } = await boot({ panel: false });
        for (const [id, e] of first.host.elements) host.elements.set(id, e);
        const compose = cardsOf(host).get("src/compose.ts:18")!;
        await click([compose.id], { x: compose.rect.x + 40, y: compose.rect.y + 66 });
        await openPanel();
        await until(() => view().phase === "ready");
        expect(view()).toMatchObject({ phase: "ready", current: 2, card: { name: "compose()" } });
    });

    it("says why on the loading view, at its failed step, when the panel opens on a board it can't pick up", async () => {
        const first = await boot();
        await first.message({ type: "open", url: "https://github.com/honojs/hono/pull/5513" });
        await until(() => first.host.calls.some((c) => c.type === "command:camera:fly-to-rect"));
        // A teammate with no copy of the review, on a network GitHub is limiting.
        globalThis.fetch = (async () => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } })) as typeof fetch;
        try {
            const { host, openPanel, view } = await boot({ panel: false });
            for (const [id, e] of first.host.elements) host.elements.set(id, e);
            await openPanel();
            await until(() => view().annotations.length > 0);
            expect(view()).toMatchObject({
                phase: "loading",
                tag: { label: "honojs/hono#5513" },
                annotations: [{ level: "failure", title: "GitHub rate limit reached", detail: "GitHub is limiting requests from this network. Try again in a few minutes." }],
            });
            expect(view().loading.map((l) => `${l.key} ${l.state}`)).toEqual(["pr failed", "files todo", "link todo", "pin todo"]);
        } finally {
            globalThis.fetch = fakeGithub as typeof fetch;
        }
    });

    it("keeps a failed open on the loading view at the step it failed on, why under the steps, until Home; Try again opens it, reusing the PR read", async () => {
        const net = fakeFetch("hono-5513.json");
        globalThis.fetch = (async (url: string) => (url.startsWith("https://cdn.jsdelivr.net/") ? new Response("", { status: 503 }) : net.fetch(url))) as typeof fetch;
        try {
            const { host, message, view } = await boot();
            await message({ type: "open", url: "https://github.com/honojs/hono/pull/5513" });
            await until(() => view().annotations.some((a) => a.level === "failure"));
            expect(view()).toMatchObject({ phase: "loading", error: null, annotations: [{ level: "failure", title: "Download failed", detail: "Couldn't download the TypeScript parser from cdn.jsdelivr.net. Try again." }] });
            expect(view().loading.map((l) => `${l.key} ${l.state}`)).toEqual(["pr done", "parser failed", "files todo", "link todo", "pin todo"]);
            expect(view().loading[1].rows).toEqual([{ label: "TypeScript", state: "failed" }]);
            await message({ type: "start" });
            expect(view()).toMatchObject({ phase: "start", error: null, loading: [], annotations: [] });
            // Try again sends the tag's `owner/repo#number`, and the PR and its files read before cost nothing more.
            globalThis.fetch = net.fetch as typeof fetch;
            const asked = net.requests.length;
            await message({ type: "open", url: "honojs/hono#5513" });
            await until(() => host.calls.some((c) => c.type === "command:camera:fly-to-rect"), 20_000);
            expect(view()).toMatchObject({ phase: "ready", card: { pin: "pr" } });
            expect(net.requests.slice(asked).filter((url) => url.startsWith("https://api.github.com/"))).toEqual([]);
        } finally {
            globalThis.fetch = fakeGithub as typeof fetch;
        }
    }, 30_000);

    it("warns on the loading view and at the PR card when this network's GitHub requests run low, until they reset", async () => {
        const net = fakeFetch("hono-5513.json");
        const reset = Math.ceil(Date.now() / 1000) + 38 * 60;
        globalThis.fetch = (async (url: string) => {
            const res = await net.fetch(url);
            if (!url.startsWith("https://api.github.com/")) return res;
            return new Response(await res.text(), { headers: { "x-ratelimit-limit": "60", "x-ratelimit-remaining": url.includes("/files") ? "3" : "4", "x-ratelimit-reset": String(reset) } });
        }) as typeof fetch;
        try {
            const { host, message, view } = await boot();
            await message({ type: "open", url: "https://github.com/honojs/hono/pull/5513" });
            await until(() => host.calls.some((c) => c.type === "command:camera:fly-to-rect"));
            const loading: PanelView[] = host.calls.filter((c) => c.type === "command:webview:post-message" && c.req.message.view?.phase === "loading").map((c) => c.req.message.view);
            const warned = loading.find((v) => v.annotations.length > 0)!;
            expect(warned.annotations.map((a) => a.title)).toEqual(["3 GitHub requests left"]);
            expect(warned.loading[0]).toMatchObject({ key: "pr", state: "warning" });
            expect((view().card as { warnings: { title: string }[] }).warnings.map((w) => w.title)).toEqual(["3 GitHub requests left"]);
        } finally {
            globalThis.fetch = fakeGithub as typeof fetch;
        }
    });
});

describe("rebuilding a board", () => {
    /** An open and a rebuild each read and parse the pull request. */
    const SLOW = 30_000;
    const realFetch = globalThis.fetch;
    afterAll(() => {
        globalThis.fetch = realFetch;
    });

    /**
     * hono#5513 opened from a fake GitHub whose requests are counted; `answer`
     * changes what GitHub says from then on, and `hold` keeps its API
     * answers back until `release`. excalidraw#12237 can be opened beside it,
     * from a GitHub of its own. `extra` gets the host once it is made, for
     * commands that act on it.
     */
    const opened = async (options: { extra?: (host: () => ReturnType<typeof fakeHost>) => Record<string, (req: any) => unknown> } = {}) => {
        const net = fakeFetch("hono-5513.json");
        const other = fakeFetch("excalidraw-12237.json");
        let pull: ((url: string) => Response | null) | null = null;
        let held: Promise<void> | null = null;
        let release = () => {};
        globalThis.fetch = (async (url: string) => {
            if (url.includes("/excalidraw/excalidraw/")) return other.fetch(url);
            if (held && url.startsWith("https://api.github.com/")) await held;
            return pull?.(url) ?? net.fetch(url);
        }) as typeof fetch;
        let made: ReturnType<typeof fakeHost> | null = null;
        const booted = await boot({ extra: options.extra?.(() => made!) });
        made = booted.host;
        await booted.message({ type: "open", url: "https://github.com/honojs/hono/pull/5513" });
        await until(() => booted.host.calls.some((c) => c.type === "command:camera:fly-to-rect"), SLOW);
        const api = () => net.requests.filter((url) => url.startsWith("https://api.github.com/")).length;
        const jsdelivr = () => net.requests.filter((url) => url.startsWith("https://cdn.jsdelivr.net/")).length;
        return {
            ...booted,
            net,
            api,
            jsdelivr,
            answer: (f: (url: string) => Response | null) => (pull = f),
            hold: () => {
                held = new Promise((resolve) => (release = resolve));
            },
            release: () => {
                held = null;
                release();
            },
        };
    };
    /** A board's PR card, by its pull request: two boards may share the canvas. */
    const prCardOf = (host: ReturnType<typeof fakeHost>, pr: string) => {
        const [id, e] = [...host.elements].find(([, e]) => e.schema.type === "component" && e.schema.meta?.prBlackboard?.pr === pr && e.schema.meta.prBlackboard.pin === "pr")!;
        return { id, at: { x: e.rect.x + 20, y: e.rect.y + 20 } };
    };
    const EXCALIDRAW = "https://github.com/excalidraw/excalidraw/pull/12237";
    const reading = (view: () => PanelView, label: string) => () => view().phase === "ready" && view().tag?.label === label;
    const ours = (host: ReturnType<typeof fakeHost>) => [...host.elements].filter(([, e]) => e.schema.meta?.prBlackboard).map(([id]) => id);
    const flights = (host: ReturnType<typeof fakeHost>) => host.calls.filter((c) => c.type === "command:camera:fly-to-rect").length;

    it("reads GitHub again past the stored copy, pins the new board at the old PR card's corner, then removes only the old board", async () => {
        const { host, message, view, api, jsdelivr } = await opened();
        const before = ours(host);
        const prId = cardsOf(host).get("pr")!.id;
        // The reader moved the PR card, and drew a note of their own beside the board.
        Object.assign(host.elements.get(prId)!.rect, { x: 5000, y: 3000 });
        host.add({ type: "text", drawdyElementId: "readers-note", x: 5100, y: 2900, text: "check this" });
        const [apiBefore, jsdelivrBefore, from, flown] = [api(), jsdelivr(), host.calls.length, flights(host)];
        await message({ type: "rebuild" });
        await until(() => flights(host) > flown, SLOW);
        const scene = host.calls.slice(from).filter((c) => /^command:scene:(add|remove|update)-/.test(c.type));
        expect(scene.map((c) => c.type)).toEqual(["command:scene:add-drawdy-elements", "command:scene:remove-drawdy-elements"]);
        expect([...scene[1].req.drawdyElementIds].sort()).toEqual([...before].sort());
        expect([api() - apiBefore, jsdelivr() - jsdelivrBefore]).toEqual([2, 0]);
        expect(host.elements.has("readers-note")).toBe(true);
        expect(ours(host).some((id) => before.includes(id))).toBe(false);
        const pr = cardsOf(host).get("pr")!;
        expect([pr.rect.x, pr.rect.y]).toEqual([5000, 3000]);
        expect(cardsOf(host).size).toBe(10);
        expect(view()).toMatchObject({ phase: "ready", error: null, rebuilding: null, rebuildCost: null, card: { pin: "pr" } });
    }, SLOW);

    it("says the step under way in the reading view, the old board read meanwhile", async () => {
        const { host, message, view } = await opened();
        const from = host.calls.length;
        const flown = flights(host);
        await message({ type: "rebuild" });
        await until(() => flights(host) > flown, SLOW);
        const views = host.calls.slice(from).filter((c) => c.type === "command:webview:post-message" && c.req.message.type === "view").map((c) => c.req.message.view as PanelView);
        expect(views.every((v) => v.phase === "ready")).toBe(true);
        const words = [...new Set(views.map((v) => v.rebuilding).filter((w) => w !== null))];
        expect(words).toEqual(expect.arrayContaining(["Reading the PR", "Reading 4 changed files", "Pinning 10 cards"]));
        expect(view().rebuilding).toBeNull();
    }, SLOW);

    it("leaves the old board as it was when GitHub can't be read, says why in the reading view, and clears it at the next step", async () => {
        const { host, message, view, answer } = await opened();
        const before = new Map([...host.elements].map(([id, e]) => [id, { ...e.rect }]));
        answer((url) => (url.startsWith("https://api.github.com/") ? new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } }) : null));
        const from = host.calls.length;
        await message({ type: "rebuild" });
        await until(() => view().error !== null, SLOW);
        expect(view()).toMatchObject({ phase: "ready", rebuilding: null, error: "GitHub is limiting requests from this network. Try again in a few minutes.", card: { pin: "pr" } });
        expect(host.calls.slice(from).filter((c) => /^command:scene:(add|remove|update)-/.test(c.type))).toEqual([]);
        expect(new Map([...host.elements].map(([id, e]) => [id, { ...e.rect }]))).toEqual(before);
        await message({ type: "next" });
        await wait(20);
        expect(view().error).toBeNull();
    }, SLOW);

    it("leaves the old board when the new one can't be pinned", async () => {
        let refuse = false;
        const { host, message, view } = await opened({
            extra: (made) => ({
                "command:scene:add-drawdy-elements": (req) => {
                    if (refuse) throw new Error("no room");
                    for (const e of req.elements) made().add(e);
                    return undefined;
                },
            }),
        });
        refuse = true;
        const before = ours(host);
        await message({ type: "rebuild" });
        await until(() => view().error !== null, SLOW);
        expect(view()).toMatchObject({ phase: "ready", error: "Couldn't pin the board. Try again." });
        expect(ours(host).sort()).toEqual(before.sort());
    }, SLOW);

    it("keeps reading the rebuilt board, at its new head commit, when Drawdy reports the old board's removal", async () => {
        let removed: string[] = [];
        let deliver: (event: DriverSubscriptionEvent) => Promise<void> = async () => undefined;
        // Drawdy tells the driver of the removal, as of any, before the command itself answers.
        const { host, message, view, answer, handle } = await opened({
            extra: (made) => ({
                "command:scene:remove-drawdy-elements": (req) => {
                    const gone = req.drawdyElementIds.filter((id: string) => made().elements.has(id));
                    const metas = gone.map((id: string) => ({ id, meta: made().elements.get(id)!.schema.meta }));
                    for (const id of gone) made().remove(id);
                    removed = gone;
                    void deliver({ type: "subscription:scene:elements-removed", subscriptionId: "t", body: { drawdyElements: metas, properties: ["meta"] } } as DriverSubscriptionEvent);
                    return { removed: gone.length };
                },
            }),
        });
        deliver = handle;
        // New commits since: GitHub answers with another head, whose files read as before.
        const saved = JSON.parse(readFileSync(join(import.meta.dirname, "../lib/fixtures/hono-5513.json"), "utf8"));
        const head = saved.pull.head.sha as string;
        const newer = "f".repeat(40);
        const pulls = "https://api.github.com/repos/honojs/hono/pulls/5513";
        answer((url) => (url === pulls ? new Response(JSON.stringify({ ...saved.pull, head: { ...saved.pull.head, sha: newer } }), { headers: { "x-ratelimit-remaining": "57" } }) : null));
        const net = globalThis.fetch;
        globalThis.fetch = (async (url: string) => net(url.replace(newer, head))) as typeof fetch;
        const flown = flights(host);
        await message({ type: "rebuild" });
        await until(() => flights(host) > flown, SLOW);
        await wait(50);
        expect(removed.length).toBeGreaterThan(0);
        expect(view()).toMatchObject({ phase: "ready", error: null, card: { pin: "pr" } });
        expect(new Set([...host.elements.values()].map((e) => e.schema.meta?.prBlackboard?.sha).filter(Boolean))).toEqual(new Set([newer]));
        await message({ type: "next" });
        await wait(20);
        expect(view().card).toMatchObject({ name: "#dispatch()" });
    }, SLOW);

    it("runs one rebuild at a time: a second press, at once or 120 ms later, is refused while one runs", async () => {
        const { host, message, view, api, hold, release } = await opened();
        const [apiBefore, from, flown] = [api(), host.calls.length, flights(host)];
        hold();
        await message({ type: "rebuild" });
        await message({ type: "rebuild" });
        await wait(120);
        await message({ type: "rebuild" });
        release();
        await until(() => flights(host) > flown, SLOW);
        await wait(200);
        const scene = host.calls.slice(from).filter((c) => /^command:scene:(add|remove)-/.test(c.type));
        expect(scene.map((c) => c.type)).toEqual(["command:scene:add-drawdy-elements", "command:scene:remove-drawdy-elements"]);
        expect([api() - apiBefore, flights(host) - flown, view().rebuilding]).toEqual([2, 1, null]);
    }, SLOW);

    it("lands silently after Home: the start view and the camera stay, and a click on the new board reads it", async () => {
        const { host, message, view, click, hold, release } = await opened();
        hold();
        await message({ type: "rebuild" });
        await message({ type: "start" });
        const [from, flown] = [host.calls.length, flights(host)];
        release();
        await until(() => host.calls.slice(from).some((c) => c.type === "command:scene:remove-drawdy-elements") && view().rebuilding === null, SLOW);
        await wait(50);
        expect([view().phase, flights(host) - flown]).toEqual(["start", 0]);
        const compose = cardsOf(host).get("src/compose.ts:18")!;
        await click([compose.id], { x: compose.rect.x + 40, y: compose.rect.y + 20 });
        await wait(20);
        expect(view()).toMatchObject({ phase: "ready", card: { name: "compose()" }, rebuilding: null });
    }, SLOW);

    it("opens another pull request at once while a rebuild waits on GitHub, naming the rebuild on its toolbar's line, and the rebuild lands silently", async () => {
        const { host, message, view, hold, release } = await opened();
        const old = new Set([...host.elements.keys()]);
        hold();
        await message({ type: "rebuild" });
        await message({ type: "start" });
        await message({ type: "open", url: EXCALIDRAW });
        // excalidraw opens, board and all, while hono's rebuild still waits for GitHub.
        await until(reading(view, "excalidraw/excalidraw#12237"), SLOW);
        expect(view().rebuilding).toBe("honojs/hono#5513 · Reading the PR");
        const flown = flights(host);
        release();
        await until(() => view().rebuilding === null, SLOW);
        await wait(50);
        expect([view().tag?.label, view().phase, flights(host) - flown]).toEqual(["excalidraw/excalidraw#12237", "ready", 0]);
        expect([...host.elements.keys()].filter((id) => old.has(id))).toEqual([]);
    }, SLOW);

    it("clears a rebuild's error when a click moves the panel to another board", async () => {
        const { host, message, view, click, answer } = await opened();
        await message({ type: "start" });
        await message({ type: "open", url: EXCALIDRAW });
        await until(reading(view, "excalidraw/excalidraw#12237"), SLOW);
        const hono = prCardOf(host, "honojs/hono#5513");
        await click([hono.id], hono.at);
        await until(reading(view, "honojs/hono#5513"), SLOW);
        answer((url) => (url.startsWith("https://api.github.com/repos/honojs/") ? new Response("{}", { status: 404 }) : null));
        await message({ type: "rebuild" });
        await until(() => view().error !== null, SLOW);
        expect(view()).toMatchObject({ tag: { label: "honojs/hono#5513" }, error: "GitHub can't find this PR any more.", rebuilding: null });
        const excalidraw = prCardOf(host, "excalidraw/excalidraw#12237");
        await click([excalidraw.id], excalidraw.at);
        await until(reading(view, "excalidraw/excalidraw#12237"), SLOW);
        expect(view().error).toBeNull();
    }, SLOW);

    it("says on another board's line that a rebuild failed while the reader was there, until their next action", async () => {
        const { host, message, view, click, answer, hold, release } = await opened();
        await message({ type: "start" });
        await message({ type: "open", url: EXCALIDRAW });
        await until(reading(view, "excalidraw/excalidraw#12237"), SLOW);
        const hono = prCardOf(host, "honojs/hono#5513");
        await click([hono.id], hono.at);
        await until(reading(view, "honojs/hono#5513"), SLOW);
        const before = [...host.elements.keys()].sort();
        hold();
        await message({ type: "rebuild" });
        const excalidraw = prCardOf(host, "excalidraw/excalidraw#12237");
        await click([excalidraw.id], excalidraw.at);
        await until(reading(view, "excalidraw/excalidraw#12237"), SLOW);
        answer((url) => (url.startsWith("https://api.github.com/repos/honojs/") ? new Response("{}", { status: 404 }) : null));
        release();
        await until(() => view().rebuilding === null, SLOW);
        expect(view()).toMatchObject({ tag: { label: "excalidraw/excalidraw#12237" }, error: "honojs/hono#5513 · failed: GitHub can't find this PR any more." });
        expect([...host.elements.keys()].sort()).toEqual(before);
        await message({ type: "next" });
        await wait(20);
        expect(view().error).toBeNull();
    }, SLOW);

    it("picks up the newest of two boards of one pull request, stacked by a reload between a rebuild's add and its removal", async () => {
        const saved = JSON.parse(readFileSync(join(import.meta.dirname, "../lib/fixtures/hono-5513.json"), "utf8"));
        const head = saved.pull.head.sha as string;
        const pulls = "https://api.github.com/repos/honojs/hono/pulls/5513";
        const net = fakeFetch("hono-5513.json");
        let answering = head;
        globalThis.fetch = (async (url: string) =>
            url === pulls
                ? new Response(JSON.stringify({ ...saved.pull, head: { ...saved.pull.head, sha: answering } }), { headers: { "x-ratelimit-remaining": "57" } })
                : net.fetch(url.replace(answering, head))) as typeof fetch;
        const first = await boot();
        await first.message({ type: "open", url: "https://github.com/honojs/hono/pull/5513" });
        await until(() => first.host.calls.some((c) => c.type === "command:camera:fly-to-rect"), SLOW);
        // The same commit, and new commits since: either way the newer board, added last, 3,000 to the right, is the one read.
        for (const sha of [head, "f".repeat(40)]) {
            answering = sha;
            const { host, openPanel, view, message } = await boot({ panel: false });
            for (const [id, e] of first.host.elements) host.elements.set(id, e);
            for (const [id, e] of first.host.elements) {
                const mark = { ...e.schema.meta.prBlackboard, sha };
                host.elements.set(`${id}-new`, { ...e, rect: { ...e.rect, x: e.rect.x + 3000 }, schema: { ...e.schema, meta: { ...e.schema.meta, prBlackboard: mark } } });
            }
            await openPanel();
            await until(() => view().phase === "ready", SLOW);
            expect(view()).toMatchObject({ phase: "ready", error: null, card: { pin: "pr" } });
            const from = host.calls.length;
            await message({ type: "next" });
            await until(() => host.calls.slice(from).some((c) => c.type === "command:camera:fly-to-rect"), SLOW);
            const flight = host.calls.slice(from).find((c) => c.type === "command:camera:fly-to-rect")!;
            expect([view().card, flight.req.rect.x > 2000]).toEqual([expect.objectContaining({ name: "#dispatch()" }), true]);
        }
    }, SLOW);

    it("stays on another board the reader clicked while the rebuild ran", async () => {
        const { host, message, view, click, hold, release } = await opened();
        await message({ type: "start" });
        await message({ type: "open", url: EXCALIDRAW });
        await until(reading(view, "excalidraw/excalidraw#12237"), SLOW);
        const hono = prCardOf(host, "honojs/hono#5513");
        await click([hono.id], hono.at);
        await until(reading(view, "honojs/hono#5513"), SLOW);
        hold();
        await message({ type: "rebuild" });
        const excalidraw = prCardOf(host, "excalidraw/excalidraw#12237");
        await click([excalidraw.id], excalidraw.at);
        await until(reading(view, "excalidraw/excalidraw#12237"), SLOW);
        const flown = flights(host);
        release();
        await until(() => view().rebuilding === null, SLOW);
        await wait(50);
        expect([view().tag?.label, view().phase, flights(host) - flown]).toEqual(["excalidraw/excalidraw#12237", "ready", 0]);
    }, SLOW);
});

describe("the description, lexed once", () => {
    const realFetch = globalThis.fetch;
    afterAll(() => {
        globalThis.fetch = realFetch;
    });

    it("is lexed once on this thread for the board, the panel, the steps and Description", async () => {
        const saved = JSON.parse(readFileSync(join(import.meta.dirname, "../lib/fixtures/hono-5513.json"), "utf8"));
        // A description no other test reads, so no earlier lex is remembered.
        const marker = `Lexed once, ${Date.now()}.`;
        const pulls = "https://api.github.com/repos/honojs/hono/pulls/5513";
        const net = fakeFetch("hono-5513.json");
        globalThis.fetch = (async (url: string) =>
            url === pulls ? new Response(JSON.stringify({ ...saved.pull, body: `${saved.pull.body}\n\n${marker}` }), { headers: { "x-ratelimit-remaining": "57" } }) : net.fetch(url)) as typeof fetch;
        const blocks = jest.spyOn(Lexer.prototype, "blockTokens");
        try {
            const { host, message, view } = await boot();
            await message({ type: "open", url: "https://github.com/honojs/hono/pull/5513" });
            await until(() => host.calls.some((c) => c.type === "command:camera:fly-to-rect"), 30_000);
            expect((view().card as { description: string }).description).toContain(marker);
            for (const type of ["next", "previous", "description", "start"]) await message({ type });
            await wait(50);
            expect(blocks.mock.calls.filter(([src]) => typeof src === "string" && src.includes(marker))).toHaveLength(1);
        } finally {
            blocks.mockRestore();
        }
    }, 30_000);
});

describe("what a rebuild costs", () => {
    it("is said only when it is more than the usual 2 GitHub requests", () => {
        expect([rebuildCostOf(4), rebuildCostOf(100), rebuildCostOf(101), rebuildCostOf(2188)]).toEqual([null, null, { files: 101, requests: 3 }, { files: 2188, requests: 23 }]);
    });
});

describe("project colours", () => {
    it("colour any pull request of an example project, by its repository, and leave others neutral", () => {
        expect([projectColour("honojs/hono#1"), projectColour("HonoJS/Hono#5513"), projectColour("someone/else#1")]).toEqual(["#E36002", "#E36002", null]);
    });
});

describe("the panel protocol", () => {
    it("accepts only what the panel can ask for", () => {
        for (const type of ["ready", "start", "next", "previous", "overview", "description", "read-all", "close", "rebuild"]) expect(parse(webviewToDriver, { type })).not.toBeNull();
        expect(parse(webviewToDriver, { type: "open", url: "x" })).not.toBeNull();
        expect(parse(webviewToDriver, { type: "follow", link: "x" })).not.toBeNull();
        expect(parse(webviewToDriver, { type: "unknown" })).toBeNull();
        expect(parse(webviewToDriver, { type: "open" })).toBeNull();
    });
});
