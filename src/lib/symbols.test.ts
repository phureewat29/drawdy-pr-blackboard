import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePatch } from "./diff.ts";
import { changedSymbols, findDecls, labelOf, testCases } from "./symbols.ts";

const fixture = JSON.parse(readFileSync(join(process.cwd(), "src/lib/fixtures/hono-5513.json"), "utf8"));
const heads = new Map<string, string[]>(Object.entries(fixture.raw as Record<string, string>).map(([p, t]) => [p, t.split("\n")]));
const patchOf = (path: string) => parsePatch(fixture.files.find((f: { filename: string }) => f.filename === path).patch);

describe("findDecls", () => {
    it("finds methods, private ones included, inside a class whose header spans lines", () => {
        const names = findDecls(heads.get("src/hono-base.ts")!, "ts").map((d) => `${d.kind}:${d.parent ? `${d.parent}.` : ""}${d.name}`);
        expect(names).toEqual(expect.arrayContaining(["class:Hono", "method:Hono.#handleError", "method:Hono.#dispatch", "method:Hono.onError"]));
    });

    it("ends a declaration where the code returns to its indentation, through a multi-line signature", () => {
        const dispatch = findDecls(heads.get("src/hono-base.ts")!, "ts").find((d) => d.name === "#dispatch")!;
        expect([dispatch.start, dispatch.end]).toEqual([411, 471]);
    });

    it("takes no `type X,` inside a multi-line import for a declaration", () => {
        const lines = ["import {", "  type Options,", "  parse,", '} from "./parse"', "type Mode = 1"];
        expect(findDecls(lines, "ts").map((d) => d.name)).toEqual(["Mode"]);
    });

    it("finds a class field typed as a function across lines, but not a field that only has that type", () => {
        const fetch = findDecls(heads.get("src/hono-base.ts")!, "ts").find((d) => d.name === "fetch")!;
        expect([fetch.kind, fetch.start, fetch.end]).toEqual(["method", 484, 490]);
        const typed = ["class A {", "  handler: (", "    a: string", "  ) => void", "  run() {", "    return 1", "  }", "}"];
        expect(findDecls(typed, "ts").map((d) => d.name)).toEqual(["A", "run"]);
    });

    it("treats # as a comment only where the language does", () => {
        const py = ["class A:", "    # note", "    def run(self):", "        return 1", "", "def helper():", "    pass"];
        expect(findDecls(py, "py").map((d) => `${d.kind}:${d.name}:${d.start}-${d.end}`)).toEqual(["class:A:1-4", "method:run:3-4", "function:helper:6-7"]);
    });

    it("keeps helpers nested in a function inside it", () => {
        const names = findDecls(heads.get("src/compose.ts")!, "ts").map((d) => d.name);
        expect(names).toContain("compose");
        expect(names).not.toContain("dispatch");
    });
});

describe("Rust declarations", () => {
    const rs = [
        "pub struct Request {",
        "    id: u32,",
        "}",
        "",
        "impl Request {",
        "    pub fn new(id: u32) -> Self {",
        "        Self { id }",
        "    }",
        "",
        "    fn then(&self) -> u32 {",
        "        self.id",
        "    }",
        "}",
        "",
        "impl Drop for crate::dns::Lookup {",
        "    fn drop(&mut self) {}",
        "}",
        "",
        "fn helper() {}",
    ];

    it("take `fn new`, a constructor, and name a method with its type: two cards called `then()` would read the same", () => {
        const fns = findDecls(rs, "rs").filter((d) => d.kind === "function" || d.kind === "method");
        expect(fns.map((d) => labelOf(d, "rs"))).toEqual(["Request::new()", "Request::then()", "Lookup::drop()", "helper()"]);
    });

    it("leave other languages' names as they were: a statement in a class is no method, and a method is named alone", () => {
        const ts = ["class A {", "  if (ready) {", "    go()", "  }", "  run() {", "    return 1", "  }", "}"];
        expect(findDecls(ts, "ts").map((d) => labelOf(d, "ts"))).toEqual(["class A", "run()"]);
    });
});

describe("Python and Go declarations a parser can't read", () => {
    it("take `def new` and `def delete`, and name a method with its class", () => {
        const py = ["class Store:", "    def new(self):", "        pass", "", "    def delete(self, key):", "        pass", "", "def delete(key):", "    pass"];
        expect(findDecls(py, "py").map((d) => labelOf(d, "py"))).toEqual(["class Store", "Store.new()", "Store.delete()", "delete()"]);
    });

    it("name a Go method with its receiver's type, and run a function past a label at column 0", () => {
        const go = ["func (s *Server[T]) Start() error {", "loop:", "\tfor {", "\t\tbreak loop", "\t}", "\treturn nil", "}", "", "func main() {}"];
        expect(findDecls(go, "go").map((d) => `${labelOf(d, "go")} ${d.start}-${d.end}`)).toEqual(["Server.Start() 1-7", "main() 9-9"]);
    });
});

describe("changedSymbols", () => {
    it("names what a diff changed, and gives a doc comment to the declaration below it", () => {
        const { symbols, loose } = changedSymbols("src/hono-base.ts", "ts", heads.get("src/hono-base.ts")!, patchOf("src/hono-base.ts"));
        expect(symbols.map((s) => `${s.label} ${s.status} ${s.from}-${s.to}`)).toEqual([
            "onError() changed 260-261",
            "#handleError() changed 406-408",
            "#dispatch() changed 451-451",
        ]);
        expect(loose).toEqual([{ path: "src/hono-base.ts", from: 7, to: 7, add: 1, del: 1 }]);
    });

    it("marks a declaration whose first line is added as new", () => {
        const { symbols } = changedSymbols("src/compose.ts", "ts", heads.get("src/compose.ts")!, patchOf("src/compose.ts"));
        expect(symbols.map((s) => `${s.label} ${s.status} +${s.add} −${s.del}`)).toEqual(["toError() new +3 −0", "compose() changed +4 −3"]);
    });
});

describe("testCases", () => {
    it("reads test names, including it.each with the name on the next line", () => {
        const names = testCases(patchOf("src/hono.test.ts")).map((c) => `${c.t} ${c.name}`);
        expect(names).toContain("del Should throw Error if a non-Error object is thrown in a handler");
        expect(names).toContain("add Should pass a non-Error value thrown from a %s handler to onError as an Error cause");
        expect(names).toHaveLength(8);
    });
});
