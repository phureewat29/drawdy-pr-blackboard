import { describe, expect, it } from "@jest/globals";
import { testParse } from "../../../test/parser.ts";
import { isGeneric, type GFile } from "../../anyfacts.ts";
import { parsePatch } from "../../diff.ts";
import { grammarOf, languageOf, roleOf } from "../../language.ts";
import { changedSymbols, testCases } from "../../symbols.ts";

const index = async (path: string, text: string): Promise<GFile> => {
    const f = await testParse(path, text);
    if (!f || !isGeneric(f)) throw new Error(`${path} wasn't read by a rule table`);
    return f;
};

/** Each unit as `label lines`, from its first comment to its last line. */
const units = (f: GFile) => f.units.map((u) => `${f.labels.get(u.id)} ${u.docLine}-${u.endLine}`);

/** Plain members after a sample, so its few errors stay under the share the parser is trusted with. */
const filler = Array.from({ length: 30 }, (_, i) => `  def filler${i}(x: Int): Int =\n    x + ${i}\n`).join("\n");

const TASK = `package mill.api

import scala.util.Try

/** A task. */
final case class Task[T](name: String, deps: Seq[Task[?]]) extends Named:
  def this(name: String) = this(name, Nil)

  val label: String = name.toUpperCase
  lazy val total = { val inner = deps.size; inner + 1 }

  def evaluate(ctx: Context): Try[T] =
    val start = System.nanoTime()
    def elapsed() = System.nanoTime() - start
    Try(run(ctx))

  // Runs it once.
  private def run(ctx: Context): T =
    ctx.log(s"""running
               |$name""".stripMargin)
    ???

  /** Workers close in reverse. */
  def close(): Unit =
    deps.reverse.foreach(_.close())
  end close

object Task:
  type Id = String
  given ordering: Ordering[Task[?]] = Ordering.by(_.name)
  val listener = new Runnable { def run(): Unit = () }

trait Named { def name: String }

enum Status(val code: Int):
  case Ok extends Status(0)
  case Failed extends Status(1)
  def isOk: Boolean = this == Ok

extension (t: Task[?])
  def describe: String = t.name

package object util { def helper() = 1 }

def topLevel(x: Int): Int =
  x + 1
`;

describe("Scala's units", () => {
    it("are classes, objects, traits, enums, givens, types, members' vals and defs, and top-level defs: a member's card named for its type", async () => {
        const f = await index("core/api/src/mill/api/Task.scala", TASK);
        expect(units(f)).toEqual([
            "case class Task 5-26",
            "Task() 7-7",
            "Task.label 9-9",
            "Task.total 10-10",
            "Task.evaluate() 12-15",
            "Task.run() 17-21",
            "Task.close() 23-26",
            "object Task 28-31",
            "type Id 29-29",
            "given ordering 30-30",
            "Task.listener 31-31",
            "trait Named 33-33",
            "enum Status 35-38",
            "Status.isOk() 38-38",
            "Task.describe() 41-41",
            "package object util 43-43",
            "util.helper() 43-43",
            "topLevel() 45-46",
        ]);
    });

    it("end an indented body at its last token or its `end` marker, not at the comment or blank lines after it, which go to the next declaration", async () => {
        const f = await index("Task.scala", TASK);
        const run = f.units.find((u) => u.name === "run")!;
        const evaluate = f.units.find((u) => u.name === "evaluate")!;
        expect([evaluate.endLine, run.docLine, run.startLine]).toEqual([15, 17, 18]);
    });

    it("make no unit of a local val or def, an object expression's member, an enum case, a class parameter or a package clause, and read nothing a name could link", async () => {
        const f = await index("Task.scala", TASK);
        const names = f.units.map((u) => u.name);
        for (const name of ["inner", "start", "elapsed", "Ok", "Failed", "deps", "mill"]) expect([name, names.includes(name)]).toEqual([name, false]);
        expect(f.units.filter((u) => u.name === "run")).toHaveLength(1);
        expect([f.sites, f.imports, f.scopes.length]).toEqual([[], [], 1]);
    });

    it("leave out a declaration the grammar ends early, where a line goes on with an operator, after it or before the next", async () => {
        const text = `object Tokens:\n  final val stopScanTokens: BitSet = mustStartStatTokens |\n    BitSet(IF, ELSE)\n\n  final def mayHaveCommonChild(that: Symbol): Boolean =\n       this.isTrait && !that.isFinal\n    || that.isTrait && !this.isFinal\n\n  def ok = 1\n\n${filler}`;
        const f = await index("Tokens.scala", text);
        expect(units(f).slice(0, 3)).toEqual(["object Tokens 1-99", "Tokens.ok() 9-9", "Tokens.filler0() 11-12"]);
    });

    it("leave out a declaration that swallows the next, or that an error follows", async () => {
        const text = `object Diagnostic:\n  trait OriginWarning(val origin: String):\n    self: Warning =>\n  object OriginWarning:\n    val NoOrigin = "..."\n\n  def ok = 1\n\n${filler}`;
        const f = await index("Diagnostic.scala", text);
        expect(units(f).slice(0, 2)).toEqual(["object Diagnostic 1-97", "Diagnostic.ok() 7-7"]);
    });

    it("leave a file the parser can't trust to the line patterns", async () => {
        // The grammar reads no `given … with { … }` in braces.
        const text = "object Ord {\n  given Ordering[Int] with {\n    def compare(a: Int, b: Int) = a - b\n  }\n}\n";
        expect(await testParse("Ord.scala", text)).toBeNull();
        const { symbols } = changedSymbols("Ord.scala", "scala", text.split("\n"), parsePatch("@@ -3,1 +3,1 @@\n-    def compare(a: Int, b: Int) = b - a\n+    def compare(a: Int, b: Int) = a - b"));
        // The patterns see no given, so its method is the object's; a closing brace ends a declaration's lines.
        expect(symbols.map((s) => `${s.label} ${s.start}-${s.end}`)).toEqual(["Ord.compare() 3-4"]);
    });
});

describe("Scala's files", () => {
    it("are `.scala` files, no longer Java's", () => {
        expect([languageOf("a/B.scala"), grammarOf("a/B.scala"), languageOf("a/B.java")]).toEqual(["scala", "scala", "java"]);
    });

    it("are tests when named for one, and name ScalaTest's and specs2's cases", () => {
        expect(["core/exec/test/src/mill/exec/ExecutionTests.scala", "tests/jvm/src/test/scala/IOPlatformSpecification.scala", "a/FooSuite.scala", "a/Foo.scala"].map(roleOf)).toEqual(["test", "test", "test", "code"]);
        const hunk = parsePatch('@@ -0,0 +1,4 @@\n+  "A stack" should {\n+    "pop values in last-in-first-out order" in {\n+  test("close in reverse order") {\n+    val x = "not a case" + y');
        expect(testCases(hunk).map((c) => `${c.name}${c.group ? " (group)" : ""}`)).toEqual(["A stack (group)", "pop values in last-in-first-out order", "close in reverse order"]);
    });
});
