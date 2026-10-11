/**
 * Reproduces Drawdy's marketplace build lane locally, so a submission can't
 * fail on something a dev build hides:
 *
 * 1. bundles src/index.ts with esbuild as one browser CommonJS file (ES2020),
 *    unminified, as the marketplace builds it;
 * 2. fails on any bare import other than `@drawdy/driver-protocol`;
 * 3. fails if the bundle reaches 1 MB, or if the parser worker's script
 *    (src/worker/script.ts) is behind its sources;
 * 4. boots the bundle in a fake Drawdy host, opens the panel, runs the
 *    generated webview in jsdom until it reports `ready`, then opens a saved
 *    pull request (honojs/hono#5513), its files and the parser's served by a
 *    fake fetch, and checks the investigation board: what is pinned in its
 *    one add call, the camera, the curved strings and their colours,
 *    stepping, Read all and a rebuild. Node has no Worker, so the parser
 *    worker's script runs on the driver's thread, as where no worker can
 *    start. Then it boots the bundle again, as after a reload, and checks
 *    the board works with the panel never opened and nothing comes from
 *    jsDelivr; then checks a 32-card board's add payload stays small;
 * 5. packs dist/marketplace/<driver-id>.drawdyx (see `npm run preview`).
 *
 * Usage: node scripts/check.ts
 */

import type { DriverCommandIssuer, DriverModule, ModuleStyling } from "@drawdy/driver-protocol";
import { build, type Plugin } from "esbuild";
import { strToU8, zipSync } from "fflate";
import { JSDOM } from "jsdom";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reviewElements } from "../src/driver/elements.ts";
import { STRING_COLOURS, planBoard } from "../src/lib/layout.ts";
import { LIMITS } from "../src/lib/model.ts";
import { fakeFetch } from "../src/test/fake-fetch.ts";
import { fakeHost } from "../src/test/fake-host.ts";
import { reviewOf } from "../src/test/fixture.ts";
import { crowded } from "../src/test/synthetic.ts";
import { SCRIPT_FILE, workerScriptFile } from "./worker.ts";

const ROOT = join(import.meta.dirname, "..");
const ALLOWED_IMPORTS = new Set(["@drawdy/driver-protocol"]);
const MAX_BUNDLE_BYTES = 1_000_000;
const MAX_PAYLOAD_BYTES = 512 * 1024;

type Manifest = { driverId: string; main: string };
const manifestText = readFileSync(join(ROOT, "manifest.json"), "utf8");
const manifest = JSON.parse(manifestText) as Manifest;

const failures: string[] = [];
const pass = (message: string) => console.log(`  ✓ ${message}`);
const fail = (message: string) => {
    failures.push(message);
    console.log(`  ✗ ${message}`);
};
const expectThat = (ok: boolean, message: string) => (ok ? pass(message) : fail(message));

// 1-3. Build like the marketplace, recording bare imports on the way.
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
const code = result.outputFiles[0].text;
console.log("Marketplace build (esbuild, cjs, es2020, unminified)");

const banned = [...bareImports].filter((name) => !ALLOWED_IMPORTS.has(name));
expectThat(banned.length === 0, banned.length === 0 ? "imports only @drawdy/driver-protocol" : `imports outside the whitelist: ${banned.join(", ")}`);
const bytes = Buffer.byteLength(code);
expectThat(bytes < MAX_BUNDLE_BYTES, `bundle is ${(bytes / 1024).toFixed(1)} KB (limit 1 MB)`);
expectThat(readFileSync(SCRIPT_FILE, "utf8") === (await workerScriptFile()), "the parser worker's script is current with its sources (npm run worker)");
const inputs = Object.keys(result.metafile!.inputs);
const parsing = ["src/lib/facts.ts", "src/lib/linker.ts", "src/lib/syntax.ts", "src/vendor/web-tree-sitter.ts"].filter((file) => inputs.some((input) => input.endsWith(file)));
expectThat(parsing.length === 0, parsing.length === 0 ? "the parser and the linker reach the bundle only inside the worker's script" : `the driver imports the parser itself: ${parsing.join(", ")}`);

// 4. Boot it the way Drawdy's host worker does.
const net = fakeFetch("hono-5513.json");
Object.assign(globalThis, { fetch: net.fetch });
const jsdelivr = (from = 0) => net.requests.slice(from).filter((url) => url.startsWith("https://cdn.jsdelivr.net/")).length;
// Drawdy's kv-storage: IndexedDB, which keeps what it is given, Blobs included.
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
    "command:kv-storage:get": (req) => (kv.has(req.key) ? { got: kv.get(req.key) } : {}),
    "command:kv-storage:set": (req) => void kv.set(req.key, req.payload),
    "command:dom:create-action-button": () => ({ created: true }),
});
const issueCommand = (async (request: { type: string; req?: unknown }) => {
    try {
        return { ...request, res: { value: await host.ddp.call(request.type as never, request.req as never) } };
    } catch (err) {
        const type = (err as { cause?: { type?: string } })?.cause?.type ?? "runtime";
        return { ...request, res: { error: { type, message: err instanceof Error ? err.message : String(err) } } };
    }
}) as unknown as DriverCommandIssuer;

const boot = async (panel = true) => {
    const module = { exports: {} as Partial<DriverModule> };
    new Function("exports", "module", code)(module.exports, module);
    const { activate, onEvent } = module.exports as DriverModule;
    deliver = onEvent;
    await activate({
        issueCommand,
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

const runWebview = async (html: string): Promise<string[]> => {
    const script = /<script type="module">([\s\S]*)<\/script>/.exec(html)?.[1];
    if (!script) throw new Error("the webview HTML has no module script");
    const dom = new JSDOM(html.replace(/<script type="module">[\s\S]*<\/script>/, ""), { runScripts: "outside-only" });
    const posted: string[] = [];
    Object.assign(dom.window, {
        acquireDrawdyApi: () => ({ postMessage: (message: { type: string }) => posted.push(message.type), onMessage: () => () => undefined }),
    });
    dom.window.eval(script);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return posted;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const tell = async (message: unknown, ms = 60) => {
    await deliver({ type: "subscription:webview:message", subscriptionId: "check", body: { webviewDomId: "pr-blackboard:panel", message } });
    await wait(ms);
};
const partOf = (e: any): string | undefined => e.meta?.prBlackboard?.part;
const callsOf = (type: string, from = 0) => host.calls.slice(from).filter((c) => c.type === type);

try {
    await boot();
    await wait(20);
    if (!webview) throw new Error("opening the panel did not create a webview");
    const html = (webview as { html: string }).html;
    pass(`driver boots in a fake host and opens a ${(html.length / 1024).toFixed(1)} KB webview`);
    const posted = await runWebview(html);
    expectThat(posted.includes("ready"), "webview script runs on its own and reports ready");

    expectThat(!host.calls.some((c) => c.type.includes("context-menu")), "registers no context menu");
    const listing = readFileSync(join(ROOT, (JSON.parse(manifestText) as { icon: string }).icon));
    const button = String(callsOf("command:dom:create-action-button")[0]?.req.svg ?? "");
    expectThat(
        listing.toString("latin1", 1, 4) === "PNG" && listing.readUInt32BE(16) === 512 && listing.readUInt32BE(20) === 512 && /^<svg[^>]* width="20" height="20"[^>]*><image href="data:image\/png;base64,/.test(button),
        `the listing icon is a 512 px PNG, and the 20 px button draws its 64 px copy (${(button.length / 1024).toFixed(1)} KB)`
    );
    const opening = host.calls.length;
    await tell({ type: "open", url: "https://github.com/honojs/hono/pull/5513" }, 3000);
    expectThat(jsdelivr() === 2 && kv.has("wasm:runtime") && kv.has("wasm:typescript"), `the first open downloads the runtime and the TypeScript grammar once, and keeps them (${jsdelivr()} jsDelivr requests)`);
    const adds = callsOf("command:scene:add-drawdy-elements", opening);
    const added = adds.flatMap((c) => c.req.elements);
    const count = (part: string) => added.filter((e) => partOf(e) === part).length;
    const components = added.filter((e) => e.type === "component");
    const strings = added.filter((e) => partOf(e) === "link");
    const labels = added.filter((e) => partOf(e) === "label");
    expectThat(adds.length === 1, `the board arrives in one add call: one undo step (got ${adds.length})`);
    expectThat(
        components.length === 10 && count("pr") === 1 && strings.length === 9 && labels.length === 9 && added.length === 28,
        `10 cards, 9 strings and 9 labels, one of each per drawn link, nothing else (got ${components.length}, ${strings.length}, ${labels.length} of ${added.length})`
    );
    const kinds = strings.map((e) => String(e.meta.prBlackboard.link).split(":")[0]).sort().join(",");
    expectThat(kinds === "calls,calls,calls,calls,context,imports,tests,tests,tests", `the strings: ${kinds}`);
    const imported = strings.find((e) => String(e.meta.prBlackboard.link).startsWith("imports:"));
    expectThat(
        imported?.startBinding?.anchorY === 0 && imported?.endBinding?.anchorY === 1 && imported?.endBinding?.anchorX === 0.5,
        "the imports card hangs under toError(), its string up to the middle of its bottom"
    );
    expectThat(
        strings.every((e) => e.type === "arrow" && e.startBinding && e.endBinding && e.bend?.length === 3 && !e.elbowRouting && !("roughness" in e) && !e.from && !e.to),
        "every string on hono is bound to both cards and curves through three bends, no elbows, no roughness"
    );
    const tips = new Map<string, Set<string>>();
    for (const e of strings) {
        const key = `${e.endBinding.drawdyElementId}:${e.endBinding.anchorX === 0 ? "left" : e.endBinding.anchorY === 1 ? "bottom" : e.endBinding.anchorY === 0 ? "top" : "right"}`;
        tips.set(key, new Set([...(tips.get(key) ?? []), `${e.endBinding.anchorX},${e.endBinding.anchorY}`]));
    }
    expectThat([...tips.values()].every((points) => points.size === 1), "strings into one edge of a card share their end point");
    expectThat(labels.every((e) => e.type === "text" && /^(calls|uses|tests|imports)$/.test(e.text)), `every label is one word (${[...new Set(labels.map((e) => e.text))].join(", ")})`);
    const colourOf = new Map(strings.map((e) => [String(e.meta.prBlackboard.link), e.color as string]));
    const bySource = new Map<string, Set<string>>();
    for (const e of strings) bySource.set(e.startBinding.drawdyElementId, new Set([...(bySource.get(e.startBinding.drawdyElementId) ?? []), e.color]));
    expectThat(
        strings.every((e) => STRING_COLOURS.includes(e.color)) && [...bySource.values()].every((c) => c.size === 1) && labels.every((e) => e.color === colourOf.get(String(e.meta.prBlackboard.link))),
        `strings take the palette's colours, one per card they leave, each label its string's (${new Set(colourOf.values()).size} colours)`
    );
    const openTypes = host.calls.slice(opening).map((c) => c.type);
    const addAt = openTypes.indexOf("command:scene:add-drawdy-elements");
    expectThat(
        !openTypes.slice(0, addAt).includes("command:camera:fly-to-rect") && openTypes.slice(addAt).filter((t) => t === "command:camera:fly-to-rect").length === 1,
        "no camera move before the add; one flight to the overview after it"
    );
    const tested = strings.filter((e) => String(e.meta.prBlackboard.link).startsWith("tests:test:src/hono.test.ts>")).map((e) => String(e.meta.prBlackboard.link).split(">")[1]).sort();
    expectThat(
        tested.join() === "ctx:src/hono-base.ts:484,src/hono-base.ts:276",
        `hono.test.ts's strings go to onError() and fetch(), which it calls, not to #dispatch() by its file's name (${tested.join(", ")})`
    );
    const dashed = strings.filter((e) => e.strokeDash === "dashed").map((e) => String(e.meta.prBlackboard.link).split(":")[0]).sort();
    expectThat(dashed.join() === "context,tests", `the strings into and out of the unchanged fetch() are dashed (${dashed.join(", ")})`);
    expectThat(!added.some((e) => "groupId" in e), "nothing is grouped, so a click selects one card");
    expectThat(
        components.every((e) => String(e.schema.children[0].child.srcDoc).includes("color-scheme: dark;")) && added.find((e) => partOf(e) === "pr")?.meta.prBlackboard.theme === "dark",
        "the cards take the theme Drawdy shows (dark), and the PR card's mark records it"
    );

    // Stepping: the PR card first, then #dispatch(); never the unchanged fetch().
    const shown = () => callsOf("command:webview:post-message").map((c) => c.req.message).filter((m) => m.type === "view").pop()?.view;
    expectThat(shown()?.hasNext === true && shown()?.tag?.label === "honojs/hono#5513" && shown()?.tag?.colour === "#E36002", `while the PR card is current, › is on, and the tag takes Hono's colour (${JSON.stringify(shown()?.tag)})`);
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
    expectThat(stepped[0] === "pr" && stepped[1] === "src/hono-base.ts:411", `the PR card opens current, and › goes to #dispatch() (${stepped.slice(0, 2).join(" → ")})`);
    expectThat(new Set(stepped).size === 9 && shown()?.total === 9 && !stepped.includes("ctx:src/hono-base.ts:484"), `nine steps, never the unchanged fetch() (${new Set(stepped).size})`);
    expectThat(shown()?.hasNext === false && shown()?.hasPrevious === true, "› is disabled on the last step");
    expectThat(popovers === 0 && flights > 0, `› moves the camera where needed and opens no popover (${flights} flights)`);
    expectThat(deselects === 8, `each › clears Drawdy's selection, so no card stays selected away from the camera (${deselects} of 8)`);
    expectThat(writes === 0, `› changes nothing on the board: no mark, every string keeps its colour (${writes} scene writes)`);
    expectThat(
        ["toError()", "compose.test.ts", "hono.test.ts"].every((name) => readable.has(name)),
        `cards hiding code offer Read all: toError()'s cut line and both test cards (${[...readable].join(", ")})`
    );

    // Read all opens to the right of compose(), the fourth step, at both window sizes, and ✕ closes it.
    for (const size of [
        { width: 1280, height: 800 },
        { width: 1920, height: 1080 },
    ]) {
        Object.assign(screen, size);
        await tell({ type: "overview" }, 80);
        for (let i = 0; i < 8; i++) await tell({ type: "previous" }, 20);
        for (let i = 0; i < 3; i++) await tell({ type: "next" }, 40);
        const from = host.calls.length;
        await tell({ type: "read-all" }, 500);
        const open = callsOf("command:dom:upsert-floating-element", from).pop();
        const card = host.elements.get([...host.elements].find(([, e]) => e.schema.meta?.prBlackboard?.pin === "src/compose.ts:18")![0])!.rect;
        const right = host.camera.x + (card.x + card.width) * host.camera.zoom;
        const width = open?.req.schema.styles.width[0];
        const wanted = size.width === 1920 ? width === 720 : width >= 520 && width <= 720;
        const [bar, iframe] = open?.req.schema.children ?? [];
        const buttons = (bar?.children ?? []).map((b: { domId: string }) => b.domId).join(" ");
        expectThat(
            shown()?.card?.pin === "src/compose.ts:18" && !!open && open.req.position.x >= Math.round(right) + 24 && wanted,
            `at ${size.width}×${size.height}, Read all opens right of compose(), ${width} px wide`
        );
        expectThat(
            open?.req.schema.children.length === 2 && buttons === "pr-blackboard:read-all:close" && iframe?.type === "iframe" && iframe.child.srcDoc.includes('<header><span class="name">compose()</span>'),
            "it opens with the card's own header and ✕ over its right end, and there is no footer"
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
        await tell({ type: "read-all" }, 500);
        const tall = callsOf("command:dom:upsert-floating-element", short).pop()?.req.schema.children[1].styles.height[0];
        expectThat(shown()?.card?.name === "toError()" && tall < 200, `Read all on toError(), a short function, is as tall as its page: ${tall} px, not 640`);
        await tell({ type: "close" }, 40);
    }

    // Open another goes back to the start view and keeps the board; a click on one of its cards reads it again.
    const cardCount = () => [...host.elements.values()].filter((e) => e.schema.type === "component").length;
    const before = cardCount();
    await tell({ type: "start" }, 40);
    const startShown = shown()?.phase === "start" && cardCount() === before;
    const [toErrorId, toErrorEl] = [...host.elements].find(([, e]) => e.schema.type === "component" && e.schema.meta?.prBlackboard?.pin === "src/compose.ts:4")!;
    await click([toErrorId], { x: toErrorEl.rect.x + 40, y: toErrorEl.rect.y + 20 }, 80);
    expectThat(startShown && shown()?.phase === "ready" && shown()?.card?.name === "toError()", "Open another shows the start view and keeps the board; a click on toError() brings the reading view back");

    // Rebuild: GitHub read again past the stored copy, the new board where the old PR card stands, then the old board's elements off.
    const ours = () => [...host.elements].filter(([, e]) => e.schema.meta?.prBlackboard).map(([id]) => id);
    const prCard = () => [...host.elements].find(([, e]) => e.schema.meta?.prBlackboard?.part === "pr")![1];
    const oldIds = ours();
    // The reader moved the PR card, and wrote a note of their own above it.
    Object.assign(prCard().rect, { x: prCard().rect.x + 300, y: prCard().rect.y + 40 });
    const corner = { x: prCard().rect.x, y: prCard().rect.y };
    host.add({ type: "text", drawdyElementId: "readers-note", x: corner.x, y: corner.y - 120, text: "mine" });
    const githubBefore = net.requests.filter((url) => url.startsWith("https://api.github.com/")).length;
    const requestsBefore = net.requests.length;
    const rebuilding = host.calls.length;
    await tell({ type: "rebuild" }, 3000);
    const swap = host.calls.slice(rebuilding).filter((c) => /^command:scene:(add|remove|update)-/.test(c.type));
    const removed = new Set<string>(swap[1]?.req.drawdyElementIds ?? []);
    const github = net.requests.filter((url) => url.startsWith("https://api.github.com/")).length - githubBefore;
    expectThat(
        swap.map((c) => c.type).join() === "command:scene:add-drawdy-elements,command:scene:remove-drawdy-elements" && removed.size === oldIds.length && oldIds.every((id) => removed.has(id)),
        `Rebuild adds the new board, then removes the old one's ${oldIds.length} elements: two undo steps in DDP 1.3`
    );
    expectThat(github === 2 && jsdelivr(requestsBefore) === 0, `Rebuild reads GitHub again past the stored copy (${github} requests) and downloads no parser`);
    expectThat(
        prCard().rect.x === corner.x && prCard().rect.y === corner.y && host.elements.has("readers-note") && ours().length === oldIds.length && shown()?.card?.pin === "pr",
        "the new PR card stands where the old one stood, the reader's own note stays, and the PR card is current"
    );

    // A reload: the bundle starts again on the same board, and the panel is never opened.
    const beforeReload = net.requests.length;
    await boot(false);
    await wait(20);
    // The reader has looked elsewhere since.
    Object.assign(host.camera, { x: 50_000, y: 50_000, zoom: 1 });
    const reloaded = host.calls.length;
    const label = [...host.elements].find(([, e]) => e.schema.meta?.prBlackboard?.part === "label" && String(e.schema.meta.prBlackboard.link).startsWith("calls:src/compose.ts:18"))![0];
    await click([label], { x: 0, y: 0 }, 80);
    expectThat(callsOf("command:camera:fly-to-rect", reloaded).length === 1 && callsOf("command:kv-storage:get", reloaded).length === 0, "after a reload, with the panel never opened, a label follows its string: the camera flies, no review is read");
    const cardOf = (pin: string) => [...host.elements].find(([, e]) => e.schema.type === "component" && e.schema.meta?.prBlackboard?.pin === pin)!;
    const [composeId, composeAgain] = cardOf("src/compose.ts:18");
    const fold = (composeAgain.schema.meta.prBlackboard.folds as [number, number][])[0];
    const folding = host.calls.length;
    await click([composeId], { x: composeAgain.rect.x + 100, y: composeAgain.rect.y + fold[0] + 10 }, 700);
    const page = callsOf("command:dom:upsert-floating-element", folding).pop()?.req.schema.children[1].child.srcDoc ?? "";
    expectThat(page.includes(`class="r focus ctx" data-at="${fold[1]}"`) && callsOf("command:kv-storage:get", folding).length > 0, "a fold row opens Read all at its lines from the card's mark, loading the review only then");
    expectThat(callsOf("command:scene:clear-selection", folding).length === 1, "the fold-row click clears Drawdy's selection");
    expectThat(jsdelivr(beforeReload) === 0, `after the reload nothing comes from jsDelivr (${jsdelivr(beforeReload)} requests)`);

    // A full board's single add call stays well under what Drawdy takes in one message.
    const big = await reviewOf(crowded());
    let n = 0;
    const payload = Buffer.byteLength(JSON.stringify({ elements: reviewElements(big, planBoard(big), () => `id${n++}`, "dark").elements }));
    expectThat(
        big.pins.length === LIMITS.cards && payload < MAX_PAYLOAD_BYTES,
        `a ${big.pins.length}-card board's add payload is ${(payload / 1024).toFixed(1)} KB (limit ${MAX_PAYLOAD_BYTES / 1024} KB); hono's is ${(Buffer.byteLength(JSON.stringify({ elements: added })) / 1024).toFixed(1)} KB`
    );
} catch (err) {
    fail(`smoke test: ${err instanceof Error ? err.message : String(err)}`);
}

// 5. Pack what the marketplace would publish.
const outDir = join(ROOT, "dist/marketplace");
const outFile = join(outDir, `${manifest.driverId.replaceAll(".", "-")}.drawdyx`);
mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, zipSync({ "manifest.json": strToU8(manifestText), [manifest.main]: strToU8(code) }));
pass(`packed ${outFile.slice(ROOT.length + 1)}`);

if (failures.length > 0) {
    console.log(`\n${failures.length} check(s) failed.`);
    process.exit(1);
}
console.log("\nReady to submit: git push && drawdy submit");
process.exit(0);
