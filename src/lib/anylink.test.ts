import { describe, expect, it } from "@jest/globals";
import { testParse } from "../test/parser.ts";
import { isGeneric, type GFile } from "./anyfacts.ts";
import { resolveAny } from "./anylink.ts";
import { langOf } from "./langs/index.ts";

/** Every reference the files make that resolves, as `path:line ref card`. */
const links = async (files: Record<string, string>): Promise<string[]> => {
    const parsed: GFile[] = [];
    for (const [path, text] of Object.entries(files)) {
        const f = await testParse(path, text);
        if (f && isGeneric(f)) parsed.push(f);
    }
    const labels = new Map(parsed.flatMap((f) => [...f.labels]));
    return resolveAny(parsed, (f) => langOf(f.path)!.resolver, (path) => files[path]).flatMap((r) => r.units.map((u) => `${r.path}:${r.line} ${r.ref} ${labels.get(u.id)}`));
};

/** Every reference that resolves, as `path:line ref path:line` of the declaration it names, where names alone would be alike. */
const targets = async (files: Record<string, string>): Promise<string[]> => {
    const parsed: GFile[] = [];
    for (const [path, text] of Object.entries(files)) {
        const f = await testParse(path, text);
        if (f && isGeneric(f)) parsed.push(f);
    }
    return resolveAny(parsed, (f) => langOf(f.path)!.resolver, (path) => files[path]).flatMap((r) => r.units.map((u) => `${r.path}:${r.line} ${r.ref} ${u.path}:${u.nameLine}`));
};

describe("Python", () => {
    it("follows imports: names, aliases, relative modules and `import a.b`", async () => {
        const found = await links({
            "app/__init__.py": "",
            "app/util.py": "def helper():\n    pass\n\nclass Box:\n    def size(self):\n        return 1\n",
            "app/run.py": "from .util import helper as h, Box\nimport app.util\n\ndef run():\n    h()\n    app.util.helper()\n    return Box().size()\n",
        });
        expect(found.filter((l) => l.startsWith("app/run.py"))).toEqual([
            "app/run.py:5 call helper()",
            "app/run.py:6 call helper()",
            "app/run.py:7 call class Box",
            "app/run.py:7 call Box.size()",
            "app/run.py:1 import helper()",
            "app/run.py:1 import class Box",
        ]);
    });

    it("leaves a name a local, a parameter or a builtin binds", async () => {
        const found = await links({ "a.py": "def helper():\n    pass\n\ndef run(helper):\n    helper()\n\ndef go():\n    helper = 1\n    helper()\n    print(len([]))\n" });
        expect(found).toEqual([]);
    });

    it("reads a method through the class's bases in C3 order, and `super()` from the next class on", async () => {
        const found = await links({
            "a.py": "class A:\n    def m(self):\n        pass\n\nclass B(A):\n    def m(self):\n        super().m()\n\nclass C(A):\n    pass\n\nclass D(B, C):\n    def run(self):\n        self.m()\n",
        });
        expect(found).toEqual(expect.arrayContaining(["a.py:7 call A.m()", "a.py:14 call B.m()"]));
        expect(found).not.toContain("a.py:14 call A.m()");
    });

    it("is sure of the class's first base when another base wasn't read: C3 puts it right after the class", async () => {
        const found = await links({ "a.py": "from typing import Generic\n\nclass A:\n    def m(self):\n        pass\n\nclass B(A, Generic[T]):\n    def run(self):\n        self.m()\n        super().m()\n" });
        expect(found).toEqual(["a.py:7 value class A", "a.py:9 call A.m()", "a.py:10 call A.m()"]);
    });

    it("is sure only of a class's own body when a base wasn't read", async () => {
        const found = await links({ "a.py": "from pkg import Base\n\nclass C(Base):\n    def own(self):\n        pass\n\n    def run(self):\n        self.own()\n        self.inherited()\n" });
        expect(found).toEqual(["a.py:8 call C.own()"]);
    });

    it("leaves a method an attribute set on self hides, or a class attribute of the same name", async () => {
        const found = await links({
            "a.py": "class A:\n    def __init__(self):\n        self.handler = None\n\n    def handler(self):\n        pass\n\n    def m(self):\n        self.handler()\n\nclass B(A):\n    m = None\n\n    def run(self):\n        self.m()\n",
        });
        expect(found).toEqual(["a.py:11 value class A"]);
    });

    it("reads a whole string annotation as the type it names, never a Literal's string", async () => {
        const found = await links({ "a.py": 'class Box:\n    def size(self):\n        return 1\n\ndef box():\n    pass\n\ndef run(b: "Box", kind: Literal["box"]) -> "Box":\n    return b.size()\n' });
        expect(found).toEqual(["a.py:8 type class Box", "a.py:8 type class Box", "a.py:9 call Box.size()"]);
    });

    it("reads a class body in order: above a definition in it, and in its bases, the name is the one outside", async () => {
        const found = await links({ "a.py": "def helper():\n    return 1\n\nclass Base:\n    pass\n\nclass A(Base):\n    Base = 2\n    x = helper()\n\n    def helper(self):\n        return 2\n\n    y = helper(None)\n" });
        expect(found).toEqual(["a.py:7 value class Base", "a.py:9 call helper()", "a.py:14 call A.helper()"]);
    });

    it("reads a default value where the function is defined", async () => {
        const found = await links({ "a.py": "LIMIT = 3\n\ndef run(x, LIMIT=LIMIT):\n    return LIMIT\n" });
        expect(found).toEqual(["a.py:3 value LIMIT"]);
    });

    it("links a joined `@overload` group or property as one card", async () => {
        const found = await links({ "a.py": "class A:\n    @property\n    def size(self):\n        return 1\n\n    @size.setter\n    def size(self, v):\n        pass\n\n    def run(self):\n        return self.size\n" });
        expect(found).toEqual(["a.py:6 value A.size", "a.py:11 value A.size"]);
    });

    it("takes `self` and `super()` in a class inside a function as that class's, which has no card", async () => {
        const found = await links({
            "a.py": "class Base:\n    def __init__(self):\n        pass\n\nclass Outer(Base):\n    def close(self):\n        pass\n\n    def make(self):\n        def factory():\n            class Conn(Base):\n                def close(self):\n                    pass\n\n                def stop(self):\n                    self.close()\n                    super().__init__()\n            return Conn\n        return factory\n",
        });
        expect(found.filter((l) => l.includes(" call "))).toEqual([]);
    });

    it("reads a class body's annotation where it is written: a nested class shadows a module-level one", async () => {
        const found = await targets({ "a.py": "class Mode:\n    def describe(self):\n        pass\n\nclass Config:\n    class Mode:\n        def describe(self):\n            pass\n\n    mode: Mode\n\n    def show(self):\n        self.mode.describe()\n" });
        expect(found.filter((l) => l.includes(" call "))).toEqual(["a.py:13 call a.py:7"]);
    });

    it("binds PEP 695 type parameters, which annotations see, so a module-level class of the same name gets no link", async () => {
        const found = await links({ "a.py": "class T:\n    def m(self):\n        pass\n\ndef first[T](items: list[T]) -> T:\n    return items[0]\n\nclass Box[T]:\n    def get(self) -> T:\n        pass\n" });
        expect(found).toEqual([]);
    });

    it("knows no type for a local that a nested function rebinds through `nonlocal`", async () => {
        const found = await links({ "a.py": "class A:\n    def m(self):\n        pass\n\nclass B:\n    def m(self):\n        pass\n\ndef outer():\n    x = A()\n    def swap():\n        nonlocal x\n        x = B()\n    swap()\n    x.m()\n" });
        expect(found.filter((l) => l.includes(" call "))).toEqual(["a.py:10 call class A", "a.py:13 call class B"]);
    });

    it("knows no type for a module's name a function rebinds through `global`; a local of that name keeps its own", async () => {
        const found = await links({
            "a.py": "class A:\n    def m(self):\n        pass\n\nclass B:\n    def m(self):\n        pass\n\nx = A()\n\ndef swap():\n    global x\n    x = B()\n\ndef use():\n    x.m()\n\ndef outer():\n    x = A()\n    def reset():\n        global x\n        x = B()\n    reset()\n    x.m()\n",
        });
        expect(found.filter((l) => l.includes(".m()"))).toEqual(["a.py:24 call A.m()"]);
    });

    it("takes from `from m import *` a literal `__all__`'s names, or else the public ones; any other `__all__` proves nothing", async () => {
        const found = await links({
            "pkg/__init__.py": "",
            "pkg/m.py": '__all__ = ["a"]\n\ndef a():\n    pass\n\ndef helper():\n    pass\n',
            "pkg/n.py": "def _private():\n    pass\n\ndef public():\n    pass\n",
            "pkg/o.py": '__all__ = ["b"] + extra\n\ndef b():\n    pass\n',
            "pkg/run.py": "from pkg.m import *\nfrom pkg.n import *\n\ndef go():\n    helper()\n    a()\n    _private()\n    public()\n",
            "pkg/run2.py": "from pkg.o import *\n\ndef go():\n    b()\n",
        });
        expect(found.filter((l) => l.startsWith("pkg/run"))).toEqual(["pkg/run.py:6 call a()", "pkg/run.py:8 call public()"]);
    });

    it("reads no write to an attribute as a use of it: `a.run = ...`, `del a.run`", async () => {
        const found = await links({ "a.py": "class A:\n    def run(self):\n        pass\n\ndef patch(a: A):\n    a.run = None\n    del a.run\n    a.run()\n" });
        expect(found).toEqual(["a.py:5 type class A", "a.py:8 call A.run()"]);
    });

    it("finds an absolute import only under the roots Python searches: no standard-library name, no folder elsewhere, no module two roots hold", async () => {
        const found = await links({
            "app/__init__.py": "",
            "app/json.py": "def dumps(obj):\n    return obj\n",
            "app/logging.py": "def getLogger(name):\n    pass\n",
            "app/api.py": "import json\nfrom logging import getLogger\n\ndef render(data):\n    return json.dumps(data)\n\ndef log():\n    getLogger(__name__)\n",
            "app/view.py": "from app.json import dumps\n\ndef show(x):\n    return dumps(x)\n",
            "homeassistant/__init__.py": "",
            "homeassistant/components/__init__.py": "",
            "homeassistant/components/wled/__init__.py": "",
            "homeassistant/components/wled/coordinator.py": "class Coordinator:\n    def refresh(self):\n        pass\n",
            "homeassistant/components/wled/light.py": "from wled import Coordinator\n\ndef setup(c: Coordinator):\n    c.refresh()\n",
            "scripts/run.py": "import helpers\n\ndef main():\n    helpers.go()\n",
            "scripts/helpers.py": "from shared import *\n",
            "tools/helpers.py": "def go():\n    pass\n",
            "utils.py": "def load():\n    pass\n",
            "tests/utils.py": "def load():\n    pass\n",
            "tests/test_a.py": "from utils import load\n\ndef test_a():\n    load()\n",
        });
        expect(found.filter((l) => /^(app|homeassistant|scripts|tests)\//.test(l))).toEqual(["app/view.py:4 call dumps()", "app/view.py:1 import dumps()"]);
    });
});

describe("Go", () => {
    it("sees a package's other files, and another package through go.mod's module path", async () => {
        const found = await links({
            "go.mod": "module example.com/m\n",
            "srv/a.go": "package srv\n\nfunc A() { B() }\n",
            "srv/b.go": "package srv\n\nfunc B() {}\n",
            "cmd/main.go": 'package main\n\nimport "example.com/m/srv"\n\nfunc main() { srv.A() }\n',
        });
        expect(found).toEqual(["srv/a.go:3 call B()", "cmd/main.go:5 call A()"]);
    });

    it("lets only tests see a `_test.go` file's names", async () => {
        const found = await links({
            "srv/a.go": "package srv\n\nfunc A() { helper() }\n",
            "srv/a_test.go": "package srv\n\nfunc helper() {}\n\nfunc TestA(t *testing.T) { A(); helper() }\n",
        });
        expect(found).toEqual(["srv/a_test.go:5 call A()", "srv/a_test.go:5 call helper()"]);
    });

    it("reaches a method through its receiver's type, never through an interface or a field holding a function", async () => {
        const found = await links({
            "s.go": "package s\n\ntype S struct{ Run func() }\n\nfunc (s *S) A() {\n\ts.B()\n\ts.Run()\n}\n\nfunc (s *S) B() {}\n\ntype T struct{}\n\nfunc (t T) Run() {}\n\ntype I interface{ B() }\n\nfunc use(i I) { i.B() }\n",
        });
        expect(found.filter((l) => l.includes(" call "))).toEqual(["s.go:6 call S.B()"]);
    });

    it("takes no method from an embedded type: the struct's own, in a file of the package not read, would win", async () => {
        const found = await links({ "s.go": "package s\n\ntype E struct{}\n\nfunc (e *E) M() {}\n\ntype S struct{ E }\n\nfunc use(s *S) { s.M() }\n" });
        expect(found.filter((l) => l.includes(" call "))).toEqual([]);
    });

    it("draws no string from a method to its own type, but does from a function", async () => {
        const found = await links({ "s.go": "package s\n\ntype S struct{}\n\nfunc (s *S) Copy() S { return S{} }\n\nfunc New() *S { return &S{} }\n" });
        expect(found).toEqual(["s.go:7 type type S", "s.go:7 type type S"]);
    });

    it("sees a local only after its statement: above `x :=`, and in its own value, the name is the one outside", async () => {
        const found = await links({
            "a.go": "package a\n\ntype Config struct{}\n\nfunc (c *Config) Load() *Other { return nil }\n\ntype Other struct{}\n\nfunc (o *Other) Load() {}\n\nfunc f(cfg *Config) {\n\tif true {\n\t\tcfg.Load()\n\t\tcfg := cfg.Load()\n\t\tcfg.Load()\n\t}\n}\n",
        });
        expect(found.filter((l) => l.includes(" call "))).toEqual(["a.go:13 call Config.Load()", "a.go:14 call Config.Load()", "a.go:15 call Other.Load()"]);
    });

    it("binds a method's receiver type parameters and a generic type's own, so a same-named type gets no link", async () => {
        const found = await links({
            "p/a.go": "package p\n\ntype T struct{}\n\nfunc (T) Close() {}\n\ntype List[T any] struct {\n\titems []T\n}\n\nfunc (l *List[T]) Each(v T) {\n\tv.Close()\n}\n\ntype Node[T any] struct {\n\tval T\n}\n\nfunc Drain(n *Node[int]) {\n\tn.val.Close()\n}\n",
        });
        expect(found).toEqual(["p/a.go:19 type type Node"]);
    });

    it("links nothing into a file another build holds: a GOOS or GOARCH suffix, or a `//go:build` line, the source's build doesn't imply; of twins, the one the source's build holds", async () => {
        const found = await targets({
            "tui/light.go": "package tui\n\nfunc Read() {\n\tgetch()\n}\n",
            "tui/light_windows.go": "package tui\n\nfunc getch() int {\n\treturn 0\n}\n",
            "tui/light_linux.go": "package tui\n\nfunc getch() int {\n\treturn 1\n}\n",
            "tui/run_linux.go": "package tui\n\nfunc run() {\n\tgetch()\n}\n",
            "p/conn.go": "package p\n\ntype Conn struct{}\n\nfunc (c *Conn) Read() {\n\tc.poll()\n}\n",
            "p/conn_linux.go": "package p\n\nfunc (c *Conn) poll() {}\n",
            "p/conn_linux_test.go": "package p\n\nfunc TestPoll(t *testing.T) {\n\tvar c Conn\n\tc.poll()\n}\n",
            "q/a.go": "//go:build linux && amd64\n\npackage q\n\nfunc A() {\n\tb()\n}\n",
            "q/b.go": "//go:build linux\n\npackage q\n\nfunc b() {}\n",
        });
        expect(found.filter((l) => l.includes(" call "))).toEqual(["tui/run_linux.go:4 call tui/light_linux.go:3", "p/conn_linux_test.go:5 call p/conn_linux.go:3", "q/a.go:6 call q/b.go:5"]);
    });

    it("takes an imported folder's package as its files declare it: never a `package main` or `//go:build ignore` file, and named by its package clause", async () => {
        const found = await links({
            "go.mod": "module example.com/m\n",
            "cmd/run.go": 'package main\n\nimport "example.com/m/lib"\n\nfunc main() {\n\tlib.Generate()\n}\n',
            "lib/gen.go": "//go:build ignore\n\npackage main\n\nfunc Generate() {}\n",
            "internal/version/info.go": "package buildinfo\n\nfunc Print() {}\n",
            "app/a.go": 'package app\n\nimport "example.com/m/internal/version"\n\nfunc run() {\n\tbuildinfo.Print()\n\tversion.Print()\n}\n',
            "tools/go.mod": "module example.com/m/tools\n",
            "tools/gen/gen.go": "package gen\n\nfunc Run() {}\n",
            "app/b.go": 'package app\n\nimport "example.com/m/tools/gen"\n\nfunc other() {\n\tgen.Run()\n}\n',
        });
        expect(found.filter((l) => l.includes(" call "))).toEqual(["app/a.go:6 call Print()"]);
    });

    it("reads a parameter's name as no use, in a function type or an interface's method too (syncthing#10472's `func(folder string)`)", async () => {
        const found = await links({
            "a.go": "package a\n\ntype folder struct{}\n\nfunc use() {\n\tmethods := []func(folder string) error{}\n\t_ = methods\n}\n\ntype Handler func(folder string, rest ...folder) error\n\ntype Model interface {\n\tScan(folder string) error\n}\n",
        });
        expect(found).toEqual(["a.go:10 type type folder"]);
    });

    it("calls a conversion `T(v)` a use of the type", async () => {
        const found = await links({ "p/a.go": "package p\n\ntype Mode int\n\nfunc set(v int) Mode {\n\treturn Mode(v)\n}\n" });
        expect(found).toEqual(["p/a.go:5 type type Mode", "p/a.go:6 type type Mode"]);
    });
});

describe("Rust", () => {
    it("reaches the type's inherent methods through self, Self and the type's name, and the module's functions by name", async () => {
        const found = await links({
            "src/a.rs": "struct S;\n\nimpl S {\n    fn new() -> Self {\n        Self::check();\n        S::check();\n        helper();\n        S\n    }\n\n    fn check() {}\n\n    fn run(&self) {\n        self.go();\n    }\n\n    fn go(&self) {}\n}\n\nfn helper() {}\n",
        });
        expect(found).toEqual(["src/a.rs:5 call S::check()", "src/a.rs:6 call S::check()", "src/a.rs:7 call helper()", "src/a.rs:14 call S::go()"]);
    });

    it("lends nothing from a trait impl, and reads no macro but the standard expression macros", async () => {
        const found = await links({
            "src/a.rs": 'struct S;\n\nimpl fmt::Display for S {\n    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {\n        Ok(())\n    }\n}\n\nfn helper() -> u32 { 1 }\n\nfn run(s: &S) {\n    s.fmt(f);\n    my_macro!(helper());\n    println!("{}", helper());\n}\n\nfn shadow() {\n    let helper = |x: u32| x;\n    helper(2);\n}\n',
        });
        expect(found).toEqual(["src/a.rs:11 type type S", "src/a.rs:14 call helper()"]);
    });

    it("sees an inline module's parent only through `use super::*`", async () => {
        const found = await links({ "src/a.rs": "fn helper() {}\n\nmod inner {\n    fn run() { helper(); }\n}\n\nmod tests {\n    use super::*;\n    fn check() { helper(); }\n}\n" });
        expect(found).toEqual(["src/a.rs:9 call helper()"]);
    });

    it("sees a `let` only after its statement: above it, and in its own value, the name is the one outside", async () => {
        const found = await links({
            "src/a.rs": "struct Raw;\n\nimpl Raw {\n    fn check(&self) {}\n    fn wrap(self) -> Msg { Msg }\n}\n\nstruct Msg;\n\nimpl Msg {\n    fn check(&self) {}\n}\n\nfn handle(msg: Raw) {\n    msg.check();\n    let msg = msg.wrap();\n    msg.check();\n}\n",
        });
        expect(found.filter((l) => l.includes(" call "))).toEqual(["src/a.rs:15 call Raw::check()", "src/a.rs:16 call Raw::wrap()", "src/a.rs:17 call Msg::check()"]);
    });

    it("reads no declaration's own name as a use: an associated item's, an enum variant's", async () => {
        const found = await links({
            "src/a.rs": "pub struct Parser {\n    pos: usize,\n}\n\nimpl Parser {\n    pub fn parse(&self) -> u32 {\n        1\n    }\n}\n\ntrait Visit {\n    fn visit(&self);\n    type Out;\n}\n\npub fn parse(src: &str) -> u32 {\n    0\n}\n\npub fn visit() {}\n\npub struct Ident;\n\npub struct Out;\n\npub enum Token {\n    Ident,\n    Number(u32),\n}\n",
        });
        expect(found).toEqual([]);
    });

    it("reads in a macro's tokens only calls, and never a name its tokens bind: a closure's parameter, a named format argument, a `matches!` pattern", async () => {
        const found = await links({
            "src/a.rs": 'fn config() -> u32 { 0 }\nfn path() -> String { String::new() }\nfn value() -> u32 { 0 }\nenum E { A(u32) }\n\nfn check(configs: &[u32], p: &str, e: E) {\n    assert!(configs.iter().all(|config| *config > 0));\n    println!("{path}", path = p);\n    assert!(matches!(e, E::A(value) if value > 0));\n    println!("{}", value());\n}\n',
        });
        expect(found).toEqual(["src/a.rs:6 type type E", "src/a.rs:10 call value()"]);
    });

    it("takes `self` and `Self` in an impl inside a function as that impl's, which has no card", async () => {
        const found = await links({
            "src/a.rs": "struct Outer;\n\nimpl Outer {\n    fn helper(&self) {}\n\n    fn build(&self) {\n        struct Local;\n        impl Local {\n            fn go(&self) {\n                self.helper();\n                Self::make();\n            }\n            fn helper(&self) {}\n            fn make() {}\n        }\n    }\n\n    fn make() {}\n}\n",
        });
        expect(found.filter((l) => l.includes(" call "))).toEqual([]);
    });

    it("types a field where it is written: a generic struct's parameter, never a same-named type", async () => {
        const found = await links({ "src/a.rs": "struct Node;\n\nimpl Node {\n    fn visit(&self) {}\n}\n\nstruct Tree<Node> {\n    root: Node,\n}\n\nimpl<N> Tree<N> {\n    fn walk(&self) {\n        self.root.visit();\n    }\n}\n" });
        expect(found).toEqual([]);
    });

    it("links `x.f()` to an inherent `&self` method only when no trait's by-value `f(self)` may come first (one in the files, or the standard library's), or when x is `self` taken by reference", async () => {
        const found = await links({
            "src/a.rs": "struct Foo;\n\nimpl Foo {\n    fn consume(&self) {}\n    fn count(&self) -> usize { 0 }\n    fn size(&self) -> usize { 0 }\n    fn go(&self) {\n        self.count();\n    }\n}\n\ntrait Take {\n    fn consume(self);\n}\n\nimpl Take for Foo {\n    fn consume(self) {}\n}\n\nfn run(f: Foo) {\n    f.consume();\n    f.count();\n    f.size();\n    Foo::consume(&f);\n}\n",
        });
        expect(found.filter((l) => l.includes(" call "))).toEqual(["src/a.rs:8 call Foo::count()", "src/a.rs:23 call Foo::size()", "src/a.rs:24 call Foo::consume()"]);
    });
});
