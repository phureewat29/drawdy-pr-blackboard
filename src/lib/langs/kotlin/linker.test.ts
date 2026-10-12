import { describe, expect, it } from "@jest/globals";
import { testParse } from "../../../test/parser.ts";
import { isGeneric, type GFile } from "../../anyfacts.ts";
import { languageOf, roleOf } from "../../language.ts";
import { changedSymbols, testCases } from "../../symbols.ts";
import { parsePatch } from "../../diff.ts";

const index = async (path: string, text: string): Promise<GFile> => {
    const f = await testParse(path, text);
    if (!f || !isGeneric(f)) throw new Error(`${path} wasn't read by a rule table`);
    return f;
};

/** Each unit as `label lines`, from its first comment to its last line. */
const units = (f: GFile) => f.units.map((u) => `${f.labels.get(u.id)} ${u.docLine}-${u.endLine}`);

const CLIENT = `package okhttp3

import okhttp3.internal.Util
import java.io.Closeable as C

/** A client. */
@Suppress("x")
open class Client(val timeout: Int) : C {
  constructor(builder: Builder) : this(builder.timeout)

  init { check(timeout >= 0) }

  val isFast: Boolean
    get() = timeout < 10

  /** Calls it. */
  @Throws(IOException::class)
  fun newCall(request: Request): Call {
    fun helper() = request.url
    val listener = object : Listener {
      override fun onEvent() = Unit
    }
    return RealCall(this, helper())
  }

  override fun close() = Unit

  companion object {
    const val DEFAULT = 10
    @JvmStatic fun create(): Client = Client(DEFAULT)
  }

  class Builder {
    var timeout = 0
    fun build() = Client(this)
  }

  enum class Protocol(val id: String) {
    HTTP_1_1("http/1.1") {
      override fun toString() = id
    },
    HTTP_2("h2");

    fun isMultiplexed() = this == HTTP_2
  }
}

interface Call {
  fun execute(): Response
}

object Dispatchers {
  fun io() = 1
}

fun Request.Builder.tag(name: String): Request.Builder = this

fun <T> List<T>?.orNone(): List<T> = this ?: emptyList()

private fun topLevel(x: Int): Int =
  x + 1
`;

describe("Kotlin's units", () => {
    it("are classes, objects, companions, functions and constructors, a member's card named for the type it is called through, a doc comment and annotations with each", async () => {
        const f = await index("okhttp/src/main/kotlin/okhttp3/Client.kt", CLIENT);
        expect(units(f)).toEqual([
            "class Client 6-46",
            "Client() 9-9",
            "Client.newCall() 16-24",
            "Client.close() 26-26",
            "companion object 28-31",
            "Client.create() 30-30",
            "class Builder 33-36",
            "Builder.build() 35-35",
            "enum class Protocol 38-45",
            "Protocol.isMultiplexed() 44-44",
            "interface Call 48-50",
            "Call.execute() 49-49",
            "object Dispatchers 52-54",
            "Dispatchers.io() 53-53",
            "Builder.tag() 56-56",
            "List.orNone() 58-58",
            "topLevel() 60-61",
        ]);
    });

    it("leave a local function, an object expression's members and an enum entry's body to the declaration around them", async () => {
        const f = await index("Client.kt", CLIENT);
        const names = f.units.map((u) => u.name);
        expect(names).not.toContain("helper");
        expect(names).not.toContain("onEvent");
        expect(names).not.toContain("toString");
    });

    it("name a companion object with its own name when it has one, and read nothing a name could link", async () => {
        const f = await index("A.kt", "class A {\n  companion object Factory {\n    fun make() = A()\n  }\n}\n");
        expect(units(f)).toEqual(["class A 1-5", "companion object Factory 2-4", "A.make() 3-3"]);
        expect([f.sites, f.imports, f.scopes.length]).toEqual([[], [], 1]);
    });

    it("say which top-level statements import", async () => {
        const { linkerOf } = await import("../../linking.ts");
        const f = await index("Client.kt", CLIENT);
        const isImport = linkerOf("Client.kt")!.isImport!;
        const imports: number[] = [];
        for (let n = f.flat.first[0]; n >= 0; n = f.flat.next[n]) if (isImport(f.flat, n)) imports.push(f.flat.start[n]);
        expect(imports.map((s) => CLIENT.slice(s).split("\n")[0])).toEqual(["import okhttp3.internal.Util", "import java.io.Closeable as C"]);
    });

    it("leave a file the parser can't trust to the line patterns", async () => {
        // ktor's CharsetJVM.kt: the grammar reads no primary constructor on the line after its class, so most of the file is an error.
        const text = 'public actual open class MalformedInputException\nactual constructor(message: String) : java.nio.charset.MalformedInputException(0) {\n    private val _message = message\n\n    fun describe(): String {\n        return message ?: ""\n    }\n}\n';
        expect(await testParse("CharsetJVM.kt", text)).toBeNull();
        const { symbols } = changedSymbols("CharsetJVM.kt", "kt", text.split("\n"), parsePatch('@@ -6,1 +6,1 @@\n-        return message\n+        return message ?: ""'));
        // As before Kotlin had a parser: the patterns read the constructor's line as a function, which holds the rest.
        expect(symbols.map((s) => `${s.label} ${s.start}-${s.end}`)).toEqual(["constructor() 2-8"]);
    });

    it("leave Gradle's Kotlin scripts to the line patterns: they need no parser", async () => {
        expect(await testParse("build.gradle.kts", 'plugins {\n  kotlin("jvm")\n}\n')).toBeNull();
        expect(languageOf("build.gradle.kts")).toBe("kt");
    });
});

describe("Kotlin's tests", () => {
    it("are files named for a test and multiplatform test source sets", () => {
        expect(["okhttp/src/jvmTest/kotlin/okhttp3/CallTest.kt", "coil-core/src/commonTest/kotlin/coil3/Fakes.kt", "coil-core/src/androidUnitTest/kotlin/A.kt", "app/src/main/kotlin/Client.kt"].map(roleOf)).toEqual(["test", "test", "test", "code"]);
    });

    it("name a case by the function under `@Test`, on its line or the next, and nothing else", () => {
        const hunk = parsePatch(
            "@@ -1,0 +1,9 @@\n+  @Test\n+  fun headersCanBeLarge() {\n+  }\n+  @Test fun `rejects big headers`() {}\n+  @BeforeEach\n+  fun setUp() {}\n+  @Test\n+  public void javaStyle() {}\n+  fun helper() = 1"
        );
        expect(testCases(hunk).map((c) => c.name)).toEqual(["headersCanBeLarge", "rejects big headers"]);
    });
});
