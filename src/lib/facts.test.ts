import { beforeAll, describe, expect, it } from "@jest/globals";
import { testSyntax } from "../test/parser.ts";
import { parseFacts, type FileFacts } from "./facts.ts";
import type { Syntax } from "./syntax.ts";

let syntax: Syntax;
beforeAll(async () => {
    syntax = await testSyntax();
});
const facts = (path: string, lines: string[]): FileFacts => parseFacts(syntax, path, lines.join("\n"))!;

describe("units", () => {
    it("are the declarations a card can stand for, with their lines, comments above included, and ids by name line", () => {
        const f = facts("src/a.ts", [
            "/** Runs. */",
            "export function run(x: number) {",
            "  const inner = () => x",
            "  return inner()",
            "}",
            "export class Box {",
            "  @logged",
            "  open(): void {}",
            "  get size() { return 1 }",
            "  close = () => 0",
            "}",
            "export type Mode = 1",
            "export const LIMIT = 3",
            "export const api = {",
            "  read() {},",
            "  write: function () {},",
            "}",
            "export namespace Space {}",
            "function over(a: string): void",
            "function over(a: number): void",
            "function over(a: unknown) {}",
        ]);
        expect(f.units.map((u) => `${u.id} ${u.kind} ${u.qname} ${u.docLine}-${u.endLine}`)).toEqual([
            "src/a.ts:2 function run 1-5",
            "src/a.ts:6 class Box 6-11",
            "src/a.ts:8 method Box.open 7-8",
            "src/a.ts:9 method Box.size 9-9",
            "src/a.ts:10 method Box.close 10-10",
            "src/a.ts:12 type Mode 12-12",
            "src/a.ts:13 value LIMIT 13-13",
            "src/a.ts:14 value api 14-17",
            "src/a.ts:15 method api.read 15-15",
            "src/a.ts:16 method api.write 16-16",
            "src/a.ts:18 namespace Space 18-18",
            "src/a.ts:19 function over 19-21",
        ]);
    });

    it("include prototype methods, through an alias of the prototype too, and CommonJS exports", () => {
        const f = facts("lib/e.js", [
            "function Emitter() {}",
            "Emitter.prototype.on = function on() {}",
            "const proto = Emitter.prototype",
            "proto.emit = function emit() {}",
            "module.exports.isAudit = function () {}",
        ]);
        expect(f.units.map((u) => `${u.kind} ${u.qname}`)).toEqual(["function Emitter", "method Emitter.prototype.on", "value proto", "method proto.emit", "function module.exports.isAudit"]);
    });
});

describe("sites", () => {
    it("are names that refer to something, never names in strings, templates, comments or object keys", () => {
        const f = facts("src/b.ts", [
            'import { run } from "./a"',
            "// run(1)",
            'const label = "run(2)"',
            "const shown = `run(${label})`",
            "const options = { run: 1 }",
            "run(options.run)",
        ]);
        expect(f.sites.filter((s) => s.name === "run").map((s) => `${s.line} ${s.ref} ${s.form}`)).toEqual(["1 import import", "6 call bare", "6 value member"]);
    });
});
