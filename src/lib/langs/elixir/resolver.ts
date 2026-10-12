/**
 * Elixir's resolver. A call names a function by its module, name and arity,
 * all fixed when the code compiles, so the files read prove a call where:
 *
 * - `M.f(…)`: M expands through the aliases in scope (`outline.ts`) to a
 *   module one file read defines (another file's only if it is an `.ex` a
 *   Mix environment of the caller's project compiles with the caller: its
 *   nearest `mix.exs`, `elixirc_paths` per environment), which defines a
 *   public `f` of that arity;
 * - `f(…)` in a function: the module defines `f` of that arity (a local
 *   definition always wins: an import of the same name and arity fails to
 *   compile), else exactly one `import` in scope gives a public `f` of a
 *   module read (two would fail to compile too). In a module's body only
 *   the import: the module's own functions don't exist yet, and the compiler
 *   takes the import even where the module defines the name;
 * - a pipe adds one argument, a do-block one more, a capture `&f/2` writes
 *   it; `defdelegate f(a), to: M` calls `M.f/1`; `import M, only: [f: 1]`
 *   names `M.f/1`.
 *
 * Nothing else is proven. A macro, a guard, a protocol's function or a
 * function defined only inside `if`, a loop or another macro's block is no
 * target; a call inside `quote`, a typespec, a bitstring's type
 * (`::size(8)`), a custom sigil or the arguments of a call that may be a
 * macro (which may read its arguments its own way, as Ecto's queries do) is
 * no call, as are the operands of an operator a library may define (`~>`)
 * and the arguments of IEx's calls; ExUnit's `test` and the like are
 * ExUnit's only where `use ExUnit.Case` proves it. `apply`, `mod.f()` and
 * Erlang modules name nothing, nor does a module defining by a qualified
 * `Kernel.defmodule`. `use M` may inject imports: an import of a module
 * imported before it is unknown after it.
 *
 * What only code no file read does is out of reach, a limit of this
 * reading: a `use` of a module no file read may leave Kernel's operators out
 * for its own, or alias a project's own namespace. Where the module is
 * read, its quotes are read (`injects`): one holding a statement that may
 * do more than they show leaves Kernel's names, ExUnit's and the aliases
 * after the `use` unknown.
 */

import type { GSite } from "../../anyfacts.ts";
import type { OwnResolver } from "../../anylink.ts";
import { pushTo } from "../../fp.ts";
import { child, childOfType, namedChildren, textOf, type Flat } from "../../syntax.ts";
import type { Unit } from "../pack.ts";
import { CODE_AS_DATA, CUSTOM_OPS, EXUNIT, EXUNIT_USES, FORMS, FUNCTIONS_ONLY, KERNEL, KERNEL_OPS, KERNEL_SIGILS, NO_ALIAS_USE, STDLIB, TEST_BODIES, TYPESPECS } from "./names.ts";
import { argsOf, arityOf, BODIES, DEFS, defKind, doBlockOf, headOf, keyword, nameOf, opOf, option, segmentsOf } from "./nodes.ts";
import { directivesOf, outline, type Def, type Dir, type Mod, type Outline } from "./outline.ts";
import { delegateOf } from "./rules.ts";

/** Functions a call by name may reach; `defdelegate` defines one. */
const FUNCTIONS: ReadonlySet<string> = new Set(["def", "defp", "defdelegate"]);
const PUBLIC: ReadonlySet<string> = new Set(["def", "defdelegate"]);

type File = { units: ReadonlyMap<number, Unit>; path: string; t: Flat; o: Outline };
/** What a `use` of a module read injects, read from its quotes: the directives they make, in order (each `named`), and the names their aliases bind. */
type Injected = { dirs: Dir[]; aliases: Set<string> };
/** Where a site's code runs: its module, and whether in one of its functions (`fun`) or in its body. */
type Ctx = { mod: Mod | null; fun: boolean };

/** `x |> f(…)`: the call takes the pipe's left side as its first argument, through parentheses. */
const piped = (t: Flat, n: number): boolean => {
    let x = n;
    while (t.type[t.parent[x]] === "block" && namedChildren(t, t.parent[x]).length === 1) x = t.parent[x];
    return t.field[x] === "right" && opOf(t, t.parent[x]) === "|>";
};

const arityAt = (t: Flat, call: number): number | null => {
    const a = arityOf(t, call);
    return a === null ? null : a + (piped(t, call) ? 1 : 0);
};

/** The arity `&…/2` writes, when a `/` is right inside `&`; else null. */
const captured = (t: Flat, slash: number): number | null => {
    const right = child(t, slash, "right");
    return opOf(t, slash) === "/" && opOf(t, t.parent[slash]) === "&" && t.type[right] === "integer" ? Number(textOf(t, right)) : null;
};

/** Whether a quote runs its `unquote`s where it is built: `bind_quoted:` leaves them in the template, unless `unquote: true` says otherwise. */
const unquotes = (t: Flat, quote: number): boolean => {
    const on = option(t, quote, "unquote");
    return argsOf(t, quote).every((a) => t.type[a] === "keywords") && (on >= 0 ? textOf(t, on) === "true" : option(t, quote, "bind_quoted") < 0);
};

/** Whether a node lies within another. */
const within = (t: Flat, n: number, outer: number) => outer >= 0 && t.start[outer] <= t.start[n] && t.end[n] <= t.end[outer];

/** Whether a node sits in a `quote` inside a module. */
const quoted = (t: Flat, n: number, mod: number): boolean => {
    for (let x = t.parent[n]; x >= 0 && x !== mod; x = t.parent[x]) if (t.type[x] === "call" && nameOf(t, x) === "quote") return true;
    return false;
};

/** A `use` standing for what it injects, unknown (`named` a module no file read, or ""): after it, no import of ExUnit's is known (`selects`). */
const standIn = (node: number, named: string): Dir => ({ kind: "use", node, scope: -1, start: 0, end: 0, target: null, named });

/** The atom a `use` passes, `live_view` in `use MyAppWeb, :live_view`, for a `__using__` dispatching on it; else null. */
const whichOf = (t: Flat, use: number): string | null => {
    const a = argsOf(t, use)[1];
    return a !== undefined && t.type[a] === "atom" ? textOf(t, a).slice(1) : null;
};

/**
 * Where a file's `mix.exs` is looked for: the folder holding its deepest
 * `lib/` or `test/` (where a project keeps its code), after the folders
 * inside that `test/` (a fixture may be a project of its own); where none of
 * those has one, each folder up from the file's own. `first` of them are
 * asked at once, the rest only after.
 */
export const mixFolders = (path: string): { order: string[]; first: number } => {
    const parts = path.split("/").slice(0, -1);
    const at = (k: number) => parts.slice(0, k).join("/");
    const walk = parts.map((_, i) => at(parts.length - i)).concat([""]);
    let deepest = parts.length - 1;
    while (deepest >= 0 && parts[deepest] !== "lib" && parts[deepest] !== "test") deepest--;
    if (deepest < 0) return { order: walk, first: walk.length };
    const first = [...(parts[deepest] === "test" ? walk.slice(0, parts.length - deepest - 1) : []), at(deepest)];
    return { order: [...first, ...walk.filter((d) => !first.includes(d))], first: first.length };
};

/** A call's block: its do-block, or its `do:`. */
const bodyOf = (t: Flat, call: number) => (doBlockOf(t, call) >= 0 ? doBlockOf(t, call) : option(t, call, "do"));

/** The statements of a call's block: its do-block's, or its `do:` value alone. */
const statementsOf = (t: Flat, call: number): number[] => {
    const b = bodyOf(t, call);
    return b < 0 ? [] : t.type[b] === "do_block" ? namedChildren(t, b) : [b];
};

const program: OwnResolver["program"] = (files, ctx) => {
    const elixir = files.map((f): File => ({ units: f.unitByNode, path: f.path, t: f.flat, o: outline(f.flat) }));
    const known = new Set(ctx.known);
    // Read on a board, a file is there or not, or not asked; given whole (a test), what isn't given isn't there.
    const exists = (path: string): boolean | undefined => (known.has(path) ? true : ctx.exists ? ctx.exists(path) : false);
    const mixOf = (dir: string) => (dir ? `${dir}/mix.exs` : "mix.exs");
    const up = (dir: string) => dir.slice(0, Math.max(0, dir.lastIndexOf("/")));
    const nearest = new Map<string, string | null>();
    /** A file's Mix project, the folder of its `mix.exs` (`mixFolders`); null where it isn't known, or a board finds none ("" in a test). */
    const projectOf = (path: string): string | null => {
        const dir = up(path);
        if (!nearest.has(dir)) {
            let found: string | null = ctx.exists ? null : "";
            for (const d of mixFolders(path).order) {
                const there = exists(mixOf(d));
                if (there !== false) {
                    found = there ? d : null;
                    break;
                }
            }
            nearest.set(dir, found);
        }
        return nearest.get(dir)!;
    };
    const byPath = new Map(elixir.map((f) => [f.path, f]));
    const envs = new Map<string, Map<string, string[]> | null>();
    /**
     * The folders a project compiles in each Mix environment, by its
     * `mix.exs`: `elixirc_paths` as a list of strings, or a function of
     * `Mix.env()` whose clauses each name an environment (`""`: any other)
     * and give a list, lists joined by `++` or another environment's
     * (Livebook's); Mix's `lib` where it isn't set. Null where the file
     * says it otherwise: no folder is known compiled in every environment.
     */
    const envsOf = (dir: string): Map<string, string[]> | null => {
        if (envs.has(dir)) return envs.get(dir)!;
        envs.set(dir, null);
        const file = byPath.get(mixOf(dir));
        const out = new Map<string, string[]>([["", ["lib"]]]);
        if (!file) {
            if (ctx.text(mixOf(dir)) === undefined) envs.set(dir, out);
            return envs.get(dir)!;
        }
        const { t, o } = file;
        const mod = o.mods.find((m) => defsNamed(file, m, "project", 0).length === 1);
        const list = mod ? (statementsOf(t, defsNamed(file, mod, "project", 0)[0].node).pop() ?? -1) : -1;
        const value = t.type[list] === "list" ? keyword(t, namedChildren(t, list), "elixirc_paths") : -2;
        const fn = nameOf(t, value);
        // Each clause's environment and list, the first of each environment, none after `_`.
        const clauses = new Map<string, number>();
        if (fn && /^Mix\.env(\(\))?$/.test(textOf(t, argsOf(t, value)[0] ?? value)) && argsOf(t, value).length === 1) {
            for (const d of defsNamed(file, mod!, fn, 1)) {
                const param = argsOf(t, argsOf(t, d.node)[0])[0] ?? -1;
                const env = t.type[param] === "atom" ? textOf(t, param).slice(1) : t.type[param] === "identifier" ? "" : null;
                if (env === null) return null;
                if (!clauses.has("") && !clauses.has(env)) clauses.set(env, statementsOf(t, d.node).length === 1 ? statementsOf(t, d.node)[0] : -1);
            }
        } else if (value !== -1) clauses.set("", value);
        const paths = (n: number, depth: number): string[] | null => {
            if (t.type[n] === "list") {
                const items = namedChildren(t, n);
                return items.every((s) => t.type[s] === "string" && namedChildren(t, s).every((c) => t.type[c] === "quoted_content")) ? items.map((s) => textOf(t, s).slice(1, -1).replace(/\/$/, "")) : null;
            }
            const sides = opOf(t, n) === "++" ? [paths(child(t, n, "left"), depth), paths(child(t, n, "right"), depth)] : null;
            if (sides) return sides[0] && sides[1] && [...sides[0], ...sides[1]];
            const arg = fn && nameOf(t, n) === fn && depth < 4 ? (argsOf(t, n)[0] ?? -1) : -1;
            const body = t.type[arg] === "atom" ? (clauses.get(textOf(t, arg).slice(1)) ?? clauses.get("")) : undefined;
            return body === undefined ? null : paths(body, depth + 1);
        };
        if (value === -2 || (value !== -1 && clauses.size === 0)) return null;
        for (const [env, body] of clauses) {
            const p = paths(body, 0);
            if (!p) return null;
            out.set(env, p);
        }
        if (clauses.size > 0 && !clauses.has("")) out.delete("");
        envs.set(dir, out);
        return out;
    };
    /** The environments a project compiles an `.ex` file in. */
    const compiledIn = (dir: string, path: string): string[] =>
        [...(envsOf(dir) ?? [])].filter(([, paths]) => path.endsWith(".ex") && paths.some((c) => path.startsWith(dir ? `${dir}/${c}/` : `${c}/`))).map(([env]) => env);
    /** A project's own namespaces, which no alias a `use` injects plausibly shadows: its `MixProject` module's first part, its app camelized, and that with `Web`. */
    const rootsOf = (dir: string): Set<string> => {
        const text = ctx.text(mixOf(dir)) ?? "";
        const app = /\bapp:\s*:(\w+)/.exec(text)?.[1].replace(/(^|_)(\w)/g, (_, _u, c: string) => c.toUpperCase());
        return new Set([/defmodule\s+([A-Z]\w*)/.exec(text)?.[1], app, app && `${app}Web`].filter((x): x is string => !!x));
    };
    /**
     * A module name the outline marked `?A.B` (written after a `use` that may
     * alias A): A.B where A is the caller's project's own namespace, which no
     * `use` read in scope aliases; else unknown. (A `use` of a module no file
     * read may alias a project's namespace too: a limit of this reading.)
     */
    const unmark = (from: File, name: string | null, seen: readonly Dir[]): string | null => {
        if (!name?.startsWith("?")) return name;
        const first = name.slice(1).split(".")[0];
        const p = projectOf(from.path);
        const aliased = usesRead(from, seen).some(({ r, which }) => {
            const a = injects(r, which)?.aliases;
            return !a || a.has(first);
        });
        return p !== null && rootsOf(p).has(first) && !aliased ? name.slice(1) : null;
    };
    const STDLIB_APPS = ["elixir", "eex", "ex_unit", "iex", "logger", "mix"].map((app) => `lib/${app}`);
    /**
     * Whether some environment compiles both a caller and an `.ex` file of
     * its Mix project (in elixir-lang/elixir, of any app of the standard
     * library, which every project has). A file the project doesn't compile
     * runs in `test` under `test/`, else in any.
     */
    const reaches = (from: string, to: string): boolean => {
        const p = projectOf(from);
        const envs = p === null ? null : envsOf(p);
        if (!envs) return false;
        const own = compiledIn(p!, from);
        const runs = own.length > 0 ? own : from.startsWith(p ? `${p}/test/` : "test/") ? ["test"] : [...envs.keys()];
        return (STDLIB_APPS.includes(p!) ? STDLIB_APPS : [p!]).some((d) => {
            const at = compiledIn(d, to);
            return runs.some((e) => at.includes(e) || (!envsOf(d)?.has(e) && at.includes("")));
        });
    };

    const fileOf = new Map(files.map((f, i) => [f, elixir[i]]));
    // Every module the files define outside `quote`, by its full name; none defining by a qualified `Kernel.defmodule` (`odd`).
    const index = new Map<string, { file: File; mod: Mod }[]>();
    for (const file of elixir) for (const mod of file.o.mods) if (file.o.fullName(mod) && !file.o.odd(mod)) pushTo(index, file.o.fullName(mod)!, { file, mod });

    /**
     * The one module of a name the files define in the caller's Mix project
     * (its folder, and the folders it compiles: Livebook's `proto/lib`, any
     * file of them a rival), when that one is in the caller's own file or an
     * `.ex` some environment compiles with the caller (`reaches`: an `.exs`
     * script's modules exist where it runs; a copy in an example, a
     * template or a fixture isn't the project's code), or with `scripts`
     * one no environment compiles (a case template a test helper requires).
     */
    const record = (from: File, written: string | null, seen: readonly Dir[], scripts = false) => {
        const name = unmark(from, written, seen);
        const p = projectOf(from.path);
        const folders = p === null ? [] : STDLIB_APPS.includes(p) ? STDLIB_APPS : [p];
        const list = (index.get(name ?? "") ?? []).filter((x) => x.file === from || folders.some((d) => x.file.path.startsWith(d ? `${d}/` : "")) || reaches(from.path, x.file.path));
        const r = list.length === 1 && list[0].mod.kind === "defmodule" ? list[0] : null;
        return r && (r.file === from || reaches(from.path, r.file.path) || (scripts && p !== null && !!envsOf(p) && compiledIn(p, r.file.path).length === 0)) ? r : null;
    };

    const defsNamed = (file: File, m: Mod | null, name: string, arity: number): Def[] => (file.o.defsOf.get(m!)?.get(name) ?? []).filter((d) => d.arities.includes(arity));

    /** The unit a function's definitions of one name and arity make: all of `kinds`, one unit, one of them a statement of its module's body, so the function exists whatever a loop or an `if` around another adds. */
    const unitOf = (file: File, defs: readonly Def[], kinds: ReadonlySet<string>): Unit | null => {
        const units = new Set(defs.map((d) => file.units.get(d.node)));
        const [u] = units;
        return u && units.size === 1 && defs.some((d) => d.definite) && defs.every((d) => kinds.has(d.kind)) ? u : null;
    };

    /** `M.f/n`: a public function of a module read. */
    const remote = (from: File, name: string | null, seen: readonly Dir[], fn: string, arity: number): Unit | null => {
        const r = record(from, name, seen);
        return r && unitOf(r.file, defsNamed(r.file, r.mod, fn, arity), PUBLIC);
    };

    /**
     * Whether the imports of a module in scope give `fn/arity`, read in
     * order: a plain import or `only:` sets what they give (`only: :macros`
     * no function), and `except:` takes from what the import before gave, or
     * from everything (`elixir_import.erl`). Unknown (false) after a `use`
     * (but one of the standard library's that `NO_ALIAS_USE` lists), an
     * import of a module that can't be named, or options not written
     * literally, until an import sets it again: either may import the module.
     * Kernel starts with everything imported. A directive a `use` injects
     * (`injects`) carries its module, `named`.
     */
    const selects = (file: File, seen: readonly Dir[], mod: string, fn: string, arity: number): boolean => {
        // What they give so far: those pairs, or everything but `minus` (no `_` name), or nothing.
        let gives: Set<string> | "all" | null = mod === "Kernel" ? "all" : null;
        let minus = new Set<string>();
        let known = true;
        for (let i = seen.length - 1; i >= 0; i--) {
            const d = seen[i];
            const name = d.named ?? (d.kind === "import" || d.kind === "use" ? file.o.targetOf(d) : undefined);
            if (d.kind === "use" ? !NO_ALIAS_USE.has(name ?? "") : name === null) known = false;
            if (d.kind !== "import" || name !== mod) continue;
            const { only, except } = d;
            if (only !== "all" || except === undefined) {
                gives = only === "all" ? "all" : only === "none" ? null : (only ?? null);
                minus = new Set();
                known = only !== null;
            } else if (!except) known = false;
            else if (gives instanceof Set) gives = new Set<string>([...gives].filter((p: string) => !except.has(p)));
            else {
                minus = gives ? new Set([...minus, ...except]) : new Set(except);
                gives = "all";
            }
        }
        const p = `${fn}/${arity}`;
        return known && (gives === "all" ? !minus.has(p) && !fn.startsWith("_") : !!gives?.has(p));
    };

    /** The module a `use` names, the one a file read defines in the caller's project (null when it can't be told): what may vouch for it. */
    const useRecords = new Map<Dir, { file: File; mod: Mod } | null>();
    const useRecord = (file: File, d: Dir) => {
        if (!useRecords.has(d)) {
            useRecords.set(d, null);
            useRecords.set(d, record(file, file.o.targetOf(d), file.o.visible(d.node, d.start), true));
        }
        return useRecords.get(d)!;
    };
    /** Every definition the files read of a module the `use`s among some directives name, wherever it is, with the atom each `use` passes: what may count against them. The standard library's `NO_ALIAS_USE` don't. */
    const usesRead = (file: File, seen: readonly Dir[]) =>
        seen.flatMap((d) => {
            const used = d.kind === "use" ? (file.o.targetOf(d)?.replace(/^\?/, "") ?? "") : "";
            return NO_ALIAS_USE.has(used) ? [] : (index.get(used) ?? []).map((r) => ({ r, which: whichOf(file.t, d.node) }));
        });

    /** What `use` of ExUnit's modules imports (their `__using__`, read in elixir-lang/elixir), as imports standing where the `use` does. */
    const exunitUse = (d: Dir, used: string): Dir[] | undefined =>
        EXUNIT_USES.get(used)?.split(" ").map((named) => ({ ...d, kind: "import", named, only: named === "ExUnit.Case" ? new Set(["describe/2", "test/1", "test/2", "test/3"]) : "all" }));

    const injections = new Map<Mod, Map<string | null, Injected | null>>();
    /**
     * What `use` of a module read injects, `which` the atom the `use` passes:
     * read from every `defmacro __using__` of the module, at any depth, or
     * for a case template (a statement `use ExUnit.CaseTemplate`) from
     * `use ExUnit.Case` and every `using` block, which must be statements of
     * its body. Each must return a quote (`readQuote`), or for a
     * `__using__(which)` `apply(__MODULE__, which, [])`: then the function
     * the atom names (Phoenix's `use MyAppWeb, :live_view`). Null where one
     * can't be read, or where another `use` in the module may define its
     * `__using__`. Clauses or blocks that differ leave ExUnit's names
     * unknown after them.
     */
    const injects = ({ file, mod }: { file: File; mod: Mod }, which: string | null): Injected | null => {
        let memo = injections.get(mod);
        if (!memo) injections.set(mod, (memo = new Map()));
        if (memo.has(which)) return memo.get(which)!;
        memo.set(which, null);
        const { t, o } = file;
        const body = doBlockOf(t, mod.node);
        let template = false;
        for (const d of o.dirs) {
            const used = d.kind === "use" && o.modAround(d.node) === mod ? (o.targetOf(d) ?? "") : null;
            if (used === "ExUnit.CaseTemplate" && t.parent[d.node] === body && !template) template = true;
            else if (used !== null && (used === "ExUnit.CaseTemplate" || !NO_ALIAS_USE.has(used))) return null;
        }
        const defs = (o.defsOf.get(mod)?.get("__using__") ?? []).filter((d) => d.arities.includes(1));
        const blocks: number[] = [];
        if (template) for (let n = mod.node; n < t.count; n++) if (nameOf(t, n) === "using" && within(t, n, mod.node) && o.modAround(n) === mod && !quoted(t, n, mod.node)) blocks.push(n);
        const ways: Injected[] = [];
        const start = (dirs: Dir[]) => ways[ways.push({ dirs, aliases: new Set() }) - 1];
        const proxy = () => exunitUse(standIn(mod.node, ""), "ExUnit.Case")!;
        if (template) {
            if (defs.length > 0 || blocks.some((n) => t.parent[n] !== body)) return null;
            if (blocks.length === 0) start(proxy());
            for (const n of blocks) if (!returns(file, mod, n, null, start(proxy()))) return null;
        } else if (defs.length === 0 || defs.some((d) => d.kind !== "defmacro" || !returns(file, mod, d.node, which, start([])))) return null;
        const key = (w: Injected) => JSON.stringify([w.dirs.map((d) => [d.kind, d.named, d.only instanceof Set ? [...d.only] : d.only, d.except && [...d.except]]), [...w.aliases]]);
        const one = ways.every((w) => key(w) === key(ways[0]));
        memo.set(which, one ? ways[0] : { dirs: [...ways.flatMap((w) => w.dirs), standIn(mod.node, "")], aliases: new Set(ways.flatMap((w) => [...w.aliases])) });
        return memo.get(which)!;
    };
    /** Reads into `w` what a `__using__` clause or a `using` block returns: a quote, or `apply(__MODULE__, which, [])` of its parameter, the function `which` names. */
    const returns = (file: File, mod: Mod, block: number, which: string | null, w: Injected): boolean => {
        const { t } = file;
        const all = statementsOf(t, block);
        const last = all[all.length - 1] ?? -1;
        if (nameOf(t, last) === "quote") return readQuote(file, mod, last, w, 0);
        const head = argsOf(t, block)[0] ?? -1;
        const param = argsOf(t, opOf(t, head) === "when" ? child(t, head, "left") : head)[0] ?? -1;
        const args = nameOf(t, last) === "apply" && all.length === 1 ? argsOf(t, last) : [];
        const [m, f, a] = args;
        if (!which || args.length !== 3 || textOf(t, m) !== "__MODULE__" || t.type[f] !== "identifier" || t.type[param] !== "identifier" || textOf(t, f) !== textOf(t, param) || textOf(t, a) !== "[]") return false;
        const fns = defsNamed(file, mod, which, 0);
        const q = fns.length === 1 && fns[0].kind === "def" ? (statementsOf(t, fns[0].node).pop() ?? -1) : -1;
        return nameOf(t, q) === "quote" && readQuote(file, mod, q, w, 0);
    };
    /**
     * Reads a quote's statements into `w`, as code the module injects: a
     * directive that names its module directly (as the module reads it at
     * the quote, not through an alias the injected code made), its options
     * one keyword list of data (a `use`'s an atom too); a definition; an
     * attribute holding data; data, and calls of functions on it (`fnCall`:
     * no macro, no `unquote` but `unquote(__MODULE__)`, which may splice a
     * directive); `unquote(f())` of a function of the module returning a
     * quote, read in place. A `use` of a module read is read the same way;
     * of one no file read, kept as it stands. Anything else: false.
     */
    const readQuote = (file: File, mod: Mod, q: number, w: Injected, depth: number): boolean => {
        const { t, o } = file;
        const seen = o.visible(q, t.start[q]);
        const self = (n: number) => textOf(t, n) === "unquote(__MODULE__)";
        const resolve = (segs: string[] | null): string | null => {
            const m = segs && segs[0] !== "__MODULE__" && !w.aliases.has(segs[0]) ? o.moduleName(segs, seen, q) : null;
            return m?.startsWith("?") ? null : m;
        };
        // `M.f(…)`: a function of a module read, or of the standard library's that define no macro; `unquote(__MODULE__).f(…)` the module's own.
        const fnCall = (n: number): boolean => {
            const target = child(t, n, "target");
            const left = t.type[target] === "dot" ? child(t, target, "left") : -1;
            const right = child(t, target, "right");
            const recv = left < 0 ? null : self(left) ? o.fullName(mod) : resolve(segmentsOf(t, left));
            const arity = arityOf(t, n);
            return !!recv && arity !== null && t.type[right] === "identifier" && (FUNCTIONS_ONLY.has(recv) || !!remote(file, recv, seen, textOf(t, right), arity));
        };
        // Code no macro, `unquote` or library operator may turn into a directive: data, and calls of functions on it.
        const data = (n: number): boolean =>
            t.type[n] === "anonymous_function" ||
            nameOf(t, n) === "quote" ||
            self(n) ||
            (!(t.type[n] === "call" && !fnCall(n)) &&
                !(/_operator$/.test(t.type[n]) && CUSTOM_OPS.has(opOf(t, n))) &&
                !(t.type[n] === "sigil" && !KERNEL_SIGILS.has(textOf(t, childOfType(t, n, "sigil_name")))) &&
                namedChildren(t, n).every(data));
        return statementsOf(t, q).every((s) => {
            const name = t.type[s] === "call" ? nameOf(t, s) : null;
            const args = argsOf(t, s);
            const first = args[0] ?? -1;
            if (name === "unquote") {
                const fns = nameOf(t, first) && arityOf(t, first) === 0 && depth < 4 ? defsNamed(file, mod, nameOf(t, first)!, 0) : [];
                const quote = fns.length === 1 && FUNCTIONS.has(fns[0].kind) ? (statementsOf(t, fns[0].node).pop() ?? -1) : -1;
                return nameOf(t, quote) === "quote" && readQuote(file, mod, quote, w, depth + 1);
            }
            if (name === "alias" || name === "require" || name === "import" || name === "use") {
                const opts = args.slice(1);
                const as = option(t, s, "as");
                // A `use` passes its options as code to the `__using__` read; another directive runs them, where an `unquote` may splice one.
                if (opts.length > 1 || (opts[0] !== undefined && !(t.type[opts[0]] === "keywords" && (name === "use" || data(opts[0]))) && !(name === "use" && t.type[opts[0]] === "atom")) || (as >= 0 && t.type[as] !== "alias")) return false;
                // The modules it names: as written, `A.{B, C}`, an Erlang module's atom, the module itself.
                const tuple = t.type[first] === "dot" ? child(t, first, "right") : -1;
                const base = t.type[tuple] === "tuple" ? segmentsOf(t, child(t, first, "left")) : null;
                const mods = self(first) ? [o.fullName(mod)] : t.type[first] === "atom" && /^(import|require)$/.test(name) ? [textOf(t, first)] : (base ? namedChildren(t, tuple).map((c) => segmentsOf(t, c) && [...base, ...segmentsOf(t, c)!]) : [segmentsOf(t, first)]).map(resolve);
                if (mods.some((m) => !m) || (as >= 0 && mods.length > 1)) return false;
                if (name === "alias" || as >= 0) for (const m of mods) w.aliases.add(as >= 0 ? textOf(t, as) : m!.split(".").pop()!);
                // An import whose options read as no pairs (`only: :sigils`) leaves its module's names unknown (`selects`).
                if (name === "import") {
                    const ds = directivesOf(t, s, -1);
                    if (ds.length !== mods.length) return false;
                    w.dirs.push(...ds.map((d, i) => ({ ...d, named: mods[i]! })));
                }
                return name !== "use" || mods.every((used) => {
                    const known = exunitUse(standIn(s, used!), used!);
                    const r = known || NO_ALIAS_USE.has(used!) || !index.has(used!) ? null : record(file, used, seen, true);
                    const inj = r && injects(r, whichOf(t, s));
                    if (r && !inj) return false;
                    w.dirs.push(...(known ?? inj?.dirs ?? (NO_ALIAS_USE.has(used!) ? [] : [standIn(s, used!)])));
                    for (const a of inj?.aliases ?? []) w.aliases.add(a);
                    return known || r || NO_ALIAS_USE.has(used!) || !index.has(used!);
                });
            }
            if ((name && DEFS.has(name)) || /^def(struct|exception|overridable|impl)$/.test(name ?? "")) return true;
            if (opOf(t, s) === "@") {
                const operand = child(t, s, "operand");
                return t.type[operand] !== "call" || TYPESPECS.has(nameOf(t, operand) ?? "") || argsOf(t, operand).every(data);
            }
            return data(s);
        });
    };

    /**
     * Whether Kernel still gives `fn/arity`, a name or an operator: it gives
     * everything, unless an `import Kernel` in scope leaves it out (for
     * another module's), or may (`import :"Elixir.Kernel"`: a module that
     * can't be named), or a `use` of a module read may: one whose quotes
     * import Kernel so, or can't be read (`injects`). (A `use` of a module
     * no file read may too: a limit of this reading.)
     */
    const kernelGives = (file: File, seen: readonly Dir[], fn: string, arity: number): boolean =>
        usesRead(file, seen).every(({ r, which }) => injects(r, which)?.dirs.every((d) => d.kind !== "import" || d.named !== "Kernel" || selects(file, [d], "Kernel", fn, arity))) &&
        (!seen.some((d) => d.kind === "import" && (file.o.targetOf(d) ?? "Kernel") === "Kernel") || selects(file, seen, "Kernel", fn, arity));

    /**
     * Whether ExUnit surely gives `fn/arity` (`test/2`, `assert/1`, …, at an
     * arity ExUnit defines): the imports in scope give it, `use ExUnit.Case`
     * read as the imports its `__using__` makes, and a `use` of a module read
     * (a case template) as those its quotes make (`injects`); any other
     * import giving the name would make the call ambiguous, which fails to
     * compile.
     */
    const exunitGives = (file: File, seen: readonly Dir[], fn: string, arity: number): boolean => {
        const provider = EXUNIT.get(`${fn}/${arity}`);
        if (!provider) return false;
        const read = seen.flatMap((d) => {
            const known = d.kind === "use" ? exunitUse(d, file.o.targetOf(d) ?? "") : [d];
            const r = known ? null : useRecord(file, d);
            const inj = r && injects(r, whichOf(file.t, d.node));
            return known ?? (inj ? [...inj.dirs].reverse() : [d]);
        });
        return selects(file, read, provider, fn, arity);
    };

    /** Whether a call by name surely evaluates its arguments as written by being Kernel's, ExUnit's or a special form. */
    const given = (file: File, seen: readonly Dir[], fn: string, arity: number): boolean =>
        FORMS.has(fn) || (KERNEL.has(fn) && kernelGives(file, seen, fn, arity)) || exunitGives(file, seen, fn, arity);

    /** `f/n` imported: the one public function the imports in scope give, of the modules read; none when one gives a macro of that name. */
    const imported = (file: File, seen: readonly Dir[], fn: string, arity: number): Unit | null => {
        const found = new Set<Unit>();
        // Each module an import in scope names, read where its import stands.
        const mods = new Map<string, Dir>();
        for (const d of seen) if (d.kind === "import" && d.target && file.o.targetOf(d) && !mods.has(file.o.targetOf(d)!)) mods.set(file.o.targetOf(d)!, d);
        for (const [mod, d] of mods) {
            const r = selects(file, seen, mod, fn, arity) ? record(file, mod, file.o.visible(d.node, d.start)) : null;
            const defs = r ? defsNamed(r.file, r.mod, fn, arity).filter((d) => !d.kind.endsWith("p")) : [];
            if (defs.length === 0) continue;
            const u = unitOf(r!.file, defs, PUBLIC);
            if (!u) return null;
            found.add(u);
        }
        return found.size === 1 ? [...found][0] : null;
    };

    /** `f/n` written in a module: in a function, its own definition, else an import's; in the module's body, an import's alone. */
    const local = (file: File, { mod, fun }: Ctx, seen: readonly Dir[], fn: string, arity: number): Unit | null => {
        if (!mod || mod.kind === "defprotocol") return null;
        const own = fun ? defsNamed(file, mod, fn, arity) : [];
        return own.length > 0 ? unitOf(file, own, FUNCTIONS) : imported(file, seen, fn, arity);
    };

    const evaluated = new Map<File, Map<number, boolean>>();
    /** Whether a call, in a function (`fun`) or in a module's body, surely evaluates its arguments as written: a function's, Kernel's, ExUnit's, the standard library's or an Erlang module's; never a macro's or one no file proves. */
    const evaluates = (file: File, call: number, fun: boolean): boolean => {
        let known = evaluated.get(file);
        if (!known) evaluated.set(file, (known = new Map()));
        const key = fun ? call : ~call;
        if (known.has(key)) return known.get(key)!;
        const { t, o } = file;
        const target = child(t, call, "target");
        const arity = arityAt(t, call);
        const left = child(t, target, "left");
        const right = child(t, target, "right");
        const segs = segmentsOf(t, left);
        const name = textOf(t, target);
        let yes = false;
        if (arity !== null && t.type[target] === "identifier") {
            const own = fun ? defsNamed(file, o.modAround(call), name, arity) : [];
            const seen = o.visible(call, t.start[call]);
            yes = own.length > 0 ? !!unitOf(file, own, FUNCTIONS) : given(file, seen, name, arity) || !!imported(file, seen, name, arity);
        } else if (arity !== null && t.type[target] === "dot") {
            // `fun.(x)`, `mod.f(x)`, `:ets.insert(…)`: no macro is called through a value or an Erlang module.
            const seen = o.visible(call, t.start[call]);
            const mod = segs && right >= 0 ? unmark(file, o.moduleName(segs, seen, call), seen) : null;
            const root = mod?.split(".")[0] ?? "";
            const fn = right >= 0 ? textOf(t, right) : "";
            // Kernel's own calls, `Kernel.++(…)`, evaluate as written; not `Kernel.SpecialForms.quote(…)` nor `IEx.Helpers.h(…)`.
            const data = CODE_AS_DATA.has(root) && !(mod === "Kernel" && (KERNEL.has(fn) || KERNEL_OPS.has(fn)));
            yes = !segs || right < 0 ? t.type[left] !== "alias" : index.has(mod ?? "") ? !!remote(file, mod, seen, fn, arity) : STDLIB.has(root) && !data;
        }
        known.set(key, yes);
        return yes;
    };

    /**
     * Where the code at a node runs, walking out from it: null where it isn't
     * code its module runs as written (a template, a typespec, a custom
     * sigil, the arguments of a call that may be a macro, `defguard`'s and
     * `defn`'s bodies), else its module and whether in a function. What
     * `unquote` holds runs where its quote is built (`unquotes`): the
     * template around it is skipped.
     */
    const contextOf = (file: File, from: number): Ctx | null => {
        const { t, o } = file;
        if (o.odd(o.modAround(from))) return null;
        let mod: Mod | null = null;
        let unquoted = false;
        let fun: boolean | null = null;
        // The calls around the node, whose arguments must run as written, each with whether it runs in a function; those not placed yet.
        const calls: [number, boolean][] = [];
        let pending: number[] = [];
        const place = (inFun: boolean) => {
            for (const c of pending) calls.push([c, inFun]);
            pending = [];
            fun ??= inFun;
        };
        for (let n = t.parent[from], prev = from; n >= 0; prev = n, n = t.parent[n]) {
            // A custom sigil; the right of `::`, a type in a typespec or a bitstring's segment (`<<x::size(8)>>`).
            if (!unquoted && ((t.type[n] === "sigil" && !KERNEL_SIGILS.has(textOf(t, childOfType(t, n, "sigil_name")))) || (t.field[prev] === "right" && opOf(t, n) === "::"))) return null;
            // A library's operator (`~>`) may read its operands as anything; so may one in Kernel's place, where an `import Kernel` leaves Kernel's out.
            if (!unquoted && /_operator$/.test(t.type[n])) {
                const op = opOf(t, n).replace(/\s+/g, " ").replace("not in", "in");
                if (CUSTOM_OPS.has(op) || (KERNEL_OPS.has(op) && !kernelGives(file, o.visible(n, t.start[n]), op, t.type[n] === "binary_operator" ? 2 : 1))) return null;
            }
            if (t.type[n] !== "call" || t.field[prev] === "target") continue;
            const name = nameOf(t, n) ?? "";
            const kind = defKind(t, n);
            if (name === "quote") {
                if (!within(t, from, bodyOf(t, n))) continue;
                if (!unquoted || !unquotes(t, n)) return null;
                unquoted = false;
            } else if (unquoted) continue;
            else if (name === "unquote" || name === "unquote_splicing") unquoted = true;
            else if (o.modAt.has(n)) {
                place(false);
                mod ??= o.modAt.get(n)!;
            } else if (kind && !BODIES.has(kind)) return null;
            else if (kind) place(true);
            // `@doc "…#{f()}"` runs in the module's body; `@spec f(t) :: t` writes types.
            else if (opOf(t, t.parent[n]) === "@") {
                if (TYPESPECS.has(name)) return null;
            } else {
                // ExUnit's `test`, `setup` and `setup_all` make their block a function of the module.
                if (TEST_BODIES.has(name) && within(t, from, bodyOf(t, n)) && exunitGives(file, o.visible(n, t.start[n]), name, arityAt(t, n) ?? -1)) place(true);
                pending.push(n);
            }
        }
        place(false);
        return unquoted || calls.some(([c, inFun]) => !evaluates(file, c, inFun)) ? null : { mod, fun: fun! };
    };

    /** `defdelegate f(a), to: M, as: :g`: M.g/1, the call the delegate makes. */
    const delegate = (file: File, n: number): Unit | null => {
        const { t, o } = file;
        const call = delegateOf(t, n);
        if (o.odd(o.modAround(call))) return null;
        const segs = segmentsOf(t, option(t, call, "to"));
        const as = option(t, call, "as");
        const name = as < 0 ? o.defAt.get(call)?.name : t.type[as] === "atom" ? textOf(t, as).slice(1) : "";
        if (!o.defAt.has(call) || !segs || !name) return null;
        const seen = o.visible(call, t.start[call]);
        return remote(file, o.moduleName(segs, seen, call), seen, name, Math.max(...headOf(t, call)!.arities));
    };

    /** `import M, only: [f: 1]`'s entry `f: 1`: M's public function f/1, where the import is code its module runs. */
    const importEntry = (file: File, n: number, fn: string): Unit | null => {
        const { t, o } = file;
        const value = child(t, t.parent[n], "value");
        // `import A.{B, C}, only: […]` names two modules: neither.
        const ds = o.dirs.filter((d) => d.kind === "import" && within(t, n, d.node));
        return ds.length === 1 && t.type[value] === "integer" && contextOf(file, ds[0].node) ? remote(file, o.targetOf(ds[0]), o.visible(ds[0].node, ds[0].start), fn, Number(textOf(t, value))) : null;
    };

    /** What a site names: a call `f(…)`, `M.f(…)`, `x |> f`; a capture `&f/2`, `&M.f/2`; a delegate's `to:`; an import's `only:` entry. */
    const resolveSite = (file: File, s: GSite): { ref: "call" | "value" | "import"; unit: Unit | null } => {
        const { t, o } = file;
        const n = s.node;
        if (s.ref === "import") return { ref: "import", unit: importEntry(file, n, s.name) };
        if (t.type[n] === "alias" || s.name === "__MODULE__") return { ref: "call", unit: delegate(file, n) };
        const p = t.parent[n];
        const remoteCall = t.type[p] === "dot" ? t.parent[p] : -1;
        const call = remoteCall >= 0 ? remoteCall : p;
        // `&f/2`, and `&M.f/2`: `M.f` with no argument list, left of the `/`.
        const slash = remoteCall >= 0 ? t.parent[call] : p;
        const capture = (remoteCall < 0 || (t.field[call] === "left" && childOfType(t, call, "arguments") < 0)) && captured(t, slash) !== null;
        const arity = capture ? captured(t, slash) : t.type[call] === "call" ? arityAt(t, call) : opOf(t, p) === "|>" ? 1 : null;
        const ctx = arity === null ? null : contextOf(file, capture ? t.parent[slash] : t.type[call] === "call" ? call : n);
        const ref = capture ? "value" : "call";
        if (!ctx) return { ref, unit: null };
        const seen = o.visible(n, t.start[n]);
        if (remoteCall < 0) return { ref, unit: local(file, ctx, seen, s.name, arity!) };
        const segs = segmentsOf(t, child(t, p, "left"));
        const mod = segs && unmark(file, o.moduleName(segs, seen, n), seen);
        // In a module's body, the module and those around it aren't compiled yet.
        for (let m = ctx.fun ? null : ctx.mod; m; m = m.parent) if (o.fullName(m) === mod) return { ref, unit: null };
        return { ref, unit: remote(file, mod, seen, s.name, arity!) };
    };

    // A site reaches only a unit of its own name; a `defdelegate`'s `to:` its target.
    const names = new Set(files.flatMap((f) => f.units.map((u) => u.name)));
    return (f, s) => {
        const file = fileOf.get(f)!;
        if (!names.has(s.name) && file.t.type[s.node] !== "alias" && s.name !== "__MODULE__") return [];
        const { ref, unit } = resolveSite(file, s);
        return unit ? [{ ref, units: [unit] }] : [];
    };
};

export const ELIXIR_RESOLVER: OwnResolver = { program };
