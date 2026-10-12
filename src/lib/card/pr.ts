/**
 * The PR card: the header every card has (the PR's chip and its state), the
 * title, author and counts, what the board leaves off, then the whole
 * description as GitHub shows it. The board must read with the panel
 * closed, so the card shows the description however long, in a column of
 * its own.
 */

import { clamp, count, plural, sumBy } from "../fp.ts";
import { escapeHtml } from "../highlight.ts";
import { MARKDOWN_CSS, blocksHeight, lexMarkdown, markdownBlocks, markdownHtml, segments, segmentsHtml } from "../markdown.ts";
import type { Review } from "../model.ts";
import { CARD } from "./grid.ts";
import { cardCss, page, type Theme } from "./html.ts";

/**
 * The PR card's measures, in px: `titleChar`, about how wide a character of
 * the 20 px title runs; `meta`, from the title to the meta line's foot;
 * `rule`, 16 above the rule, the rule, 16 below.
 */
const PR = { width: 640, pad: 16, titleLine: 26, titleChar: 10.8, meta: 24, unpinned: 20, rule: 33 } as const;

type PrCardInput = Pick<Review, "pr" | "files" | "unpinned">;

/** `28 functions and 2 files not pinned`, or null when everything is. */
export const unpinnedText = ({ functions, files }: Review["unpinned"]): string | null => {
    const parts = [functions > 0 ? plural(functions, "function") : "", files > 0 ? plural(files, "file") : ""].filter(Boolean);
    return parts.length > 0 ? `${parts.join(" and ")} not pinned` : null;
};

export type PrCard = {
    width: number;
    height: number;
    titleLines: number;
    /** The whole description estimated at the card's width; 0 when there is none. */
    estimate: number;
};

/**
 * The PR card's size, with the description's tokens to render. A
 * component's height is fixed when it is made, for every viewer, so the
 * description is estimated block by block (`markdownBlocks`), a little over
 * what Chrome lays out.
 */
const measurePr = (review: PrCardInput) => {
    const tokens = lexMarkdown(review.pr.body);
    const inner = PR.width - 2 * PR.pad;
    const titleChars = sumBy(segments(review.pr.title), (s) => s.text.length * (s.code ? 1.15 : 1));
    const titleLines = clamp(Math.ceil((titleChars * PR.titleChar) / inner), 1, 3);
    const estimate = blocksHeight(markdownBlocks(tokens, inner));
    const top = CARD.header + PR.pad + titleLines * PR.titleLine + PR.meta + (unpinnedText(review.unpinned) ? PR.unpinned : 0) + (estimate > 0 ? PR.rule : 0);
    return { tokens, titleLines, estimate, height: top + estimate + PR.pad };
};

export const prCard = (review: PrCardInput): PrCard => {
    const { titleLines, estimate, height } = measurePr(review);
    return { width: PR.width, height, titleLines, estimate };
};

const STATE_STYLE: Record<string, string> = {
    open: "background:#1a7f37;color:#fff",
    draft: "background:#6e7781;color:#fff",
    merged: "background:#8250df;color:#fff",
    closed: "background:#cf222e;color:#fff",
};

const prCss = () => `
.prchip { flex: none; border: 1px solid var(--line); border-radius: 999px; padding: 2px 9px; font: 12px/16px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink2); }
.state { flex: none; border-radius: 999px; padding: 2px 10px; font: 600 12px/16px ui-sans-serif, system-ui, sans-serif; }
main { padding: ${PR.pad}px ${PR.pad}px 0; }
.title { font: 600 20px/${PR.titleLine}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; overflow-wrap: anywhere; }
.title code { padding: .1em .35em; font: 85% ui-monospace, SFMono-Regular, Menlo, monospace; background: rgb(129 139 152 / .12); border-radius: 6px; }
.meta { margin-top: 4px; height: 20px; color: var(--ink2); font-size: 12.5px; line-height: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.unpinned { height: ${PR.unpinned}px; line-height: ${PR.unpinned}px; font-size: 12.5px; color: var(--ink3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rule { margin: 16px 0; border: 0; height: 1px; background: var(--line); }
`;

const prHeader = ({ pr }: PrCardInput) =>
    `<header><span class="prchip">${escapeHtml(`${pr.ref.owner}/${pr.ref.repo}#${pr.ref.number}`)}</span><span class="state" style="${STATE_STYLE[pr.state]}">${pr.state[0].toUpperCase()}${pr.state.slice(1)}</span></header>`;

const prLead = (review: PrCardInput, titleLines: number) => {
    const { pr } = review;
    const unpinned = unpinnedText(review.unpinned);
    const clampCss = ` style="max-height:${titleLines * PR.titleLine}px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:${titleLines};-webkit-box-orient:vertical"`;
    return `<h1 class="title"${clampCss}>${segmentsHtml(segments(pr.title))}</h1>
<div class="meta">${escapeHtml(pr.author)} · ${plural(pr.changedFiles, "file")} · <span class="a mono">+${count(pr.additions)}</span> <span class="d mono">−${count(pr.deletions)}</span></div>${unpinned ? `<div class="unpinned">${unpinned}</div>` : ""}`;
};

/** The PR card's page. A `<details>` shows open, since nothing on a card can be clicked open; the description keeps its estimated height at most, against a teammate's fonts. */
export const prCardHtml = (review: PrCardInput, theme: Theme): string => {
    const m = measurePr(review);
    const css = `${cardCss()}${prCss()}${MARKDOWN_CSS}
.desc { max-height: ${m.estimate}px; overflow: hidden; }
`;
    const description = m.estimate > 0 ? `<hr class="rule"><div class="desc"><div class="md">${markdownHtml(m.tokens, "card")}</div></div>` : "";
    return page(css, `${prHeader(review)}<main>${prLead(review, m.titleLines)}${description}</main>`, theme);
};
