/**
 * Reproduces Drawdy's marketplace build lane locally, so a submission can't fail on something a dev build hides:
 *
 * 1. bundles src/index.ts with esbuild as one browser CommonJS file (ES2020), unminified, as the marketplace does;
 * 2. fails on any bare import other than `@drawdy/driver-protocol`, a bundle of 1 MB or more, or a parser worker
 *    script (src/worker/script.ts) behind its sources;
 * 3. boots the bundle in a fake Drawdy host, runs the generated webview in jsdom until it reports `ready`, opens a
 *    saved PR (honojs/hono#5513) from a fake GitHub and jsDelivr, and walks the board: the one add call, the
 *    strings, the steps, Description, the link names' colours, Read all, Home, a rebuild and Clear, pressed in the bundled
 *    panel itself, its confirm answered with ✓. Node has no Worker, so
 *    the parser worker's script runs on the driver's thread, as where no worker can start. Then it boots the bundle
 *    again, as after a reload, and checks the board works with the panel never opened and nothing from jsDelivr;
 * 4. checks a 32-card board's add payload stays small;
 * 5. packs dist/marketplace/<driver-id>.drawdyx (see `npm run preview`).
 *
 * Usage: node scripts/check.ts
 */

import type { DriverModule, ModuleStyling } from "@drawdy/driver-protocol";
import { build, type Plugin } from "esbuild";
import { strToU8, zipSync } from "fflate";
import { JSDOM } from "jsdom";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reviewElements } from "../src/driver/elements.ts";
import { groupBy } from "../src/lib/fp.ts";
import { STRING_COLOURS, planBoard } from "../src/lib/layout.ts";
import { LIMITS } from "../src/lib/model.ts";
import { fakeFetch } from "../src/test/fake-fetch.ts";
import { fakeHost, keptStorage } from "../src/test/fake-host.ts";
import { reviewOf } from "../src/test/fixture.ts";
import { crowded } from "../src/test/synthetic.ts";
import { SCRIPT_FILE, workerScriptFile } from "./worker.ts";

const ROOT = join(import.meta.dirname, "..");
const ALLOWED_IMPORTS = new Set(["@drawdy/driver-protocol"]);
const MAX_BUNDLE_BYTES = 1_000_000;
const MAX_PAYLOAD_BYTES = 512 * 1024;
/** Drawdy's marketplace build refuses a listing icon over 256 KB. */
const MAX_ICON_BYTES = 256 * 1024;
const HONO = "https://github.com/honojs/hono/pull/5513";
/** The parser's sources, files and folders, which may reach the bundle only inside the worker's script. */
const PARSING = ["src/lib/facts.ts", "src/lib/facts/", "src/lib/linker.ts", "src/lib/linker/", "src/lib/syntax.ts", "src/vendor/web-tree-sitter.ts"];

const manifestText = readFileSync(join(ROOT, "manifest.json"), "utf8");
const manifest = JSON.parse(manifestText) as { driverId: string; main: string; icon: string };

const failures: string[] = [];
const pass = (message: string) => console.log(`  ✓ ${message}`);
const fail = (message: string) => {
    failures.push(message);
    console.log(`  ✗ ${message}`);
};
const expectThat = (ok: boolean, message: string) => (ok ? pass(message) : fail(message));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The extension as the marketplace bundles it, with every bare import it asked for. */
const bundle = async () => {
    const bareImports = new Set<string>();
    const recordBareImports: Plugin = {
        name: "record-bare-imports",
        setup: (b) =>
            b.onResolve({ filter: /^[^./]/ }, (args) => {
                bareImports.add(args.path);
                return undefined;
            }),
    };
    const result = await build({
        entryPoints: [join(ROOT, "src/index.ts")],
        bundle: true,
        format: "cjs",
        platform: "browser",
        target: "es2020",
        minify: false,
        write: false,
        metafile: true,
        logLevel: "silent",
        plugins: [recordBareImports],
    });
    return { code: result.outputFiles[0].text, bareImports, inputs: Object.keys(result.metafile!.inputs) };
};

const checkBundle = async ({ code, bareImports, inputs }: Awaited<ReturnType<typeof bundle>>) => {
    const banned = [...bareImports].filter((name) => !ALLOWED_IMPORTS.has(name));
    expectThat(banned.length === 0, banned.length === 0 ? "imports only @drawdy/driver-protocol" : `imports outside the whitelist: ${banned.join(", ")}`);
    const bytes = Buffer.byteLength(code);
    expectThat(bytes < MAX_BUNDLE_BYTES, `bundle is ${(bytes / 1024).toFixed(1)} KB (limit 1 MB)`);
    expectThat(readFileSync(SCRIPT_FILE, "utf8") === (await workerScriptFile()), "the parser worker's script is current with its sources (npm run worker)");
    const parsing = PARSING.filter((source) => inputs.some((input) => (source.endsWith("/") ? input.includes(source) : input.endsWith(source))));
    expectThat(parsing.length === 0, parsing.length === 0 ? "the parser and the linker reach the bundle only inside the worker's script" : `the driver imports the parser itself: ${parsing.join(", ")}`);
};

const built = await bundle();
console.log("Marketplace build (esbuild, cjs, es2020, unminified)");
await checkBundle(built);

// The smoke test's world: GitHub and jsDelivr served from a saved PR, and a Drawdy host with a webview and storage.
const net = fakeFetch("hono-5513.json");
Object.assign(globalThis, { fetch: net.fetch });
const jsdelivr = (from = 0) => net.requests.slice(from).filter((url) => url.startsWith("https://cdn.jsdelivr.net/")).length;
const kv = new Map<string, unknown>();
let webview: { id: string; html: string } | null = null;
let deliver: DriverModule["onEvent"] = async () => undefined;
const screen = { width: 1600, height: 1000 };
const host = fakeHost(screen, {
    "command:webview:create": (req) => {
        webview = { id: String(req.webviewDomId), html: String(req.htmlContent) };
        setTimeout(() => deliver({ type: "subscription:webview:message", subscriptionId: "check", body: { webviewDomId: webview!.id, message: { type: "ready" } } }));
        return { created: true };
    },
    "command:webview:post-message": () => ({ posted: true }),
    ...keptStorage(kv),
    "command:dom:create-action-button": () => ({ created: true }),
});

/** Starts the bundle as Drawdy's host worker does; with `panel`, the reader opens the panel. */
const boot = async (panel = true) => {
    const module = { exports: {} as Partial<DriverModule> };
    new Function("exports", "module", built.code)(module.exports, module);
    const { activate, onEvent } = module.exports as DriverModule;
    deliver = onEvent;
    await activate({
        issueCommand: host.issueCommand,
        manifest: { ...manifest, driverName: "check", driverVersion: "0.0.0", permissions: [] },
        styling: { theme: "dark", foreground: "#fff", primary: "#c5f601", border: "#333", surface: "#222", surface2: "#2a2a2a" } as ModuleStyling,
        generateId: () => crypto.randomUUID(),
    });
    if (panel) await onEvent({ type: "subscription:dom:element-clicked", subscriptionId: "check", body: { domElementId: "pr-blackboard:open", clientX: 0, clientY: 0 } });
};

const click = async (ids: string[], at: { x: number; y: number }, ms = 60) => {
    await deliver({ type: "subscription:scene:click", subscriptionId: "check", body: { drawdyElementIds: ids, cursor: { canvasSpace: at, domSpace: at } } } as never);
    await wait(ms);
};
/** A message from the panel, then a moment for the driver to act on it. */
const tell = async (message: unknown, ms = 60) => {
    await deliver({ type: "subscription:webview:message", subscriptionId: "check", body: { webviewDomId: "pr-blackboard:panel", message } });
    await wait(ms);
};
const callsOf = (type: string, from = 0) => host.calls.slice(from).filter((c) => c.type === type);
/** The view the panel was sent last. */
const shown = () => callsOf("command:webview:post-message").map((c) => c.req.message).filter((m) => m.type === "view").pop()?.view;
const partOf = (e: any): string | undefined => e.meta?.prBlackboard?.part;
const element = (where: (e: any) => boolean) => [...host.elements].find(([, e]) => where(e.schema))!;
const cardOf = (pin: string) => element((s) => s.type === "component" && s.meta?.prBlackboard?.pin === pin);

/** Runs the webview's script on its own in jsdom, with a stand-in for Drawdy's webview API; the messages it posted. */
const runWebview = async (html: string): Promise<string[]> => {
    const script = /<script type="module">([\s\S]*)<\/script>/.exec(html)?.[1];
    if (!script) throw new Error("the webview HTML has no module script");
    const dom = new JSDOM(html.replace(/<script type="module">[\s\S]*<\/script>/, ""), { runScripts: "outside-only" });
    const posted: string[] = [];
    Object.assign(dom.window, {
        acquireDrawdyApi: () => ({ postMessage: (message: { type: string }) => posted.push(message.type), onMessage: () => () => undefined }),
    });
    dom.window.eval(script);
    await wait(50);
    return posted;
};

/**
 * The webview's page in jsdom, as the reader sees it: `show` hands it a view the driver sent, and what the reader then
 * presses comes back in `posted`, the panel's own `ready` left out.
 */
const panelPage = async (html: string) => {
    const script = /<script type="module">([\s\S]*)<\/script>/.exec(html)?.[1];
    if (!script) throw new Error("the webview HTML has no module script");
    const dom = new JSDOM(html.replace(/<script type="module">[\s\S]*<\/script>/, ""), { runScripts: "outside-only" });
    const posted: { type: string }[] = [];
    let listener: (message: unknown) => void = () => undefined;
    Object.assign(dom.window, {
        acquireDrawdyApi: () => ({
            postMessage: (message: { type: string }) => message.type !== "ready" && posted.push(message),
            onMessage: (f: (message: unknown) => void) => ((listener = f), () => undefined),
        }),
    });
    dom.window.eval(script);
    await wait(20);
    const byId = (id: string) => dom.window.document.getElementById(id) as HTMLElement;
    return { posted, byId, active: () => dom.window.document.activeElement?.id, show: (view: unknown) => listener({ type: "view", view }) };
};

const bootsWithItsPanelAndIcon = async () => {
    await boot();
    await wait(20);
    if (!webview) throw new Error("opening the panel did not create a webview");
    const html = (webview as { html: string }).html;
    pass(`driver boots in a fake host and opens a ${(html.length / 1024).toFixed(1)} KB webview`);
    expectThat((await runWebview(html)).includes("ready"), "webview script runs on its own and reports ready");
    expectThat(!host.calls.some((c) => c.type.includes("context-menu")), "registers no context menu");
    const listing = readFileSync(join(ROOT, manifest.icon));
    const button = String(callsOf("command:dom:create-action-button")[0]?.req.svg ?? "");
    const side = listing.readUInt32BE(16);
    expectThat(
        listing.toString("latin1", 1, 4) === "PNG" && side >= 256 && listing.readUInt32BE(20) === side && listing.length <= MAX_ICON_BYTES && /^<svg[^>]* width="20" height="20"[^>]*><image href="data:image\/png;base64,/.test(button),
        `the listing icon is a ${side} px PNG of ${(listing.length / 1024).toFixed(1)} KB (limit 256 KB), and the 20 px button draws its 64 px copy (${(button.length / 1024).toFixed(1)} KB)`
    );
};

/** Opens hono#5513: what is pinned, in one add call, and how its strings run. Gives what the later checks compare with. */
const pinsHono = async () => {
    const opening = host.calls.length;
    await tell({ type: "open", url: HONO }, 3000);
    expectThat(jsdelivr() === 2 && kv.has("wasm:runtime") && kv.has("wasm:typescript"), `the first open downloads the runtime and the TypeScript grammar once, and keeps them (${jsdelivr()} jsDelivr requests)`);
    const adds = callsOf("command:scene:add-drawdy-elements", opening);
    const added = adds.flatMap((c) => c.req.elements);
    const components = added.filter((e) => e.type === "component");
    const strings = added.filter((e) => partOf(e) === "link");
    const labels = added.filter((e) => partOf(e) === "label");
    const linkOf = (e: any) => String(e.meta.prBlackboard.link);
    expectThat(adds.length === 1, `the board arrives in one add call: one undo step (got ${adds.length})`);
    expectThat(
        components.length === 10 && added.filter((e) => partOf(e) === "pr").length === 1 && strings.length === 9 && labels.length === 8 && added.length === 27,
        `10 cards, 9 strings and 8 labels, one per drawn link where its word clears, nothing else (got ${components.length}, ${strings.length}, ${labels.length} of ${added.length})`
    );
    const component = (pin: string) => components.find((e) => e.meta.prBlackboard.pin === pin)!;
    const prEl = component("pr");
    const fetchEl = component("ctx:src/hono-base.ts:484");
    expectThat(
        prEl.height === 779 && !("folds" in prEl.meta.prBlackboard) && !String(prEl.schema.children[0].child.srcDoc).includes("Read all") && fetchEl.x === prEl.x + 800 && fetchEl.y === prEl.y,
        `the PR card shows its whole description, 640 × ${prEl.height}, no fold row, in a column of its own; the code starts 160 right of it, fetch() at the band's top`
    );
    const kinds = strings.map((e) => linkOf(e).split(":")[0]).sort().join(",");
    expectThat(kinds === "calls,calls,calls,calls,context,imports,tests,tests,tests", `the strings: ${kinds}`);
    const imported = strings.find((e) => linkOf(e).startsWith("imports:"));
    expectThat(
        imported?.startBinding?.anchorY === 0 && imported?.endBinding?.anchorY === 1 && imported?.endBinding?.anchorX === 0.5,
        "the imports card hangs under toError(), its string up to the middle of its bottom"
    );
    expectThat(
        strings.every((e) => e.type === "arrow" && e.startBinding && e.endBinding && e.bend?.length === 3 && !e.elbowRouting && !("roughness" in e) && !e.from && !e.to),
        "every string on hono is bound to both cards and curves through three bends, no elbows, no roughness"
    );
    /** Whether the strings agree on `value` within each group `key` makes. */
    const agree = (key: (e: any) => string, value: (e: any) => string) => Object.values(groupBy(strings, key)).every((group) => new Set(group.map(value)).size === 1);
    const edgeOf = ({ anchorX, anchorY }: { anchorX: number; anchorY: number }) => (anchorX === 0 ? "left" : anchorY === 1 ? "bottom" : anchorY === 0 ? "top" : "right");
    expectThat(
        agree((e) => `${e.endBinding.drawdyElementId}:${edgeOf(e.endBinding)}`, (e) => `${e.endBinding.anchorX},${e.endBinding.anchorY}`),
        "strings into one edge of a card share their end point"
    );
    expectThat(labels.every((e) => e.type === "text" && /^(calls|uses|tests|imports)$/.test(e.text)), `every label is one word (${[...new Set(labels.map((e) => e.text))].join(", ")})`);
    const colourOf = new Map(strings.map((e) => [linkOf(e), e.color as string]));
    expectThat(
        strings.every((e) => STRING_COLOURS.includes(e.color)) && agree((e) => e.startBinding.drawdyElementId, (e) => e.color) && labels.every((e) => e.color === colourOf.get(linkOf(e))),
        `strings take the palette's colours, one per card they leave, each label its string's (${new Set(colourOf.values()).size} colours)`
    );
    const openTypes = host.calls.slice(opening).map((c) => c.type);
    const addAt = openTypes.indexOf("command:scene:add-drawdy-elements");
    expectThat(
        !openTypes.slice(0, addAt).includes("command:camera:fly-to-rect") && openTypes.slice(addAt).filter((t) => t === "command:camera:fly-to-rect").length === 1,
        "no camera move before the add; one flight to the overview after it"
    );
    const tested = strings.filter((e) => linkOf(e).startsWith("tests:test:src/hono.test.ts>")).map((e) => linkOf(e).split(">")[1]).sort();
    expectThat(
        tested.join() === "ctx:src/hono-base.ts:484,src/hono-base.ts:276",
        `hono.test.ts's strings go to onError() and fetch(), which it calls, not to #dispatch() by its file's name (${tested.join(", ")})`
    );
    const dashed = strings.filter((e) => e.strokeDash === "dashed").map((e) => linkOf(e).split(":")[0]).sort();
    expectThat(dashed.join() === "context,tests", `the strings into and out of the unchanged fetch() are dashed (${dashed.join(", ")})`);
    expectThat(!added.some((e) => "groupId" in e), "nothing is grouped, so a click selects one card");
    expectThat(
        components.every((e) => String(e.schema.children[0].child.srcDoc).includes("color-scheme: dark;")) && added.find((e) => partOf(e) === "pr")?.meta.prBlackboard.theme === "dark",
        "the cards take the theme Drawdy shows (dark), and the PR card's mark records it"
    );
    return { added, colourOf };
};

/** A new board lands with the PR card current, its description in the panel; the steps walk the code: #dispatch() first, never fetch(). */
const landsAndSteps = async () => {
    expectThat(shown()?.hasNext === true && shown()?.tag?.label === "honojs/hono#5513" && shown()?.tag?.colour === "#E36002", `while the PR card is current, › is on, and the tag takes Hono's colour (${JSON.stringify(shown()?.tag)})`);
    expectThat(
        shown()?.card?.pin === "pr" && shown()?.current === -1 && shown()?.total === 8 && shown()?.hasPrevious === false && String(shown()?.card?.description).includes("<h3>Behavior change</h3>"),
        `a new board lands with the PR card current and its whole description in the panel: – / ${shown()?.total}, ‹ off`
    );
    const stepped = [shown()?.card?.pin];
    const readable = new Set<string>();
    let writes = 0;
    let popovers = 0;
    let flights = 0;
    let deselects = 0;
    for (let i = 0; i < 8; i++) {
        const from = host.calls.length;
        await tell({ type: "next" });
        stepped.push(shown()?.card?.pin);
        if (shown()?.card?.canReadAll) readable.add(shown()!.card!.name);
        writes += host.calls.slice(from).filter((c) => /^command:scene:(add|update|create)-/.test(c.type)).length;
        popovers += callsOf("command:dom:upsert-floating-element", from).length;
        flights += callsOf("command:camera:fly-to-rect", from).length;
        deselects += callsOf("command:scene:clear-selection", from).length;
    }
    expectThat(stepped[1] === "src/hono-base.ts:411", `› goes from the PR card to #dispatch(), step 1 (${stepped.slice(0, 2).join(" → ")})`);
    const steps = stepped.slice(1);
    expectThat(new Set(steps).size === 8 && shown()?.total === 8 && !steps.includes("ctx:src/hono-base.ts:484") && !steps.includes("pr"), `eight steps, the code only: never the PR card or the unchanged fetch() (${new Set(steps).size})`);
    expectThat(shown()?.hasNext === false && shown()?.hasPrevious === true, "› is disabled on the last step");
    expectThat(popovers === 0 && flights > 0, `› moves the camera where needed and opens no popover (${flights} flights)`);
    expectThat(deselects === 8, `each › clears Drawdy's selection, so no card stays selected away from the camera (${deselects} of 8)`);
    expectThat(writes === 0, `› changes nothing on the board: no mark, every string keeps its colour (${writes} scene writes)`);
    expectThat(
        ["toError()", "compose.test.ts", "hono.test.ts"].every((name) => readable.has(name)),
        `cards hiding code offer Read all: toError()'s cut line and both test cards (${[...readable].join(", ")})`
    );
};

const namesLinksInTheirColours = async (colourOf: Map<string, string>) => {
    for (let i = 0; i < 5; i++) await tell({ type: "previous" }, 20);
    const composeCard = shown()?.card;
    const chips: { link: string; name: string; colour: number | null }[] = (composeCard?.links ?? []).flatMap((row: { chips: { link: string; name: string; colour: number | null }[] }) => row.chips);
    expectThat(
        composeCard?.name === "compose()" && chips.length === 4 && chips.every((c) => (c.colour === null ? !colourOf.has(c.link) : STRING_COLOURS[c.colour] === colourOf.get(c.link))),
        `compose()'s link names take their strings' colours, and hono-base.ts, with no string, none (${chips.map((c) => `${c.name} ${c.colour}`).join(", ")})`
    );
};

/** Description: the PR card current, the camera on it, the steps unchanged. */
const describes = async () => {
    const describing = host.calls.length;
    await tell({ type: "description" }, 80);
    expectThat(
        shown()?.card?.pin === "pr" && shown()?.current === -1 && callsOf("command:camera:fly-to-rect", describing).length === 1 && host.camera.zoom >= 0.8 && host.camera.zoom <= 1,
        `Description makes the PR card current and flies to it at zoom ${host.camera.zoom.toFixed(2)}`
    );
    await tell({ type: "next" }, 40);
    expectThat(shown()?.card?.pin === "src/hono-base.ts:411" && shown()?.current === 0, "› from the PR card goes to step 1 again, #dispatch()");
};

/** Where a floating element's pane shows on screen: CSS scales it about its middle, which its translation makes up for. */
const paneOn = (req: any) => {
    const pane = req.schema.children[0];
    const [, tx, ty, scale] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(pane.styles.transform)!.map(Number);
    const [w, h] = [pane.styles.width[0], pane.styles.height[0]];
    return { pane, x: req.position.x + tx + (w / 2) * (1 - scale), y: req.position.y + ty + (h / 2) * (1 - scale), width: w, height: h, scale };
};

/** Read all opens on the board, 24 right of compose(), 720 wide in canvas units, readable; it follows the camera, and ✕ and Esc close it. */
const opensReadAll = async (size: { width: number; height: number }) => {
    Object.assign(screen, size);
    await tell({ type: "overview" }, 80);
    for (let i = 0; i < 8; i++) await tell({ type: "previous" }, 20);
    for (let i = 0; i < 2; i++) await tell({ type: "next" }, 40);
    const from = host.calls.length;
    await tell({ type: "read-all" }, 800);
    const open = callsOf("command:dom:upsert-floating-element", from).pop();
    const card = cardOf("src/compose.ts:18")[1].rect;
    const { zoom } = host.camera;
    const right = host.camera.x + (card.x + card.width) * zoom;
    const on = open ? paneOn(open.req) : null;
    expectThat(
        shown()?.card?.pin === "src/compose.ts:18" && !!on && Math.abs(on.x - (right + 24 * zoom)) < 1 && on.width === 720 && Math.abs(on.scale - zoom) < 1e-3 && zoom >= 0.8 && zoom <= 1,
        `at ${size.width}×${size.height}, Read all opens 24 right of compose() on the board, 720 wide, scaled by the zoom, ${zoom.toFixed(2)}`
    );
    const [bar, iframe] = on?.pane.children ?? [];
    const buttons = (bar?.children ?? []).map((b: { domId: string }) => b.domId).join(" ");
    expectThat(
        on?.pane.children.length === 2 && buttons === "pr-blackboard:read-all:handle pr-blackboard:read-all:close" && iframe?.type === "iframe" && iframe.child.srcDoc.includes('<header><span class="name">compose()</span>'),
        "it opens with the card's own header, a drag handle and ✕ over it, and there is no footer"
    );
    const panning = host.calls.length;
    await deliver({ type: "subscription:camera:moved-rapid", subscriptionId: "check", body: { x: host.camera.x - 300, y: host.camera.y, zoom: zoom / 2 } } as never);
    await wait(40);
    const moved = callsOf("command:dom:update-floating-element", panning).pop();
    const after = moved ? paneOn(moved.req) : null;
    expectThat(
        !!after && Math.abs(after.x - (host.camera.x - 300 + (card.x + card.width + 24) * (zoom / 2))) < 1 && Math.abs(after.scale - zoom / 2) < 1e-3,
        "zoomed out by half and panned, it stays beside its card at half the size"
    );
    const closing = host.calls.length;
    await deliver({ type: "subscription:dom:element-clicked", subscriptionId: "check", body: { domElementId: "pr-blackboard:read-all:close", clientX: 0, clientY: 0 } });
    await wait(40);
    expectThat(callsOf("command:dom:remove-floating-element", closing).length === 1, "✕ closes it");
    await tell({ type: "read-all" }, 300);
    const escaping = host.calls.length;
    await tell({ type: "close" }, 40);
    expectThat(callsOf("command:dom:remove-floating-element", escaping).length === 1, "Esc in the panel closes it too");
    await tell({ type: "next" }, 40);
    const short = host.calls.length;
    await tell({ type: "read-all" }, 800);
    const tall = callsOf("command:dom:upsert-floating-element", short).pop()?.req.schema.children[0].styles.height[0];
    expectThat(shown()?.card?.name === "toError()" && tall < 200, `Read all on toError(), a short function, is as tall as its page: ${tall} canvas units, not 640`);
    await tell({ type: "close" }, 40);
};

/** Home goes back to the start view and keeps the board; a click on one of its cards reads it again. */
const goesHome = async () => {
    const cardCount = () => [...host.elements.values()].filter((e) => e.schema.type === "component").length;
    const before = cardCount();
    await tell({ type: "start" }, 40);
    const startShown = shown()?.phase === "start" && cardCount() === before;
    const [toErrorId, toErrorEl] = cardOf("src/compose.ts:4");
    await click([toErrorId], { x: toErrorEl.rect.x + 40, y: toErrorEl.rect.y + 20 }, 80);
    expectThat(startShown && shown()?.phase === "ready" && shown()?.card?.name === "toError()", "Home shows the start view and keeps the board; a click on toError() brings the reading view back");
};

/** Rebuild: GitHub read again past the stored copy, the new board where the old PR card stands, then the old board's elements off. */
const rebuilds = async () => {
    const ours = () => [...host.elements].filter(([, e]) => e.schema.meta?.prBlackboard).map(([id]) => id);
    const prCard = () => element((s) => s.meta?.prBlackboard?.part === "pr")[1];
    const oldIds = ours();
    // The reader moved the PR card, and wrote a note of their own above it.
    Object.assign(prCard().rect, { x: prCard().rect.x + 300, y: prCard().rect.y + 40 });
    const corner = { x: prCard().rect.x, y: prCard().rect.y };
    host.add({ type: "text", drawdyElementId: "readers-note", x: corner.x, y: corner.y - 120, text: "mine" });
    const api = () => net.requests.filter((url) => url.startsWith("https://api.github.com/")).length;
    const [apiBefore, requestsBefore, rebuilding] = [api(), net.requests.length, host.calls.length];
    await tell({ type: "rebuild" }, 3000);
    const swap = host.calls.slice(rebuilding).filter((c) => /^command:scene:(add|remove|update)-/.test(c.type));
    const removed = new Set<string>(swap[1]?.req.drawdyElementIds ?? []);
    expectThat(
        swap.map((c) => c.type).join() === "command:scene:add-drawdy-elements,command:scene:remove-drawdy-elements" && removed.size === oldIds.length && oldIds.every((id) => removed.has(id)),
        `Rebuild adds the new board, then removes the old one's ${oldIds.length} elements: two undo steps in DDP 1.3`
    );
    const github = api() - apiBefore;
    expectThat(github === 2 && jsdelivr(requestsBefore) === 0, `Rebuild reads GitHub again past the stored copy (${github} requests) and downloads no parser`);
    expectThat(
        prCard().rect.x === corner.x && prCard().rect.y === corner.y && host.elements.has("readers-note") && ours().length === oldIds.length && shown()?.card?.pin === "pr",
        "the new PR card stands where the old one stood, the reader's own note stays, and the PR card is current"
    );
};

/** Clear: the board's elements off in one removal, the reader's note kept, then the start view; opening the PR again reads only the PR from GitHub. */
const clears = async () => {
    const ours = () => [...host.elements].filter(([, e]) => e.schema.meta?.prBlackboard).map(([id]) => id);
    const before = ours();
    // Clear pressed in the bundled panel: it asks, focus on ✗, and only ✓ sends `clear` on to the driver.
    const page = await panelPage((webview as unknown as { html: string }).html);
    page.show(shown());
    page.byId("clear").click();
    page.byId("clear").click();
    const asked = !page.byId("tools-ask").hidden && page.active() === "ask-no" && page.posted.length === 0;
    page.byId("ask-yes").click();
    expectThat(
        asked && page.posted.length === 1 && page.posted[0].type === "clear",
        `the bundled panel asks before Clear, focus on ✗, a double click sends nothing, and ✓ sends ${JSON.stringify(page.posted)}`
    );
    const clearing = host.calls.length;
    await tell(page.posted[0], 100);
    const scene = host.calls.slice(clearing).filter((c) => /^command:scene:(add|remove|update)-/.test(c.type));
    const removed = new Set<string>(scene[0]?.req.drawdyElementIds ?? []);
    expectThat(
        scene.map((c) => c.type).join() === "command:scene:remove-drawdy-elements" && removed.size === before.length && before.every((id) => removed.has(id)) && ours().length === 0 && host.elements.has("readers-note") && shown()?.phase === "start",
        `Clear removes the board's ${before.length} elements in one removal, one undo step; the reader's note stays and the start view shows`
    );
    const api = () => net.requests.filter((url) => url.startsWith("https://api.github.com/")).length;
    const [apiBefore, reopening] = [api(), host.calls.length];
    await tell({ type: "open", url: HONO }, 1500);
    expectThat(
        api() - apiBefore === 1 && callsOf("command:scene:add-drawdy-elements", reopening).length === 1 && shown()?.phase === "ready",
        `opening it again reads only the PR from GitHub (${api() - apiBefore} request) and pins it anew from the stored review`
    );
};

/** A reload: the bundle starts again on the same board, the panel never opened, and the reader has looked elsewhere since. */
const worksAfterAReload = async () => {
    const beforeReload = net.requests.length;
    await boot(false);
    await wait(20);
    Object.assign(host.camera, { x: 50_000, y: 50_000, zoom: 1 });
    const reloaded = host.calls.length;
    const [label] = element((s) => s.meta?.prBlackboard?.part === "label" && String(s.meta.prBlackboard.link).startsWith("calls:src/compose.ts:18"));
    await click([label], { x: 0, y: 0 }, 80);
    expectThat(callsOf("command:camera:fly-to-rect", reloaded).length === 1 && callsOf("command:kv-storage:get", reloaded).length === 0, "after a reload, with the panel never opened, a label follows its string: the camera flies, no review is read");
    const [composeId, compose] = cardOf("src/compose.ts:18");
    const fold = (compose.schema.meta.prBlackboard.folds as [number, number][])[0];
    const folding = host.calls.length;
    await click([composeId], { x: compose.rect.x + 100, y: compose.rect.y + fold[0] + 10 }, 1200);
    const page = callsOf("command:dom:upsert-floating-element", folding).pop()?.req.schema.children[0].children[1].child.srcDoc ?? "";
    expectThat(page.includes(`class="r focus ctx" data-at="${fold[1]}"`) && callsOf("command:kv-storage:get", folding).length > 0, "a fold row opens Read all at its lines from the card's mark, loading the review only then");
    expectThat(callsOf("command:scene:clear-selection", folding).length === 1, "the fold-row click clears Drawdy's selection");
    expectThat(jsdelivr(beforeReload) === 0, `after the reload nothing comes from jsDelivr (${jsdelivr(beforeReload)} requests)`);
};

/** A full board's single add call stays well under what Drawdy takes in one message. */
const keepsTheAddPayloadSmall = async (honoAdded: unknown[]) => {
    const big = await reviewOf(crowded());
    let n = 0;
    const payload = Buffer.byteLength(JSON.stringify({ elements: reviewElements(big, planBoard(big), () => `id${n++}`, "dark").elements }));
    expectThat(
        big.pins.length === LIMITS.cards && payload < MAX_PAYLOAD_BYTES,
        `a ${big.pins.length}-card board's add payload is ${(payload / 1024).toFixed(1)} KB (limit ${MAX_PAYLOAD_BYTES / 1024} KB); hono's is ${(Buffer.byteLength(JSON.stringify({ elements: honoAdded })) / 1024).toFixed(1)} KB`
    );
};

/** Packs what the marketplace would publish. */
const pack = () => {
    const outDir = join(ROOT, "dist/marketplace");
    const outFile = join(outDir, `${manifest.driverId.replaceAll(".", "-")}.drawdyx`);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(outFile, zipSync({ "manifest.json": strToU8(manifestText), [manifest.main]: strToU8(built.code) }));
    pass(`packed ${outFile.slice(ROOT.length + 1)}`);
};

try {
    await bootsWithItsPanelAndIcon();
    const hono = await pinsHono();
    await landsAndSteps();
    await namesLinksInTheirColours(hono.colourOf);
    await describes();
    for (const size of [
        { width: 1280, height: 800 },
        { width: 1920, height: 1080 },
    ])
        await opensReadAll(size);
    await goesHome();
    await rebuilds();
    await clears();
    await worksAfterAReload();
    await keepsTheAddPayloadSmall(hono.added);
} catch (err) {
    fail(`smoke test: ${err instanceof Error ? err.message : String(err)}`);
}
pack();

if (failures.length > 0) {
    console.log(`\n${failures.length} check(s) failed.`);
    process.exit(1);
}
console.log("\nReady to submit: git push && drawdy submit");
process.exit(0);
