import { describe, expect, it } from "@jest/globals";
import { testParse } from "../../../test/parser.ts";
import { isGeneric, type GFile } from "../../anyfacts.ts";
import { resolveAny } from "../../anylink.ts";
import { rulesOf } from "../../linking.ts";
import { compiled, projectCandidates } from "./msbuild.ts";

const PROJECT = '<Project Sdk="Microsoft.NET.Sdk">\n</Project>\n';

/** Every reference the C# files resolve, as `path:line ref card`; every path the files give exists, any other is a 404. */
const links = async (files: Record<string, string>, exists: (path: string) => boolean | undefined = (p) => p in files): Promise<string[]> => {
    const parsed: GFile[] = [];
    for (const [path, text] of Object.entries(files)) {
        if (!path.endsWith(".cs")) continue;
        const f = await testParse(path, text);
        if (f && isGeneric(f)) parsed.push(f);
    }
    const labels = new Map(parsed.flatMap((f) => [...f.labels]));
    const refs = resolveAny(parsed, (f) => rulesOf(f.path)!.resolver, (path) => files[path], exists);
    return refs.flatMap((r) => r.units.map((u) => `${r.path}:${r.line} ${r.ref} ${labels.get(u.id)}`));
};

/** Every reference as `links` gives it, each card with the line its name is on: overloads apart. */
const lines = async (files: Record<string, string>): Promise<string[]> => {
    const parsed: GFile[] = [];
    for (const [path, text] of Object.entries(files)) {
        if (!path.endsWith(".cs")) continue;
        const f = await testParse(path, text);
        if (f && isGeneric(f)) parsed.push(f);
    }
    const labels = new Map(parsed.flatMap((f) => [...f.labels]));
    const refs = resolveAny(parsed, (f) => rulesOf(f.path)!.resolver, (path) => files[path], (p) => p in files);
    return refs.flatMap((r) => r.units.map((u) => `${r.path}:${r.line} ${r.ref} ${labels.get(u.id)}@${u.nameLine}`));
};

/** One file of a project, `src/App/App.cs`, with its project file. */
const app = (code: string, more: Record<string, string> = {}) => links({ "src/App/App.csproj": PROJECT, "src/App/App.cs": code, ...more });

describe("C# units", () => {
    it("names types, methods, constructors and properties, nested ones by their own type", async () => {
        const f = (await testParse("a.cs", "namespace N;\npublic record R(int A);\npublic struct S { }\npublic enum E { A }\npublic interface I { void M(); }\npublic class C\n{\n    public C() { }\n    public int P { get; set; }\n    public void M() { }\n    class Inner { void Go() { } }\n}\n")) as GFile;
        expect([...f.labels.values()]).toEqual(["record R", "struct S", "enum E", "interface I", "I.M()", "class C", "C()", "C.P", "C.M()", "class Inner", "Inner.Go()"]);
    });

    it("has no unit for a local function, an operator, a field or a namespace", async () => {
        const f = (await testParse("a.cs", "namespace N\n{\n    class C\n    {\n        int x;\n        public static C operator +(C a, C b) => a;\n        void M() { void Local() { } }\n    }\n}\n")) as GFile;
        expect([...f.labels.values()]).toEqual(["class C", "C.M()"]);
    });
});

describe("C# calls", () => {
    it("links a call to a method of the class around it, bare, through `this` and through `base`", async () => {
        const found = await app("namespace N;\n\nclass Base\n{\n    public void Ping() { }\n}\n\nclass C : Base\n{\n    void Run(int x)\n    {\n        Helper(x);\n        this.Helper(1);\n        base.Ping();\n    }\n\n    void Helper(int x) { }\n}\n");
        expect(found).toEqual(["src/App/App.cs:8 type class Base", "src/App/App.cs:12 call C.Helper()", "src/App/App.cs:13 call C.Helper()", "src/App/App.cs:14 call Base.Ping()"]);
    });

    it("leaves a name a local function, a local or a parameter binds", async () => {
        const found = await app("namespace N;\n\nclass C\n{\n    void Run(System.Action Helper)\n    {\n        Helper();\n        void Other() { }\n        Other();\n    }\n\n    void Helper() { }\n    void Other() { }\n}\n");
        expect(found).toEqual([]);
    });

    it("tells overloads apart by arity, and by the arguments' types where they prove it", async () => {
        const found = await app('namespace N;\n\nclass C\n{\n    void Run()\n    {\n        M(1);\n        M("a");\n        M(1, 2);\n        M(null);\n        K(null);\n    }\n\n    void M(int x) { }\n    void M(string s) { }\n    void M(int x, int y) { }\n    void K(string s) { }\n    void K(C c) { }\n}\n');
        // null converts to a string, not an int; to a string and a C alike.
        expect(found).toEqual(["src/App/App.cs:7 call C.M()", "src/App/App.cs:8 call C.M()", "src/App/App.cs:9 call C.M()", "src/App/App.cs:10 call C.M()", "src/App/App.cs:18 type class C"]);
    });

    it("draws no line where another overload may apply too: no better-member rule", async () => {
        const found = await app("namespace N;\n\nclass C\n{\n    void Run(Foo f, Bar b)\n    {\n        M(f);\n    }\n\n    void M(Foo f) { }\n    void M(Bar b) { }\n}\n");
        expect(found).toEqual([]);
    });

    it("takes the most derived class's method that applies, over a better one of its base (C# spec 12.8.10.2)", async () => {
        const found = await app("namespace N;\n\nclass Base\n{\n    public void M(int x) { }\n}\n\nclass D : Base\n{\n    public void M(double x) { }\n    void Run() { M(1); }\n}\n");
        expect(found).toContain("src/App/App.cs:11 call D.M()");
        expect(found).not.toContain("src/App/App.cs:11 call Base.M()");
    });

    it("names the most derived override along the receiver's type", async () => {
        const found = await app("namespace N;\n\nclass Base\n{\n    public virtual void V() { }\n}\n\nclass D : Base\n{\n    public override void V() { }\n    void Run(Base b) { V(); b.V(); }\n}\n");
        expect(found).toEqual(expect.arrayContaining(["src/App/App.cs:11 call D.V()", "src/App/App.cs:11 call Base.V()"]));
    });

    it("links a value's call only where a method surely applies: one that may not leaves an extension method to answer", async () => {
        const found = await app("namespace N;\n\nclass C\n{\n    public void M(Foo f) { }\n    void Run(C c, Foo f, object o) { c.M(f); c.M(o.Get()); M(o.Get()); }\n}\n");
        // `c.M(f)` and the bare `M(…)`; not `c.M(o.Get())`.
        expect(found).toEqual(["src/App/App.cs:6 type class C", "src/App/App.cs:6 call C.M()", "src/App/App.cs:6 call C.M()"]);
    });

    it("links nothing a base not read may answer: with arguments of unknown types, nor a name the class doesn't declare", async () => {
        const found = await app("namespace N;\n\nclass C : Unknown\n{\n    void M(int x) { }\n    void Run(object o) { M(o.Get()); Other(); M(1); }\n}\n");
        expect(found).toEqual(["src/App/App.cs:6 call C.M()"]);
    });

    it("leaves an interface's default method a class doesn't take, and reads an interface receiver's", async () => {
        const found = await app("namespace N;\n\ninterface I { void Hello() { } }\n\nclass G : I\n{\n    void Run(G g, I i) { g.Hello(); i.Hello(); }\n}\n");
        expect(found).toEqual(["src/App/App.cs:5 type interface I", "src/App/App.cs:7 type class G", "src/App/App.cs:7 type interface I", "src/App/App.cs:7 call I.Hello()"]);
    });

    it("links no member of a partial class, and nothing a primary constructor's parameter may mean", async () => {
        const found = await app("namespace N;\n\npartial class P\n{\n    void M() { }\n    void Run() { M(); }\n}\n\nclass Q(int Value)\n{\n    int Value() => 1;\n    int Read() => Value();\n}\n");
        expect(found).toEqual([]);
    });

    it("leaves a private method of another class, and a call inside `#if`", async () => {
        const found = await app("namespace N;\n\nclass A\n{\n    void Hidden() { }\n}\n\nclass B\n{\n    void Run(A a)\n    {\n#if DEBUG\n        Go();\n#endif\n        a.Hidden();\n    }\n\n    void Go() { }\n}\n");
        expect(found).toEqual(["src/App/App.cs:10 type class A"]);
    });

    it("leaves a call with a `dynamic` argument: it is bound when it runs", async () => {
        const found = await app("namespace N;\n\nclass C\n{\n    void M(int x) { }\n    void Run(dynamic d) { M(d); M(1); }\n}\n");
        expect(found).toEqual(["src/App/App.cs:6 call C.M()"]);
    });

    it("reads a query's `into` name as its own, never a member's", async () => {
        const found = await app("namespace N;\n\nclass C\n{\n    int g => 1;\n    object Run(int[] xs) => from x in xs group x by x into g select g.Key;\n}\n");
        expect(found).toEqual([]);
    });

    it("leaves a method declared inside `#if`, whatever build compiles it", async () => {
        const found = await app("namespace N;\n\nclass C\n{\n#if NET8_0\n    void M() { }\n#else\n    void M() { }\n#endif\n    void Run() { M(); }\n}\n");
        expect(found).toEqual([]);
    });
});

describe("C# constructors", () => {
    it("links `new` to its constructor, an implicit one to its type, `this(…)` and `base(…)`", async () => {
        const found = await app("namespace N;\n\nclass A\n{\n    public A(int x) { }\n    public A(string s) : this(1) { }\n}\n\nclass B : A\n{\n    public B() : base(2) { }\n}\n\nclass E { }\n\nclass U\n{\n    void Run() { var a = new A(1); var e = new E(); }\n}\n");
        expect(found).toEqual(
            expect.arrayContaining(["src/App/App.cs:6 call A()", "src/App/App.cs:11 call A()", "src/App/App.cs:18 type class A", "src/App/App.cs:18 call A()", "src/App/App.cs:18 type class E", "src/App/App.cs:18 call class E"])
        );
    });

    it("links the one constructor that may apply, its arguments' types unknown: no extension method makes an object", async () => {
        const found = await app("namespace N;\n\nclass A\n{\n    public A(Foo f) { }\n}\n\nclass U\n{\n    void Run(object o) { new A(o.Get()); }\n}\n");
        expect(found).toContain("src/App/App.cs:10 call A()");
    });

    it("reads `new()` from the type it is written to, and leaves a record's one-argument creation (its copy constructor may answer)", async () => {
        const found = await app("namespace N;\n\nclass A { }\nrecord R(int X);\n\nclass U\n{\n    A field = new();\n    A Make() => new();\n    void Run(R r) { var x = new R(1); }\n}\n");
        expect(found).toEqual(expect.arrayContaining(["src/App/App.cs:8 call class A", "src/App/App.cs:9 call class A"]));
        expect(found).not.toContain("src/App/App.cs:10 call record R");
    });
});

describe("C# names and types", () => {
    it("reads a type of the same namespace in a file beside it, never one of another namespace or folder", async () => {
        const found = await links({
            "src/App/App.csproj": PROJECT,
            "src/App/Util.cs": "namespace N;\n\nclass Util\n{\n    public static int Twice(int x) => x * 2;\n}\n",
            "src/App/Other.cs": "namespace M;\n\nclass Other\n{\n    public static int Twice(int x) => x * 2;\n}\n",
            "src/App/Sub/Far.cs": "namespace N;\n\nclass Far\n{\n    public static int Twice(int x) => x * 2;\n}\n",
            "src/App/App.cs": "using M;\n\nnamespace N;\n\nclass C\n{\n    int Run() => Util.Twice(1) + Other.Twice(2) + Far.Twice(3);\n}\n",
        });
        expect(found.filter((l) => l.startsWith("src/App/App.cs"))).toEqual(["src/App/App.cs:7 type class Util", "src/App/App.cs:7 call Util.Twice()"]);
    });

    it("reads nothing in a project whose file isn't found, nor a file its project takes out", async () => {
        const util = "namespace N;\n\nclass Util\n{\n    public static int Twice(int x) => x * 2;\n}\n";
        const code = "namespace N;\n\nclass C\n{\n    int Run() => Util.Twice(1);\n}\n";
        expect(await links({ "src/App/Util.cs": util, "src/App/App.cs": code })).toEqual([]);
        const removed = await links({ "src/App/App.csproj": '<Project Sdk="Microsoft.NET.Sdk">\n  <ItemGroup>\n    <Compile Remove="Util.cs" Condition="\'$(OS)\' == \'Windows_NT\'" />\n  </ItemGroup>\n</Project>\n', "src/App/Util.cs": util, "src/App/App.cs": code });
        expect(removed).toEqual([]);
    });

    it("leaves a type two files declare, a partial one, one inside `#if`, and another file's file-local one", async () => {
        const code = "namespace N;\n\nclass C\n{\n    void Run() { A.Go(); B.Go(); D.Go(); F.Go(); }\n}\n";
        const found = await links({
            "src/App/App.csproj": PROJECT,
            "src/App/One.cs": "namespace N;\n\nclass A { public static void Go() { } }\npartial class B { public static void Go() { } }\n#if X\nclass D { public static void Go() { } }\n#endif\nfile class F { public static void Go() { } }\n",
            "src/App/Two.cs": "namespace N;\n\nclass A { public static void Go() { } }\n",
            "src/App/App.cs": code,
        });
        expect(found.filter((l) => l.startsWith("src/App/App.cs"))).toEqual([]);
    });

    it("reads a nested type and its members, a generic type by its arity", async () => {
        const found = await app("namespace N;\n\nclass Box { }\nclass Box<T> { }\n\nclass C\n{\n    class Inner { public static void Go() { } }\n    void Run() { Inner.Go(); var a = typeof(Box<>); var b = typeof(Box); }\n}\n");
        expect(found).toEqual(["src/App/App.cs:9 type class Inner", "src/App/App.cs:9 call Inner.Go()", "src/App/App.cs:9 type class Box", "src/App/App.cs:9 type class Box"]);
        expect((await app("namespace N;\n\nclass Box { }\nclass Box<T> { }\n\nclass C\n{\n    object Run() => typeof(Box<>);\n}\n")).map((l) => l.replace(/:\d+ /, " "))).toEqual(["src/App/App.cs type class Box"]);
    });

    it("links a property through its receiver's type, never a name that may mean a type of its own (`Color Color`)", async () => {
        const found = await app("namespace N;\n\nenum State { On }\n\nclass C\n{\n    public int Count { get; }\n    public State State { get; }\n    int Run(C c) => c.Count + Count + (State == State.On ? 1 : 0);\n}\n");
        expect(found).toEqual(expect.arrayContaining(["src/App/App.cs:9 value C.Count", "src/App/App.cs:9 value C.State"]));
        expect(found.filter((l) => l === "src/App/App.cs:9 value C.State")).toHaveLength(1);
    });

    it("reads no member's name in a property pattern, an anonymous object, `nameof` or an attribute", async () => {
        const found = await app('namespace N;\n\nrecord R(string Name);\n\nclass C\n{\n    public string Name => "";\n    [System.Obsolete(nameof(Name))]\n    object Run(object o, R r) => o is C { Name: "x" } ? new { Name = 1 } : r with { Name = "y" };\n}\n');
        expect(found).toEqual(["src/App/App.cs:9 type record R", "src/App/App.cs:9 type class C"]);
    });

    it("reads `x is T` as a type, never a property of the same name", async () => {
        const found = await app("namespace N;\n\nclass Pool { }\n\nclass C\n{\n    Pool Pool => null;\n    bool Run(object o) => o is Pool;\n}\n");
        expect(found).not.toContain("src/App/App.cs:8 value C.Pool");
    });
});

describe("C# files tree-sitter may read otherwise than the compiler: they declare nothing and draw nothing", () => {
    const util = "namespace N;\n\npublic class Util\n{\n    public static int Twice(int x) => x * 2;\n    int Run() => Twice(1);\n";
    const user = { "src/App/User.cs": "namespace N;\n\nclass User\n{\n    int Run() => Util.Twice(2);\n}\n" };
    /** The links drawn with `src/App/Util.cs` holding `body` after Util's members, and a file beside it calling Util. */
    const around = (body: string) => links({ "src/App/App.csproj": PROJECT, "src/App/Util.cs": `${util}${body}}\n`, ...user });

    it("draws both files' lines where Util's file reads as written", async () => {
        expect(await around("    void M(int a, int b) { var c = a * b; }\n")).toEqual(["src/App/Util.cs:6 call Util.Twice()", "src/App/User.cs:5 type class Util", "src/App/User.cs:5 call Util.Twice()"]);
    });

    it("trusts a generic name as a type after `is` and `as`, and a generic type's member an operator takes", async () => {
        expect(await around("    object M(object o) => o as List<int> ?? (o is IList<int> l ? l : o is List<int> ? o : null);\n    int N() => Box<int>.Size + 1;\n}\n\npublic class Box<T>\n{\n    public static int Size = 1;\n")).toEqual(["src/App/Util.cs:6 call Util.Twice()", "src/App/Util.cs:8 type class Box", "src/App/User.cs:5 type class Util", "src/App/User.cs:5 call Util.Twice()"]);
    });

    it.each([
        ["a parse error", "    void M() { int x = ; }\n"],
        ["an `#if` whose branches open a brace each", "    void M(bool x)\n    {\n#if DEBUG\n        if (x) {\n#else\n        if (!x) {\n#endif\n            x = !x;\n        }\n    }\n"],
        ["`F(a * b)`, read as a declaration `a* b`", "    void M(int a, int b) { F(a * b); }\n    void F(int x) { }\n"],
        ["`F(a < b, c > d)`, read as one generic declaration", "    void M(int a, int b, int c, int d) { F(a < b, c > d); }\n    void F(bool x, bool y) { }\n"],
        ["`F(a < b, c > -1)`, read as a generic name less one", "    void M(int a, int b, int c) { F(a < b, c > -1); }\n    void F(bool x, bool y) { }\n"],
        ["`F(this.a < b, c > -d)`, read as a member's generic name less d", "    int a;\n    void M(int b, int c, int d) { F(this.a < b, c > -d); }\n    void F(bool x, bool y) { }\n"],
        ["`Get<(int A, int B)>(x)`, read as comparisons", "    void M(object o) { var v = Get<(int A, int B)>(o); }\n    T Get<T>(object o) => default!;\n"],
        ["`(int)u.Get<T>(x)`, read as comparisons", "    void M(Util u, object o) { var k = (int)u.Get<Util>(\"s\", o); }\n    T Get<T>(string s, object o) => default!;\n"],
        ["`new F<A<B>, C>(x)` in an argument, read as comparisons", "    static T First<T>(IQueryable<T> source)\n        => Exec<T, T>(\n            method: new Func<IQueryable<T>, T>(Queryable.First).Method, source);\n"],
        ["`(a) - b`, read as a cast", "    int M(int a, int b) => (a) - b;\n"],
        ["`F(async);`, read as a declaration", "    void M(bool async) { F(async); }\n    void F(bool b) { }\n"],
        ["`x is A.B && … || …`, read as `(x is A).B`", "    public const int Kind = 1;\n    bool M(object o) => o is Util.Kind && o is Util.Kind || o is Util.Kind;\n"],
        ["a C# 14 `extension` block, read as a constructor", "}\n\npublic static class Exts\n{\n    extension(Util u)\n    {\n        public int Size => 1;\n    }\n"],
    ])("%s", async (_, body) => {
        expect(await around(body)).toEqual([]);
    });
});

describe("C# misreadings tree-sitter keeps to one expression", () => {
    it("reads in a constant pattern only a type no local or member's name hides: tree-sitter's pattern takes `&& …` after it", async () => {
        const found = await app("namespace N;\n\nenum Color { Red }\n\nclass C\n{\n    bool Ok() => true;\n    bool Run(object o)\n    {\n        switch (o) { case Color.Red: return Ok(); }\n        return o is null && Ok();\n    }\n}\n");
        // Color, the type, and the first Ok(); not the second, which tree-sitter puts in the pattern `null && Ok()`.
        expect(found).toEqual(["src/App/App.cs:10 type enum Color", "src/App/App.cs:10 call C.Ok()"]);
    });

    it("gives `?.` no receiver tree-sitter took from an operator before it: `(T)x?.y` is `(T)(x?.y)`, `a == b?.c` is `a == (b?.c)`", async () => {
        const found = await app("namespace N;\n\nclass Box { public Box? Next => null; public int Size => 1; }\n\nclass C\n{\n    int Run(object o, Box b, Box a) => ((Box)o?.ToString())?.Size + (a == b?.Next ? 1 : 0);\n}\n");
        expect(found.filter((l) => l.includes("value"))).toEqual([]);
    });
});

describe("C# calls: drawn only where no judgement of types can go wrong", () => {
    it("takes a bare call's one method left once counts, names and `ref` kinds rule the others out, whatever its arguments' types", async () => {
        const found = await app("namespace N;\n\nclass C\n{\n    void M(int x) { }\n    void M(int x, int y) { }\n    void N(out int x) { x = 0; }\n    void N(int x) { }\n    void Run(object o) { M(o.GetHashCode()); N(o.GetHashCode()); }\n}\n");
        expect(found).toEqual(["src/App/App.cs:9 call C.M()", "src/App/App.cs:9 call C.N()"]);
    });

    it("needs a value's or a type's call to surely fit its method: an extension method, or a C# 14 extension member, may answer one that doesn't", async () => {
        const found = await app("namespace N;\n\nclass C\n{\n    public void M(int x) { }\n    public static void S(int x) { }\n    void Run(C c, object o) { c.M(1); c.M(o.GetHashCode()); C.S(2); C.S(o.GetHashCode()); }\n}\n");
        expect(found).toEqual(["src/App/App.cs:7 type class C", "src/App/App.cs:7 call C.M()", "src/App/App.cs:7 type class C", "src/App/App.cs:7 call C.S()", "src/App/App.cs:7 type class C"]);
    });

    it("drops a static method called through a value, an instance one through a type or from a static context (C# 7.3)", async () => {
        const found = await app('namespace N;\n\nclass D\n{\n    public static void N(string s) { }\n    public void N(object o) { }\n    public void I(int x) { }\n    void Run(D d) { d.N("x"); }\n    static void S(D d) { I(1); }\n}\n');
        expect(found).toEqual(["src/App/App.cs:8 type class D", "src/App/App.cs:8 call D.N()", "src/App/App.cs:9 type class D"]);
    });

    it("reads named arguments by the names of the override the receiver's type sees", async () => {
        const found = await app("namespace N;\n\nclass Base\n{\n    public virtual void M(int a) { }\n    public void M(Foo b) { }\n}\n\nclass D : Base\n{\n    public override void M(int b) { }\n    void Run() { M(b: 1); }\n}\n");
        expect(found.filter((l) => l.includes("call"))).toEqual([]);
    });

    it("passes `ref` to `in` and `ref readonly`, `in` to `ref readonly`, and an interpolated string to a `ref` handler", async () => {
        const found = await app("namespace N;\n\nclass C\n{\n    void Q(ref readonly int x) { }\n    void Q(Foo f) { }\n    void N(in int x) { }\n    void N(ref Foo f) { }\n    void L(string s) { }\n    void L(ref Handler h) { }\n    void Run(int y) { Q(in y); N(ref y); L($\"{y}\"); }\n}\n");
        expect(found).toEqual(["src/App/App.cs:11 call C.Q()"]);
    });
});

describe("C# constructors: the one a creation surely reaches", () => {
    it("never reaches a protected constructor through `new`, only through `base(…)`", async () => {
        const found = await lines({ "src/App/App.csproj": PROJECT, "src/App/App.cs": 'namespace N;\n\nclass Base\n{\n    public Base(object o) { }\n    protected Base(string s) { }\n    protected Base(string s, int n) { }\n}\n\nclass D : Base\n{\n    public D() : base("x", 1) { }\n    Base Make() => new Base("a");\n}\n' });
        // `base("x", 1)` the protected two-argument one; `new Base("a")` the public one, though the protected `Base(string)` takes a string as it is.
        expect(found.filter((l) => l.includes("call"))).toEqual(["src/App/App.cs:12 call Base()@7", "src/App/App.cs:13 call Base()@5"]);
    });

    it("reads `new()` from a typed declaration, a return, an assignment of its own; never from an object initializer's member", async () => {
        const found = await app("namespace N;\n\nclass A { }\nclass B { }\n\nclass O { public B Item { get; set; } = null!; }\n\nclass U\n{\n    A Item { get; set; } = new();\n    A Make() { return new(); }\n    void Run() { A a; a = new(); var o = new O { Item = new() }; }\n}\n");
        expect(found.filter((l) => l.includes("call"))).toEqual(["src/App/App.cs:10 call class A", "src/App/App.cs:11 call class A", "src/App/App.cs:12 call class A", "src/App/App.cs:12 call class O"]);
    });
});

describe("C# names: the kind C# reads", () => {
    it("reads a type parameter before a member of its name", async () => {
        const found = await app("namespace N;\n\ninterface IMake { static abstract object Make(); }\nclass Helper { public object Make() => this; }\n\nclass C\n{\n    public static Helper T => new Helper();\n    object Run<T>() where T : IMake => T.Make();\n}\n");
        expect(found.filter((l) => l.includes(":9 ") && !l.includes("type"))).toEqual([]);
    });

    it("shares a switch statement's locals among its sections", async () => {
        const found = await app("namespace N;\n\nclass C\n{\n    public int Count { get; set; }\n    void Run(int k)\n    {\n        switch (k)\n        {\n            case 1:\n                int Count = 5;\n                break;\n            case 2:\n                Count = 3;\n                break;\n        }\n    }\n}\n");
        expect(found).toEqual([]);
    });

    it("reads a generic name in an expression as a type only where no member takes the name: `M<int>` is a method group", async () => {
        const found = await app("namespace N;\n\nclass M<T> { }\n\nclass C\n{\n    static int M<T>() => 0;\n    System.Func<int> G() => M<int>;\n}\n");
        expect(found).toEqual([]);
    });

    it("links no member before `.` whose type may be named like it: a keyword's type (`string String`) or a name an alias may give", async () => {
        const found = await app("namespace N;\n\nclass Item { public int Count { get; set; } }\n\nclass C\n{\n    public string String { get; set; } = \"\";\n    public Item Thing { get; set; } = new();\n    public Logger Log { get; set; } = null!;\n    bool Run() => String.IsNullOrEmpty(String) && Thing.Count > 0 && Log.Enabled;\n}\n");
        expect(found.filter((l) => l.includes("value"))).toEqual(["src/App/App.cs:10 value C.String", "src/App/App.cs:10 value C.Thing", "src/App/App.cs:10 value Item.Count"]);
    });

    it("knows no type through a type parameter, nor a written type in a generic class's code: one class serves every instantiation", async () => {
        const found = await app("namespace N;\n\nclass Box<T>\n{\n    public T Value = default!;\n    public Inner Kept = null!;\n    public class Inner { }\n    public void Put(T x) { }\n    public void Put(int x) { }\n    public void Take(Inner i) { }\n    void Run(Box<int> o, Box<string> s) { o.Put(o.Value); o.Take(s.Kept); }\n}\n");
        expect(found.filter((l) => l.includes("call"))).toEqual([]);
    });
});

describe("C# projects", () => {
    it("looks for each folder's own project file, nearest first", () => {
        expect(projectCandidates("src/App/Sub/X.cs")).toEqual(["src/App/Sub/Sub.csproj", "src/App/App.csproj", "src/src.csproj"]);
    });

    it("compiles a file only when every MSBuild file its project reads was read and none takes it out", () => {
        const files: Record<string, string> = { "src/App/App.csproj": '<Project Sdk="Microsoft.NET.Sdk">\n  <Import Project="$(MSBuildThisFileDirectory)../Shared.props" />\n</Project>\n', "src/Shared.props": '<Project>\n  <ItemGroup>\n    <Compile Remove="**/Gen/**" />\n  </ItemGroup>\n</Project>\n' };
        const ctx = { known: Object.keys(files), text: (p: string) => files[p], exists: (p: string) => p in files };
        expect(compiled("src/App/A.cs", ctx)).toBe(true);
        expect(compiled("src/App/Gen/B.cs", ctx)).toBe(false);
        expect(compiled("src/App/A.cs", { ...ctx, exists: (p: string) => (p === "Directory.Build.props" ? undefined : p in files) })).toBe(false);
        expect(compiled("lib/X.cs", ctx)).toBe(false);
        // The SDK leaves out its output folders and hidden ones.
        expect([compiled("src/App/obj/G.cs", ctx), compiled("src/App/bin/G.cs", ctx), compiled("src/App/.cache/G.cs", ctx)]).toEqual([false, false, false]);
    });

    it("compiles nothing for sure in an old-style project, one whose folder excludes may take the file, or under a `Directory.build.props` not read", () => {
        const at = (files: Record<string, string>, path = "src/App/A.cs", exists = (p: string): boolean | undefined => p in files) => compiled(path, { known: Object.keys(files), text: (p: string) => files[p], exists });
        expect(at({ "src/App/App.csproj": '<Project ToolsVersion="15.0">\n  <ItemGroup>\n    <Compile Include="A.cs" />\n  </ItemGroup>\n</Project>\n' })).toBe(false);
        expect(at({ "src/App/App.csproj": '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <DefaultItemExcludesInProjectFolder>Old/**</DefaultItemExcludesInProjectFolder>\n  </PropertyGroup>\n</Project>\n' }, "src/App/Old/A.cs")).toBe(false);
        // A Windows build finds `Directory.build.props` for `Directory.Build.props`.
        expect(at({ "src/App/App.csproj": PROJECT, "Directory.build.props": '<Project>\n  <ItemGroup>\n    <Compile Remove="**/A.cs" />\n  </ItemGroup>\n</Project>\n' })).toBe(false);
        expect(at({ "src/App/App.csproj": PROJECT }, "src/App/A.cs", (p) => (p === "Directory.build.targets" ? undefined : p === "src/App/App.csproj"))).toBe(false);
        expect(at({ "src/App/App.csproj": PROJECT })).toBe(true);
    });
});

describe("C# review cases, round 1: each draws nothing or the line Roslyn draws", () => {
    describe("A. `#if` that opens a brace in both branches: the file is doubtful, it declares nothing and draws nothing", () => {
        it("B: a class cut by `#if` is no class other files' calls reach", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/B.cs": `namespace N;

public class B
{
    public void M(Foo f) { }
}

public class Foo { }
`, "src/App/C.cs": `namespace N;

public class C : B
{
    void A(bool x)
    {
#if DEBUG
        if (x) {
#else
        if (!x) {
#endif
            Work();
        }
    }

    void Work() { }

    public void M(Foo f) { }

    public class Options { }
}
`, "src/App/U.cs": `namespace N;

public class U
{
    void Run(C c, Foo f) { c.M(f); }
}
` })).toEqual(["src/App/B.cs:5 type class Foo", "src/App/U.cs:5 type class Foo"]);
        });
        it("S03: a method after a brace-splitting `#if` hides no override", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/S03a.cs": `namespace S03;

public class Shape
{
    public virtual double Area() => 0;
}

public class Square : Shape
{
    void Prepare(bool fast)
    {
#if DEBUG
        if (fast) {
#else
        if (!fast) {
#endif
            Warm();
        }
    }

    void Warm() { }

    public override double Area() => 4;
}
`, "src/App/S03b.cs": `namespace S03;

public class Report
{
    double Total(Square s) => s.Area();
}
` })).toEqual([]);
        });
    });
    describe("B. `new()` only where the type written is sure", () => {
        it("Q31: never in an object initializer, whose names are members of what is made", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/Q31.cs": `using Ext;

namespace Q31;

public class RetryOptions { public RetryOptions() { } public int Count { get; set; } }
public class RetryPolicy { public RetryPolicy() { } }

public class Options
{
    public RetryOptions Retry { get; set; } = null!;
}

public class Server
{
    public RetryPolicy Retry { get; } = new();
    Options Make() => new Options { Retry = new() { Count = 3 } };
    Options Make2() { var Retry2 = 1; return new Options { Retry = new() }; }
}
` })).toEqual(["src/App/Q31.cs:10 type class RetryOptions", "src/App/Q31.cs:15 type class RetryPolicy", "src/App/Q31.cs:15 call RetryPolicy()", "src/App/Q31.cs:16 type class Options", "src/App/Q31.cs:16 type class Options", "src/App/Q31.cs:16 call class Options", "src/App/Q31.cs:16 value Options.Retry", "src/App/Q31.cs:17 type class Options", "src/App/Q31.cs:17 type class Options", "src/App/Q31.cs:17 call class Options", "src/App/Q31.cs:17 value Options.Retry"]);
        });
    });
    describe("C. a type parameter is no type of its own across instantiations", () => {
        it("P01: `Put(Get())` in `Box<int>`'s subclass: T and int may be one type", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/P01.cs": `using Ext;

namespace P01;

public class Box<T>
{
    public T Get() => default!;
    public T Value { get; set; } = default!;
    public void Put(T x) { }
    public void Put(int x) { }
}

public class IntBox : Box<int>
{
    void Run() { Put(Get()); }
}

public class Use
{
    void Run(Box<string> b, Box<int> c) { b.Put(c.Get()); b.Put(c.Value); }
}
` })).toEqual(["src/App/P01.cs:13 type class Box", "src/App/P01.cs:15 call Box.Get()", "src/App/P01.cs:20 type class Box", "src/App/P01.cs:20 type class Box", "src/App/P01.cs:20 call Box.Get()", "src/App/P01.cs:20 value Box.Value"]);
        });
        it("P03: an override whose parameter needs a type argument put in names no line", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/P03.cs": `using Ext;

namespace P03;

public class Box<T> { }

public class Base<T>
{
    public virtual void M(Box<T> x) { }
}

public class D : Base<int>
{
    public override void M(Box<int> x) { }
    void Run(Box<int> b) { M(b); }
}
` })).toEqual(["src/App/P03.cs:9 type class Box", "src/App/P03.cs:12 type class Base", "src/App/P03.cs:14 type class Box", "src/App/P03.cs:15 type class Box"]);
        });
        it("P04: `ref Box<T>` against `ref Foo`: no identity judged through a type parameter", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/P04.cs": `using Ext;

namespace P04;

public class Box<T>
{
    public static void Swap(ref Box<T> a) { }
    public static void Swap(ref Foo a) { }

    public class Helper
    {
        void Run(Box<T> b) { Swap(ref b); }
    }
}

public class D : Box<int>
{
    void Run() { Box<int> x = new Box<int>(); Swap(ref x); }
}
` })).toEqual(["src/App/P04.cs:7 type class Box", "src/App/P04.cs:12 type class Box", "src/App/P04.cs:16 type class Box", "src/App/P04.cs:18 type class Box", "src/App/P04.cs:18 type class Box", "src/App/P04.cs:18 call class Box"]);
        });
        it("R02: constructors of a generic class: `T` against `int`", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/R02.cs": `using Ext;

namespace R02;

public class Box<T>
{
    public T Value = default!;
    public Box(T x) { }
    public Box(int x) { }
}

public class D : Box<int>
{
    public D(Box<int> other) : base(other.Value) { }
    Box<int> Make(Box<int> o) => new Box<int>(o.Value);
}
` })).toEqual(["src/App/R02.cs:12 type class Box", "src/App/R02.cs:14 type class Box", "src/App/R02.cs:15 type class Box", "src/App/R02.cs:15 type class Box", "src/App/R02.cs:15 type class Box"]);
        });
    });
    describe("D. tree-sitter's error-free misparses make the file doubtful", () => {
        it("T01: `Check(a < b, c > d)` read as one generic declaration", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/T01.cs": `namespace T01;

public class Value { }
public class Max { }

public class Range
{
    public int Min { get; set; }
    public int Limit { get; set; }
    public int Value2 { get; set; }

    public static bool Check(bool below, bool above) => below || above;
    public static bool Check(object o) => o != null;

    bool Run(int a, int b, int c, int d) => Check(a < b, c > d);
    bool Run2(int a, int b, int c, int d) => Check(a < b, c >= d);
}
` })).toEqual([]);
        });
        it("T02: `Show(Price * Quantity)` read as a declaration `Price* Quantity`", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/T02.cs": `namespace T02;

public struct Price
{
    public static Price operator *(Price p, int q) => p;
}

public class Line
{
    public Price Price { get; } = new Price();
    public int Quantity { get; }
    object Show(object o) => o;
    object Run() => Show(Price * Quantity);
}
` })).toEqual([]);
        });
    });
    describe("E. no argument typed by a guess", () => {
        it("Q30: a u8 string is no string; suffixed reals are their types", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/Q30.cs": `using System;
using Ext;

namespace Q30;

public class Writer
{
    public void Write(string s) { }
    public void Write(ReadOnlySpan<byte> s) { }
    public void F(float x) { }
    public void F(ulong x) { }
    public void D(double x) { }
    public void D(ulong x) { }
    public void Dm(decimal x) { }
    public void Dm(ulong x) { }
    void Run() { Write("abc"u8); F(5f); F(5F); D(5d); D(5D); D(1e3); Dm(5m); Dm(5M); }
}
` })).toEqual(["src/App/Q30.cs:16 call Writer.F()", "src/App/Q30.cs:16 call Writer.F()", "src/App/Q30.cs:16 call Writer.D()", "src/App/Q30.cs:16 call Writer.D()", "src/App/Q30.cs:16 call Writer.D()", "src/App/Q30.cs:16 call Writer.Dm()", "src/App/Q30.cs:16 call Writer.Dm()"]);
        });
        it("P10: an interpolated string may go to a handler, by value or `ref`", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/P10.cs": `using System.Runtime.CompilerServices;
using Ext;

namespace P10;

[InterpolatedStringHandler]
public ref struct MyHandler
{
    public MyHandler(int literalLength, int formattedCount) { }
    public void AppendLiteral(string s) { }
    public void AppendFormatted<T>(T t) { }
}

public class Logger
{
    public void Log(string s) { }
    public void Log(MyHandler h) { }
    void Run(int y) { Log($"x{y}"); }
}

public class Logger2
{
    public void Log(string s) { }
    public void Log([InterpolatedStringHandlerArgument("")] ref MyHandler2 h) { }
    void Run(int y) { Log($"x{y}"); }
}

[InterpolatedStringHandler]
public ref struct MyHandler2
{
    public MyHandler2(int literalLength, int formattedCount, Logger2 l) { }
    public void AppendLiteral(string s) { }
    public void AppendFormatted<T>(T t) { }
}
` })).toEqual(["src/App/P10.cs:17 type struct MyHandler", "src/App/P10.cs:24 type struct MyHandler2", "src/App/P10.cs:31 type class Logger2"]);
        });
        it("S09: no better-member rule: `OverloadResolutionPriority` can't overturn it", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/S09.cs": `using System;

namespace System.Runtime.CompilerServices
{
    [AttributeUsage(AttributeTargets.Method | AttributeTargets.Constructor | AttributeTargets.Property)]
    public sealed class OverloadResolutionPriorityAttribute : Attribute
    {
        public OverloadResolutionPriorityAttribute(int priority) { Priority = priority; }
        public int Priority { get; }
    }
}

namespace S09
{
    public class C
    {
        [System.Runtime.CompilerServices.OverloadResolutionPriority(1)]
        public void M(object o) { }
        public void M(string s) { }
        void Run() { M("x"); }
    }
}
` })).toEqual(["src/App/S09.cs:8 value OverloadResolutionPriorityAttribute.Priority"]);
        });
        it("P12: `^1` and `&x` have no primitive type", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/P12.cs": `using System;
using Ext;

namespace P12;

public class C
{
    public int Get(int i) => i;
    public int Get(Index i) => 0;
    unsafe void M(int x) { }
    unsafe void M(int* p) { }
    unsafe void Run() { Get(^1); int x = 0; M(&x); }
}
` })).toEqual([]);
        });
        it("Q32: nint arithmetic has no primitive type", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/Q32.cs": `using Ext;

namespace Q32;

public class C
{
    void M(int x) { }
    void M(long x) { }
    void Run(nint a) { M(a + 1); M(a << 1); }
}
` })).toEqual([]);
        });
        it("Q33: `+1` is an int constant; `[Optional]` makes a parameter optional", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/Q33.cs": `using System.Runtime.InteropServices;
using Ext;

namespace Q33;

public class C
{
    void M([Optional] int x) { }
    void M(params Foo[] fs) { }
    void B(byte b) { }
    void B(Foo f) { }
    void Run() { M(); B(+1); }
}
` })).toEqual([]);
        });
        it("P17: int's least value, a zero constant to an enum", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/P17.cs": `using Ext;

namespace P17;

public enum Color { Red }

public class C
{
    const int Zero = 0;
    void M(int x) { }
    void M(Foo f) { }
    void E(Color c) { }
    void E(Foo f) { }
    void Run() { M(-2147483648); E(0L); E(Zero); E(1 - 1); }
}
` })).toEqual(["src/App/P17.cs:12 type enum Color"]);
        });
    });
    describe("F. the candidate set C# reads", () => {
        it("P07: a static and an instance method both apply: no line", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/P07.cs": `using Ext;

namespace P07;

public class C
{
    public void M(string s) { }
    public static void M(object o) { }
    static void Run() { M("x"); }
    void Run2(C c) { C.M("x"); }
}

public class D
{
    public static void N(string s) { }
    public void N(object o) { }
    void Run(D d) { d.N("x"); }
}
` })).toEqual(["src/App/P07.cs:10 type class C", "src/App/P07.cs:10 type class C", "src/App/P07.cs:10 call C.M()", "src/App/P07.cs:17 type class D", "src/App/P07.cs:17 call D.N()"]);
        });
        it("Q42: through `this` and through a value: no line where a static one also applies", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/Q42.cs": `using Ext;

namespace Q42;

public class D
{
    public static void N(string s) { }
    public void N(object o) { }
    void Run() { this.N("x"); }
}

public class B { public void M(object o) { } }
public class DD : B
{
    public void M(dynamic d) { }
    void Run(DD x) { x.M(5); }
}
` })).toEqual(["src/App/Q42.cs:9 call D.N()", "src/App/Q42.cs:13 type class B", "src/App/Q42.cs:16 type class DD", "src/App/Q42.cs:16 call DD.M()"]);
        });
        it("P06: `new` never reaches a protected constructor from a derived class", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/P06.cs": `using Ext;

namespace P06;

public class Base
{
    public Base(object o) { }
    protected Base(string s) { }
}

public class Derived : Base
{
    public Derived() : base(1) { }
    Base Make() => new Base("a");
}
` })).toEqual(["src/App/P06.cs:11 type class Base", "src/App/P06.cs:13 call Base()", "src/App/P06.cs:14 type class Base", "src/App/P06.cs:14 type class Base", "src/App/P06.cs:14 call Base()"]);
        });
        it("R01: an interface's base interfaces' methods are candidates too", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/R01.cs": `using Ext;

namespace R01;

public interface IBase { void M(string s); }

public interface IDerived : IBase
{
    void M(Foo f);
    void Run() { M("x"); }
}
` })).toEqual(["src/App/R01.cs:7 type interface IBase"]);
        });
        it("S05: a C# 14 extension block makes its file doubtful; `Type.M()` needs a sure fit", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/S05.cs": `using Ext;

namespace S05;

public class Widget
{
    public static Widget Make(Foo f) => new Widget();
}

public static class WidgetExtensions
{
    extension(Widget)
    {
        public static Widget Make(string name) => new Widget();
    }
}

public class Use
{
    Widget Run() => Widget.Make("x");
}
` })).toEqual([]);
        });
    });
    describe("G. applicability C# grants and the pack can't see", () => {
        it("P05: a `dynamic` parameter takes anything", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/P05.cs": `using Ext;

namespace P05;

public class C
{
    void M(dynamic d) { }
    void M(Foo f) { }
    void Run() { M(5); }
}
` })).toEqual([]);
        });
        it("P14: a lambda may convert to object", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/P14.cs": `using Ext;

namespace P14;

public class C
{
    void M(object o) { }
    void M(Foo f) { }
    void Run() { M(() => 1); }
}
` })).toEqual([]);
        });
        it("P15: null converts to a struct with a user-defined conversion", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/P15.cs": `using Ext;

namespace P15;

public struct S
{
    public static implicit operator S(string? s) => default;
}

public class C
{
    void M(S s) { }
    void M(Bar b) { }
    void Run() { M(null); }
}
` })).toEqual(["src/App/P15.cs:7 type struct S", "src/App/P15.cs:12 type struct S"]);
        });
        it("P16: named arguments use the override's parameter names", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/P16.cs": `using Ext;

namespace P16;

public class Base
{
    public virtual void M(int a) { }
    public void M(Foo b) { }
}

public class Derived : Base
{
    public override void M(int b) { }
    void Run() { M(b: 1); }
}
` })).toEqual(["src/App/P16.cs:11 type class Base"]);
        });
        it("P22: a named argument may fill a `params` parameter", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/P22.cs": `using Ext;

namespace P22;

public class C
{
    void M(params int[] xs) { }
    void M(Foo xs) { }
    void Run() { M(xs: 1); }
}
` })).toEqual([]);
        });
        it("P11: `ref` to an `in` parameter, `in` to `ref readonly`", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/P11.cs": `using Ext;

namespace P11;

public class C
{
    void M(ref readonly int x) { }
    void M(Foo o) { }
    void N(in int x) { }
    void N(ref Foo y) { }
    void Run() { int a = 1; M(in a); M(ref a); N(ref a); }
}
` })).toEqual(["src/App/P11.cs:11 call C.M()", "src/App/P11.cs:11 call C.M()"]);
        });
    });
    describe("H. the kind of name C# reads", () => {
        it("P20: a type parameter before a member of the same name", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/P20.cs": `using Ext;

namespace P20;

public interface IMake { static abstract object Make(); }

public class Helper { public object Make() => new object(); }

public class C
{
    public static Helper T => new Helper();
    object Run<T>() where T : IMake => T.Make();
}

public class Base { protected Helper U => new Helper(); }

public class D<U> : Base where U : IMake
{
    object Run() => U.Make();
}
` })).toEqual(["src/App/P20.cs:11 type class Helper", "src/App/P20.cs:11 type class Helper", "src/App/P20.cs:11 call class Helper", "src/App/P20.cs:15 type class Helper", "src/App/P20.cs:15 type class Helper", "src/App/P20.cs:15 call class Helper", "src/App/P20.cs:17 type class Base"]);
        });
        it("Q43: a switch statement's sections share their locals", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/Q43.cs": `using Ext;

namespace Q43;

public class C
{
    public int Count { get; set; }
    public void Helper(int x) { }
    void Run(int k)
    {
        switch (k)
        {
            case 1:
                int Count = 5;
                void Helper(string s) { }
                break;
            case 2:
                Count = 3;
                Helper("x");
                break;
        }
    }
}
` })).toEqual([]);
        });
        it("Q39: `x is Foo.Bar`: no member read in a constant pattern", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/Q39.cs": `using Ext;

namespace Q39;

public class Foo { public class Bar { } public const int Size = 4; }
public class Helper { }

public class C
{
    public Helper Foo => new Helper();
    bool Run(object x) => x is Foo.Bar;
}
` })).toEqual(["src/App/Q39.cs:10 type class Helper", "src/App/Q39.cs:10 type class Helper", "src/App/Q39.cs:10 call class Helper"]);
        });
        it("S01: the method group `M<int>` is no type", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/S01.cs": `using System;

namespace S01;

public class M<T> { }

public class C
{
    static int M<T>() => 0;
    Func<int> G() => M<int>;
}
` })).toEqual([]);
        });
    });
    describe("rules the review checked and found holding", () => {
        it("P23: a generic call inside an argument", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/P23.cs": `using Ext;

namespace P23;

public class A { }
public class B { }

public class C
{
    static int G<T1, T2>(int x) => x;
    void F(int x) { }
    void F(bool a, bool b) { }
    void Run() { F(G<A, B>(7)); }
}
` })).toEqual(["src/App/P23.cs:13 call C.F()", "src/App/P23.cs:13 call C.G()", "src/App/P23.cs:13 type class A", "src/App/P23.cs:13 type class B"]);
        });
        it("P24: `(Foo)(x)` casts to the type", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/P24.cs": `using Ext;

namespace P24;

public class Foo { }

public class C
{
    public object Foo => new object();
    object Run(object x) => (Foo)(x);
}
` })).toEqual(["src/App/P24.cs:10 type class Foo"]);
        });
        it("P25: a class's nested-type lookup skips its interfaces", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/P25.cs": `using Ext;

namespace P25;

public class Nested { public static void Go() { } }

public interface I
{
    public class Nested { public static void Go() { } }
}

public class C : I
{
    void Run() { Nested.Go(); }
}
` })).toEqual(["src/App/P25.cs:12 type interface I", "src/App/P25.cs:14 type class Nested", "src/App/P25.cs:14 call Nested.Go()"]);
        });
        it("Q35: `base.M()` never reaches an extension method", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/Q35.cs": `using Ext;

namespace Q35;

public class Base { public void M(object o) { } }

public static class Exts { public static void M(this Base b, string s) { } }

public class D : Base
{
    void Run() { base.M("x"); }
}
` })).toEqual(["src/App/Q35.cs:7 type class Base", "src/App/Q35.cs:9 type class Base", "src/App/Q35.cs:11 call Base.M()"]);
        });
        it("Q36: nested types through bases", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/Q36.cs": `using Ext;

namespace Q36;

public class Inner { public Inner() { } }
public interface INested { }

public record BaseRec { public class Inner { public Inner() { } } }
public record R(Inner I) : BaseRec;

public class Base2 { public interface INested { } public class Nested { } }
public class C2 : Base2, INested { }

public class C3<T> : Base2 where T : Nested { }
public class Nested { }
` })).toEqual(["src/App/Q36.cs:9 type class Inner", "src/App/Q36.cs:9 type record BaseRec", "src/App/Q36.cs:12 type class Base2", "src/App/Q36.cs:12 type interface INested", "src/App/Q36.cs:14 type class Base2"]);
        });
        it("Q44: `#if` inside arguments and around a namespace", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/Q44.cs": `using Ext;

namespace Q44;

public class C
{
    public void M(int x) { }
    public void M(string s) { }
    void Run(bool b)
    {
        M(
#if DEBUG
            1
#else
            "x"
#endif
        );
    }
}
`, "src/App/Q45.cs": `using Ext;

#if DEBUG
namespace Q45A {
#else
namespace Q45B {
#endif
    public class Util { public static void Go() { } }
    public class User { void Run() { Util.Go(); } }
}
` })).toEqual([]);
        });
        it("R03: aliases and global usings", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/R03a.cs": `using Util = Ext.Deep.Util;

namespace R03;

public class Util { public static void Go() { } }

public class User { void Run() { Util.Go(); } }
`, "src/App/R03b.cs": `global using Foo = Ext.Deep.Foo;
global using static Ext.Other;
`, "src/App/R03c.cs": `namespace R03;

public class Foo { public static void Go() { } }

public class User2 { void Run() { Foo.Go(); } }

public class Static
{
    public static void Go(int x) { }
    void Run() { Go(1); }
}
` })).toEqual(["src/App/R03a.cs:7 type class Util", "src/App/R03a.cs:7 call Util.Go()", "src/App/R03c.cs:5 type class Foo", "src/App/R03c.cs:5 call Foo.Go()", "src/App/R03c.cs:10 call Static.Go()"]);
        });
        it("R05: only the innermost namespace's types", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/R05a.cs": `namespace R05.Inner
{
    public class Shared { public static void Go() { } }
}

namespace R05
{
    public class Outer { public static void Go() { } }

    namespace Inner
    {
        public class Use { void Run() { Shared.Go(); Outer.Go(); } }
    }
}
`, "src/App/R05b.cs": `namespace R05.Inner;

public class Use2 { void Run() { Shared.Go(); Other2.Go(); } }
`, "src/App/R05c.cs": `namespace R05.Inner
{
    public class Other2 { public static void Go() { } }
}
` })).toEqual(["src/App/R05a.cs:12 type class Shared", "src/App/R05a.cs:12 call Shared.Go()", "src/App/R05b.cs:3 type class Shared", "src/App/R05b.cs:3 call Shared.Go()", "src/App/R05b.cs:3 type class Other2", "src/App/R05b.cs:3 call Other2.Go()"]);
        });
        it("R06: partial classes", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/R06a.cs": `namespace R06;

public partial class P
{
    public void A() { }
    public void M(object o) { }
}

public class UseP { void Run(P p) { p.A(); p.M("x"); new P(); } }
`, "src/App/R06b.cs": `namespace R06;

public partial class P
{
    public void M(string s) { }
    public P() { }
}
` })).toEqual([]);
        });
        it("R07: records, record structs and primary constructors", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/R07.cs": `namespace R07;

public record R(int X, string Y)
{
    public int Z { get; init; }
    public void Deconstruct(out int a) { a = X; }
}

public record struct RS(int A);

public class PC(int value)
{
    public int Value => value;
    public int Twice() => value * 2;
}

public class UseR
{
    void Run(R r, RS rs, PC pc)
    {
        _ = r.X; _ = r.Z; _ = r with { Z = 1 };
        var (a, b) = r;
        _ = rs.A;
        _ = pc.Value; pc.Twice();
        r.Deconstruct(out int q);
        _ = r.ToString(); _ = r.Equals(r);
    }
}
` })).toEqual(["src/App/R07.cs:19 type record R", "src/App/R07.cs:19 type record RS", "src/App/R07.cs:19 type class PC", "src/App/R07.cs:21 value R.Z", "src/App/R07.cs:24 value PC.Value", "src/App/R07.cs:24 call PC.Twice()"]);
        });
        it("R08: local functions and lambda parameters hide members", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/R08.cs": `using System;

namespace R08;

public class L
{
    void Helper() { }
    void Helper(int x) { }
    void Run()
    {
        Action a = () => { Helper(); void Helper(string s) { } Helper("x"); };
        Func<int, int> f = Helper2 => Helper2 + 1;
        void Local() { Helper(1); }
        Local();
    }
    void Helper2() { }
}
` })).toEqual(["src/App/R08.cs:13 call L.Helper()"]);
        });
        it("R09: operators, indexers, `new` members", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/R09.cs": `namespace R09;

public class V
{
    public static V operator +(V a, V b) => a;
    public int this[int i] => i;
    public int Count => 1;
    public int Size() => 2;
}

public class B2 { public void Name() { } }
public class D2 : B2 { public new string Name => ""; }

public class UseV
{
    void Run(V a, V b, D2 d)
    {
        var c = a + b;
        _ = a[0];
        _ = a.Count;
        _ = a.Size();
        _ = d.Name;
    }
}
` })).toEqual(["src/App/R09.cs:5 type class V", "src/App/R09.cs:5 type class V", "src/App/R09.cs:5 type class V", "src/App/R09.cs:12 type class B2", "src/App/R09.cs:16 type class V", "src/App/R09.cs:16 type class V", "src/App/R09.cs:16 type class D2", "src/App/R09.cs:20 value V.Count", "src/App/R09.cs:21 call V.Size()", "src/App/R09.cs:22 value D2.Name"]);
        });
        it("R10: attributes and `nameof`", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/R10.cs": `using System;

namespace R10;

[AttributeUsage(AttributeTargets.All)]
public class MarkAttribute : Attribute { public MarkAttribute(string s) { } }

[Mark(nameof(Helper))]
public class A
{
    public static void Helper() { }
    [Mark("x")] void Run() { var s = nameof(Helper); Helper(); }
}
` })).toEqual(["src/App/R10.cs:12 call A.Helper()"]);
        });
        it("S08: hiding with `new`, overrides through `base`", async () => {
            expect(await links({ "src/App/App.csproj": PROJECT, "src/App/S08.cs": `namespace S08;

public class B { public void M(int x) { } }
public class D : B
{
    public new void M(object o) { }
    void Run(D d) { d.M(1); M(1); }
}

public class Grand { public virtual void V() { } }
public class Mid : Grand { public override void V() { } }
public class Leaf : Mid
{
    public override void V() { base.V(); }
}
` })).toEqual(["src/App/S08.cs:4 type class B", "src/App/S08.cs:7 type class D", "src/App/S08.cs:7 call D.M()", "src/App/S08.cs:7 call D.M()", "src/App/S08.cs:11 type class Grand", "src/App/S08.cs:12 type class Mid", "src/App/S08.cs:14 call Mid.V()"]);
        });
    });
});

describe("C# review cases, round 2: each draws nothing or the line Roslyn draws", () => {
    describe("1. a generic method's type arguments: never inferred for sure, never at all for one no parameter's type names", () => {
        it("A1: `Load<T>(string)` beside a base `Load(string)`: inference fails, the base method answers; `c.Get(\"k\")` leaves the extension method", async () => {
            expect(await lines({ "src/App/App.csproj": PROJECT, "src/App/A1.cs": `namespace A1;

public class Cache
{
    public T Get<T>(string key) => default!;
}

public static class CacheExtensions
{
    public static object Get(this Cache c, string key) => null!;
}

public class BaseStore
{
    public object Load(string key) => null!;
}

public class Store : BaseStore
{
    public T Load<T>(string key) => default!;
    object Run() => Load("k");
}

public class Use
{
    object Run(Cache c) => c.Get("k");
    object Run2(Store s) => s.Load("k");
}
` })).toEqual(["src/App/A1.cs:10 type class Cache@3", "src/App/A1.cs:18 type class BaseStore@13", "src/App/A1.cs:21 call BaseStore.Load()@15", "src/App/A1.cs:26 type class Cache@3", "src/App/A1.cs:27 type class Store@18", "src/App/A1.cs:27 call BaseStore.Load()@15"]);
        });
        it("G1: extension methods answer where inference fails: no argument names T, `out var`, `null`, `default`", async () => {
            expect(await lines({ "src/App/App.csproj": PROJECT, "src/App/G1.cs": `namespace G1;

public class Box<T> { }

public class Settings
{
    public T Get<T>(string key) => default!;
    public bool TryGet<T>(string key, out T value) { value = default!; return false; }
    public void Put<T>(Box<T> box) { }
    public void Reset<T>(T value) { }
}

public static class SettingsExtensions
{
    public static string Get(this Settings s, string key) => "";
    public static bool TryGet(this Settings s, string key, out object value) { value = null!; return false; }
    public static void Put(this Settings s, object box) { }
    public static void Reset(this Settings s, int value) { }
}

public class Use
{
    string Name(Settings s) => s.Get("name");
    bool Has(Settings s) => s.TryGet("name", out var v);
    void Clear(Settings s) { s.Put(null); s.Reset(default); }
}
` })).toEqual(["src/App/G1.cs:9 type class Box@3", "src/App/G1.cs:15 type class Settings@5", "src/App/G1.cs:16 type class Settings@5", "src/App/G1.cs:17 type class Settings@5", "src/App/G1.cs:18 type class Settings@5", "src/App/G1.cs:23 type class Settings@5", "src/App/G1.cs:24 type class Settings@5", "src/App/G1.cs:25 type class Settings@5"]);
        });
        it("Report: the extension method in a file the PR doesn't read", async () => {
            expect(await lines({ "src/App/App.csproj": PROJECT, "src/App/Report.cs": `namespace G2;

public class Report
{
    string Title(Settings s) => s.Get("title");
}
`, "src/App/Settings.cs": `namespace G2;

public class Settings
{
    public T Get<T>(string key) => default!;
}
` })).toEqual(["src/App/Report.cs:5 type class Settings@3"]);
        });
        it("T1: type arguments given draw the line; a constraint may refuse them", async () => {
            expect(await lines({ "src/App/App.csproj": PROJECT, "src/App/T1.cs": `using System.Collections.Generic;

namespace T1;

public class Cache
{
    public T Get<T>(string key) => default!;
}

public static class CacheExtensions
{
    public static object Get(this Cache c, string key) => null!;
}

public class Bag : List<int> { }

public class BaseStore
{
    public object Load(string key) => null!;
}

public class Store : BaseStore
{
    public T Load<T>(string key) => default!;
    public T Find<T, U>(T item) where T : IEnumerable<U> => item;
    public object Find(object item) => item;
    public T Pick<T>(T item) => item;
    public object Pick(string item) => item;
    public void Keep<T>(int x) where T : struct { }
    public void Keep<T>(long x) { }

    object Run() => Load("k");
    object Run2(Cache c) => c.Get("k");
    object Run3(Cache c) => c.Get<int>("k");
    object Run4(Bag b) => Find(b);
    object Run5() => Pick("s");
    void Run6() => Keep<int>(1);
}
` })).toEqual(["src/App/T1.cs:12 type class Cache@5", "src/App/T1.cs:22 type class BaseStore@17", "src/App/T1.cs:32 call BaseStore.Load()@19", "src/App/T1.cs:33 type class Cache@5", "src/App/T1.cs:34 type class Cache@5", "src/App/T1.cs:34 call Cache.Get()@7", "src/App/T1.cs:35 type class Bag@15", "src/App/T1.cs:35 call Store.Find()@26"]);
        });
        it("T1b: a ref struct as a type argument: an extension method that `allows ref struct` may answer", async () => {
            expect(await lines({ "src/App/App.csproj": PROJECT, "src/App/T1b.cs": `namespace T1;

public ref struct Tok { }

public class Sink
{
    public void Put<T>(int x) { }
}

public class Feed
{
    void Run(Sink s) { s.Put<Tok>(1); s.Put<int>(2); }
}
`, "src/App/T1c.cs": `namespace T1;

public static class SinkExtensions
{
    public static void Put<T>(this Sink s, int x) where T : allows ref struct { }
}
` })).toEqual(["src/App/T1b.cs:12 type class Sink@5", "src/App/T1b.cs:12 type struct Tok@3", "src/App/T1b.cs:12 call Sink.Put()@7"]);
        });
    });
    describe("2. a generic name an operator applies to: the file is doubtful", () => {
        it("U01: `Check(a < b, c > -1)`, `Write(i < n, v >> 8)`, `new Range(lo < hi, x > -1)`", async () => {
            expect(await lines({ "src/App/App.csproj": PROJECT, "src/App/U01.cs": `namespace U01;

public class Range
{
    public Range(bool below, bool above) { }
    public Range(object o) { }

    public static bool Check(bool below, bool above) => below || above;
    public static bool Check(object o) => o != null;

    public static void Write(bool flag, int bits) { }
    public static void Write(object o) { }

    bool Run(int a, int b, int c) => Check(a < b, c > -1);
    void Run2(int i, int n, int v) => Write(i < n, v >> 8);
    Range Run3(int lo, int hi, int x) => new Range(lo < hi, x > -1);
}
` })).toEqual([]);
        });
    });
    describe("3. a ref struct never boxes", () => {
        it("A7: to the interface it implements", async () => {
            expect(await lines({ "src/App/App.csproj": PROJECT, "src/App/A7.cs": `namespace A7;

public interface IShape { }

public ref struct Span2 : IShape { }

public class Base7
{
    public void Draw(Span2 s) { }
}

public class Derived7 : Base7
{
    public void Draw(IShape s) { }
    void Run() { var s = new Span2(); Draw(s); }
}
` })).toEqual(["src/App/A7.cs:5 type interface IShape@3", "src/App/A7.cs:9 type struct Span2@5", "src/App/A7.cs:12 type class Base7@7", "src/App/A7.cs:14 type interface IShape@3", "src/App/A7.cs:15 type struct Span2@5", "src/App/A7.cs:15 call struct Span2@5"]);
        });
        it("RS1: to object, beside a base method or an extension method that takes it", async () => {
            expect(await lines({ "src/App/App.csproj": PROJECT, "src/App/RS1.cs": `namespace RS1;

public ref struct Token
{
    public int Kind;
}

public class BaseWriter
{
    public void Write(Token t) { }
}

public class Writer : BaseWriter
{
    public void Write(object value) { }
    void Run() { var t = new Token(); Write(t); }
}

public static class WriterExtensions
{
    public static void Emit(this Writer w, Token t) { }
}

public class Writer2
{
    public void Emit(object value) { }
}

public static class Writer2Extensions
{
    public static void Emit(this Writer2 w, Token t) { }
}

public class Use
{
    void Run(Writer2 w) { var t = new Token(); w.Emit(t); }
}
` })).toEqual(["src/App/RS1.cs:10 type struct Token@3", "src/App/RS1.cs:13 type class BaseWriter@8", "src/App/RS1.cs:16 type struct Token@3", "src/App/RS1.cs:16 call struct Token@3", "src/App/RS1.cs:21 type class Writer@13", "src/App/RS1.cs:21 type struct Token@3", "src/App/RS1.cs:31 type class Writer2@24", "src/App/RS1.cs:31 type struct Token@3", "src/App/RS1.cs:36 type class Writer2@24", "src/App/RS1.cs:36 type struct Token@3", "src/App/RS1.cs:36 call struct Token@3"]);
        });
        it("T3: a part of a partial struct whose other part says `ref`", async () => {
            expect(await lines({ "src/App/App.csproj": PROJECT, "src/App/T3.cs": `namespace T3;

public interface IShape { }

public ref struct Span2 : IShape { }

public partial struct Part { }

public class Base
{
    public void Draw(Span2 s) { }
    public void Take(Part p) { }
}

public class Derived : Base
{
    public void Draw(IShape s) { }
    public void Take(object o) { }
    void Run() { var s = new Span2(); Draw(s); }
}

public partial struct Part
{
    void Run(Derived d) { d.Take(this); }
}
`, "src/App/T3b.cs": `namespace T3;

public ref partial struct Part
{
    public int X;
}
` })).toEqual(["src/App/T3.cs:5 type interface IShape@3", "src/App/T3.cs:11 type struct Span2@5", "src/App/T3.cs:15 type class Base@9", "src/App/T3.cs:17 type interface IShape@3", "src/App/T3.cs:19 type struct Span2@5", "src/App/T3.cs:19 call struct Span2@5"]);
        });
    });
    describe("4. a numeric constant zero converts to an enum, a char one never", () => {
        it("A3: `0.0`, `0m` and `0f` against `object`", async () => {
            expect(await lines({ "src/App/App.csproj": PROJECT, "src/App/A3.cs": `namespace A3;

public enum E { A }

public class C3
{
    void M(E e) { }
    void M(object o) { }
    void Run() { M(0.0); M(0m); M(0f); }
}
` })).toEqual(["src/App/A3.cs:7 type enum E@3"]);
        });
        it("T4: `1e-50f` is zero, `default(char)` no number; `0`, `1` and `2.5` are sure", async () => {
            expect(await lines({ "src/App/App.csproj": PROJECT, "src/App/T4.cs": `namespace T4;

public enum E { A }

public class Base
{
    public void M(object o) { }
}

public class Derived : Base
{
    public void M(E e) { }
    void Run()
    {
        M(0.0);
        M(0m);
        M(1e-50f);
        M(default(char));
        M(0);
        M(1);
        M(2.5);
    }
}
` })).toEqual(["src/App/T4.cs:10 type class Base@5", "src/App/T4.cs:12 type enum E@3", "src/App/T4.cs:19 call Derived.M()@12", "src/App/T4.cs:20 call Base.M()@7", "src/App/T4.cs:21 call Base.M()@7"]);
        });
    });
    describe("5. an identifier's `@` is no part of its name", () => {
        it("A6: `value:` names the parameter `@value`", async () => {
            expect(await lines({ "src/App/App.csproj": PROJECT, "src/App/A6.cs": `namespace A6;

public class C6
{
    public void M(int @value) { }
    public void M(long value) { }
    void Run() { M(value: 1); }
}
` })).toEqual([]);
        });
        it("T5: `@value:`, `@Run()`, `\\u0052un()` and `class @Box`", async () => {
            expect(await lines({ "src/App/App.csproj": PROJECT, "src/App/T5.cs": `namespace T5;

public class @Box
{
    public void M(int @value) { }
    public void M(long value) { }
    public void N(int @value) { }
    public void N(int a, int b) { }
    public void @Run() { }
    void Go() { M(value: 1); N(value: 1); Run(); Run(); }
}

public class Use
{
    void Go(Box b) { b.N(@value: 2); b.@Run(); }
}
` })).toEqual(["src/App/T5.cs:10 call @Box.N()@7", "src/App/T5.cs:10 call @Box.@Run()@9", "src/App/T5.cs:10 call @Box.@Run()@9", "src/App/T5.cs:15 type class @Box@3", "src/App/T5.cs:15 call @Box.N()@7", "src/App/T5.cs:15 call @Box.@Run()@9"]);
        });
    });
});
