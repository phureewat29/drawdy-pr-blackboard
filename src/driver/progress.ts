/**
 * An open's loading steps, as the panel lists them, in the manner of a CI
 * job: each step's state, when it started and ended, its rows while it runs,
 * and the warnings found on the way. The runtime keeps one job for the open
 * on the loading view and one for a rebuild; `loadReview` and the parser
 * report into it (`Progress`).
 */

import { count, plural } from "../lib/fp.ts";
import type { Annotation, LoadStep, StepRow, StepState } from "../shared/protocol.ts";
import { notFound, notRead, tooLong } from "./warnings.ts";

/** The loading view's steps, in the order they show; the parser's shows only while a parser downloads, beside the reads. */
export type StepKey = "pr" | "parser" | "files" | "link" | "pin";

/** What an open tells the loading view as it goes. */
export type Progress = {
    /** A step under way or done, renamed to `label` and given a muted `note` when they are known, and how far it has got of how many (`[8, 23]`). */
    step: (step: StepKey, state: "active" | "done", words?: { label?: string; note?: string; count?: [number, number] }) => void;
    /** The changed files read whole, in reading order, and how many more the read limits leave out. */
    reading: (paths: readonly string[], left: number) => void;
    /** A changed file read and parsed, too long to use, or not found: each in reading order. */
    read: (path: string, state: "done" | "long" | "missing") => void;
    /** How many files have been read so far to follow imports. */
    followed: (files: number) => void;
    /** A language's parser downloading, downloaded, or failed. */
    parser: (language: string, state: "active" | "done" | "failed") => void;
};

/** Progress nobody shows: a teammate's Read all that builds the review. */
export const quiet: Progress = { step: () => undefined, reading: () => undefined, read: () => undefined, followed: () => undefined, parser: () => undefined };

/** What reading left out: how many changed files the read limits left unread, and those read too long to use or not found. */
export type Unread = { left: number; long: string[]; missing: string[] };

export type Job = Progress & {
    /** A warning found on `step`'s way: the step ends with a warning. */
    warn: (step: StepKey, warning: Annotation | null) => void;
    /** The step the open is at: one that failed, else the last under way. */
    at: () => StepKey | undefined;
    /** The open failed: the step it is at shows so, and `why` goes under the steps. */
    fail: (why: Annotation) => void;
    /** The steps as the panel shows them now. */
    steps: () => LoadStep[];
    annotations: () => Annotation[];
    /** The words of the step under way, else of the last one done: a rebuild's line. */
    current: () => string;
    unread: () => Unread;
};

/** Rows a step lists at most; past them, one row says how many more. */
export const MAX_ROWS = 10;

type Step = { key: StepKey; label: string; note?: string; count?: [number, number]; state: StepState; started?: number; ended?: number };

/** The time a step took, as CI shows it: `0.4 s`, `12 s`. */
export const took = (ms: number): string => (ms < 9950 ? `${Math.max(0.1, Math.round(ms / 100) / 10).toFixed(1)} s` : `${count(Math.round(ms / 1000))} s`);

const ORDER: StepKey[] = ["pr", "parser", "files", "link", "pin"];
/** The warnings in the order the PR card gives them (`warningsOf`): the card limit's first, then the PR's, then the files'. */
const WARNING_ORDER: StepKey[] = ["pin", "pr", "files", "parser", "link"];

export const createJob = (now: () => number = Date.now): Job => {
    let steps: Step[] = [
        { key: "pr", label: "Reading the PR", state: "todo" },
        { key: "files", label: "Reading the changed files", state: "todo" },
        { key: "link", label: "Finding the lines", state: "todo" },
        { key: "pin", label: "Pinning the cards", state: "todo" },
    ];
    const warnings: { step: StepKey; note: Annotation }[] = [];
    let failure: Annotation | null = null;
    let files: string[] = [];
    let left = 0;
    const outcomes = new Map<string, "done" | "long" | "missing">();
    let followed = 0;
    const languages = new Map<string, "active" | "done" | "failed">();

    const find = (key: StepKey) => steps.find((s) => s.key === key);
    const at = () => steps.find((s) => s.state === "failed") ?? [...steps].reverse().find((s) => s.state === "active");
    const warned = (key: StepKey) => warnings.some((w) => w.step === key);
    const end = (s: Step, state: StepState = warned(s.key) ? "warning" : "done") => {
        if (s.state === "done" || s.state === "warning" || s.state === "failed") return;
        s.state = state;
        s.ended = now();
    };

    /**
     * Starting a step ends the ones before it, but the parser's, which runs
     * beside the reads and ends on its own; a step before it that never ran
     * is dropped: a stored review is pinned without reading or linking.
     */
    const step: Progress["step"] = (key, state, words = {}) => {
        let s = find(key);
        if (!s) {
            s = { key, label: words.label ?? "", state: "todo" };
            steps = [...steps, s].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
        }
        Object.assign(s, words);
        if (s.state === "todo") {
            s.state = "active";
            s.started = now();
        }
        const place = ORDER.indexOf(key);
        steps = steps.filter((o) => o === s || o.key === "parser" || ORDER.indexOf(o.key) > place || o.state !== "todo");
        for (const o of steps) if (o !== s && o.key !== "parser" && key !== "parser" && ORDER.indexOf(o.key) < place && o.state === "active") end(o);
        if (state === "done") end(s);
    };

    /** The files step ends once every changed file is read, with what reading left out, and finding the lines starts. */
    const readAll = () => {
        if (outcomes.size < files.length) return;
        const long = files.filter((p) => outcomes.get(p) === "long");
        const missing = files.filter((p) => outcomes.get(p) === "missing");
        for (const w of [notRead(left), tooLong(long), notFound(missing)]) if (w) warnings.push({ step: "files", note: w });
        step("link", "active");
    };

    /** The parser's step names how many parsers download, and ends when the last one does; a language an import needs later opens it again. */
    const parserStep = () => {
        const states = [...languages.values()];
        const s = find("parser");
        if (!s) return;
        s.label = states.length === 1 ? "Downloading the parser" : `Downloading ${states.length} parsers`;
        if (states.includes("failed")) end(s, "failed");
        else if (states.every((x) => x === "done")) end(s);
        else if (s.state === "done") {
            s.state = "active";
            s.ended = undefined;
        }
    };

    const rowsOf = (s: Step): Pick<LoadStep, "rows" | "more"> => {
        if (s.state !== "active" && s.state !== "failed") return {};
        if (s.key === "parser") return { rows: [...languages].map(([label, state]): StepRow => ({ label, state })) };
        if (s.key !== "files" || files.length === 0) return {};
        // The first file not yet read is the one under way: the reads come in order.
        const next = files.findIndex((p) => !outcomes.has(p));
        const rows = files.slice(0, MAX_ROWS).map((label, i): StepRow => {
            const got = outcomes.get(label);
            const state: StepState = got === "done" ? "done" : got ? "warning" : i === next && s.state === "active" ? "active" : "todo";
            return { label, state, file: true };
        });
        return files.length > MAX_ROWS ? { rows, more: files.length - MAX_ROWS } : { rows };
    };

    /** At a step's right: how far it has got while it runs, and where it stopped if it failed on the way; else the time it took. */
    const metaOf = (s: Step): string | undefined => {
        const counted = s.count ? `${count(s.count[0])} / ${count(s.count[1])}` : undefined;
        if (s.state === "failed" && counted) return counted;
        if (s.started !== undefined && s.ended !== undefined) return took(s.ended - s.started);
        if (s.state !== "active") return undefined;
        if (counted) return counted;
        if (s.key === "files" && files.length > 0) return `${count(outcomes.size)} / ${count(files.length)}`;
        if (s.key === "link" && followed > 0) return plural(followed, "file");
        return undefined;
    };

    return {
        step,
        reading: (paths, unread) => {
            files = [...paths];
            left = unread;
            if (files.length === 0) {
                steps = steps.filter((s) => s.key !== "files");
                readAll();
                return;
            }
            step("files", "active", { label: `Reading ${plural(files.length, "changed file")}` });
        },
        read: (path, state) => {
            if (!files.includes(path) || outcomes.has(path)) return;
            outcomes.set(path, state);
            readAll();
        },
        followed: (n) => {
            followed = n;
        },
        parser: (language, state) => {
            if (!find("parser")) step("parser", "active");
            if (languages.get(language) === "failed") return;
            languages.set(language, state);
            parserStep();
        },
        warn: (key, warning) => {
            if (!warning) return;
            warnings.push({ step: key, note: warning });
            const s = find(key);
            if (s?.state === "done") s.state = "warning";
        },
        at: () => at()?.key,
        fail: (why) => {
            failure = why;
            const failed = at();
            if (failed) end(failed, "failed");
            // What ran beside it stops where it was.
            for (const s of steps) if (s.state === "active") s.state = "todo";
        },
        steps: () =>
            steps.map((s) => {
                const meta = metaOf(s);
                return { key: s.key, label: s.label, ...(s.note ? { note: s.note } : {}), state: s.state, ...(meta ? { meta } : {}), ...rowsOf(s) };
            }),
        annotations: () => [...[...warnings].sort((a, b) => WARNING_ORDER.indexOf(a.step) - WARNING_ORDER.indexOf(b.step)).map((w) => w.note), ...(failure ? [failure] : [])],
        current: () => (steps.find((s) => s.state === "active") ?? [...steps].reverse().find((s) => s.state !== "todo") ?? steps[0]).label,
        unread: () => ({ left, long: files.filter((p) => outcomes.get(p) === "long"), missing: files.filter((p) => outcomes.get(p) === "missing") }),
    };
};
