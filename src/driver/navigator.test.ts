import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { CARD, PALETTES, foldsOf, rowMiddle } from "../lib/card.ts";
import { prKey } from "../lib/github.ts";
import { planBoard, shiftPlan } from "../lib/layout.ts";
import type { Review } from "../lib/model.ts";
import { VIEW } from "../lib/view.ts";
import { fakeHost } from "../test/fake-host.ts";
import { honoFixture, reviewOf } from "../test/fixture.ts";
import { MARK, markOf, reviewElements } from "./elements.ts";
import { indexOf } from "./board.ts";
import type { ReadFile } from "./files.ts";
import { createNavigator } from "./navigator.ts";
import { CLOSE_BUTTON, DRAG_HANDLE, createPopover } from "./read-all.ts";

let hono: Review;
beforeAll(async () => {
    hono = await reviewOf(honoFixture());
});

/**
 * hono#5513 pinned on a fake host. `panel` sets the board as the panel does,
 * index and review; without it the navigator starts from nothing, as after
 * a reload or on a teammate's screen.
 */
const setup = (options: { panel?: boolean; extra?: Record<string, (req: any) => unknown>; load?: (key: string, at: string) => Promise<Review>; read?: ReadFile } = {}) => {
    const review = hono;
    const plan = shiftPlan(planBoard(review), { x: 1000, y: 500 });
    const host = fakeHost(undefined, options.extra);
    let n = 0;
    const { elements, pinIds, linkIds } = reviewElements(review, plan, () => `e${n++}`, "light");
    for (const e of elements) host.add(e);
    const marked = () => [...host.elements].map(([id, e]) => ({ id, mark: markOf(e.schema.meta)! })).filter((e) => e.mark);
    const popover = createPopover({ ddp: host.ddp });
    const loadReview = jest.fn(options.load ?? (async () => review));
    // The head files of the saved PR, as raw.githubusercontent.com sends them.
    const raw = honoFixture().raw;
    const readFile = jest.fn<ReadFile>(options.read ?? (async (_repo, _sha, path) => raw.get(path) ?? null));
    const navigator = createNavigator({ ddp: host.ddp, popover, styling: () => host.styling, changed: () => undefined, loadReview, explain: (err) => `Explained: ${String(err)}`, readFile });
    const key = prKey(review.pr.ref);
    const index = () => indexOf(key, review.pr.headSha, marked());
    if (options.panel !== false) navigator.set(index(), review);
    const pinNamed = (name: string) => review.pins.find((p) => p.name === name)!.id;
    const card = (name: string) => host.elements.get(pinIds.get(pinNamed(name))!)!.rect;
    const since = (from: number) => host.calls.slice(from).map((c) => c.type);
    const nameNow = () => review.pins.find((p) => p.id === navigator.currentPin())?.name;
    const labelOf = (prefix: string) => [...host.elements].find(([, e]) => e.schema.meta?.[MARK]?.part === "label" && e.schema.meta[MARK].link.startsWith(prefix))![0];
    const shown = () => host.calls.filter((c) => c.type === "command:dom:upsert-floating-element" || c.type === "command:dom:update-floating-element").pop()?.req;
    return { review, plan, host, navigator, popover, pinIds, linkIds, index, pinNamed, card, since, nameNow, labelOf, shown, loadReview, readFile };
};

/** Read all's pane in a floating element's schema: inside the box that clips it to the usable view. */
const paneOf = (req: any) => req.schema.children[0];
const pageOf = (req: any) => paneOf(req).children[1].child.srcDoc as string;
/** Where the pane's top-left shows on screen, and its scale: CSS scales it about its middle, so its translation makes up for that. */
const placed = (req: any) => {
    const pane = paneOf(req);
    const [, tx, ty, scale] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(pane.styles.transform)!.map(Number);
    const [w, h] = [pane.styles.width[0], pane.styles.height[0]];
    return { x: req.position.x + tx + (w / 2) * (1 - scale), y: req.position.y + ty + (h / 2) * (1 - scale), scale, width: w, height: h };
};

describe("stepping", () => {
    it("walks the code through eight steps, from the PR card to #dispatch() first, never the unchanged caller", async () => {
        const { navigator, nameNow } = setup();
        await navigator.focus("pr");
        expect(navigator.current()).toBe(-1);
        const visited: (string | undefined)[] = [];
        for (let i = 0; i < 10; i++) {
            await navigator.next();
            visited.push(nameNow());
        }
        expect(visited.slice(0, 8)).toEqual(["#dispatch()", "#handleError()", "compose()", "toError()", "compose.test.ts", "hono-base.ts imports", "onError()", "hono.test.ts"]);
        expect(visited.slice(8)).toEqual(["hono.test.ts", "hono.test.ts"]);
        expect(navigator.current()).toBe(7);
    });

    it("has no step before step 1, nor before the PR card: the description is not a step", async () => {
        const { navigator, pinNamed, nameNow } = setup();
        await navigator.focus(pinNamed("#dispatch()"));
        expect([navigator.current(), navigator.hasPrevious(), navigator.hasNext()]).toEqual([0, false, true]);
        await navigator.previous();
        expect(nameNow()).toBe("#dispatch()");
        await navigator.focus("pr");
        expect([navigator.hasPrevious(), navigator.hasNext()]).toEqual([false, true]);
    });

    it("says when there is no step before or after, skipping deleted cards", async () => {
        const { navigator, host, pinIds, pinNamed } = setup();
        await navigator.focus("pr");
        expect([navigator.hasPrevious(), navigator.hasNext()]).toEqual([false, true]);
        await navigator.focus(pinNamed("hono.test.ts"));
        expect([navigator.hasPrevious(), navigator.hasNext()]).toEqual([true, false]);
        host.remove(pinIds.get(pinNamed("hono.test.ts"))!);
        expect(await navigator.refresh()).toBe(true);
        await navigator.focus(pinNamed("onError()"));
        expect(navigator.hasNext()).toBe(false);
    });

    it("goes from the unchanged caller to the first step after it in board order", async () => {
        const { navigator, pinNamed, nameNow } = setup();
        await navigator.focus(pinNamed("fetch()"));
        expect(navigator.current()).toBe(-1);
        await navigator.next();
        expect(nameNow()).toBe("#dispatch()");
    });

    it("flies to each step and changes nothing on the board: no popover, no mark", async () => {
        const { navigator, host, since, nameNow } = setup();
        await navigator.next();
        const before = host.calls.length;
        await navigator.next();
        const steps = since(before);
        expect(nameNow()).toBe("#handleError()");
        expect(steps).toContain("command:camera:fly-to-rect");
        expect(steps).not.toContain("command:dom:upsert-floating-element");
        expect(steps.filter((type) => /^command:scene:(add|update|create)-/.test(type))).toEqual([]);
    });

    it("clears Drawdy's selection before every move it makes, Next, Previous, a follow and the overview, and never on a plain card click", async () => {
        const { navigator, host, since, pinNamed, pinIds, card, labelOf } = setup();
        const moves: [string, () => Promise<unknown>][] = [
            ["next", () => navigator.next()],
            ["previous", () => navigator.previous()],
            ["overview", () => navigator.overview()],
            ["follow", () => navigator.click([labelOf("calls:src/hono-base.ts:411>src/compose.ts:18")], { x: 0, y: 0 })],
        ];
        await navigator.focus(pinNamed("#dispatch()"));
        for (const [name, move] of moves) {
            const before = host.calls.length;
            await move();
            const calls = since(before);
            const fly = calls.indexOf("command:camera:fly-to-rect");
            expect([name, calls.indexOf("command:scene:clear-selection") >= 0, calls.indexOf("command:scene:clear-selection") < fly]).toEqual([name, true, true]);
        }
        const before = host.calls.length;
        const r = card("compose()");
        await navigator.click([pinIds.get(pinNamed("compose()"))!], { x: r.x + 40, y: r.y + 100 });
        expect(since(before)).not.toContain("command:scene:clear-selection");
    });

    it("clears the selection on a fold-row click, which opens Read all", async () => {
        const { navigator, host, since, pinNamed, pinIds, card, popover } = setup();
        const id = pinIds.get(pinNamed("toError()"))!;
        const [top] = (host.elements.get(id)!.schema.meta[MARK].folds as [number, number][])[0];
        const r = card("toError()");
        const before = host.calls.length;
        await navigator.click([id], { x: r.x + 40, y: r.y + top + 10 });
        expect(since(before)).toContain("command:scene:clear-selection");
        expect(popover.shown()?.pin).toBe(pinNamed("toError()"));
    });

    it("skips a card deleted from the board", async () => {
        const { navigator, host, pinIds, pinNamed, nameNow } = setup();
        host.remove(pinIds.get(pinNamed("#handleError()"))!);
        await navigator.refresh();
        await navigator.focus(pinNamed("#dispatch()"));
        await navigator.next();
        expect(nameNow()).toBe("compose()");
    });
});

describe("clicks on the board", () => {
    it("make a card current with one read, without moving the camera or opening a popover", async () => {
        const { navigator, host, pinIds, pinNamed, card, since, nameNow } = setup();
        const before = host.calls.length;
        const r = card("#dispatch()");
        await navigator.click([pinIds.get(pinNamed("#dispatch()"))!], { x: r.x + 200, y: r.y + rowMiddle(9) });
        expect(nameNow()).toBe("#dispatch()");
        expect(since(before)).toEqual(["command:scene:get-drawdy-elements"]);
    });

    it("prefer the card over a label, and a label over a string, at the same point", async () => {
        const { navigator, pinIds, pinNamed, linkIds, card, nameNow, labelOf } = setup();
        const r = card("toError()");
        const label = labelOf("calls:src/compose.ts:18");
        await navigator.click([linkIds.values().next().value!, label, pinIds.get(pinNamed("toError()"))!], { x: r.x + 20, y: r.y + 40 });
        expect(nameNow()).toBe("toError()");
        await navigator.focus(pinNamed("#dispatch()"));
        await navigator.click([linkIds.get("calls:src/hono-base.ts:411>src/hono-base.ts:405")!, label], { x: 0, y: 0 });
        expect(nameNow()).toBe("toError()");
    });

    it("ignore a click in a string's box but away from its curve, and follow one on it", async () => {
        const { navigator, linkIds, pinNamed, host, nameNow } = setup();
        await navigator.focus(pinNamed("fetch()"));
        const id = linkIds.get(`context:ctx:src/hono-base.ts:484>src/hono-base.ts:411`)!;
        const path = host.pathOf(id);
        const box = { x: Math.min(...path.map((p) => p.x)), y: Math.min(...path.map((p) => p.y)) };
        await navigator.click([id], { x: box.x + 1, y: box.y + 1 });
        expect(nameNow()).toBe("fetch()");
        await navigator.click([id], path[30]);
        expect(nameNow()).toBe("#dispatch()");
    });

    it("follow a label from the current card to its far end", async () => {
        const { navigator, pinNamed, nameNow, labelOf } = setup();
        await navigator.focus(pinNamed("compose()"));
        await navigator.click([labelOf("calls:src/compose.ts:18")], { x: 0, y: 0 });
        expect(nameNow()).toBe("toError()");
    });

    it("open Read all from a fold row at its lines, right of the card, and keep the current card when it closes", async () => {
        const { navigator, pinIds, pinNamed, card, host, popover, plan, nameNow, shown } = setup();
        const r = card("compose()");
        const rows = plan.cards.get(pinNamed("compose()"))!.rows;
        const fold = rows.findIndex((row) => row.kind === "fold");
        await navigator.click([pinIds.get(pinNamed("compose()"))!], { x: r.x + 200, y: r.y + rowMiddle(fold) });
        const open = shown();
        const right = host.camera.x + (r.x + r.width) * host.camera.zoom;
        const pane = placed(open);
        expect([pane.x, pane.y, pane.width, pane.scale]).toEqual([
            expect.closeTo(right + VIEW.readAll.gap * host.camera.zoom, 1),
            expect.closeTo(host.camera.y + r.y * host.camera.zoom, 1),
            VIEW.readAll.width,
            expect.closeTo(host.camera.zoom, 4),
        ]);
        const iframe = pageOf(open);
        const row = rows[fold];
        expect(row.kind === "fold" && iframe.includes(`class="r focus ctx" data-at="${row.from}"`)).toBe(true);
        expect(popover.shown()?.pin).toBeTruthy();
        await navigator.closePopover();
        expect(popover.shown()).toBeNull();
        expect(nameNow()).toBe("compose()");
    });

    it("close Read all on a click on another card, and keep it on a click on its own", async () => {
        const { navigator, pinIds, pinNamed, card, popover } = setup();
        await navigator.focus(pinNamed("compose()"));
        await navigator.readAll();
        const own = card("compose()");
        await navigator.click([pinIds.get(pinNamed("compose()"))!], { x: own.x + 20, y: own.y + 40 });
        expect(popover.shown()).not.toBeNull();
        const other = card("toError()");
        await navigator.click([pinIds.get(pinNamed("toError()"))!], { x: other.x + 20, y: other.y + 40 });
        expect(popover.shown()).toBeNull();
    });

    it("close Read all on Next, Previous and a follow", async () => {
        const { navigator, pinNamed, popover } = setup();
        for (const move of [() => navigator.next(), () => navigator.previous(), () => navigator.follow("calls:src/compose.ts:18>src/compose.ts:4")]) {
            await navigator.focus(pinNamed("compose()"));
            await navigator.readAll();
            expect(popover.shown()).not.toBeNull();
            await move();
            expect(popover.shown()).toBeNull();
        }
    });

    it("cost one read and nothing more for anything that isn't PR Blackboard's", async () => {
        const { navigator, host, since } = setup();
        const before = host.calls.length;
        await expect(navigator.click(["someone-elses-note"], { x: 0, y: 0 })).resolves.toBe(false);
        expect(since(before)).toEqual(["command:scene:get-drawdy-elements"]);
    });
});

describe("the board without the panel", () => {
    it("follows a label, flying the camera, from the marks alone: no review, no GitHub", async () => {
        const { navigator, host, since, pinNamed, labelOf, loadReview } = setup({ panel: false });
        const before = host.calls.length;
        await navigator.click([labelOf("calls:src/compose.ts:18")], { x: 0, y: 0 });
        expect(navigator.currentPin()).toBe(pinNamed("toError()"));
        expect(since(before)).toContain("command:camera:fly-to-rect");
        expect(since(before).filter((t) => t === "command:scene:get-drawdy-elements")).toHaveLength(2);
        expect(loadReview).not.toHaveBeenCalled();
    });

    it("finds a fold row from the card's mark, and loads the review only when Read all opens, saying so meanwhile", async () => {
        let resolve: (review: Review) => void = () => undefined;
        const { navigator, pinIds, pinNamed, card, plan, host, loadReview, review } = setup({ panel: false, load: () => new Promise<Review>((r) => (resolve = r)) });
        const r = card("compose()");
        const folds = foldsOf(plan.cards.get(pinNamed("compose()"))!);
        const clicking = navigator.click([pinIds.get(pinNamed("compose()"))!], { x: r.x + 100, y: r.y + folds[0][0] + 10 });
        // Long enough for the camera to fly to where Read all reads, and the page to open.
        await new Promise((done) => setTimeout(done, 900));
        expect(loadReview).toHaveBeenCalledTimes(1);
        const pages = () => host.calls.filter((c) => c.type === "command:dom:upsert-floating-element").map((c) => pageOf(c.req));
        expect(pages()[0]).toContain("Reading the PR…");
        resolve(review);
        await clicking;
        expect(pages().pop()).toContain(`class="r focus ctx" data-at="${folds[0][1]}"`);
        expect(navigator.review()).toBe(review);
    });

    it("leaves no popover open when the reader clicks another card while the review loads, whether it loads or fails", async () => {
        for (const fails of [false, true]) {
            let settle: () => void = () => undefined;
            const { navigator, pinIds, pinNamed, card, plan, popover, review } = setup({
                panel: false,
                load: () => new Promise<Review>((resolve, reject) => (settle = () => (fails ? reject(new Error("offline")) : resolve(review)))),
            });
            const r = card("compose()");
            const folds = foldsOf(plan.cards.get(pinNamed("compose()"))!);
            const clicking = navigator.click([pinIds.get(pinNamed("compose()"))!], { x: r.x + 100, y: r.y + folds[0][0] + 10 });
            await new Promise((done) => setTimeout(done, 20));
            const other = card("toError()");
            await navigator.click([pinIds.get(pinNamed("toError()"))!], { x: other.x + 100, y: other.y + 30 });
            // The loading page's timer fires after the reader has moved on.
            await new Promise((done) => setTimeout(done, 600));
            settle();
            await clicking;
            await new Promise((done) => setTimeout(done, 20));
            expect([fails, popover.shown()]).toEqual([fails, null]);
        }
    });

    it("makes the PR card current on a click anywhere on it, and opens nothing: the card shows its whole description", async () => {
        const { navigator, host, pinIds, card, popover, since } = setup({ panel: false });
        const r = card("The PR");
        expect(host.elements.get(pinIds.get("pr")!)!.schema.meta[MARK].folds).toBeUndefined();
        const before = host.calls.length;
        await navigator.click([pinIds.get("pr")!], { x: r.x + 100, y: r.y + r.height - 4 });
        expect([navigator.currentPin(), popover.shown()]).toEqual(["pr", null]);
        expect(since(before)).toEqual(["command:scene:get-drawdy-elements"]);
    });

    it("shows why Read all couldn't load, in the panel's words", async () => {
        const { navigator, pinIds, pinNamed, card, plan, shown } = setup({ panel: false, load: () => Promise.reject(new Error("rate limited")) });
        const r = card("compose()");
        const folds = foldsOf(plan.cards.get(pinNamed("compose()"))!);
        await navigator.click([pinIds.get(pinNamed("compose()"))!], { x: r.x + 100, y: r.y + folds[0][0] + 10 });
        expect(pageOf(shown())).toContain("Explained: Error: rate limited");
    });

    it("subscribes to camera moves only while the popover is open", async () => {
        const { navigator, host, pinNamed, since } = setup();
        await navigator.focus(pinNamed("compose()"));
        const before = host.calls.length;
        await navigator.readAll();
        expect(since(before).filter((t) => t === "subscription:camera:moved-rapid")).toHaveLength(1);
        await navigator.readAll();
        expect(since(before).filter((t) => t === "subscription:camera:moved-rapid")).toHaveLength(1);
        await navigator.closePopover();
        expect(since(before)).toContain("command:subscription:remove");
    });
});

describe("View full file", () => {
    /** Where a card's `View full file` row is, from its mark, as a click there arrives. */
    const fullRow = (env: ReturnType<typeof setup>, name: string) => {
        const id = env.pinIds.get(env.pinNamed(name))!;
        const top = env.host.elements.get(id)!.schema.meta[MARK].full as number;
        const r = env.card(name);
        return { id, at: { x: r.x + 200, y: r.y + top + 10 } };
    };
    const pages = (host: ReturnType<typeof fakeHost>) => host.calls.filter((c) => c.type === "command:dom:upsert-floating-element").map((c) => pageOf(c.req));
    const settle = (ms = 20) => new Promise((done) => setTimeout(done, ms));

    it("opens the card's whole file beside it, from the row its mark holds, at the card's first line, clearing the selection", async () => {
        const env = setup();
        const { navigator, host, since, readFile, review, shown, card, popover, nameNow } = env;
        const { id, at } = fullRow(env, "compose()");
        expect(at.y - card("compose()").y).toBe(host.elements.get(id)!.schema.meta[MARK].height - CARD.padBottom - CARD.row + 10);
        const before = host.calls.length;
        await navigator.click([id], at);
        expect(nameNow()).toBe("compose()");
        expect(readFile).toHaveBeenCalledWith(review.pr.headRepo, review.pr.headSha, "src/compose.ts");
        expect(since(before)).toContain("command:scene:clear-selection");
        const page = pageOf(shown());
        expect(page).toContain('<span class="dir">src/</span><span class="base">compose.ts</span>');
        expect(page).toContain("<i>77</i>");
        expect(page).toContain('<p class="own focus"><i>18</i>');
        // Where Read all opens: 24 right of the card, level with it, 720 wide, the full 640 tall.
        const r = card("compose()");
        const pane = placed(shown());
        expect([pane.x, pane.y, pane.width, pane.height]).toEqual([
            expect.closeTo(host.camera.x + (r.x + r.width + VIEW.readAll.gap) * host.camera.zoom, 1),
            expect.closeTo(host.camera.y + r.y * host.camera.zoom, 1),
            VIEW.readAll.width,
            VIEW.readAll.maxHeight,
        ]);
        // ✕ and the drag handle are Read all's own.
        expect(paneOf(shown()).children[0].children.map((b: any) => b.domId)).toEqual([DRAG_HANDLE, CLOSE_BUTTON]);
        await navigator.closePopover();
        expect(popover.shown()).toBeNull();
    });

    it("takes turns with Read all in one pane, which stays where it is", async () => {
        const env = setup();
        const { navigator, popover, shown, card, plan, pinIds, pinNamed } = env;
        const r = card("compose()");
        const fold = plan.cards.get(pinNamed("compose()"))!.rows.findIndex((row) => row.kind === "fold");
        await navigator.click([pinIds.get(pinNamed("compose()"))!], { x: r.x + 200, y: r.y + rowMiddle(fold) });
        popover.drag({ type: "dragStart", domElementId: DRAG_HANDLE, position: { canvasSpace: { x: r.x + 900, y: r.y + 20 } } });
        popover.drag({ type: "dragEnd", domElementId: DRAG_HANDLE, position: { canvasSpace: { x: r.x + 800, y: r.y + 120 } } });
        await settle();
        const dragged = placed(shown());
        expect(pageOf(shown())).toContain('<span class="name">compose()</span>');
        const { id, at } = fullRow(env, "compose()");
        await navigator.click([id], at);
        expect(pageOf(shown())).toContain('<span class="base">compose.ts</span>');
        expect([placed(shown()).x, placed(shown()).y]).toEqual([dragged.x, dragged.y]);
    });

    it("reads the review first without the panel, then the file, saying so while each takes a while", async () => {
        let review: (r: Review) => void = () => undefined;
        let file: (text: string) => void = () => undefined;
        const env = setup({ panel: false, load: () => new Promise<Review>((r) => (review = r)), read: () => new Promise<string>((r) => (file = r)) });
        const { navigator, host, readFile, loadReview, shown } = env;
        const { id, at } = fullRow(env, "compose()");
        const clicking = navigator.click([id], at);
        // Long enough for the camera to fly to where the pane reads, and the page to open.
        await settle(900);
        expect(loadReview).toHaveBeenCalledTimes(1);
        expect(pages(host).pop()).toContain("Reading the PR…");
        review(env.review);
        await settle(400);
        expect(readFile).toHaveBeenCalledTimes(1);
        expect(pages(host).pop()).toContain('<p class="note">Reading the file…</p>');
        file(honoFixture().raw.get("src/compose.ts")!);
        await clicking;
        expect(pageOf(shown())).toContain("<i>77</i>");
    });

    it("shows why when GitHub doesn't send the file, and asks again on the next click", async () => {
        const env = setup({ read: async () => null });
        const { navigator, readFile, shown } = env;
        const { id, at } = fullRow(env, "toError()");
        await navigator.click([id], at);
        expect(pageOf(shown())).toContain("PR Blackboard couldn&#39;t read this file from GitHub. Try again in a moment.");
        await navigator.click([id], at);
        expect(readFile).toHaveBeenCalledTimes(2);
    });

    it("opens nothing when the reader closes the pane, clicks another card, asks for Read all or the overview while the file loads", async () => {
        const moves: [string, (env: ReturnType<typeof setup>) => Promise<unknown>][] = [
            ["Esc or ✕", (env) => env.navigator.closePopover()],
            ["another card", (env) => env.navigator.click([env.pinIds.get(env.pinNamed("toError()"))!], { x: env.card("toError()").x + 20, y: env.card("toError()").y + 30 })],
            ["Read all", (env) => env.navigator.readAll()],
            ["the overview", (env) => env.navigator.overview()],
        ];
        for (const [move, act] of moves) {
            let file: (text: string) => void = () => undefined;
            const env = setup({ read: () => new Promise<string>((r) => (file = r)) });
            const { id, at } = fullRow(env, "compose()");
            const clicking = env.navigator.click([id], at);
            await settle();
            await act(env);
            file(honoFixture().raw.get("src/compose.ts")!);
            await clicking;
            await settle();
            expect([move, pages(env.host).some((page) => page.includes('<div class="lines"'))]).toEqual([move, false]);
        }
    });
});

describe("Description", () => {
    it("makes the PR card current and flies the camera to it, clearing the selection and closing Read all first", async () => {
        const { navigator, host, since, pinNamed, popover, card } = setup();
        await navigator.focus(pinNamed("compose()"));
        await navigator.readAll();
        expect(popover.shown()).not.toBeNull();
        const before = host.calls.length;
        await navigator.description();
        const calls = since(before);
        expect([navigator.currentPin(), navigator.current(), popover.shown()]).toEqual(["pr", -1, null]);
        expect(calls.indexOf("command:scene:clear-selection")).toBeLessThan(calls.indexOf("command:camera:fly-to-rect"));
        // The camera shows the PR card whole, at zoom 0.8 to 1.
        const r = card("The PR");
        const { zoom } = host.camera;
        expect(zoom).toBeGreaterThanOrEqual(VIEW.minZoom);
        expect(-host.camera.y / zoom).toBeLessThanOrEqual(r.y - VIEW.toolbar / zoom + 0.01);
        expect(host.camera.x + (r.x + r.width) * zoom).toBeLessThanOrEqual(host.screen.width - VIEW.panel + 0.01);
        // Pressed again with the card in view: nothing moves.
        const again = host.calls.length;
        await navigator.description();
        expect(since(again)).not.toContain("command:camera:fly-to-rect");
    });
});

describe("the overview", () => {
    it("fits every code card from its own rect, not Drawdy's combined rect, which drops components' far edges", async () => {
        const { navigator, host, since, pinIds } = setup();
        const before = host.calls.length;
        await navigator.overview();
        expect(since(before)).not.toContain("command:scene:query-combined-rect");
        const flight = host.calls.filter((c) => c.type === "command:camera:fly-to-rect").pop()!.req;
        const cards = [...pinIds.values()].map((id) => host.elements.get(id)!.rect);
        const right = Math.max(...cards.map((r) => r.x + r.width));
        const bottom = Math.max(...cards.map((r) => r.y + r.height));
        const usableRight = flight.rect.x + (host.screen.width - VIEW.panel) / flight.zoom;
        expect(right).toBeLessThanOrEqual(usableRight);
        expect(bottom).toBeLessThanOrEqual(flight.rect.y + flight.rect.height);
    });

    it("frames the PR card only down to the lowest code card, so a long description runs on below", async () => {
        const { navigator, host, pinIds } = setup();
        const pr = host.elements.get(pinIds.get("pr")!)!.rect;
        const code = [...pinIds].filter(([pin]) => pin !== "pr").map(([, id]) => host.elements.get(id)!.rect);
        const lowest = Math.max(...code.map((r) => r.y + r.height));
        await navigator.overview();
        const whole = host.calls.filter((c) => c.type === "command:camera:fly-to-rect").pop()!.req;
        Object.assign(pr, { height: 20_000 });
        await navigator.overview();
        const tall = host.calls.filter((c) => c.type === "command:camera:fly-to-rect").pop()!.req;
        expect(tall).toEqual(whole);
        expect(tall.rect.y + tall.rect.height).toBeLessThan(pr.y + pr.height);
        expect(tall.rect.y + tall.rect.height).toBeGreaterThanOrEqual(lowest);
    });
});

describe("Read all on the board", () => {
    it("shows the card's own header in the page, a drag handle and ✕ drawn over it, in the theme the cards were pinned in", async () => {
        const { navigator, pinNamed, host, shown } = setup();
        await navigator.focus(pinNamed("compose()"));
        await navigator.readAll();
        const req = shown();
        // The box at the usable view's corner clips the pane, so it never covers Drawdy's toolbar or the panel.
        expect([req.position, req.schema.styles.width, req.schema.styles.height, req.schema.styles.overflow, req.schema.styles.pointerEvents]).toEqual([
            { x: 0, y: VIEW.toolbar },
            [host.screen.width - VIEW.panel, "px"],
            [host.screen.height - VIEW.toolbar, "px"],
            "hidden",
            "none",
        ]);
        const pane = paneOf(req);
        expect(pane.children.map((c: any) => c.type)).toEqual(["row", "iframe"]);
        expect(pane.children[0].styles.height).toEqual([0, "px"]);
        expect(pane.children[0].children.map((b: any) => [b.domId, b.styles.cursor])).toEqual([
            [DRAG_HANDLE, "grab"],
            [CLOSE_BUTTON, "pointer"],
        ]);
        expect(pane.children[0].children[0].styles.height).toEqual([VIEW.readAll.header, "px"]);
        const page = pageOf(req);
        expect(page).toContain('<header><span class="name">compose()</span>');
        expect(page).toContain(`padding-right: 56px`);
        // The cards were pinned light; Drawdy now shows dark: Read all matches the cards.
        expect(host.styling.theme).toBe("dark");
        expect(page).toContain("color-scheme: light;");
        // Its 1 px frame is the cards' faintest ink, darker than their own frame, so a card under it never reads as more of the pane.
        expect([pane.styles.backgroundColor, pane.styles.borderColor, pane.styles.borderWidth, pane.styles.pointerEvents]).toEqual(["#ffffff", PALETTES.light.ink3, [1, "px"], "auto"]);
    });

    it("pans and zooms with the board: each camera move places it beside its card again, scaled by the zoom", async () => {
        const { navigator, pinNamed, popover, card, shown } = setup();
        await navigator.focus(pinNamed("compose()"));
        await navigator.readAll();
        const r = card("compose()");
        for (const camera of [{ x: -1000, y: -200, zoom: 0.5 }, { x: 300, y: 40, zoom: 0.25 }]) {
            popover.follow(camera);
            await new Promise((done) => setTimeout(done, 20));
            const pane = placed(shown());
            expect([pane.x, pane.y, pane.scale]).toEqual([
                expect.closeTo(camera.x + (r.x + r.width + VIEW.readAll.gap) * camera.zoom, 1),
                expect.closeTo(camera.y + r.y * camera.zoom, 1),
                expect.closeTo(camera.zoom, 4),
            ]);
        }
    });

    it("moves with a drag of its header, grabbing while it lasts, keeps the header where it can be grabbed again, and opens beside its card again", async () => {
        const { navigator, pinNamed, popover, card, shown, host } = setup();
        await navigator.focus(pinNamed("compose()"));
        await navigator.readAll();
        const r = card("compose()");
        const { x, y, zoom } = host.camera;
        const at = (dx: number, dy: number) => ({ canvasSpace: { x: r.x + 900 + dx, y: r.y + 20 + dy } });
        const settle = () => new Promise((done) => setTimeout(done, 20));
        popover.drag({ type: "dragStart", domElementId: DRAG_HANDLE, position: at(0, 0) });
        popover.drag({ type: "dragging", domElementId: DRAG_HANDLE, position: at(-150, 90) });
        await settle();
        expect(paneOf(shown()).children[0].children[0].styles.cursor).toBe("grabbing");
        expect([placed(shown()).x, placed(shown()).y]).toEqual([
            expect.closeTo(x + (r.x + r.width + VIEW.readAll.gap - 150) * zoom, 1),
            expect.closeTo(y + (r.y + 90) * zoom, 1),
        ]);
        // Far up and left: the header stops under the toolbar, 120 px of it on screen.
        popover.drag({ type: "dragging", domElementId: DRAG_HANDLE, position: at(-50_000, -50_000) });
        popover.drag({ type: "dragEnd", domElementId: DRAG_HANDLE, position: at(-50_000, -50_000) });
        await settle();
        const kept = placed(shown());
        expect([kept.x, kept.y]).toEqual([expect.closeTo(120 - (VIEW.readAll.width - VIEW.readAll.close) * zoom, 1), expect.closeTo(VIEW.toolbar, 1)]);
        expect(paneOf(shown()).children[0].children[0].styles.cursor).toBe("grab");
        // After the drop it moves with the board from where it was dropped.
        popover.follow({ x: x + 100, y, zoom });
        await settle();
        expect(placed(shown()).x).toBeCloseTo(kept.x + 100, 1);
        // Closed and opened again, it opens beside its card.
        await navigator.closePopover();
        await navigator.readAll();
        expect(placed(shown()).x).toBeCloseTo(host.camera.x + (r.x + r.width + VIEW.readAll.gap) * host.camera.zoom, 1);
    });

    it("first brings the camera to zoom 0.8 to 1 when it opens from a board zoomed out, then stays put while it opens", async () => {
        const { navigator, pinNamed, host, since } = setup();
        Object.assign(host.camera, { x: 0, y: 0, zoom: 0.3 });
        await navigator.focus(pinNamed("compose()"));
        const before = host.calls.length;
        await navigator.readAll();
        const calls = since(before);
        expect(calls.indexOf("command:camera:fly-to-rect")).toBeLessThan(calls.indexOf("command:dom:upsert-floating-element"));
        expect(host.camera.zoom).toBeGreaterThanOrEqual(VIEW.minZoom);
        await navigator.closePopover();
        const again = host.calls.length;
        await navigator.readAll();
        expect(since(again)).not.toContain("command:camera:fly-to-rect");
    });
});
