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

describe("a value with a declared type", () => {
    it("is what its type says, as TypeScript reads it: the object literal it starts as lends no members", () => {
        const files = {
            "a.ts": [
                "export interface Api { load(): void }",
                "function load() {}",
                "export const api: Api = { load }",
                "export const raw = { load }",
                "api.load()",
                "raw.load()",
            ],
        };
        expect(refs(files, "a.ts").filter((r) => r.startsWith("5 ") || r.startsWith("6 "))).toEqual(["5 api → a.ts:3", "6 raw → a.ts:4", "6 load → a.ts:2"]);
    });

    it("of a union type names a member only when every type of the union names the same one: TypeScript narrows it where the reader can't see", () => {
        const files = {
            "a.ts": [
                "export class Base { stop() {} }",
                "export class A extends Base { run() {} }",
                "export class B extends Base { run() {} }",
                "export const u: A | B = new A()",
                "u.run()",
                "u.stop()",
                "export function use(p: A | B | null, q: (A | B)) { p.run(); q.stop() }",
                "export const n: A | null = new A()",
                "n.run()",
            ],
        };
        expect(refs(files, "a.ts").filter((r) => / (run|stop) /.test(r))).toEqual(["6 stop → a.ts:1:stop", "7 stop → a.ts:1:stop", "9 run → a.ts:2:run"]);
    });
});

describe("a value TypeScript types otherwise than it is built", () => {
    const base = ["export class Base { run() {} }", "export class Derived extends Base { run() {} }"];
    const runs = (files: Record<string, string[]>, from: string) => refs(files, from).filter((r) => / (run|go|start) /.test(r));

    it("is what a type assertion says when the read files declare its type; `as const`, `as any` or a package's type keeps the value, the code that runs", () => {
        const files = {
            "base.ts": base,
            "a.ts": [
                "import { Base, Derived } from './base'",
                "export const v = { run() {} } as Base",
                "v.run()",
                "export const w = new Derived() as unknown as Base",
                "w.run()",
                "export function use(o: object) { (o as Base).run(); (<Base>o).run() }",
                "export const c = { go() {} } as const",
                "c.go()",
                "export const n = new Derived() as any",
                "n.run()",
            ],
        };
        expect(runs(files, "a.ts")).toEqual(["3 run → base.ts:1:run", "5 run → base.ts:1:run", "6 run → base.ts:1:run", "6 run → base.ts:1:run", "8 go → a.ts:7:go", "10 run → base.ts:2:run"]);
        // What an asserted value names stays its own: an import of `fn as Api` names fn.
        const exported = { "api.ts": ["export interface Api { (): void }", "function fn() {}", "export default fn as Api"], "use.ts": ["import F from './api'", "F()"] };
        expect(refs(exported, "use.ts")).toEqual(["1 F → api.ts:2", "2 F → api.ts:2"]);
    });

    it("is nothing known from an object literal a call takes, unless the call returns it (`Object.freeze`)", () => {
        const files = {
            "a.ts": [
                "export class Svc { start() {} }",
                "function make<T>(o: Partial<T>): T { return o as T }",
                "export const t = make<Svc>({ start() {} })",
                "t.start()",
                "export const f = Object.freeze({ go() {} })",
                "f.go()",
                "module.exports = make({ go() {} })",
                "function Root() {}",
                "export const Parts = Object.assign(Root, { go() {} })",
                "Parts.go()",
            ],
        };
        expect(runs(files, "a.ts")).toEqual(["6 go → a.ts:5:go", "10 go → a.ts:9:go"]);
    });

    it("is what a JSDoc type says in JavaScript: a variable's `@type`, a parameter's `@param`, a field's, a property's or a `this.x`'s `@type`", () => {
        const files = {
            "base.js": base,
            "a.js": [
                "import { Base, Derived } from './base.js'",
                "/** @type {Base | null} */",
                "export const y = new Derived()",
                "y.run()",
                "/** @type {import('./base.js').Base} */",
                "export const y2 = { run() {} }",
                "y2.run()",
                "/** @param {Base} b @param {Base} [c] */",
                "export function use(b = new Derived(), c) { b.run(); c.run() }",
                "export class C {",
                "  /** @type {Base} */",
                "  x = new Derived()",
                "  go() { this.x.run() }",
                "}",
                "export const o = {",
                "  /** @type {Base} */",
                "  p: new Derived(),",
                "}",
                "o.p.run()",
                "export function K() {",
                "  /** @type {Base} */",
                "  this.k = new Derived()",
                "}",
                "new K().k.run()",
            ],
        };
        expect(runs(files, "a.js")).toEqual([
            "4 run → base.js:1:run",
            "7 run → base.js:1:run",
            "9 run → base.js:1:run",
            "9 run → base.js:1:run",
            "13 run → base.js:1:run",
            "19 run → base.js:1:run",
            "24 run → base.js:1:run",
        ]);
    });

    it("is nothing known from a JSDoc type that names no class: a type literal, a typedef, a built-in; and in TypeScript, JSDoc is no type", () => {
        const files = {
            "base.js": base,
            "a.js": [
                "import { Derived } from './base.js'",
                "/** @type {{ run: () => void }} */",
                "export const a = new Derived()",
                "a.run()",
                "/** @typedef {Object} Shape */",
                "/** @type {Shape} */",
                "export const b = new Derived()",
                "b.run()",
                "/** @returns {Derived} */",
                "export function mk() { return new Derived() }",
                "mk().run()",
            ],
            "base.ts": base,
            "c.ts": ["import { Base, Derived } from './base'", "/** @type {Base} */", "export const d = new Derived()", "d.run()"],
        };
        expect(runs(files, "a.js")).toEqual([]);
        expect(runs(files, "c.ts")).toEqual(["4 run → base.ts:2:run"]);
    });
});

describe("one site, one line", () => {
    const named = (files: Record<string, string[]>, from: string, names: RegExp) => refs(files, from).filter((r) => names.test(r));

    it("names a getter for a read, a setter for a write, and neither for an update (`+=`, `++`)", () => {
        const files = {
            "a.ts": [
                "export class Prefs {",
                "  get memories() { return 1 }",
                "  set memories(v: number) {}",
                "}",
                "export const p = new Prefs()",
                "export const n = p.memories",
                "p.memories = 2",
                "p.memories += 1",
                "p.memories++",
            ],
        };
        expect(named(files, "a.ts", / memories /)).toEqual(["6 memories → a.ts:2", "7 memories → a.ts:3"]);
    });

    it("takes a getter's read for what the getter returns, never the getter", () => {
        const files = {
            "a.js": [
                "export class Node {",
                "  constructor(config) { this.loaded = !config.lazy || this.isLeaf; this.leaf = this.isLeaf }",
                "  get isLeaf() { return true }",
                "  check() { return this.loaded && this.leaf }",
                "}",
            ],
        };
        expect(named(files, "a.js", / (isLeaf|loaded|leaf) /)).toEqual(["2 isLeaf → a.js:3", "2 isLeaf → a.js:3"]);
    });

    it("takes destructuring into a member and a `for` head for writes, and `delete` for no accessor", () => {
        const files = {
            "a.ts": [
                "export class Size {",
                "  get width() { return 1 }",
                "  set width(v: number) {}",
                "  fromArray(a: number[]) { [this.width] = a }",
                "  fromObject(o: { w: number }) { ({ w: this.width } = o) }",
                "  fromDefault(o: { w?: number }) { ({ w: this.width = 1 } = o) }",
                "  loop(list: number[]) { for (this.width of list) {} }",
                "  forget() { delete (this as any).width }",
                "}",
            ],
        };
        expect(named(files, "a.ts", / width /)).toEqual(["4 width → a.ts:3", "5 width → a.ts:3", "6 width → a.ts:3", "7 width → a.ts:3"]);
    });

    it("draws nothing for a value one branch of which is unknown or a package's", () => {
        const files = {
            "a.ts": [
                "import { RemoteStore } from 'remote-store'",
                "export class LocalStore { get() {} }",
                "export const defaultStore = new LocalStore()",
                "export function pick(opts: any, flag: boolean) {",
                "  const a = opts.store || defaultStore",
                "  a.get()",
                "  const b = flag ? new LocalStore() : new RemoteStore()",
                "  b.get()",
                "  const c = flag ? new LocalStore() : defaultStore",
                "  c.get()",
                "}",
            ],
        };
        expect(named(files, "a.ts", / get /)).toEqual(["10 get → a.ts:2:get"]);
        // A field declared without a value holds nothing until assigned, so its assignment says what it holds; JSDoc on it is its type.
        const fields = {
            "a.js": [
                "export class Store { get() {} }",
                "export class Holder {",
                "  #store;",
                "  /** @type {Store} */",
                "  typed;",
                "  constructor() { this.#store = new Store(); this.typed = makeIt() }",
                "  read() { this.#store.get(); this.typed.get() }",
                "}",
                "function makeIt() { return null }",
            ],
        };
        expect(named(fields, "a.js", / get /)).toEqual(["7 get → a.js:1:get", "7 get → a.js:1:get"]);
        const typed = { "a.ts": ["export class Store { get() {} }", "declare function makeIt(): any", "export class Holder {", "  store: Store", "  constructor() { this.store = makeIt() }", "  read() { this.store.get() }", "}"] };
        expect(named(typed, "a.ts", / get /)).toEqual(["6 get → a.ts:1:get"]);
        // A value of several types at once is no such merge: `T & typeof Local` has Local's members.
        const both = { "a.ts": ["import type { Ext } from 'ext'", "export const Local = { get() {} }", "declare const v: Omit<Ext, 'get'> & typeof Local", "v.get()"] };
        expect(named(both, "a.ts", / get /)).toEqual(["4 get → a.ts:2:get"]);
    });

    it("draws nothing for a value of either of two branches unless both name one declaration", () => {
        const files = {
            "a.ts": [
                "export class Base { stop() {} }",
                "export class A extends Base { run() {} }",
                "export class B extends Base { run() {} }",
                "export function f(flag: boolean, b?: B) {",
                "  const x = flag ? new A() : new B()",
                "  x.run()",
                "  x.stop()",
                "  const y = b ?? new A()",
                "  y.run()",
                "}",
            ],
        };
        expect(named(files, "a.ts", / (run|stop) /)).toEqual(["7 stop → a.ts:1:stop"]);
    });

    it("lets `const X = require('m')` name what X holds, and its own declaration only when it holds nothing read", () => {
        const files = {
            "lib.js": ["function main() {}", "module.exports = main"],
            "use.js": ["const lib = require('./lib.js')", "const pkg = require('pkg')", "lib()", "pkg()"],
        };
        expect(refs(files, "use.js")).toEqual(["3 lib → lib.js:1", "4 pkg → use.js:2"]);
    });
});

describe("`Object.assign`'s result", () => {
    it("names what its first argument names; a member is the last argument's that has it", () => {
        const files = {
            "a.js": [
                "function assert(v) {}",
                "function strict(v) {}",
                "function helper() {}",
                "assert.strict = Object.assign(strict, assert, { helper })",
                "assert.strict(true)",
                "assert.strict.helper()",
                "export const defaults = { format() {}, parse() {} }",
                "export function override() {}",
                "export const options = Object.assign({}, defaults, { format: override })",
                "options.format()",
                "options.parse()",
            ],
        };
        expect(refs(files, "a.js").filter((r) => / (strict|helper|format|parse) /.test(r))).toEqual([
            "4 strict → a.js:2",
            "4 helper → a.js:3",
            "5 strict → a.js:2",
            "6 strict → a.js:2",
            "6 helper → a.js:3",
            "10 format → a.js:8",
            "11 parse → a.js:7:parse",
        ]);
    });

    it("takes from a later source only its own members, and none known past a package's value", () => {
        const files = {
            "a.ts": [
                "import theme from 'some-theme'",
                "export class Svc { start() {} }",
                "export const plain = { start() {}, stop() {} }",
                "export const copy = Object.assign({}, plain, new Svc())",
                "copy.start()",
                "export const copy2 = Object.assign({}, new Svc())",
                "copy2.start()",
                "export const themed = Object.assign({}, plain, theme)",
                "themed.stop()",
                "export const target = Object.assign(new Svc(), {})",
                "target.start()",
            ],
        };
        expect(refs(files, "a.ts").filter((r) => / (start|stop) /.test(r))).toEqual(["5 start → a.ts:3:start", "11 start → a.ts:2:start"]);
    });

    it("has no member known past a source that may hold any (unknown, a spread); `export default Object.assign(…)` is its statement", () => {
        const files = {
            "a.js": [
                "export const DEFAULTS = { onError(e) {}, retries: 3 }",
                "export function create(options, more) {",
                "  const opts = Object.assign({}, DEFAULTS, options)",
                "  opts.onError()",
                "  const all = Object.assign({}, DEFAULTS, ...more)",
                "  all.onError()",
                "}",
            ],
            "menu.ts": ["function Menu() {}", "function Item() {}", "const parts = { Item }", "export default Object.assign(Menu, parts)"],
            "use.ts": ["import Menu from './menu'", "Menu()", "Menu.Item()"],
        };
        expect(refs(files, "a.js").filter((r) => / onError /.test(r))).toEqual([]);
        expect(refs(files, "use.ts")).toEqual(["1 Menu → menu.ts:4", "2 Menu → menu.ts:4", "3 Menu → menu.ts:4", "3 Item → menu.ts:2"]);
        // A dotted name exported as default is what it names, as TypeScript resolves the entity.
        const dotted = { "m.ts": ["export const api = { run() {} }", "export default api.run"], "use.ts": ["import run from './m'", "run()"] };
        expect(refs(dotted, "use.ts")).toEqual(["1 run → m.ts:1:run", "2 run → m.ts:1:run"]);
    });
});

describe("a type assertion", () => {
    it("takes the members of a type the read files declare, keeps the value's own for one outside them, and knows none for one it can't resolve", () => {
        const files = {
            "a.ts": [
                "import type { Ext } from 'pkg'",
                "export class Svc { start() {} }",
                "export class Box { start() {} }",
                "const impl = { start() {} }",
                "export const a = (impl as Svc).start()",
                "export const b = (impl as any).start()",
                "export const c = (impl as Ext).start()",
                "export function f<T>() { return (impl as unknown as T).start() }",
                "export const d = (impl as ReturnType<() => Svc>).start()",
                "export function g<Box>() { return (impl as Box).start() }",
                "export namespace N { export class Box { start() {} } }",
                "export const e = (impl as N.Box).start()",
            ],
        };
        expect(refs(files, "a.ts").filter((r) => / start /.test(r))).toEqual(["5 start → a.ts:2:start", "6 start → a.ts:4:start", "7 start → a.ts:4:start"]);
    });
});

describe("JSDoc types the evaluator doesn't take", () => {
    it("are a `@template` name, a `@typedef` around the use, a later declarator's, and a member typed and assigned another value", () => {
        const files = {
            "svc.js": ["export class Svc { start() {} }", "export class Other { start() {} }", "export class T { start() {} }"],
            "a.js": [
                "import { Svc, Other, T } from './svc.js'",
                "/**",
                " * @template T",
                " * @param {T} x",
                " */",
                "export function f(x) { x.start() }",
                "export function g() {",
                "  /** @typedef {Other} Svc */",
                "  /** @type {Svc} */",
                "  const y = make()",
                "  y.start()",
                "}",
                "/** @type {Svc} */",
                "let a = make(), b = new Other()",
                "a.start()",
                "b.start()",
                "export class Holder {",
                "  constructor() {",
                "    /** @type {Svc} */",
                "    this.svc = null",
                "  }",
                "  run() { this.svc.start() }",
                "  swap() { this.svc = new Other() }",
                "}",
                "function make() { return null }",
            ],
        };
        expect(refs(files, "a.js").filter((r) => / start /.test(r))).toEqual(["15 start → svc.js:1:start", "16 start → svc.js:2:start"]);
    });
});

describe("names in types", () => {
    it("take a function type's, a signature's, an index signature's, a mapped type's, an `infer`'s or a tuple's labels for names, never references to a declaration of the same name", () => {
        const files = {
            "a.ts": [
                "export const settings = 1",
                "export type K = string",
                "export type U = number",
                "export type Handler = (settings?: number) => void",
                "export type Make = new (settings: number) => object",
                "export interface Api { (settings: number): void; new (settings: string): Api; [settings: string]: unknown }",
                "export type Keys<T> = { [K in keyof T]: K }",
                "export type Item<T> = T extends (infer U)[] ? U : never",
                "export type Uses = typeof settings | K | U",
                "export type Events = { confirm: [number, settings: () => void, ...rest: string[]] }",
            ],
        };
        expect(refs(files, "a.ts")).toEqual(["6 Api → a.ts:6", "9 settings → a.ts:1", "9 K → a.ts:2", "9 U → a.ts:3"]);
    });

    it("take an `infer` for its conditional type's own name, however deep in its `extends` clause it sits", () => {
        const files = {
            "a.ts": [
                "export interface R { r: number }",
                "export type Ret<T> = T extends (...args: any[]) => infer R ? R : never",
                "export type First<T> = T extends [infer R, ...unknown[]] ? R : never",
                "export type Made<T> = T extends new () => infer R ? R : never",
                "export type Got<T> = T extends { get(): infer R } ? R : never",
                "export type Outer<T> = T extends Promise<infer R> ? (R extends (infer V)[] ? V : R) : never",
                "export type Plain = R",
            ],
        };
        expect(refs(files, "a.ts")).toEqual(["7 R → a.ts:1"]);
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
