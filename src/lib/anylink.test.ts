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

/** Every reference that resolves, as `links` gives them, with what the reads found to exist: true, a 404 (false), or never asked. */
const linksKnowing = async (files: Record<string, string>, exists: (path: string) => boolean | undefined): Promise<string[]> => {
    const parsed: GFile[] = [];
    for (const [path, text] of Object.entries(files)) {
        const f = await testParse(path, text);
        if (f && isGeneric(f)) parsed.push(f);
    }
    const labels = new Map(parsed.flatMap((f) => [...f.labels]));
    return resolveAny(parsed, (f) => langOf(f.path)!.resolver, (path) => files[path], exists).flatMap((r) => r.units.map((u) => `${r.path}:${r.line} ${r.ref} ${labels.get(u.id)}`));
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

    it("decides a module is unique from every path the reads found, a file too long to take among them, and names nothing where a root was never asked about (review 2's P16)", async () => {
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

    it("links no absolute import that runs after its file changes `sys.path` (review 2's P12)", async () => {
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

    it("counts a `sys.path` change under any name: `import sys as _sys`, `from sys import path`, a name the list is assigned to (review 3's L2)", async () => {
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

    it("counts any change to `sys.path`: through `os.sys.path` or any chain ending in `.sys`, any method on it, the list handed to any call (review 4's P27)", async () => {
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

    it("links no method annotation naming a class its class binds below it, deferred or not; one above it names the nested class (review 3's P25)", async () => {
        const below = "class Mode:\n    def describe(self):\n        pass\n\nclass Config:\n    def show(self, m: Mode):\n        m.describe()\n\n    class Mode:\n        def describe(self):\n            pass\n";
        expect(await targets({ "a.py": `from __future__ import annotations\n\n${below}` })).toEqual([]);
        expect(await targets({ "a.py": below })).toEqual([]);
        const above = "class Mode:\n    def describe(self):\n        pass\n\nclass Config:\n    class Mode:\n        def describe(self):\n            pass\n\n    def show(self, m: Mode):\n        m.describe()\n";
        expect(await targets({ "a.py": above })).toEqual(["a.py:10 type a.py:6", "a.py:11 call a.py:7"]);
    });

    it("reads a class body's annotation as deferred annotations do: under `from __future__ import annotations` the nested class below it; without, where the Python version decides, nothing (review 2's P22)", async () => {
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

    it("keeps no build answer from one review for the next in the same worker (review 2's N1)", async () => {
        const target = "//go:build linux\n\npackage term\n\nfunc getch() {}\n";
        const first = await targets({ "go.mod": "module example.com/m\n", "term/a.go": "//go:build linux\n\npackage term\n\nfunc Read() {\n\tgetch()\n}\n", "term/f.go": target });
        expect(first).toEqual(["term/a.go:6 call term/f.go:5"]);
        const second = await targets({ "go.mod": "module example.com/m\n", "term/a.go": "package term\n\nfunc Read() {\n\tgetch()\n}\n", "term/f.go": target });
        expect(second).toEqual([]);
    });

    it("reads a build constraint as go/build does, the file name cut at its first dot (review 2's N5, among its 25 cases)", async () => {
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

    it("probes `x.f()` as rustc does: a `&mut self` receiver finds a trait's `f(&mut self)` or `f(self)` before an inherent `f(&self)`, and the standard library's Write, Read and by-value methods count (review 2's R16)", async () => {
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

    it("never resolves a receiver a macro's nested tokens bind: a destructured closure parameter, `if let`, a `match` arm (review 2's R17)", async () => {
        const found = await targets({
            "src/check.rs": "pub struct Version;\n\nimpl Version {\n    pub fn parse() -> Version {\n        Version\n    }\n    pub fn check(&self) -> bool {\n        true\n    }\n}\n\npub struct Entry;\n\nimpl Entry {\n    pub fn check(&self) -> bool {\n        false\n    }\n}\n\npub fn all_ok(pairs: Vec<(u32, Entry)>, opt: Option<Entry>) {\n    let v = Version::parse();\n    assert!(pairs.iter().all(|(_, v)| v.check()));\n    assert!(if let Some(v) = &opt { v.check() } else { true });\n    println!(\"{}\", match &opt { Some(v) => v.check(), None => false });\n    assert!(v.check());\n}\n",
        });
        expect(found.filter((l) => l.includes(" call "))).toEqual(["src/check.rs:21 call src/check.rs:4", "src/check.rs:25 call src/check.rs:7"]);
    });

    it("lets a trait method of any mode come first for a receiver of another type: `self: Box<Self>`, `self: Rc<Self>`, `&&T` (review 3's L1)", async () => {
        const boxed = await links({
            "src/name.rs": "pub struct Name(String);\n\nimpl Name {\n    pub fn as_ref(&self) -> &str {\n        &self.0\n    }\n    pub fn describe(&self) {}\n    pub fn into_label(self: Box<Self>) -> usize {\n        self.describe();\n        let n: &Name = self.as_ref();\n        n.0.len()\n    }\n    pub fn shared(self: std::rc::Rc<Self>) {\n        self.as_ref();\n    }\n}\n",
        });
        expect(boxed.filter((l) => l.includes(" call "))).toEqual(["src/name.rs:9 call Name::describe()"]);
        const double = await links({
            "src/a.rs": "use std::fmt;\n\npub struct Foo;\n\nimpl fmt::Display for Foo {\n    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {\n        write!(f, \"foo\")\n    }\n}\n\nimpl Foo {\n    pub fn to_string(&self) -> String {\n        String::new()\n    }\n}\n\npub fn show(x: &&Foo) -> String {\n    x.to_string()\n}\n\npub fn once(x: &Foo) -> String {\n    x.to_string()\n}\n",
        });
        expect(double.filter((l) => l.includes(" call "))).toEqual(["src/a.rs:22 call Foo::to_string()"]);
    });

    it("gives a typed parameter its receiver mode, as `self` has one: `&T`, `&mut T`, `T` (review 3's R21)", async () => {
        const found = await targets({
            "src/d.rs": "pub struct Table;\n\nimpl Table {\n    pub fn find(&self, k: u32) -> Option<u32> {\n        None\n    }\n    pub fn len(&self) -> usize {\n        0\n    }\n    pub fn add(&mut self, k: u32) {}\n    pub fn next(&mut self) -> Option<u32> {\n        None\n    }\n    pub fn count(&self) -> usize {\n        0\n    }\n}\n\npub fn outside(t: &Table, m: &mut Table, v: Table) {\n    t.find(1);\n    t.len();\n    m.add(1);\n    m.next();\n    m.find(1);\n    v.len();\n    v.count();\n}\n",
        });
        // `m.find`: Iterator's `find(&mut self)` would come first; `v.count`: Iterator's `count(self)`.
        expect(found.filter((l) => l.includes(" call "))).toEqual(["src/d.rs:20 call src/d.rs:4", "src/d.rs:21 call src/d.rs:7", "src/d.rs:22 call src/d.rs:10", "src/d.rs:23 call src/d.rs:11", "src/d.rs:25 call src/d.rs:7"]);
    });

    it("reads a `|` in a macro's tokens as a closure's but right after an operand: `async |v|`, `&mut |v|`, `break |v|` bind v (review 4's R25)", async () => {
        const pre = "pub struct Version;\n\nimpl Version {\n    pub fn parse() -> Version {\n        Version\n    }\n    pub fn check(&self) -> bool {\n        true\n    }\n}\n\npub fn run<F>(f: F) -> bool {\n    true\n}\n\n";
        const found = await targets({
            "src/a.rs": `${pre}pub fn probe() -> Version {\n    let v = Version::parse();\n    assert!(run(async |v| v.check()));\n    assert!(run(&mut |v: &Version| v.check()));\n    assert!(run(loop { break |v: &Version| v.check(); }));\n    assert!(run(move |v: &Version| v.check()));\n    v\n}\n`,
        });
        expect(found.filter((l) => l.endsWith(":7"))).toEqual([]);
        // A label's name and an attribute's group end no operand (review 5's R27).
        const marked = await targets({
            "src/a.rs": `${pre}pub fn probe() -> Version {\n    let v = Version::parse();\n    assert!(run('outer: loop { break 'outer |v: &Version| v.check(); }));\n    assert!(run(#[allow(unused)] |v: &Version| v.check()));\n    v\n}\n`,
        });
        expect(marked.filter((l) => l.endsWith(":7"))).toEqual([]);
    });

    it("reads a `|` in a macro's tokens as a closure's only where a closure can start: a bitwise or binds nothing (review 3's R23)", async () => {
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
