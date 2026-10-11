/**
 * The parser worker: reads, parses and links a pull request into its review
 * and its board's plan, off Drawdy's driver worker, which every extension
 * shares. The driver sends the pull request and its file list; the worker
 * reads the files from raw.githubusercontent.com itself, and asks the driver
 * for the parser's files, which only the driver can keep and check
 * (`driver/grammars.ts`).
 *
 * `serve` takes the worker's global scope, or a stand-in for it: where a
 * worker can't start, the driver runs the same script on its own thread
 * (`driver/parser.ts`), and the tests run this module as it is.
 */

import { parseFacts } from "../lib/facts.ts";
import { createGithub, type Fetch, type PrFile, type PrInfo } from "../lib/github.ts";
import type { BoardPlan } from "../lib/layout.ts";
import { analyse, compact, type Review } from "../lib/model.ts";
import { changedSources, type Parse } from "../lib/sources.ts";
import { createSyntax, grammarOf, type Grammar, type Syntax } from "../lib/syntax.ts";

/** A file the parser needs: the tree-sitter runtime, or a grammar. */
export type ParserFile = Grammar | "runtime";

export type ToWorker =
    | { type: "analyse"; id: number; pr: PrInfo; files: PrFile[] }
    /** The bytes of a file asked for, checked; null when the driver couldn't have them. */
    | { type: "file"; ask: number; bytes: Uint8Array | null };

export type FromWorker =
    /** The grammars the changed files need, so the driver loads them beside the reads. */
    | { type: "load"; id: number; grammars: Grammar[] }
    | { type: "file"; ask: number; name: ParserFile }
    /** The review as the driver keeps it (`compact`), and its board's plan. */
    | { type: "done"; id: number; review: Review; plan: BoardPlan }
    /** `parser`: the parser itself couldn't start or load a grammar, rather than a pull request it couldn't read. */
    | { type: "failed"; id: number; message: string; parser: boolean };

/** What the worker uses of its global scope. */
export type WorkerScope = {
    fetch: Fetch;
    postMessage: (message: FromWorker) => void;
    onmessage: ((event: { data: ToWorker }) => void) | null;
};

/** The cause of an error from loading the parser itself. */
const PARSER = "parser";

const parserError = (err: unknown): Error => {
    if (err instanceof Error && err.cause === PARSER) return err;
    console.error("[pr-blackboard] the parser won't run", err);
    return new Error(err instanceof Error ? err.message : String(err), { cause: PARSER });
};

/** `start` starts tree-sitter from the runtime's bytes; the tests stand in a failing one. */
export const serve = (scope: WorkerScope, start: (runtime: Uint8Array) => Promise<Syntax> = createSyntax): void => {
    const github = createGithub((url, init) => scope.fetch(url, init));

    // The parser's files, each asked of the driver once per load, and answered by its ask's number.
    let asks = 0;
    const answers = new Map<number, (bytes: Uint8Array | null) => void>();
    const fileOf = (name: ParserFile): Promise<Uint8Array> =>
        new Promise((resolve, reject) => {
            const ask = asks++;
            answers.set(ask, (bytes) => (bytes ? resolve(bytes) : reject(new Error(`No ${name} file`, { cause: PARSER }))));
            scope.postMessage({ type: "file", ask, name });
        });

    // What this worker has loaded: the runtime started, and each grammar added. A failure is forgotten, so the next open tries again.
    let syntax: Promise<Syntax> | null = null;
    const added = new Map<Grammar, Promise<void>>();
    const load = async (grammar: Grammar): Promise<Syntax> => {
        try {
            if (!syntax) {
                syntax = fileOf("runtime").then(start);
                syntax.catch(() => (syntax = null));
            }
            const s = await syntax;
            let hit = added.get(grammar);
            if (!hit) {
                hit = fileOf(grammar).then((bytes) => s.add(grammar, bytes));
                hit.catch(() => added.delete(grammar));
                added.set(grammar, hit);
            }
            await hit;
            return s;
        } catch (err) {
            throw parserError(err);
        }
    };

    const parse: Parse = async (path, text) => {
        const grammar = grammarOf(path);
        if (!grammar) return null;
        const s = await load(grammar);
        try {
            return parseFacts(s, path, text);
        } catch (err) {
            // One file the parser can't read falls back to the line patterns.
            console.warn(`[pr-blackboard] couldn't parse ${path}`, err);
            return null;
        }
    };

    const run = async ({ id, pr, files }: { id: number; pr: PrInfo; files: PrFile[] }) => {
        try {
            const grammars = [...new Set(changedSources(files).map((f) => grammarOf(f.path)).filter((x): x is Grammar => x !== null))];
            scope.postMessage({ type: "load", id, grammars });
            const { review, plan } = await analyse(pr, files, (path) => github.raw(pr.headRepo, pr.headSha, path), parse);
            scope.postMessage({ type: "done", id, review: compact(review), plan });
        } catch (err) {
            scope.postMessage({ type: "failed", id, message: err instanceof Error ? err.message : String(err), parser: err instanceof Error && err.cause === PARSER });
        }
    };

    scope.onmessage = ({ data }) => {
        if (data.type === "analyse") {
            void run(data);
            return;
        }
        answers.get(data.ask)?.(data.bytes);
        answers.delete(data.ask);
    };
};
