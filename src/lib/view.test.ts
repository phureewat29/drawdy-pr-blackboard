import { beforeAll, describe, expect, it } from "@jest/globals";
import { excalidrawFixture, honoFixture, reviewOf, type SavedPr } from "../test/fixture.ts";
import { nameRect } from "./card.ts";
import { planBoard, stepsOf, type BoardPlan, type Rect } from "./layout.ts";
import type { Review } from "./model.ts";
import { VIEW, overviewCamera, placeReadAll, stepCamera, usable, type Camera, type Screen } from "./view.ts";

let review: Review;
let plan: BoardPlan;
beforeAll(async () => {
    review = await reviewOf(honoFixture());
    plan = planBoard(review);
});
/** The cards a pin's drawn strings join. */
const linkedTo = (pin: string) =>
    plan.strings.filter((s) => s.from.pin === pin || s.to.pin === pin).map((s) => plan.pins.get(s.from.pin === pin ? s.to.pin : s.from.pin)!);
const idOf = (name: string) => review.pins.find((p) => p.name === name)!.id;
const SCREENS: Screen[] = [
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
];

/** Where a canvas rect lands on screen under a camera that fits `camera.rect` to the screen. */
const onScreen = (camera: Camera, r: { x: number; y: number; width: number; height: number }) => ({
    left: (r.x - camera.rect.x) * camera.zoom,
    top: (r.y - camera.rect.y) * camera.zoom,
    right: (r.x + r.width - camera.rect.x) * camera.zoom,
    bottom: (r.y + r.height - camera.rect.y) * camera.zoom,
});

describe.each(SCREENS)("the camera at $width × $height", (screen) => {
    const view = usable(screen);
    const whole = (camera: Camera, r: { x: number; y: number; width: number; height: number }) => {
        const box = onScreen(camera, r);
        return box.left >= view.x - 0.001 && box.right <= view.x + view.width + 0.001 && box.top >= view.y - 0.001 && box.bottom <= view.y + view.height + 0.001;
    };

    it("frames every hono step at zoom 0.8 to 1, the card whole or its top just below the toolbar", () => {
        for (const step of stepsOf(review)) {
            const card = plan.pins.get(step)!;
            const camera = stepCamera(card, screen, null, linkedTo(step))!;
            expect(camera.zoom).toBeGreaterThanOrEqual(VIEW.minZoom);
            expect(camera.zoom).toBeLessThanOrEqual(VIEW.maxZoom);
            // The rect has the screen's shape, so fly-to-rect lands on exactly this zoom.
            expect(camera.rect.width / camera.rect.height).toBeCloseTo(screen.width / screen.height, 6);
            const box = onScreen(camera, card);
            const tall = card.height * camera.zoom > view.height - 2 * VIEW.margin;
            expect([step, tall ? box.left >= view.x && box.right <= view.x + view.width && Math.abs(box.top - view.y - VIEW.margin) < 0.01 : whole(camera, card)]).toEqual([step, true]);
        }
    });

    it("stays still when the card already shows whole at zoom 0.8 or more", () => {
        for (const pin of ["src/compose.ts:4", "src/hono-base.ts:411"]) {
            const card = plan.pins.get(pin)!;
            const viewport = stepCamera(card, screen, null, linkedTo(pin))!.rect;
            expect(stepCamera(card, screen, viewport, linkedTo(pin))).toBeNull();
            expect(stepCamera(card, screen, { ...viewport, x: viewport.x + 5000 }, linkedTo(pin))).not.toBeNull();
            expect(stepCamera(card, screen, { ...viewport, width: viewport.width * 3, height: viewport.height * 3 }, linkedTo(pin))).not.toBeNull();
        }
    });

    it("opens Read all to the right of its card, never left of it", () => {
        const width = Math.min(VIEW.readAll.maxWidth, Math.max(VIEW.readAll.minWidth, usable(screen).width - 260));
        for (const left of [40, 300, 600, 900]) {
            const card = { left, right: left + 500, top: 200 };
            const spot = placeReadAll(card, screen, () => Infinity);
            expect(spot.x).toBeGreaterThanOrEqual(card.right - spot.pan + VIEW.readAll.gap);
            expect(spot.width).toBeGreaterThanOrEqual(VIEW.readAll.minWidth);
            expect(spot.width).toBeLessThanOrEqual(VIEW.readAll.maxWidth);
            // Panning keeps the card's right 240 px on screen.
            expect(card.right - spot.pan).toBeGreaterThanOrEqual(Math.min(card.right, VIEW.readAll.keep));
            if (spot.pan === 0) expect(spot.width).toBe(width);
        }
        if (screen.width === 1920) expect(placeReadAll({ left: 100, right: 600, top: 100 }, screen, () => Infinity).width).toBe(720);
    });

    it("makes Read all as tall as its page, up to 640 or the view less 48", () => {
        const card = { left: 100, right: 600, top: 200 };
        expect(placeReadAll(card, screen, () => 150.2).height).toBe(151);
        expect(placeReadAll(card, screen, () => 5000).height).toBe(Math.min(VIEW.readAll.maxHeight, usable(screen).height - 48));
        expect(placeReadAll(card, screen, (w) => 100_000 / w).height).toBe(Math.ceil(100_000 / placeReadAll(card, screen, () => 0).width));
    });
});

describe("the camera's two rules on hono#5513", () => {
    const at = (name: string) => plan.pins.get(idOf(name))!;
    const onScreenWhole = (screen: Screen, camera: Camera, r: { x: number; y: number; width: number; height: number }) => {
        const box = onScreen(camera, r);
        const view = usable(screen);
        return box.left >= view.x - 0.001 && box.right <= view.x + view.width + 0.001 && box.top >= view.y - 0.001 && box.bottom <= view.y + view.height + 0.001;
    };

    it("at 1920 × 1080 frames toError() with both its callers, and compose.test.ts with compose()", () => {
        const screen = { width: 1920, height: 1080 };
        const toError = stepCamera(at("toError()"), screen, null, linkedTo(idOf("toError()")))!;
        expect([onScreenWhole(screen, toError, at("#handleError()")), onScreenWhole(screen, toError, at("compose()"))]).toEqual([true, true]);
        const tests = stepCamera(at("compose.test.ts"), screen, null, linkedTo(idOf("compose.test.ts")))!;
        expect(onScreenWhole(screen, tests, at("compose()"))).toBe(true);
    });

    it("at 1280 × 800 frames toError() alone at 0.8, with less than 160 of room each side", () => {
        const screen = { width: 1280, height: 800 };
        const card = at("toError()");
        const camera = stepCamera(card, screen, null, linkedTo(idOf("toError()")))!;
        expect(camera.zoom).toBe(VIEW.minZoom);
        const box = onScreen(camera, card);
        const room = (box.left - usable(screen).x) / camera.zoom;
        expect(room).toBeGreaterThan(0);
        expect(room).toBeLessThan(VIEW.room);
        expect(onScreenWhole(screen, camera, card)).toBe(true);
    });
});

describe("the camera on a bottom-row step that can't frame its partner whole", () => {
    const at = (name: string) => plan.pins.get(idOf(name))!;
    const names = (pin: string) =>
        plan.strings
            .filter((s) => s.from.pin === pin || s.to.pin === pin)
            .map((s) => (s.from.pin === pin ? s.to.pin : s.from.pin))
            .map((id) => nameRect(plan.pins.get(id)!, review.pins.find((p) => p.id === id)!.name));
    const shownWhole = (screen: Screen, camera: Camera, r: { x: number; y: number; width: number; height: number }) => {
        const box = onScreen(camera, r);
        const view = usable(screen);
        return box.left >= view.x - 0.001 && box.right <= view.x + view.width + 0.001 && box.top >= view.y - 0.001 && box.bottom <= view.y + view.height + 0.001;
    };

    it.each(SCREENS)("moves the frame toward the joined card's name, the card whole, at zoom 0.8 or more ($width × $height)", (screen) => {
        const view = usable(screen);
        const cases: [string, string, boolean][] = [
            // hono.test.ts and onError()'s name span about 1890 canvas units: 1510 px at 0.8, more than either screen has.
            ["hono.test.ts", "onError()", false],
            ["onError()", "hono.test.ts", screen.width === 1920],
            ["hono-base.ts imports", "toError()", true],
        ];
        for (const [card, partner, fits] of cases) {
            const id = idOf(card);
            const camera = stepCamera(at(card), screen, null, linkedTo(id), names(id))!;
            const name = nameRect(at(partner), partner);
            const box = onScreen(camera, at(card));
            // A name that can't fit pulls the card's far edge to the margin, so as much of the partner as possible shows.
            const pulled = at(partner).x < at(card).x ? Math.abs(box.right - (view.x + view.width - VIEW.margin)) < 0.5 : Math.abs(box.left - (view.x + VIEW.margin)) < 0.5;
            expect([card, camera.zoom >= VIEW.minZoom, shownWhole(screen, camera, at(card)), fits ? shownWhole(screen, camera, name) : pulled]).toEqual([card, true, true, true]);
        }
    });

    it("moves no further than it needs: a name already in view leaves the card centred", () => {
        const screen = { width: 1920, height: 1080 };
        const card = at("onError()");
        const near = { x: card.x + card.width + 40, y: card.y, width: 80, height: 56 };
        expect(stepCamera(card, screen, null, [], [near])).toEqual(stepCamera(card, screen, null, [], []));
    });
});

describe("the camera and Drawdy's minimap", () => {
    /** The minimap's corner on screen, margin included. */
    const corner = (screen: Screen) => ({ left: 0, right: VIEW.minimap.width, top: screen.height - VIEW.minimap.height, bottom: screen.height });
    const overlaps = (screen: Screen, camera: Camera, r: Rect) => {
        const box = onScreen(camera, r);
        const c = corner(screen);
        return box.left < c.right - 0.001 && box.right > c.left + 0.001 && box.top < c.bottom - 0.001 && box.bottom > c.top + 0.001;
    };
    const boardOf = async (fixture: SavedPr) => {
        const review = await reviewOf(fixture);
        const plan = planBoard(review);
        const far = (pin: string) => plan.strings.filter((s) => s.from.pin === pin || s.to.pin === pin).map((s) => (s.from.pin === pin ? s.to.pin : s.from.pin));
        return { review, plan, far };
    };

    it.each(SCREENS)("a tall card with names up and to the right stays clear of it ($width × $height)", (screen) => {
        const card = { x: 0, y: 0, width: 640, height: 2400 };
        const names = [
            { x: 900, y: -300, width: 160, height: 56 },
            { x: 1500, y: -200, width: 160, height: 56 },
        ];
        const camera = stepCamera(card, screen, null, [], names)!;
        expect(overlaps(screen, camera, card)).toBe(false);
        expect(onScreen(camera, card).right).toBeLessThanOrEqual(usable(screen).width + 0.001);
    });

    it.each(SCREENS)("a short card pulled down and left toward a name it can't take in stays clear of it ($width × $height)", (screen) => {
        const card = { x: 0, y: 0, width: 600, height: 300 };
        const camera = stepCamera(card, screen, null, [], [{ x: -3000, y: 3000, width: 160, height: 56 }])!;
        expect(overlaps(screen, camera, card)).toBe(false);
    });

    it.each(SCREENS)("no step on hono#5513 or excalidraw#12237 lands under it ($width × $height)", async (screen) => {
        for (const fixture of [honoFixture(), excalidrawFixture()]) {
            const { review, plan, far } = await boardOf(fixture);
            for (const step of stepsOf(review)) {
                const card = plan.pins.get(step)!;
                const names = far(step).map((id) => nameRect(plan.pins.get(id)!, review.pins.find((p) => p.id === id)!.name));
                const camera = stepCamera(card, screen, null, far(step).map((id) => plan.pins.get(id)!), names)!;
                expect([step, overlaps(screen, camera, card)]).toEqual([step, false]);
            }
        }
    });

    it("moves a card that shows whole but sits under the minimap", () => {
        const screen = { width: 1920, height: 1080 };
        const card = { x: 20, y: 700, width: 400, height: 300 };
        const viewport = { x: 0, y: 0, width: 1920, height: 1080 };
        const camera = stepCamera(card, screen, viewport);
        expect(camera).not.toBeNull();
        expect(overlaps(screen, camera!, card)).toBe(false);
    });
});

describe("the overview", () => {
    it.each(SCREENS)("shows the whole review, centred in the usable view ($width × $height)", (screen) => {
        const camera = overviewCamera(plan.bounds, screen);
        const view = usable(screen);
        const box = onScreen(camera, plan.bounds);
        expect(box.left).toBeGreaterThanOrEqual(view.x + VIEW.margin - 0.001);
        expect(box.right).toBeLessThanOrEqual(view.x + view.width - VIEW.margin + 0.001);
        expect(box.top).toBeGreaterThanOrEqual(view.y + VIEW.margin - 0.001);
        expect(box.bottom).toBeLessThanOrEqual(view.y + view.height - VIEW.margin + 0.001);
        expect(Math.abs(box.left - view.x - (view.x + view.width - box.right))).toBeLessThan(0.01);
    });
});
