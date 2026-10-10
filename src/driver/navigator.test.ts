import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { foldsOf, rowMiddle } from "../lib/card.ts";
import { prKey } from "../lib/github.ts";
import { planBoard, shiftPlan } from "../lib/layout.ts";
import type { Review } from "../lib/model.ts";
import { VIEW } from "../lib/view.ts";
import { fakeHost } from "../test/fake-host.ts";
import { honoFixture, reviewOf } from "../test/fixture.ts";
import { MARK, markOf, reviewElements } from "./elements.ts";
import { createNavigator, indexOf } from "./navigator.ts";
import { createPopover } from "./read-all.ts";

let hono: Review;
beforeAll(async () => {
    hono = await reviewOf(honoFixture());
});

/**
 * hono#5513 pinned on a fake host. `panel` sets the board as the panel does,
 * index and review; without it the navigator starts from nothing, as after
 * a reload or on a teammate's screen.
 */
const setup = (options: { panel?: boolean; extra?: Record<string, (req: any) => unknown>; load?: (key: string, at: string) => Promise<Review> } = {}) => {
    const review = hono;
    const plan = shiftPlan(planBoard(review), { x: 1000, y: 500 });
    const host = fakeHost(undefined, options.extra);
    let n = 0;
    const { elements, pinIds, linkIds } = reviewElements(review, plan, () => `e${n++}`, "light");
    for (const e of elements) host.add(e);
    const marked = () => [...host.elements].map(([id, e]) => ({ id, mark: markOf(e.schema.meta)! })).filter((e) => e.mark);
    const popover = createPopover({ ddp: host.ddp });
    const loadReview = jest.fn(options.load ?? (async () => review));
    const navigator = createNavigator({ ddp: host.ddp, popover, styling: () => host.styling, changed: () => undefined, loadReview, explain: (err) => `Explained: ${String(err)}` });
    const key = prKey(review.pr.ref);
    const index = () => indexOf(key, review.pr.headSha, marked());
    if (options.panel !== false) navigator.set(index(), review);
    const pinNamed = (name: string) => review.pins.find((p) => p.name === name)!.id;
    const card = (name: string) => host.elements.get(pinIds.get(pinNamed(name))!)!.rect;
    const since = (from: number) => host.calls.slice(from).map((c) => c.type);
    const nameNow = () => review.pins.find((p) => p.id === navigator.currentPin())?.name;
    const labelOf = (prefix: string) => [...host.elements].find(([, e]) => e.schema.meta?.[MARK]?.part === "label" && e.schema.meta[MARK].link.startsWith(prefix))![0];
    const shown = () => host.calls.filter((c) => c.type === "command:dom:upsert-floating-element").pop()?.req;
    return { review, plan, host, navigator, popover, pinIds, linkIds, index, pinNamed, card, since, nameNow, labelOf, shown, loadReview };
};

describe("stepping", () => {
    it("goes from the PR card to #dispatch(), through nine steps, never to the unchanged caller", async () => {
        const { navigator, nameNow } = setup();
        const visited: (string | undefined)[] = [];
        for (let i = 0; i < 11; i++) {
            await navigator.next();
            visited.push(nameNow());
        }
        expect(visited.slice(0, 9)).toEqual(["The pull request", "#dispatch()", "#handleError()", "compose()", "toError()", "compose.test.ts", "hono-base.ts imports", "onError()", "hono.test.ts"]);
        expect(visited.slice(9)).toEqual(["hono.test.ts", "hono.test.ts"]);
        expect(navigator.current()).toBe(8);
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
        expect(nameNow()).toBe("#dispatch()");
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
        expect(open.position.x).toBeGreaterThanOrEqual(Math.round(right + VIEW.readAll.gap));
        const iframe = open.schema.children[1].child.srcDoc as string;
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
        // Long enough for the popover to pan the camera for room and open.
        await new Promise((done) => setTimeout(done, 600));
        expect(loadReview).toHaveBeenCalledTimes(1);
        const pages = () => host.calls.filter((c) => c.type === "command:dom:upsert-floating-element").map((c) => c.req.schema.children[1].child.srcDoc as string);
        expect(pages()[0]).toContain("Reading the pull request…");
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

    it("opens the PR card's Read all from anywhere between its fold zone's top and the card's foot, and not above", async () => {
        const { navigator, host, pinIds, card, popover, shown } = setup({ panel: false });
        const r = card("The pull request");
        const fold = (host.elements.get(pinIds.get("pr")!)!.schema.meta[MARK].folds as [number, number][])[0];
        await navigator.click([pinIds.get("pr")!], { x: r.x + 100, y: r.y + fold[0] - 2 });
        expect(popover.shown()).toBeNull();
        await navigator.click([pinIds.get("pr")!], { x: r.x + 100, y: r.y + r.height - 4 });
        expect(popover.shown()?.pin).toBeTruthy();
        expect(shown().schema.children[1].child.srcDoc).toContain("<h3>Behavior change</h3>");
    });

    it("shows why Read all couldn't load, in the panel's words", async () => {
        const { navigator, pinIds, pinNamed, card, plan, shown } = setup({ panel: false, load: () => Promise.reject(new Error("rate limited")) });
        const r = card("compose()");
        const folds = foldsOf(plan.cards.get(pinNamed("compose()"))!);
        await navigator.click([pinIds.get(pinNamed("compose()"))!], { x: r.x + 100, y: r.y + folds[0][0] + 10 });
        expect(shown().schema.children[1].child.srcDoc).toContain("Explained: Error: rate limited");
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

describe("the overview", () => {
    it("fits every card from its own rect, not Drawdy's combined rect, which drops components' far edges", async () => {
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
});

describe("Read all's overlay", () => {
    it("shows the card's own header in the page, only ✕ drawn over it, in the theme the cards were pinned in", async () => {
        const { navigator, pinNamed, host, shown } = setup();
        await navigator.focus(pinNamed("compose()"));
        await navigator.readAll();
        const schema = shown().schema;
        expect(schema.children.map((c: any) => c.type)).toEqual(["row", "iframe"]);
        expect(schema.children[0].styles.height).toEqual([0, "px"]);
        expect(schema.children[0].children.map((b: any) => b.domId)).toEqual(["pr-blackboard:read-all:close"]);
        const page = schema.children[1].child.srcDoc as string;
        expect(page).toContain('<header><span class="name">compose()</span>');
        expect(page).toContain(`padding-right: 56px`);
        expect(page).not.toContain('class="gh"');
        // The cards were pinned light; Drawdy now shows dark: Read all matches the cards.
        expect(host.styling.theme).toBe("dark");
        expect(page).toContain("color-scheme: light;");
        expect(schema.styles.backgroundColor).toBe("#ffffff");
    });
});
