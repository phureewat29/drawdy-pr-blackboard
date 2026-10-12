import { describe, expect, it } from "@jest/globals";
import { testParse } from "../../../test/parser.ts";
import { isGeneric, type GFile } from "../../anyfacts.ts";
import { resolveAny } from "../../anylink.ts";
import { roleOf } from "../../language.ts";
import { rulesOf } from "../../linking.ts";
import { ELIXIR } from "./index.ts";
import { underscore } from "./names.ts";
import { mixFolders } from "./resolver.ts";

const parse = async (files: Record<string, string>): Promise<GFile[]> => {
    const parsed: GFile[] = [];
    for (const [path, text] of Object.entries(files)) {
        const f = await testParse(path, text);
        if (f && isGeneric(f)) parsed.push(f);
    }
    return parsed;
};

/** Every reference the files make that resolves, as `path:line ref card`. */
const links = async (files: Record<string, string>): Promise<string[]> => {
    const parsed = await parse(files);
    const labels = new Map(parsed.flatMap((f) => [...f.labels]));
    const refs = resolveAny(parsed, (f) => rulesOf(f.path)!.resolver, (path) => files[path]);
    return refs.flatMap((r) => r.units.map((u) => `${r.path}:${r.line} ${r.ref} ${labels.get(u.id)}`));
};

/** Every reference the files make that resolves, as `path:line target-path:line`. */
const targets = async (files: Record<string, string>): Promise<string[]> => {
    const refs = resolveAny(await parse(files), (f) => rulesOf(f.path)!.resolver, (path) => files[path]);
    return refs.flatMap((r) => r.units.map((u) => `${r.path}:${r.line} ${u.path}:${u.nameLine}`));
};

/** As `links`, the way a board reads: a path not given is missing. */
const boardLinks = async (files: Record<string, string>): Promise<string[]> => {
    const parsed = await parse(files);
    const labels = new Map(parsed.flatMap((f) => [...f.labels]));
    const refs = resolveAny(parsed, (f) => rulesOf(f.path)!.resolver, (path) => files[path], (path) => path in files);
    return refs.flatMap((r) => r.units.map((u) => `${r.path}:${r.line} ${r.ref} ${labels.get(u.id)}`));
};

/** The references of one file, as `line ref card`. */
const linksIn = async (path: string, files: Record<string, string>): Promise<string[]> => (await links(files)).filter((l) => l.startsWith(`${path}:`)).map((l) => l.slice(path.length + 1));

/** A module's source: `defmodule name do … end`, its lines indented. */
const mod = (name: string, ...lines: string[]) => `defmodule ${name} do\n${lines.map((l) => `  ${l}`).join("\n")}\nend\n`;

const URL_EX = mod("App.URL", "def check(p), do: p", "def check(p, opts), do: {p, opts}", "defp hidden(p), do: p", "defmacro m(x), do: x", "defguard is_ok(x) when is_integer(x)");

describe("Elixir's units", () => {
    it("are modules, protocols and implementations, and functions named for their module, consecutive clauses of a name one unit", async () => {
        const [f] = await parse({
            "lib/a.ex":
                "defmodule A.B do\n  @doc \"Gets.\"\n  def get(k), do: get(k, nil)\n  def get(k, d), do: {k, d}\n  defp other, do: 1\n  def get(k, d, e), do: {k, d, e}\n  defmodule Inner do\n    defmacro m(x), do: x\n  end\nend\n\ndefprotocol P do\n  def size(x)\nend\n\ndefimpl P, for: List do\n  def size(l), do: length(l)\nend\n",
        });
        expect(f.units.map((u) => `${f.labels.get(u.id)} ${u.docLine}-${u.endLine}`)).toEqual(["defmodule A.B 1-10", "B.get() 3-4", "B.other() 5-5", "B.get() 6-6", "defmodule Inner 7-9", "Inner.m() 8-8", "defprotocol P 12-14", "P.size() 13-13", "defimpl P for List 16-18", "size() 17-17"]);
    });

    it("leave out definitions inside a function, as other languages' do", async () => {
        const [f] = await parse({ "lib/a.ex": mod("A", "def run do", "  defmodule Tmp do", "    def x, do: 1", "  end", "end") });
        expect(f.units.map((u) => f.labels.get(u.id))).toEqual(["defmodule A", "A.run()"]);
    });
});

describe("Elixir's remote calls", () => {
    it("follow `alias`, `as:`, `{…}`, `__MODULE__`, `Elixir.` and a module written in full to its public function of that arity", async () => {
        const found = await linksIn("lib/app/web.ex", {
            "lib/app/url.ex": URL_EX,
            "lib/app/web.ex": mod(
                "App.Web",
                "alias App.URL",
                "alias App.URL, as: U",
                "alias App.{URL}",
                "def run(p) do",
                "  URL.check(p)",
                "  U.check(p, [])",
                "  App.URL.check(p)",
                "  Elixir.App.URL.check(p)",
                "  p |> URL.check()",
                "  p |> URL.check([])",
                "end"
            ),
        });
        expect(found).toEqual(["6 call URL.check()", "7 call URL.check()", "8 call URL.check()", "9 call URL.check()", "10 call URL.check()", "11 call URL.check()"]);
    });

    it("link nothing to a private function, a macro, a guard, a protocol's function or an arity the module lacks", async () => {
        const found = await linksIn("lib/app/web.ex", {
            "lib/app/url.ex": URL_EX,
            "lib/p.ex": "defprotocol P do\n  def size(x)\nend\n",
            "lib/app/web.ex": mod("App.Web", "alias App.URL", "def run(p) do", "  URL.hidden(p)", "  URL.m(p)", "  URL.is_ok(p)", "  P.size(p)", "  URL.check(p, 1, 2)", "  URL.check", "end"),
        });
        expect(found).toEqual([]);
    });

    it("count a do-block as an argument, and give a definition with defaults each of its arities", async () => {
        const found = await linksIn("lib/a.ex", { "lib/a.ex": mod("A", "def opt(a, b \\\\ 2), do: {a, b}", "def blk(a, kw), do: {a, kw}", "def run do", "  opt(1)", "  opt(1, 2)", "  opt(1, 2, 3)", "  blk 1 do", "    :ok", "  end", "  blk(1)", "end") });
        expect(found).toEqual(["5 call A.opt()", "6 call A.opt()", "8 call A.blk()"]);
    });

    it("name nothing through a module held in a variable, an Erlang module, `apply` or an atom alias", async () => {
        const found = await linksIn("lib/b.ex", {
            "lib/ets.ex": mod("Ets", "def new(a), do: a"),
            "lib/b.ex": mod("B", "alias :ets, as: Ets", "def run(m, x) do", "  m.new(x)", "  :ets.new(x, [])", "  Ets.new(x)", "  apply(Ets, :new, [x])", "end"),
        });
        expect(found).toEqual([]);
    });

    it("name nothing in a module two files define, nor in an `.exs` script's from another file; a script's own module it does", async () => {
        const found = await links({
            "lib/dup1.ex": mod("Dup", "def f(x), do: x"),
            "lib/dup2.ex": mod("Dup", "def f(x), do: x"),
            "test/support/helper.exs": mod("Helper", "def f(x), do: x"),
            "lib/user.ex": mod("User", "def run(x) do", "  Dup.f(x)", "  Helper.f(x)", "end"),
            "test/user_test.exs": `${mod("Local", "def f(x), do: x")}${mod("UserTest", "def run(x), do: Local.f(x)")}`,
        });
        expect(found).toEqual(["test/user_test.exs:5 call Local.f()"]);
    });

    it("reach a nested module by the alias its `defmodule` makes, and no module before it compiles from a module's body", async () => {
        const found = await linksIn("lib/n.ex", {
            "lib/n.ex": mod("N", "defmodule Inner do", "  def f(x), do: x", "end", "def g(x), do: Inner.f(x)", "@x Inner.f(1)", "@y __MODULE__.g(1)", "def h(x), do: __MODULE__.g(x)"),
        });
        expect(found).toEqual(["5 call Inner.f()", "6 call Inner.f()", "8 call N.g()"]);
    });

    it("give a module its name's own unit when an alias doesn't name it (`__MODULE__.Config`, an atom), so its functions never join the module's around it", async () => {
        const files = { "lib/a.ex": mod("A", "def new(x), do: x", "defmodule __MODULE__.Config do", "  def new(x), do: x", "end", "defmodule :\"Elixir.A.Raw\" do", "  def new(x), do: x", "end"), "lib/u.ex": mod("U", "def run(x), do: {A.new(x), A.Config.new(x)}") };
        const [f] = await parse({ "lib/a.ex": files["lib/a.ex"] });
        expect(f.units.map((u) => `${f.labels.get(u.id)} ${u.nameLine}`)).toEqual(["defmodule A 1", "A.new() 2", "defmodule __MODULE__.Config 3", "Config.new() 4", 'defmodule :"Elixir.A.Raw" 6', "new() 7"]);
        expect(await linksIn("lib/u.ex", files)).toEqual(["2 call A.new()", "2 call Config.new()"]);
    });

    it("reach a nested module's alias in its body wherever it stands, and know no such name after it outside a statement", async () => {
        const found = await targets({
            "lib/lib/other.ex": mod("Lib.Other", "def x, do: 1"),
            "lib/sample.ex": mod("Sample", "def foo, do: 1", "def bar, do: 2"),
            "test/a_test.exs": mod("ATest", "use ExUnit.Case", "alias Lib.Other", "test \"y\" do", "  {:module, _, _, _} = defmodule Sample do", "    def foo, do: Sample.bar()", "    def bar, do: 1", "  end", "  Other.x()", "  Sample.foo()", "end"),
        });
        expect(found.filter((l) => l.startsWith("test/"))).toEqual(["test/a_test.exs:6 test/a_test.exs:7", "test/a_test.exs:9 lib/lib/other.ex:2"]);
    });

    it("know no name after an alias in parentheses or arguments, which may reach the code after them", async () => {
        const found = await linksIn("lib/a.ex", {
            "lib/x/y.ex": mod("X.Y", "def f, do: 1"),
            "lib/z/w.ex": mod("Z.W", "def f, do: 2"),
            "lib/a.ex": mod("A", "alias X.Y", "def run do", "  Y.f()", "  (alias Z.W, as: Y; Y.f())", "  Y.f()", "end"),
        });
        expect(found).toEqual(["4 call Y.f()", "5 call W.f()"]);
    });

    it("read a name a nested `defprotocol` aliases as its protocol, never a module of that name elsewhere", async () => {
        const found = await linksIn("lib/n.ex", { "lib/p.ex": mod("P", "def x(v), do: v"), "lib/n.ex": mod("N", "defprotocol P do", "  def x(v)", "end", "def run(v), do: P.x(v)") });
        expect(found).toEqual([]);
        expect(await linksIn("lib/n.ex", { "lib/p.ex": mod("P", "def x(v), do: v"), "lib/n.ex": mod("N", "def run(v), do: P.x(v)") })).toEqual(["2 call P.x()"]);
    });

    it("name a top-level module through a file-level alias before it, as `defmodule` expands it", async () => {
        const found = await linksIn("lib/user.ex", { "lib/foo/bar/baz.ex": "alias Foo.Bar\ndefmodule Bar.Baz do\n  def f(x), do: x\nend\n", "lib/user.ex": mod("User", "def run(x), do: Foo.Bar.Baz.f(x)") });
        expect(found).toEqual(["2 call Baz.f()"]);
    });

    it("read aliases lexically: one in a function or an `if` block reaches no code after its block, nor an `else` part", async () => {
        const found = await linksIn("lib/c.ex", {
            "lib/n.ex": mod("N", "def f(x), do: x"),
            "lib/c.ex": mod("C", "def a(x) do", "  alias N, as: M", "  if x do", "    alias N, as: Q", "    Q.f(x)", "  else", "    Q.f(x)", "  end", "  Q.f(x)", "  M.f(x)", "end", "def b(x), do: M.f(x)"),
        });
        expect(found).toEqual(["6 call N.f()", "11 call N.f()"]);
    });
});

describe("Elixir and `use`", () => {
    const files = (body: string[]) => ({ "lib/repo.ex": mod("Repo", "def all(q), do: q"), "lib/my_app/repo.ex": mod("MyApp.Repo", "def all(q), do: q"), "lib/my_app/web.ex": mod("MyApp.Web", ...body) });

    it("takes no one-part name a `use` came before, the kind of name it aliases (`Repo`)", async () => {
        expect(await linksIn("lib/my_app/web.ex", files(["use MyApp.Injector", "def a(q), do: Repo.all(q)"]))).toEqual([]);
        expect(await linksIn("lib/my_app/web.ex", files(["def a(q), do: Repo.all(q)"]))).toEqual(["2 call Repo.all()"]);
    });

    it("takes no alias a `use` came after: it may alias the name again", async () => {
        expect(await linksIn("lib/my_app/web.ex", files(["alias MyApp.Repo, as: R", "use MyApp.Injector", "def a(q), do: R.all(q)"]))).toEqual([]);
    });

    it("takes an alias after the `use`, a name in full from the project's own namespace, and a standard-library module that injects no alias (`use GenServer`)", async () => {
        const mix = { "mix.exs": mod("MyApp.MixProject", "use Mix.Project", "def project, do: [app: :my_app]") };
        expect(await linksIn("lib/my_app/web.ex", { ...mix, ...files(["use MyApp.Injector", "alias MyApp.Repo, as: R", "def a(q), do: R.all(q)", "def b(q), do: MyApp.Repo.all(q)"]) })).toEqual(["4 call Repo.all()", "5 call Repo.all()"]);
        expect(await linksIn("lib/my_app/web.ex", files(["use GenServer", "def a(q), do: Repo.all(q)"]))).toEqual(["3 call Repo.all()"]);
    });

    it("takes no name in full after the `use` but one from the project's own namespace (`MyApp`, `MyAppWeb`): the `use` may alias its first part (`Accounts`)", async () => {
        const project = {
            "mix.exs": mod("MyApp.MixProject", "use Mix.Project", "def project, do: [app: :my_app]"),
            "lib/accounts/user.ex": mod("Accounts.User", "def get(id), do: id"),
            "lib/my_app/accounts/user.ex": mod("MyApp.Accounts.User", "def get(id), do: id"),
            "lib/my_app_web/endpoint.ex": mod("MyAppWeb.Endpoint", "def url, do: 1"),
            "lib/my_app_web/user_live.ex": mod("MyAppWeb.UserLive", "use MyAppWeb, :live_view", "def a(id), do: Accounts.User.get(id)", "def b(id), do: MyApp.Accounts.User.get(id)", "def c, do: MyAppWeb.Endpoint.url()"),
        };
        expect(await linksIn("lib/my_app_web/user_live.ex", project)).toEqual(["4 call User.get()", "5 call Endpoint.url()"]);
        // With no `mix.exs` read, no namespace is the project's.
        expect(await linksIn("lib/my_app_web/user_live.ex", { ...project, "mix.exs": "" })).toEqual([]);
    });

    it("takes no import a `use` came after, nor one an import of a module it can't name came after: either may import the module again", async () => {
        const run = (...lines: string[]) => linksIn("lib/w.ex", { "lib/n.ex": mod("N", "def f(x), do: x"), "lib/w.ex": mod("W", ...lines, "def a(x), do: f(x)") });
        expect(await run("import N", "use Something")).toEqual([]);
        expect(await run("import N", "import unquote(m)")).toEqual([]);
        // An Erlang module's import imports nothing of an Elixir module.
        expect(await run("import N", "import :lists")).toEqual(["4 call N.f()"]);
        expect(await run("import N", "require Something")).toEqual(["4 call N.f()"]);
    });
});

describe("Elixir's local calls", () => {
    it("reach the module's own function by name and arity, through pipes, a pipe into a bare name and parentheses", async () => {
        const found = await linksIn("lib/a.ex", {
            "lib/a.ex": mod("A", "def run(x) do", "  check(x)", "  x |> check()", "  x |> check", "  x |> (check())", "  x |> normalize(1)", "  check(x, 1)", "end", "defp check(x), do: x", "defp normalize(x, n), do: {x, n}"),
        });
        expect(found).toEqual(["3 call A.check()", "4 call A.check()", "5 call A.check()", "6 call A.check()", "7 call A.normalize()"]);
    });

    it("link no macro, guard, Nx `defn`, function a nested module defines, or name only an `if` defines; a loop's extra clause joins a definite one", async () => {
        const found = await linksIn("lib/a.ex", {
            "lib/a.ex": mod(
                "A",
                "defmacro m(x), do: x",
                "defguard g(x) when is_integer(x)",
                "defn nx(x), do: x",
                "defmodule Inner do",
                "  def inner(x), do: x",
                "end",
                "if Code.ensure_loaded?(Foo) do",
                "  def maybe(x), do: x",
                "end",
                "def t(:a), do: 1",
                "for x <- [:b] do",
                "  def t(unquote(x)), do: 2",
                "end",
                "def run(x) when g(x) do",
                "  m(x)",
                "  nx(x)",
                "  inner(x)",
                "  maybe(x)",
                "  t(x)",
                "end"
            ),
        });
        expect(found).toEqual(["20 call A.t()"]);
    });

    it("let a test's body call its module's own helper", async () => {
        const found = await linksIn("test/a_test.exs", { "test/a_test.exs": mod("ATest", "use ExUnit.Case", "test \"run\" do", "  assert helper(1) == 1", "end", "defp helper(x), do: x") });
        expect(found).toEqual(["4 call ATest.helper()"]);
    });

    it("take an import, never the module's own function, in the module's body: an attribute, a `for` or `fn` there, a `describe` block, a test's name", async () => {
        const files = {
            "lib/n.ex": mod("N", "def slug(x), do: x"),
            "test/a_test.exs": mod("ATest", "use ExUnit.Case", "import N", "@a slug(1)", "@b Enum.map([1], &slug/1)", "@c fn y -> slug(y) end", "for x <- [1], do: @d slug(x)", "describe \"g\" do", "  @e slug(1)", "  test \"#{slug(1)}\", do: own(2)", "  setup do", "    own(3)", "  end", "end", "def slug(x), do: {x}", "def own(x), do: x"),
        };
        const found = await linksIn("test/a_test.exs", files);
        expect(found).toEqual(["4 call N.slug()", "5 value N.slug()", "6 call N.slug()", "7 call N.slug()", "9 call N.slug()", "10 call N.slug()", "10 call ATest.own()", "12 call ATest.own()"]);
        // With no import, Kernel's: the module's own isn't there yet.
        expect(await linksIn("lib/m.ex", { "lib/m.ex": mod("M", "@zero to_string(0)", "def to_string(x), do: x") })).toEqual([]);
    });

    it("read the calls around a module defined in a test by the test's module: its body is a function", async () => {
        const found = await linksIn("test/o_test.exs", {
            "lib/n.ex": mod("N", "def f(x), do: x"),
            "test/o_test.exs": mod("OTest", "use ExUnit.Case", "import N", "test \"x\" do", "  wrap(fn ->", "    defmodule Inner do", "      def run(x), do: f(x)", "    end", "  end)", "end", "defp wrap(fun), do: fun.()"),
        });
        expect(found).toEqual(["5 call OTest.wrap()", "7 call N.f()"]);
    });
});

describe("Elixir's imports", () => {
    const n = mod("N", "def f(x), do: x", "def g(x), do: x", "def _hidden(x), do: x", "defmacro mac(x), do: x", "defp priv(x), do: x");

    it("give a public function of a module read: everything, `only:`'s or all but `except:`'s; never a macro, a private or `_` name, nor `only: :macros`", async () => {
        const run = (...directives: string[]) => linksIn("lib/u.ex", { "lib/n.ex": n, "lib/u.ex": mod("U", ...directives, "def a(x) do", "  f(x)", "  g(x)", "  _hidden(x)", "  mac(x)", "  priv(x)", "end") });
        expect(await run("import N")).toEqual(["4 call N.f()", "5 call N.g()"]);
        expect(await run("import N, only: [g: 1]")).toEqual(["5 call N.g()", "2 import N.g()"]);
        expect(await run("import N, except: [g: 1]")).toEqual(["4 call N.f()"]);
        expect(await run("import N, only: [g: 1]", "import N")).toEqual(["5 call N.f()", "6 call N.g()", "2 import N.g()"]);
        expect(await run("import N, only: :macros")).toEqual([]);
        expect(await run("import N, only: [_hidden: 1]")).toEqual(["6 call N._hidden()", "2 import N._hidden()"]);
    });

    it("read `except:` from what the module's import before it gave, or from everything; nothing where that or the options can't be read", async () => {
        const run = (...directives: string[]) => linksIn("lib/u.ex", { "lib/n.ex": n, "lib/u.ex": mod("U", ...directives, "def a(x) do", "  f(x)", "  g(x)", "end") });
        expect(await run("import N, only: [g: 1]", "import N, except: [g: 1]")).toEqual(["2 import N.g()"]);
        expect(await run("import N, only: :macros", "import N, except: [g: 1]")).toEqual(["5 call N.f()"]);
        expect(await run("import N, except: [f: 1]", "import N, except: [g: 1]")).toEqual([]);
        expect(await run("import N", "use Something", "import N, except: [g: 1]")).toEqual([]);
        expect(await run("import N, except: @hidden")).toEqual([]);
        expect(await run("import N, [only: [f: 1]]")).toEqual([]);
    });

    it("draw an `only:` entry to the public function it names; none to a macro, a private function, an arity the module lacks, two modules', a module not read, nor from `quote`", async () => {
        const found = await linksIn("lib/u.ex", {
            "lib/n.ex": n,
            "lib/m.ex": mod("M", "def f(x), do: x"),
            "lib/u.ex": mod("U", "import N, only: [f: 1, g: 2, mac: 1, priv: 1]", "import Elixir.{N, M}, only: [f: 1]", "import Missing, only: [f: 1]", "defmacro q do", "  quote do: import(N, only: [g: 1])", "end"),
        });
        expect(found).toEqual(["2 import N.f()"]);
    });

    it("reach code after the import only; a local definition of the name wins; two imports of it name nothing", async () => {
        expect(await linksIn("lib/u.ex", { "lib/n.ex": n, "lib/u.ex": mod("U", "def a(x), do: f(x)", "import N", "def b(x), do: f(x)") })).toEqual(["4 call N.f()"]);
        expect(await linksIn("lib/u.ex", { "lib/n.ex": n, "lib/u.ex": mod("U", "import N", "def a(x), do: f(x)", "def f(x), do: x") })).toEqual(["3 call U.f()"]);
        expect(await linksIn("lib/u.ex", { "lib/n.ex": n, "lib/m.ex": mod("M", "def f(x), do: x"), "lib/u.ex": mod("U", "import N", "import M", "def a(x), do: f(x)") })).toEqual([]);
    });

    it("read a Kernel name as Kernel's only while an `import Kernel` in scope leaves it in", async () => {
        const found = await linksIn("lib/a.ex", { "lib/a.ex": mod("A", "import Kernel, except: [if: 2]", "import MyIf", "def run(x) do", "  if(h(x), do: h(x))", "  unless(h(x), do: 1)", "end", "defp h(x), do: x") });
        expect(found).toEqual(["6 call A.h()"]);
    });

    it("read calls in the arguments of Kernel's and ExUnit's calls as calls", async () => {
        const found = await linksIn("test/a_test.exs", { "test/a_test.exs": mod("ATest", "use ExUnit.Case", "import ExUnit.CaptureLog", "test \"t\" do", "  binary_part(h(1), 0, 1)", "  flunk(h(2))", "  with_log(fn -> h(3) end)", "end", "defp h(x), do: x") });
        expect(found).toEqual(["5 call ATest.h()", "6 call ATest.h()", "7 call ATest.h()"]);
    });

    it("name nothing through a module not read, nor through `import A.{B, C}, only:` where both give the name", async () => {
        expect(await linksIn("lib/u.ex", { "lib/u.ex": mod("U", "import Missing", "def a(x), do: f(x)") })).toEqual([]);
        expect(await linksIn("lib/u.ex", { "lib/n.ex": n, "lib/m.ex": mod("M", "def f(x), do: x"), "lib/u.ex": mod("U", "import Elixir.{N, M}, only: [f: 1]", "def a(x), do: f(x)") })).toEqual([]);
        expect(await linksIn("lib/u.ex", { "lib/n.ex": n, "lib/m.ex": mod("M", "def h(x), do: x"), "lib/u.ex": mod("U", "import Elixir.{N, M}, only: [f: 1]", "def a(x), do: f(x)") })).toEqual(["3 call N.f()"]);
    });
});

describe("Elixir's captures and delegates", () => {
    it("read `&f/2` and `&M.f/2` as uses of the function of that arity", async () => {
        const found = await linksIn("lib/a.ex", { "lib/n.ex": mod("N", "def f(x, y), do: {x, y}"), "lib/a.ex": mod("A", "def run(l) do", "  Enum.map(l, &own/1)", "  Enum.map(l, &N.f/2)", "  Enum.map(l, &own(&1))", "  &N.f/1", "end", "defp own(x), do: x") });
        expect(found).toEqual(["3 value A.own()", "4 value N.f()", "5 call A.own()"]);
    });

    it("draw a `defdelegate`'s call to its target (`as:`, defaults counted), and calls to the delegate; none to an Erlang module", async () => {
        const found = await linksIn("lib/a.ex", {
            "lib/a/impl.ex": mod("A.Impl", "def go(x, y), do: {x, y}", "def stop(x), do: x"),
            "lib/a.ex": mod("A", "defdelegate go(x, y \\\\ 1), to: A.Impl", "defdelegate halt(x), to: __MODULE__.Impl, as: :stop", "defdelegate nope(x), to: :erlang, as: :abs", "def run(x), do: go(x)"),
        });
        expect(found).toEqual(["2 call Impl.go()", "3 call Impl.stop()", "5 call A.go()"]);
    });
});

describe("Elixir's code that isn't a call", () => {
    it("links nothing in `quote`, but what `unquote` runs where the quote is built; nothing in a typespec", async () => {
        const found = await linksIn("lib/a.ex", { "lib/a.ex": mod("A", "@spec g(term) :: term", "def g(x), do: x", "def k(x) do", "  quote do", "    g(unquote(g(x)))", "  end", "end") });
        expect(found).toEqual(["6 call A.g()"]);
    });

    it("links nothing in the arguments of a call that may be a macro (Ecto's `from`, a dependency's function, the module's own macro), and everything in Kernel's, ExUnit's, the standard library's and the module's functions'", async () => {
        const found = await linksIn("lib/a.ex", {
            "lib/a.ex": mod(
                "A",
                "defmacro own_macro(x), do: x",
                "def count(q), do: q",
                "def run(q) do",
                "  from(u in q, select: count(u.id))",
                "  Plug.Conn.put(q, count(q))",
                "  own_macro(count(q))",
                "  if count(q), do: count(q)",
                "  Enum.map(q, fn x -> count(x) end)",
                "  :lists.map(count(q), [])",
                "  helper(count(q))",
                "end",
                "defp helper(x), do: x"
            ),
        });
        expect(found).toEqual(["8 call A.count()", "8 call A.count()", "9 call A.count()", "10 call A.count()", "11 call A.helper()", "11 call A.count()"]);
    });

    it("links nothing in an `unquote` that `bind_quoted:` or `unquote: false` keeps in the template (`unquote: true` runs it), nor in a quote inside a quote", async () => {
        const quoted = (...opts: string[]) => mod("A", "def g(x), do: x", "defmacro k(x) do", `  quote ${opts.join(" ")}do`, "    def h, do: unquote(g(x))", "  end", "end");
        expect(await linksIn("lib/a.ex", { "lib/a.ex": quoted() })).toEqual(["5 call A.g()"]);
        expect(await linksIn("lib/a.ex", { "lib/a.ex": quoted("bind_quoted: [x: x] ") })).toEqual([]);
        expect(await linksIn("lib/a.ex", { "lib/a.ex": quoted("unquote: false ") })).toEqual([]);
        expect(await linksIn("lib/a.ex", { "lib/a.ex": quoted("[bind_quoted: [x: x]] ") })).toEqual([]);
        expect(await linksIn("lib/a.ex", { "lib/a.ex": quoted("unquote: true, bind_quoted: [x: x] ") })).toEqual(["5 call A.g()"]);
        expect(await linksIn("lib/a.ex", { "lib/a.ex": mod("A", "def g(x), do: x", "defmacro k(x) do", "  quote do", "    quote do: unquote(g(x))", "  end", "end") })).toEqual([]);
    });

    it("links nothing on the right of `::`: a bitstring segment's `size(8)` is a type, as a typespec's are; an `unquote` there runs", async () => {
        const found = await linksIn("lib/a.ex", { "lib/a.ex": mod("A", "def size(x), do: x", "def run(b) do", "  <<x::size(8), rest::binary-size(size(1))>> = b", "  {x, rest}", "end", "def spec(t), do: quote(do: f() :: unquote(size(t)))") });
        expect(found).toEqual(["7 call A.size()"]);
    });

    it("reads Kernel's sigils' `#{…}`, never another sigil's, which its macro may read its own way", async () => {
        const found = await linksIn("lib/a.ex", { "lib/a.ex": mod("A", "def f(x), do: x", "def run(x) do", "  ~s(#{f(x)})", "  ~p\"/#{f(x)}\"", "end") });
        expect(found).toEqual(["4 call A.f()"]);
    });
});

describe("Elixir's calls no reading proves", () => {
    it("read `only: :sigils` as unknown, and an `except:` after it from that", async () => {
        const imp = mod("Imp", "def inspect(x), do: {:imp, x}", "def f(x), do: x", "def sigil_q(s, _), do: s");
        expect(await linksIn("lib/m.ex", { "lib/imp.ex": imp, "lib/m.ex": mod("M", "import Imp, only: :sigils", "import Imp, except: [sigil_q: 2]", "def run(x), do: {inspect(x), f(x)}") })).toEqual([]);
        expect(await linksIn("lib/m.ex", { "lib/imp.ex": imp, "lib/m.ex": mod("M", "import Imp, only: :functions", "import Imp, except: [inspect: 1]", "def run(x), do: {inspect(x), f(x)}") })).toEqual(["4 call Imp.f()"]);
    });

    it("trust `test`, `describe` and `setup` as ExUnit's only where `use ExUnit.Case`, or a case template read, gives them and nothing after takes them away", async () => {
        const run = (...lines: string[]) => linksIn("test/a_test.exs", { "lib/dsl.ex": mod("DSL", "defmacro test(name, do: block), do: quote(do: @specs {unquote(name), unquote(Macro.escape(block))})"), "lib/clean.ex": mod("Clean", "defmacro __using__(_), do: quote(do: import(Clean))", "def x, do: 1"), "test/support/data_case.ex": mod("MyApp.DataCase", "use ExUnit.CaseTemplate", "using do", "  quote do", "    import MyApp.DataCase", "  end", "end"), "test/a_test.exs": mod("ATest", ...lines, "def helper(x), do: x", "test \"t\" do", "  helper(1)", "end") });
        expect(await run("use ExUnit.Case")).toEqual(["5 call ATest.helper()"]);
        expect(await run("use ExUnit.Case", "use Clean")).toEqual(["6 call ATest.helper()"]);
        expect(await run("use MyApp.DataCase")).toEqual(["5 call ATest.helper()"]);
        // A DSL's `test` keeps its block as data; with nothing proving ExUnit's, or a `use` after it no file shows, nothing is drawn.
        expect(await run("import DSL")).toEqual([]);
        expect(await run()).toEqual([]);
        expect(await run("use ExUnit.Case", "use Unread")).toEqual([]);
        expect(await run("use ExUnit.Case", "import ExUnit.Case, only: [describe: 2]", "import DSL")).toEqual([]);
        expect(await linksIn("lib/spec.ex", { "lib/dsl.ex": mod("DSL2", "defmacro describe(n, do: b), do: quote(do: @g {unquote(n), unquote(Macro.escape(b))})", "defmacro setup(do: b), do: quote(do: @s unquote(Macro.escape(b)))"), "lib/spec.ex": mod("Spec", "import DSL2", "def h, do: 1", "describe \"x\" do", "  h()", "end", "setup do", "  h()", "end") })).toEqual([]);
    });

    it("know nothing in a module defining by a qualified `Kernel.defmodule` or `Kernel.def`; another module of the file it reads", async () => {
        const found = await linksIn("lib/outer.ex", {
            "lib/inner.ex": mod("Inner", "def g, do: :top"),
            "lib/outer.ex": `${mod("Outer", "Kernel.defmodule Inner do", "  def g, do: :nested", "end", "def run, do: Inner.g()")}${mod("Other", "def run, do: Inner.g()")}`,
        });
        expect(found).toEqual(["8 call Inner.g()"]);
    });

    it("read no call in the arguments of IEx's or Kernel.SpecialForms' calls, which may take code as data; Kernel's own (`Kernel.++`) evaluate", async () => {
        const found = await linksIn("lib/dev.ex", { "lib/m.ex": mod("MyMod", "def fun, do: 1"), "lib/dev.ex": mod("Dev", "require IEx.Helpers", "def a, do: IEx.Helpers.h(MyMod.fun)", "def b, do: Kernel.SpecialForms.quote(do: MyMod.fun())", "def c(l), do: l |> Kernel.++(MyMod.fun())") });
        expect(found).toEqual(["5 call MyMod.fun()"]);
    });

    it("read no call among the operands of an operator a library may define (`~>`, `&&&`), nor of Kernel's where an `import Kernel` leaves it out", async () => {
        const found = await linksIn("lib/m.ex", { "lib/m.ex": mod("M", "import Pipe", "def f(a), do: a", "def f(a, b), do: {a, b}", "def run(x), do: x ~> f(2)", "def band(x), do: f(x) &&& f(1)", "def plus(x), do: f(x) + 1") });
        expect(found).toEqual(["7 call M.f()"]);
        expect(await linksIn("lib/m.ex", { "lib/m.ex": mod("M", "import Kernel, except: [+: 2]", "import MyPlus", "def f(a), do: a", "def plus(x), do: f(x) + 1", "def minus(x), do: f(x) - 1") })).toEqual(["6 call M.f()"]);
    });

    it("read a definition's head named like a directive (`defmacro use(module, opts)`) as no directive", async () => {
        const found = await linksIn("lib/k.ex", { "lib/repo.ex": mod("Repo", "def all(q), do: q"), "lib/k.ex": mod("K", "defmacro use(module, opts \\\\ []), do: {module, opts}", "@spec import(term) :: term", "def a(q), do: Repo.all(q)") });
        expect(found).toEqual(["4 call Repo.all()"]);
    });
});

describe("Elixir's second review", () => {
    const mix = mod("App.MixProject", "use Mix.Project", "def project, do: [app: :app, elixirc_paths: elixirc_paths(Mix.env())]", "defp elixirc_paths(:test),", "  do: [\"lib\", \"test/support\"]", "defp elixirc_paths(:dev), do: [\"lib\", \"dev\"]", "defp elixirc_paths(_), do: [\"lib\"]");

    it("take no module two files of the caller's project folder define, whatever `elixirc_paths` is read as (here over two lines)", async () => {
        const found = await boardLinks({ "mix.exs": mix, "dev/mailer.ex": mod("App.Mailer", "def deliver(x), do: x"), "test/support/mailer.ex": mod("App.Mailer", "def deliver(x), do: x"), "test/support/notifier.ex": mod("App.Notifier", "def go(x), do: App.Mailer.deliver(x)") });
        expect(found.filter((l) => !l.startsWith("mix.exs"))).toEqual([]);
    });

    it("read a directive in an attribute's value (`@mod alias(Foo.Bar)`) as reaching on: its name is unknown after it", async () => {
        const found = await linksIn("lib/m.ex", { "lib/bar.ex": mod("Bar", "def go, do: :top"), "lib/foo/bar.ex": mod("Foo.Bar", "def go, do: :nested"), "lib/m.ex": mod("M", "@mod alias(Foo.Bar)", "def run, do: Bar.go()") });
        expect(found).toEqual([]);
    });

    it("trust ExUnit's names only at the arities ExUnit defines (`assert/1,2`): `assert/3` is another import's", async () => {
        const files = (body: string) => ({ "lib/my_asserts.ex": mod("MyAsserts", "defmacro assert(left, op, right), do: Macro.escape({left, op, right})"), "test/x_test.exs": mod("XTest", "use ExUnit.Case", "import MyAsserts", "def helper(x), do: x", "test \"t\" do", `  ${body}`, "end") });
        expect(await linksIn("test/x_test.exs", files("assert(helper(1), :eq, 1)"))).toEqual([]);
        expect(await linksIn("test/x_test.exs", files("assert helper(1)"))).toEqual(["6 call XTest.helper()"]);
    });

    it("take a `use` as harmless only where its `__using__` returns a quote of directives, definitions, attributes and calls of functions read; not a macro's call", async () => {
        const run = (using: string) =>
            linksIn("test/x_test.exs", {
                "lib/app/imports.ex": mod("App.Imports", "defmacro setup_imports, do: quote(do: import(ExUnit.Assertions, except: [assert: 1]))", "def register(_mod), do: :ok"),
                "lib/app/helpers.ex": mod("App.Helpers", "defmacro __using__(_) do", "  quote do", "    require App.Imports", `    ${using}`, "  end", "end"),
                "test/x_test.exs": mod("XTest", "use ExUnit.Case", "use App.Helpers", "def helper(x), do: x", "test \"t\" do", "  assert helper(1)", "end"),
            });
        expect(await run("App.Imports.setup_imports()")).toEqual([]);
        expect(await run("App.Imports.register(__MODULE__)")).toEqual(["6 call XTest.helper()"]);
    });

    it("know nothing in a module that uses by a qualified `Kernel.use`", async () => {
        const found = await linksIn("lib/my_app_web/user_live.ex", { "lib/accounts/user.ex": mod("Accounts.User", "def get!(id), do: id"), "lib/my_app_web/user_live.ex": mod("MyAppWeb.UserLive", "Kernel.use MyAppWeb, :live_view", "def mount(id), do: Accounts.User.get!(id)") });
        expect(found).toEqual([]);
    });

    it("read Kernel's operators and names as Kernel's after a `use` of a module read, but those its quotes leave out (`import Kernel, except:`)", async () => {
        const plus = mod("Plus", "defmacro __using__(_) do", "  quote do", "    import Kernel, except: [+: 2]", "    import Plus", "  end", "end", "defmacro {name, meta, args} + right, do: {name, meta, args ++ [right]}");
        const m = mod("M", "use Plus", "def f(a), do: a", "def f(a, b), do: {a, b}", "def run(x), do: f(x) + 1", "def other(x), do: f(x) - 1");
        expect(await linksIn("lib/m.ex", { "lib/plus.ex": plus, "lib/m.ex": m })).toEqual(["6 call M.f()"]);
        const sized = mod("Sized", "defmacro __using__(_), do: quote(do: import(Kernel, except: [size: 1]))");
        const n = mod("N", "use Sized", "def f(a), do: a", "def run(x), do: put_elem({1}, 0, f(x))", "def run2(x), do: size(f(x))");
        expect(await linksIn("lib/n.ex", { "lib/sized.ex": sized, "lib/n.ex": n })).toEqual(["4 call N.f()"]);
    });

    it("take no name in full from the project's namespace that a `use` read in scope aliases", async () => {
        const found = await linksIn("lib/accounts/web.ex", {
            "mix.exs": mod("Accounts.MixProject", "use Mix.Project", "def project, do: [app: :accounts]"),
            "lib/my_lib.ex": mod("MyLib", "defmacro __using__(_), do: quote(do: alias(MyLib.Accounts))"),
            "lib/accounts/user.ex": mod("Accounts.User", "def get(id), do: id"),
            "lib/my_lib/accounts/user.ex": mod("MyLib.Accounts.User", "def get(id), do: id"),
            "lib/accounts/web.ex": mod("Accounts.Web", "use MyLib", "def show(id), do: Accounts.User.get(id)"),
        });
        expect(found).toEqual([]);
    });

    it("look for a `mix.exs` where a project keeps its code first: the folder holding the deepest `lib/` or `test/`, after the folders inside that `test/`; then up from the file", () => {
        expect(mixFolders("lib/app/thing.ex")).toEqual({ order: ["", "lib/app", "lib"], first: 1 });
        expect(mixFolders("test/app/thing_test.exs")).toEqual({ order: ["test/app", "", "test"], first: 2 });
        expect(mixFolders("lib/elixir/unicode/security.ex")).toEqual({ order: ["", "lib/elixir/unicode", "lib/elixir", "lib"], first: 1 });
        expect(mixFolders("priv/repo/seeds.exs")).toEqual({ order: ["priv/repo", "priv", ""], first: 3 });
    });
});

describe("Elixir's Mix projects", () => {
    const mix = (name: string, ...extra: string[]) => mod(`${name}.MixProject`, "use Mix.Project", `def project, do: [app: :${name.toLowerCase()}${extra.join("")}]`);

    it("reach only code the caller's project compiles: not an example's (its own `mix.exs`), a fixture's or priv/'s copy", async () => {
        const files = {
            "mix.exs": mix("App"),
            "examples/demo/mix.exs": mix("Demo"),
            "examples/demo/lib/thing.ex": mod("App.Thing", "def go, do: :copy"),
            "test/fixtures/other.ex": mod("App.Other", "def go, do: :copy"),
            "priv/templates/third.ex": mod("App.Third", "def go, do: :copy"),
            "lib/app/caller.ex": mod("App.Caller", "def a, do: {App.Thing.go(), App.Other.go(), App.Third.go()}"),
            "examples/demo/lib/demo.ex": mod("Demo", "def a, do: App.Thing.go()"),
        };
        expect(await links(files)).toEqual(["examples/demo/lib/demo.ex:2 call Thing.go()"]);
    });

    it("take no module another project in the folder defines too (a misread `elixirc_paths` only loses lines), and reach the folders its `elixirc_paths` name", async () => {
        const found = await links({
            "mix.exs": mix("App", ', elixirc_paths: ["lib", "proto/lib"]'),
            "lib/app/thing.ex": mod("App.Thing", "def go, do: :real"),
            "examples/demo/mix.exs": mix("Demo"),
            "examples/demo/lib/thing.ex": mod("App.Thing", "def go, do: :copy"),
            "proto/mix.exs": mix("Proto"),
            "proto/lib/app/proto.ex": mod("App.Proto", "def go, do: 1"),
            "lib/app/caller.ex": mod("App.Caller", "def a, do: {App.Thing.go(), App.Proto.go()}"),
        });
        expect(found).toEqual(["lib/app/caller.ex:2 call Proto.go()"]);
    });

    it("keep apps of an umbrella apart, but not the standard library's apps in elixir-lang/elixir", async () => {
        const umbrella = await links({ "apps/a/mix.exs": mix("A"), "apps/b/mix.exs": mix("B"), "apps/a/lib/a.ex": mod("A", "def go, do: B.go()"), "apps/b/lib/b.ex": mod("B", "def go, do: 1") });
        expect(umbrella).toEqual([]);
        const stdlib = await links({ "lib/elixir/mix.exs": mix("Elixir"), "lib/mix/mix.exs": mix("Mix"), "lib/elixir/lib/string.ex": mod("String", "def go, do: 1"), "lib/mix/lib/mix.ex": mod("Mix", "def go, do: String.go()") });
        expect(stdlib).toEqual(["lib/mix/lib/mix.ex:2 call String.go()"]);
    });
});

describe("Elixir's third review", () => {
    const mix = mod("App.MixProject", "use Mix.Project", "def project, do: [app: :app, elixirc_paths: elixirc_paths(Mix.env())]", 'defp elixirc_paths(:test), do: ["lib", "test/support"]', 'defp elixirc_paths(:dev), do: ["lib", "dev"]', 'defp elixirc_paths(_), do: ["lib"]');
    const fake = mod("App.FakeAssert", "defmacro assert(expr), do: Macro.escape(expr)");
    const quoted = (head: string, ...lines: string[]) => [`${head} do`, "  quote do", ...lines.map((l) => `    ${l}`), "  end", "end"];
    // A test using a case template whose body holds these lines.
    const template = (use: string, ...body: string[]) =>
        linksIn("test/x_test.exs", { "mix.exs": mix, "lib/app/fake_assert.ex": fake, "lib/app/helpers.ex": mod("App.Helpers", "def h(x), do: x"), "test/support/app_case.ex": mod("App.Case", "use ExUnit.CaseTemplate", ...body), "test/x_test.exs": mod("XTest", use, "def helper(x), do: x", 'test "t" do', "  assert helper(1)", "end") });

    it("read a case template's `using` blocks: each line a directive naming its module as written, its options one literal keyword list; one in an `if`, or two that differ, leave ExUnit's names unknown", async () => {
        expect(await template("use App.Case", ...quoted("using opts", "import App.FakeAssert, only: []", "import App.Helpers"))).toEqual(["5 call XTest.helper()"]);
        expect(await template("use App.Case", ...quoted("using", "import ExUnit.Assertions, [except: [assert: 1]]", "import App.FakeAssert"))).toEqual([]);
        expect(await template("use App.Case, except: [assert: 1]", ...quoted("using opts", "import ExUnit.Assertions, unquote(opts)", "import App.FakeAssert"))).toEqual([]);
        expect(await template("use App.Case", "if true do", ...quoted("using", "import ExUnit.Assertions, except: [assert: 1]", "import App.FakeAssert"), "end")).toEqual([]);
        expect(await template("use App.Case", ...quoted("using", "alias ExUnit.Assertions, as: A", "import A, except: [assert: 1]", "import App.FakeAssert"))).toEqual([]);
        expect(await template("use App.Case", ...quoted("using", "import ExUnit.Assertions, only: :sigils", "import App.FakeAssert"))).toEqual([]);
        expect(await template("use App.Case", ...quoted("using", "import App.Helpers"), ...quoted("using", "import ExUnit.Assertions, except: [assert: 1]", "import App.FakeAssert"))).toEqual([]);
    });

    it("read a `use` in a quote the same way, and a `__using__` that calls the function the atom a `use` passes names (Phoenix's `use MyAppWeb, :live_view`), splicing the quotes of the module's own functions", async () => {
        const web = mod("AppWeb", ...quoted("def helpers", "unquote(more())"), ...quoted("defp more", "import App.Helpers", "import Phoenix.VerifiedRoutes, only: :sigils", "alias Phoenix.LiveView.JS"), ...quoted("def bad", "import ExUnit.Assertions, except: [assert: 1]", "import App.FakeAssert"), ...quoted("def pipeless", "use Phoenix.LiveView", "import Kernel, except: [|>: 2]"), "defmacro __using__(which) when is_atom(which) do", "  apply(__MODULE__, which, [])", "end");
        const conn = (which: string) => linksIn("test/x_test.exs", { "mix.exs": mix, "lib/app/fake_assert.ex": fake, "lib/app/helpers.ex": mod("App.Helpers", "def h(x), do: x"), "lib/app_web.ex": web, "test/support/app_case.ex": mod("App.Case", "use ExUnit.CaseTemplate", ...quoted("using", `use AppWeb, ${which}`)), "test/x_test.exs": mod("XTest", "use App.Case", "def helper(x), do: x", 'test "t" do', "  assert helper(1)", "end") });
        expect(await conn(":helpers")).toEqual(["5 call XTest.helper()"]);
        expect(await conn(":bad")).toEqual([]);
        const live = (which: string) => linksIn("lib/app_web/page_live.ex", { "lib/app/helpers.ex": mod("App.Helpers", "def h(x), do: x"), "lib/app_web.ex": web, "lib/app_web/page_live.ex": mod("AppWeb.PageLive", `use AppWeb, ${which}`, "def f(x), do: x", "def run(x), do: x |> f()") });
        expect(await live(":helpers")).toEqual(["4 call PageLive.f()"]);
        expect(await live(":pipeless")).toEqual([]);
        expect(await live(":other")).toEqual([]);
    });

    it("know nothing of Kernel after a `use` read whose quote calls a macro, makes a directive through an alias it set, or holds anything but data in an attribute or a function's argument", async () => {
        const m = mod("M", "use Outer", "def f(a), do: a", "def f(a, b), do: {a, b}", "def run(x), do: f(x) + 1", "def other(x), do: f(x) - 1");
        const plus = mod("Plus", ...quoted("defmacro __using__(_)", "import Kernel, except: [+: 2]", "import Plus"), "defmacro {name, meta, args} + right, do: {name, meta, args ++ [right]}");
        expect(await linksIn("lib/m.ex", { "lib/plus.ex": plus, "lib/outer.ex": mod("Outer", "defmacro __using__(_), do: quote(do: use(Plus))"), "lib/m.ex": m })).toEqual(["6 call M.f()"]);
        const ops = mod("PlusOps", ...quoted("defmacro setup", "import Kernel, except: [+: 2]", "import PlusOps"), "def register(_mod, _opts), do: :ok", "defmacro {name, meta, args} + right, do: {name, meta, args ++ [right]}");
        const outer = (...lines: string[]) => ({ "lib/plus_ops.ex": ops, "lib/outer.ex": mod("Outer", ...quoted("defmacro __using__(opts)", "require PlusOps", ...lines)), "lib/m.ex": m });
        expect(await linksIn("lib/m.ex", outer("PlusOps.setup()"))).toEqual([]);
        expect(await linksIn("lib/m.ex", outer("alias Kernel, as: K", "import K, except: [+: 2]", "import PlusOps"))).toEqual([]);
        expect(await linksIn("lib/m.ex", outer("@opts unquote(opts)"))).toEqual([]);
        expect(await linksIn("lib/m.ex", outer("import Kernel, only: :sigils"))).toEqual([]);
        expect(await linksIn("lib/m.ex", outer("import PlusOps, only: unquote(opts)"))).toEqual([]);
        expect(await linksIn("lib/m.ex", outer("PlusOps.register(__MODULE__, unquote(opts))"))).toEqual([]);
        expect(await linksIn("lib/m.ex", outer("PlusOps.register(__MODULE__, [])", "Module.register_attribute(__MODULE__, :x, accumulate: true)", "@opts [a: 1]", "message = \"data\""))).toEqual(["5 call M.f()", "6 call M.f()"]);
        // A `use` in the module itself may define its `__using__`.
        expect(await linksIn("lib/m.ex", { "lib/outer.ex": mod("Outer", "use Unread", "defmacro __using__(_), do: quote(do: import(Outer))"), "lib/m.ex": m })).toEqual([]);
        // An import of a module that can't be named may be Kernel's.
        expect(await linksIn("lib/m.ex", { "lib/plus.ex": plus, "lib/m.ex": mod("M", 'import :"Elixir.Kernel", except: [+: 2]', "import Plus", "def f(a), do: a", "def run(x), do: f(x) + 1") })).toEqual([]);
        expect(await linksIn("lib/m.ex", { "lib/plus.ex": plus, "lib/outer.ex": mod("Outer", ...quoted("defmacro __using__(_)", 'import :"Elixir.Kernel", except: [+: 2]', "import Plus")), "lib/m.ex": m })).toEqual([]);
    });

    it("count `require …, as:`, and the aliases a `use` in a quote makes, among the names a `use` read aliases", async () => {
        const files = (alias: string, use: string) => ({
            "mix.exs": mod("Accounts.MixProject", "use Mix.Project", "def project, do: [app: :accounts]"),
            "lib/my_lib.ex": mod("MyLib", `defmacro __using__(_), do: quote(do: ${alias})`),
            "lib/my_lib/web.ex": mod("MyLib.Web", "defmacro __using__(_), do: quote(do: use(MyLib))"),
            "lib/accounts/user.ex": mod("Accounts.User", "def get(id), do: id"),
            "lib/my_lib/accounts/user.ex": mod("MyLib.Accounts.User", "def get(id), do: id"),
            "lib/accounts/web.ex": mod("Accounts.Web", use, "def show(id), do: Accounts.User.get(id)"),
        });
        expect(await linksIn("lib/accounts/web.ex", files("require(MyLib.Accounts, as: Accounts)", "use MyLib"))).toEqual([]);
        expect(await linksIn("lib/accounts/web.ex", files("alias(MyLib.Accounts)", "use MyLib.Web"))).toEqual([]);
        expect(await linksIn("lib/accounts/web.ex", files("require(MyLib.Accounts)", "use MyLib.Web"))).toEqual(["3 call User.get()"]);
    });

    it("link only where some Mix environment compiles both the caller and the target, by `elixirc_paths` per clause; a test file runs in `test`; where the clauses can't be read, no file is linked into", async () => {
        const project = (mixExs: string, from: string) =>
            boardLinks({
                "mix.exs": mixExs,
                "dev/mailer.ex": mod("App.Mailer", "def deliver(x), do: x"),
                "test/support/helper.ex": mod("App.Helper", "def go(x), do: x"),
                "proto/lib/proto.ex": mod("App.Proto", "def go(x), do: x"),
                "lib/app/repo.ex": mod("App.Repo", "def get(x), do: x"),
                [from]: mod("App.Caller", "def a(x), do: {App.Mailer.deliver(x), App.Helper.go(x), App.Proto.go(x), App.Repo.get(x)}"),
            }).then((l) => l.filter((x) => x.startsWith(from)).map((x) => x.split(" ").pop()));
        expect(await project(mix, "test/support/notifier.ex")).toEqual(["Helper.go()", "Repo.get()"]);
        expect(await project(mix, "test/x_test.exs")).toEqual(["Helper.go()", "Repo.get()"]);
        expect(await project(mix, "lib/app/notifier.ex")).toEqual(["Mailer.deliver()", "Helper.go()", "Repo.get()"]);
        expect(await project(mix, "dev/notifier.ex")).toEqual(["Mailer.deliver()", "Repo.get()"]);
        const livebook = mod("App.MixProject", "use Mix.Project", "def project, do: [app: :app, elixirc_paths: elixirc_paths(Mix.env())]", 'defp elixirc_paths(:test), do: elixirc_paths(:dev) ++ ["test/support"]', 'defp elixirc_paths(_), do: ["lib", "proto/lib"]');
        expect(await project(livebook, "test/x_test.exs")).toEqual(["Helper.go()", "Proto.go()", "Repo.get()"]);
        const app = (...lines: string[]) => mod("App.MixProject", "use Mix.Project", ...lines);
        expect(await project(app("def project, do: [app: :app]"), "lib/app/notifier.ex")).toEqual(["Repo.get()"]);
        expect(await project(app("def project, do: [app: :app, elixirc_paths: paths()]", 'defp paths, do: if(Mix.env() == :test, do: ["lib", "test/support"], else: ["lib"])'), "test/x_test.exs")).toEqual([]);
        expect(await project(app("def project, do: [app: :app, elixirc_paths: elixirc_paths(Mix.env())]", 'defp elixirc_paths(env) when env in [:test], do: ["lib", "test/support"]', 'defp elixirc_paths(_), do: ["lib"]'), "lib/app/notifier.ex")).toEqual([]);
        expect(await project(app("def project, do: [app: :app, elixirc_paths: elixirc_paths(Mix.env())]"), "lib/app/notifier.ex")).toEqual([]);
    });
});

describe("Elixir's pack", () => {
    it("names ExUnit's test cases and groups, and calls `_test.exs` files tests", () => {
        expect(ELIXIR.cases!('  test "sends client joins", %{conn: conn} do', undefined)).toEqual({ name: "sends client joins", group: false });
        expect(ELIXIR.cases!('  describe "static_path/2" do', undefined)).toEqual({ name: "static_path/2", group: true });
        expect(ELIXIR.cases!("  def test(x), do: x", undefined)).toBeUndefined();
        expect([roleOf("test/phoenix/url_test.exs"), roleOf("lib/phoenix/url.ex")]).toEqual(["test", "code"]);
    });

    it("finds a module's file as Macro.underscore/1 names it", () => {
        expect(["MyApp.HTTPClient", "LivebookWeb.SessionLive", "Module.Types.Descr", "IEx", "JSON"].map(underscore)).toEqual(["my_app/http_client", "livebook_web/session_live", "module/types/descr", "i_ex", "json"]);
    });
});
