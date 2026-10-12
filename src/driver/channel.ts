/**
 * The driver's end of the panel: creates the webview, waits for its script to announce `ready`, queues messages
 * until then, and checks every message coming back against the protocol.
 */

import type { ModuleStyling } from "@drawdy/driver-protocol";
import { PALETTES } from "../lib/card.ts";
import { parse } from "../lib/guard.ts";
import { STRING_TEXT } from "../lib/layout.ts";
import { webviewToDriver, type DriverToWebview, type WebviewToDriver } from "../shared/protocol.ts";
import type { Ddp } from "./ddp.ts";
import { webviewHtml } from "./webview-html.ts";

const WEBVIEW_ID = "pr-blackboard:panel";
/** How long a new webview gets to start its script. */
const START_TIMEOUT_MS = 20_000;

export type Channel = {
    /** The webview's DOM id. */
    id: string;
    isReady: () => boolean;
    /** Opens the panel, or brings it back, once its script is listening. */
    open: () => Promise<void>;
    post: (message: DriverToWebview) => void;
    /** Feeds in a `subscription:webview:message` body. */
    receive: (raw: unknown) => void;
    subscribe: (handler: (message: WebviewToDriver) => void) => void;
    pushTheme: () => void;
};

/** What the panel takes from the cards' palette: diff colours and chips, and what the description needs, its links, code, rules and syntax. */
const FROM_CARDS = ["add", "del", "add-gut", "blue", "md-link", "md-code-bg", "md-border", "add-bg", "del-bg", "k", "s", "n", "c", "f", "t"];

/**
 * ModuleStyling as `--drawdy-*` CSS variables for the webview's `:root` (`mutedForeground` becomes
 * `--drawdy-muted-foreground`), plus, in the same theme, the cards' colours the panel shares and each string colour
 * as panel text, `--string-0` to `--string-7`.
 */
export const themeCss = (styling: ModuleStyling): string =>
    Object.entries(styling)
        .map(([key, value]) => (key === "theme" ? `color-scheme: ${value};` : `--drawdy-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${value};`))
        .join("") +
    FROM_CARDS.map((k) => `--${k}: ${PALETTES[styling.theme][k]};`).join("") +
    STRING_TEXT[styling.theme].map((colour, i) => `--string-${i}: ${colour};`).join("");

export const createChannel = (deps: { ddp: Ddp; styling: () => ModuleStyling }): Channel => {
    const { ddp, styling } = deps;
    const id = WEBVIEW_ID;
    let ready = false;
    let queued: DriverToWebview[] = [];
    let waiters: (() => void)[] = [];
    let opening: Promise<void> | null = null;
    const handlers = new Set<(message: WebviewToDriver) => void>();

    const send = (message: DriverToWebview) => ddp.tryCall("command:webview:post-message", { webviewDomId: id, message });
    const sendTheme = () => send({ type: "theme", css: themeCss(styling()) });

    const post = (message: DriverToWebview) => {
        // Only the latest view matters: drop queued ones it replaces.
        if (ready) void send(message);
        else queued = [...queued.filter((m) => m.type !== message.type || m.type === "theme"), message];
    };

    const markReady = () => {
        if (ready) return;
        ready = true;
        void sendTheme();
        queued.forEach((message) => void send(message));
        waiters.forEach((wake) => wake());
        queued = [];
        waiters = [];
    };

    const waitReady = () =>
        new Promise<void>((resolve, reject) => {
            if (ready) return resolve();
            const timer = setTimeout(() => reject(new Error("The PR Blackboard panel did not start")), START_TIMEOUT_MS);
            waiters.push(() => {
                clearTimeout(timer);
                resolve();
            });
        });

    // Drawdy removes a driver's webview along with the driver, so a webview with this id is always this driver's own:
    // new, or reopened after the user closed the panel (it keeps its state while hidden).
    const create = async () => {
        await ddp.call("command:webview:create", { webviewDomId: id, htmlContent: webviewHtml(themeCss(styling())), keepStateWhenClosed: true });
        await waitReady();
    };

    const open = () => {
        opening ??= create().finally(() => {
            opening = null;
        });
        return opening;
    };

    const receive = (raw: unknown) => {
        const message = parse(webviewToDriver, raw);
        if (!message) {
            console.warn(`[pr-blackboard] ignored a malformed webview message: ${JSON.stringify(raw)?.slice(0, 300)}`);
            return;
        }
        if (message.type === "ready") markReady();
        handlers.forEach((handler) => handler(message));
    };

    return {
        id,
        isReady: () => ready,
        open,
        post,
        receive,
        subscribe: (handler) => void handlers.add(handler),
        pushTheme: () => {
            if (ready) void sendTheme();
        },
    };
};
