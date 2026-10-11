import { describe, expect, it } from "@jest/globals";
import { testParse } from "../test/parser.ts";
import { isGeneric, type GFile } from "./anyfacts.ts";

const index = async (path: string, text: string): Promise<GFile> => {
    const f = await testParse(path, text);
    if (!f || !isGeneric(f)) throw new Error(`${path} wasn't read by a rule table`);
    return f;
};

/** Each unit as `label lines`, from its first comment to its last line. */
const units = (f: GFile) => f.units.map((u) => `${f.labels.get(u.id)} ${u.docLine}-${u.endLine}`);

describe("Python's units", () => {
    it("are classes, functions, methods named with their class, and module-level values; `def new` and `def delete` too", async () => {
        const f = await index("app/store.py", "LIMIT = 3\n\n# A store.\nclass Store:\n    def new(self):\n        def inner():\n            pass\n\n    def delete(self, key):\n        pass\n\ndef delete(key):\n    pass\n");
        expect(units(f)).toEqual(["LIMIT 1-1", "class Store 3-10", "Store.new() 5-7", "Store.delete() 9-10", "delete() 12-13"]);
    });

    it("take a `type X = ...` alias as a type, though tags.scm predates it", async () => {
        const f = await index("app/types.py", "type Pair = tuple[int, int]\n\ndef first(p: Pair) -> int:\n    return p[0]\n");
        expect(units(f)).toEqual(["type Pair 1-1", "first() 3-4"]);
    });

    it("join `@overload` signatures to their implementation, and a property's setter and deleter to its getter, as one card", async () => {
        const f = await index(
            "app/a.py",
            "class A:\n    @overload\n    def get(self, k: int) -> int: ...\n    @overload\n    def get(self, k: str) -> str: ...\n    def get(self, k):\n        return k\n\n    @property\n    def size(self):\n        return 1\n\n    @size.setter\n    def size(self, v):\n        pass\n\n    def other(self):\n        pass\n"
        );
        expect(units(f)).toEqual(["class A 1-18", "A.get() 2-7", "A.size 9-15", "A.other() 17-18"]);
    });

    it("name a property without `()`: it reads as a value", async () => {
        const f = await index(
            "app/dep.py",
            "import functools\nfrom functools import cached_property\n\nclass Dependant:\n    @property\n    def name(self):\n        return 1\n\n    @cached_property\n    def is_gen_callable(self):\n        return 2\n\n    @functools.cached_property\n    def path(self):\n        return 3\n\n    @staticmethod\n    def make():\n        return 4\n"
        );
        expect(units(f).slice(1)).toEqual(["Dependant.name 5-7", "Dependant.is_gen_callable 9-11", "Dependant.path 13-15", "Dependant.make() 17-19"]);
    });

    it("read names in f-strings, never in docstrings, comments or strings", async () => {
        const f = await index("a.py", 'def run():\n    """Calls helper() first."""\n    # helper()\n    s = "helper()"\n    return f"{helper()}"\n');
        expect(f.sites.filter((s) => s.name === "helper").map((s) => `${s.line} ${s.ref}`)).toEqual(["5 call"]);
    });
});

describe("Go's units", () => {
    it("name a method with its receiver's type, and run a function past a label at column 0", async () => {
        const f = await index("srv/s.go", "package srv\n\n// S serves.\ntype S struct{}\n\nfunc (s *S) Start() {\nloop:\n\tfor {\n\t\tbreak loop\n\t}\n}\n\nfunc (s *List[T]) Len() int { return 0 }\n\nfunc New() *S { return &S{} }\n");
        expect(units(f)).toEqual(["type S 3-4", "S.Start() 6-11", "List.Len() 13-13", "New() 15-15"]);
    });
});

describe("Rust's units", () => {
    it("name a method with its type, an impl block by what it implements, and take the attributes above an item", async () => {
        const f = await index(
            "src/req.rs",
            "/// A request.\n#[derive(Debug)]\npub struct Request {\n    id: u32,\n}\n\nimpl Request {\n    #[inline]\n    pub fn new(id: u32) -> Self {\n        Request { id }\n    }\n}\n\nimpl fmt::Display for Request {\n    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {\n        Ok(())\n    }\n}\n\nfn helper() {}\n"
        );
        expect(units(f)).toEqual(["type Request 1-5", "impl Request 7-12", "Request::new() 8-11", "impl Display for Request 14-18", "Request::fmt() 15-17", "helper() 20-20"]);
    });
});
