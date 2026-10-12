import type { DriverModule, DriverSubscriptionEvent } from "@drawdy/driver-protocol";
import { chipOf, foldsOf, linkGroups, pinCard, whereOf } from "../lib/card.ts";
import { plural, serial } from "../lib/fp.ts";
import { createGithub, explainGithub, githubFailure, pageCount, parsePrUrl, prKey, prLabel } from "../lib/github.ts";
import { stepsOf } from "../lib/layout.ts";
import { lexMarkdown, markdownHtml, segments } from "../lib/markdown.ts";
import type { Pin, Review } from "../lib/model.ts";
import { appIcon } from "../shared/app-icon.ts";
import { projectColour } from "../shared/suggestions.ts";
import type { Annotation, CurrentCard, PanelView } from "../shared/protocol.ts";
import { pinnedAt, readBoard, rectsOf } from "./board.ts";
import { createChannel } from "./channel.ts";
import { createDdp, protocolError } from "./ddp.ts";
import { markOf } from "./elements.ts";
import { createNavigator, indexOf } from "./navigator.ts";
import { layOut, loadReview } from "./open.ts";
import { createParser } from "./parser.ts";
import { createJob, quiet, type Job, type Progress, type StepKey, type Unread } from "./progress.ts";
import { watchQuota } from "./quota.ts";
import { CLOSE_BUTTON, DRAG_HANDLE, createPopover } from "./read-all.ts";
import { createStore } from "./store.ts";
import { cardLimit, listCut, noDiff, quotaLow, warningsOf } from "./warnings.ts";
import { inWords, isInWords, titleOf } from "./words.ts";

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
const NOT_A_PR = "Only GitHub PR links work, like github.com/owner/repo/pull/123.";
const GONE = "GitHub can't find this PR any more.";

/** How often at most the panel gets a view while a PR loads: its rows change many times a second. */
const PROGRESS_MS = 50;

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

/** A failed step's title, when its error has none of its own. */
const STEP_FAILED: Record<StepKey, string> = { pr: "Couldn't read the PR", parser: "Download failed", files: "Reading failed", link: "Couldn't find the lines", pin: "Pinning failed" };

/**
 * Why an open failed at `step`, as a CI annotation under it: what went
 * wrong in a few words, then the words for the reader.
 */
export const failureOf = (err: unknown, step?: StepKey): Annotation => {
    const failure = (title: string, detail: string): Annotation => ({ level: "failure", title, detail });
    const github = githubFailure(err);
    switch (github?.kind) {
        case "rate-limited":
            return failure("GitHub rate limit reached", explainGithub(github));
        case "not-found":
            return failure("PR not found", "Check the link: PR Blackboard opens public PRs only.");
        case "network":
            return failure("Can't reach GitHub", "Check your connection and try again.");
        case "http":
            return failure(`GitHub error ${github.status}`, "Try again in a moment.");
    }
    if (protocolError(err)?.type === "unauthorized") return failure("Permission needed", "Turn it on in Extensions › PR Blackboard › Manage permissions.");
    if (!isInWords(err)) return failure("Something went wrong", err instanceof Error ? err.message : String(err));
    return failure(titleOf(err) ?? (step ? STEP_FAILED[step] : "Couldn't open the PR"), err.message);
};

/** A pull request's tag for the panel: its label and its project's colour. */
const tagOf = (label: string | null): PanelView["tag"] => (label ? { label, colour: projectColour(label) } : null);

/** What reading a pull request from GitHub again costs, when that is more than the usual 2 requests: the pull request, then its file list's pages. */
export const rebuildCostOf = (changedFiles: number): PanelView["rebuildCost"] => {
    const requests = 1 + pageCount(changedFiles);
    return requests > 2 ? { files: changedFiles, requests } : null;
};

/** Each review's description as the panel shows it, rendered once: views go to the panel many times a second while a rebuild runs. */
const descriptions = new WeakMap<Review, string | null>();
const descriptionOf = (review: Review): string | null => {
    if (!descriptions.has(review)) descriptions.set(review, review.pr.body.trim() ? markdownHtml(lexMarkdown(review.pr.body), "page") : null);
    return descriptions.get(review)!;
};

/** What this session's reads left out of each review it built: none for a stored copy, which was read before. */
const unreadOf = new WeakMap<Review, Unread>();

/**
 * What the panel says about the current card. At the PR card: who opened
 * it and how big it is, what the board can't show (`warnings`), and the
 * whole description. At a code card: its name, chip and place, and its
 * links by kind, each named in its line's colour (`colourOf`), when it has
 * one.
 */
export const currentCardOf = (review: Review, pin: Pin, colourOf: (link: string) => number | null = () => null, warnings: Annotation[] = []): CurrentCard =>
    pin.kind === "pr"
        ? {
              pin: "pr",
              about: [`${review.pr.author} · ${plural(review.pr.changedFiles, "file")}`],
              warnings,
              description: descriptionOf(review),
          }
        : {
              pin: pin.id,
              name: pin.name,
              status: chipOf(pin),
              where: whereOf(pin),
              links: linkGroups(pin, review).map((g) => ({ word: g.word, chips: g.links.map((c) => ({ ...c, colour: colourOf(c.link) })) })),
              canReadAll: foldsOf(pinCard(pin, review)).length > 0,
          };

export const createRuntime = (args: Parameters<DriverModule["activate"]>[0]): Runtime => {
    const ddp = createDdp(args.issueCommand, args.manifest.driverId);
    let styling = args.styling;
    const net = watchQuota((url, init) => fetch(url, init));
    const github = createGithub(net.fetch);
    const store = createStore(ddp);
    const parser = createParser({ ddp, fetch: (url, init) => fetch(url, init) });
    const channel = createChannel({ ddp, styling: () => styling });
    const popover = createPopover({ ddp });

    let phase: PanelView["phase"] = "start";
    /** The open the loading view shows: its steps, and why it failed when it did. */
    let job: Job = createJob();
    let error: string | null = null;
    /** The pull request being loaded, while the panel shows its loading lines. */
    let opening: string | null = null;
    /**
     * The one rebuild that may run, from the moment it is asked for: its
     * board, its own steps (an open or a board click meanwhile has `job`),
     * and when it ends.
     */
    let rebuilding: { key: string; label: string; job: Job; done: Promise<void> } | null = null;
    /** The elements a rebuild took off the board itself: their removal is no reader's. */
    const swept = new Set<string>();

    /** The words of the step a rebuild has reached. Seen from another board, they name the rebuild's. */
    const rebuildLine = (r: NonNullable<typeof rebuilding>, on: string | undefined): string => (on === r.key ? r.job.current() : `${r.label} · ${r.job.current()}`);

    const view = (): PanelView => {
        const review = guide.review();
        const pinId = guide.currentPin();
        const pin = pinId ? review?.pins.find((p) => p.id === pinId) : undefined;
        const loading = phase === "loading";
        return {
            phase: phase === "ready" && !review ? "start" : phase,
            loading: loading ? job.steps() : [],
            annotations: loading ? job.annotations() : [],
            error,
            tag: tagOf(loading && opening ? opening : review ? prLabel(review.pr.ref) : null),
            pr: review ? { title: segments(review.pr.title), state: review.pr.state, additions: review.pr.additions, deletions: review.pr.deletions } : null,
            total: review ? stepsOf(review).length : 0,
            current: guide.current(),
            hasPrevious: guide.hasPrevious(),
            hasNext: guide.hasNext(),
            // The loading view shows no card, and gets many views a second: the card is worked out only for the others.
            card: review && pin && !loading ? currentCardOf(review, pin, guide.colourOf, pin.kind === "pr" ? warningsOf(review, unreadOf.get(review), net.quota(), Date.now()) : []) : null,
            rebuildCost: review ? rebuildCostOf(review.pr.changedFiles) : null,
            rebuilding: rebuilding ? rebuildLine(rebuilding, guide.board()?.key) : null,
        };
    };
    let pending: ReturnType<typeof setTimeout> | null = null;
    let pushed = 0;
    const push = () => {
        if (pending) clearTimeout(pending);
        pending = null;
        pushed = Date.now();
        channel.post({ type: "view", view: view() });
    };
    /** `push` for a loading step's progress: at most once every `PROGRESS_MS`, the last change always sent. */
    const pushSoon = () => {
        if (pending) return;
        const wait = pushed + PROGRESS_MS - Date.now();
        if (wait <= 0) push();
        else pending = setTimeout(push, wait);
    };

    /**
     * `j` as an open's progress, each change shown on the panel: a step's or
     * a parser's at once, a file's at most every `PROGRESS_MS`, or never for
     * a rebuild, whose line names the step only (`files`). `first` runs
     * before the first. Once the PR is read, a quota running low is a
     * warning on its step.
     */
    const shown = (j: Job, first = () => {}, files: () => void = pushSoon): Progress => {
        let started = false;
        const on =
            <A extends unknown[]>(report: (...args: A) => void, show = files) =>
            (...args: A) => {
                if (!started) first();
                started = true;
                report(...args);
                show();
            };
        return {
            step: on((step, state, words) => {
                j.step(step, state, words);
                if (step === "pr" && state === "done") j.warn("pr", quotaLow(net.quota(), Date.now()));
            }, push),
            reading: on(j.reading, push),
            read: on(j.read),
            followed: on(j.followed),
            parser: on(j.parser, push),
        };
    };

    /** Warnings a review gives its open: the files past GitHub's list, the diffs GitHub left out, and the card limit. */
    const warnBuilt = (j: Job, review: Review) => {
        j.warn("pr", listCut(review));
        j.warn("files", noDiff(review));
        j.warn("pin", cardLimit(review.unpinned));
    };

    /**
     * A pinned board's review at its head commit: this device's copy, else
     * GitHub's, reporting each loading step to `progress`. Rejects in words
     * when the pull request has new commits since.
     */
    const reviewAt = async (key: string, sha: string, progress: Progress = quiet): Promise<Review> => {
        const kept = await store.review(key, sha);
        if (kept) return kept;
        // A key is `owner/repo#123`, which reads as a pull request reference.
        const ref = parsePrUrl(key);
        if (!ref) throw inWords(`PR Blackboard can't tell which PR ${key} is.`);
        const { review } = await loadReview({ github, store, parser }, ref, progress);
        if (review.pr.headSha !== sha) throw inWords(`${prLabel(ref)} has new commits since it was laid out here. Open it again to lay out the latest version.`, "New commits");
        return review;
    };

    const guide = createNavigator({ ddp, popover, styling: () => styling, changed: push, loadReview: reviewAt, explain });

    /** The open on the loading view failed: its failed step and why stay there, with Home and Try again. */
    const failed = (j: Job, err: unknown) => {
        console.error("[pr-blackboard]", err);
        j.fail(failureOf(err, j.at()));
        phase = "loading";
        push();
    };

    /**
     * `reviewAt` for the panel, which shows the loading view while GitHub is
     * read, and keeps it when that fails; the caller sets the phase after a
     * success.
     */
    const reviewForPanel = async (key: string, sha: string): Promise<Review> => {
        const j = (job = createJob());
        opening = key;
        try {
            const review = await reviewAt(key, sha, shown(j, () => (phase = "loading")));
            if (phase === "loading") unreadOf.set(review, j.unread());
            phase = "start";
            return review;
        } catch (err) {
            if (phase === "loading" && job === j) failed(j, err);
            throw err;
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
        // A reload between a rebuild's add and its removal leaves two boards of one pull request: the newest, last in Drawdy's scene order, is the one to read.
        const sha = on?.key === key ? on.sha : (elements.findLast((e) => e.mark.part === "pr")?.mark.sha ?? elements.at(-1)?.mark.sha);
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
        // The board is on the canvas but can't be picked up: the loading view says why, or the start view when it never showed.
        else
            await pickUp().catch((err: unknown) => {
                console.warn("[pr-blackboard] could not pick up the board", err);
                if (phase !== "loading") error = explain(err);
            });
        push();
    };

    /**
     * Opens a pull request: one `add-drawdy-elements` call for the whole
     * board (one undo step), then one flight to the overview with the PR
     * card current. Nothing moves before the board is added. A link that
     * isn't a PR stays in the start view, with why under the field; a
     * failure on the way stays in the loading view, at its failed step.
     */
    const openPr = async (url: string) => {
        const ref = parsePrUrl(url);
        if (!ref) {
            phase = "start";
            error = NOT_A_PR;
            return push();
        }
        error = null;
        phase = "loading";
        const j = (job = createJob());
        opening = prLabel(ref);
        const progress = shown(j);
        progress.step("pr", "active");
        try {
            // The board being rebuilt opens once the rebuild has landed: two boards of one pull request at once would be one board of twice the cards.
            if (rebuilding?.key === prKey(ref)) await rebuilding.done;
            const { review, plan } = await loadReview({ github, store, parser }, ref, progress);
            if (plan) unreadOf.set(review, j.unread());
            warnBuilt(j, review);
            const key = prKey(ref);
            const onBoard = (await readBoard(ddp)).get(key) ?? [];
            if (pinnedAt(onBoard, review.pr.headSha)) {
                guide.set(indexOf(key, review.pr.headSha, onBoard), review);
                phase = "ready";
                await guide.focus("pr");
                await guide.overview();
                return;
            }
            progress.step("pin", "active", { label: `Pinning ${plural(review.pins.length, "card")}` });
            const elements = await layOut({ ddp, generateId: args.generateId }, review, styling.theme, plan ?? undefined);
            try {
                await ddp.call("command:scene:add-drawdy-elements", { elements });
            } catch (err) {
                console.error("[pr-blackboard]", err);
                return failed(j, inWords(PIN_FAILED));
            }
            j.step("pin", "done");
            guide.set(indexOf(key, review.pr.headSha, (await readBoard(ddp)).get(key) ?? []), review);
            phase = "ready";
            await guide.focus("pr");
            await guide.overview();
        } catch (err) {
            failed(j, err);
        }
    };

    /**
     * Builds the board being read again from GitHub, ignoring this device's
     * copy and the last read: its files read, parsed and laid out anew. The
     * new board goes where the old one's PR card stands, and only then do the
     * old board's elements go, found by their marks (this pull request at the
     * board's head commit), so the reader's own notes and strokes stay. In
     * DDP 1.3 that is two undo steps, the add and then the removal: two undos
     * bring the old board back. A failure leaves the old board as it was.
     *
     * One rebuild at a time: another asked for while one runs is refused.
     * The reader may do anything meanwhile. The landing (the PR card current,
     * the camera at the overview) and a failure's words are theirs only if
     * they are still reading this board when it ends; otherwise it lands
     * silently, and opens of other pull requests never wait for it.
     */
    const rebuild = async () => {
        const on = guide.board();
        const ref = on ? parsePrUrl(on.key) : null;
        // Refused: the view goes again, so the panel's Rebuild, turned off at the press, shows what holds.
        if (!on || !ref || rebuilding) return push();
        let landed = () => {};
        const run = { key: on.key, label: prLabel(ref), job: createJob(), done: new Promise<void>((resolve) => (landed = resolve)) };
        rebuilding = run;
        error = null;
        push();
        const reading = () => phase === "ready" && guide.board()?.key === on.key;
        const progress = shown(run.job, undefined, () => {});
        try {
            await guide.closePopover();
            const { review, plan } = await loadReview({ github, store, parser }, ref, progress, true);
            unreadOf.set(review, run.job.unread());
            const old = ((await readBoard(ddp)).get(on.key) ?? []).filter((e) => e.mark.sha === on.sha);
            const card = old.find((e) => e.mark.part === "pr");
            const corner = card ? (await rectsOf(ddp, [card.id])).get(card.id) : undefined;
            progress.step("pin", "active", { label: `Pinning ${plural(review.pins.length, "card")}` });
            const elements = await layOut({ ddp, generateId: args.generateId }, review, styling.theme, plan ?? undefined, corner);
            try {
                await ddp.call("command:scene:add-drawdy-elements", { elements });
            } catch (err) {
                console.error("[pr-blackboard]", err);
                throw inWords(PIN_FAILED);
            }
            for (const e of old) swept.add(e.id);
            await ddp.call("command:scene:remove-drawdy-elements", { drawdyElementIds: old.map((e) => e.id) });
            const key = prKey(review.pr.ref);
            const next = indexOf(key, review.pr.headSha, (await readBoard(ddp)).get(key) ?? []);
            const seen = reading();
            rebuilding = null;
            // The old board is gone: whoever still holds it moves to the new one; Read all on one of its cards closes.
            if (guide.board()?.key === on.key) {
                await guide.closePopover();
                guide.set(next, review);
            }
            if (!seen) return;
            await guide.focus("pr");
            await guide.overview();
        } catch (err) {
            console.error("[pr-blackboard]", err);
            const why = githubFailure(err)?.kind === "not-found" ? GONE : explain(err);
            // Away from that board, the reader's line names it, until their next action.
            error = reading() ? why : `${run.label} · failed: ${why}`;
        } finally {
            if (rebuilding === run) rebuilding = null;
            landed();
            push();
        }
    };

    /** Runs a reader's action; a failure shows, in words, in the view on screen: on the toolbar's line, or under the start view's field. */
    const safely = async (job: () => Promise<unknown>) => {
        try {
            await job();
        } catch (err) {
            console.error("[pr-blackboard]", err);
            error = explain(err);
            push();
        }
    };

    // Opens run one at a time. A rebuild runs beside them, one at a time on its own (`rebuild`).
    const queue = serial();

    channel.subscribe((message) => {
        // A rebuild's failure shows in the reading view until the reader's next action there.
        if (phase === "ready" && error && message.type !== "ready") {
            error = null;
            push();
        }
        switch (message.type) {
            case "ready":
                return push();
            case "open":
                return void queue(() => openPr(message.url));
            case "start":
                phase = "start";
                error = null;
                push();
                return void safely(guide.closePopover);
            case "next":
                return void safely(guide.next);
            case "previous":
                return void safely(guide.previous);
            case "overview":
                return void safely(guide.overview);
            case "description":
                return void safely(guide.description);
            case "follow":
                return void safely(() => guide.follow(message.link));
            case "read-all":
                return void safely(() => guide.readAll());
            case "close":
                return void safely(guide.closePopover);
            case "rebuild":
                return void rebuild();
            default:
                return;
        }
    });

    /** With the panel open, a click that moved the reader to another board loads that board's review for it. */
    const followBoard = async () => {
        const on = guide.board();
        if (!channel.isReady() || !on || guide.review()) return;
        guide.attach(await reviewForPanel(on.key, on.sha));
        // The panel names each link in its string's colour, which the board's marks hold.
        await guide.readMarks();
        phase = "ready";
        push();
    };

    /**
     * A click on the board: one read of what was clicked, then what it asks
     * for. A click on a PR Blackboard element while the start view shows (after
     * Home, or an error) brings back the reading view of its board.
     */
    const boardClick = async (ids: readonly string[], at: { x: number; y: number }) => {
        if (!(await guide.click(ids, at))) return;
        // A click is the reader's next action, as a press in the panel is: the error on show goes, so a rebuild's never follows them to another board.
        if (error) {
            error = null;
            push();
        }
        await followBoard();
        if (phase !== "start" || !guide.review()) return;
        phase = "ready";
        error = null;
        push();
    };

    /**
     * Removed or replaced elements of the board being read: it is read again,
     * and put away when no card is left. A rebuild's own removal is no change.
     */
    const boardChanged = async (elements: readonly { id: string; meta?: unknown }[], replaced: boolean) => {
        if (!replaced && elements.length > 0 && elements.every((e) => swept.has(e.id))) {
            for (const e of elements) swept.delete(e.id);
            return;
        }
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
            await ddp.call("subscription:dom:drag", { domElementId: DRAG_HANDLE });
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
            // Read all pans and zooms with the board; these subscriptions live only while it is open.
            case "subscription:camera:moved-rapid":
                return popover.follow(event.body);
            case "subscription:dom:screen-resized":
                return popover.resize(event.body);
            case "subscription:dom:drag":
                return popover.drag(event.body);
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
