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

#loading { padding: 14px; gap: 14px; }
#loading > .tag { align-self: flex-start; }
#load-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
#load-steps li { display: flex; align-items: center; gap: 10px; color: var(--drawdy-muted-foreground); }
#load-steps li.done, #load-steps li.active { color: var(--drawdy-foreground); }
#load-steps .note { font-size: inherit; line-height: inherit; }
/* Lucide marks: circle to do, loader-circle turning, circle-check done, filled as a lime disc with a dark tick. */
#load-steps svg { flex: none; width: 16px; height: 16px; color: var(--drawdy-border); }
#load-steps .active svg, .line svg { color: var(--drawdy-primary); animation: spin .8s linear infinite; }
#load-steps .done svg { color: var(--drawdy-primary-foreground); }
#load-steps .done svg circle { fill: var(--drawdy-primary); stroke: var(--drawdy-primary); }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { #load-steps .active svg, .line svg { animation: none; } }

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

export const PANEL_BODY = `
<section id="start" hidden>
    <div class="field">${icon("link", 14)}<input id="start-url" type="text" inputmode="url" enterkeyhint="go" autocomplete="off" spellcheck="false" aria-label="GitHub PR link" placeholder="Paste a GitHub PR link" /></div>
    <p id="error" class="error" role="alert" hidden></p>
    <ul id="try" class="prs scroll" aria-label="Examples">${exampleRows}</ul>
</section>
<section id="loading" hidden>
    <span id="loading-tag" class="tag"></span>
    <ol id="load-steps"></ol>
    <template id="mark-todo">${icon("circle", 16)}</template>
    <template id="mark-active">${icon("loader-circle", 16)}</template>
    <template id="mark-done">${icon("circle-check", 16)}</template>
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
