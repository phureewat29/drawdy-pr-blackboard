/** The repositories that implement Node's built-in modules, where an import of one names their own file. */

import type { PrRef } from "../github.ts";

/** Node 24's `builtinModules`; the last four exist only with the `node:` prefix. */
const NODE_BUILTINS = new Set([
    "_http_agent", "_http_client", "_http_common", "_http_incoming", "_http_outgoing", "_http_server", "_stream_duplex", "_stream_passthrough", "_stream_readable",
    "_stream_transform", "_stream_wrap", "_stream_writable", "_tls_common", "_tls_wrap", "assert", "assert/strict", "async_hooks", "buffer", "child_process", "cluster",
    "console", "constants", "crypto", "dgram", "diagnostics_channel", "dns", "dns/promises", "domain", "events", "fs", "fs/promises", "http", "http2", "https",
    "inspector", "inspector/promises", "module", "net", "os", "path", "path/posix", "path/win32", "perf_hooks", "process", "punycode", "querystring", "readline",
    "readline/promises", "repl", "stream", "stream/consumers", "stream/promises", "stream/web", "string_decoder", "sys", "timers", "timers/promises", "tls",
    "trace_events", "tty", "url", "util", "util/types", "v8", "vm", "wasi", "worker_threads", "zlib", "node:sea", "node:sqlite", "node:test", "node:test/reporters",
]);

/** Where each repository keeps a built-in's source: nodejs/node in `lib/x.js`, oven-sh/bun in `src/js/node/x.ts` with `/` read as `.`. */
const SOURCES: Record<string, (name: string) => string> = {
    "nodejs/node": (name) => `lib/${name}.js`,
    "oven-sh/bun": (name) => `src/js/node/${name.replaceAll("/", ".")}.ts`,
};

/**
 * The one guess the linker takes: in a repository that implements Node's
 * built-ins, an import of one means its own file, when the PR changes it.
 */
export const builtinRule = (base: PrRef, changed: ReadonlySet<string>): ((spec: string) => string | null) => {
    const fileOf = SOURCES[`${base.owner}/${base.repo}`.toLowerCase()];
    if (!fileOf) return () => null;
    return (spec) => {
        const name = spec.replace(/^node:/, "");
        if (!NODE_BUILTINS.has(spec) && !(NODE_BUILTINS.has(name) && !NODE_BUILTINS.has(`node:${name}`))) return null;
        const path = fileOf(name);
        return changed.has(path) ? path : null;
    };
};
