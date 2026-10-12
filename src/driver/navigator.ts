/**
 * Moving around a review on the board: the current card, the steps in board order, following links and Read all.
 * Nothing on the board changes when the reader moves; the camera and the panel show where they are.
 *
 * The board works on its own: each card's mark holds its name, size and fold rows, and each string's its kind,
 * both cards and colour, so fold rows and strings need no review and no GitHub request. The review (the panel's,
 * or loaded when Read all first opens) adds the steps, every link drawn or not, and Read all's pages.
 */

import type { ModuleStyling } from "@drawdy/driver-protocol";
import { foldAt, nameRect, readAllMessage, readAllOf, type Theme } from "../lib/card.ts";
import { distanceToPath } from "../lib/curve.ts";
import { isDefined } from "../lib/fp.ts";
import { prKey } from "../lib/github.ts";
import { stepsOf, type Point, type Rect } from "../lib/layout.ts";
import type { Pin, Review } from "../lib/model.ts";
import { overviewBounds, overviewCamera, stepCamera } from "../lib/view.ts";
import { indexOf, readBoard, readClicked, rectsOf, type BoardRef, type Clicked, type Index } from "./board.ts";
import { fly, screenOf, viewportOf } from "./camera.ts";
import type { Ddp } from "./ddp.ts";
import type { Popover, PopoverContent } from "./read-all.ts";

export type Navigator = {
    /** The board being read, once anything on it is current or loaded. */
    board: () => BoardRef | null;
    review: () => Review | null;
    /** Sets the board from the panel: its index and its review, or nothing. */
    set: (index: Index | null, review?: Review | null) => void;
    /** Adds the review of the board being read, once it has loaded. */
    attach: (review: Review) => void;
    /** Reads the board's marks again after cards were deleted or brought back. False when none is left. */
    refresh: () => Promise<boolean>;
    /** Reads the board's marks when they haven't been read yet: the panel names each link in its string's colour. */
    readMarks: () => Promise<void>;
    /** A drawn string's colour, by index into `STRING_COLOURS`; null for a link with no string. */
    colourOf: (link: string) => number | null;
    /** The current card's step, or -1: none yet, no review, the PR card or a context card, which are not steps. */
    current: () => number;
    currentPin: () => string | null;
    /** Whether Previous and Next have a step to go to, skipping context and deleted cards. */
    hasPrevious: () => boolean;
    hasNext: () => boolean;
    /** Makes a card current; with `fly`, the camera goes to it. Clicks on the board don't fly. */
    focus: (pin: string, fly?: boolean) => Promise<void>;
    next: () => Promise<void>;
    previous: () => Promise<void>;
    overview: () => Promise<void>;
    /** The PR card current, and the camera on it. */
    description: () => Promise<void>;
    /** A new board's landing: the PR card current, then one flight to the overview. */
    land: () => Promise<void>;
    /** Follows a link from the current card to its far card. */
    follow: (link: string) => Promise<void>;
    /** Opens Read all for the current card, at head line `line` or at the first change. */
    readAll: (line?: number | null) => Promise<void>;
    /** Follows a click on the board. False when no clicked element is PR Blackboard's. */
    click: (ids: readonly string[], at: Point) => Promise<boolean>;
    closePopover: () => Promise<void>;
};

/** How near a click must come to a string to count, in screen pixels. */
const STRING_REACH = 10;
/** Read all says `Reading the PR…` only when the review takes longer than this to load. */
const LOADING_AFTER_MS = 150;

export type NavigatorDeps = {
    ddp: Ddp;
    popover: Popover;
    styling: () => ModuleStyling;
    changed: () => void;
    /** The review of a board: this device's copy, else GitHub's. Rejects when it can't be had. */
    loadReview: (key: string, sha: string) => Promise<Review>;
    /** A failure, in the panel's words. */
    explain: (err: unknown) => string;
};

export const createNavigator = (deps: NavigatorDeps): Navigator => {
    const { ddp, popover, styling, changed } = deps;
    let board: BoardRef | null = null;
    let index: Index | null = null;
    let review: Review | null = null;
    let current: string | null = null;

    const pinOf = (id: string): Pin | undefined => review?.pins.find((p) => p.id === id);
    /** The cards' theme; Drawdy's own when the PR card that records it is gone. */
    const theme = (): Theme => index?.theme ?? styling().theme;

    /** Moves to another board: what is known of the one before is dropped. */
    const switchTo = async (key: string, sha: string) => {
        if (board?.key === key && board.sha === sha) return;
        board = { key, sha };
        index = null;
        current = null;
        if (review && !(review.pr.headSha === sha && prKey(review.pr.ref) === key)) review = null;
        await popover.close();
    };

    /** The board's index, read from its marks the first time it's needed, and again when it lacks `id`. */
    const ensureIndex = async (id?: string): Promise<Index | null> => {
        if (!board) return null;
        if (index && (!id || index.targets.has(id))) return index;
        index = indexOf(board.key, board.sha, (await readBoard(ddp)).get(board.key) ?? []);
        return index;
    };

    /** Where a card is now. */
    const liveCard = async (pin: string): Promise<Rect | null> => {
        const el = index?.pins.get(pin);
        if (!el) return null;
        return (await rectsOf(ddp, [el.id])).get(el.id) ?? null;
    };

    /** Flies to a card and, where they fit, the cards its strings join, or at least their names. */
    const camera = async (pin: string) => {
        const idx = index;
        const rect = await liveCard(pin);
        if (!rect || !idx) return;
        const far = [...idx.links.values()]
            .filter((l) => l.from === pin || l.to === pin)
            .map((l) => idx.pins.get(l.from === pin ? l.to : l.from))
            .filter(isDefined);
        const [screen, viewport, linked] = await Promise.all([screenOf(ddp), viewportOf(ddp), rectsOf(ddp, far.map((el) => el.id))]);
        const names = far.flatMap((el) => {
            const r = linked.get(el.id);
            return r ? [nameRect(r, el.name, el.height > 0 ? r.height / el.height : 1)] : [];
        });
        const target = stepCamera(rect, screen, viewport, [...linked.values()], names);
        if (target) await fly(ddp, target);
    };

    const focus = async (pin: string, flies = false) => {
        if (!index?.pins.has(pin) && !pinOf(pin)) return;
        current = pin;
        changed();
        if (flies) await camera(pin);
    };

    /** The next card in board order that is a step and still on the board: from the PR card, the first. */
    const stepAfter = (delta: 1 | -1): string | null => {
        if (!review || !index) return null;
        const order = review.order;
        const steps = new Set(stepsOf(review));
        const isStep = (id: string) => steps.has(id) && index!.pins.has(id);
        const at = current ? order.indexOf(current) : -1;
        if (at < 0) return delta === 1 ? (order.find(isStep) ?? null) : null;
        for (let i = at + delta; i >= 0 && i < order.length; i += delta) if (isStep(order[i])) return order[i];
        return null;
    };

    /**
     * Before PR Blackboard moves the reader, Drawdy's selection goes: a card left selected would be a second "you are
     * here" that disagrees with the camera, and its toolbar would cover the card flown to.
     */
    const deselect = () => ddp.tryCall("command:scene:clear-selection");

    /** Read all closes, the selection goes, and the camera flies to `pin`, now current. */
    const moveTo = async (pin: string) => {
        await popover.close();
        await deselect();
        await focus(pin, true);
    };

    const step = async (delta: 1 | -1) => {
        const pin = stepAfter(delta);
        if (pin) await moveTo(pin);
    };

    const follow = async (linkId: string, from: string | null = current) => {
        const idx = await ensureIndex();
        const link = idx?.links.get(linkId) ?? review?.links.find((l) => l.id === linkId);
        if (!link || !idx) return;
        const target = from === link.from ? link.to : from === link.to ? link.from : link.to;
        if (idx.pins.has(target)) await moveTo(target);
    };

    /**
     * Loads the review for Read all on `pin`, saying `Reading the PR…` when it takes a while, and why when it fails.
     * True when the page can open: the reader is still on `pin`.
     */
    const loadForReadAll = async (wanted: BoardRef, pin: string, at: Rect, message: (text: string) => PopoverContent): Promise<boolean> => {
        const waiting = message("Reading the PR…");
        let shown: Promise<void> | null = null;
        const late = setTimeout(() => {
            shown = popover.open(at, waiting);
        }, LOADING_AFTER_MS);
        // The loading page goes when the reader has moved to another card meanwhile.
        const settle = async () => {
            clearTimeout(late);
            await shown;
            if (current !== pin && popover.shown() === waiting) await popover.close();
        };
        try {
            const loaded = await deps.loadReview(wanted.key, wanted.sha);
            if (board === wanted) attach(loaded);
        } catch (err) {
            await settle();
            if (current === pin) await popover.open(at, message(deps.explain(err)));
            return false;
        }
        await settle();
        return current === pin;
    };

    /** Read all for a card, at head line `line` or the first change, beside the card's rect. */
    const openReadAll = async (pin: string, line: number | null, rect?: Rect | null) => {
        if (pin === "pr") return;
        const idx = await ensureIndex();
        const at = rect ?? (await liveCard(pin));
        if (!at || !board) return;
        const name = idx?.pins.get(pin)?.name ?? pinOf(pin)?.name ?? "";
        const message = (text: string): PopoverContent => ({ ...readAllMessage(name, text, theme()), theme: theme(), pin });
        if (!review && !(await loadForReadAll(board, pin, at, message))) return;
        const p = pinOf(pin);
        if (!p || !review) return;
        await popover.open(at, { ...readAllOf(p, review, theme(), line), theme: theme(), pin });
    };

    /** How far down a clicked card a point is, in the card's own units: a resized card scales, it does not reflow. */
    const localY = (c: Clicked, y: number): number => (y - c.rect.y) * ((c.mark.height ?? c.rect.height) / (c.rect.height || 1));

    /** A click on a card makes it current, and on a fold row opens Read all there; Read all on another card closes. */
    const clickCard = async (card: Clicked, at: Point) => {
        const { pr, sha, folds } = card.mark;
        const pin = card.mark.pin!;
        await switchTo(pr, sha);
        if (pin !== current) await popover.close();
        current = pin;
        changed();
        const fold = foldAt(folds ?? [], localY(card, at.y));
        if (!fold) return;
        // A fold row reads like a link: the card it selected goes, and so does its toolbar over the board.
        await deselect();
        await openReadAll(pin, fold[1] || null, card.rect);
    };

    /** A click lands in a string's box; it counts only near the curve itself. */
    const missesCurve = async (string: Clicked, at: Point): Promise<boolean> => {
        const info = await ddp.tryCall("command:camera:get-info");
        return !string.path || distanceToPath(at, string.path) > STRING_REACH / (info?.zoom ?? 1);
    };

    /** A click on the board, from its one read of the clicked elements. A label, or a click near a string's curve, follows the string. */
    const click = async (ids: readonly string[], at: Point): Promise<boolean> => {
        const clicked = await readClicked(ddp, ids);
        if (clicked.length === 0) return false;
        const card = clicked.find((c) => c.mark.part === "pr" || c.mark.part === "pin");
        if (card?.mark.pin) {
            await clickCard(card, at);
            return true;
        }
        const label = clicked.find((c) => c.mark.part === "label");
        const string = clicked.find((c) => c.mark.part === "link");
        const hit = label ?? string;
        if (!hit?.mark.link) return true;
        if (!label && string && (await missesCurve(string, at))) return true;
        await switchTo(hit.mark.pr, hit.mark.sha);
        await ensureIndex(hit.id);
        await follow(hit.mark.link);
        return true;
    };

    /**
     * The whole board: the code cards whole, and the PR card from its top down to the lowest code card, so a long
     * description runs on below. The current card stays. The union comes from each card's own rect: Drawdy's
     * `query-combined-rect` takes only the top-left corner of every component after the first.
     */
    const overview = async () => {
        const idx = await ensureIndex();
        if (!idx) return;
        await popover.close();
        await deselect();
        const [rects, screen] = await Promise.all([rectsOf(ddp, [...idx.pins.values()].map((p) => p.id)), screenOf(ddp)]);
        const code = [...idx.pins].flatMap(([pin, el]) => (pin === "pr" ? [] : [rects.get(el.id)].filter((r): r is Rect => r !== undefined)));
        const prEl = idx.pins.get("pr");
        const bounds = overviewBounds(code, (prEl && rects.get(prEl.id)) ?? null);
        if (bounds) await fly(ddp, overviewCamera(bounds, screen), 550);
    };

    const description = async () => {
        if ((await ensureIndex())?.pins.has("pr")) await moveTo("pr");
    };

    const land = async () => {
        await focus("pr");
        await overview();
    };

    const attach = (next: Review) => {
        if (!board || prKey(next.pr.ref) !== board.key || next.pr.headSha !== board.sha) return;
        review = next;
        changed();
    };

    const set = (nextIndex: Index | null, nextReview: Review | null = null) => {
        const same = board && nextIndex && board.key === nextIndex.key && board.sha === nextIndex.sha;
        board = nextIndex ? { key: nextIndex.key, sha: nextIndex.sha } : null;
        index = nextIndex;
        review = nextReview;
        if (!same) {
            current = null;
            void popover.close();
        }
        changed();
    };

    const refresh = async () => {
        if (!board) return false;
        index = indexOf(board.key, board.sha, (await readBoard(ddp)).get(board.key) ?? []);
        if (current && !index.pins.has(current)) current = null;
        changed();
        return index.pins.size > 0;
    };

    const readMarks = async () => {
        if (index || !(await ensureIndex())) return;
        changed();
    };

    return {
        board: () => board,
        review: () => review,
        set,
        attach,
        refresh,
        readMarks,
        colourOf: (link) => index?.links.get(link)?.colour ?? null,
        current: () => (review && current ? stepsOf(review).indexOf(current) : -1),
        currentPin: () => current,
        hasPrevious: () => stepAfter(-1) !== null,
        hasNext: () => stepAfter(1) !== null,
        focus,
        next: () => step(1),
        previous: () => step(-1),
        overview,
        description,
        land,
        follow: (link) => follow(link),
        readAll: async (line = null) => {
            if (current) await openReadAll(current, line);
        },
        click,
        closePopover: () => popover.close(),
    };
};
