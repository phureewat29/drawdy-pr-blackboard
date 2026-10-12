/**
 * Where the camera goes, and where Read all sits on the board and on
 * screen, as pure functions: the driver measures, these decide.
 *
 * The usable view is the screen minus Drawdy's toolbar on top and the
 * PR Blackboard panel's strip on the right. Drawdy's minimap covers its
 * bottom-left corner, so the current card keeps clear of that too.
 */

import { clamp, sortBy } from "./fp.ts";
import { union, type Point, type Rect, type Size } from "./layout/geometry.ts";

/**
 * The view's measures, in screen px but for `room` and `readAll`, in canvas
 * units. Documented here rather than on each field, as `LAYOUT` is.
 *
 * - `panel`: the panel's strip on the right, as measured on drawdy.io:
 *   Drawdy's 58 px button rail, the 320 px panel and a margin.
 * - `minimap`: Drawdy's minimap in the bottom-left corner, as measured on
 *   drawdy.io, with a 24 px margin.
 * - `room`: kept on each side of a card framed alone, while zoom allows.
 * - `margin`: kept around what the camera frames.
 * - `minZoom`: code is 12.5 px on a card, so the camera never goes further
 *   out than this.
 * - `readAll`: Read all on the board, `gap` right of its card, `width` wide,
 *   as tall as its page up to `maxHeight`; it opens with the card's right
 *   `keep` in view. Its header, `header` high less the `close` room for `✕`
 *   on its right, is the drag handle, and a drag leaves at least `grip` px
 *   of it on screen.
 */
export const VIEW = {
    toolbar: 64,
    panel: 392,
    minimap: { width: 196, height: 168 },
    room: 160,
    margin: 24,
    minZoom: 0.8,
    maxZoom: 1,
    flightMs: 450,
    readAll: { gap: 24, width: 720, maxHeight: 640, keep: 240, header: 56, close: 56, grip: 120 },
} as const;

export type Screen = { width: number; height: number };
export type Camera = { rect: Rect; zoom: number };

/** Slack for rounding in zoom and size comparisons. */
const EPSILON = 1e-6;

/** The usable view, in screen pixels. */
export const usable = (screen: Screen): Rect => ({ x: 0, y: VIEW.toolbar, width: Math.max(1, screen.width - VIEW.panel), height: Math.max(1, screen.height - VIEW.toolbar) });

/** The canvas point at the usable view's top-left corner, and the zoom. */
type Frame = { x: number; y: number; zoom: number };

/**
 * The canvas rect to fly to so that, at its zoom, the usable view's top-left
 * corner shows the frame's point. Its shape is the screen's, so fitting it
 * lands exactly on that zoom.
 */
const cameraOf = (screen: Screen, { x, y, zoom }: Frame): Camera => ({
    rect: { x, y: y - VIEW.toolbar / zoom, width: screen.width / zoom, height: screen.height / zoom },
    zoom,
});

/** The zoom at which `r` fits the usable view with `VIEW.margin` around it, at most 1. */
const fitZoom = (r: Rect, view: Rect) => Math.min(VIEW.maxZoom, (view.width - 2 * VIEW.margin) / r.width, (view.height - 2 * VIEW.margin) / r.height);

/** The frame that centres `r` in the usable view at `zoom`. */
const centred = (r: Rect, view: Rect, zoom: number): Frame => ({ x: r.x - (view.width / zoom - r.width) / 2, y: r.y - (view.height / zoom - r.height) / 2, zoom });

/** Where a frame `size` long may start and still hold the stretch from `start`, `length` long, whole with `margin`. */
const range = (start: number, length: number, size: number, margin: number) => ({ lo: start + length + margin - size, hi: start - margin });
const within = (v: number, r: { lo: number; hi: number }) => clamp(v, r.lo, r.hi);

/** How much of `card`, in canvas units squared, the minimap covers in `frame`. */
const covered = (card: Rect, frame: Frame, view: Rect) => {
    const w = VIEW.minimap.width / frame.zoom;
    const bottom = frame.y + view.height / frame.zoom;
    const top = bottom - VIEW.minimap.height / frame.zoom;
    const across = Math.min(card.x + card.width, frame.x + w) - Math.max(card.x, frame.x);
    const down = Math.min(card.y + card.height, bottom) - Math.max(card.y, top);
    return across > EPSILON && down > EPSILON ? across * down : 0;
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

/** Whether `r` lies whole in the usable part of `viewport`, the canvas rect the screen shows. */
const inView = (r: Rect, screen: Screen, viewport: Rect): boolean => {
    const zoom = screen.width / viewport.width;
    return r.x >= viewport.x && r.x + r.width <= viewport.x + usable(screen).width / zoom && r.y >= viewport.y + VIEW.toolbar / zoom && r.y + r.height <= viewport.y + viewport.height;
};

/** Whether `r` shows whole in the usable view, at zoom 0.8 or closer, clear of the minimap. */
const shows = (r: Rect, screen: Screen, viewport: Rect) => {
    const zoom = screen.width / viewport.width;
    return zoom >= VIEW.minZoom - EPSILON && inView(r, screen, viewport) && covered(r, { x: viewport.x, y: viewport.y + VIEW.toolbar / zoom, zoom }, usable(screen)) === 0;
};

/** Rule 1: the card and the cards its strings join (`linked`), framed together, when they fit at 0.8 or closer and the card clears the minimap. */
const groupFrame = (card: Rect, linked: readonly Rect[], view: Rect): Frame | null => {
    const group = union([card, ...linked]);
    if (linked.length > 0 && fitZoom(group, view) >= VIEW.minZoom) {
        const frame = clearOfMinimap(centred(group, view, fitZoom(group, view)), card, group, view, false);
        if (covered(card, frame, view) === 0) return frame;
    }
    return null;
};

/**
 * Rule 2's zoom: the largest from 0.8 to 1 that leaves `VIEW.room` each
 * side of the card, else the room shrinks until the card fits at 0.8. Then
 * the names of the joined cards, nearest first, each one that fits with the
 * card at 0.8 or closer. A tall card keeps its top under the toolbar, so a
 * name counts only within the stretch of the card in view.
 */
const takeInNames = (card: Rect, names: readonly Rect[], view: Rect) => {
    let zoom = clamp(Math.min(view.width / (card.width + 2 * VIEW.room), (view.height - 2 * VIEW.margin) / card.height), VIEW.minZoom, VIEW.maxZoom);
    const tall = card.height * zoom > view.height - 2 * VIEW.margin;
    const room = { width: view.width - 2 * VIEW.margin, height: view.height - 2 * VIEW.margin };
    const fits = (r: Rect, z: number) => r.width * z <= room.width + EPSILON && (tall ? r.y >= card.y && r.y + r.height <= card.y + room.height / z : r.height * z <= room.height + EPSILON);
    const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    const distance = (r: Rect) => Math.hypot(centre(r).x - centre(card).x, centre(r).y - centre(card).y);
    let shown = card;
    const left: Rect[] = [];
    for (const name of sortBy(names, distance)) {
        const wanted = union([shown, name]);
        const z = Math.min(zoom, room.width / wanted.width, tall ? Infinity : room.height / wanted.height);
        if (z < VIEW.minZoom - EPSILON || !fits(wanted, z)) {
            left.push(name);
            continue;
        }
        shown = wanted;
        zoom = z;
    }
    return { zoom, tall, shown, nearestLeft: left[0] as Rect | undefined };
};

/**
 * Rule 2's frame: the card centred when shorter than the view, else its top
 * `VIEW.margin` below the toolbar, moved as little as it takes to show
 * `shown`, the card and the names taken in. A name left out still draws the
 * frame its way, as far as those allow.
 */
const cardFrame = (card: Rect, view: Rect, { zoom, tall, shown, nearestLeft }: ReturnType<typeof takeInNames>): Frame => {
    const width = view.width / zoom;
    const height = view.height / zoom;
    const margin = VIEW.margin / zoom;
    const keepX = range(shown.x, shown.width, width, margin);
    let x = within(card.x - (width - card.width) / 2, keepX);
    if (nearestLeft) x = within(within(x, range(nearestLeft.x, nearestLeft.width, width, margin)), keepX);
    let y = card.y - margin;
    if (!tall) {
        const keepY = range(shown.y, shown.height, height, margin);
        y = within(card.y - (height - card.height) / 2, keepY);
        if (nearestLeft) y = within(within(y, range(nearestLeft.y, nearestLeft.height, height, margin)), keepY);
    }
    return { x, y, zoom };
};

/**
 * The camera for a step, or null when the card already shows whole at zoom 0.8 or closer, clear of the minimap: rule 1 when it
 * holds, else rule 2; last, the frame moves back the least it takes for the minimap to clear the card, which wins over the names.
 */
export const stepCamera = (card: Rect, screen: Screen, viewport: Rect | null, linked: readonly Rect[] = [], names: readonly Rect[] = []): Camera | null => {
    if (viewport && shows(card, screen, viewport)) return null;
    const view = usable(screen);
    const group = groupFrame(card, linked, view);
    if (group) return cameraOf(screen, group);
    const taken = takeInNames(card, names, view);
    return cameraOf(screen, clearOfMinimap(cardFrame(card, view, taken), card, card, view, taken.tall));
};

/** The overview: `bounds` centred at the zoom that fits it, at most 1. */
export const overviewCamera = (bounds: Rect, screen: Screen): Camera => {
    const view = usable(screen);
    return cameraOf(screen, centred(bounds, view, fitZoom(bounds, view)));
};

/** What the overview frames: the code cards whole, and the PR card down to the lowest code card, so a long description runs on below. */
export const overviewBounds = (code: readonly Rect[], pr: Rect | null): Rect | null => {
    if (code.length === 0) return pr;
    const bounds = union(code);
    return pr ? union([bounds, { ...pr, height: clamp(bounds.y + bounds.height - pr.y, 0, pr.height) }]) : bounds;
};

/** Read all on the board, in canvas units, as tall as its page. */
export const readAllRect = (card: Rect, pageHeight: number): Rect => ({
    x: card.x + card.width + VIEW.readAll.gap,
    y: card.y,
    width: VIEW.readAll.width,
    height: Math.min(VIEW.readAll.maxHeight, Math.ceil(pageHeight)),
});

/**
 * The camera that makes Read all readable as it opens, or null when it is: zoom 0.8 to 1, the card's right `keep` and the pane whole
 * in view. Else both are centred at the largest zoom from 0.8 to 1 that fits them; when not even 0.8 does, their top-left shows.
 */
export const readAllCamera = (card: Rect, pane: Rect, screen: Screen, viewport: Rect | null): Camera | null => {
    const keep = Math.min(VIEW.readAll.keep, card.width);
    const wanted = union([{ x: card.x + card.width - keep, y: card.y, width: keep, height: Math.min(card.height, pane.height) }, pane]);
    if (viewport) {
        const zoom = screen.width / viewport.width;
        if (inView(wanted, screen, viewport) && zoom >= VIEW.minZoom - EPSILON && zoom <= VIEW.maxZoom + EPSILON) return null;
    }
    const view = usable(screen);
    const zoom = clamp(fitZoom(wanted, view), VIEW.minZoom, VIEW.maxZoom);
    const frame = centred(wanted, view, zoom);
    const margin = VIEW.margin / zoom;
    return cameraOf(screen, {
        x: wanted.width * zoom > view.width - 2 * VIEW.margin ? wanted.x - margin : frame.x,
        y: wanted.height * zoom > view.height - 2 * VIEW.margin ? wanted.y - margin : frame.y,
        zoom,
    });
};

/**
 * Read all as Drawdy draws it: clipped to the usable view, so it never covers the toolbar or the panel, laid out `size` large and
 * scaled by `zoom` with its top-left at `at`. CSS scales a box about its middle, so the translation makes up for that.
 */
export const readAllFrame = (at: Point, zoom: number, size: Size, screen: Screen): { clip: Rect; transform: string } => {
    const clip = usable(screen);
    const tx = Math.round((at.x - clip.x - (size.width / 2) * (1 - zoom)) * 100) / 100;
    const ty = Math.round((at.y - clip.y - (size.height / 2) * (1 - zoom)) * 100) / 100;
    return { clip, transform: `translate(${tx}px, ${ty}px) scale(${Math.round(zoom * 1e4) / 1e4})` };
};

/**
 * Where a dragged Read all's top-left may go, its header `header` large on screen: the header's top no higher than the toolbar's
 * foot, its bottom on screen, and `grip` px of it clear of the panel and the screen's left edge, so it can be grabbed again.
 */
export const dragLimit = (at: Point, header: Size, screen: Screen): Point => {
    const view = usable(screen);
    const grip = VIEW.readAll.grip;
    return {
        x: clamp(at.x, grip - header.width, view.x + view.width - grip),
        y: clamp(at.y, view.y, screen.height - header.height),
    };
};
