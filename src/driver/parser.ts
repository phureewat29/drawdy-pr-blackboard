/**
 * Reading, parsing and linking a pull request off Drawdy's driver worker,
 * which every extension shares, so a big pull request stalls none of them:
 * in a worker of PR Blackboard's own, started from its script
 * (`../worker/script.ts`). Where no worker can start, the same script runs
 * on this thread. Either way the driver answers the worker's asks for the
 * parser's files (`grammars.ts`), which only it can keep.
 */

import { serial } from "../lib/fp.ts";
import type { Fetch, PrFile, PrInfo } from "../lib/github.ts";
import type { Built } from "../lib/model.ts";
import type { Grammar } from "../lib/syntax.ts";
import { WORKER_SCRIPT } from "../worker/script.ts";
import type { FromWorker, ToWorker, WorkerScope } from "../worker/serve.ts";
import type { Ddp } from "./ddp.ts";
import { createGrammars, languagesOf } from "./grammars.ts";
import { inWords } from "./words.ts";

/** The driver's end of a channel to the worker's side; `close` ends a real worker. */
export type Port = { post: (message: ToWorker) => void; close?: () => void };

/**
 * Starts the worker's side: `receive` gets each message it sends, and
 * `broken` is called when it can't run at all.
 */
export type Connect = (fetch: Fetch, receive: (message: FromWorker) => void, broken: (err: unknown) => void) => Port;

/** The parser step of the loading view: a download under way, in words, or done. */
export type ParserStep = (state: "active" | "done", words?: { label: string; note: string }) => void;

export type Parser = {
    /** The review of a pull request and its board's plan, from its files at the head commit. Rejects in words. */
    analyse: (pr: PrInfo, files: readonly PrFile[], step: ParserStep) => Promise<Built>;
};

/** How long an idle worker lives. Drawdy tells a driver nothing when it unloads, so a reloaded driver's worker ends on its own. */
const IDLE_MS = 30_000;

/** The worker's side run on this thread by `start`, each message copied and delivered later, as a worker's would be. */
export const onThisThread =
    (start: (scope: WorkerScope) => void): Connect =>
    (fetch, receive) => {
        const scope: WorkerScope = {
            fetch,
            postMessage: (message) => {
                const copy = structuredClone(message);
                setTimeout(() => receive(copy));
            },
            onmessage: null,
        };
        start(scope);
        return {
            post: (message) => {
                const copy = structuredClone(message);
                setTimeout(() => scope.onmessage?.({ data: copy }));
            },
        };
    };

/** The worker's script, run on this thread. */
const connectHere = onThisThread((scope) => new Function("self", WORKER_SCRIPT)(scope));

/** A worker of PR Blackboard's own, from its script as a blob: URL; where none can start, the script on this thread. */
export const connectWorker: Connect = (fetch, receive, broken) => {
    if (typeof Worker !== "function") return connectHere(fetch, receive, broken);
    const url = URL.createObjectURL(new Blob([WORKER_SCRIPT], { type: "text/javascript" }));
    let worker: Worker;
    try {
        worker = new Worker(url);
    } catch (err) {
        URL.revokeObjectURL(url);
        console.warn("[pr-blackboard] no parser worker, so parsing on this thread", err);
        return connectHere(fetch, receive, broken);
    }
    // The script is read once the worker runs it, which its first message shows.
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
        URL.revokeObjectURL(url);
        receive(e.data);
    };
    worker.onerror = (e) => {
        e.preventDefault();
        URL.revokeObjectURL(url);
        broken(new Error(e.message || "the parser worker failed"));
    };
    worker.onmessageerror = () => broken(new Error("a message from the parser worker couldn't be read"));
    return { post: (message) => worker.postMessage(message), close: () => worker.terminate() };
};

type Job = {
    request: Extract<ToWorker, { type: "analyse" }>;
    step: ParserStep;
    grammars: Grammar[];
    /** The parser's files the changed files need, loading beside the reads. */
    loading: Promise<unknown>;
    /** The first file that couldn't be had, in words. */
    failure: unknown;
    told: boolean;
    done: (built: Built) => void;
    fail: (err: unknown) => void;
};

/** `connect` starts the worker's side: a worker by default, the module itself in the tests and the score gate. */
export const createParser = (deps: { ddp: Ddp; fetch: Fetch; connect?: Connect }): Parser => {
    const { ddp, fetch, connect = connectWorker } = deps;
    const grammars = createGrammars({ ddp, fetch });
    const queue = serial();
    let port: Port | null = null;
    // Each connection's messages count only while it is the current one.
    let generation = 0;
    // A worker that broke is not started again: the script runs on this thread from then on.
    let here = false;
    let idle: ReturnType<typeof setTimeout> | null = null;
    let job: Job | null = null;

    const tell = (j: Job) => () => {
        if (j.told) return;
        j.told = true;
        j.step("active", { label: `Downloading the ${languagesOf(j.grammars).parser}`, note: "first time only" });
    };

    const receive = (to: Port, message: FromWorker) => {
        const j = job;
        if (!j) return;
        switch (message.type) {
            case "load": {
                j.grammars = message.grammars;
                if (message.grammars.length === 0) return;
                const words = languagesOf(message.grammars).parser;
                j.loading = Promise.all((["runtime", ...message.grammars] as const).map((name) => grammars.bytes(name, words, tell(j)))).then(() => j.step("done"));
                j.loading.catch((err: unknown) => (j.failure ??= err));
                return;
            }
            case "file":
                grammars.bytes(message.name, languagesOf(j.grammars).parser, tell(j)).then(
                    (bytes) => to.post({ type: "file", ask: message.ask, bytes }),
                    (err: unknown) => {
                        j.failure ??= err;
                        to.post({ type: "file", ask: message.ask, bytes: null });
                    }
                );
                return;
            case "done":
                if (message.id === j.request.id) j.done({ review: message.review, plan: message.plan });
                return;
            case "failed":
                if (message.id !== j.request.id) return;
                if (j.failure) j.fail(j.failure);
                else if (message.parser) j.fail(inWords(`Couldn't parse this PR's ${languagesOf(j.grammars).code}.`));
                else j.fail(new Error(message.message));
                return;
        }
    };

    const open = (): Port => {
        const mine = ++generation;
        const current = (here ? connectHere : connect)(
            fetch,
            (message) => mine === generation && receive(current, message),
            (err) => mine === generation && broken(err)
        );
        return current;
    };

    const broken = (err: unknown) => {
        console.warn("[pr-blackboard] the parser worker stopped, so parsing on this thread", err);
        port?.close?.();
        here = true;
        port = open();
        if (job) port.post(job.request);
    };

    let ids = 0;
    return {
        analyse: (pr, files, step) =>
            queue(async () => {
                if (idle) clearTimeout(idle);
                try {
                    const built = await new Promise<Built>((done, fail) => {
                        job = { request: { type: "analyse", id: ids++, pr, files: [...files] }, step, grammars: [], loading: Promise.resolve(), failure: null, told: false, done, fail };
                        port ??= open();
                        port.post(job.request);
                    });
                    // A file the changed files need and couldn't be had fails the open, as on this thread.
                    await job!.loading;
                    return built;
                } finally {
                    job = null;
                    if (port?.close) {
                        idle = setTimeout(() => {
                            port?.close?.();
                            port = null;
                        }, IDLE_MS);
                    }
                }
            }),
    };
};
