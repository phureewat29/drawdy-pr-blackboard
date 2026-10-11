import type { DomElementSchema } from "@drawdy/driver-protocol";
import { PALETTES, type ReadAllPage, type Theme } from "../lib/card.ts";
import { clamp, serial, sleep } from "../lib/fp.ts";
import type { Point, Rect } from "../lib/layout.ts";
import { VIEW, panned, placeReadAll, type Screen } from "../lib/view.ts";
import { icon } from "../shared/icons.ts";
import type { Ddp } from "./ddp.ts";

const POPOVER_ID = "pr-blackboard:read-all";
const PAN_MS = 300;
const BUTTON_SIZE = 32;
const ICON_SIZE = 16;
/** From the overlay's top and right edges to its buttons: level with the middle of the page's 56 px header. */
const BUTTON_INSET = 12;

/** The popover's one button, Lucide `x`, by the DOM id its clicks arrive with. */
export const CLOSE_BUTTON = "pr-blackboard:read-all:close";

/**
 * What Read all shows, in the theme the cards were pinned in: a card's
 * header, then the code or the description, or why it couldn't load.
 */
export type PopoverContent = ReadAllPage & { theme: Theme; pin: string };

export type Popover = {
    /** Opens the popover to the right of `card`, a rect on the canvas, or replaces what it shows. */
    open: (card: Rect, content: PopoverContent) => Promise<void>;
    /** Keeps the popover beside its card while the camera moves, from a `camera:moved-rapid` body. */
    follow: (camera: { x: number; y: number; zoom: number }) => void;
    close: () => Promise<void>;
    /** What it shows, when open. */
    shown: () => PopoverContent | null;
};

const closeButton = (colours: Record<string, string>): DomElementSchema => ({
    type: "button",
    domId: CLOSE_BUTTON,
    styles: {
        width: [BUTTON_SIZE, "px"],
        height: [BUTTON_SIZE, "px"],
        borderRadius: [8, "px"],
        cursor: "pointer",
        padding: [(BUTTON_SIZE - ICON_SIZE) / 2, "px"],
        transform: `translate(-${BUTTON_INSET}px, ${BUTTON_INSET}px)`,
        hover: { backgroundColor: colours.line },
    },
    // A schema has no SVG of its own; an image of one draws the icon, stroked in the pinned theme's ink.
    children: [{ type: "image", child: `data:image/svg+xml,${encodeURIComponent(icon("x", ICON_SIZE, colours.ink))}`, styles: { width: [ICON_SIZE, "px"], height: [ICON_SIZE, "px"] } }],
});

/**
 * The overlay: the page in an iframe, and `✕` over the header's right
 * end. It is a schema button, since only those report clicks; it comes
 * first in a row of no height, and its transform draws it above the
 * iframe.
 */
export const popoverSchema = (content: PopoverContent, width: number, height: number): DomElementSchema => {
    const colours = PALETTES[content.theme];
    return {
        type: "column",
        styles: {
            width: [width, "px"],
            backgroundColor: colours.bg,
            borderColor: colours.line,
            borderWidth: [1, "px"],
            borderType: "solid",
            borderRadius: [12, "px"],
            overflow: "hidden",
            pointerEvents: "auto",
            gap: 0,
        },
        children: [
            {
                type: "row",
                styles: { width: [100, "%"], height: [0, "px"], overflow: "visible", mainAxisAlignment: "end", crossAxisAlignment: "start" },
                children: [closeButton(colours)],
            },
            {
                type: "iframe",
                child: { srcDoc: content.html },
                styles: { width: [100, "%"], height: [height, "px"], borderWidth: [0, "px"], pointerEvents: "auto" },
            },
        ],
    };
};

/**
 * Read all, the one popover: a floating overlay in
 * screen space, so it reads the same at any zoom, always to the right of
 * its card. On open it learns how canvas maps to screen (one
 * `camera:get-info` and one `canvas-to-screen`) and subscribes to camera
 * moves, each of which carries all it needs; it unsubscribes on close.
 */
export const createPopover = (deps: { ddp: Ddp }): Popover => {
    const { ddp } = deps;
    let content: PopoverContent | null = null;
    let card: Rect | null = null;
    let height = 0;
    let screen: Screen = { width: 1280, height: 800 };
    /** Where the canvas container starts on screen: screen = offset + pan + canvas × zoom. */
    let offset: Point = { x: 0, y: 0 };
    let moving = false;
    let pending: { x: number; y: number; zoom: number } | null = null;
    let watching: Promise<string | null> | null = null;

    const learn = async (at: Rect) => {
        const [info, corner, size] = await Promise.all([
            ddp.tryCall("command:camera:get-info"),
            ddp.tryCall("command:camera:canvas-to-screen", { x: at.x, y: at.y }),
            ddp.tryCall("command:dom:window-size"),
        ]);
        screen = size ?? screen;
        if (!info || !corner) return null;
        offset = { x: corner.x - info.x - at.x * info.zoom, y: corner.y - info.y - at.y * info.zoom };
        return info;
    };

    const spotFor = (camera: { x: number; y: number; zoom: number }, at: Rect, page: ReadAllPage) =>
        placeReadAll(
            {
                left: offset.x + camera.x + at.x * camera.zoom,
                right: offset.x + camera.x + (at.x + at.width) * camera.zoom,
                top: offset.y + camera.y + at.y * camera.zoom,
            },
            screen,
            page.height
        );

    const show = async (at: Rect, next: PopoverContent) => {
        card = at;
        let info = await learn(at);
        if (!info) return;
        let spot = spotFor(info, at, next);
        // Not enough room on the right: pan left first, keeping the zoom, then open.
        if (spot.pan > 0) {
            const viewport = await ddp.tryCall("command:camera:get-viewport-rect");
            if (viewport) {
                const camera = panned(viewport.rect, spot.pan, info.zoom);
                await ddp.tryCall("command:camera:fly-to-rect", { rect: camera.rect, flyDurationMs: PAN_MS, zoom: camera.zoom });
                await sleep(PAN_MS + 20);
                info = (await learn(at)) ?? info;
                spot = { ...spotFor(info, at, next), width: spot.width, height: spot.height };
            }
        }
        height = spot.height;
        // Overlay, not Drawdy's popover kind: that one stays where it first
        // opened. This one goes exactly where it's told, and its own
        // pointer-events setting makes it interactive.
        await ddp.call("command:dom:upsert-floating-element", {
            domId: POPOVER_ID,
            position: { x: spot.x, y: spot.y },
            schema: popoverSchema(next, spot.width, spot.height),
            barrierDismissible: false,
            asPopover: false,
        });
        content = next;
        watching ??= ddp.tryCall("subscription:camera:moved-rapid").then((sub) => sub?.subscriptionId ?? null);
    };

    // Camera events come many times a second: one move at a time, then one more with the latest camera.
    const follow = (camera: { x: number; y: number; zoom: number }) => {
        if (!content || !card) return;
        pending = camera;
        if (moving) return;
        moving = true;
        void (async () => {
            while (pending && content && card) {
                const next = pending;
                pending = null;
                const right = offset.x + next.x + (card.x + card.width) * next.zoom;
                const top = offset.y + next.y + card.y * next.zoom;
                const position = {
                    x: Math.round(right + VIEW.readAll.gap),
                    y: Math.round(clamp(top, VIEW.toolbar + VIEW.readAll.edge, Math.max(VIEW.toolbar + VIEW.readAll.edge, screen.height - height - VIEW.readAll.edge))),
                };
                const moved = await ddp.tryCall("command:dom:move-floating-element", { domId: POPOVER_ID, position });
                if (moved === null) content = null;
            }
            moving = false;
        })();
    };

    const close = async () => {
        if (!content) return;
        content = null;
        card = null;
        const sub = watching;
        watching = null;
        await ddp.tryCall("command:dom:remove-floating-element", { domId: POPOVER_ID });
        const id = sub ? await sub : null;
        if (id) await ddp.tryCall("command:subscription:remove", { subscriptionId: id });
    };

    // Opening, replacing and closing run one at a time, so a page that took longer to open never lands over a newer one.
    const queue = serial();
    return { open: (at, next) => queue(() => show(at, next)), follow, close: () => queue(close), shown: () => content };
};
