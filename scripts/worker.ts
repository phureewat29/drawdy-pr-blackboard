/**
 * Writes src/worker/script.ts: the parser worker (src/worker/main.ts and
 * what it imports) bundled by esbuild into one script, kept as text. The
 * marketplace builds the extension from src/index.ts alone and allows no
 * import but @drawdy/driver-protocol, so the worker's code reaches the
 * driver as a string, which it starts as a worker from a blob: URL
 * (src/driver/parser.ts).
 *
 * Usage: node scripts/worker.ts          write it, when it is behind its sources
 *        node scripts/worker.ts --check  fail when it is behind its sources
 */

import { build } from "esbuild";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(import.meta.dirname, "..");
export const SCRIPT_FILE = join(ROOT, "src/worker/script.ts");

/** The text of src/worker/script.ts for the sources as they are now. */
export const workerScriptFile = async (): Promise<string> => {
    const result = await build({
        entryPoints: ["src/worker/main.ts"],
        absWorkingDir: ROOT,
        bundle: true,
        format: "iife",
        platform: "browser",
        target: "es2020",
        minify: false,
        write: false,
        logLevel: "silent",
    });
    const code = result.outputFiles[0].text;
    const literal = code.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
    return `/**
 * The parser worker's script: src/worker/main.ts and what it imports, bundled
 * as text by \`npm run worker\`. Generated: run that command after changing
 * anything the worker uses. A test fails while this is behind its sources.
 */
export const WORKER_SCRIPT = \`${literal}\`;
`;
};

/** Writes the script, or with `--check` exits non-zero when it is behind its sources. */
const main = async () => {
    const wanted = await workerScriptFile();
    const current = existsSync(SCRIPT_FILE) ? readFileSync(SCRIPT_FILE, "utf8") : "";
    if (process.argv.includes("--check")) {
        console.log(current === wanted ? "src/worker/script.ts is current" : "src/worker/script.ts is behind its sources: run npm run worker");
        process.exit(current === wanted ? 0 : 1);
    }
    // An unchanged file isn't written, so the dev server doesn't rebuild for nothing.
    if (current === wanted) return console.log("src/worker/script.ts is current");
    writeFileSync(SCRIPT_FILE, wanted);
    console.log(`wrote src/worker/script.ts (${(Buffer.byteLength(wanted) / 1024).toFixed(1)} KB)`);
};

// The tests import this module for `workerScriptFile`; only `node scripts/worker.ts` runs it.
if (process.argv[1] === fileURLToPath(import.meta.url)) void main();
