/** The view the panel is sent: made from what the driver keeps for it and where the navigator is. */

import { chipOf, foldsOf, linkGroups, pinCard, whereOf } from "../lib/card.ts";
import { plural } from "../lib/fp.ts";
import { pageCount, prLabel } from "../lib/github.ts";
import { stepsOf } from "../lib/layout.ts";
import { lexMarkdown, markdownHtml, segments } from "../lib/markdown.ts";
import type { Pin, Review } from "../lib/model.ts";
import type { Annotation, CurrentCard, PanelView } from "../shared/protocol.ts";
import { projectColour } from "../shared/suggestions.ts";
import type { Navigator } from "./navigator.ts";
import type { Job, Unread } from "./progress.ts";
import type { Quota } from "./quota.ts";
import { warningsOf } from "./warnings.ts";

/** The one rebuild that may run, from the moment it is asked for: its board, its own steps, and when it ends. */
export type Rebuilding = { key: string; label: string; job: Job; done: Promise<void> };

/** What the driver keeps for the panel, beside the navigator's place. */
export type PanelState = {
    phase: PanelView["phase"];
    /** Why the reader's last action failed, in words: under the start view's field, or on the toolbar's line. */
    error: string | null;
    /** The open the loading view shows. */
    job: Job;
    /** The PR being opened, which the loading view's tag names. */
    opening: string | null;
    rebuilding: Rebuilding | null;
    /** What this session's reads left out of each review it built: none for a stored copy, which was read before. */
    unread: WeakMap<Review, Unread>;
};

const tagOf = (label: string | null): PanelView["tag"] => (label ? { label, colour: projectColour(label) } : null);

/** What reading a PR from GitHub again costs, when that is more than the usual 2 requests: the PR, then its file list's pages. */
export const rebuildCostOf = (changedFiles: number): PanelView["rebuildCost"] => {
    const requests = 1 + pageCount(changedFiles);
    return requests > 2 ? { files: changedFiles, requests } : null;
};

/** Each review's description as the panel shows it, rendered once: a rebuild sends views many times a second. */
const descriptions = new WeakMap<Review, string | null>();
const descriptionOf = (review: Review): string | null => {
    if (!descriptions.has(review)) descriptions.set(review, review.pr.body.trim() ? markdownHtml(lexMarkdown(review.pr.body), "page") : null);
    return descriptions.get(review)!;
};

/**
 * What the panel says about the current card. At the PR card: who opened it and how big it is, what the board can't
 * show, and the whole description. At a code card: its name, chip and place, and its links by kind, each in its
 * string's colour (`colourOf`) when it has one.
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

/** A rebuild's line: the step it has reached, named by its PR when seen from another board. */
const rebuildLine = (run: Rebuilding, on: string | undefined): string => (on === run.key ? run.job.current() : `${run.label} · ${run.job.current()}`);

export const viewOf = (state: PanelState, guide: Navigator, quota: Quota | null, now: number): PanelView => {
    const { phase, job, opening, rebuilding } = state;
    const review = guide.review();
    const pinId = guide.currentPin();
    const pin = pinId ? review?.pins.find((p) => p.id === pinId) : undefined;
    const loading = phase === "loading";
    return {
        phase: phase === "ready" && !review ? "start" : phase,
        loading: loading ? job.steps() : [],
        annotations: loading ? job.annotations() : [],
        error: state.error,
        tag: tagOf(loading && opening ? opening : review ? prLabel(review.pr.ref) : null),
        pr: review ? { title: segments(review.pr.title), state: review.pr.state, additions: review.pr.additions, deletions: review.pr.deletions } : null,
        total: review ? stepsOf(review).length : 0,
        current: guide.current(),
        hasPrevious: guide.hasPrevious(),
        hasNext: guide.hasNext(),
        // The loading view shows no card and gets many views a second: the card is made only for the others.
        card: review && pin && !loading ? currentCardOf(review, pin, guide.colourOf, pin.kind === "pr" ? warningsOf(review, state.unread.get(review), quota, now) : []) : null,
        rebuildCost: review ? rebuildCostOf(review.pr.changedFiles) : null,
        rebuilding: rebuilding ? rebuildLine(rebuilding, guide.board()?.key) : null,
    };
};
