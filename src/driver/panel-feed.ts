/**
 * What the driver keeps for the panel, and the views it sends: at once when the phase or a step changes, at most
 * every `PROGRESS_MS` while a step's rows do.
 */

import type { Channel } from "./channel.ts";
import type { Navigator } from "./navigator.ts";
import { viewOf, type PanelState } from "./panel-view.ts";
import { createJob, type Job, type Progress } from "./progress.ts";
import type { Quota } from "./quota.ts";
import { quotaLow } from "./warnings.ts";
import { failureOf } from "./words.ts";

/** How often at most the panel gets a view while a PR loads: its rows change many times a second. */
const PROGRESS_MS = 50;

export type PanelFeed = PanelState & {
    /** Sends the panel its view now. */
    push: () => void;
    /** `job` as an open's progress on the loading view; `first` runs before its first change. */
    loadingProgress: (job: Job, first?: () => void) => Progress;
    /** `job` as a rebuild's progress: its line names the step only, so its rows send nothing. */
    rebuildProgress: (job: Job) => Progress;
    /** The open on the loading view failed: its failed step and why stay there, with Home and Try again. */
    fail: (job: Job, err: unknown) => void;
};

export const createPanelFeed = (deps: { channel: Channel; guide: Navigator; quota: () => Quota | null }): PanelFeed => {
    const { channel, guide, quota } = deps;
    let pending: ReturnType<typeof setTimeout> | null = null;
    let pushed = 0;

    const push = () => {
        if (pending) clearTimeout(pending);
        pending = null;
        pushed = Date.now();
        channel.post({ type: "view", view: viewOf(panel, guide, quota(), Date.now()) });
    };

    /** `push` for a step's rows: at most once every `PROGRESS_MS`, the last change always sent. */
    const pushSoon = () => {
        if (pending) return;
        const wait = pushed + PROGRESS_MS - Date.now();
        if (wait <= 0) push();
        else pending = setTimeout(push, wait);
    };

    /**
     * `job` as an open's progress: a step's or a parser's change shown at once, a file's by `rows`. `first` runs before
     * the first change. Once the PR is read, a quota running low is a warning on its step.
     */
    const progressOf = (job: Job, first: () => void, rows: () => void): Progress => {
        let started = false;
        const shown =
            <A extends unknown[]>(report: (...args: A) => void, show: () => void) =>
            (...args: A) => {
                if (!started) first();
                started = true;
                report(...args);
                show();
            };
        return {
            step: shown((step, state, words) => {
                job.step(step, state, words);
                if (step === "pr" && state === "done") job.warn("pr", quotaLow(quota(), Date.now()));
            }, push),
            reading: shown(job.reading, push),
            read: shown(job.read, rows),
            followed: shown(job.followed, rows),
            parser: shown(job.parser, push),
        };
    };

    const panel: PanelFeed = {
        phase: "start",
        error: null,
        job: createJob(),
        opening: null,
        rebuilding: null,
        unread: new WeakMap(),
        push,
        loadingProgress: (job, first = () => {}) => progressOf(job, first, pushSoon),
        rebuildProgress: (job) => progressOf(job, () => {}, () => {}),
        fail: (job, err) => {
            console.error("[pr-blackboard]", err);
            job.fail(failureOf(err, job.at()));
            panel.phase = "loading";
            push();
        },
    };
    return panel;
};
