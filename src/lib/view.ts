/**
 * Where the camera goes and where Read all opens, as pure functions of the
 * screen: the driver measures, these decide.
 *
 * The usable view is the screen minus Drawdy's toolbar on top and the
 * PR Blackboard panel's strip on the right. Drawdy's minimap covers its
 * bottom-left corner, so the current card keeps clear of that too.
 */

import { clamp } from "./fp.ts";
import { union, type Rect } from "./layout.ts";

export const VIEW = {
    toolbar: 64,
    /** The panel's strip on the right, as measured on drawdy.io: Drawdy's 58 px button rail, the 320 px panel and a margin. */
    panel: 392,
    /** Drawdy's minimap in the bottom-left corner, as measured on drawdy.io, with a 24 px margin. */
    minimap: { width: 196, height: 168 },
    /** Canvas room kept on each side of a card framed alone, while zoom allows. */
    room: 160,
    /** Screen room kept around what the camera frames. */
    margin: 24,
    /** Code is 12.5 px on a card, so the camera never goes further out than this. */
    minZoom: 0.8,
    maxZoom: 1,
    flightMs: 450,
    readAll: { gap: 24, minWidth: 520, maxWidth: 720, maxHeight: 640, keep: 240, edge: 12 },
} as const;

export type Screen = { width: number; height: number };
export type Camera = { rect: Rect; zoom: number };

/** The usable view, in screen pixels. */
export const usable = (screen: Screen): Rect => ({ x: 0, y: VIEW.toolbar, width: Math.max(1, screen.width - VIEW.panel), height: Math.max(1, screen.height - VIEW.toolbar) });

/**
 * The canvas rect to fly to so that, at `zoom`, the usable view's top-left
 * corner shows canvas point (`x`, `y`). Its shape is the screen's, so
 * fitting it lands exactly on that zoom.
 */
const screenRect = (screen: Screen, zoom: number, x: number, y: number): Rect => ({
    x,
    y: y - VIEW.toolbar / zoom,
    width: screen.width / zoom,
    height: screen.height / zoom,
});

/** The zoom at which `r` fits the usable view with `VIEW.margin` around it, at most 1. */
const fitZoom = (r: Rect, view: Rect) => Math.min(VIEW.maxZoom, (view.width - 2 * VIEW.margin) / r.width, (view.height - 2 * VIEW.margin) / r.height);

/** Where a frame `size` long may start and still hold the stretch from `start`, `length` long, whole with `margin`. */
const range = (start: number, length: number, size: number, margin: number) => ({ lo: start + length + margin - size, hi: start - margin });
const within = (v: number, r: { lo: number; hi: number }) => clamp(v, r.lo, r.hi);

/** The canvas point at the usable view's top-left corner, and the zoom. */
type Frame = { x: number; y: number; zoom: number };

/** How much of `card`, in canvas units squared, the minimap covers in `frame`. */
const covered = (card: Rect, frame: Frame, view: Rect) => {
    const w = VIEW.minimap.width / frame.zoom;
    const bottom = frame.y + view.height / frame.zoom;
    const top = bottom - VIEW.minimap.height / frame.zoom;
    const across = Math.min(card.x + card.width, frame.x + w) - Math.max(card.x, frame.x);
    const down = Math.min(card.y + card.height, bottom) - Math.max(card.y, top);
    return across > 1e-6 && down > 1e-6 ? across * down : 0;
};

/**
 * Moves `frame` the least it takes for the minimap to clear `card`: the
 * card goes right or up, `keep` staying whole. When neither clears it,
 * the move that leaves the least of the card covered. A card whose top
 * stays under the toolbar (`topFixed`) only goes right.
 */
const clearOfMinimap = (frame: Frame, card: Rect, keep: Rect, view: Rect, topFixed: boolean): Frame => {
    if (covered(card, frame, view) === 0) return frame;
    const margin = VIEW.margin / frame.zoom;
    const width = view.width / frame.zoom;
    const height = view.height / frame.zoom;
    const right = { ...frame, x: within(card.x - VIEW.minimap.width / frame.zoom, range(keep.x, keep.width, width, margin)) };
    const up = { ...frame, y: within(card.y + card.height - height + VIEW.minimap.height / frame.zoom, range(keep.y, keep.height, height, margin)) };
    const moved = (f: Frame) => Math.abs(f.x - frame.x) + Math.abs(f.y - frame.y);
    return (topFixed ? [right] : [right, up]).sort((a, b) => covered(card, a, view) - covered(card, b, view) || moved(a) - moved(b))[0];
};

const cameraOf = (screen: Screen, frame: Frame): Camera => ({ rect: screenRect(screen, frame.zoom, frame.x, frame.y), zoom: frame.zoom });

/** The frame that centres `r` in the usable view at `zoom`. */
const centred = (r: Rect, view: Rect, zoom: number): Frame => ({ x: r.x - (view.width / zoom - r.width) / 2, y: r.y - (view.height / zoom - r.height) / 2, zoom });

/** Whether `r` shows whole in the usable part of `viewport`, at zoom 0.8 or closer, clear of the minimap. */
const shows = (r: Rect, screen: Screen, viewport: Rect) => {
    const zoom = screen.width / viewport.width;
    const view = usable(screen);
    return (
        zoom >= VIEW.minZoom - 1e-6 &&
        r.x >= viewport.x &&
        r.x + r.width <= viewport.x + view.width / zoom &&
        r.y >= viewport.y + VIEW.toolbar / zoom &&
        r.y + r.height <= viewport.y + viewport.height &&
        covered(r, { x: viewport.x, y: viewport.y + VIEW.toolbar / zoom, zoom }, view) === 0
    );
};

/**
 * The camera for a step, or null when the card already shows whole at zoom
 * 0.8 or closer, clear of the minimap. Two rules, in turn:
 *
 * 1. The card and the cards its drawn strings join (`linked`), framed
 *    together, when they fit at zoom 0.8 or closer and the card can clear
 *    the minimap with all of them still whole.
 * 2. The card alone, at the largest zoom from 0.8 to 1 that leaves 160 of
 *    room each side; when none does, the room shrinks until the card fits
 *    at 0.8. A card is centred when shorter than the view, else its top
 *    sits 24 px below the toolbar. Then the frame moves, as little as it
 *    can, to take in the names of the joined cards (`names`), nearest
 *    first, each one that fits with the card at zoom 0.8 or closer. When
 *    the nearest doesn't fit, the frame still moves toward it as far as
 *    the card, kept whole, allows.
 *
 * Last, the frame moves back the least it takes for the minimap to clear
 * the card, which wins over the names.
 */
export const stepCamera = (card: Rect, screen: Screen, viewport: Rect | null, linked: readonly Rect[] = [], names: readonly Rect[] = []): Camera | null => {
    if (viewport && shows(card, screen, viewport)) return null;
    const view = usable(screen);
    const group = union([card, ...linked]);
    if (linked.length > 0 && fitZoom(group, view) >= VIEW.minZoom) {
        const frame = clearOfMinimap(centred(group, view, fitZoom(group, view)), card, group, view, false);
        if (covered(card, frame, view) === 0) return cameraOf(screen, frame);
    }
    let zoom = clamp(Math.min(view.width / (card.width + 2 * VIEW.room), (view.height - 2 * VIEW.margin) / card.height), VIEW.minZoom, VIEW.maxZoom);
    const tall = card.height * zoom > view.height - 2 * VIEW.margin;
    const room = { width: view.width - 2 * VIEW.margin, height: view.height - 2 * VIEW.margin };
    // A tall card keeps its top under the toolbar, so a name counts only within the stretch of the card in view.
    const fits = (r: Rect, z: number) => r.width * z <= room.width + 1e-6 && (tall ? r.y >= card.y && r.y + r.height <= card.y + room.height / z : r.height * z <= room.height + 1e-6);
    const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    const distance = (r: Rect) => Math.hypot(centre(r).x - centre(card).x, centre(r).y - centre(card).y);
    let shown = card;
    const left: Rect[] = [];
    for (const name of [...names].sort((a, b) => distance(a) - distance(b))) {
        const wanted = union([shown, name]);
        const z = Math.min(zoom, room.width / wanted.width, tall ? Infinity : room.height / wanted.height);
        if (z < VIEW.minZoom - 1e-6 || !fits(wanted, z)) {
            left.push(name);
            continue;
        }
        shown = wanted;
        zoom = z;
    }
    const width = view.width / zoom;
    const height = view.height / zoom;
    const margin = VIEW.margin / zoom;
    // A name that doesn't fit still draws the frame its way, as far as the card and the names in view allow.
    const nearest = left[0];
    const keepX = range(shown.x, shown.width, width, margin);
    let x = within(card.x - (width - card.width) / 2, keepX);
    if (nearest) x = within(within(x, range(nearest.x, nearest.width, width, margin)), keepX);
    let y = card.y - margin;
    if (!tall) {
        const keepY = range(shown.y, shown.height, height, margin);
        y = within(card.y - (height - card.height) / 2, keepY);
        if (nearest) y = within(within(y, range(nearest.y, nearest.height, height, margin)), keepY);
    }
    return cameraOf(screen, clearOfMinimap({ x, y, zoom }, card, card, view, tall));
};

/** The overview: the whole review, centred at the zoom that fits it, at most 1. */
export const overviewCamera = (bounds: Rect, screen: Screen): Camera => {
    const view = usable(screen);
    return cameraOf(screen, centred(bounds, view, fitZoom(bounds, view)));
};

/** The camera that keeps `zoom` and moves the view `pan` screen pixels to the right. */
export const panned = (viewport: Rect, pan: number, zoom: number): Camera => ({
    rect: { ...viewport, x: viewport.x + pan / zoom },
    zoom,
});

export type ReadAllSpot = { x: number; y: number; width: number; height: number; pan: number };

/**
 * Where Read all opens, in screen pixels, for a card at `card` on screen:
 * always to its right, 24 px off, top level with the card, as tall as its
 * page lays out at the width it gets (`pageHeight`), up to 640 or the view
 * less 48, past which the page scrolls. When there isn't room, `pan` says
 * how far the camera must first move left (keeping zoom), which is never
 * further than leaves the card's right 240 px showing.
 */
export const placeReadAll = (card: { left: number; right: number; top: number }, screen: Screen, pageHeight: (width: number) => number): ReadAllSpot => {
    const R = VIEW.readAll;
    const view = usable(screen);
    let width = clamp(view.width - 260, R.minWidth, R.maxWidth);
    const limit = view.x + view.width;
    const wanted = card.right + R.gap;
    const pan = Math.round(Math.max(0, Math.min(wanted + width - limit, card.right - R.keep)));
    const x = wanted - pan;
    if (x + width > limit) width = Math.max(R.minWidth, limit - x);
    const height = Math.min(R.maxHeight, view.height - 48, Math.ceil(pageHeight(width)));
    const y = clamp(card.top, view.y + R.edge, Math.max(view.y + R.edge, screen.height - height - R.edge));
    return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height), pan };
};
