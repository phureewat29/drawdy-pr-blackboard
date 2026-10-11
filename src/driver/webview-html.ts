import { MARKDOWN_CSS } from "../lib/markdown.ts";
import { webviewMain } from "../webview/main.ts";
import { PANEL_BODY, PANEL_CSS, PANEL_MD_CSS } from "../webview/markup.ts";
import { createPanel } from "../webview/panel.ts";

/**
 * Makes a script safe to inline in <script>: nothing in it may close the
 * element or open the HTML parser's escaped-script states.
 */
const inlineSafe = (js: string): string =>
    js.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "\\x3C!--").replace(/<script/gi, "\\x3Cscript");

/**
 * The webview's script: each webview function is serialized on its own and
 * wired together by `webviewMain`. Writing the webview as typed functions
 * (rather than a separate bundle) keeps the extension a single plain build,
 * which is what Drawdy's marketplace pipeline produces.
 */
export const webviewScript = (): string =>
    [`const createPanel = ${createPanel.toString()};`, `(${webviewMain.toString()})({ createPanel });`].join("\n");

export const webviewHtml = (themeCss: string): string => `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style id="theme">:root{${themeCss}}</style>
<style>${PANEL_CSS}${MARKDOWN_CSS}${PANEL_MD_CSS}</style>
</head>
<body>
${PANEL_BODY}
<script type="module">${inlineSafe(webviewScript())}</script>
</body>
</html>`;
