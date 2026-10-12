/** The panel's static markup and styles. Colours come from Drawdy's theme vars, which load before this sheet. */

import { segmentsHtml } from "../lib/markdown.ts";
import { icon } from "../shared/icons.ts";
import { SUGGESTIONS } from "../shared/suggestions.ts";

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export const PANEL_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
    --hover: color-mix(in srgb, var(--drawdy-foreground) 7%, transparent);
    --shade: color-mix(in srgb, var(--drawdy-foreground) 16%, transparent);
    /* Drawdy's lime for what turns, drawn toward the text colour so it reads on white too (3.1:1), and stays lime on dark. */
    --turning: color-mix(in oklab, var(--drawdy-primary) 70%, var(--drawdy-foreground));
    /* Drawdy's warning amber fills a warning's mark; drawn toward the text colour, it strokes one that reads on white (3.3:1). */
    --amber: var(--drawdy-warning);
    --amber-ink: color-mix(in oklab, var(--drawdy-warning) 80%, var(--drawdy-foreground));
    display: flex; flex-direction: column; overflow: hidden;
    font: 13px/18px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--drawdy-background); color: var(--drawdy-foreground);
}
button, input { font: inherit; color: inherit; }
button { cursor: pointer; }
[hidden] { display: none !important; }
/* Drawdy's lime, drawn toward the text colour so the ring reads on white too. */
:focus-visible { outline: 2px solid color-mix(in oklab, var(--drawdy-ring) 55%, var(--drawdy-foreground)); outline-offset: 2px; }
.mono, code, .tag, input { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
section { flex: 1; min-height: 0; display: flex; flex-direction: column; }

/* The paste field, at the top of the start view. */
.field { position: relative; flex: none; }
.field svg { position: absolute; left: 10px; top: 9px; width: 14px; height: 14px; color: var(--drawdy-muted-foreground); pointer-events: none; }
.field input { display: block; width: 100%; height: 32px; padding: 0 10px 0 30px; font-size: 12px; background: var(--drawdy-surface); border: 1px solid var(--drawdy-border); border-radius: var(--drawdy-radius-md); outline: none; }
.field input::placeholder { font: 13px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--drawdy-muted-foreground); }
.field input:focus { border-color: var(--drawdy-ring); box-shadow: 0 0 0 1px var(--drawdy-ring); }
.error { flex: none; margin: 0; padding: 8px 10px; border-radius: var(--drawdy-radius-md); background: color-mix(in srgb, var(--drawdy-destructive) 14%, transparent); font-size: 12.5px; line-height: 17px; }

/* A pull request's owner/repo#number. An example project's tag takes its colour, --c; any other repo's stays neutral. */
.tag { margin: 0; padding: 0 6px; border: 1px solid var(--drawdy-border); border-radius: 999px; font-size: 11px; line-height: 16px; color: var(--drawdy-muted-foreground); white-space: nowrap; }
.tag.hue { color: color-mix(in oklab, var(--c) 60%, var(--drawdy-foreground)); border-color: color-mix(in oklab, var(--c) 40%, transparent); background: color-mix(in oklab, var(--c) 10%, transparent); }
code { padding: 0 3px; border-radius: 4px; font-size: 11.5px; line-height: 1; background: color-mix(in srgb, currentColor 10%, transparent); }

/* Example rows, no heading: the tag on its own line, then the title. */
.prs { list-style: none; margin: 0 -8px; padding: 0 0 8px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; align-content: start; min-height: 0; overflow-y: auto; }
.prs button { width: 100%; display: grid; justify-items: start; gap: 4px; padding: 6px 8px; border: 0; border-radius: 8px; background: transparent; text-align: left; font-size: 13px; color: var(--drawdy-foreground); overflow-wrap: break-word; }
.prs button:hover { background: var(--hover); }
/* A big pull request says what it costs, after its tag. */
.tagline { display: flex; align-items: center; gap: 8px; }
.cost, .note { font: 11px/16px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--drawdy-muted-foreground); }
.prs button:focus-visible, #links button:focus-visible { outline-offset: -2px; }
/* Shadows only while there is more to scroll. */
.scroll {
    --bg: var(--drawdy-background);
    background:
        linear-gradient(var(--bg) 30%, transparent) top / 100% 28px no-repeat local,
        linear-gradient(transparent, var(--bg) 70%) bottom / 100% 28px no-repeat local,
        linear-gradient(var(--shade), transparent) top / 100% 10px no-repeat scroll,
        linear-gradient(transparent, var(--shade)) bottom / 100% 10px no-repeat scroll;
}

#start { padding: 14px 14px 0; gap: 10px; }

/* Loading, as a CI job: the tag, the steps, then the annotations, scrolling when they outgrow the panel. On a failure the toolbar comes, Home and Try again. */
.load-body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 14px; }
.load-body > .tag { align-self: flex-start; }
/* A step: its mark, its words (a muted note after them), and at its right a count or the time it took; its rows under its words. */
.steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.steps > li { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; column-gap: 10px; color: var(--drawdy-muted-foreground); }
.steps > li:not(.todo) { color: var(--drawdy-foreground); }
.steps .note { font-size: inherit; line-height: inherit; }
.load-meta { padding-left: 4px; font-size: 11.5px; color: var(--drawdy-muted-foreground); font-variant-numeric: tabular-nums; white-space: nowrap; }
.rows-wrap { grid-column: 2 / -1; display: grid; grid-template-rows: 1fr; }
.rows { min-height: 0; overflow: hidden; list-style: none; margin: 0; padding: 0; }
.rows > li { display: grid; grid-template-columns: 12px minmax(0, 1fr); column-gap: 8px; align-items: center; margin-top: 4px; font-size: 12px; line-height: 16px; color: var(--drawdy-muted-foreground); }
.rows > li.done, .rows > li.active, .rows > li.warning, .rows > li.failed { color: var(--drawdy-foreground); }
/* A file by its path, its folder muted: the panel cuts a path too long for the row at its start (fitPath), so the file's name stays whole. */
.file { min-width: 0; overflow: hidden; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; }
.file .dir, .rows > li.todo .file { color: var(--drawdy-muted-foreground); }
.rows > li.more { display: block; padding-left: 20px; }
/* Lucide marks. A step's: circle to do, loader-circle turning, circle-check done (a lime disc, a dark tick), triangle-alert done with a warning (an amber triangle, a dark mark), circle-x failed (a red disc, a white cross). A row's are lighter and still, only its step turns: circle, circle-dot under way, check, triangle-alert and x, stroked. */
.steps svg { width: 16px; height: 16px; margin-top: 1px; color: var(--drawdy-border); }
.rows svg { width: 12px; height: 12px; margin: 0; }
.steps .active > svg, .line svg { color: var(--turning); animation: spin .8s linear infinite; }
.rows .active > svg { color: var(--turning); }
.rows .active > svg circle + circle { fill: currentColor; }
.steps .done > svg { color: var(--drawdy-primary-foreground); }
.steps .done > svg circle { fill: var(--drawdy-primary); stroke: var(--drawdy-primary); }
.steps .warning > svg, .annotation.warning svg, .summary > svg:first-child { color: #090909; }
.steps .warning > svg path:first-child, .annotation.warning svg path:first-child, .summary > svg:first-child path:first-child { fill: var(--amber); stroke: var(--amber); }
.steps .failed > svg, .annotation.failure svg { color: #fff; }
.steps .failed > svg circle, .annotation.failure svg circle { fill: var(--drawdy-destructive); stroke: var(--drawdy-destructive); }
.rows .done > svg { color: var(--drawdy-muted-foreground); }
.rows .warning > svg { color: var(--amber-ink); }
.rows .failed > svg { color: var(--drawdy-destructive); }
/* CI annotations: each a mark, a short title and a plain detail line. Warnings share one frame under a row that counts them and opens or shuts them, a rule between each; a failure is the open's error box, never shut. */
.annotations { display: grid; gap: 8px; }
.annotations > div:empty { display: none; }
.warnings { border: 1px solid var(--drawdy-border); border-radius: var(--drawdy-radius-md); overflow: hidden; }
.summary { display: grid; grid-template-columns: 16px minmax(0, 1fr) 16px; column-gap: 10px; align-items: center; width: 100%; margin: 0; padding: 8px 10px; border: 0; background: transparent; text-align: left; }
.summary:hover { background: var(--hover); }
.summary:focus-visible { outline-offset: -2px; }
.summary svg { width: 16px; height: 16px; }
.summary svg:last-child { color: var(--drawdy-muted-foreground); }
.warnings.open .summary svg:last-child { transform: rotate(180deg); }
/* The list slides open and shut as the step rows do, and while shut is gone from the page's reading order. */
.warnings-wrap { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .14s ease-in; }
.warnings.open .warnings-wrap { grid-template-rows: 1fr; transition: grid-template-rows .18s ease-out; }
.warnings-list { min-height: 0; overflow: hidden; visibility: hidden; transition: visibility 0s .14s; }
.warnings.open .warnings-list { visibility: visible; transition: none; }
.warnings-list > .annotation { border-top: 1px solid var(--drawdy-border); }
.annotation { display: grid; grid-template-columns: 16px minmax(0, 1fr); column-gap: 10px; padding: 8px 10px; }
.annotation.failure { border-radius: var(--drawdy-radius-md); background: color-mix(in srgb, var(--drawdy-destructive) 14%, transparent); }
.annotation svg { width: 16px; height: 16px; margin-top: 1px; }
.annotation p { margin: 0; }
.annotation .title { font-weight: 600; }
.annotation .detail { font-size: 12px; line-height: 17px; color: var(--drawdy-muted-foreground); }
.annotation .detail:empty { display: none; }
/* A step's rows slide open as it starts, once it has run a moment, and shut as it ends: their height only, never a fade, which a busy board can leave half drawn. */
.rows-wrap { animation: open .18s ease-out .2s both; }
.rows-wrap.closing { animation: shut .14s ease-in both; }
@keyframes open { from { grid-template-rows: 0fr; } }
@keyframes shut { to { grid-template-rows: 0fr; } }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .steps svg, .line svg, .rows-wrap { animation: none !important; } .warnings-wrap, .warnings-list { transition: none !important; } }
.sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* Reading: the pull request, the current card (it scrolls), then the toolbar with every control. The one column never grows past the panel, whatever the description holds. */
#ready { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; grid-template-columns: minmax(0, 1fr); }
/* The toolbar keeps the last row while the card block above it is hidden. */
#ready > .tools { grid-row: 3; }
.pr { padding: 12px 14px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; border-bottom: 1px solid var(--drawdy-border); }
.pr-top { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
.meta { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.counts { font-size: 11.5px; font-weight: 500; }
.a { color: var(--add); } .d { color: var(--del); }
.state { padding: 0 7px; border-radius: 999px; font-size: 11px; line-height: 18px; font-weight: 600; color: #fff; }
.state.open { background: #1a7f37; } .state.draft { background: #6e7781; } .state.merged { background: #8250df; } .state.closed { background: #cf222e; }
.pr-title { font-size: 13.5px; line-height: 18px; font-weight: 600; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pr-title code { font-size: 12px; }

.spacer { flex: 1; }
.btn { height: 30px; min-width: 30px; margin: 0; padding: 0 10px; border: 1px solid var(--drawdy-border); border-radius: var(--drawdy-radius-md); background: var(--drawdy-surface); }
.btn:hover:not(:disabled) { background: var(--drawdy-surface2); }
.btn:disabled, .icon:disabled { opacity: .4; cursor: default; }
.step { display: grid; place-items: center; padding: 0; }
.step svg { width: 16px; height: 16px; }
#next:not(:disabled) { background: var(--drawdy-primary); color: var(--drawdy-primary-foreground); border-color: transparent; }
#next:not(:disabled) svg { stroke-width: 2.5; }
#position { min-width: 52px; text-align: center; font-size: 11.5px; }

.card { min-height: 0; display: flex; flex-direction: column; gap: 2px; padding: 12px 14px 0; }
.card-head { flex: none; display: flex; align-items: flex-start; justify-content: flex-end; gap: 10px; }
#name { flex: 1; min-width: 0; padding-top: 4px; font-weight: 600; overflow-wrap: anywhere; }
.status { display: inline-block; margin-left: 6px; padding: 0 5px; border-radius: 5px; font: 700 10px/16px ui-sans-serif, system-ui, sans-serif; letter-spacing: .06em; vertical-align: 1px; }
.status.NEW { background: var(--add-gut); color: var(--add); }
.status.TESTS { background: var(--blue); color: var(--drawdy-background); }
.status.UNCHANGED { background: var(--drawdy-border); color: var(--drawdy-foreground); }
#read-all { flex: none; height: 26px; margin: 0; padding: 0 9px; font-size: 12px; }
.path { flex: none; font-size: 11.5px; line-height: 16px; color: var(--drawdy-muted-foreground); overflow-wrap: anywhere; }
#links { flex: 0 1 auto; min-height: 0; overflow-y: auto; margin: 8px -14px 0; padding: 0 14px 12px; display: grid; grid-template-columns: max-content minmax(0, 1fr); column-gap: 10px; align-content: start; }
.kind { font-size: 12px; line-height: 24px; color: var(--drawdy-muted-foreground); }
#links button { justify-self: start; max-width: calc(100% + 6px); margin-left: -6px; padding: 3px 6px; border: 0; border-radius: 6px; background: transparent; text-align: left; font-size: 12px; overflow-wrap: anywhere; text-decoration: underline; text-decoration-color: var(--drawdy-border); text-underline-offset: 3px; }
/* A name with a string on the board takes its colour, as --string-0 to 7 in its style: the board's hue, readable on the panel. No fill on hover, so that colour reads on the panel's own background. */
#links button:hover { text-decoration-color: currentColor; }
/* At the PR card: who opened it and how big it is, then the whole description, which scrolls like the links. */
.about { flex: none; margin: 0; font-size: 11.5px; line-height: 16px; color: var(--drawdy-muted-foreground); }
/* What the board can't show, as the loading view said it: kept at the PR card. */
#pr-notes { flex: none; margin-top: 10px; }
/* A long URL or word wraps; code blocks and tables scroll sideways on their own. */
#pr-body { flex: 0 1 auto; min-height: 0; overflow-y: auto; margin: 8px -14px 0; padding: 0 14px 14px; overflow-wrap: anywhere; }
#pr-body .none { color: var(--drawdy-muted-foreground); font-style: italic; }

/* The toolbar: Home and Rebuild, Overview and Description, then the steps, Next at the right. A line above it shows a rebuild's progress, its cost or its error. */
.tools { padding: 8px 14px; border-top: 1px solid var(--drawdy-border); }
.tools .error, .line { margin: 0 0 8px; }
.line { display: flex; align-items: center; gap: 8px; font-size: 12px; line-height: 16px; color: var(--drawdy-muted-foreground); }
.line svg { flex: none; width: 16px; height: 16px; }
/* A rebuild's step too long for the line ends in an ellipsis. */
.line.busy span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar { display: flex; align-items: center; gap: 4px; }
/* Icon buttons: no frame until hovered; the house's left edge lines up with the text above. */
.icon { width: 30px; height: 30px; display: grid; place-items: center; margin: 0; padding: 0; border: 0; border-radius: var(--drawdy-radius-md); background: transparent; color: var(--drawdy-muted-foreground); }
.icon svg { width: 16px; height: 16px; }
.icon:hover:not(:disabled) { background: var(--hover); color: var(--drawdy-foreground); }
#home { margin-left: -7px; }
/* A rule between leaving or rebuilding the board and moving round it. */
.sep { width: 1px; height: 16px; margin: 0 4px; background: var(--shade); }
/* What the panel explains now: the description (a bar under its button) or a step (its number). */
.icon[aria-current="true"] { color: var(--drawdy-foreground); }
.icon[aria-current="true"]::before { content: ""; position: absolute; left: 7px; right: 7px; bottom: 2px; height: 2px; border-radius: 1px; background: currentColor; }
/* Rebuild pressed once on a pull request that costs more than 2 requests: held down until the second press. */
#rebuild.armed { background: var(--shade); color: var(--drawdy-foreground); }
/* A tooltip above each button: after a moment under the pointer, at once on keyboard focus. */
[data-tip] { position: relative; }
[data-tip]::after { content: attr(data-tip); position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 1; padding: 3px 8px; border-radius: var(--drawdy-radius-sm); background: var(--drawdy-foreground); color: var(--drawdy-background); font: 11.5px/16px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity .1s; }
.step[data-tip]::after { left: auto; right: 0; }
[data-tip]:hover::after { opacity: 1; transition-delay: .4s; }
[data-tip]:focus-visible::after { opacity: 1; transition-delay: 0s; }
`;

/** GitHub's Markdown styles (`MARKDOWN_CSS`, which loads before this) fitted to the panel: 13 px text, smaller headings and gaps, code and tables that scroll sideways. */
export const PANEL_MD_CSS = `
#pr-body { --ink: var(--drawdy-foreground); --ink2: var(--drawdy-muted-foreground); --bg: var(--drawdy-background); --bg2: var(--drawdy-surface2); font-size: 13px; line-height: 20px; }
#pr-body :is(p, blockquote, ul, ol, table, pre, details) { margin-bottom: 12px; }
#pr-body :is(h1, h2, h3, h4, h5, h6) { margin: 16px 0 8px; }
#pr-body h1 { font-size: 16px; } #pr-body h2 { font-size: 15px; } #pr-body h3 { font-size: 14px; }
#pr-body ul, #pr-body ol { padding-left: 1.5em; }
#pr-body li > p { margin-top: 8px; }
#pr-body hr { margin: 16px 0; }
#pr-body pre { padding: 8px 12px; overflow-x: auto; font-size: 11.5px; line-height: 17px; }
#pr-body pre .l { min-height: 17px; }
#pr-body pre .l.add, #pr-body pre .l.del { margin: 0 -12px; padding: 0 12px; }
#pr-body table { overflow-x: auto; font-size: 12px; }
/* Cells break only between words, so a wide table scrolls sideways rather than splitting its numbers. */
#pr-body th, #pr-body td { padding: 4px 8px; line-height: 18px; overflow-wrap: break-word; }
`;

/** The example rows: each a button, the project-coloured tag on its own line, then the title. */
const exampleRows = SUGGESTIONS.map((s) => {
    const tag = `<span class="tag hue" style="--c: ${s.colour}">${escapeHtml(s.label)}</span>`;
    const line = s.cost ? `<span class="tagline">${tag}<span class="cost">${s.cost}</span></span>` : tag;
    return `<li><button type="button" data-url="${s.url}" data-label="${escapeHtml(s.label)}" title="${escapeHtml(s.url)}">${line}<span>${segmentsHtml(s.title)}</span></button></li>`;
}).join("");

/** A frame of warnings: one row that counts them and opens or closes the list under it, which the panel fills. */
const warningsGroup = (list: string) =>
    `<div class="warnings" hidden><button class="summary" type="button" aria-expanded="false" aria-controls="${list}">${icon("triangle-alert", 16)}<span></span>${icon("chevron-down", 16)}</button><div class="warnings-wrap"><div id="${list}" class="warnings-list"></div></div></div>`;

export const PANEL_BODY = `
<section id="start" hidden>
    <div class="field">${icon("link", 14)}<input id="start-url" type="text" inputmode="url" enterkeyhint="go" autocomplete="off" spellcheck="false" aria-label="GitHub PR link" placeholder="Paste a GitHub PR link" /></div>
    <p id="error" class="error" role="alert" hidden></p>
    <ul id="try" class="prs scroll" aria-label="Examples">${exampleRows}</ul>
</section>
<section id="loading" hidden>
    <div class="load-body scroll">
        <span id="loading-tag" class="tag"></span>
        <ol id="load-steps" class="steps" aria-label="Steps"></ol>
        <div id="load-notes" class="annotations" aria-live="polite">${warningsGroup("load-warnings")}<div class="failures"></div></div>
    </div>
    <p id="load-status" class="sr" aria-live="polite"></p>
    <div id="load-tools" class="tools" hidden>
        <nav class="bar" aria-label="PR">
            <button id="load-home" class="icon" type="button" aria-label="Home" data-tip="Home: open another PR">${icon("house", 16)}</button>
            <span class="spacer"></span>
            <button id="retry" class="btn" type="button">Try again</button>
        </nav>
    </div>
    <template id="mark-todo">${icon("circle", 16)}</template>
    <template id="mark-active">${icon("loader-circle", 16)}</template>
    <template id="mark-done">${icon("circle-check", 16)}</template>
    <template id="mark-warning">${icon("triangle-alert", 16)}</template>
    <template id="mark-failed">${icon("circle-x", 16)}</template>
    <template id="row-todo">${icon("circle", 12)}</template>
    <template id="row-active">${icon("circle-dot", 12)}</template>
    <template id="row-done">${icon("check", 12)}</template>
    <template id="row-warning">${icon("triangle-alert", 12)}</template>
    <template id="row-failed">${icon("x", 12)}</template>
</section>
<section id="ready" hidden>
    <div id="pr" class="pr">
        <div class="pr-top"><span id="pr-tag" class="tag"></span><span class="meta"><span class="counts mono"><span id="pr-add" class="a"></span> <span id="pr-del" class="d"></span></span><span id="pr-state" class="state"></span></span></div>
        <div id="pr-title" class="pr-title"></div>
    </div>
    <div id="card" class="card" hidden>
        <div id="card-head" class="card-head"><span id="name" class="mono"></span><button id="read-all" class="btn" type="button">Read all</button></div>
        <div id="path" class="path mono"></div>
        <div id="links" class="scroll"></div>
        <p id="about" class="about"></p>
        <div id="pr-notes" class="annotations">${warningsGroup("pr-warnings")}</div>
        <div id="pr-body" class="md scroll"></div>
    </div>
    <div class="tools">
        <p id="tools-line" class="line" role="status" hidden></p>
        <p id="tools-error" class="error" role="alert" hidden></p>
        <nav class="bar" aria-label="PR">
            <button id="home" class="icon" type="button" aria-label="Home" data-tip="Home: open another PR">${icon("house", 16)}</button>
            <button id="rebuild" class="icon" type="button" aria-label="Rebuild" data-tip="Rebuild this board from GitHub">${icon("refresh-cw", 16)}</button>
            <span class="sep"></span>
            <button id="overview" class="icon" type="button" aria-label="Overview" data-tip="Overview: the whole board">${icon("scan", 16)}</button>
            <button id="description" class="icon" type="button" aria-label="Description" data-tip="Description">${icon("file-text", 16)}</button>
            <span class="spacer"></span>
            <button id="previous" class="btn step" type="button" aria-label="Previous card" data-tip="Previous (←)">${icon("chevron-left", 16)}</button>
            <span id="position" class="mono" aria-live="polite"></span>
            <button id="next" class="btn step" type="button" aria-label="Next card" data-tip="Next (→)">${icon("chevron-right", 16)}</button>
        </nav>
    </div>
</section>
`;
