/**
 * The driver Drawdy activates: it registers the panel's button and the subscriptions the board needs, then routes
 * Drawdy's events and the panel's messages to the opener, the rebuilder and the navigator.
 */

import type { DriverModule, DriverSubscriptionEvent } from "@drawdy/driver-protocol";
import { serial } from "../lib/fp.ts";
import { createGithub } from "../lib/github.ts";
import type { Point } from "../lib/layout.ts";
import { appIcon } from "../shared/app-icon.ts";
import { createChannel } from "./channel.ts";
import { createDdp } from "./ddp.ts";
import { markOf } from "./elements.ts";
import { createNavigator } from "./navigator.ts";
import { reviewAt } from "./open.ts";
import { createOpener } from "./opener.ts";
import { createPanelFeed } from "./panel-feed.ts";
import { createParser } from "./parser.ts";
import { quiet } from "./progress.ts";
import { watchQuota } from "./quota.ts";
import { CLOSE_BUTTON, DRAG_HANDLE, createPopover } from "./read-all.ts";
import { createRebuilder } from "./rebuilder.ts";
import { createStore } from "./store.ts";
import { explain } from "./words.ts";

const ACTION_BUTTON_ID = "pr-blackboard:open";

/** When to retry registering the button, which needs a permission granted only after activation (see `start`). */
const REGISTER_RETRIES_MS = [800, 2000, 4000, 8000, 15000];

export type Runtime = {
    start: () => Promise<void>;
    handle: (event: DriverSubscriptionEvent) => Promise<void>;
};

/** Runs `step`, reporting whether it worked; failures are logged, not thrown. */
const attempt = (label: string, step: () => Promise<unknown>): Promise<boolean> =>
    step().then(
        () => true,
        (err: unknown) => {
            console.warn(`[pr-blackboard] ${label} unavailable: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    );

export const createRuntime = (args: Parameters<DriverModule["activate"]>[0]): Runtime => {
    const ddp = createDdp(args.issueCommand, args.manifest.driverId);
    let styling = args.styling;
    const net = watchQuota((url, init) => fetch(url, init));
    const loaders = { github: createGithub(net.fetch), store: createStore(ddp), parser: createParser({ ddp, fetch: (url, init) => fetch(url, init) }) };
    const pinning = { ddp, generateId: args.generateId, theme: () => styling.theme };
    const channel = createChannel({ ddp, styling: () => styling });
    const popover = createPopover({ ddp });
    const guide = createNavigator({ ddp, popover, styling: () => styling, changed: () => panel.push(), loadReview: (key, sha) => reviewAt(loaders, key, sha, quiet), explain });
    const panel = createPanelFeed({ channel, guide, quota: net.quota });
    const opener = createOpener({ ddp, channel, guide, panel, loaders, pinning });
    const rebuilder = createRebuilder({ ddp, guide, panel, loaders, pinning });

    /** Runs a reader's action; a failure shows, in words, in the view on screen: on the toolbar's line, or under the start view's field. */
    const safely = async (action: () => Promise<unknown>) => {
        try {
            await action();
        } catch (err) {
            console.error("[pr-blackboard]", err);
            panel.error = explain(err);
            panel.push();
        }
    };

    // Opens run one at a time. A rebuild runs beside them, one at a time on its own.
    const queue = serial();

    /** The panel's controls that only move the reader on the board. */
    const moves = { next: guide.next, previous: guide.previous, overview: guide.overview, description: guide.description, "read-all": () => guide.readAll(), close: guide.closePopover };

    channel.subscribe((message) => {
        // A rebuild's failure shows in the reading view until the reader's next action there.
        if (panel.phase === "ready" && panel.error && message.type !== "ready") {
            panel.error = null;
            panel.push();
        }
        switch (message.type) {
            case "ready":
                return panel.push();
            case "open":
                return void queue(() => opener.openPr(message.url));
            case "start":
                panel.phase = "start";
                panel.error = null;
                panel.push();
                return void safely(guide.closePopover);
            case "follow":
                return void safely(() => guide.follow(message.link));
            case "rebuild":
                return void rebuilder.rebuild();
            default:
                return void safely(moves[message.type]);
        }
    });

    /** A click on the board. On a PR Blackboard element while the start view shows (after Home, or an error), the reading view of its board comes back. */
    const boardClick = async (ids: readonly string[], at: Point) => {
        if (!(await guide.click(ids, at))) return;
        // A click is the reader's next action, as a press in the panel is: the error on show goes, so a rebuild's never follows them to another board.
        if (panel.error) {
            panel.error = null;
            panel.push();
        }
        await opener.followBoard();
        if (panel.phase !== "start" || !guide.review()) return;
        panel.phase = "ready";
        panel.error = null;
        panel.push();
    };

    /** Removed or replaced elements of the board being read: it is read again, and put away when no card is left. */
    const boardChanged = async (elements: readonly { id: string; meta?: unknown }[], replaced: boolean) => {
        if (!replaced && rebuilder.isOwnRemoval(elements)) return;
        const on = guide.board();
        if (!on) return;
        if (!replaced && !elements.some((e) => markOf(e.meta)?.pr === on.key)) return;
        if (await guide.refresh().catch(() => false)) return;
        guide.set(null);
        panel.phase = "start";
        panel.push();
    };

    let registered = false;
    const registerButton = async () => {
        registered ||= await attempt("panel button", () => ddp.call("command:dom:create-action-button", { domElementId: ACTION_BUTTON_ID, svg: appIcon(20) }));
    };

    /**
     * Registers the button and every subscription the board needs, so the board works without the panel: after a
     * reload, or for a teammate. Subscriptions need only their permission declared, which Drawdy grants at install;
     * the button spends the dom permission, granted on install only after activation, so it is retried until it
     * lands. Nothing here may reject `activate`, or Drawdy fails the install.
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

    // Long actions are not awaited here, so events keep flowing while they run. Events come from this reader's own gestures only.
    const handle = async (event: DriverSubscriptionEvent) => {
        switch (event.type) {
            case "subscription:dom:theme-changed":
                styling = event.body.styling;
                return channel.pushTheme();
            case "subscription:dom:element-clicked":
                if (event.body.domElementId === ACTION_BUTTON_ID) return void safely(opener.openPanel);
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
