import { beforeAll, describe, expect, it } from "@jest/globals";
import { testSyntax } from "../test/parser.ts";
import { grammarOf } from "./language.ts";
import type { Flat, Syntax } from "./syntax.ts";

let syntax: Syntax;
beforeAll(async () => {
    syntax = await testSyntax();
});

describe("grammarOf", () => {
    it("reads TypeScript, TSX, JavaScript, Python, Go, Rust and Java by extension, and nothing else", () => {
        expect(["a.ts", "a.mts", "a.cts", "a.d.ts", "a.tsx", "a.js", "a.jsx", "a.mjs", "a.cjs", "a.py", "a.go", "a.rs", "A.java", "a.vue", "a.rb", "a.pyi", "a.kt", "a.scala"].map(grammarOf)).toEqual([
            "typescript", "typescript", "typescript", "typescript", "tsx", "javascript", "javascript", "javascript", "javascript", "python", "go", "rust", "java", null, null, null, null, null,
        ]);
    });
});

describe("the parser", () => {
    it("parses each grammar into a flat tree with its lines", () => {
        const ts = syntax.parse("a.ts", "export const a: number = 1\nfunction b() {}\n")!;
        expect(ts.type[0]).toBe("program");
        expect(ts.lineStarts).toEqual([0, 27, 43]);
        expect(syntax.parse("a.tsx", "export const A = () => <div>{1}</div>\n")!.errors).toBe(0);
        expect(syntax.parse("a.js", "module.exports = { a() {} }\n")!.errors).toBe(0);
        expect(["a.py", "a.go", "a.rs", "A.java"].map((p, i) => syntax.parse(p, ["def a(): pass\n", "package a\nfunc A() {}\n", "fn a() {}\n", "class A { void a() {} }\n"][i])!.errors)).toEqual([0, 0, 0, 0]);
    });

    it("carries what a grammar's own tags.scm defines, and none of what it references", () => {
        const defined = (t: Flat) => t.tags!.map((c) => `${c.capture} ${t.type[c.node]}`);
        const py = syntax.parse("a.py", "X = 1\n\nclass A:\n    def run(self):\n        return helper()\n\ndef helper():\n    pass\n")!;
        expect(defined(py)).toEqual(["definition.constant assignment", "definition.class class_definition", "definition.function function_definition", "definition.function function_definition"]);
        const go = syntax.parse("a.go", "package a\n\ntype S struct{}\n\nfunc (s *S) Run() { helper() }\n\nfunc helper() {}\n")!;
        expect(defined(go)).toEqual(["definition.type type_spec", "definition.method method_declaration", "definition.function function_declaration"]);
        const rs = syntax.parse("a.rs", "struct S;\nimpl S {\n    fn run(&self) { helper(); }\n}\nfn helper() {}\n")!;
        expect(defined(rs)).toEqual(["definition.class struct_item", "definition.method function_item", "definition.function function_item", "definition.function function_item"]);
        const java = syntax.parse("A.java", "class A {\n    A() {}\n    void run() { helper(); }\n    interface I {}\n    enum E { X }\n}\n")!;
        expect(defined(java)).toEqual(["definition.class class_declaration", "definition.method method_declaration", "definition.interface interface_declaration"]);
        expect(syntax.parse("a.ts", "function a() {}\n")!.tags).toBeUndefined();
    });

    it("reads a generic call signature after a member with no semicolon, as hono writes it", () => {
        const text = "export interface Store {\n  get: Getter\n  <K extends string>(key: K): number\n  set: Setter\n}\n";
        expect(syntax.parse("types.ts", text)!.errors).toBe(0);
    });

    it("leaves a Flow file, or one with too many errors, to the line patterns", () => {
        expect(syntax.parse("a.js", "/**\n * @flow strict\n */\nexport function a(x: number): number { return x }\n")).toBeNull();
        expect(syntax.parse("a.js", "// x @flow\nconst a = 1\n")).toBeNull();
        expect(syntax.parse("a.js", "const a = 1\n// the word @flow later is no pragma\n")).not.toBeNull();
        expect(syntax.parse("a.ts", "const a = 1\n".repeat(20) + "function ((( {{{ ]]] )))\n")).toBeNull();
    });
});
