import { describe, expect, it } from "@jest/globals";
import { testParse } from "../test/parser.ts";
import { isGeneric, type GFile } from "./anyfacts.ts";
import { resolveAny } from "./anylink.ts";
import { langOf } from "./langs/index.ts";

/** What the rule tables read of the files, and every reference that resolves; `exists`, what the reads found to exist: true, a 404 (false), or never asked. */
const resolve = async (files: Record<string, string>, exists?: (path: string) => boolean | undefined) => {
    const parsed: GFile[] = [];
    for (const [path, text] of Object.entries(files)) {
        const f = await testParse(path, text);
        if (f && isGeneric(f)) parsed.push(f);
    }
    return { parsed, refs: resolveAny(parsed, (f) => langOf(f.path)!.resolver, (path) => files[path], exists) };
};

/** Every reference that resolves, as `path:line ref card`, with what the reads found to exist. */
const linksKnowing = async (files: Record<string, string>, exists?: (path: string) => boolean | undefined): Promise<string[]> => {
    const { parsed, refs } = await resolve(files, exists);
    const labels = new Map(parsed.flatMap((f) => [...f.labels]));
    return refs.flatMap((r) => r.units.map((u) => `${r.path}:${r.line} ${r.ref} ${labels.get(u.id)}`));
};

/** Every reference the files make that resolves, as `path:line ref card`. */
const links = (files: Record<string, string>): Promise<string[]> => linksKnowing(files);

/** Every reference that resolves, as `path:line ref path:line` of the declaration it names, where names alone would be alike. */
const targets = async (files: Record<string, string>): Promise<string[]> => {
    const { refs } = await resolve(files);
    return refs.flatMap((r) => r.units.map((u) => `${r.path}:${r.line} ${r.ref} ${u.path}:${u.nameLine}`));
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

    it("decides a module is unique from every path the reads found, a file too long to take among them, and names nothing where a root was never asked about", async () => {
        const files = {
            "app/__init__.py": "",
            "app/main.py": "from core import thing\n\ndef run():\n    thing()\n",
            "libs/core/__init__.py": "def thing():\n    pass\n",
        };
        // The read tier reads package markers up to the first missing one: libs/__init__.py is a 404.
        const asked = (answers: Record<string, boolean>) => (path: string) => (path in files ? true : path === "libs/__init__.py" ? false : answers[path]);
        // core.py at the top is there, over READ.chars: two roots hold `core`.
        expect(await linksKnowing(files, asked({ "core.py": true }))).toEqual([]);
        // Neither `core.py` nor `core/__init__.py` is: libs/core is the one.
        expect(await linksKnowing(files, asked({ "core.py": false, "core/__init__.py": false }))).toEqual(["app/main.py:4 call thing()", "app/main.py:1 import thing()"]);
        // Never asked: the top might hold it.
        expect(await linksKnowing(files, asked({}))).toEqual([]);
    });

    it("links no absolute import that runs after its file changes `sys.path`", async () => {
        const found = await links({
            "tools/run.py": 'import os\nimport sys\nsys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))\nimport helpers\n\ndef main():\n    helpers.go()\n',
            "tools/again.py": "import sys\nsys.path += ['lib']\nfrom helpers import go\n\ndef main():\n    go()\n",
            "tools/plain.py": "import sys\nprint(sys.path[0])\nimport helpers\n\ndef main():\n    helpers.go()\n",
            "lib/helpers.py": "def go():\n    pass\n",
            "helpers.py": "def go():\n    pass\n",
        });
        expect(found.filter((l) => l.startsWith("tools/"))).toEqual(["tools/plain.py:6 call go()"]);
    });

    it("links the module-level imports above a file's first `sys.path` change as usual: they run before it (transformers#44943's test)", async () => {
        const found = await links({
            "app/__init__.py": "",
            "app/config.py": "def load():\n    pass\n",
            "custom.py": "class Custom:\n    pass\n",
            "tests/test_config.py": "import sys\nfrom pathlib import Path\n\nfrom app.config import load\n\nsys.path.append(str(Path(__file__).parent / 'utils'))\nfrom custom import Custom\n\ndef test_load():\n    load()\n    Custom()\n",
        });
        expect(found.filter((l) => l.startsWith("tests/") && l.includes(" call "))).toEqual(["tests/test_config.py:10 call load()"]);
    });

    it("links the imports above a change inside a function, never one inside a function, whose run order is unknown (mypy's build.py)", async () => {
        const found = await links({
            "mypy/__init__.py": "",
            "mypy/graph_utils.py": "def topsort(x):\n    pass\n",
            "plugin.py": "def go():\n    pass\n",
            "mypy/build.py": "import sys\n\nfrom mypy.graph_utils import topsort\n\ndef load_plugins(plugin_dir):\n    sys.path.insert(0, plugin_dir)\n    import plugin\n    plugin.go()\n\ndef order(x):\n    return topsort(x)\n",
        });
        expect(found.filter((l) => l.includes(" call "))).toEqual(["mypy/build.py:11 call topsort()"]);
    });

    it("links no module-level import below the first change, though a function holds it and is called above the import", async () => {
        const found = await links({
            "app/__init__.py": "",
            "app/early.py": "def first():\n    pass\n",
            "late.py": "def second():\n    pass\n",
            "run.py": "import sys\nfrom app.early import first\n\ndef setup():\n    sys.path.insert(0, 'vendor')\n\nsetup()\nfrom late import second\n\ndef main():\n    first()\n    second()\n",
        });
        expect(found.filter((l) => l.includes(" call ") && !l.includes("setup"))).toEqual(["run.py:11 call first()"]);
    });

    it("counts a `sys.path` change under any name: `import sys as _sys`, `from sys import path`, a name the list is assigned to", async () => {
        const root = { "lib/helpers.py": "def go():\n    pass\n", "helpers.py": "def go():\n    pass\n" };
        const calls = async (body: string) => (await links({ ...root, "tools/run.py": body })).filter((l) => l.startsWith("tools/") && l.includes(" call "));
        expect(await calls("import sys as _sys\n_sys.path.insert(0, 'lib')\nimport helpers\n\ndef main():\n    helpers.go()\n")).toEqual([]);
        expect(await calls("from sys import path\npath.insert(0, 'lib')\nimport helpers\n\ndef main():\n    helpers.go()\n")).toEqual([]);
        expect(await calls("import sys\nsearch = sys.path\nsearch.insert(0, 'lib')\nimport helpers\n\ndef main():\n    helpers.go()\n")).toEqual([]);
        // Class bodies count as module level, by position.
        expect(await calls("import sys\n\nclass Tool:\n    import helpers\n    sys.path.insert(0, 'lib')\n\n    def main(self):\n        self.helpers.go()\n\nimport helpers as later\n\ndef run():\n    later.go()\n")).toEqual([]);
        // Only reading it, or naming it in a string, changes nothing.
        expect(await calls("import sys as _sys\nprint(_sys.path[0])\nnote = 'sys.path.insert(0, lib)'\nimport helpers\n\ndef main():\n    helpers.go()\n")).toEqual(["tools/run.py:7 call go()"]);
    });

    it("counts any change to `sys.path`: through `os.sys.path` or any chain ending in `.sys`, any method on it, the list handed to any call", async () => {
        const root = { "lib/helpers.py": "def go():\n    pass\n", "helpers.py": "def go():\n    pass\n" };
        const calls = async (body: string) => (await links({ ...root, "tools/run.py": body })).filter((l) => l.startsWith("tools/") && l.includes(" call go()"));
        expect(await calls("import os\nos.sys.path.insert(0, 'lib')\nimport helpers\n\ndef main():\n    helpers.go()\n")).toEqual([]);
        expect(await calls("import sys\n\ndef prepend(paths, where):\n    paths.insert(0, where)\n\nprepend(sys.path, 'lib')\nimport helpers\n\ndef main():\n    helpers.go()\n")).toEqual([]);
        expect(await calls("import sys\nsetup(paths=sys.path)\nimport helpers\n\ndef main():\n    helpers.go()\n")).toEqual([]);
        expect(await calls("from sys import *\np = path\nq = p\nq.insert(0, 'lib')\nimport helpers\n\ndef main():\n    helpers.go()\n")).toEqual([]);
        expect(await calls("from os import sys as s\ns.path[:0] = ['lib']\nimport helpers\n\ndef main():\n    helpers.go()\n")).toEqual([]);
        // A copy handed on, or one item read, leaves the list as it is.
        expect(await calls("import sys\nshow(sys.path[:])\nprint(sys.path[0])\nimport helpers\n\ndef main():\n    helpers.go()\n")).toEqual(["tools/run.py:7 call go()"]);
        // A builtin that only reads the list changes nothing, unless the file gives its name another meaning.
        expect(await calls("import sys\nprint(sys.path)\nn = len(sys.path)\nimport helpers\n\ndef main():\n    helpers.go()\n")).toEqual(["tools/run.py:7 call go()"]);
        expect(await calls("import sys\nfrom tools.log import print\nprint(sys.path)\nimport helpers\n\ndef main():\n    helpers.go()\n")).toEqual([]);
        expect(await calls("import sys\n\ndef list(x):\n    x.insert(0, 'lib')\n\nlist(sys.path)\nimport helpers\n\ndef main():\n    helpers.go()\n")).toEqual([]);
        // A star import, or a write through globals(), may make the name mean something else: the list handed to it counts again.
        expect(await calls("import sys\nfrom tools.log import *\nprint(sys.path)\nimport helpers\n\ndef main():\n    helpers.go()\n")).toEqual([]);
        expect(await calls("import sys\nglobals()['print'] = sys.path.append\nprint(sys.path)\nimport helpers\n\ndef main():\n    helpers.go()\n")).toEqual([]);
    });

    it("links no method annotation naming a class its class binds below it, deferred or not; one above it names the nested class", async () => {
        const below = "class Mode:\n    def describe(self):\n        pass\n\nclass Config:\n    def show(self, m: Mode):\n        m.describe()\n\n    class Mode:\n        def describe(self):\n            pass\n";
        expect(await targets({ "a.py": `from __future__ import annotations\n\n${below}` })).toEqual([]);
        expect(await targets({ "a.py": below })).toEqual([]);
        const above = "class Mode:\n    def describe(self):\n        pass\n\nclass Config:\n    class Mode:\n        def describe(self):\n            pass\n\n    def show(self, m: Mode):\n        m.describe()\n";
        expect(await targets({ "a.py": above })).toEqual(["a.py:10 type a.py:6", "a.py:11 call a.py:7"]);
    });

    it("reads a class body's annotation as deferred annotations do: under `from __future__ import annotations` the nested class below it; without, where the Python version decides, nothing", async () => {
        const body = "class Mode:\n    def describe(self):\n        pass\n\nclass Config:\n    mode: Mode\n\n    class Mode:\n        def describe(self):\n            pass\n\n    def show(self):\n        self.mode.describe()\n";
        expect((await targets({ "a.py": `from __future__ import annotations\n\n${body}` })).filter((l) => / (call|type) /.test(l))).toEqual(["a.py:8 type a.py:10", "a.py:15 call a.py:11"]);
        expect(await targets({ "a.py": body })).toEqual([]);
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

    it("keeps no build answer from one review for the next in the same worker", async () => {
        const target = "//go:build linux\n\npackage term\n\nfunc getch() {}\n";
        const first = await targets({ "go.mod": "module example.com/m\n", "term/a.go": "//go:build linux\n\npackage term\n\nfunc Read() {\n\tgetch()\n}\n", "term/f.go": target });
        expect(first).toEqual(["term/a.go:6 call term/f.go:5"]);
        const second = await targets({ "go.mod": "module example.com/m\n", "term/a.go": "package term\n\nfunc Read() {\n\tgetch()\n}\n", "term/f.go": target });
        expect(second).toEqual([]);
    });

    it("reads a build constraint as go/build does, the file name cut at its first dot", async () => {
        const fn = (pkg: string, header = "") => `${header}package ${pkg}\n\nfunc f() {}\n`;
        const call = (pkg: string, header = "") => `${header}package ${pkg}\n\nfunc Caller() {\n\tf()\n}\n`;
        const cases: [string, string, string, string, boolean][] = [
            ["a.go", call("p"), "f_linux.go", fn("p"), false],
            ["a_linux.go", call("p"), "f_linux.go", fn("p"), true],
            ["a_android.go", call("p"), "f_linux.go", fn("p"), true],
            ["a_linux.go", call("p"), "f_android.go", fn("p"), false],
            ["a.go", call("p", "//go:build linux || darwin\n\n"), "f.go", fn("p", "//go:build unix\n\n"), true],
            ["a.go", call("p", "//go:build !windows\n\n"), "f.go", fn("p", "//go:build unix\n\n"), false],
            ["a.go", call("p"), "f.go", fn("p", "//go:build integration\n\n"), false],
            ["a.go", call("p", "//go:build integration\n\n"), "f.go", fn("p", "//go:build integration\n\n"), true],
            ["a.go", call("p", "//go:build integration && linux\n\n"), "f_linux.go", fn("p"), true],
            ["a_linux_test.go", call("p"), "f_linux.go", fn("p"), true],
            ["a_test.go", call("p"), "f_linux.go", fn("p"), false],
            ["a.go", call("p"), "linux.go", fn("p"), true],
            ["linux_test.go", call("p"), "f_linux.go", fn("p"), false],
            ["a.go", call("p", "// +build linux,amd64\n\n"), "f_linux.go", fn("p"), true],
            ["a.go", call("p", "// +build linux darwin\n\n"), "f_linux.go", fn("p"), false],
            ["a.go", call("p"), "f.go", fn("p", "//go:build go1.21\n\n"), true],
            ["a.go", call("p"), "f.go", fn("p", "//go:build !go1.21\n\n"), false],
            ["a.go", call("p"), "gen.go", fn("p", "//go:build ignore\n\n"), false],
            ["a.go", call("p"), "f.go", fn("p", "//go:build linux &&\n\n"), false],
            ["a.go", call("p"), "types_linux.pb.go", fn("p"), false],
            ["a_linux.go", call("p"), "types_linux.pb.go", fn("p"), true],
            ["a_linux_amd64.go", call("p"), "f_linux.go", fn("p"), true],
            ["a_linux.go", call("p"), "f_linux_amd64.go", fn("p"), false],
            ["a_amd64.go", call("p"), "f_amd64.go", fn("p"), true],
            ["a.go", call("p", "//go:build (linux && amd64) || (linux && arm64)\n\n"), "f_linux.go", fn("p"), true],
            ["a.go", call("p"), "f.go", "package p\n\n//go:build linux\n\nfunc f() {}\n", true],
        ];
        const got: string[] = [];
        for (const [k, [from, fromText, to, toText, link]] of cases.entries()) {
            const found = await targets({ "go.mod": "module example.com/m\n", [`p${k}/${from}`]: fromText.replace("package p", `package p${k}`), [`p${k}/${to}`]: toText.replace("package p", `package p${k}`) });
            if (found.some((l) => l.includes(" call ")) !== link) got.push(`${from} -> ${to}: ${link ? "no link" : "a link"}`);
        }
        expect(got).toEqual([]);
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

    it("probes `x.f()` as rustc does: a `&mut self` receiver finds a trait's `f(&mut self)` or `f(self)` before an inherent `f(&self)`, and the standard library's Write, Read and by-value methods count", async () => {
        const log = await links({
            "src/log.rs": "use std::io::{self, Write};\n\npub struct Log;\n\nimpl Log {\n    pub fn flush(&self) {}\n}\n\nimpl Write for Log {\n    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {\n        Ok(buf.len())\n    }\n    fn flush(&mut self) -> io::Result<()> {\n        Ok(())\n    }\n}\n\nimpl Log {\n    pub fn close(&mut self) {\n        self.flush();\n    }\n    pub fn peek(&self) {\n        self.flush();\n    }\n}\n",
        });
        expect(log.filter((l) => l.includes(" call "))).toEqual(["src/log.rs:23 call Log::flush()"]);
        const pos = await links({
            "src/pos.rs": "#[derive(Clone, Copy)]\npub struct Pos(u32);\n\npub trait Shift {\n    fn shift(self) -> Pos;\n}\n\nimpl Shift for Pos {\n    fn shift(self) -> Pos {\n        self\n    }\n}\n\nimpl Pos {\n    pub fn shift(&self) -> Pos {\n        *self\n    }\n    pub fn step(&mut self) {\n        self.shift();\n    }\n}\n",
        });
        expect(pos.filter((l) => l.includes(" call "))).toEqual([]);
        const buf = await links({
            "src/buf.rs": "use std::io::{self, Read};\n\npub struct Buf(Vec<u8>);\n\nimpl Buf {\n    pub fn bytes(&self) -> &[u8] {\n        &self.0\n    }\n}\n\nimpl Read for Buf {\n    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {\n        Ok(0)\n    }\n}\n\npub fn count(b: Buf) -> usize {\n    b.bytes().count()\n}\n",
        });
        expect(buf.filter((l) => l.includes(" call "))).toEqual([]);
    });

    it("never resolves a receiver a macro's nested tokens bind: a destructured closure parameter, `if let`, a `match` arm", async () => {
        const found = await targets({
            "src/check.rs": "pub struct Version;\n\nimpl Version {\n    pub fn parse() -> Version {\n        Version\n    }\n    pub fn check(&self) -> bool {\n        true\n    }\n}\n\npub struct Entry;\n\nimpl Entry {\n    pub fn check(&self) -> bool {\n        false\n    }\n}\n\npub fn all_ok(pairs: Vec<(u32, Entry)>, opt: Option<Entry>) {\n    let v = Version::parse();\n    assert!(pairs.iter().all(|(_, v)| v.check()));\n    assert!(if let Some(v) = &opt { v.check() } else { true });\n    println!(\"{}\", match &opt { Some(v) => v.check(), None => false });\n    assert!(v.check());\n}\n",
        });
        expect(found.filter((l) => l.includes(" call "))).toEqual(["src/check.rs:21 call src/check.rs:4", "src/check.rs:25 call src/check.rs:7"]);
    });

    it("lets a trait method of any mode come first for a receiver of another type: `self: Box<Self>`, `self: Rc<Self>`, `&&T`", async () => {
        const boxed = await links({
            "src/name.rs": "pub struct Name(String);\n\nimpl Name {\n    pub fn as_ref(&self) -> &str {\n        &self.0\n    }\n    pub fn describe(&self) {}\n    pub fn into_label(self: Box<Self>) -> usize {\n        self.describe();\n        let n: &Name = self.as_ref();\n        n.0.len()\n    }\n    pub fn shared(self: std::rc::Rc<Self>) {\n        self.as_ref();\n    }\n}\n",
        });
        expect(boxed.filter((l) => l.includes(" call "))).toEqual(["src/name.rs:9 call Name::describe()"]);
        const double = await links({
            "src/a.rs": "use std::fmt;\n\npub struct Foo;\n\nimpl fmt::Display for Foo {\n    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {\n        write!(f, \"foo\")\n    }\n}\n\nimpl Foo {\n    pub fn to_string(&self) -> String {\n        String::new()\n    }\n}\n\npub fn show(x: &&Foo) -> String {\n    x.to_string()\n}\n\npub fn once(x: &Foo) -> String {\n    x.to_string()\n}\n",
        });
        expect(double.filter((l) => l.includes(" call "))).toEqual(["src/a.rs:22 call Foo::to_string()"]);
    });

    it("gives a typed parameter its receiver mode, as `self` has one: `&T`, `&mut T`, `T`", async () => {
        const found = await targets({
            "src/d.rs": "pub struct Table;\n\nimpl Table {\n    pub fn find(&self, k: u32) -> Option<u32> {\n        None\n    }\n    pub fn len(&self) -> usize {\n        0\n    }\n    pub fn add(&mut self, k: u32) {}\n    pub fn next(&mut self) -> Option<u32> {\n        None\n    }\n    pub fn count(&self) -> usize {\n        0\n    }\n}\n\npub fn outside(t: &Table, m: &mut Table, v: Table) {\n    t.find(1);\n    t.len();\n    m.add(1);\n    m.next();\n    m.find(1);\n    v.len();\n    v.count();\n}\n",
        });
        // `m.find`: Iterator's `find(&mut self)` would come first; `v.count`: Iterator's `count(self)`.
        expect(found.filter((l) => l.includes(" call "))).toEqual(["src/d.rs:20 call src/d.rs:4", "src/d.rs:21 call src/d.rs:7", "src/d.rs:22 call src/d.rs:10", "src/d.rs:23 call src/d.rs:11", "src/d.rs:25 call src/d.rs:7"]);
    });

    it("reads a `|` in a macro's tokens as a closure's but right after an operand: `async |v|`, `&mut |v|`, `break |v|` bind v", async () => {
        const pre = "pub struct Version;\n\nimpl Version {\n    pub fn parse() -> Version {\n        Version\n    }\n    pub fn check(&self) -> bool {\n        true\n    }\n}\n\npub fn run<F>(f: F) -> bool {\n    true\n}\n\n";
        const found = await targets({
            "src/a.rs": `${pre}pub fn probe() -> Version {\n    let v = Version::parse();\n    assert!(run(async |v| v.check()));\n    assert!(run(&mut |v: &Version| v.check()));\n    assert!(run(loop { break |v: &Version| v.check(); }));\n    assert!(run(move |v: &Version| v.check()));\n    v\n}\n`,
        });
        expect(found.filter((l) => l.endsWith(":7"))).toEqual([]);
        // A label's name and an attribute's group end no operand.
        const marked = await targets({
            "src/a.rs": `${pre}pub fn probe() -> Version {\n    let v = Version::parse();\n    assert!(run('outer: loop { break 'outer |v: &Version| v.check(); }));\n    assert!(run(#[allow(unused)] |v: &Version| v.check()));\n    v\n}\n`,
        });
        expect(marked.filter((l) => l.endsWith(":7"))).toEqual([]);
    });

    it("reads a `|` in a macro's tokens as a closure's only where a closure can start: a bitwise or binds nothing", async () => {
        const found = await targets({
            "src/n.rs": "pub struct Version;\n\nimpl Version {\n    pub fn parse() -> Version {\n        Version\n    }\n    pub fn check(&self) -> bool {\n        true\n    }\n}\n\npub fn flags(a: u32, b: u32, list: Vec<u32>) {\n    let v = Version::parse();\n    assert!(a | b > 0 && v.check());\n    assert!(list.iter().all(|x| *x > 0 && v.check()));\n    assert!(list.iter().all(|v| v.check()));\n    assert!(list.iter().map(move |v| v.check()).count() > 0);\n}\n",
        });
        expect(found.filter((l) => l.includes(" call ") && l.endsWith(":7"))).toEqual(["src/n.rs:14 call src/n.rs:7", "src/n.rs:15 call src/n.rs:7"]);
        // A primitive type ends an operand: `x as u32 | 1` is a bitwise or.
        const cast = await targets({ "src/c.rs": "pub struct Version;\n\nimpl Version {\n    pub fn flags(&self) -> u32 {\n        0\n    }\n}\n\npub fn mask(x: u8, v: Version) {\n    assert_eq!(x as u32 | 1, v.flags());\n}\n" });
        expect(cast.filter((l) => l.includes(" call "))).toEqual(["src/c.rs:10 call src/c.rs:4"]);
    });

    it("lends an impl for some of a type's instances only to a receiver proven one of them: `self`, `Self`, a name written with the same arguments (typst#4505's `Packed<FlowElem>`)", async () => {
        const found = await targets({
            "src/flow.rs":
                "use crate::foundations::Packed;\nuse crate::model::ParElem;\n\npub struct FlowElem;\n\nimpl Packed<FlowElem> {\n    pub fn layout(&self) -> u32 {\n        self.measure()\n    }\n\n    fn measure(&self) -> u32 {\n        Self::size(self)\n    }\n\n    fn size(&self) -> u32 {\n        0\n    }\n\n    fn same(&self, other: &Self) -> u32 {\n        other.size()\n    }\n}\n\nimpl std::fmt::Debug for Packed<FlowElem> {\n    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {\n        self.layout();\n        Ok(())\n    }\n}\n\npub fn handle(par: &Packed<ParElem>, flow: &'static Packed<FlowElem>, flows: &[Packed<FlowElem>]) -> u32 {\n    par.layout();\n    flow.layout();\n    Packed::layout(flow);\n    flows[0].layout()\n}\n\nimpl std::fmt::Display for &Packed<FlowElem> {\n    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {\n        self.size();\n        Ok(())\n    }\n}\n",
        });
        // `par` is a `Packed<ParElem>`; `Packed::layout` and `flows[0]` don't say which instance.
        expect(found.filter((l) => l.includes(" call "))).toEqual(["src/flow.rs:8 call src/flow.rs:11", "src/flow.rs:12 call src/flow.rs:15", "src/flow.rs:20 call src/flow.rs:15", "src/flow.rs:26 call src/flow.rs:7", "src/flow.rs:33 call src/flow.rs:7", "src/flow.rs:40 call src/flow.rs:15"]);
    });

    it("reads an impl's own parameter as any type, and an argument left out as the default the type's declaration gives: `impl<T> Once<T, ()>` lends to `Self` in `impl<T> Default for Once<T, ()>`, a `Once<u8, ()>` and a `Once<u8>`, not a `Once<u8, fn(u8) -> u8>` (bun#30412's `Once`)", async () => {
        const found = await targets({
            "src/once.rs":
                "pub struct Once<T, F = ()> {\n    v: Option<T>,\n    f: F,\n}\n\nimpl<T> Once<T, ()> {\n    pub const fn new() -> Self {\n        todo!()\n    }\n\n    pub fn peek(&self) -> Option<&T> {\n        None\n    }\n}\n\nimpl<T> Default for Once<T, ()> {\n    fn default() -> Self {\n        Self::new()\n    }\n}\n\npub fn read(a: &Once<u8, ()>, b: &Once<u8, fn(u8) -> u8>, c: &Once<u8>) {\n    a.peek();\n    b.peek();\n    c.peek();\n}\n",
        });
        expect(found.filter((l) => l.includes(" call "))).toEqual(["src/once.rs:18 call src/once.rs:7", "src/once.rs:23 call src/once.rs:11", "src/once.rs:25 call src/once.rs:11"]);
        // A default that names another parameter, or one declared in another module, isn't read.
        const other = await targets({
            "src/pair.rs":
                "use crate::cell::Cell;\n\npub struct Pair<T, U = T>(T, U);\n\nimpl Pair<u8, u8> {\n    pub fn sum(&self) -> u8 {\n        0\n    }\n}\n\nimpl Cell<u8, ()> {\n    pub fn get(&self) -> u8 {\n        0\n    }\n}\n\npub fn read(p: &Pair<u8>, c: &Cell<u8>) {\n    p.sum();\n    c.get();\n}\n",
        });
        expect(other.filter((l) => l.includes(" call "))).toEqual([]);
    });

    it("lends an impl for every instance to any receiver, but not to one written with more arguments than the impl: those it leaves out are defaults the receiver may not share", async () => {
        const found = await targets({
            "src/buf.rs":
                "pub struct Global;\npub struct Arena;\n\npub struct Buf<T, A = Global>(T, A);\n\nimpl<T> Buf<T> {\n    pub fn put(&mut self, v: T) {}\n}\n\nimpl<T, A> Buf<T, A> {\n    pub fn make() -> Self {\n        todo!()\n    }\n\n    pub fn size(&self) -> usize {\n        self.cells()\n    }\n\n    fn cells(&self) -> usize {\n        0\n    }\n}\n\npub struct Cfg<T = u8>(T);\n\nimpl Cfg {\n    pub fn level(&self) -> u32 {\n        0\n    }\n}\n\npub fn fill(a: &mut Buf<u8>, b: &mut Buf<u8, Arena>, c: &Cfg, d: &Cfg<u16>) {\n    a.put(1);\n    b.put(1);\n    a.size();\n    b.size();\n    c.level();\n    d.level();\n    let e = Buf::make();\n    e.size();\n}\n",
        });
        // `b.put`: `impl<T> Buf<T>` is for the default allocator; `d.level`: `impl Cfg` is for the default `u8`.
        expect(found.filter((l) => l.includes(" call "))).toEqual([
            "src/buf.rs:16 call src/buf.rs:19",
            "src/buf.rs:33 call src/buf.rs:7",
            "src/buf.rs:35 call src/buf.rs:15",
            "src/buf.rs:36 call src/buf.rs:15",
            "src/buf.rs:37 call src/buf.rs:27",
            "src/buf.rs:39 call src/buf.rs:11",
            "src/buf.rs:40 call src/buf.rs:15",
        ]);
    });

    it("compares a receiver's type arguments with an impl's only where their names mean the same declarations: not a function's type parameter, a block's `use` or another module's", async () => {
        const found = await targets({
            "src/scope.rs":
                "use crate::model::Elem;\n\npub struct Packed<T>(T);\n\nimpl Packed<Elem> {\n    pub fn show(&self) {}\n}\n\npub fn plain(x: &Packed<Elem>) {\n    x.show();\n}\n\npub fn generic<Elem>(x: &Packed<Elem>) {\n    x.show();\n}\n\npub fn local(x: &Packed<Elem>) {\n    use crate::other::Elem;\n    let y: &Packed<Elem> = todo!();\n    y.show();\n}\n\nmod inner {\n    use super::*;\n    use crate::other::Elem;\n\n    pub fn nested(x: &Packed<Elem>) {\n        x.show();\n    }\n}\n",
        });
        expect(found.filter((l) => l.includes(" call "))).toEqual(["src/scope.rs:10 call src/scope.rs:6"]);
    });
});

/** Every Java reference that resolves, as `links` gives them: the files given are all there is, any other path a 404. */
const javaLinks = (files: Record<string, string>) => linksKnowing(files, (path) => path in files);

/** Java's links as `path:line ref path:line` of the declaration named, where card names alone would be alike; `exists` as the reads answered (every file but these known absent). */
const javaTargets = async (files: Record<string, string>, exists: (path: string) => boolean | undefined = (path) => path in files): Promise<string[]> => {
    const parsed: GFile[] = [];
    for (const [path, text] of Object.entries(files)) {
        const f = await testParse(path, text);
        if (f && isGeneric(f)) parsed.push(f);
    }
    return resolveAny(parsed, (f) => langOf(f.path)!.resolver, (path) => files[path], exists).flatMap((r) => r.units.map((u) => `${r.path}:${r.line} ${r.ref} ${u.path}:${u.nameLine}`));
};

describe("Java", () => {
    it("reads a package's other types beside a file, and src/main's from src/test, never src/test's from src/main", async () => {
        const found = await javaLinks({
            "src/main/java/org/x/Util.java": "package org.x;\n\npublic class Util {\n    static int twice(int x) { return x * 2; }\n}\n",
            "src/main/java/org/x/App.java": "package org.x;\n\nclass App {\n    int run() { return Util.twice(2) + Fixture.make(); }\n}\n",
            "src/test/java/org/x/Fixture.java": "package org.x;\n\nclass Fixture {\n    static int make() { return Util.twice(1); }\n}\n",
        });
        expect(found).toEqual([
            "src/main/java/org/x/App.java:4 value class Util",
            "src/main/java/org/x/App.java:4 call Util.twice()",
            "src/test/java/org/x/Fixture.java:4 value class Util",
            "src/test/java/org/x/Fixture.java:4 call Util.twice()",
        ]);
    });

    it("follows single-type and static imports in the roots a file sees, never into another module's, nor through an on-demand import", async () => {
        const util = "package org.x.a;\n\npublic class Util {\n    public static int twice(int x) { return x * 2; }\n    public static class Inner { public static int one() { return 1; } }\n}\n";
        const other = "package org.x.a;\n\npublic class Other {\n    public static int other() { return 0; }\n}\n";
        const app = "package org.x.b;\n\nimport org.x.a.Util;\nimport org.x.a.Util.Inner;\nimport static org.x.a.Util.twice;\nimport org.x.a.*;\n\nclass App {\n    int run() { return Util.twice(1) + twice(2) + Inner.one() + Other.other(); }\n}\n";
        const same = await javaLinks({ "src/main/java/org/x/a/Util.java": util, "src/main/java/org/x/a/Other.java": other, "src/main/java/org/x/b/App.java": app });
        expect(same.filter((l) => l.includes("/b/App.java"))).toEqual([
            "src/main/java/org/x/b/App.java:9 value class Util",
            "src/main/java/org/x/b/App.java:9 call Util.twice()",
            "src/main/java/org/x/b/App.java:9 call Util.twice()",
            "src/main/java/org/x/b/App.java:9 value class Inner",
            "src/main/java/org/x/b/App.java:9 call Inner.one()",
            "src/main/java/org/x/b/App.java:3 import class Util",
            "src/main/java/org/x/b/App.java:4 import class Inner",
            "src/main/java/org/x/b/App.java:5 import Util.twice()",
        ]);
        // Another module's copy may not be the one the build puts on the classpath, nor the only one.
        const modules = await javaLinks({ "core/src/main/java/org/x/a/Util.java": util, "core/src/main/java/org/x/a/Other.java": other, "app/src/main/java/org/x/b/App.java": app });
        expect(modules.filter((l) => l.startsWith("app/"))).toEqual([]);
    });

    it("names nothing in another root when two roots read hold the type", async () => {
        const u = "package org.x;\n\npublic class U {\n    public static void u() {}\n}\n";
        const found = await javaLinks({ "a/src/main/java/org/x/U.java": u, "b/src/main/java/org/x/U.java": u, "c/src/main/java/org/y/C.java": "package org.y;\n\nimport org.x.U;\n\nclass C {\n    void run() { U.u(); }\n}\n" });
        expect(found.filter((l) => l.startsWith("c/"))).toEqual([]);
    });

    it("lets a member type of a class around, a local class, or a single-type import shadow the package's type of that name", async () => {
        const found = await javaTargets({
            "src/main/java/p/Node.java": "package p;\n\npublic class Node {\n    void top() {}\n}\n",
            "src/main/java/q/Node.java": "package q;\n\npublic class Node {\n    public void q() {}\n}\n",
            "src/main/java/p/A.java": "package p;\n\nimport q.Node;\n\nclass A {\n    void run(Node n) { n.q(); }\n}\n",
            "src/main/java/p/B.java": "package p;\n\nclass B {\n    class Node { void inner() {} }\n    void run(Node n) { n.inner(); }\n}\n",
            "src/main/java/p/C.java": "package p;\n\nclass C {\n    void run() {\n        class Node { void local() {} }\n        Node n = new Node();\n        n.local();\n    }\n}\n",
            "src/main/java/p/D.java": "package p;\n\nclass D {\n    void run(Node n) { n.top(); }\n}\n",
        });
        expect(found.filter((l) => !l.startsWith("src/main/java/q/") && !/Node.java/.test(l.split(" ")[0]))).toEqual([
            "src/main/java/p/A.java:6 type src/main/java/q/Node.java:3",
            "src/main/java/p/A.java:6 call src/main/java/q/Node.java:4",
            "src/main/java/p/A.java:3 import src/main/java/q/Node.java:3",
            "src/main/java/p/B.java:5 type src/main/java/p/B.java:4",
            "src/main/java/p/B.java:5 call src/main/java/p/B.java:4",
            "src/main/java/p/D.java:4 type src/main/java/p/Node.java:3",
            "src/main/java/p/D.java:4 call src/main/java/p/Node.java:4",
        ]);
    });

    it("reads a variable before a field, a field of the class around before an outer one's, and a parameter's or a local's written type", async () => {
        const found = await javaLinks({
            "p/A.java":
                "package p;\n\nclass A {\n    Helper helper = new Helper();\n    void run(Other helper) {\n        helper.go();\n    }\n    void walk() {\n        helper.help();\n    }\n    class Inner {\n        void x() { helper.help(); walk(); }\n    }\n}\n\nclass Helper {\n    void help() {}\n}\n\nclass Other {\n    void go() {}\n}\n",
        });
        expect(found).toEqual([
            "p/A.java:4 type class Helper",
            "p/A.java:4 type class Helper",
            "p/A.java:4 call class Helper",
            "p/A.java:5 type class Other",
            "p/A.java:6 call Other.go()",
            "p/A.java:9 call Helper.help()",
            "p/A.java:12 call Helper.help()",
            "p/A.java:12 call A.walk()",
        ]);
    });

    it("reads a receiver that is a variable as no use of its type, though a method shares its name (jsoup#2616's `state.read()`)", async () => {
        const found = await javaLinks({ "p/A.java": "package p;\n\nclass Helper {\n    void go() {}\n}\n\nclass A {\n    Helper state;\n    Helper state() { return state; }\n    void run() { state.go(); state().go(); }\n}\n" });
        expect(found).toEqual(["p/A.java:8 type class Helper", "p/A.java:9 type class Helper", "p/A.java:10 call Helper.go()", "p/A.java:10 call A.state()", "p/A.java:10 call Helper.go()"]);
    });

    it("takes an unqualified call to the innermost class with a member of that name, an inherited one first, and to none past a class whose supertype isn't read", async () => {
        const found = await javaTargets({
            "src/main/java/p/Base.java": "package p;\n\nclass Base {\n    void m() {}\n    private void n() {}\n}\n",
            "src/main/java/p/A.java":
                "package p;\n\nimport lib.External;\n\nclass A {\n    void m() {}\n    void n() {}\n    void k(int x) {}\n    class Inherits extends Base {\n        void run() { m(); n(); }\n    }\n    class Unknown extends External {\n        void run() { m(); k(1); }\n    }\n    class Own extends External {\n        void own() {}\n        void run() { own(); }\n    }\n}\n",
        });
        expect(found.filter((l) => l.startsWith("src/main/java/p/A.java"))).toEqual([
            "src/main/java/p/A.java:9 type src/main/java/p/Base.java:3",
            "src/main/java/p/A.java:10 call src/main/java/p/Base.java:4",
            "src/main/java/p/A.java:10 call src/main/java/p/A.java:7",
            "src/main/java/p/A.java:17 call src/main/java/p/A.java:16",
        ]);
    });

    it("links a call only when one method fits its arguments, varargs counted, overloads across a hierarchy among them", async () => {
        const found = await javaTargets({
            "p/Base.java": "package p;\n\nclass Base {\n    void f(String s) {}\n    void g(int x) {}\n    void h(int... xs) {}\n    void k() {}\n    void k(int... xs) {}\n}\n",
            "p/Sub.java":
                "package p;\n\nclass Sub extends Base {\n    void f(int x) {}\n    void g(int x) {}\n    void run() {\n        f(1);\n        g(1);\n        h();\n        h(1, 2);\n        k();\n        k(1);\n        new Sub().g(2);\n    }\n}\n",
        });
        // `f(1)` passes an int, which only `f(int)` takes; `g(1)` is Sub's, which overrides Base's; `k()` the k of no parameter, `k(1)` the varargs one.
        expect(found.filter((l) => l.startsWith("p/Sub.java"))).toEqual([
            "p/Sub.java:3 type p/Base.java:3",
            "p/Sub.java:7 call p/Sub.java:4",
            "p/Sub.java:8 call p/Sub.java:5",
            "p/Sub.java:9 call p/Base.java:6",
            "p/Sub.java:10 call p/Base.java:6",
            "p/Sub.java:11 call p/Base.java:7",
            "p/Sub.java:12 call p/Base.java:8",
            "p/Sub.java:13 type p/Sub.java:3",
            "p/Sub.java:13 call p/Sub.java:3",
            "p/Sub.java:13 call p/Sub.java:5",
        ]);
    });

    it("tells same-arity overloads apart by their arguments' static types, as javac's phases do, and leaves them where types can't prove one (jsoup's `t.emit('<')`)", async () => {
        const found = await javaTargets({
            "p/T.java":
                "package p;\n\nimport lib.Unknown;\n\nclass Base {}\nclass Sub extends Base {}\nclass Other {}\n\nclass T {\n    void emit(char c) {}\n    void emit(String s) {}\n    void emit(int[] cs) {}\n    void obj(Object o) {}\n    void obj(String s) {}\n    void amb(Integer i) {}\n    void amb(String s) {}\n    void box(long l) {}\n    void box(Integer i) {}\n    void var(String s) {}\n    void var(String... ss) {}\n    void sub(Base b) {}\n    void sub(Other o) {}\n    <X> void gen(X x) {}\n    void gen(String s) {}\n    void run(int[] codes, Unknown u) {\n        emit('<');\n        emit(\"x\" + 1);\n        emit(codes);\n        obj(null);\n        obj(\"s\");\n        amb(null);\n        box(1);\n        var(\"a\");\n        var(\"a\", \"b\");\n        sub(new Sub());\n        emit(u);\n        gen(\"s\");\n    }\n}\n",
        });
        // emit: char, String, int[]; obj(null): the most specific, String; amb(null): ambiguous; box(1): widening before boxing; var: fixed before varargs; sub: a subtype.
        expect(found.filter((l) => / call /.test(l))).toEqual([
            "p/T.java:26 call p/T.java:10",
            "p/T.java:27 call p/T.java:11",
            "p/T.java:28 call p/T.java:12",
            "p/T.java:29 call p/T.java:14",
            "p/T.java:30 call p/T.java:14",
            "p/T.java:32 call p/T.java:17",
            "p/T.java:33 call p/T.java:19",
            "p/T.java:34 call p/T.java:20",
            "p/T.java:35 call p/T.java:21",
            "p/T.java:35 call p/T.java:6",
        ]);
    });

    it("names nothing a supertype not read may hold: a class's own method only with no argument, nothing it may inherit", async () => {
        const found = await javaLinks({ "p/A.java": "package p;\n\nimport lib.Base;\n\nclass A extends Base {\n    void own() {}\n    void own(int x) {}\n    void run() {\n        own();\n        own(1);\n        this.own();\n        toString();\n        inherited();\n    }\n}\n" });
        expect(found).toEqual(["p/A.java:9 call A.own()", "p/A.java:11 call A.own()"]);
    });

    it("reads an anonymous class's base as its supertype: one not read may hold any member; one read, or a JDK type known, lends what it has", async () => {
        const found = await javaLinks({
            "p/A.java":
                "package p;\n\nimport lib.Callback;\n\nclass A {\n    void go() {}\n    Runnable r = new Runnable() {\n        public void run() { go(); helper(); }\n        void helper() {}\n    };\n    Callback c = new Callback() {\n        public void done() { go(); }\n    };\n    Base b = new Base() {\n        void x() { go(); base(); }\n    };\n}\n\nclass Base {\n    void base() {}\n}\n",
        });
        // Runnable has no `go`, so the anonymous Runnable's `go()` is A's; Callback, not read, may have one.
        expect(found).toEqual([
            "p/A.java:8 call A.go()",
            "p/A.java:14 type class Base",
            "p/A.java:14 type class Base",
            "p/A.java:14 call class Base",
            "p/A.java:15 call A.go()",
            "p/A.java:15 call Base.base()",
        ]);
    });

    it("takes a static import's method; two single imports that may hold the name name nothing; a static on-demand import gives what the file may use, an on-demand one no type", async () => {
        const found = await javaLinks({
            "p/A.java": "package p;\n\npublic class A {\n    public static int max(int a, int b) { return a; }\n}\n",
            "p/B.java": "package p;\n\npublic class B {\n    public static int max(int a, int b) { return b; }\n    public static int min(int a) { return a; }\n    public static void f() {}\n    static void hidden() {}\n}\n",
            "q/C.java": "package q;\n\nimport static p.A.max;\nimport static p.B.max;\nimport static p.B.min;\n\nclass C {\n    int run() { return max(1, 2) + min(3); }\n}\n",
            "q/D.java": "package q;\n\nimport static p.B.*;\nimport p.*;\n\nclass D {\n    void run() { f(); new A(); hidden(); }\n}\n",
        });
        expect(found.filter((l) => l.startsWith("q/"))).toEqual([
            "q/C.java:8 call B.min()",
            "q/C.java:3 import A.max()",
            "q/C.java:4 import B.max()",
            "q/C.java:5 import B.min()",
            "q/D.java:7 call B.f()",
        ]);
    });

    it("names no type an on-demand import may give, as the package may declare the name in a file of another name or another module; its own type and a single import come first", async () => {
        const found = await javaTargets({
            "src/main/java/a/Foo.java": "package a;\n\npublic class Foo {\n    public static void foo() {}\n}\n",
            "src/main/java/a/Fmt.java": "package a;\n\npublic class Fmt {\n    public static void go() {}\n}\n",
            "src/main/java/b/Both.java": "package b;\n\npublic class Both {\n    public static void both() {}\n}\n",
            "src/main/java/c/Foo.java": "package c;\n\nclass Foo {\n    static void foo() {}\n}\n",
            "src/main/java/c/Helpers.java": "package c;\n\nclass Helpers {}\n\nclass Fmt {\n    static void go() {}\n}\n",
            "src/main/java/c/Use.java": "package c;\n\nimport a.*;\n\nclass Use {\n    void run() { Foo.foo(); Fmt.go(); }\n}\n",
            "src/main/java/d/Use.java": "package d;\n\nimport a.*;\n\nclass Use {\n    void run() { Foo.foo(); }\n}\n",
            "src/main/java/e/Use.java": "package e;\n\nimport b.Both;\nimport a.*;\n\nclass Use {\n    void run() { Both.both(); }\n}\n",
        });
        expect(found.filter((l) => /\/[cde]\/Use\.java/.test(l))).toEqual([
            "src/main/java/c/Use.java:6 value src/main/java/c/Foo.java:3",
            "src/main/java/c/Use.java:6 call src/main/java/c/Foo.java:4",
            "src/main/java/e/Use.java:7 value src/main/java/b/Both.java:3",
            "src/main/java/e/Use.java:7 call src/main/java/b/Both.java:4",
            "src/main/java/e/Use.java:3 import src/main/java/b/Both.java:3",
        ]);
    });

    it("takes a static on-demand import's static field, which hides a type of its name, but no member type; a class not read hides every name", async () => {
        const found = await javaTargets({
            "p/K.java": "package p;\n\npublic class K {\n    public static final Go X = new Go();\n    public static class Nested { public static void n() {} }\n    public class Inner { public void i() {} }\n}\n",
            "p/Go.java": "package p;\n\npublic class Go {\n    public void go() {}\n}\n",
            "q/X.java": "package q;\n\nclass X {\n    static void go() {}\n}\n",
            "q/Y.java": "package q;\n\nclass Y {\n    static void y() {}\n}\n",
            "q/Use.java": "package q;\n\nimport static p.K.*;\n\nclass Use {\n    void run() { X.go(); Nested.n(); Y.y(); }\n    void inner(Inner i) { i.i(); }\n}\n",
            "r/Use.java": "package r;\n\nimport static ext.Lib.*;\n\nclass Use {\n    void run() { Y.y(); }\n}\n",
            "r/Y.java": "package r;\n\nclass Y {\n    static void y() {}\n}\n",
        });
        expect(found.filter((l) => l.startsWith("q/Use") || l.startsWith("r/Use"))).toEqual([
            "q/Use.java:6 call p/Go.java:4",
            "q/Use.java:6 value q/Y.java:3",
            "q/Use.java:6 call q/Y.java:4",
        ]);
    });

    it("names nothing of its package in another module's root, whose copy may not be the one the build sees, nor a test fixture's", async () => {
        const found = await javaTargets({
            "core/src/main/java/org/x/Core.java": "package org.x;\n\npublic class Core {\n    public void run() {}\n}\n",
            "core/src/testFixtures/java/org/x/Fixture.java": "package org.x;\n\npublic class Fixture {\n    public static void make() {}\n}\n",
            "it/src/test/java/org/x/CoreTest.java": "package org.x;\n\nclass CoreTest {\n    void t(Core c) { c.run(); Fixture.make(); }\n}\n",
        });
        expect(found.filter((l) => l.startsWith("it/"))).toEqual([]);
    });

    it("types a call to `<T> T m(T x)` that stands alone as its one argument of type T, and nothing where T is anything else's", async () => {
        const found = await javaTargets({
            "p/A.java":
                "package p;\n\nclass Foo {\n    void bar() {}\n}\n\nclass A {\n    static <T> T id(T x) { return x; }\n    static <T> T first(T a, T b) { return a; }\n    static <T> T make(Class<T> c) { return null; }\n    static <T> T one(T... xs) { return xs[0]; }\n    static <T> java.util.List<T> list(T x) { return null; }\n    void run(Foo foo) {\n        id(foo).bar();\n        first(foo, foo).bar();\n        make(Foo.class).bar();\n        one(foo).bar();\n        var f = id(foo);\n        f.bar();\n    }\n}\n",
        });
        expect(found.filter((l) => / call p\/A\.java:4$/.test(l))).toEqual(["p/A.java:14 call p/A.java:4", "p/A.java:19 call p/A.java:4"]);
    });

    it("never lets a lambda or a method reference stand for a class, nor for an interface of no abstract method, of two, or of another arity", async () => {
        const found = await javaTargets({
            "p/A.java":
                "package p;\n\ninterface Fn0 { Object get(); }\ninterface Fn1 { Object apply(Object x); }\ninterface Two { void a(); void b(); }\ninterface Marker {}\ninterface Half extends Two { default void b() {} }\nclass Box {}\n\nclass A {\n    void run(Fn0 f) {}\n    void run(Fn1 f) {}\n    void take(Box b) {}\n    void take(Fn0 f) {}\n    void pick(Two t) {}\n    void pick(Marker m) {}\n    void pick(Fn1 f) {}\n    void half(Half h) {}\n    void half(Fn0 f) {}\n    void go() {\n        run(() -> 1);\n        run(x -> x);\n        take(() -> 1);\n        take(this::go);\n        pick(x -> x);\n        half(() -> {});\n    }\n}\n",
        });
        expect(found.filter((l) => / call /.test(l))).toEqual([
            "p/A.java:21 call p/A.java:11",
            "p/A.java:22 call p/A.java:12",
            "p/A.java:23 call p/A.java:14",
            "p/A.java:24 call p/A.java:14",
            "p/A.java:25 call p/A.java:17",
        ]);
    });

    it("counts a call's arguments without the comments between them", async () => {
        const found = await javaTargets({
            "p/A.java": "package p;\n\nclass A {\n    void f(int a, int b) {}\n    void f(int a, int b, int c) {}\n    void run() {\n        f(1, // one\n            2);\n        f(/* a */ 1, 2, 3);\n    }\n}\n",
        });
        expect(found).toEqual(["p/A.java:7 call p/A.java:4", "p/A.java:9 call p/A.java:5"]);
    });

    it("knows no type but a final class itself, a record or an enum is one, and that only the eight boxes unbox", async () => {
        const found = await javaTargets({
            "p/A.java":
                "package p;\n\nimport lib.Ext;\n\nfinal class Leaf {}\nrecord Point(int x) {}\n\nclass A {\n    void s(String s) {}\n    void s(Ext e) {}\n    void l(Leaf l) {}\n    void l(Ext e) {}\n    void p(Point p) {}\n    void p(Ext e) {}\n    void c(char c) {}\n    void c(String s) {}\n    void run(Ext e) {\n        s(e);\n        l(e);\n        p(e);\n        c(e);\n    }\n}\n",
        });
        expect(found.filter((l) => / call /.test(l))).toEqual(["p/A.java:18 call p/A.java:10", "p/A.java:19 call p/A.java:12", "p/A.java:20 call p/A.java:14"]);
    });

    it("takes methods whose parameters erase alike for one method overridden, a type variable erased to its bound", async () => {
        const found = await javaTargets({
            "p/A.java":
                "package p;\n\ninterface Maker {\n    <T> T make(Class<T> type, T seed);\n    <N extends Number> N num(N n);\n}\n\nclass Real implements Maker {\n    public <T> T make(Class<T> type, T seed) { return seed; }\n    public <N extends Number> N num(N n) { return n; }\n    public Integer num(Integer i) { return i; }\n    void run() {\n        make(String.class, \"s\");\n        num(1);\n    }\n}\n",
        });
        expect(found.filter((l) => / call /.test(l))).toEqual(["p/A.java:13 call p/A.java:9"]);
    });

    it("binds a class's type variable through a subclass's supertype clauses, and a free one to its one bound; a raw or unread binding binds nothing", async () => {
        const found = await javaTargets({
            "p/A.java":
                "package p;\n\ninterface Maker { void make(); }\nclass Real implements Maker {\n    public void make() {}\n    public void extra() {}\n}\nabstract class Base<MM extends Maker> {\n    protected MM maker;\n    MM get() { return maker; }\n    void own() { maker.make(); }\n}\nclass Mid<X extends Maker> extends Base<X> {}\nclass Test extends Base<Real> {\n    void run() {\n        maker.extra();\n        get().extra();\n        this.maker.extra();\n    }\n}\nclass Test2 extends Mid<Real> {\n    void run() { maker.extra(); }\n}\nclass Raw extends Base {\n    void run() { maker.make(); }\n}\nclass Gen {\n    <T extends Real> void use(T t) { t.extra(); }\n    <T extends Real & Runnable> void both(T t) { t.extra(); }\n}\n",
        });
        expect(found.filter((l) => / call /.test(l))).toEqual([
            "p/A.java:11 call p/A.java:3",
            "p/A.java:16 call p/A.java:6",
            "p/A.java:17 call p/A.java:10",
            "p/A.java:17 call p/A.java:6",
            "p/A.java:18 call p/A.java:6",
            "p/A.java:22 call p/A.java:6",
            "p/A.java:28 call p/A.java:6",
        ]);
    });

    it("trusts no member list a parse gap may change, nor a call whose arguments may not fit its one candidate (`Class<?> @Nullable ... types` doesn't parse)", async () => {
        const doc = "/**\n" + " * Names of methods, for messages and logs.\n".repeat(40) + " */\n";
        const found = await javaTargets({
            "p/Names.java": `package p;\n\n${doc}public class Names {\n    public static String of(Class<?> c, String m, Class<?> @Nullable ... types) { return ""; }\n    public static String of(String c, String m, String types) { return ""; }\n    public static String only(String s) { return s; }\n}\n`,
            "p/Use.java": "package p;\n\nclass Use {\n    String run(Class<?> c) { return Names.of(c, \"m\", new Class<?>[0]) + Names.only(1); }\n}\n",
        });
        expect(found.filter((l) => / call /.test(l))).toEqual([]);
    });

    it("binds a type variable through a parameterized receiver's arguments nowhere, so a `Box<Sub>` names nothing of its `T`; `this`, `super` and a subclass's supertype clause do", async () => {
        const base = {
            "p/Base.java": "package p;\n\npublic class Base {\n    public void m() {}\n    public void k(Object o) {}\n}\n",
            "p/Sub.java": "package p;\n\npublic class Sub extends Base {\n    @Override\n    public void m() {}\n    public void k(String s) {}\n}\n",
            "p/Box.java": "package p;\n\npublic class Box<T extends Base> {\n    public T value;\n    public Box() {}\n    public Box(T v) { value = v; }\n    public T get() { return value; }\n    public static <T extends Base> Box<T> of(T x) { return new Box<>(x); }\n    void own() { get().m(); }\n}\n",
        };
        const found = await javaTargets({
            ...base,
            "p/Use.java":
                "package p;\n\npublic class Use {\n    void g(Base x) {}\n    void g(Sub x) {}\n    void run(Box<Sub> b, Box<? extends Sub> w, Sub s) {\n        b.get().m();\n        b.value.m();\n        g(b.get());\n        var v = b.get();\n        v.m();\n        w.get().m();\n        new Box<Sub>(s).get().m();\n        Box.of(s).get().m();\n        Util.<Base>id(s).m();\n        Util.id(s).m();\n    }\n}\n",
            "p/Util.java": "package p;\n\npublic class Util {\n    public static <T> T id(T x) { return x; }\n}\n",
            "p/SubBox.java": "package p;\n\npublic class SubBox extends Box<Sub> {\n    void run() {\n        super.get().m();\n        get().m();\n        this.value.m();\n        value.m();\n    }\n}\n",
        });
        // Box.own: T free, its bound's m; Use: only Util.id(s), whose T is s's Sub; SubBox: T is Sub.
        expect(found.filter((l) => /call p\/(Base|Sub)\.java:[45]$/.test(l))).toEqual([
            "p/Box.java:9 call p/Base.java:4",
            "p/Use.java:16 call p/Sub.java:5",
            "p/SubBox.java:5 call p/Sub.java:5",
            "p/SubBox.java:6 call p/Sub.java:5",
            "p/SubBox.java:7 call p/Sub.java:5",
            "p/SubBox.java:8 call p/Sub.java:5",
        ]);
    });

    it("never calls a parameterized parameter type a sure fit, so `Set<Artifact>` picks neither `Collection<? extends Project>` nor `Iterable<Artifact>` by erasure", async () => {
        const found = await javaTargets({
            "p/Artifact.java": "package p;\n\npublic class Artifact {}\n",
            "p/Project.java": "package p;\n\npublic class Project {}\n",
            "p/Resolver.java":
                "package p;\n\nimport java.util.Collection;\nimport java.util.Set;\n\nclass Resolver {\n    void run(Set<Artifact> artifacts, Set raw) { ignorable(artifacts); ignorable(raw); }\n    private int ignorable(Collection<? extends Project> projects) { return 0; }\n    private int ignorable(Iterable<Artifact> artifacts) { return 1; }\n}\n",
        });
        expect(found.filter((l) => / call /.test(l))).toEqual([]);
    });

    it("takes a parameterized parameter type for sure where the argument's type is written alike, or where a lone type variable of the method's takes any (`<T> T fromJson(String, Class<T>)`)", async () => {
        const found = await javaTargets({
            "p/Gson.java":
                "package p;\n\nimport java.lang.reflect.Type;\nimport java.util.List;\nimport java.util.Map;\nimport java.util.Set;\n\nclass Gson {\n    <T> T fromJson(String json, Class<T> c) { return null; }\n    Object fromJson(String json, Type t) { return null; }\n    int count(Class<?> c, Map<String, Integer> m) { return 0; }\n    int count(Type t, Map<String, Integer> m) { return 1; }\n    <T> void both(List<T> a, Set<T> b) {}\n    void both(Iterable<?> a, Iterable<?> b) {}\n}\n",
            "p/Use.java":
                "package p;\n\nimport java.util.List;\nimport java.util.Map;\nimport java.util.Set;\n\nclass Use {\n    void run(Gson gson, Map<String, Integer> ints, Map<String, Long> longs, List<String> l, Set<Integer> s) {\n        gson.fromJson(\"{}\", Use.class);\n        gson.count(Use.class, ints);\n        gson.count(Use.class, longs);\n        gson.both(l, s);\n    }\n}\n",
        });
        // `longs` isn't `Map<String, Integer>`; `T` of `both` is written twice, so its first overload may not apply.
        expect(found.filter((l) => / call /.test(l))).toEqual(["p/Use.java:9 call p/Gson.java:9", "p/Use.java:10 call p/Gson.java:11"]);
    });

    it("keeps a class's members out of its header but a record's components", async () => {
        const found = await javaTargets({
            "p/Base.java": "package p;\n\npublic class Base {\n    public interface Listener { void on(); }\n    public static class Node { public void up() {} }\n    public @interface Ann {}\n}\n",
            "p/Listener.java": "package p;\n\npublic interface Listener {\n    void on();\n}\n",
            "p/Node.java": "package p;\n\npublic class Node {\n    public void up() {}\n}\n",
            "p/Ann.java": "package p;\n\npublic @interface Ann {}\n",
            "p/A.java": "package p;\n\n@Ann\nclass A extends Base implements Listener {\n    public void on() {}\n}\n",
            "p/T.java": "package p;\n\nclass T extends Node {\n    static class Node {}\n    void run() { up(); }\n}\n",
            "p/G.java": "package p;\n\nclass G<X extends Node> extends Base {\n    X x;\n    void run() { x.up(); }\n}\n",
            "p/R.java": "package p;\n\nrecord R(Node n) {\n    static class Node {}\n}\n",
        });
        expect(found.filter((l) => /^p\/[ATGR]\.java:[345] /.test(l) && !/p\/Base\.java:3$/.test(l))).toEqual([
            "p/A.java:3 type p/Ann.java:3",
            "p/A.java:4 type p/Listener.java:3",
            "p/T.java:3 type p/Node.java:3",
            "p/T.java:5 call p/Node.java:4",
            "p/G.java:3 type p/Node.java:3",
            "p/G.java:5 call p/Node.java:4",
            "p/R.java:3 type p/R.java:4",
        ]);
    });

    it("lets code of another package reach a protected member only from a subclass, through its own instance or one of its type, and a protected constructor only through super(…)", async () => {
        const found = await javaTargets({
            "p/Base.java": "package p;\n\npublic class Base {\n    public Base(Object o) {}\n    protected Base(String s) {}\n    protected void f(String s) {}\n    public void f(Object o) {}\n    protected static void s(String x) {}\n    public static void s(Object x) {}\n}\n",
            "q/Use.java": "package q;\n\nimport p.Base;\n\nclass Use {\n    void run(Base b) {\n        b.f(\"x\");\n        Base.s(\"x\");\n        new Base(\"x\");\n    }\n}\n",
            "q/Kid.java": "package q;\n\nimport p.Base;\n\nclass Kid extends Base {\n    Kid() { super(\"x\"); }\n    void run(Base other, Kid self) {\n        other.f(\"x\");\n        self.f(\"x\");\n        f(\"x\");\n        s(\"x\");\n    }\n}\n",
        });
        expect(found.filter((l) => / call /.test(l))).toEqual([
            "q/Use.java:7 call p/Base.java:7",
            "q/Use.java:8 call p/Base.java:9",
            "q/Use.java:9 call p/Base.java:4",
            "q/Kid.java:6 call p/Base.java:5",
            "q/Kid.java:8 call p/Base.java:7",
            "q/Kid.java:9 call p/Base.java:6",
            "q/Kid.java:10 call p/Base.java:6",
            "q/Kid.java:11 call p/Base.java:8",
        ]);
    });

    it("sees a try's resource in its try block alone, never its catch or finally", async () => {
        const found = await javaTargets({
            "p/Foo.java": "package p;\n\npublic class Foo implements AutoCloseable {\n    public void m() {}\n    public void close() {}\n}\n",
            "p/Bar.java": "package p;\n\npublic class Bar {\n    public void m() {}\n}\n",
            "p/A.java": "package p;\n\nclass A {\n    Bar r = new Bar();\n    void run() {\n        try (Foo r = new Foo()) {\n            r.m();\n        } catch (RuntimeException e) {\n            r.m();\n        } finally {\n            r.m();\n        }\n    }\n}\n",
        });
        expect(found.filter((l) => / call p\/(Foo|Bar)\.java:4$/.test(l))).toEqual(["p/A.java:7 call p/Foo.java:4", "p/A.java:9 call p/Bar.java:4", "p/A.java:11 call p/Bar.java:4"]);
    });

    it("takes a java.lang name for java.lang's only once the package is known to hold no type of it", async () => {
        const files = {
            "p/Error.java": "package p;\n\npublic class Error {\n}\n",
            "p/H.java": "package p;\n\nclass H {\n    static void handle(Throwable t) {}\n    static void handle(Object o) {}\n}\n",
            "p/Use.java": "package p;\n\nclass Use {\n    void run() { H.handle(new Error()); }\n}\n",
        };
        const handle = (l: string) => l.startsWith("p/Use.java:4 call p/H.java");
        expect((await javaTargets(files)).filter(handle)).toEqual(["p/Use.java:4 call p/H.java:5"]);
        // Not asked whether p/Throwable.java exists: H's parameter types aren't sure, so neither overload is.
        expect((await javaTargets(files, (path) => (path in files ? true : undefined))).filter(handle)).toEqual([]);
    });

    it("takes a type of a package the JDK exports for the JDK's, never a source root's copy of it, whose own names name nothing (netty's `com.sun.nio.sctp` stubs)", async () => {
        const found = await javaTargets({
            "src/main/java/com/sun/nio/sctp/SctpChannel.java": "package com.sun.nio.sctp;\n\npublic abstract class SctpChannel {\n    public static SctpChannel open() { return null; }\n    public abstract Association association();\n}\n",
            "src/main/java/com/sun/nio/sctp/Association.java": "package com.sun.nio.sctp;\n\npublic class Association {\n}\n",
            "src/main/java/com/sun/jna/Native.java": "package com.sun.jna;\n\npublic class Native {\n    public static void load() {}\n}\n",
            "src/main/java/io/x/Use.java": "package io.x;\n\nimport com.sun.jna.Native;\nimport com.sun.nio.sctp.SctpChannel;\n\nclass Use {\n    void run() { SctpChannel.open(); Native.load(); }\n}\n",
        });
        // com.sun.jna is no package of the JDK's: its type is the repository's. A stub names nothing, not even its own types.
        expect(found).toEqual(["src/main/java/io/x/Use.java:7 value src/main/java/com/sun/jna/Native.java:3", "src/main/java/io/x/Use.java:7 call src/main/java/com/sun/jna/Native.java:4", "src/main/java/io/x/Use.java:3 import src/main/java/com/sun/jna/Native.java:3"]);
    });

    it("trusts no member list Lombok writes into: a class of a file that uses `lombok`", async () => {
        const found = await javaTargets({
            "p/Named.java": "package p;\n\npublic interface Named {\n    String getName();\n}\n",
            "p/BaseEntity.java": "package p;\n\npublic abstract class BaseEntity {\n    public Long getId() { return null; }\n}\n",
            "p/User.java": "package p;\n\nimport lombok.Getter;\n\n@Getter\npublic class User extends BaseEntity implements Named {\n    private String name;\n    private Long id;\n}\n",
            "p/Use.java": "package p;\n\nclass Use {\n    String run(User u) { u.getId(); return u.getName(); }\n}\n",
        });
        expect(found.filter((l) => / call /.test(l))).toEqual([]);
    });

    it("types a varargs parameter and a C-style array as arrays", async () => {
        const found = await javaTargets({
            "p/A.java": "package p;\n\nclass A {\n    void g(String s) {}\n    void g(String[] s) {}\n    void f(String... names) { g(names); }\n    void h(String names[]) { g(names); }\n    void k() { String xs[] = {}; g(xs); }\n}\n",
        });
        expect(found).toEqual(["p/A.java:6 call p/A.java:5", "p/A.java:7 call p/A.java:5", "p/A.java:8 call p/A.java:5"]);
    });

    it("never reads a type parameter as a type, whatever its name, nor a result whose type is one", async () => {
        const found = await javaLinks({
            "p/A.java":
                "package p;\n\nclass T {\n    void t() {}\n}\n\nclass Box<T> {\n    T item;\n    T get() { return item; }\n    void run() { item.t(); get().t(); }\n    <U> U make(T x) { return null; }\n}\n\nclass User {\n    void run(Box<T> b) { b.get().t(); }\n}\n",
        });
        expect(found).toEqual(["p/A.java:10 call Box.get()", "p/A.java:15 type class Box", "p/A.java:15 type class T", "p/A.java:15 call Box.get()"]);
    });

    it("types `var` from a creation or a method's written result", async () => {
        const found = await javaLinks({
            "p/A.java": "package p;\n\nclass Foo {\n    void f() {}\n    Foo self() { return this; }\n}\n\nclass A {\n    void run() {\n        var a = new Foo();\n        a.f();\n        var b = a.self();\n        b.self().f();\n    }\n}\n",
        });
        expect(found).toEqual(["p/A.java:5 type class Foo", "p/A.java:10 type class Foo", "p/A.java:10 call class Foo", "p/A.java:11 call Foo.f()", "p/A.java:12 call Foo.self()", "p/A.java:13 call Foo.self()", "p/A.java:13 call Foo.f()"]);
    });

    it("reads an enum's constants as its own type, and its implicit methods as no card's", async () => {
        const found = await javaLinks({
            "p/Color.java":
                "package p;\n\nenum Color {\n    RED { String label() { return \"red\"; } },\n    GREEN;\n    String label() { return name(); }\n    static Color parse(String s) { return valueOf(s); }\n}\n\nclass A {\n    String run(Color c) {\n        return Color.RED.label() + c.label() + Color.parse(\"x\").label() + Color.valueOf(\"RED\").ordinal();\n    }\n}\n",
        });
        expect(found).toEqual([
            "p/Color.java:7 type enum Color",
            "p/Color.java:11 type enum Color",
            "p/Color.java:12 value enum Color",
            "p/Color.java:12 call Color.label()",
            "p/Color.java:12 call Color.label()",
            "p/Color.java:12 value enum Color",
            "p/Color.java:12 call Color.parse()",
            "p/Color.java:12 call Color.label()",
            "p/Color.java:12 value enum Color",
        ]);
    });

    it("reaches a record's canonical constructor, compact or implicit, its declared accessors, and its implicit ones on its own card", async () => {
        const found = await javaTargets({
            "p/Point.java":
                "package p;\n\nrecord Point(int x, int y) {\n    Point {\n        if (x < 0) throw new IllegalArgumentException();\n    }\n    Point(int x) { this(x, 0); }\n    int sum() { return x + y; }\n    public int y() { return y; }\n}\n\nrecord Pair(String a) {}\n\nclass A {\n    int run() {\n        Point p = new Point(1, 2);\n        Point q = new Point(1);\n        new Pair(\"a\").a();\n        return p.sum() + p.x() + q.y();\n    }\n}\n",
        });
        // A creation uses the type and calls the constructor: the compact one, `Point(int x)`, and Pair's implicit one, whose card is Pair's.
        expect(found).toEqual([
            "p/Point.java:7 call p/Point.java:4",
            "p/Point.java:16 type p/Point.java:3",
            "p/Point.java:16 type p/Point.java:3",
            "p/Point.java:16 call p/Point.java:4",
            "p/Point.java:17 type p/Point.java:3",
            "p/Point.java:17 type p/Point.java:3",
            "p/Point.java:17 call p/Point.java:7",
            "p/Point.java:18 type p/Point.java:12",
            "p/Point.java:18 call p/Point.java:12",
            "p/Point.java:18 call p/Point.java:12",
            "p/Point.java:19 call p/Point.java:8",
            "p/Point.java:19 call p/Point.java:3",
            "p/Point.java:19 call p/Point.java:9",
        ]);
    });

    it("reaches an interface's default method from what implements it, and `I.super.m()`; never an interface's static method through it", async () => {
        const found = await javaLinks({
            "p/Greeter.java":
                "package p;\n\ninterface Greeter {\n    default String greet() { return \"hi\"; }\n    String name();\n    static void s() {}\n}\n\nclass A implements Greeter {\n    public String name() { return greet(); }\n    String both() { return Greeter.super.greet(); }\n}\n\nclass B {\n    String run(A a, Greeter g) { Greeter.s(); return a.greet() + g.name() + a.name(); }\n}\n\nclass Outer {\n    static void s() {}\n    class In implements Greeter {\n        public String name() { s(); return null; }\n    }\n}\n",
        });
        expect(found).toEqual([
            "p/Greeter.java:9 type interface Greeter",
            "p/Greeter.java:10 call Greeter.greet()",
            "p/Greeter.java:11 value interface Greeter",
            "p/Greeter.java:11 call Greeter.greet()",
            "p/Greeter.java:15 type class A",
            "p/Greeter.java:15 type interface Greeter",
            "p/Greeter.java:15 value interface Greeter",
            "p/Greeter.java:15 call Greeter.s()",
            "p/Greeter.java:15 call Greeter.greet()",
            "p/Greeter.java:15 call Greeter.name()",
            "p/Greeter.java:15 call A.name()",
            "p/Greeter.java:20 type interface Greeter",
            "p/Greeter.java:21 call Outer.s()",
        ]);
    });

    it("reads a method reference as a value of the one method of its name, and `T::new` as one of the type and its one constructor", async () => {
        const found = await javaLinks({
            "p/A.java":
                "package p;\n\nclass Util {\n    static int twice(int x) { return x; }\n    static String join(String a) { return a; }\n    static String join(String a, String b) { return a; }\n}\n\nclass Foo {\n    Foo() {}\n    Foo(int x) {}\n}\n\nclass Bar {}\n\nclass A {\n    void run() {\n        Object f = Util::twice;\n        Object g = Util::join;\n        Object h = Foo::new;\n        Object i = Bar::new;\n        Runnable j = this::run;\n    }\n}\n",
        });
        // A method reference is a value, as javac's tree says; `Foo::new` names Foo, whose two constructors leave the reference unsure.
        expect(found).toEqual([
            "p/A.java:18 value class Util",
            "p/A.java:18 value Util.twice()",
            "p/A.java:19 value class Util",
            "p/A.java:20 value class Foo",
            "p/A.java:21 value class Bar",
            "p/A.java:21 value class Bar",
            "p/A.java:22 value A.run()",
        ]);
    });

    it("reads `new T(…)` as a use of T and a call to the constructor that fits the arguments; `this(…)` and `super(…)` as calls", async () => {
        const found = await javaTargets({
            "p/A.java":
                "package p;\n\nclass Base {\n    Base(int x) {}\n    Base(String s) {}\n}\n\nclass Sub extends Base {\n    Sub() { this(1); }\n    Sub(int x) { super(x); }\n}\n\nclass A {\n    Object run() { return new Sub(1); }\n}\n",
        });
        // `super(x)` passes the int parameter x: `Base(int)`, not `Base(String)`.
        expect(found).toEqual(["p/A.java:8 type p/A.java:3", "p/A.java:9 call p/A.java:10", "p/A.java:10 call p/A.java:4", "p/A.java:14 type p/A.java:8", "p/A.java:14 call p/A.java:10"]);
    });

    it("reaches no member code there may not use: a private one outside its top-level class, a package one outside its package (maven#12941's test)", async () => {
        const found = await javaTargets({
            "src/main/java/p/Ctx.java":
                "package p;\n\npublic class Ctx {\n    public Ctx(int a) {}\n    private Ctx(int a, int b) {}\n    Ctx(String s, int b, int c) {}\n    private void secret(int x) {}\n    void pkg(int x) {}\n    Ctx twice() { return new Ctx(1, 2); }\n    class In {\n        void x() { secret(1); }\n    }\n}\n",
            "src/test/java/p/CtxTest.java": "package p;\n\nclass CtxTest {\n    Object run(Ctx c) { c.pkg(1); c.secret(2); new Ctx(\"x\", 2, 3); return new Ctx(1, 2); }\n}\n",
            "src/main/java/q/Other.java": "package q;\n\nimport p.Ctx;\n\nclass Other {\n    void run(Ctx c) { c.pkg(1); new Ctx(\"a\", 1, 2); }\n}\n",
        });
        expect(found.filter((l) => !/:3 import /.test(l))).toEqual([
            "src/main/java/p/Ctx.java:9 type src/main/java/p/Ctx.java:3",
            "src/main/java/p/Ctx.java:9 type src/main/java/p/Ctx.java:3",
            "src/main/java/p/Ctx.java:9 call src/main/java/p/Ctx.java:5",
            "src/main/java/p/Ctx.java:11 call src/main/java/p/Ctx.java:7",
            "src/test/java/p/CtxTest.java:4 type src/main/java/p/Ctx.java:3",
            "src/test/java/p/CtxTest.java:4 call src/main/java/p/Ctx.java:8",
            "src/test/java/p/CtxTest.java:4 type src/main/java/p/Ctx.java:3",
            "src/test/java/p/CtxTest.java:4 call src/main/java/p/Ctx.java:6",
            "src/test/java/p/CtxTest.java:4 type src/main/java/p/Ctx.java:3",
            "src/main/java/q/Other.java:6 type src/main/java/p/Ctx.java:3",
            "src/main/java/q/Other.java:6 type src/main/java/p/Ctx.java:3",
        ]);
    });

    it("reads `this.`, `super.`, `Outer.this.` and a field's written type; an annotation type is a use, java.lang's names none", async () => {
        const found = await javaLinks({
            "p/A.java":
                "package p;\n\n@interface Marker {}\n\nclass Base {\n    void b() {}\n}\n\nclass Helper {\n    void help() {}\n}\n\nclass A extends Base {\n    Helper helper;\n    @Marker @Override\n    void b() {}\n    void run() { this.helper.help(); super.b(); this.b(); }\n    class Inner {\n        void x() { A.this.b(); A.this.helper.help(); }\n    }\n}\n",
        });
        expect(found).toEqual([
            "p/A.java:13 type class Base",
            "p/A.java:14 type class Helper",
            "p/A.java:15 type @interface Marker",
            "p/A.java:17 call Helper.help()",
            "p/A.java:17 call Base.b()",
            "p/A.java:17 call A.b()",
            "p/A.java:19 value class A",
            "p/A.java:19 call A.b()",
            "p/A.java:19 value class A",
            "p/A.java:19 call Helper.help()",
        ]);
    });

    it("reads a pattern's variable as a local of no known type where its condition flows, but in an arrow case as its type", async () => {
        const found = await javaLinks({
            "p/A.java":
                "package p;\n\nclass Foo {\n    void ok() {}\n}\n\nclass A {\n    Foo f;\n    void run(Object o) {\n        if (!(o instanceof Foo f)) return;\n        f.ok();\n        switch (o) {\n            case Foo g -> g.ok();\n            default -> {}\n        }\n    }\n    void other() { f.ok(); }\n}\n",
        });
        expect(found).toEqual(["p/A.java:8 type class Foo", "p/A.java:10 type class Foo", "p/A.java:13 type class Foo", "p/A.java:13 call Foo.ok()", "p/A.java:17 call Foo.ok()"]);
    });

    it("knows no member type of a class whose supertype isn't read: an inherited one may shadow the package's", async () => {
        const found = await javaLinks({ "p/A.java": "package p;\n\nimport lib.Base;\n\nclass Node {}\n\nclass A extends Base {\n    Node n;\n}\n\nclass B {\n    Node n;\n}\n" });
        expect(found).toEqual(["p/A.java:12 type class Node"]);
    });

    it("reaches a nested type through its outer one, in a type or an expression", async () => {
        const found = await javaLinks({
            "p/A.java":
                "package p;\n\nclass Outer {\n    static class Inner {\n        static Inner make() { return null; }\n        void go() {}\n    }\n}\n\nclass A {\n    void run() {\n        Outer.Inner.make().go();\n        Outer.Inner x = null;\n    }\n}\n",
        });
        expect(found).toEqual(["p/A.java:5 type class Inner", "p/A.java:12 value class Outer", "p/A.java:12 value class Inner", "p/A.java:12 call Inner.make()", "p/A.java:12 call Inner.go()", "p/A.java:13 type class Outer", "p/A.java:13 type class Inner"]);
    });
});
