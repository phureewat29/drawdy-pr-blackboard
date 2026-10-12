import type { DriverToWebview, WebviewToDriver } from "../shared/protocol.ts";
import type { createPanel } from "./panel.ts";

export type Factories = { createPanel: typeof createPanel };

/**
 * The webview's entry point: wires Drawdy's webview API to the panel. The factory arrives as an argument because
 * each function is serialized into the webview on its own (driver/webview-html.ts).
 */
export const webviewMain = ({ createPanel }: Factories): void => {
    const api = acquireDrawdyApi();
    const post = (message: WebviewToDriver) => api.postMessage(message);
    const panel = createPanel({ post, document });
    const theme = document.getElementById("theme");

    api.onMessage((raw) => {
        if (typeof raw !== "object" || raw === null || !("type" in raw)) return;
        const message = raw as DriverToWebview;
        switch (message.type) {
            case "theme":
                if (theme) theme.textContent = `:root{${message.css}}`;
                return;
            case "view":
                return panel.show(message.view);
            default:
                return;
        }
    });

    post({ type: "ready" });
};
