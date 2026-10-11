import type { DomElementSchema } from "@drawdy/driver-protocol";
import { PALETTES, type ReadAllPage, type Theme } from "../lib/card.ts";
import { serial, sleep } from "../lib/fp.ts";
import type { Point, Rect, Size } from "../lib/layout.ts";
import { VIEW, dragLimit, readAllCamera, readAllFrame, readAllRect, type Screen } from "../lib/view.ts";
import { icon } from "../shared/icons.ts";
import { fly, screenOf, viewportOf } from "./camera.ts";
import type { Ddp } from "./ddp.ts";

const POPOVER_ID = "pr-blackboard:read-all";
/** The pane inside the clip, by an id of its own, so Drawdy keeps the same element, iframe and all, from one schema to the next. */
const PANE_ID = "pr-blackboard:read-all:pane";
const BUTTON_SIZE = 32;
const ICON_SIZE = 16;
/** From the pane's top and right edges to `✕`: level with the middle of the page's 56 px header. */
const BUTTON_INSET = 12;

/** Read all's one button, Lucide `x`, by the DOM id its clicks arrive with. */
export const CLOSE_BUTTON = "pr-blackboard:read-all:close";
/** Read all's header, its drag handle, by the DOM id its drags arrive with. */
export const DRAG_HANDLE = "pr-blackboard:read-all:handle";

/**
 * What Read all shows, in the theme the cards were pinned in: a card's
 * header, then the code, or why it couldn't load.
 */
export type PopoverContent = ReadAllPage & { theme: Theme; pin: string };

/** Where the camera is: a `camera:moved-rapid` body, or `camera:get-info`. */
type CameraAt = { x: number; y: number; zoom: number };

/** A `dom:drag` body: the pointer where the drag started, moved to, or let go. */
type Drag = { type: "dragStart" | "dragging" | "dragEnd"; domElementId: string; position: { canvasSpace: Point } };

export type Popover = {
    /** Opens Read all beside `card`, a rect on the canvas, or replaces what it shows. */
    open: (card: Rect, content: PopoverContent) => Promise<void>;
    /** Keeps Read all on the board while the camera moves, from a `camera:moved-rapid` body. */
    follow: (camera: CameraAt) => void;
    /** Moves Read all with a drag of its header, from a `dom:drag` body. */
    drag: (event: Drag) => void;
    /** Clips Read all to the usable view again after the window changed size. */
    resize: (screen: Screen) => void;
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

/** The header left of `✕`, a box of its own over the page's header: Drawdy reports drags by an element's id. Its transform draws it above the iframe. */
const dragHandle = (colours: Record<string, string>, width: number, grabbing: boolean): DomElementSchema => ({
    type: "box",
    domId: DRAG_HANDLE,
    styles: {
        width: [width, "px"],
        height: [VIEW.readAll.header, "px"],
        transform: "translate(0px, 0px)",
        cursor: grabbing ? "grabbing" : "grab",
        pointerEvents: "auto",
        hover: { backgroundColor: colours.hover },
    },
});

/**
 * Read all as Drawdy draws it: a box over the usable view that clips it, so
 * it slides under Drawdy's toolbar and the panel as the cards do, and in
 * it the pane, laid out at its size in canvas units and scaled by the zoom
 * (`readAllFrame`), 1 px frame and all. The pane holds the page in an
 * iframe, and over its header the drag handle and `✕`, schema elements,
 * since only those report drags and clicks: they come first, in a row of
 * no height, and their transforms draw them above the iframe.
 */
export const popoverSchema = (content: PopoverContent, size: Size, frame: { clip: Rect; transform: string }, grabbing = false): DomElementSchema => {
    const colours = PALETTES[content.theme];
    return {
        type: "box",
        styles: { width: [frame.clip.width, "px"], height: [frame.clip.height, "px"], overflow: "hidden", pointerEvents: "none" },
        children: [
            {
                type: "column",
                domId: PANE_ID,
                styles: {
                    width: [size.width, "px"],
                    height: [size.height, "px"],
                    backgroundColor: colours.bg,
                    // The cards' faintest ink, not their frame: a card under the pane must not read as more of it.
                    borderColor: colours.ink3,
                    borderWidth: [1, "px"],
                    borderType: "solid",
                    borderRadius: [12, "px"],
                    overflow: "hidden",
                    pointerEvents: "auto",
                    transform: frame.transform,
                    gap: 0,
                },
                children: [
                    {
                        type: "row",
                        styles: { width: [100, "%"], height: [0, "px"], overflow: "visible", mainAxisAlignment: "between", crossAxisAlignment: "start" },
                        children: [dragHandle(colours, size.width - 2 - VIEW.readAll.close, grabbing), closeButton(colours)],
                    },
                    {
                        type: "iframe",
                        child: { srcDoc: content.html },
                        styles: { width: [100, "%"], height: [size.height - 2, "px"], borderWidth: [0, "px"], pointerEvents: "auto" },
                    },
                ],
            },
        ],
    };
};

/**
 * Read all, the one popover: a pane on the board, 24 right of its card,
 * 720 wide in canvas units, which pans and zooms with the cards. A floating
 * element sits in screen space, so on each camera move it is placed again
 * from the move's camera, scaled by its zoom. On open it learns where the
 * canvas sits on screen (one `camera:get-info` and one `canvas-to-screen`)
 * and subscribes to camera moves and window resizes; it unsubscribes on
 * close. Its header is a drag handle that moves its place on the board.
 */
export const createPopover = (deps: { ddp: Ddp }): Popover => {
    const { ddp } = deps;
    let content: PopoverContent | null = null;
    /** Where Read all is on the board, in canvas units. */
    let pane: Rect | null = null;
    let screen: Screen = { width: 1280, height: 800 };
    let camera: CameraAt = { x: 0, y: 0, zoom: 1 };
    /** Where the canvas container starts on screen: screen = offset + camera + canvas × zoom. */
    let offset: Point = { x: 0, y: 0 };
    /** A drag under way: where the pointer took the header and where the pane was then, on the board. */
    let dragging: { from: Point; at: Point } | null = null;
    let watching: Promise<string[]> | null = null;

    const toScreen = (p: Point): Point => ({ x: offset.x + camera.x + p.x * camera.zoom, y: offset.y + camera.y + p.y * camera.zoom });

    const learn = async (at: Point) => {
        const [info, corner, size] = await Promise.all([
            ddp.tryCall("command:camera:get-info"),
            ddp.tryCall("command:camera:canvas-to-screen", { x: at.x, y: at.y }),
            ddp.tryCall("command:dom:window-size"),
        ]);
        screen = size ?? screen;
        if (!info || !corner) return false;
        camera = info;
        offset = { x: corner.x - info.x - at.x * info.zoom, y: corner.y - info.y - at.y * info.zoom };
        return true;
    };

    /** The floating element for Read all as it stands: the clip at the usable view's corner, the pane in it. */
    const placement = (shown: PopoverContent, at: Rect) => {
        const frame = readAllFrame(toScreen(at), camera.zoom, at, screen);
        return { domId: POPOVER_ID, position: { x: frame.clip.x, y: frame.clip.y }, schema: popoverSchema(shown, at, frame, dragging !== null) };
    };

    const close = async () => {
        if (!content) return;
        content = null;
        pane = null;
        dragging = null;
        const subs = watching;
        watching = null;
        await ddp.tryCall("command:dom:remove-floating-element", { domId: POPOVER_ID });
        for (const id of subs ? await subs : []) await ddp.tryCall("command:subscription:remove", { subscriptionId: id });
    };

    // Opening, replacing and closing run one at a time, so a page that took longer to open never lands over a newer one.
    const queue = serial();

    /**
     * Opens Read all readable: when the zoom is outside 0.8 to 1, or the
     * card's right 240 and the pane don't fit the usable view, the camera
     * first flies to them (`readAllCamera`). A new page for the card
     * already shown keeps the pane where it is, dragged or not.
     */
    const show = async (card: Rect, next: PopoverContent) => {
        const wanted = readAllRect(card, next.height(VIEW.readAll.width));
        const kept = content?.pin === next.pin ? pane : null;
        const at = kept ? { ...kept, height: wanted.height } : wanted;
        if (!kept) {
            const [size, viewport] = await Promise.all([screenOf(ddp), viewportOf(ddp)]);
            const flight = readAllCamera(card, wanted, size, viewport);
            if (flight) {
                await fly(ddp, flight);
                await sleep(VIEW.flightMs + 20);
            }
        }
        if (!(await learn(at))) return;
        // Overlay, not Drawdy's popover kind: that one stays where it first opened, and avoids collisions.
        await ddp.call("command:dom:upsert-floating-element", { ...placement(next, at), barrierDismissible: false, asPopover: false });
        content = next;
        pane = at;
        watching ??= Promise.all([ddp.tryCall("subscription:camera:moved-rapid"), ddp.tryCall("subscription:dom:screen-resized")]).then((subs) =>
            subs.flatMap((s) => (s ? [s.subscriptionId] : []))
        );
    };

    // Camera moves and drags come many times a second: one placement at a time, then one more with the latest state.
    let drawing = false;
    let dirty = false;
    const redraw = () => {
        dirty = true;
        if (drawing) return;
        drawing = true;
        void (async () => {
            while (dirty && content && pane) {
                dirty = false;
                const placed = await ddp.tryCall("command:dom:update-floating-element", placement(content, pane));
                // Gone from the page: Drawdy reloaded the extension, say.
                if (placed === null) void queue(close);
            }
            drawing = false;
        })();
    };

    const follow = (next: CameraAt) => {
        if (!content) return;
        camera = next;
        redraw();
    };

    /** A drag moves the pane on the board with the pointer; while it lasts, its header stays where it can be grabbed again (`dragLimit`). */
    const drag = (event: Drag) => {
        if (!content || !pane || event.domElementId !== DRAG_HANDLE) return;
        const pointer = event.position.canvasSpace;
        if (event.type === "dragStart") dragging = { from: pointer, at: { x: pane.x, y: pane.y } };
        if (!dragging) return;
        const zoom = camera.zoom;
        const wanted = toScreen({ x: dragging.at.x + pointer.x - dragging.from.x, y: dragging.at.y + pointer.y - dragging.from.y });
        const kept = dragLimit(wanted, { width: (pane.width - VIEW.readAll.close) * zoom, height: VIEW.readAll.header * zoom }, screen);
        pane = { ...pane, x: (kept.x - offset.x - camera.x) / zoom, y: (kept.y - offset.y - camera.y) / zoom };
        if (event.type === "dragEnd") dragging = null;
        redraw();
    };

    const resize = (next: Screen) => {
        screen = next;
        if (content) redraw();
    };

    return { open: (card, next) => queue(() => show(card, next)), follow, drag, resize, close: () => queue(close), shown: () => content };
};
