import { resolveObjectURL } from "node:buffer";
import { Worker as Thread } from "node:worker_threads";

/**
 * What a thread runs before the script it is given: `self` is its global scope, as in a browser's worker, with
 * `postMessage` and `onmessage` crossing to the thread that started it; an unhandled rejection is logged, as a
 * browser does; and it has no `fetch`, so a request of the script's own fails.
 */
const PRELUDE = `
const { parentPort, workerData } = require("node:worker_threads");
globalThis.self = globalThis;
self.postMessage = (message) => parentPort.postMessage(message);
parentPort.on("message", (data) => self.onmessage?.({ data }));
process.on("unhandledRejection", (reason) => console.error(reason));
delete globalThis.fetch;
require("node:vm").runInThisContext(workerData, { filename: "worker.js" });
`;

/**
 * A browser's `Worker` for Node, as Drawdy gives one to the driver: the script behind a `blob:` URL runs on a thread
 * of its own. `stop` ends every thread started.
 */
export const nodeWorkers = () => {
    const threads = new Set<Promise<Thread>>();
    class NodeWorker {
        onmessage: ((event: { data: unknown }) => void) | null = null;
        onerror: ((event: { message: string; preventDefault: () => void }) => void) | null = null;
        onmessageerror: (() => void) | null = null;
        readonly #thread: Promise<Thread>;
        constructor(url: string) {
            const blob = resolveObjectURL(url);
            if (!blob) throw new Error(`no script at ${url}`);
            this.#thread = blob.text().then((script) => {
                const thread = new Thread(PRELUDE, { eval: true, workerData: script });
                thread.on("message", (data) => this.onmessage?.({ data }));
                thread.on("messageerror", () => this.onmessageerror?.());
                thread.on("error", (err) => this.onerror?.({ message: err.message, preventDefault: () => undefined }));
                return thread;
            });
            threads.add(this.#thread);
        }
        postMessage(message: unknown) {
            void this.#thread.then((thread) => thread.postMessage(message));
        }
        terminate() {
            void this.#thread.then((thread) => thread.terminate());
        }
    }
    const stop = async () => {
        const started = [...threads];
        threads.clear();
        await Promise.all(started.map(async (thread) => (await thread).terminate()));
    };
    return { Worker: NodeWorker, stop };
};
