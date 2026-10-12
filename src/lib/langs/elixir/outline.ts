/**
 * What an Elixir file holds, read from its syntax once: its modules, the
 * functions and macros each defines, its directives (`alias`, `require`,
 * `import`, `use`) with the code each reaches, and what a module name
 * written in it means there. Code inside `quote` is a template for another
 * module: none of it is read here.
 *
 * Aliases are lexical: a directive reaches the statements after it in its
 * block, and blocks inside those. A nested `defmodule A.B` (or `defprotocol`)
 * aliases A for the code after it and in its own body. `use M` may inject
 * aliases: after one, a name aliased before it and a one-part name no alias
 * binds (`Repo`, the kind a `use` aliases; the standard library's `Enum`
 * aside) are unknown, and a name in full is marked `?Accounts.User` (its
 * first part may be such an alias), unless M is a standard-library module
 * whose `__using__` injects none.
 */

import { pushTo } from "../../fp.ts";
import { child, namedChildren, perTree, textOf, type Flat } from "../../syntax.ts";
import { NO_ALIAS_USE, STDLIB, TYPESPECS } from "./names.ts";
import { argsOf, DEFS, defKind, doBlockOf, headOf, MODULES, nameOf, opOf, option, SCOPES, segmentsOf, SUB_BLOCKS } from "./nodes.ts";

export type Mod = {
    /** The `defmodule`, `defprotocol` or `defimpl` call. */
    node: number;
    kind: string;
    /** Its name as written (`A.B`, `__MODULE__.B`; a `defimpl`'s protocol), or null when computed (`defmodule unquote(x)`). */
    written: string[] | null;
    /** The module around it, whose name a nested name starts with. */
    parent: Mod | null;
};

export type Def = {
    node: number;
    name: string;
    arities: number[];
    /** `def`, `defp`, `defmacro`, …. */
    kind: string;
    mod: Mod;
    /** A statement of its module's body, so it is part of the module whatever runs: not one inside `if`, a loop or another macro's block. */
    definite: boolean;
};

/** A directive: the code after it in its scope node sees it. */
export type Dir = {
    kind: string;
    node: number;
    scope: number;
    start: number;
    end: number;
    /** The name an alias binds: `alias A.B` binds B. */
    as?: string;
    /** The module as written; null when no alias names it (an atom, a variable). */
    target: string[] | null;
    /** The module a nested `defmodule` names, for its alias. */
    mod?: Mod;
    /** An import's `only:`: the `name/arity` pairs, everything, or no function; null when not written literally. */
    only?: Set<string> | "all" | "none" | null;
    /** An import's `except:`, the pairs it takes from what the import before it gave; null when not written literally. */
    except?: Set<string> | null;
    /** The module a directive a `use` injects names (`use ExUnit.Case` imports ExUnit.Assertions), read where the `use` is; "" where it can't be read. */
    named?: string;
};

export type Outline = {
    mods: Mod[];
    modAt: Map<number, Mod>;
    defAt: Map<number, Def>;
    /** Each module's definitions by name. */
    defsOf: Map<Mod, Map<string, Def[]>>;
    dirs: Dir[];
    /** The directives a node sees at an offset, latest first. */
    visible: (n: number, at: number) => Dir[];
    /** A module's full name, or null when the file can't tell it. */
    fullName: (m: Mod) => string | null;
    /** The module an alias binds its name to, or a `use` or an `import` names. */
    targetOf: (d: Dir) => string | null;
    /** A module written `A.B` or `__MODULE__.B` at a node, given the directives it sees. */
    moduleName: (segs: readonly string[], seen: readonly Dir[], n: number) => string | null;
    /** The module construct a node sits in, innermost; null at a file's top level. */
    modAround: (n: number) => Mod | null;
    /** Whether a module, or one around it, defines with a qualified `Kernel.defmodule`, `Kernel.def`, …, which this outline doesn't read (null: the file's top level does): no name in it is known. */
    odd: (m: Mod | null) => boolean;
};

/** A literal `[f: 1, g: 2]` as `f/1` and `g/2`; null for anything else. */
const pairs = (t: Flat, list: number): Set<string> | null => {
    if (t.type[list] !== "list") return null;
    const out = new Set<string>();
    for (const kws of namedChildren(t, list)) {
        if (t.type[kws] !== "keywords") return null;
        for (const p of namedChildren(t, kws)) {
            const v = child(t, p, "value");
            if (t.type[v] !== "integer") return null;
            out.add(`${textOf(t, child(t, p, "key")).replace(/:\s*$/, "")}/${textOf(t, v)}`);
        }
    }
    return out;
};

/** A directive's directives: `alias A.{B, C}` is one per module; `alias :ets, as: E` binds E to no module; `require` binds a name only with `as:`. */
export const directivesOf = (t: Flat, call: number, scope: number): Dir[] => {
    const kind = nameOf(t, call) ?? "";
    const first = argsOf(t, call)[0];
    if (!/^(alias|require|import|use)$/.test(kind) || first === undefined) return [];
    const at = { kind, node: call, scope, start: t.start[call], end: t.end[call] };
    // `import :lists` names an Erlang module, which imports nothing of an Elixir one.
    let targets: (string[] | null)[] = [segmentsOf(t, first) ?? (t.type[first] === "atom" ? [textOf(t, first)] : null)];
    if (t.type[first] === "dot" && t.type[child(t, first, "right")] === "tuple") {
        const base = segmentsOf(t, child(t, first, "left"));
        targets = namedChildren(t, child(t, first, "right")).map((c) => (base && segmentsOf(t, c) ? [...base, ...segmentsOf(t, c)!] : null));
    }
    const as = option(t, call, "as");
    if (kind === "import") {
        const only = option(t, call, "only");
        const except = option(t, call, "except");
        const word = t.type[only] === "atom" ? textOf(t, only) : "";
        // Options not written as one keyword list (`import M, [only: …]`) can't be read.
        // `only: :sigils` gives the sigils' functions, which no reading here follows (`except:` after it takes from them).
        const sel = argsOf(t, call).slice(1).some((a) => t.type[a] !== "keywords") ? null : only < 0 || word === ":functions" ? "all" : word === ":macros" ? "none" : word ? null : pairs(t, only);
        return targets.map((target) => ({ ...at, target, only: sel, ...(except >= 0 ? { except: pairs(t, except) } : {}) }));
    }
    if (kind === "use") return targets.map((target) => ({ ...at, target }));
    if (as >= 0) return targets.length === 1 && t.type[as] === "alias" ? [{ ...at, as: textOf(t, as), target: targets[0] }] : [];
    return kind === "alias" ? targets.flatMap((target) => (target ? [{ ...at, as: target[target.length - 1], target }] : [])) : [];
};

/** Whether a call named like a directive is none: a definition's head (`defmacro use(module, opts)`), or in a typespec (`@spec import(t) :: t`). Another attribute's value is code: `@mod alias(Foo.Bar)` aliases. */
const notDirective = (t: Flat, n: number): boolean => {
    for (let x = t.parent[n]; x >= 0 && !SCOPES.has(t.type[x]); x = t.parent[x]) {
        if ((opOf(t, x) === "@" && TYPESPECS.has(nameOf(t, child(t, x, "operand")) ?? "")) || (defKind(t, x) && t.parent[headOf(t, x)!.name] === n)) return true;
    }
    return false;
};

const outlineOf = (t: Flat): Outline => {
    const mods: Mod[] = [];
    const modAt = new Map<number, Mod>();
    const defAt = new Map<number, Def>();
    const defsOf = new Map<Mod, Map<string, Def[]>>();
    const dirs: Dir[] = [];
    // `M.defmodule(…)`, `M.def(…)`: Kernel's, unless M names another module.
    const qualified: number[] = [];
    const visit = (n: number, mod: Mod | null) => {
        const kind = t.type[n] === "call" ? nameOf(t, n) : null;
        // A template for other modules: nothing in it is this file's.
        if (kind === "quote") return;
        const target = t.type[n] === "call" ? child(t, n, "target") : -1;
        const right = t.type[target] === "dot" ? child(t, target, "right") : -1;
        const defines = right >= 0 ? textOf(t, right) : "";
        if (DEFS.has(defines) || MODULES.has(defines) || /^(use|def(struct|exception|overridable))$/.test(defines)) qualified.push(n);
        const scope = t.parent[n];
        let ds: Dir[] = [];
        if (kind && MODULES.has(kind)) {
            const written = segmentsOf(t, argsOf(t, n)[0] ?? -1);
            const m: Mod = { node: n, kind, written, parent: mod };
            mods.push(m);
            modAt.set(n, m);
            // `defprotocol` is a `defmodule` too; `defimpl` computes its name, which aliases nothing.
            if (kind !== "defimpl" && mod && written && !/^(__MODULE__|Elixir)$/.test(written[0])) {
                ds = [{ kind: "nested", node: n, scope, start: t.start[n], end: t.start[n], as: written[0], target: written, mod: m }];
            }
            mod = m;
        } else if (kind && mod && defKind(t, n)) {
            const head = headOf(t, n)!;
            const d: Def = { node: n, name: textOf(t, head.name), arities: head.arities, kind, mod, definite: scope === doBlockOf(t, mod.node) };
            defAt.set(n, d);
            let m = defsOf.get(mod);
            if (!m) defsOf.set(mod, (m = new Map()));
            pushTo(m, d.name, d);
        } else if (kind && !notDirective(t, n)) ds = directivesOf(t, n, scope);
        // A nested module's alias reaches its own body; a directive in parentheses or arguments may reach the code after them, where its names are unknown.
        let s = scope;
        while (ds.length > 0 && s >= 0 && (t.type[s] === "block" || !SCOPES.has(t.type[s]))) s = t.parent[s];
        for (const d of ds) {
            if (SCOPES.has(t.type[scope])) dirs.push(d);
            else if (d.kind === "nested") dirs.push({ ...d, scope: doBlockOf(t, n) });
            if (s !== scope && s >= 0) dirs.push({ ...d, kind: d.kind === "nested" ? "alias" : d.kind, scope: s, end: t.end[n], target: null });
        }
        for (let c = t.first[n]; c >= 0; c = t.next[c]) visit(c, mod);
    };
    visit(0, null);

    const dirsIn = new Map<number, Dir[]>();
    for (const d of dirs) pushTo(dirsIn, d.scope, d);
    const visible = (n: number, at: number): Dir[] => {
        const out: Dir[] = [];
        for (let s = t.parent[n], prev = n; s >= 0; prev = s, s = t.parent[s]) {
            const ds = dirsIn.get(s);
            if (!ds || SUB_BLOCKS.has(t.type[prev])) continue;
            for (let i = ds.length - 1; i >= 0; i--) if (ds[i].end <= at) out.push(ds[i]);
        }
        return out;
    };
    const modAround = (n: number): Mod | null => {
        for (let x = t.parent[n]; x >= 0; x = t.parent[x]) if (modAt.has(x)) return modAt.get(x)!;
        return null;
    };
    const join = (base: string | null, rest: readonly string[]) => (base ? [base, ...rest].join(".") : null);

    const names = new Map<Mod, string | null>();
    // Nested in another, the outer's name and its own as written (`Kernel.defmodule`); at the top, its alias expanded.
    const fullName = (m: Mod): string | null => {
        if (names.has(m)) return names.get(m)!;
        names.set(m, null);
        const w = m.written;
        let name: string | null = null;
        if (m.kind !== "defimpl" && w) {
            if (w[0] === "Elixir") name = join(w[1] ?? null, w.slice(2));
            else if (w[0] === "__MODULE__") name = join(m.parent && fullName(m.parent), w.slice(1));
            else if (m.parent) name = join(fullName(m.parent), w);
            else name = moduleName(w, visible(m.node, t.start[m.node]), m.node);
        }
        names.set(m, name);
        return name;
    };
    // `alias __MODULE__` binds the module's last part.
    const asOf = (d: Dir) => {
        const m = d.as === "__MODULE__" ? modAround(d.node) : null;
        return m ? fullName(m)?.split(".").pop() : d.as;
    };

    const targets = new Map<Dir, string | null>();
    const targetOf = (d: Dir): string | null => {
        if (!targets.has(d)) {
            targets.set(d, null);
            targets.set(d, d.kind === "nested" ? join(d.mod!.parent && fullName(d.mod!.parent), [d.as!]) : d.target && moduleName(d.target, visible(d.node, d.start), d.node));
        }
        return targets.get(d)!;
    };
    const opaque = (d: Dir) => !NO_ALIAS_USE.has(targetOf(d) ?? "");

    // The first part through the latest alias of it, unless a `use` came between; with no alias, as written, unless a `use` came before and it is one part, not the standard library's.
    const moduleName = (segs: readonly string[], seen: readonly Dir[], n: number): string | null => {
        if (segs[0] === "Elixir") return join(segs[1] ?? null, segs.slice(2));
        if (segs[0] === "__MODULE__") {
            const m = modAround(n);
            return join(m && fullName(m), segs.slice(1));
        }
        let afterUse = false;
        for (const d of seen) {
            if (d.kind === "use") afterUse ||= opaque(d);
            else if (d.as !== undefined && asOf(d) === segs[0]) return afterUse ? null : join(targetOf(d), segs.slice(1));
        }
        // After such a `use`, a name in full may start with a name it aliases: marked `?`, for the resolver to take only from the project's own namespace.
        return !afterUse || STDLIB.has(segs[0]) ? segs.join(".") : segs.length < 2 ? null : `?${segs.join(".")}`;
    };

    const odds = new Set<Mod | null>();
    for (const n of qualified) {
        const segs = segmentsOf(t, child(t, child(t, n, "target"), "left"));
        const m = segs && moduleName(segs, visible(n, t.start[n]), n);
        if (!m || m === "Kernel" || m.startsWith("?")) odds.add(modAround(n));
    }
    const odd = (m: Mod | null): boolean => odds.has(null) || (!!m && (odds.has(m) || odd(m.parent)));
    return { mods, modAt, defAt, defsOf, dirs, visible, fullName, targetOf, moduleName, modAround, odd };
};

export const outline = perTree(outlineOf);
