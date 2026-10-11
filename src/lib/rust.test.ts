import { describe, expect, it } from "@jest/globals";
import { codeOnly, rustFile } from "./rust.ts";
import { findDecls } from "./symbols.ts";

/** The calls a file proves, as `caller:line → callee:line`. */
const proved = (source: string) => {
    const lines = source.split("\n");
    const decls = findDecls(lines, "rs");
    const file = rustFile(lines, decls);
    return decls.flatMap((d) => file.calls(d).map((c) => `${d.name}:${d.start} → ${c.to.name}:${c.to.start}`));
};

describe("codeOnly", () => {
    it("blanks comments and literals, keeps lines, columns and lifetimes", () => {
        const text = `let a = "f(x)"; // g(y)\nlet b = r#"h("#; /* i( /* j( */ */ k('a', 'b);`;
        const code = codeOnly(text);
        expect(code.split("\n").map((l) => l.length)).toEqual(text.split("\n").map((l) => l.length));
        expect(code).not.toMatch(/[fghij]\(/);
        expect(code).toMatch(/k\(/);
        expect(code).toContain("'b");
    });
});

describe("rustFile", () => {
    it("links a bare call to the module's one function, unless the caller binds the name", () => {
        const source = [
            "fn helper() -> u8 {",
            "    1",
            "}",
            "",
            "fn uses() -> u8 {",
            "    helper() + 1",
            "}",
            "",
            "fn shadows(helper: impl Fn() -> u8) -> u8 {",
            "    helper()",
            "}",
            "",
            "fn method_of_another() -> u8 {",
            "    other.helper() + Other::helper()",
            "}",
        ].join("\n");
        expect(proved(source)).toEqual(["uses:5 → helper:1"]);
    });

    it("leaves a name the module declares twice, as cfg variants do", () => {
        const source = ["#[cfg(unix)]", "fn os() {}", "#[cfg(windows)]", "fn os() {}", "", "fn run() {", "    os();", "}"].join("\n");
        expect(proved(source)).toEqual([]);
    });

    it("links self., Self:: and T:: to the type's one inherent method, also from a trait impl", () => {
        const source = [
            "struct Tokenizer { pos: usize }",
            "",
            "impl Tokenizer {",
            "    fn advance(&mut self) {",
            "        self.pos += 1;",
            "    }",
            "",
            "    fn fresh() -> Self {",
            "        Self { pos: 0 }",
            "    }",
            "",
            "    fn skip(&mut self) {",
            "        self.advance();",
            "        let other = Self::fresh();",
            "        other.advance();",
            "    }",
            "}",
            "",
            "impl Iterator for Tokenizer {",
            "    type Item = u8;",
            "    fn next(&mut self) -> Option<u8> {",
            "        self.advance();",
            "        self.peek();",
            "        Some(0)",
            "    }",
            "}",
            "",
            "fn make() -> Tokenizer {",
            "    Tokenizer::fresh()",
            "}",
        ].join("\n");
        expect(proved(source)).toEqual(["skip:12 → advance:4", "skip:12 → fresh:8", "next:21 → advance:4", "make:28 → fresh:8"]);
    });

    it("proves nothing across an inline module, or through a generic parameter's name", () => {
        const source = [
            "fn top() {}",
            "",
            "mod inner {",
            "    use super::*;",
            "",
            "    fn own() {}",
            "",
            "    fn caller() {",
            "        top();",
            "        own();",
            "    }",
            "}",
            "",
            "struct T;",
            "",
            "impl T {",
            "    fn make() {}",
            "}",
            "",
            "fn generic<T: Default>() {",
            "    T::make();",
            "}",
        ].join("\n");
        expect(proved(source)).toEqual(["caller:8 → own:6"]);
    });

    it("proves no self-call on the lines of an impl inside the caller, such as a guard's Drop", () => {
        const source = [
            "struct Printer;",
            "",
            "impl Printer {",
            "    fn flush(&self) {}",
            "",
            "    fn print(&self) {",
            "        struct Guard;",
            "        impl Drop for Guard {",
            "            fn drop(&mut self) {",
            "                self.flush();",
            "            }",
            "        }",
            "        self.flush();",
            "    }",
            "}",
        ].join("\n");
        expect(proved(source)).toEqual(["print:6 → flush:4"]);
        expect(proved(source.replace("        self.flush();\n    }", "    }"))).toEqual([]);
    });

    it("ignores calls in comments and strings, and a nested function of the same name", () => {
        const source = ["fn helper() {}", "", "fn caller() {", '    let s = "helper()";', "    // helper();", "    fn helper() {}", "    helper();", "}"].join("\n");
        expect(proved(source)).toEqual([]);
    });
});
