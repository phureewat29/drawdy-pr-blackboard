import { beforeAll, describe, expect, it } from "@jest/globals";
import { testSyntax } from "../../../test/parser.ts";
import { parseFacts } from "./facts.ts";
import { builtinRule, resolveAll, type LinkerConfig } from "./resolve.ts";
import type { Syntax } from "../../syntax.ts";

let syntax: Syntax;
beforeAll(async () => {
    syntax = await testSyntax();
});

const NO_BUILTINS: LinkerConfig = { paths: () => [], builtin: () => null };

/**
 * What each reference in `from` names, as `line name → unit ids`, with the
 * files given (path to lines) all read and all changed.
 */
const refs = (files: Record<string, string[]>, from: string, config = NO_BUILTINS): string[] => {
    const facts = Object.entries(files).map(([path, lines]) => parseFacts(syntax, path, lines.join("\n"))!);
    const names = new Map(facts.flatMap((f) => f.sites.map((s) => [`${f.path}:${s.start}`, s.name] as const)));
    return resolveAll(facts, new Set(Object.keys(files)), config)
        .filter((r) => r.path === from)
        .map((r) => `${r.line} ${names.get(`${r.path}:${r.start}`)} → ${r.units.map((u) => u.id).join(" ")}`);
};

describe("resolving a name", () => {
    it("follows scopes: a name declared nearer wins, and a parameter shadows a function", () => {
        expect(
            refs({ "a.ts": ["function run() {}", "function call(run: () => void) {", "  run()", "}", "function go() {", "  run()", "}"] }, "a.ts")
        ).toEqual(["6 run → a.ts:1"]);
    });

    it("never takes a name in a string, a template, a comment or an object key for a reference", () => {
        expect(refs({ "a.ts": ["function run() {}", '// run()', 'const s = "run()"', "const t = `run()`", "const o = { run: 1 }", "o.run"] }, "a.ts")).toEqual(["6 o → a.ts:5"]);
    });

    it("reaches another file only through an import: named, default, namespace, re-exported and required", () => {
        const files = {
            "lib/a.ts": ["export function named() {}", "export default function main() {}"],
            "lib/index.ts": ['export { named as renamed } from "./a"', 'export * from "./a"'],
            "lib/c.js": ["function helper() {}", "module.exports = { helper }"],
            "app.ts": [
                'import main, { named } from "./lib/a"',
                'import * as all from "./lib/a"',
                'import { renamed } from "./lib/index"',
                'const { helper } = require("./lib/c")',
                "main(); named(); all.named(); renamed(); helper()",
                "function named2() {}",
            ],
        };
        expect(refs(files, "app.ts")).toEqual([
            "1 main → lib/a.ts:2",
            "1 named → lib/a.ts:1",
            "3 renamed → lib/a.ts:1",
            "4 helper → lib/c.js:1",
            "5 main → lib/a.ts:2",
            "5 named → lib/a.ts:1",
            "5 named → lib/a.ts:1",
            "5 renamed → lib/a.ts:1",
        ]);
        // A file the PR didn't read names nothing.
        expect(refs({ "app.ts": ['import { named } from "./lib/a"', "named()"] }, "app.ts")).toEqual([]);
    });

    it("resolves members of a known receiver: this, super, new C(), a typed local and a prototype", () => {
        const files = {
            "a.ts": [
                "class Base {",
                "  start() {}",
                "}",
                "class Job extends Base {",
                "  run() {",
                "    this.stop()",
                "    super.start()",
                "  }",
                "  stop() {}",
                "}",
                "function use(job: Job) {",
                "  job.run()",
                "  new Job().stop()",
                "}",
            ],
            "e.js": ["function Emitter() {}", "Emitter.prototype.on = function on() {}", "Emitter.prototype.once = function once() {", "  this.on()", "}"],
        };
        expect(refs(files, "a.ts")).toEqual(["4 Base → a.ts:1", "6 stop → a.ts:9", "7 start → a.ts:2", "11 Job → a.ts:4", "12 run → a.ts:5", "13 Job → a.ts:4", "13 stop → a.ts:9"]);
        expect(refs(files, "e.js").filter((r) => r.startsWith("4 "))).toEqual(["4 on → e.js:2"]);
    });

    it("makes no link through an untyped parameter, nor to a member set only under an if beside one always set", () => {
        const files = {
            "a.js": [
                "function Emitter(opts) {",
                "  this.emit = emitPlain",
                "  if (opts) this.emit = emitCaptured",
                "}",
                "function emitPlain() {}",
                "function emitCaptured() {}",
                "Emitter.prototype.fire = function () {",
                "  this.emit()",
                "}",
                "function untyped(emitter) {",
                "  emitter.fire()",
                "}",
            ],
        };
        expect(refs(files, "a.js").filter((r) => /^(8|11) /.test(r))).toEqual(["8 emit → a.js:5"]);
    });
});

describe("the builtin rule", () => {
    const changed = (paths: string[]) => new Set(paths);

    it("takes a Node built-in for the repository's own file in nodejs/node and oven-sh/bun, only when the PR changes it", () => {
        const node = builtinRule({ owner: "nodejs", repo: "node", number: 1 }, changed(["lib/events.js", "lib/fs/promises.js", "lib/test.js"]));
        expect(["events", "node:events", "fs/promises", "node:test", "test", "path"].map(node)).toEqual(["lib/events.js", "lib/events.js", "lib/fs/promises.js", "lib/test.js", null, null]);
        const bun = builtinRule({ owner: "oven-sh", repo: "bun", number: 1 }, changed(["src/js/node/events.ts", "src/js/node/fs.promises.ts"]));
        expect(["node:events", "events", "fs/promises", "node:fs"].map(bun)).toEqual(["src/js/node/events.ts", "src/js/node/events.ts", "src/js/node/fs.promises.ts", null]);
        expect(builtinRule({ owner: "honojs", repo: "hono", number: 1 }, changed(["lib/events.js"]))("events")).toBeNull();
    });

    it("links a test that imports the built-in to the changed file's declarations", () => {
        const files = { "src/js/node/events.ts": ["export function once() {}"], "test/events.test.ts": ['import { once } from "node:events"', "once()"] };
        const bun = { paths: () => [], builtin: builtinRule({ owner: "oven-sh", repo: "bun", number: 1 }, new Set(Object.keys(files))) };
        expect(refs(files, "test/events.test.ts", bun)).toEqual(["1 once → src/js/node/events.ts:1", "2 once → src/js/node/events.ts:1"]);
        expect(refs(files, "test/events.test.ts")).toEqual([]);
    });
});
