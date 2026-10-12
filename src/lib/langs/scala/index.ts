/**
 * Scala: a card per declaration from its parser (`linker.ts`), no lines yet. A
 * member's card is named for its type, `Task.apply()`. A file the parser can't
 * read takes the C family's line patterns, as Scala did while Java's pack held it.
 */

import { C_FAMILY } from "../c-family.ts";
import type { CaseRule, LanguagePack } from "../pack.ts";

/** ScalaTest's and specs2's `"does x" in {`, and the groups around them (`"A stack" should {`); `test("…")` reads as JavaScript's does. */
const scalaCase: CaseRule = (line) => {
    const m = /^\s*"((?:[^"\\]|\\.)+)"\s+(in|>>|should|must|can|when|-)\s*(?:\{|\(|$)/.exec(line);
    return m ? { name: m[1], group: m[2] !== "in" && m[2] !== ">>" } : undefined;
};

export const SCALA: LanguagePack = {
    id: "scala",
    name: "Scala",
    extensions: ["scala"],
    grammars: [{ name: "scala", extensions: ["scala"], package: "tree-sitter-scala", version: "0.24.0", file: "tree-sitter-scala.wasm", sha256: "b7ec2bb29c19827abcefd18ed5cb5a43596009f96a5d53c5b9d1f9676d7521c3", typedMethods: true }],
    highlight: { keywords: "def val var lazy class object trait enum case extends with match if else then for while do yield return new this super import export package type given using extension implicit sealed abstract override final private protected inline opaque end try catch finally throw true false null", comment: "//", blocks: true },
    lines: C_FAMILY,
    tests: [/(Test|Tests|Spec|Suite|Specification)\.scala$/],
    cases: scalaCase,
    naming: { member: "." },
};
