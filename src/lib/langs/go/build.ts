/**
 * Go's build constraints, as go/build reads them: a declaration links only
 * from code whose build always holds its file (GOOS and GOARCH suffixes,
 * `//go:build` and `// +build` lines).
 */

import type { Flat } from "../../syntax.ts";

const GOOS = new Set("aix android darwin dragonfly freebsd hurd illumos ios js linux nacl netbsd openbsd plan9 solaris wasip1 windows zos".split(" "));
const GOARCH = new Set("386 amd64 amd64p32 arm armbe arm64 arm64be loong64 mips mipsle mips64 mips64le mips64p32 mips64p32le ppc ppc64 ppc64le riscv riscv64 s390 s390x sparc sparc64 wasm".split(" "));
const UNIX = new Set("aix android darwin dragonfly freebsd hurd illumos ios linux netbsd openbsd solaris".split(" "));

/** A build constraint: tags joined by `!`, `&&` and `||`. */
type Expr = { op: "tag"; tag: string } | { op: "not"; x: Expr } | { op: "and"; a: Expr; b: Expr } | { op: "or"; a: Expr; b: Expr };

/** A `//go:build` expression, or null when it doesn't parse. */
const parseExpr = (src: string): Expr | null => {
    const tokens = src.match(/!|&&|\|\||\(|\)|[\w.]+/g) ?? [];
    let at = 0;
    const or = (): Expr | null => {
        let a = and();
        while (a && tokens[at] === "||") {
            at++;
            const b = and();
            a = b ? { op: "or", a, b } : null;
        }
        return a;
    };
    const and = (): Expr | null => {
        let a = not();
        while (a && tokens[at] === "&&") {
            at++;
            const b = not();
            a = b ? { op: "and", a, b } : null;
        }
        return a;
    };
    const not = (): Expr | null => {
        if (tokens[at] === "!") {
            at++;
            const x = not();
            return x ? { op: "not", x } : null;
        }
        if (tokens[at] === "(") {
            at++;
            const x = or();
            return tokens[at++] === ")" ? x : null;
        }
        const tag = tokens[at++];
        return tag && /^[\w.]+$/.test(tag) ? { op: "tag", tag } : null;
    };
    const e = or();
    return e && at === tokens.length ? e : null;
};

const all = (xs: Expr[]): Expr | null => xs.reduce<Expr | null>((a, b) => (a ? { op: "and", a, b } : b), null);

/**
 * A file's build constraint, as go/build reads it: its name's `_GOOS`,
 * `_GOARCH` or `_GOOS_GOARCH` before its first dot (a `_test` aside, so
 * `types_linux.pb.go` is linux's), and its `//go:build` line, else its
 * `// +build` lines, above the package clause. Null when it has none;
 * "unknown" when a line doesn't parse.
 */
const constraintOf = (path: string, text: string): Expr | null | "unknown" => {
    const terms: Expr[] = [];
    const base = path.split("/").pop() ?? "";
    const name = base.includes(".") ? base.slice(0, base.indexOf(".")) : base;
    const under = name.indexOf("_");
    if (under >= 0) {
        const l = name.slice(under).split("_");
        if (l[l.length - 1] === "test") l.pop();
        const n = l.length;
        if (n >= 2 && GOOS.has(l[n - 2]) && GOARCH.has(l[n - 1])) terms.push({ op: "tag", tag: l[n - 2] }, { op: "tag", tag: l[n - 1] });
        else if (n >= 1 && (GOOS.has(l[n - 1]) || GOARCH.has(l[n - 1]))) terms.push({ op: "tag", tag: l[n - 1] });
    }
    const header = text.slice(0, Math.max(0, text.search(/^\s*package\s/m)));
    const goBuild = /^\/\/go:build\s+(.+)$/m.exec(header);
    let unknown = false;
    if (goBuild) {
        const e = parseExpr(goBuild[1].trim());
        if (e) terms.push(e);
        else unknown = true;
    } else {
        for (const m of header.matchAll(/^\/\/\s*\+build\s+(.+)$/gm)) {
            // `a,b c`: (a && b) || c.
            const options = m[1].trim().split(/\s+/).map((o) => all(o.split(",").map((term) => (term.startsWith("!") ? { op: "not" as const, x: { op: "tag" as const, tag: term.slice(1) } } : { op: "tag" as const, tag: term }))));
            const line = options.reduce<Expr | null>((a, b) => (a && b ? { op: "or", a, b } : (a ?? b)), null);
            if (line) terms.push(line);
        }
    }
    return unknown ? "unknown" : all(terms);
};

/** A parsed file's build constraint, once per tree: a cache keyed by path would outlive the review that read it. */
const constraints = new WeakMap<Flat, Expr | null | "unknown">();
const constraintOfFile = (f: { path: string; flat: Flat }): Expr | null | "unknown" => {
    if (!constraints.has(f.flat)) constraints.set(f.flat, constraintOf(f.path, f.flat.text));
    return constraints.get(f.flat)!;
};

const tagsOf = (e: Expr, out = new Set<string>()): Set<string> => {
    if (e.op === "tag") out.add(e.tag);
    else if (e.op === "not") tagsOf(e.x, out);
    else {
        tagsOf(e.a, out);
        tagsOf(e.b, out);
    }
    return out;
};

type Env = { goos: string; goarch: string; on: ReadonlySet<string> };
const holds = (e: Expr, env: Env): boolean => {
    if (e.op === "not") return !holds(e.x, env);
    if (e.op === "and" || e.op === "or") return e.op === "and" ? holds(e.a, env) && holds(e.b, env) : holds(e.a, env) || holds(e.b, env);
    const tag = e.tag;
    if (GOOS.has(tag)) return tag === env.goos || (tag === "linux" && env.goos === "android") || (tag === "solaris" && env.goos === "illumos") || (tag === "darwin" && env.goos === "ios");
    if (GOARCH.has(tag)) return tag === env.goarch;
    if (tag === "unix") return UNIX.has(env.goos);
    if (/^go1\.\d+$/.test(tag)) return true;
    return env.on.has(tag);
};

/** Every build the tags allow: each GOOS and GOARCH, and each choice of the other tags, at most six of them. */
const builds = (exprs: Expr[]): Env[] | null => {
    const free = [...new Set(exprs.flatMap((e) => [...tagsOf(e)]))].filter((t) => !GOOS.has(t) && !GOARCH.has(t) && t !== "unix" && !/^go1\.\d+$/.test(t));
    if (free.length > 6) return null;
    const out: Env[] = [];
    for (const goos of GOOS) {
        for (const goarch of GOARCH) {
            for (let mask = 0; mask < 1 << free.length; mask++) out.push({ goos, goarch, on: new Set(free.filter((_, i) => mask & (1 << i))) });
        }
    }
    return out;
};

/** Whether every build that holds one file holds the other too: then a declaration there is the one this file's code sees. Kept per pair of trees. */
const reachCache = new WeakMap<Flat, WeakMap<Flat, boolean>>();
export const reaches = (from: { path: string; flat: Flat }, to: { path: string; flat: Flat }): boolean => {
    if (from.path === to.path) return true;
    const target = constraintOfFile(to);
    if (target === null) return true;
    const source = constraintOfFile(from);
    if (target === "unknown" || source === "unknown") return false;
    let byTarget = reachCache.get(from.flat);
    if (!byTarget) reachCache.set(from.flat, (byTarget = new WeakMap()));
    let hit = byTarget.get(to.flat);
    if (hit === undefined) {
        const envs = builds(source ? [source, target] : [target]);
        hit = envs !== null && envs.every((env) => (source ? !holds(source, env) : false) || holds(target, env));
        byTarget.set(to.flat, hit);
    }
    return hit;
};

/** Whether no build holds a file: `//go:build ignore` and the like. */
export const ignored = (path: string, text: string): boolean => {
    const c = constraintOf(path, text);
    if (c === null) return false;
    if (c === "unknown") return true;
    const envs = builds([c]);
    return envs === null ? false : envs.every((env) => env.on.has("ignore") || !holds(c, env));
};
