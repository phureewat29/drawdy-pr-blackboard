import type { DriverModule, DriverSubscriptionEvent } from "@drawdy/driver-protocol";
import { chipOf, foldsOf, linkGroups, pinCard, whereOf } from "../lib/card.ts";
import { plural, serial } from "../lib/fp.ts";
import { createGithub, explainGithub, githubFailure, parsePrUrl, prKey, prLabel } from "../lib/github.ts";
import { segments } from "../lib/markdown.ts";
import { stepsOf, type Pin, type Review } from "../lib/model.ts";
import { appIcon } from "../shared/app-icon.ts";
import { projectColour } from "../shared/suggestions.ts";
import type { CurrentCard, LoadStep, PanelView } from "../shared/protocol.ts";
import { pinnedAt, readBoard, rectsOf } from "./board.ts";
import { createChannel } from "./channel.ts";
import { createDdp, protocolError } from "./ddp.ts";
import { markOf } from "./elements.ts";
import { createNavigator, indexOf } from "./navigator.ts";
import { createParser } from "./grammars.ts";
import { layOut, loadReview, type LoadStep as Step, type Progress } from "./open.ts";
import { CLOSE_BUTTON, createPopover } from "./read-all.ts";
import { createStore } from "./store.ts";
import { inWords, isInWords } from "./words.ts";

const ACTION_BUTTON_ID = "pr-blackboard:open";
const ACTION_BUTTON_SVG = appIcon(20);

export type Runtime = {
    /** Registers PR Blackboard's button and subscriptions. */
    start: () => Promise<void>;
    handle: (event: DriverSubscriptionEvent) => Promise<void>;
};

/** When to retry registering UI the user has not granted yet (see `start`). */
const REGISTER_RETRIES_MS = [800, 2000, 4000, 8000, 15000];

const NO_PERMISSION = "PR Blackboard needs permission for this. Turn it on in Extensions › PR Blackboard › Manage permissions.";
const PIN_FAILED = "Couldn't pin the board. Try again.";
const NOT_A_PR = "Only GitHub pull request links work, like github.com/owner/repo/pull/123.";

/** The loading view's steps, in the order they show, with their words before counts are known. */
const STEPS: { step: Step; label: string }[] = [
    { step: "pr", label: "Reading the pull request" },
    { step: "parser", label: "Downloading the parser" },
    { step: "files", label: "Reading the changed files" },
    { step: "pin", label: "Pinning the cards" },
];
/** Runs `step`, reporting whether it worked; failures are logged, not thrown. */
const attempt = (label: string, step: () => Promise<unknown>): Promise<boolean> =>
    step().then(
        () => true,
        (err: unknown) => {
            console.warn(`[pr-blackboard] ${label} unavailable: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    );

/** A failure, in words for the panel. */
export const explain = (err: unknown): string => {
    const github = githubFailure(err);
    if (github) return explainGithub(github);
    if (protocolError(err)?.type === "unauthorized") return NO_PERMISSION;
    if (isInWords(err)) return err.message;
    return `Something went wrong: ${err instanceof Error ? err.message : String(err)}`;
};

/** A pull request's tag for the panel: its label and its project's colour. */
const tagOf = (label: string | null): PanelView["tag"] => (label ? { label, colour: projectColour(label) } : null);

/** What the panel says about the current card. */
export const currentCardOf = (review: Review, pin: Pin): CurrentCard => ({
    pin: pin.id,
    name: pin.name,
    status: chipOf(pin),
    where: pin.kind === "pr" ? "" : whereOf(pin),
    links: linkGroups(pin, review).map((g) => ({ word: g.word, chips: g.links })),
    canReadAll: pin.kind === "pr" ? review.pr.body.trim() !== "" : foldsOf(pinCard(pin, review)).length > 0,
});

export const createRuntime = (args: Parameters<DriverModule["activate"]>[0]): Runtime => {
    const ddp = createDdp(args.issueCommand, args.manifest.driverId);
    let styling = args.styling;
    const github = createGithub((url, init) => fetch(url, init));
    const store = createStore(ddp);
    const parser = createParser({ ddp, fetch: (url, init) => fetch(url, init) });
    const channel = createChannel({ ddp, styling: () => styling });
    const popover = createPopover({ ddp });

    let phase: PanelView["phase"] = "start";
    let loading: (LoadStep & { step: Step })[] = [];
    let error: string | null = null;
    /** The pull request being loaded, while the panel shows its loading lines. */
    let opening: string | null = null;

    const view = (): PanelView => {
        const review = guide.review();
        const pinId = guide.currentPin();
        const pin = pinId ? review?.pins.find((p) => p.id === pinId) : undefined;
        return {
            phase: phase === "ready" && !review ? "start" : phase,
            loading: loading.map(({ label, note, state }) => ({ label, ...(note ? { note } : {}), state })),
            error,
            tag: tagOf(phase === "loading" && opening ? opening : review ? prLabel(review.pr.ref) : null),
            pr: review ? { title: segments(review.pr.title), state: review.pr.state, additions: review.pr.additions, deletions: review.pr.deletions } : null,
            total: review ? stepsOf(review).length : 0,
            current: guide.current(),
            hasPrevious: guide.hasPrevious(),
            hasNext: guide.hasNext(),
            card: review && pin ? currentCardOf(review, pin) : null,
        };
    };
    const push = () => channel.post({ type: "view", view: view() });

    /**
     * A pinned board's review at its head commit: this device's copy, else
     * GitHub's, reporting each loading step to `onProgress`. Rejects in
     * words when the pull request has new commits since.
     */
    const reviewAt = async (key: string, sha: string, onProgress: Progress = () => undefined): Promise<Review> => {
        const kept = await store.review(key, sha);
        if (kept) return kept;
        // A key is `owner/repo#123`, which reads as a pull request reference.
        const ref = parsePrUrl(key);
        if (!ref) throw inWords(`PR Blackboard can't tell which pull request ${key} is.`);
        const review = await loadReview({ github, store, parser }, ref, onProgress);
        if (review.pr.headSha !== sha) throw inWords(`${prLabel(ref)} has new commits since it was laid out here. Open it again to lay out the latest version.`);
        return review;
    };

    const guide = createNavigator({ ddp, popover, styling: () => styling, changed: push, loadReview: reviewAt, explain });

    /**
     * One step under way or done. Starting a step finishes the ones before
     * it, but the parser's, which shows only while it downloads, runs beside
     * the files' and finishes on its own.
     */
    const progress: Progress = (step, state, words = {}) => {
        if (step === "parser" && state === "done" && !loading.some((l) => l.step === "parser")) return;
        const order = STEPS.map((s) => s.step);
        const shown = new Set([...loading.map((l) => l.step), step]);
        loading = STEPS.filter((s) => shown.has(s.step)).map((s) => {
            const l = loading.find((x) => x.step === s.step) ?? { step: s.step, label: s.label, state: "todo" as const };
            if (s.step === step) return { ...l, ...words, state };
            if (state === "active" && step !== "parser" && s.step !== "parser" && order.indexOf(s.step) < order.indexOf(step)) return { ...l, state: "done" as const };
            return l;
        });
        push();
    };
    /** The steps every open shows, before any has started. */
    const fresh = (): (LoadStep & { step: Step })[] => STEPS.filter((s) => s.step !== "parser").map((s) => ({ step: s.step, label: s.label, state: "todo" }));

    /** `reviewAt` for the panel, which shows the loading lines while GitHub is read; the caller sets the phase after. */
    const reviewForPanel = async (key: string, sha: string): Promise<Review> => {
        loading = fresh();
        opening = key;
        try {
            return await reviewAt(key, sha, (step, state, words) => {
                phase = "loading";
                progress(step, state, words);
            });
        } finally {
            phase = "start";
        }
    };

    /**
     * Picks up a board already pinned, for the panel: the one the reader is
     * on (the last card they clicked), else the one nearest the middle of
     * the screen. The PR card is current unless they clicked another card,
     * and the camera stays where it is. Rejects, in words, when the review
     * can't be had.
     */
    const pickUp = async (): Promise<void> => {
        const current = await readBoard(ddp);
        if (current.size === 0) return;
        const on = guide.board();
        let key = on && current.has(on.key) ? on.key : undefined;
        if (!key) {
            const cards = [...current].flatMap(([k, els]) => els.filter((e) => e.mark.part === "pr").map((e) => ({ k, id: e.id })));
            const [rects, viewport] = await Promise.all([rectsOf(ddp, cards.map((t) => t.id)), ddp.tryCall("command:camera:get-viewport-rect")]);
            const cx = viewport ? viewport.rect.x + viewport.rect.width / 2 : 0;
            const cy = viewport ? viewport.rect.y + viewport.rect.height / 2 : 0;
            const distance = (id: string) => {
                const r = rects.get(id);
                return r ? Math.hypot(r.x + r.width / 2 - cx, r.y + r.height / 2 - cy) : Infinity;
            };
            key = [...cards].sort((a, b) => distance(a.id) - distance(b.id))[0]?.k ?? [...current.keys()][0];
        }
        const elements = current.get(key) ?? [];
        const sha = on?.key === key ? on.sha : (elements.find((e) => e.mark.part === "pr")?.mark.sha ?? elements[0]?.mark.sha);
        if (!sha) return;
        const review = await reviewForPanel(key, sha);
        const was = on?.key === key && on.sha === sha ? guide.currentPin() : null;
        guide.set(indexOf(key, sha, elements), review);
        phase = "ready";
        await guide.focus(was ?? "pr");
    };

    const openPanel = async () => {
        await channel.open();
        if (guide.review()) phase = "ready";
        // The board is on the canvas but can't be picked up: the start view says why.
        else
            await pickUp().catch((err: unknown) => {
                console.warn("[pr-blackboard] could not pick up the board", err);
                error = explain(err);
            });
        push();
    };

    /**
     * Opens a pull request: one `add-drawdy-elements` call for the whole
     * board (one undo step), then one flight to the overview with the PR
     * card current. Nothing moves before the board is added. A failure goes
     * back to the start view, with why under the field.
     */
    const openPr = async (url: string) => {
        const ref = parsePrUrl(url);
        const fail = (why: string) => {
            phase = "start";
            error = why;
            push();
        };
        if (!ref) return fail(NOT_A_PR);
        error = null;
        phase = "loading";
        loading = fresh();
        opening = prLabel(ref);
        progress("pr", "active");
        try {
            const review = await loadReview({ github, store, parser }, ref, progress);
            const key = prKey(ref);
            const onBoard = (await readBoard(ddp)).get(key) ?? [];
            if (pinnedAt(onBoard, review.pr.headSha)) {
                guide.set(indexOf(key, review.pr.headSha, onBoard), review);
                phase = "ready";
                await guide.focus("pr");
                await guide.overview();
                return;
            }
            progress("pin", "active", { label: `Pinning ${plural(review.pins.length, "card")}` });
            const elements = await layOut({ ddp, generateId: args.generateId }, review, styling.theme);
            try {
                await ddp.call("command:scene:add-drawdy-elements", { elements });
            } catch (err) {
                console.error("[pr-blackboard]", err);
                return fail(PIN_FAILED);
            }
            guide.set(indexOf(key, review.pr.headSha, (await readBoard(ddp)).get(key) ?? []), review);
            phase = "ready";
            await guide.focus("pr");
            await guide.overview();
        } catch (err) {
            console.error("[pr-blackboard]", err);
            fail(explain(err));
        }
    };

    /** Runs a reader's action; a failure shows in the start view, the only place errors show, in words. */
    const safely = async (job: () => Promise<unknown>) => {
        try {
            await job();
        } catch (err) {
            console.error("[pr-blackboard]", err);
            phase = "start";
            error = explain(err);
            push();
        }
    };

    // Opening pull requests runs one at a time.
    const queue = serial();

    channel.subscribe((message) => {
        switch (message.type) {
            case "ready":
                return push();
            case "open":
                return void queue(() => openPr(message.url));
            case "start":
                phase = "start";
                error = null;
                return push();
            case "next":
                return void safely(guide.next);
            case "previous":
                return void safely(guide.previous);
            case "overview":
                return void safely(guide.overview);
            case "follow":
                return void safely(() => guide.follow(message.link));
            case "read-all":
                return void safely(() => guide.readAll());
            case "close":
                return void safely(guide.closePopover);
            default:
                return;
        }
    });

    /** With the panel open, a click that moved the reader to another board loads that board's review for it. */
    const followBoard = async () => {
        const on = guide.board();
        if (!channel.isReady() || !on || guide.review()) return;
        guide.attach(await reviewForPanel(on.key, on.sha));
        phase = "ready";
        push();
    };

    /**
     * A click on the board: one read of what was clicked, then what it asks
     * for. A click on a PR Blackboard element while the start view shows (after
     * Open another, or an error) brings back the reading view of its board.
     */
    const boardClick = async (ids: readonly string[], at: { x: number; y: number }) => {
        if (!(await guide.click(ids, at))) return;
        await followBoard();
        if (phase !== "start" || !guide.review()) return;
        phase = "ready";
        error = null;
        push();
    };

    /** Removed or replaced elements of the board being read: it is read again, and put away when no card is left. */
    const boardChanged = async (elements: readonly { meta?: unknown }[], replaced: boolean) => {
        const on = guide.board();
        if (!on) return;
        const ours = replaced || elements.some((e) => markOf(e.meta)?.pr === on.key);
        if (!ours) return;
        if (await guide.refresh().catch(() => false)) return;
        guide.set(null);
        phase = "start";
        push();
    };

    // The button spends the dom permission, which on install is granted
    // only after activation: retry it until it lands. Nothing here may
    // reject `activate`, or Drawdy fails the install.
    let registered = false;
    const registerButton = async () => {
        registered ||= await attempt("panel button", () => ddp.call("command:dom:create-action-button", { domElementId: ACTION_BUTTON_ID, svg: ACTION_BUTTON_SVG }));
    };

    /**
     * Registers the button and every subscription the board needs, so the
     * board works without the panel: after a reload, or for a teammate.
     * Subscriptions only need their permission declared; Drawdy grants
     * declared permissions at install.
     */
    const start = async () => {
        await attempt("subscriptions", async () => {
            await ddp.call("subscription:dom:element-clicked", { domElementId: ACTION_BUTTON_ID });
            await ddp.call("subscription:webview:message", { webviewDomId: channel.id });
            await ddp.call("subscription:dom:theme-changed");
            await ddp.call("subscription:dom:element-clicked", { domElementId: CLOSE_BUTTON });
        });
        await attempt("board subscriptions", async () => {
            await ddp.call("subscription:scene:click", {});
            await ddp.call("subscription:scene:elements-removed", { properties: ["meta"] });
            await ddp.call("subscription:scene:elements-replaced", { properties: ["meta"] });
            await ddp.call("subscription:keyboard:control-keys");
        });
        await registerButton();
        if (registered) return;
        REGISTER_RETRIES_MS.forEach((delay) =>
            setTimeout(() => {
                if (!registered) void registerButton();
            }, delay)
        );
    };

    // Long actions are not awaited here: events keep flowing while they run.
    // Events come from this reader's own gestures only; a teammate's arrive on their screen.
    const handle = async (event: DriverSubscriptionEvent) => {
        switch (event.type) {
            case "subscription:dom:theme-changed":
                styling = event.body.styling;
                return channel.pushTheme();
            case "subscription:dom:element-clicked":
                if (event.body.domElementId === ACTION_BUTTON_ID) return void safely(openPanel);
                if (event.body.domElementId === CLOSE_BUTTON) return void safely(guide.closePopover);
                return;
            case "subscription:webview:message":
                if (event.body.webviewDomId === channel.id) channel.receive(event.body.message);
                return;
            case "subscription:scene:click":
                return void safely(() => boardClick(event.body.drawdyElementIds, event.body.cursor.canvasSpace));
            // The popover sits beside its card wherever the camera goes; this subscription lives only while it is open.
            case "subscription:camera:moved-rapid":
                return popover.follow(event.body);
            case "subscription:keyboard:control-keys":
                if (event.body.key === "escape") void guide.closePopover();
                return;
            case "subscription:scene:elements-removed":
                return void safely(() => boardChanged(event.body.drawdyElements, false));
            case "subscription:scene:elements-replaced":
                return void safely(() => boardChanged(event.body.drawdyElements, true));
            default:
                return;
        }
    };

    return { start, handle };
};
