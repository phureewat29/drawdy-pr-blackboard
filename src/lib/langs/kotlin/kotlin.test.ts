import { describe, expect, it } from "@jest/globals";
import { testParse } from "../../../test/parser.ts";
import { isGeneric, type GFile } from "../../anyfacts.ts";
import { resolveAny } from "../../anylink.ts";
import { rulesOf } from "../../linking.ts";
import { kotlinWants } from "./wants.ts";

const base = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * Every reference the files resolve, as `File.kt:line ref card @target`: the
 * target's line, with its file when another. The files given are all the
 * files read, but one starting `// unread` (there for the compiler alone);
 * one tree-sitter can't parse is read all the same.
 */
const links = async (all: Record<string, string>): Promise<string[]> => {
    const files = Object.fromEntries(Object.entries(all).filter(([, text]) => !text.startsWith("// unread")));
    const parsed: GFile[] = [];
    for (const [path, text] of Object.entries(files)) {
        const f = await testParse(path, text);
        if (f && isGeneric(f)) parsed.push(f);
    }
    const labels = new Map(parsed.flatMap((f) => [...f.labels]));
    const refs = resolveAny(parsed, (f) => rulesOf(f.path)!.resolver, (path) => files[path], (p) => (p in files ? true : undefined), () => Object.keys(files));
    return refs.flatMap((r) => r.units.map((u) => `${base(r.path)}:${r.line} ${r.ref} ${labels.get(u.id)} @${u.path === r.path ? "" : `${base(u.path)}:`}${u.nameLine}`));
};

/** One file, `Main.kt`, in package `app` of a JVM module; its code starts on line 3. */
const one = (code: string) => links({ "app/src/main/kotlin/app/Main.kt": `package app\n\n${code}` });

const calls = (found: string[]) => found.filter((l) => / call /.test(l));

describe("Kotlin calls by name", () => {
    it("links a function of the file and of its package; not a parameter, nor a local function", async () => {
        const found = await links({
            "app/src/main/kotlin/app/Main.kt": "package app\n\nfun helper() = 1\n\nfun run(go: () -> Unit) {\n    helper()\n    other()\n    go()\n    fun local() = 2\n    local()\n}\n",
            "app/src/main/kotlin/app/Other.kt": "package app\n\nfun other() = 2\n",
        });
        expect(calls(found)).toEqual(["Main.kt:6 call helper() @3", "Main.kt:7 call other() @Other.kt:3"]);
    });

    it("leaves a call a local of the name may take: a value's `invoke`", async () => {
        const found = await one("fun helper() = 1\n\nfun run() {\n    val helper = { 2 }\n    helper()\n}\n");
        expect(calls(found)).toEqual([]);
    });

    it("takes an explicit import over the package's class, and an alias for its class", async () => {
        const found = await links({
            "app/src/main/kotlin/app/Main.kt": "package app\n\nimport lib.Shared\nimport lib.Renamed as Other\n\nfun run() {\n    Shared()\n    Other()\n}\n",
            "app/src/main/kotlin/app/Shared.kt": "package app\n\nclass Shared\n",
            "app/src/main/kotlin/lib/Lib.kt": "package lib\n\nclass Shared\n\nclass Renamed\n",
        });
        expect(found).toEqual(["Main.kt:7 call class Shared @Lib.kt:3", "Main.kt:8 call class Renamed @Lib.kt:5", "Main.kt:3 import class Shared @Lib.kt:3", "Main.kt:4 import class Renamed @Lib.kt:5"]);
    });

    it("leaves a name an import names when the import's file isn't read, though the package declares it", async () => {
        const found = await links({
            "app/src/main/kotlin/app/Main.kt": "package app\n\nimport lib.helper\n\nfun run() = helper()\n",
            "app/src/main/kotlin/app/Same.kt": "package app\n\nfun helper() = 1\n",
        });
        expect(calls(found)).toEqual([]);
    });

    it("finds a name through a star import of a package read; not with a library's star import that may hold a better one", async () => {
        const lib = { "app/src/main/kotlin/lib/Lib.kt": "package lib\n\nfun helper(x: Any) = 1\n" };
        const read = await links({ "app/src/main/kotlin/app/Main.kt": "package app\n\nimport lib.*\n\nfun run(x: Any) = helper(x)\n", ...lib });
        expect(calls(read)).toEqual(["Main.kt:5 call helper() @Lib.kt:3"]);
        const library = await links({ "app/src/main/kotlin/app/Main.kt": "package app\n\nimport lib.*\nimport some.library.*\n\nfun run(x: Any) = helper(x)\n", ...lib });
        expect(calls(library)).toEqual([]);
    });

    it("leaves a call that may not apply in a file that reaches invisible declarations: the standard library's internal ones may take it", async () => {
        const code = "fun build(x: Int) = 1\n\nfun run(y: Any) = build(y.hashCode())\n";
        expect(calls(await one(code))).toEqual(["Main.kt:5 call build() @3"]);
        const hidden = await links({ "app/src/main/kotlin/app/Main.kt": `@file:Suppress("INVISIBLE_MEMBER", "INVISIBLE_REFERENCE")\n\npackage app\n\n${code}` });
        expect(calls(hidden)).toEqual([]);
    });

    it("leaves a call the default imports may take once the package's function can't apply", async () => {
        const found = await one("fun println(x: Int) = Unit\n\nfun run(s: String) {\n    println(1)\n    println(s)\n}\n");
        expect(calls(found)).toEqual(["Main.kt:6 call println() @3"]);
    });
});

describe("Kotlin members and receivers", () => {
    it("links a member through `this` and a supertype read, and a virtual call to the receiver's declared type", async () => {
        const found = await one("open class Base {\n    open fun f() = 1\n    fun g() = 2\n}\n\nclass Sub : Base() {\n    override fun f() = 3\n    fun run(b: Base) {\n        f()\n        g()\n        b.f()\n        this.f()\n    }\n}\n");
        expect(calls(found)).toEqual(["Main.kt:8 call class Base @3", "Main.kt:11 call Sub.f() @9", "Main.kt:12 call Base.g() @5", "Main.kt:13 call Base.f() @4", "Main.kt:14 call Sub.f() @9"]);
    });

    it("leaves a bare call in a class whose supertype isn't read: the supertype may hold the name", async () => {
        const found = await one("fun helper() = 1\n\nclass Sub : lib.Base() {\n    fun run() = helper()\n}\n");
        expect(calls(found)).toEqual([]);
    });

    it("knows the members of a library supertype it lists (an exception's, Closeable's), and leaves a name they hold", async () => {
        const found = await one("import java.io.Closeable\n\nfun helper() = 1\n\nclass Oops : IllegalStateException() {\n    fun run() = helper()\n}\n\nclass Res : Closeable {\n    override fun close() = Unit\n    fun run() = helper()\n    fun shut() = close()\n}\n");
        expect(calls(found)).toEqual(["Main.kt:8 call helper() @5", "Main.kt:13 call helper() @5"]);
    });

    it("types a receiver by its declared type or the constructor that made it, and leaves one a smart cast may change", async () => {
        const found = await one("open class A {\n    open fun f() = 1\n}\n\nclass B : A() {\n    override fun f() = 2\n}\n\nclass Holder(val a: A) {\n    private val made = A()\n    fun run(x: A) {\n        a.f()\n        made.f()\n        x.f()\n    }\n    fun cast(x: A) {\n        if (x is B) x.f()\n    }\n}\n");
        expect(calls(found).filter((l) => l.includes(".f()"))).toEqual(["Main.kt:14 call A.f() @4", "Main.kt:15 call A.f() @4", "Main.kt:16 call A.f() @4"]);
    });

    it("leaves a call on a `var` local, and on a nullable receiver read with `.`", async () => {
        const found = await one("class A {\n    fun f() = 1\n}\n\nfun run(n: A?) {\n    var a = A()\n    a.f()\n    n?.f()\n}\n");
        expect(calls(found).filter((l) => l.includes(".f()"))).toEqual(["Main.kt:10 call A.f() @4"]);
    });

    it("reaches a companion's members bare, through the class and from a subclass; a nested class through its outer one", async () => {
        const found = await one("open class Base {\n    companion object {\n        fun made() = 1\n    }\n}\n\nclass Sub : Base() {\n    fun run() = made()\n    class Nested\n}\n\nfun use() {\n    Base.made()\n    Sub.Nested()\n}\n");
        expect(calls(found)).toEqual(["Main.kt:9 call class Base @3", "Main.kt:10 call Base.made() @5", "Main.kt:15 call Base.made() @5", "Main.kt:16 call class Nested @11"]);
    });

    it("sees a superclass's companion in a subclass, an interface's only inside the interface", async () => {
        const found = await one("interface I {\n    companion object {\n        fun mk() = 1\n    }\n    fun own() = mk()\n}\n\nopen class Q {\n    companion object {\n        fun qm() = 2\n    }\n}\n\nfun mk() = 9\n\nclass R : Q(), I {\n    fun r1() = qm()\n    fun r3() = mk()\n}\n");
        expect(calls(found)).toEqual(["Main.kt:7 call I.mk() @5", "Main.kt:18 call class Q @10", "Main.kt:19 call Q.qm() @12", "Main.kt:20 call mk() @16"]);
    });

    it("reads an interface's nested class as no class past the interface", async () => {
        const found = await one("interface I {\n    class N\n}\n\nclass N\n\nclass D : I {\n    fun h() = N()\n}\n");
        expect(calls(found)).toEqual(["Main.kt:10 call class N @7"]);
    });

    it("takes a member over an extension of its name, and the extension where the member is private", async () => {
        const found = await one("class C {\n    fun m() = 1\n    private fun p() = 2\n}\n\nfun C.m() = 3\nfun C.p() = 4\n\nfun run(c: C) {\n    c.m()\n    c.p()\n}\n");
        expect(calls(found)).toEqual(["Main.kt:12 call C.m() @4", "Main.kt:13 call C.p() @9"]);
    });

    it("links an extension through an implicit receiver, and not one of a class the receiver isn't", async () => {
        const found = await one("class A\nclass B\n\nfun A.ext() = 1\nfun B.other() = 2\nfun other() = 3\n\nfun A.run() {\n    ext()\n    other()\n}\n");
        expect(calls(found)).toEqual(["Main.kt:11 call A.ext() @6", "Main.kt:12 call other() @8"]);
    });

    it("leaves `Foo(…)` where Foo's companion may be invoked", async () => {
        const found = await one("class Foo(val x: Int) {\n    companion object {\n        operator fun invoke(s: String) = Foo(s.length)\n    }\n}\n\nfun run() = Foo(1)\n");
        expect(calls(found)).toEqual([]);
    });
});

describe("Kotlin constructor parameters", () => {
    it("reads a parameter in initializers, the property in a member function or an accessor", async () => {
        const found = await one("class Item {\n    fun size() = 1\n}\n\nclass Holder(val a: Item, b: Item) {\n    val c = b.size()\n    init {\n        a.size()\n    }\n    fun run() = a.size()\n    val d: Int\n        get() = a.size()\n}\n");
        expect(calls(found)).toEqual(["Main.kt:8 call Item.size() @4", "Main.kt:10 call Item.size() @4", "Main.kt:12 call Item.size() @4", "Main.kt:14 call Item.size() @4"]);
    });

    it("leaves a local class's initializer reading its parameter where an outer local has the name", async () => {
        const found = await one("class Item {\n    fun get(i: Int) = 1\n}\n\nfun outer() {\n    val a = Item()\n    class Local(a: String) {\n        val n = a.get(0)\n    }\n}\n");
        expect(calls(found).filter((l) => l.includes("get"))).toEqual([]);
    });

    it("leaves a vararg parameter or property: it is an array", async () => {
        const found = await one("class Item {\n    fun get(i: Int) = 1\n}\n\nfun f(vararg items: Item) = items.get(0)\n\nclass C(vararg val xs: Item) {\n    fun g() = xs.get(0)\n}\n\nclass D(vararg ys: Item) {\n    val first = ys.get(0)\n}\n");
        expect(calls(found).filter((l) => l.includes("get"))).toEqual([]);
    });
});

describe("Kotlin smart casts", () => {
    it("leaves a receiver a function read with a contract may cast", async () => {
        const found = await one("import kotlin.contracts.ExperimentalContracts\nimport kotlin.contracts.contract\n\nopen class A {\n    open fun f() = 1\n}\n\nclass B : A() {\n    override fun f() = 2\n}\n\n@OptIn(ExperimentalContracts::class)\nfun isB(x: A): Boolean {\n    contract { returns(true) implies (x is B) }\n    return x is B\n}\n\nfun use(a: A, d: A) {\n    if (isB(a)) a.f()\n    d.f()\n}\n");
        expect(calls(found).filter((l) => l.includes(".f()"))).toEqual(["Main.kt:22 call A.f() @7"]);
    });

    it("leaves a receiver after a call with type arguments on it, which may cast it; not before, nor in that call", async () => {
        const found = await one("open class A {\n    open fun f() = 1\n    fun <T> tag(): T? = null\n}\n\nfun use(a: A) {\n    a.f()\n    a.tag<String>()\n    a.f()\n}\n");
        expect(calls(found)).toEqual(["Main.kt:9 call A.f() @4", "Main.kt:10 call A.tag() @5"]);
    });

    it("reads a loop's body from the loop's entry: a cast later in the body doesn't reach its start", async () => {
        const found = await one("open class A {\n    open fun f() = 1\n}\n\nclass B : A() {\n    override fun f() = 2\n}\n\nfun loop(x: A) {\n    while (true) {\n        x.f()\n        if (x !is B) return\n        x.f()\n    }\n}\n");
        expect(calls(found).filter((l) => l.includes(".f()"))).toEqual(["Main.kt:13 call A.f() @4"]);
    });

    it("reads `assertIs<T>(x)`, which tree-sitter reads as comparisons, as a cast of x after it", async () => {
        const found = await one("import kotlin.test.assertIs\n\nopen class Base {\n    open fun f() = 1\n}\n\nclass Derived : Base() {\n    override fun f() = 2\n}\n\nfun t(x: Base): Int {\n    val before = x.f()\n    assertIs<Derived>(x)\n    return before + x.f()\n}\n");
        expect(calls(found).filter((l) => l.includes(".f()"))).toEqual(["Main.kt:14 call Base.f() @6"]);
    });

    it("reads a cast of a value however it's spelled, and through a local alias", async () => {
        const found = await one("open class Base {\n    open fun f() = 1\n}\nclass Derived : Base() {\n    override fun f() = 2\n}\nclass Holder(val prop: Base)\nclass C(val obj: Holder) {\n    fun t(): Int {\n        if (this.obj.prop is Derived) return obj.prop.f()\n        return 0\n    }\n    fun u(): Int {\n        if (obj?.prop is Derived) return obj.prop.f()\n        return 0\n    }\n}\nfun v(x: Base): Int {\n    val y = x\n    if (y is Derived) return x.f()\n    return 0\n}\nfun w(x: Base): Int {\n    val y = x\n    if (x is Derived) return y.f()\n    return 0\n}\n");
        expect(calls(found).filter((l) => l.includes(".f()"))).toEqual([]);
    });

    it("reads casts in a class header: a parameter's default, a supertype's argument, an enum entry's", async () => {
        const found = await one("open class Base {\n    open fun f() = 1\n}\nclass Derived : Base() {\n    override fun f() = 2\n}\nclass C(x: Base, y: Int = if (x is Derived) x.f() else 0)\nopen class P(v: Int)\nclass Q(x: Base) : P(if (x is Derived) x.f() else 0)\nval top: Base = Derived()\nenum class E(val v: Int) {\n    A(if (top is Derived) top.f() else 0)\n}\n");
        expect(calls(found).filter((l) => l.includes(".f()"))).toEqual([]);
    });

    it("reads a property through a receiver around that a cast of `this` may change as unknown", async () => {
        const found = await one("open class Item {\n    open fun f() = 1\n}\nclass Special : Item() {\n    override fun f() = 2\n}\nopen class Base {\n    open val p: Item = Item()\n}\nclass Sub : Base() {\n    override val p: Special = Special()\n}\nfun Base.g(): Int = if (this is Sub) p.f() else 0\nclass Box(val b: Base) {\n    fun h(): Int = with(b) { if (this is Sub) p.f() else 0 }\n}\nfun Base.k(): Int = p.f()\n");
        expect(calls(found).filter((l) => l.includes(".f()"))).toEqual(["Main.kt:19 call Item.f() @4"]);
    });

    it("leaves a value a call of a function not read may cast through a contract, even one of a final class; not after a function read without one", async () => {
        const found = await links({
            "app/src/main/kotlin/a/A.kt": "package a\n\nopen class Base {\n    open fun f() = 1\n}\n\nclass Derived : Base() {\n    override fun f() = 2\n}\n\nclass Final {\n    fun f() = 3\n}\n\nfun Base.isPlain(): Boolean = true\n\nfun t(x: Base): Int = if (x.isDerived()) x.f() else 0\n\nfun u(x: Final): Int = if (x.isDerived()) x.f() else 0\n\nfun v(x: Base): Int = if (x.isPlain()) x.f() else 0\n",
            "app/src/main/kotlin/a/Check.kt": "// unread\npackage a\n\nimport kotlin.contracts.ExperimentalContracts\nimport kotlin.contracts.contract\n\n@OptIn(ExperimentalContracts::class)\nfun Any?.isDerived(): Boolean {\n    contract {\n        returns(true) implies (this@isDerived is Derived)\n    }\n    return this is Derived\n}\n",
        });
        expect(calls(found).filter((l) => l.includes(".f()"))).toEqual(["A.kt:21 call Base.f() @4"]);
    });

    it("leaves a value a contract may cast wherever the call stands: a local's initializer, `require`'s argument, `.not()`, a statement", async () => {
        const found = await links({
            "app/src/main/kotlin/a/A.kt": "package a\n\nopen class Base {\n    open fun f() = 1\n}\n\nclass Derived : Base() {\n    override fun f() = 2\n}\n\nfun a(x: Base): Int {\n    val ok = x.isDerived()\n    return if (ok) x.f() else 0\n}\n\nfun b(x: Base): Int {\n    require(x.isDerived())\n    return x.f()\n}\n\nfun c(x: Base): Int {\n    if (x.isDerived().not()) return 0\n    return x.f()\n}\n\nfun d(x: Base): Int {\n    x.assertDerived()\n    return x.f()\n}\n",
            "app/src/main/kotlin/a/Check.kt": "// unread\npackage a\n\nimport kotlin.contracts.ExperimentalContracts\nimport kotlin.contracts.contract\n\n@OptIn(ExperimentalContracts::class)\nfun Any?.isDerived(): Boolean {\n    contract {\n        returns(true) implies (this@isDerived is Derived)\n    }\n    return this is Derived\n}\n\n@OptIn(ExperimentalContracts::class)\nfun Any?.assertDerived() {\n    contract {\n        returns() implies (this@assertDerived is Derived)\n    }\n    if (this !is Derived) throw IllegalStateException()\n}\n",
        });
        expect(calls(found).filter((l) => l.includes(".f()"))).toEqual([]);
    });

    it("leaves a receiver around a bare call of a function not read may cast: in a property's initializer, in a `with` lambda", async () => {
        const found = await links({
            "app/src/main/kotlin/a/A.kt": "package a\n\nopen class Base {\n    open fun f() = 1\n}\n\nclass Derived : Base() {\n    override fun f() = 2\n}\n\nopen class C : Base() {\n    val v = if (isDerived()) f() else 0\n}\n\nfun Base.h(): Int = with(this) { if (isDerived()) f() else 0 }\n",
            "app/src/main/kotlin/a/Check.kt": "// unread\npackage a\n\nimport kotlin.contracts.ExperimentalContracts\nimport kotlin.contracts.contract\n\n@OptIn(ExperimentalContracts::class)\nfun Any?.isDerived(): Boolean {\n    contract {\n        returns(true) implies (this@isDerived is Derived)\n    }\n    return this is Derived\n}\n",
        });
        expect(calls(found).filter((l) => l.includes(" f()") || l.includes(".f()"))).toEqual([]);
    });

    it("reads kotlin.test's `assertIs` as a cast of its argument, its type argument inferred", async () => {
        const found = await one("import kotlin.test.assertIs\n\nopen class Item {\n    open fun f() = 1\n}\n\nclass Special : Item() {\n    override fun f() = 2\n}\n\nfun t(x: Item): Int {\n    val s: Special = assertIs(x)\n    return x.f() + s.f()\n}\n");
        expect(calls(found).filter((l) => l.includes(".f()"))).toEqual(["Main.kt:15 call Special.f() @10"]);
    });

    it("leaves a value an operator's or an infix function's call may cast: infix, `in`, a value's `invoke`, a prefix operator, `for`, destructuring", async () => {
        const found = await links({
            "app/src/main/kotlin/a/A.kt": "package a\n\nopen class Item {\n    open fun f() = 1\n}\n\nclass Special : Item() {\n    override fun f() = 2\n}\n\nclass Box\n\nclass Check\n\nfun a(x: Item): Int = if (x isA Unit) x.f() else 0\n\nfun b(x: Item, box: Box): Int = if (x in box) x.f() else 0\n\nfun c(x: Item, isSpecial: Check): Int = if (isSpecial(x)) x.f() else 0\n\nfun d(x: Item): Int {\n    -x\n    return x.f()\n}\n\nfun e(x: Item): Int {\n    for (i in x) {}\n    return x.f()\n}\n\nfun g(x: Item): Int {\n    val (p) = x\n    return x.f() + p\n}\n\nfun h(x: Item, y: Item): Int {\n    val pair = x to y\n    return x.f()\n}\n",
            "app/src/main/kotlin/a/Ops.kt": "// unread\n@file:OptIn(ExperimentalContracts::class)\npackage a\n\nimport kotlin.contracts.ExperimentalContracts\nimport kotlin.contracts.contract\n\ninfix fun Any?.isA(u: Unit): Boolean {\n    contract { returns(true) implies (this@isA is Special) }\n    return this is Special\n}\n\noperator fun Box.contains(v: Any?): Boolean {\n    contract { returns(true) implies (v is Special) }\n    return v is Special\n}\n\noperator fun Check.invoke(v: Any?): Boolean {\n    contract { returns(true) implies (v is Special) }\n    return v is Special\n}\n\noperator fun Item.unaryMinus(): Int {\n    contract { returns() implies (this@unaryMinus is Special) }\n    return 0\n}\n\noperator fun Item.iterator(): Iterator<Int> {\n    contract { returns() implies (this@iterator is Special) }\n    return listOf(1).iterator()\n}\n\noperator fun Item.component1(): Int {\n    contract { returns() implies (this@component1 is Special) }\n    return 0\n}\n",
        });
        expect(calls(found).filter((l) => l.includes(".f()"))).toEqual(["A.kt:38 call Item.f() @4"]);
    });

    it("goes past a local function or value the call may not take: a member of a supertype not read may answer it, with a contract", async () => {
        const found = await links({
            "app/src/main/kotlin/a/A.kt": "package a\n\nopen class Item {\n    open fun f() = 1\n}\n\nclass Special : Item() {\n    override fun f() = 2\n}\n\nclass T : Base() {\n    fun t(x: a.Item): Int {\n        fun isSp(v: Int) = false\n        return if (isSp(x)) x.f() else 0\n    }\n\n    fun u(x: a.Item, isSp: (Int) -> Boolean): Int = if (isSp(x)) x.f() else 0\n\n    fun v(x: a.Item, check: (a.Item) -> Boolean): Int = if (check(x)) x.f() else 0\n}\n",
            "app/src/main/kotlin/a/Base.kt": "// unread\n@file:OptIn(ExperimentalContracts::class)\npackage a\n\nimport kotlin.contracts.ExperimentalContracts\nimport kotlin.contracts.contract\n\nopen class Base {\n    fun isSp(v: Any?): Boolean {\n        contract { returns(true) implies (v is Special) }\n        return v is Special\n    }\n}\n",
        });
        expect(calls(found).filter((l) => l.includes(".f()"))).toEqual(["A.kt:19 call Item.f() @4"]);
    });

    it("takes a receiver around before a Java method imported by name: its member, one of a supertype not read, may have a contract", async () => {
        const found = await links({
            "app/src/main/kotlin/a/A.kt": "package a\n\nimport java.util.Objects.requireNonNull\n\nopen class Item {\n    open fun f() = 1\n}\n\nclass Special : Item() {\n    override fun f() = 2\n}\n\nfun t(x: Item, h: Helper): Int = with(h) {\n    requireNonNull(x)\n    x.f()\n}\n\nfun v(x: Item): Int {\n    requireNonNull(x)\n    return x.f()\n}\n",
            "app/src/main/kotlin/a/B.kt": "package a\n\nimport java.util.Objects.requireNonNull as assertNotNull\n\nclass MyTest : TestBase() {\n    fun u(x: Item): Int {\n        assertNotNull(x)\n        return x.f()\n    }\n}\n",
            "app/src/main/kotlin/a/Helper.kt": "// unread\n@file:OptIn(ExperimentalContracts::class)\npackage a\n\nimport kotlin.contracts.ExperimentalContracts\nimport kotlin.contracts.contract\n\nclass Helper {\n    fun requireNonNull(x: Any?) {\n        contract { returns() implies (x is Special) }\n        if (x !is Special) throw IllegalStateException()\n    }\n}\n\nopen class TestBase {\n    fun assertNotNull(x: Any?) {\n        contract { returns() implies (x is Special) }\n        if (x !is Special) throw IllegalStateException()\n    }\n}\n",
        });
        expect(calls(found).filter((l) => l.includes(".f()"))).toEqual(["A.kt:20 call Item.f() @6"]);
    });

    it("takes an extension a star import not read may bring, on a receiver around, before a Java method imported by name", async () => {
        const found = await links({
            "app/src/main/kotlin/a/A.kt": "package a\n\nimport java.util.Objects.requireNonNull\nimport b.*\n\nopen class Item {\n    open fun f() = 1\n}\n\nclass Special : Item() {\n    override fun f() = 2\n}\n\nclass Runner {\n    fun t(x: Item): Int {\n        requireNonNull(x)\n        return x.f()\n    }\n}\n\nfun u(x: Item): Int {\n    requireNonNull(x)\n    return x.f()\n}\n",
            "app/src/main/kotlin/b/B.kt": "// unread\n@file:OptIn(ExperimentalContracts::class)\npackage b\n\nimport a.Special\nimport kotlin.contracts.ExperimentalContracts\nimport kotlin.contracts.contract\n\nfun Any.requireNonNull(x: Any?) {\n    contract { returns() implies (x is Special) }\n    if (x !is Special) throw IllegalStateException()\n}\n",
        });
        expect(calls(found).filter((l) => l.includes(".f()"))).toEqual(["A.kt:23 call Item.f() @7"]);
    });

    it("finds a contract's function in the tree, past a comment or an anonymous function, and an accessor's property", async () => {
        const found = await links({
            "app/src/main/kotlin/a/A.kt": "@file:OptIn(ExperimentalContracts::class)\npackage a\n\nimport kotlin.contracts.ExperimentalContracts\nimport kotlin.contracts.contract\n\nopen class Item {\n    open fun f() = 1\n}\n\nclass Special : Item() {\n    override fun f() = 2\n}\n\nfun isSpecial(v: Any?): Boolean { // a fun little check\n    contract { returns(true) implies (v is Special) }\n    return v is Special\n}\n\nfun isSpecial2(v: Any?, onFail: () -> Unit = fun() {}): Boolean {\n    contract { returns(true) implies (v is Special) }\n    return v is Special\n}\n\nval Any?.special: Boolean\n    get() {\n        contract { returns(true) implies (this@special is Special) }\n        return this is Special\n    }\n\nfun t(x: Item): Int = if (isSpecial(x)) x.f() else 0\n\nfun u(x: Item): Int = if (isSpecial2(x)) x.f() else 0\n\nfun w(x: Item): Int = if (x.special) x.f() else 0\n\nfun Item.k(): Int = if (special) f() else 0\n",
        });
        expect(calls(found).filter((l) => / (Item\.|Special\.)?f\(\)/.test(l))).toEqual([]);
    });

    it("reads a library supertype a class writes as one an extension on it may take: `java.io.Serializable`", async () => {
        const found = await one("import java.io.Serializable\n\nclass Foo : Serializable\n\nfun Serializable.kind(): Int = 1\n\nfun Any.kind(): Int = 2\n\nfun t(f: Foo) = f.kind()\n");
        expect(calls(found).filter((l) => l.includes("kind"))).toEqual([]);
    });

    it("leaves a value a property's accessor not read may cast: a getter's on `x.isSp` and on the receivers around a bare `isDerived`, a setter's on what it's set to", async () => {
        const found = await links({
            "app/src/main/kotlin/a/A.kt": "package a\n\nopen class Item {\n    open fun f() = 1\n}\n\nclass Special : Item() {\n    override fun f() = 2\n}\n\nopen class Base {\n    open fun g() = 1\n}\n\nclass Derived : Base() {\n    override fun g() = 2\n}\n\nclass Plain {\n    val ok: Boolean = true\n}\n\nfun t(x: Item): Int = if (x.isSp) x.f() else 0\n\nfun Base.u(): Int = if (isDerived) g() else 0\n\nfun v(x: Item): Int {\n    x.mark = 1\n    return x.f()\n}\n\nfun w(x: Item, p: Plain): Int = if (p.ok) x.f() else 0\n\nclass Holder(val item: Item) {\n    fun k(): Int = if (item.isSp) item.f() else 0\n}\n",
            "app/src/main/kotlin/a/Props.kt": "// unread\n@file:OptIn(ExperimentalContracts::class)\npackage a\n\nimport kotlin.contracts.ExperimentalContracts\nimport kotlin.contracts.contract\n\nval Any?.isSp: Boolean\n    get() {\n        contract { returns(true) implies (this@isSp is Special) }\n        return this is Special\n    }\n\nval Base.isDerived: Boolean\n    get() {\n        contract { returns(true) implies (this@isDerived is Derived) }\n        return this is Derived\n    }\n\nvar Any?.mark: Int\n    get() = 0\n    set(v) {\n        contract { returns() implies (this@mark is Special) }\n        if (this !is Special) throw IllegalStateException()\n    }\n",
            "app/src/main/kotlin/a/Set.kt": "package a\n\nclass Box\n\nfun t(x: Item, b: Box): Int {\n    b.slot = x\n    return x.f()\n}\n\nfun Box.u(x: Item): Int {\n    slot = x\n    return x.f()\n}\n",
            "app/src/main/kotlin/a/SetProps.kt": "// unread\n@file:OptIn(ExperimentalContracts::class)\npackage a\n\nimport kotlin.contracts.ExperimentalContracts\nimport kotlin.contracts.contract\n\nvar Box.slot: Any?\n    get() = null\n    set(v) {\n        contract { returns() implies (v is Special) }\n        if (v !is Special) throw IllegalStateException()\n    }\n",
        });
        expect(calls(found).filter((l) => / (Item\.|Base\.)?(f|g)\(\)/.test(l))).toEqual(["A.kt:32 call Item.f() @4"]);
    });

    it("leaves a class's name an extension property of the name may shadow on a receiver around, though a star import brings it", async () => {
        const found = await links({
            "app/src/main/kotlin/a/A.kt": "package a\n\nimport b.*\n\nclass Color {\n    companion object {\n        val RED = 1\n    }\n}\n\nclass Box {\n    fun t(): Any = Int.MAX_VALUE\n    fun u(): Any = Color.MAX_VALUE\n}\n",
            "app/src/main/kotlin/b/B.kt": "package b\n\nobject Holder {\n    val MAX_VALUE = \"holder\"\n}\n\nval a.Box.Int: Holder get() = Holder\nval a.Box.Color: Holder get() = Holder\n",
        });
        expect(found.filter((l) => l.includes("Color"))).toEqual([]);
    });

    it("reads `x === y` as a cast of each side, `x == y` as none", async () => {
        const found = await one("open class Item {\n    open fun f() = 1\n}\n\nclass Special : Item() {\n    override fun f() = 2\n}\n\nobject Obj : Item() {\n    override fun f() = 3\n}\n\nfun t1(x: Item, s: Special): Int = if (x == s) x.f() else 0\n\nfun t2(x: Item, s: Special): Int = if (x === s) x.f() else 0\n\nfun t3(x: Item): Int = if (x == Obj) x.f() else 0\n\nfun t4(x: Item): Int = if (x === Obj) x.f() else 0\n\nfun t5(x: Item): Int = when (x) {\n    Obj -> x.f()\n    else -> 0\n}\n\nfun t6(x: Any?, s: Special): Int = if (x == s) 1 else 0\n");
        expect(calls(found).filter((l) => l.includes(".f()"))).toEqual(["Main.kt:15 call Item.f() @4", "Main.kt:19 call Item.f() @4"]);
    });

    it("reads `field` in an accessor as the backing field, never a property of the name", async () => {
        const found = await one("open class A {\n    open fun f() = 1\n}\n\nclass B : A() {\n    override fun f() = 2\n}\n\nclass P {\n    val field = B()\n    var q: A = A()\n        get() {\n            field.f()\n            return field\n        }\n    fun g() = field.f()\n}\n");
        expect(calls(found).filter((l) => l.includes(".f()"))).toEqual(["Main.kt:18 call B.f() @8"]);
    });
});

describe("Kotlin compiler plugins", () => {
    it("leaves `serializer()` on a `@Serializable` class's companion: the plugin declares one", async () => {
        const found = await one("import kotlinx.serialization.KSerializer\nimport kotlinx.serialization.Serializable\n\n@Serializable\nclass Foo(val x: Int) {\n    companion object {\n        fun make() = Foo(1)\n    }\n}\n\nfun Foo.Companion.serializer(): KSerializer<Foo>? = null\n\nfun use() {\n    Foo.serializer()\n    Foo.make()\n}\n");
        expect(calls(found).filter((l) => !l.includes("class Foo"))).toEqual(["Main.kt:17 call Foo.make() @9"]);
    });
});

describe("Kotlin member extensions", () => {
    it("leaves an extension call a member extension of a receiver around may take: an object's under `with`, an inherited one, a local one, a member extension property", async () => {
        const viaWith = await one("class A\nfun A.ext(): Int = 2\nobject Exts {\n    fun A.ext(): Int = 1\n}\nfun g(a: A) = with(Exts) { a.ext() }\n");
        expect(calls(viaWith).filter((l) => l.includes("ext"))).toEqual([]);
        const inherited = await one("class A\nfun A.ext(): Int = 2\nopen class Base {\n    fun A.ext(): Int = 1\n}\nclass Sub : Base() {\n    fun g(a: A) = a.ext()\n    fun A.h() = ext()\n}\n");
        expect(calls(inherited).filter((l) => l.includes("ext"))).toEqual([]);
        const local = await one("class A\nfun A.ext(): Int = 2\nfun g(a: A): Int {\n    fun A.ext(): Int = 1\n    return a.ext()\n}\n");
        expect(calls(local).filter((l) => l.includes("ext"))).toEqual([]);
        const property = await one("class A\nfun A.f(): Int = 2\nclass Scope {\n    val A.f: () -> Int\n        get() = { 1 }\n    fun g(a: A) = a.f()\n}\n");
        expect(calls(property).filter((l) => l.includes("f()"))).toEqual([]);
    });

    it("follows a cast of `this` to a class with a member extension of the name", async () => {
        const found = await one("class A\nfun A.ext(): Int = 2\nopen class Base\nclass Sub : Base() {\n    fun A.ext(): Int = 1\n}\nfun Base.g(a: A): Int = if (this is Sub) a.ext() else 0\nclass Holder(val b: Base) {\n    fun h(a: A): Int = with(b) { if (this is Sub) a.ext() else 0 }\n}\n");
        expect(calls(found).filter((l) => l.includes("ext"))).toEqual([]);
    });

    it("links an extension no receiver around may shadow", async () => {
        const found = await one("class A\nfun A.ext(): Int = 2\nclass Plain {\n    fun g(a: A) = a.ext()\n}\n");
        expect(calls(found)).toEqual(["Main.kt:6 call A.ext() @4"]);
    });
});

describe("Kotlin nullable receivers", () => {
    it("leaves a bare call on a nullable receiver: its members don't apply, so the name goes past it", async () => {
        const found = await one("class A {\n    fun f() = 1\n}\nfun f() = 2\nfun A?.g() = f()\nfun use(block: A?.() -> Int) = block(null)\nfun t() = use { f() }\nfun u(x: A?) = x.apply { f() }\nfun w(x: A?) = with(x) { f() }\n");
        expect(calls(found).filter((l) => / (A\.)?f\(\) /.test(l))).toEqual([]);
    });

    it("reads `x?.apply {}`'s receiver as not null", async () => {
        const found = await one("class A {\n    fun f() = 1\n}\nfun f() = 2\nfun u(x: A?) = x?.apply { f() }\n");
        expect(calls(found)).toEqual(["Main.kt:7 call A.f() @4"]);
    });
});

describe("Kotlin class headers", () => {
    it("reads a supertype's arguments in the class's static scope: its companion and nested classes, a superclass's companion, never its instance", async () => {
        const found = await one("open class B(val v: Any)\nfun helper() = 2\nclass Nested\nclass A : B(helper()) {\n    companion object {\n        fun helper() = 1\n    }\n    fun helper2() = 3\n}\nclass A2 : B(Nested()) {\n    class Nested\n}\nopen class P(val v: Int) {\n    companion object {\n        fun mk(): Int = 1\n    }\n}\nfun mk(): Int = 2\nclass A3 : P(mk())\n");
        expect(calls(found).filter((l) => !/ call class (B|P) /.test(l))).toEqual(["Main.kt:6 call A.helper() @8", "Main.kt:12 call class Nested @13", "Main.kt:21 call P.mk() @17"]);
    });

    it("sees no outer instance from a nested class's, an object's or a companion's header, nor an enum's instance from an entry's arguments", async () => {
        const found = await one("open class Base(val v: Int)\nfun helper(): Int = 2\nclass C {\n    fun helper(): Int = 1\n    class N : Base(helper())\n    object O : Base(helper())\n    companion object : Base(helper())\n}\nenum class E(val v: Int) {\n    A(helper());\n    fun helper(): Int = 1\n}\n");
        expect(calls(found).filter((l) => l.includes("helper"))).toEqual(["Main.kt:7 call helper() @4", "Main.kt:8 call helper() @4", "Main.kt:9 call helper() @4", "Main.kt:12 call helper() @4"]);
    });

    it("sees no instance from a secondary constructor's parameters or its delegation call, and its static scope there", async () => {
        const found = await one("fun helper(): Int = 2\nopen class Base(val v: Int) {\n    constructor() : this(helper())\n    fun helper(): Int = 1\n}\nclass C : Base {\n    constructor(x: Int = helper(), y: String) : super(x)\n    fun inBody() = helper()\n}\nclass D(val v: Int) {\n    companion object {\n        fun mk(): Int = 7\n    }\n    constructor() : this(mk())\n    fun mk(): Int = 8\n}\n");
        expect(calls(found).filter((l) => /(helper|mk)\(\)/.test(l))).toEqual(["Main.kt:5 call helper() @3", "Main.kt:9 call helper() @3", "Main.kt:10 call Base.helper() @6", "Main.kt:16 call D.mk() @14"]);
    });

    it("leaves a supertype's argument a superclass not read may hold in its companion", async () => {
        const found = await one("fun mk(): Int = 2\nclass A : lib.P(mk())\n");
        expect(calls(found)).toEqual([]);
    });
});

describe("Kotlin static scopes", () => {
    it("takes a companion's nested class before a superclass's, and leaves a companion's function a nested class of the name competes with", async () => {
        const nested = await one("open class P {\n    class X {\n        fun f() = 1\n    }\n}\nclass C : P() {\n    companion object {\n        class X {\n            fun f() = 2\n        }\n    }\n    fun g(x: X) = x.f()\n}\n");
        expect(nested.filter((l) => l.includes(":14 "))).toEqual(["Main.kt:14 type class X @10", "Main.kt:14 call X.f() @11"]);
        const competing = await one("class Outer {\n    class Foo\n    companion object {\n        fun Foo(): Int = 1\n    }\n    class Nested {\n        fun g() = Foo()\n    }\n}\n");
        expect(calls(competing)).toEqual([]);
    });

    it("leaves `Foo.bar()` where star imports bring both a value and a class named Foo: the value comes first", async () => {
        const found = await links({
            "app/src/main/kotlin/c/C.kt": "package c\n\nval Foo = Holder()\n\nclass Holder {\n    fun bar() = 3\n}\n",
            "app/src/main/kotlin/d/D.kt": "package d\n\nimport c.*\nimport e.*\n\nfun t() = Foo.bar()\n",
            "app/src/main/kotlin/e/E.kt": "package e\n\nclass Foo {\n    companion object {\n        fun bar() = 5\n    }\n}\n",
        });
        expect(found.filter((l) => l.startsWith("D.kt"))).toEqual([]);
    });

    it("leaves an enum's own `valueOf` and `values` before its companion's, and links the companion's others", async () => {
        const found = await one('enum class E {\n    X, Y;\n    companion object {\n        fun valueOf(s: String): E = X\n        fun values(): List<E> = listOf(X)\n        fun fromCode(c: Int): E = Y\n    }\n}\nfun t1() = E.valueOf("X")\nfun t2() = E.values()\nfun t3() = E.fromCode(1)\n');
        expect(calls(found)).toEqual(["Main.kt:13 call E.fromCode() @8"]);
    });

    it("sees a companion's protected member from a subclass", async () => {
        const found = await one("open class Base {\n    companion object {\n        @JvmStatic\n        protected fun helper() = 1\n    }\n}\nfun helper() = 2\nclass Sub : Base() {\n    fun g() = helper()\n}\n");
        expect(calls(found).filter((l) => l.includes("helper"))).toEqual(["Main.kt:11 call Base.helper() @6"]);
    });
});

describe("Kotlin overloads", () => {
    it("tells overloads apart by arity, literal types and named arguments", async () => {
        const found = await one('class C {\n    fun f(x: Int) = 1\n    fun f(x: String) = 2\n    fun g(a: Int, b: Int) = 3\n    fun g(a: Int) = 4\n}\n\nfun run(c: C) {\n    c.f(1)\n    c.f("s")\n    c.g(1, 2)\n    c.g(a = 1)\n}\n');
        expect(calls(found)).toEqual(["Main.kt:11 call C.f() @4", "Main.kt:12 call C.f() @5", "Main.kt:13 call C.g() @6", "Main.kt:14 call C.g() @7"]);
    });

    it("breaks a tie of equal parameter types as kotlinc does: no vararg, then the fewest defaults, then no type parameters", async () => {
        const found = await one('class R {\n    @JvmName("reifiedTag")\n    inline fun <reified T : Any> tag(): T? = null\n    fun tag(): Any? = null\n}\n\nfun <T> g(x: Int): T? = null\nfun g(x: Int, y: Int = 0): String? = null\nfun k(x: Int) = 1\nfun k(vararg x: Int) = 2\nfun h(x: Int, y: Int = 0) = 3\nfun h(x: Int, y: Int = 0, z: Int = 0) = 4\n\nfun run(r: R) {\n    r.tag()\n    val v: String? = g(1)\n    k(1)\n    h(1)\n}\n');
        expect(calls(found)).toEqual(["Main.kt:17 call R.tag() @6", "Main.kt:18 call g() @9", "Main.kt:19 call k() @11", "Main.kt:20 call h() @13"]);
    });

    it("takes written type arguments as only a generic declaration's", async () => {
        const found = await one('class R {\n    @JvmName("reifiedTag")\n    inline fun <reified T : Any> tag(): T? = null\n    fun tag(): Any? = null\n}\n\nfun run(r: R) = r.tag<String>()\n');
        expect(calls(found)).toEqual(["Main.kt:9 call R.tag() @5"]);
    });

    it("reads a number literal's type from its suffix and size: `1L` is no Int, `1u` no Int nor Long", async () => {
        const found = await one("fun q(x: Int) = 1\nfun q(x: Any) = 2\nfun h(x: UInt) = 3\nfun h(x: Any) = 4\nfun l(x: Byte) = 5\nfun l(x: Long) = 6\n\nfun run() {\n    q(1L)\n    h(1u)\n    l(1L)\n    l(0x7fffffffff)\n}\n");
        expect(calls(found)).toEqual(["Main.kt:11 call q() @4", "Main.kt:13 call l() @8", "Main.kt:14 call l() @8"]);
    });

    it("leaves a literal passed where a library type may take it: an Int is Serializable", async () => {
        const found = await one("fun p(x: java.io.Serializable) = 1\nfun p(x: Any) = 2\n\nfun run() = p(1)\n");
        expect(calls(found)).toEqual([]);
    });

    it("leaves an override's or an actual's call that may use defaults it takes from what it overrides or actualizes", async () => {
        const found = await one("interface Cache {\n    fun clear(force: Boolean = false): Int\n}\nclass MemCache : Cache {\n    override fun clear(force: Boolean) = 1\n    fun reset() = clear()\n}\nfun clear() = 2\n");
        expect(calls(found)).toEqual([]);
        const mpp = await links({
            "m/src/commonMain/kotlin/a/Client.kt": "package a\n\nclass Config\n\nexpect fun createClient(config: Config = Config()): Int\n",
            "m/src/jvmMain/kotlin/a/Client.jvm.kt": "package a\n\nactual fun createClient(config: Config): Int = 1\n",
            "m/src/jvmMain/kotlin/a/Use.kt": "package a\n\nimport b.*\n\nfun t() = createClient()\n",
            "m/src/jvmMain/kotlin/b/B.kt": "package b\n\nfun createClient() = 2\n",
        });
        expect(calls(mpp).filter((l) => l.startsWith("Use.kt"))).toEqual([]);
    });

    it("reads a parameter of a generic type as maybe taking an argument, and keys overloads by their type arguments", async () => {
        const found = await one("open class Base\nclass Derived : Base()\nclass Box<T>(val v: T)\nclass C {\n    fun add(b: Box<Base>) = 1\n    fun t(b: Box<Derived>) = add(b)\n}\nfun C.add(b: Box<Derived>) = 2\nfun f(b: Box<Int>) = 1\nfun f(b: Box<String>, y: Int = 0) = 2\nfun u(b: Box<String>) = f(b)\n");
        expect(calls(found).filter((l) => / (C\.)?(add|f)\(\) /.test(l))).toEqual([]);
    });

    it("reads an extension on a generic type as maybe taking a receiver whose type arguments aren't known", async () => {
        const found = await links({
            "app/src/main/kotlin/app/Main.kt": "package app\n\nimport lib.*\n\nopen class Box<T>(val v: T)\nclass IntBox : Box<Int>(1)\n\nfun Box<String>.ext() = 1\n\nfun t(b: IntBox) = b.ext()\n",
            "app/src/main/kotlin/lib/Lib.kt": "package lib\n\nfun <T> app.Box<T>.ext() = 2\n",
        });
        expect(calls(found).filter((l) => l.includes("ext"))).toEqual([]);
    });

    it("knows the supertypes an enum and an annotation class have without writing them", async () => {
        const found = await one("enum class Color {\n    RED, GREEN\n}\nfun Enum<*>.label(): String = name.lowercase()\nfun Any.label(): String = \"any\"\nfun t(c: Color) = c.label()\nannotation class Tag\nfun Annotation.kind(): Int = 1\nfun Any.kind(): Int = 2\nfun u(a: Tag) = a.kind()\n");
        expect(calls(found).filter((l) => /label|kind/.test(l))).toEqual([]);
    });

    it("reads `@Deprecated`'s level, not its message", async () => {
        const found = await one('class A {\n    @Deprecated("Will be HIDDEN in 2.0", ReplaceWith("g()"))\n    fun f(x: Int): Int = 1\n}\nfun A.f(x: Any): Int = 2\nfun t(a: A) = a.f(1)\n');
        expect(calls(found)).toEqual(["Main.kt:8 call A.f() @5"]);
    });

    it("leaves overloads that both apply with different parameter types: subtyping decides", async () => {
        const found = await one("fun f(x: Any) = 1\nfun f(x: String) = 2\nfun <T> g(x: T) = 3\nfun g(x: Int) = 4\n\nfun run(s: String) {\n    f(s)\n    g(1)\n}\n");
        expect(calls(found)).toEqual([]);
    });

    it("distrusts an argument count tree-sitter splits at type arguments: `f(g<A, B>(x), y)`", async () => {
        const found = await one("fun f(x: Any, y: Any) = 1\nfun f(x: Any, y: Any, z: Any) = 2\nfun <A, B> g(x: Int) = 3\n\nfun run() = f(g<Int, String>(1), 2)\n");
        expect(calls(found)).toEqual([]);
    });

    it("ignores a declaration `@Deprecated(level = DeprecationLevel.HIDDEN)` hides", async () => {
        const found = await one('class Y {\n    @Deprecated("old", level = DeprecationLevel.HIDDEN)\n    fun m() = 1\n\n    fun m(x: Int = 0) = 2\n}\n\nfun run(y: Y) = y.m()\n');
        expect(calls(found)).toEqual(["Main.kt:10 call Y.m() @7"]);
    });
});

describe("Kotlin lambdas", () => {
    it("reads `let` as no receiver; `apply`, `run` and `with` as their receiver's; a function read's receiver lambda", async () => {
        const found = await one("class R {\n    fun lam() = 1\n}\n\nclass Html {\n    fun title() = 2\n}\n\nfun html(block: Html.() -> Unit) = Html().block()\nfun lam() = 3\nfun title() = 4\n\nfun run() {\n    R().let { lam() }\n    R().apply { lam() }\n    with(R()) { lam() }\n    html { title() }\n}\n");
        expect(calls(found).filter((l) => /lam|title/.test(l))).toEqual(["Main.kt:16 call lam() @12", "Main.kt:17 call R.lam() @4", "Main.kt:18 call R.lam() @4", "Main.kt:19 call Html.title() @8"]);
    });

    it("leaves a bare call inside a lambda passed to a function not read: it may take a receiver", async () => {
        const found = await one("fun helper() = 1\n\nfun run() {\n    lib.configure {\n        helper()\n    }\n}\n");
        expect(calls(found)).toEqual([]);
    });

    it("leaves an outer receiver's member a DSL marker hides (the compiler rejects the call)", async () => {
        const found = await one("@DslMarker\nannotation class Dsl\n\n@Dsl\nclass Html {\n    fun body(block: Body.() -> Unit) = Unit\n    fun title() = 1\n}\n\n@Dsl\nclass Body {\n    fun div() = 2\n}\n\nfun html(block: Html.() -> Unit) = Html().block()\n\nfun run() {\n    html {\n        body {\n            title()\n        }\n    }\n}\n");
        expect(calls(found).filter((l) => l.includes("title"))).toEqual([]);
    });
});

describe("Kotlin visibility and source sets", () => {
    it("passes over a private declaration of another file; leaves a call an internal one of another module may take (a friend module sees it)", async () => {
        const found = await links({
            "a/src/main/kotlin/p/One.kt": "package p\n\nprivate fun secret(x: Int) = 1\ninternal fun inner(x: Any) = 2\n",
            "a/src/main/kotlin/p/Two.kt": "package p\n\nfun secret(x: Any) = 3\nfun run() = secret(1)\n",
            "b/src/main/kotlin/p/Three.kt": "package p\n\nfun inner(x: Int = 0) = 4\nfun use() = inner(1)\n",
        });
        expect(calls(found)).toEqual(["Two.kt:4 call secret() @3"]);
    });

    it("leaves a protected member reached through another receiver, where an extension may answer", async () => {
        const found = await one("open class D {\n    protected fun pr() = 1\n}\n\nfun D.pr() = 5\n\nclass E : D() {\n    fun own() = pr()\n    fun other(d: D) = d.pr()\n}\n");
        expect(calls(found).filter((l) => l.includes("pr()"))).toEqual(["Main.kt:10 call D.pr() @4"]);
    });

    it("lets a test see its main code; never main code a test, nor one platform's set another's", async () => {
        const found = await links({
            "m/src/jvmMain/kotlin/p/Jvm.kt": "package p\n\nfun forJvm() = 1\nfun run() = fromTest() + forJs()\n",
            "m/src/jvmTest/kotlin/p/JvmTest.kt": "package p\n\nfun fromTest() = 2\nfun check() = forJvm()\n",
            "m/src/jsMain/kotlin/p/Js.kt": "package p\n\nfun forJs() = 3\n",
        });
        expect(calls(found)).toEqual(["JvmTest.kt:4 call forJvm() @Jvm.kt:3"]);
    });

    it("leaves a platform's call on an `expect` class whose `actual` isn't read: the actual may have the member", async () => {
        const found = await links({
            "m/src/commonMain/kotlin/a/Foo.kt": "package a\n\nexpect class Foo() {\n    fun a(): Int\n}\n\nfun Foo.b(): Int = 2\n",
            "m/src/jvmMain/kotlin/a/Foo.jvm.kt": "// unread\npackage a\n\nactual class Foo actual constructor() {\n    actual fun a(): Int = 1\n    fun b(): Int = 3\n}\n",
            "m/src/jvmMain/kotlin/a/Use.kt": "package a\n\nfun t(foo: Foo) = foo.b()\n",
        });
        expect(calls(found)).toEqual([]);
    });

    it("keeps an `expect` overload whose `actual` with the same parameter types isn't read", async () => {
        const found = await links({
            "m/src/commonMain/kotlin/a/F.kt": "package a\n\nexpect fun f(x: Int): Int\nexpect fun f(x: String): Int\n",
            "m/src/jvmMain/kotlin/a/F.jvm.kt": "package a\n\nactual fun f(x: Int): Int = 1\n",
            "m/src/jvmMain/kotlin/a/F2.jvm.kt": "// unread\npackage a\n\nactual fun f(x: String): Int = 2\n",
            "m/src/jvmMain/kotlin/a/Use.kt": "package a\n\nimport b.*\n\nfun t(): Int = f(\"s\")\nfun u(): Int = f(1)\n",
            "m/src/jvmMain/kotlin/b/B.kt": "package b\n\nfun f(x: Any): Int = 3\n",
        });
        expect(calls(found).filter((l) => l.startsWith("Use.kt"))).toEqual(["Use.kt:6 call f() @F.jvm.kt:3"]);
    });

    it("names an `expect` declaration from common code, its `actual` from the platform's", async () => {
        const found = await links({
            "m/src/commonMain/kotlin/p/C.kt": "package p\n\nexpect fun plat(): Int\n\nfun common() = plat()\n",
            "m/src/jvmMain/kotlin/p/J.kt": "package p\n\nactual fun plat(): Int = 1\n\nfun jvm() = plat()\n",
        });
        expect(calls(found)).toEqual(["C.kt:5 call plat() @3", "J.kt:5 call plat() @3"]);
    });
});

describe("Kotlin types", () => {
    it("links types written in declarations, `is` checks and supertypes, and an inherited nested class", async () => {
        const found = await one("open class Base {\n    class Inner\n}\n\nclass Sub : Base() {\n    val x: Inner? = null\n    fun f(b: Base) = b is Sub\n}\n");
        expect(found.filter((l) => / type /.test(l))).toEqual(["Main.kt:7 type class Base @3", "Main.kt:8 type class Inner @4", "Main.kt:9 type class Base @3", "Main.kt:9 type class Sub @7"]);
    });

    it("reads a supertype list without the class's own nested classes, and leaves a type parameter's name", async () => {
        const found = await one("open class Gen<T>\nclass Item\n\nclass Holder : Gen<Item>() {\n    class Item\n}\n\nclass Box<Item>(val value: Item)\n");
        expect(found.filter((l) => / type /.test(l))).toEqual(["Main.kt:6 type class Gen @3", "Main.kt:6 type class Item @4"]);
    });
});

describe("Kotlin parse doubt", () => {
    it("draws nothing from a file tree-sitter reads with a hard keyword as a name, and leaves the names it may declare", async () => {
        const found = await links({
            "app/src/main/kotlin/app/Good.kt": 'package app\n\nfun target(x: Any) = 1\n\nfun use() = target("s")\n',
            // tree-sitter reads an annotated `annotation class` as an expression.
            "app/src/main/kotlin/app/Bad.kt": "package app\n\n@Target(AnnotationTarget.CLASS)\n@Retention(AnnotationRetention.RUNTIME)\nannotation class Marker\n\nfun target(x: String) = 2\n\nfun bad() = target(1)\n",
        });
        expect(calls(found)).toEqual([]);
    });

    it("leaves the names a file read but not parsed may declare", async () => {
        const found = await links({
            "app/src/main/kotlin/app/Good.kt": 'package app\n\nfun target(x: Any) = 1\nfun other(x: Any) = 2\n\nfun use() = target("s") + other("s")\n',
            "app/src/main/kotlin/app/Broken.kt": "package app\n\nfun target(x: String) = ((((((( }}}}}}} ]]]]]]]\n",
        });
        expect(calls(found)).toEqual(["Good.kt:6 call other() @4"]);
    });

    it("leaves a class name a Java file read may declare in the package: it comes before a star import's", async () => {
        const found = await links({
            "app/src/main/kotlin/p/Main.kt": "package p\n\nimport q.*\n\nfun use() = Foo().go() + helper()\n",
            "app/src/main/kotlin/q/Q.kt": "package q\n\nclass Foo {\n    fun go() = 1\n}\n\nfun helper() = 2\n",
            "app/src/main/java/p/Foo.java": "package p;\n\npublic class Foo {\n    public int go() { return 3; }\n}\n",
        });
        expect(calls(found)).toEqual(["Main.kt:5 call helper() @Q.kt:7"]);
    });

    it("draws nothing from a file with an expression where only declarations stand: `context(A)` on its own line", async () => {
        const found = await one('class Logger {\n    fun log(s: String) = 1\n}\nfun log(s: String) = 2\n\ncontext(Logger)\nfun work() = log("x")\n');
        expect(calls(found)).toEqual([]);
    });

    it("gives a declaration the annotations tree-sitter reads apart on the lines before it", async () => {
        const found = await one('fun first() = 0\n\n@Deprecated("old", level = DeprecationLevel.HIDDEN)\nfun m() = 1\n\nfun m(x: Int = 0) = 2\n\n@Deprecated("Will be HIDDEN")\nfun q() = 1\n\nfun q(x: Int = 0) = 2\n\nfun run() = m() + q()\n');
        expect(calls(found)).toEqual(["Main.kt:15 call m() @8", "Main.kt:15 call q() @11"]);
    });

    it("draws nothing from a class body tree-sitter reads as a delegate's lambda (`: I by d {`)", async () => {
        const found = await one("interface I {\n    fun f(): Int\n}\n\nclass Impl : I {\n    override fun f() = 1\n}\n\nclass D(d: I) : I by d {\n    fun g() = Impl().f()\n}\n");
        expect(calls(found).filter((l) => l.includes(".f()"))).toEqual([]);
    });
});

describe("Kotlin read hints", () => {
    it("asks for an imported class's file, a supertype's and a name of the package, in the file's own source root", async () => {
        const main = "package com.app\n\nimport com.lib.Helper\n\nclass Sub : Base() {\n    fun run() = Helper().go() + Local().size + listOf(1).size\n}\n";
        const f = (await testParse("m/src/main/kotlin/com/app/Main.kt", main)) as GFile;
        const wanted = kotlinWants([f], { known: [f.path], text: () => undefined }, () => true);
        expect(wanted.sort()).toEqual(["m/src/main/kotlin/com/app/Base.kt", "m/src/main/kotlin/com/app/Local.kt", "m/src/main/kotlin/com/lib/Helper.kt"]);
    });

    it("guesses no class after a `.`, nor in a package that shares no prefix with one read, nor in another module's roots", async () => {
        const main = "package com.app\n\nimport org.other.Thing\n\nfun run() = Thing().go() + Outer.Inner() + Shared()\n";
        const f = (await testParse("m/src/main/kotlin/com/app/Main.kt", main)) as GFile;
        const g = (await testParse("n/src/main/kotlin/com/app/Other.kt", "package com.app\n\nfun other() = 1\n")) as GFile;
        const wanted = kotlinWants([f, g], { known: [f.path, g.path], text: () => undefined }, (p) => p === f.path);
        expect(wanted.sort()).toEqual(["m/src/main/kotlin/com/app/Outer.kt", "m/src/main/kotlin/com/app/Shared.kt"]);
    });

    it("asks for nothing a file read declares, and moves on from a path known missing: two paths a round", async () => {
        const main = "package app\n\nclass Sub : Base() {\n    fun run() = Local()\n}\n";
        const f = (await testParse("m/src/test/kotlin/app/MainTest.kt", main)) as GFile;
        const b = (await testParse("m/src/main/kotlin/app/Base.kt", "package app\n\nopen class Base\n")) as GFile;
        const missing = new Set(["m/src/test/kotlin/app/Local.kt"]);
        const wanted = kotlinWants([f, b], { known: [f.path, b.path], text: () => undefined, exists: (p) => !missing.has(p) }, () => true);
        expect(wanted).toEqual(["m/src/main/kotlin/app/Local.kt", "m/src/main/java/app/Local.kt"]);
    });
});
