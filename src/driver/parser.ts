/**
 * Reading, parsing and linking a PR off Drawdy's driver worker, which every extension shares, so a big PR stalls
 * none of them: in a worker of PR Blackboard's own, started from its script (`../worker/script.ts`). Where no worker
 * can start, the same script runs on this thread. Either way the driver answers the worker's asks for the parser's
 * files (`grammars.ts`), which only it can keep.
 */

import { serial } from "../lib/fp.ts";
import type { Fetch, PrFile, PrInfo } from "../lib/github.ts";
import type { Built } from "../lib/model.ts";
import { WORKER_SCRIPT } from "../worker/script.ts";
import type { FromWorker, ParserFile, ToWorker, WorkerScope } from "../worker/serve.ts";
import type { Ddp } from "./ddp.ts";
import { createGrammars, languagesOf } from "./grammars.ts";
import type { Download, Progress } from "./progress.ts";
import { inWords } from "./words.ts";

/** The driver's end of a channel to the worker's side; `close` ends a real worker. */
export type Port = { post: (message: ToWorker) => void; close?: () => void };

/** Starts the worker's side: `receive` gets each message it sends, and `broken` is called when it can't run at all. */
export type Connect = (fetch: Fetch, receive: (message: FromWorker) => void, broken: (err: unknown) => void) => Port;

/** What the parser tells the loading view: each language's parser downloading, the changed files read, and the files read to follow imports. */
export type ParserProgress = Pick<Progress, "parser" | "reading" | "read" | "followed">;

export type Parser = {
    /** The review of a PR and its board's plan, from its files at the head commit. Rejects in words. */
    analyse: (pr: PrInfo, files: readonly PrFile[], progress: ParserProgress) => Promise<Built>;
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

const connectHere = onThisThread((scope) => new Function("self", WORKER_SCRIPT)(scope));

/** A worker of PR Blackboard's own, from its script as a blob: URL; where none can start, the script on this thread. */
const connectWorker: Connect = (fetch, receive, broken) => {
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

type Analysis = {
    request: Extract<ToWorker, { type: "analyse" }>;
    progress: ParserProgress;
    grammars: string[];
    /** The parser's files the changed files need, loading beside the reads. */
    loading: Promise<unknown>;
    /** The first file that couldn't be had, in words. */
    failure: unknown;
    /** Each parser file this open downloads: files from storage are not here. */
    downloads: Map<ParserFile, Download>;
    /** Each language's row as last told. */
    rows: Map<string, Download>;
    done: (built: Built) => void;
    fail: (err: unknown) => void;
};

/** A failure outweighs a download under way, which outweighs one done. */
const worse = (a: Download | undefined, b: Download): Download => (a === "failed" || b === "failed" ? "failed" : a === "active" || b === "active" ? "active" : "done");

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
    let analysis: Analysis | null = null;

    /**
     * The parser step's rows: a language is a row while one of its files downloads, its grammar or the runtime every
     * language needs; it is done when they are, and failed when one failed.
     */
    const report = (a: Analysis) => {
        const rows = new Map<string, Download>();
        for (const [name, state] of a.downloads) {
            const served = name === "runtime" ? a.grammars : [name];
            for (const language of served.map((g) => languagesOf([g]).code)) rows.set(language, worse(rows.get(language), state));
        }
        for (const [language, state] of rows) {
            if (a.rows.get(language) === state) continue;
            a.rows.set(language, state);
            a.progress.parser(language, state);
        }
    };

    /** A parser file for `a`: from storage, else downloaded, which the parser step shows. */
    const fileFor = (a: Analysis, name: ParserFile): Promise<Uint8Array> => {
        const got = grammars.bytes(name, languagesOf(a.grammars).parser, () => {
            a.downloads.set(name, "active");
            report(a);
        });
        const settle = (state: "done" | "failed") => {
            if (!a.downloads.has(name)) return;
            a.downloads.set(name, state);
            report(a);
        };
        got.then(
            () => settle("done"),
            () => settle("failed")
        );
        return got;
    };

    const receive = (to: Port, message: FromWorker) => {
        const a = analysis;
        if (!a) return;
        switch (message.type) {
            case "load": {
                a.grammars = message.grammars;
                if (message.grammars.length === 0) return;
                a.loading = Promise.all((["runtime", ...message.grammars] as const).map((name) => fileFor(a, name)));
                a.loading.catch((err: unknown) => (a.failure ??= err));
                return;
            }
            case "file":
                fileFor(a, message.name).then(
                    (bytes) => to.post({ type: "file", ask: message.ask, bytes }),
                    (err: unknown) => {
                        a.failure ??= err;
                        to.post({ type: "file", ask: message.ask, bytes: null });
                    }
                );
                return;
            case "reading":
                if (message.id === a.request.id) a.progress.reading(message.paths, message.left);
                return;
            case "read":
                if (message.id === a.request.id) a.progress.read(message.path, message.state);
                return;
            case "followed":
                if (message.id === a.request.id) a.progress.followed(message.files);
                return;
            case "done":
                if (message.id === a.request.id) a.done({ review: message.review, plan: message.plan });
                return;
            case "failed":
                if (message.id !== a.request.id) return;
                if (a.failure) a.fail(a.failure);
                else if (message.parser) a.fail(inWords(`Couldn't parse this PR's ${languagesOf(a.grammars).code}.`, "Parser failed"));
                else a.fail(new Error(message.message));
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
        if (analysis) port.post(analysis.request);
    };

    let ids = 0;
    return {
        analyse: (pr, files, progress) =>
            queue(async () => {
                if (idle) clearTimeout(idle);
                try {
                    const built = await new Promise<Built>((done, fail) => {
                        analysis = { request: { type: "analyse", id: ids++, pr, files: [...files] }, progress, grammars: [], loading: Promise.resolve(), failure: null, downloads: new Map(), rows: new Map(), done, fail };
                        port ??= open();
                        port.post(analysis.request);
                    });
                    // A file the changed files need and couldn't be had fails the open, as on this thread.
                    await analysis!.loading;
                    return built;
                } finally {
                    analysis = null;
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
