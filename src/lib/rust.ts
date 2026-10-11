/**
 * Rust calls that hold without types, inside one file and one module (the
 * file, or an inline `mod x { … }`):
 * - `f(` names the one function `f` the module declares, when the caller
 *   binds nothing else called `f`;
 * - `self.f(` and `Self::f(` inside an impl of `T`, and `T::f(` for a type
 *   `T` the module declares or implements, name `T`'s one inherent `f`:
 *   inherent methods win over trait methods, and a type has one inherent `f`.
 * Comments and literals are blanked first. Anything else (a method on any
 * other receiver, a path through another module, a trait method, a glob
 * import) proves nothing and makes no link.
 */

import type { Decl } from "./symbols.ts";

/** The text with comments and literals turned to spaces, lines and columns kept; lifetimes stay. */
export const codeOnly = (text: string): string => {
    const out = text.split("");
    const n = text.length;
    const blank = (from: number, to: number) => {
        for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " ";
    };
    const wordBefore = (i: number) => /[A-Za-z0-9_]/.test(text[i - 1] ?? "");
    let i = 0;
    while (i < n) {
        const c = text[i];
        const next = text[i + 1];
        if (c === "/" && next === "/") {
            const end = text.indexOf("\n", i);
            const stop = end < 0 ? n : end;
            blank(i, stop);
            i = stop;
        } else if (c === "/" && next === "*") {
            // Block comments nest in Rust.
            let depth = 1;
            let k = i + 2;
            while (k < n && depth > 0) {
                if (text[k] === "/" && text[k + 1] === "*") (depth++, (k += 2));
                else if (text[k] === "*" && text[k + 1] === "/") (depth--, (k += 2));
                else k++;
            }
            blank(i, k);
            i = k;
        } else if ((c === "r" || c === "b" || c === "c") && !wordBefore(i) && /^(?:[bc]?r)(#*)"/.test(text.slice(i, i + 40))) {
            const hashes = /^(?:[bc]?r)(#*)"/.exec(text.slice(i, i + 40))![1];
            const open = text.indexOf('"', i) + 1;
            const end = text.indexOf(`"${hashes}`, open);
            const stop = end < 0 ? n : end + 1 + hashes.length;
            blank(i, stop);
            i = stop;
        } else if (c === '"' || ((c === "b" || c === "c") && next === '"' && !wordBefore(i))) {
            let k = c === '"' ? i + 1 : i + 2;
            while (k < n && text[k] !== '"') k += text[k] === "\\" ? 2 : 1;
            blank(i, k + 1);
            i = k + 1;
        } else if (c === "'" || (c === "b" && next === "'" && !wordBefore(i))) {
            const at = c === "'" ? i : i + 1;
            // A char literal; anything else after `'` is a lifetime or a label.
            const m = /^'(?:\\(?:u\{[0-9A-Fa-f_]+\}|x[0-9A-Fa-f]{2}|.)|[^'\\\n])'/u.exec(text.slice(at, at + 16));
            const stop = m ? at + m[0].length : i + 1;
            if (m) blank(i, stop);
            i = stop;
        } else i++;
    }
    return out.join("");
};

const indentOf = (line: string) => /^[ \t]*/.exec(line)![0].replace(/\t/g, "    ").length;

/** A module of the file: the file itself (id 0), or an inline `mod x { … }`, with the indent of its items. */
type Scope = { id: number; start: number; end: number; items: number };

/** An impl block: its self type's last path segment, whether it is inherent (no trait), and its module. */
type Impl = { start: number; end: number; type: string; inherent: boolean; scope: number; header: string };

const KEYWORDS = new Set(["if", "while", "for", "match", "return", "loop", "fn", "let", "in", "as", "move", "unsafe", "async", "await", "impl", "where", "mut", "ref", "else", "break", "continue", "dyn", "yield", "Some", "Ok", "Err", "None"]);

/** One call-shaped site: `f(`, `f::<T>(`, with what comes right before the name. */
type Site = { line: number; name: string; via: "bare" | "self" | "Self" | "type" | "other"; type?: string };

const CALL = /([A-Za-z_][A-Za-z0-9_]*)\s*(?:::\s*<[^()]*?>\s*)?\(/g;

const sitesOn = (line: string, n: number): Site[] => {
    const sites: Site[] = [];
    for (const m of line.matchAll(CALL)) {
        const name = m[1];
        if (KEYWORDS.has(name)) continue;
        const before = line.slice(0, m.index).replace(/\s+$/, "");
        if (/\b(fn|struct|enum|union|trait|type|mod|impl|dyn)$/.test(before)) continue;
        if (before.endsWith(".")) {
            sites.push({ line: n, name, via: /(?:^|[^\w.])self\s*\.$/.test(before) ? "self" : "other" });
        } else if (before.endsWith("::")) {
            const q = /(^|[^\w:>])\s*([A-Za-z_]\w*)\s*::$/.exec(before);
            if (q?.[2] === "Self") sites.push({ line: n, name, via: "Self" });
            else if (q && /^[A-Z]/.test(q[2])) sites.push({ line: n, name, via: "type", type: q[2] });
            else sites.push({ line: n, name, via: "other" });
        } else sites.push({ line: n, name, via: "bare" });
    }
    return sites;
};

export type RustCall = { to: Decl; line: number };

type Analysis = { calls: (caller: Pick<Decl, "start" | "end" | "kind">) => RustCall[] };

const cache = new WeakMap<readonly string[], Analysis>();

/** The provable calls out of any declaration of a file, from its head lines and its line-pattern declarations. */
export const rustFile = (lines: readonly string[], decls: readonly Decl[]): Analysis => {
    const hit = cache.get(lines);
    if (hit) return hit;
    const code = codeOnly(lines.join("\n")).split("\n");

    const scopes: Scope[] = [{ id: 0, start: 0, end: Number.MAX_SAFE_INTEGER, items: 0 }];
    code.forEach((line, i) => {
        if (!/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*\{\s*$/.test(line)) return;
        const indent = indentOf(line);
        let end = i + 1;
        let items = indent + 4;
        let first = true;
        for (let k = i + 1; k < code.length; k++) {
            const t = code[k];
            if (t.trim() === "") continue;
            if (indentOf(t) > indent) {
                if (first) (items = indentOf(t)), (first = false);
                end = k + 1;
                continue;
            }
            if (/^\s*\}/.test(t)) end = k + 1;
            break;
        }
        scopes.push({ id: scopes.length, start: i + 1, end, items });
    });
    const scopeAt = (line: number): Scope => scopes.filter((s) => s.start < line && line <= s.end).sort((a, b) => b.start - a.start)[0];

    const impls: Impl[] = decls
        .filter((d) => d.kind === "class")
        .map((d) => {
            let header = "";
            for (let k = d.start; k <= d.end; k++) {
                header += ` ${code[k - 1]}`;
                if (code[k - 1].includes("{")) break;
            }
            header = header.split("{")[0];
            let flat = header;
            for (let prev = ""; prev !== flat; ) (prev = flat), (flat = flat.replace(/<[^<>]*>/g, " "));
            flat = flat.replace(/\bwhere\b[\s\S]*$/, "").trim();
            const m = /\bimpl\s+(?:(.+?)\s+for\s+)?(?:&\s*(?:mut\s+)?)?([\w:]+)\s*$/.exec(flat);
            const scope = scopeAt(d.start);
            return { start: d.start, end: d.end, type: (m?.[2] ?? "").split("::").pop()!, inherent: m !== null && m[1] === undefined, scope: scope.id, header };
        })
        .filter((b) => b.type !== "" && scopeAt(b.start).items === indentOf(lines[b.start - 1]));
    const implAt = (line: number): Impl | undefined => impls.filter((b) => b.start < line && line <= b.end).sort((a, b) => b.start - a.start)[0];

    const add = <K, V>(map: Map<K, V[]>, key: K, value: V) => map.set(key, [...(map.get(key) ?? []), value]);
    // Module-level functions, and inherent methods by module, type and name.
    const functions = new Map<string, Decl[]>();
    const inherent = new Map<string, Decl[]>();
    const types = new Set<string>();
    for (const d of decls) {
        const scope = scopeAt(d.start);
        const impl = implAt(d.start);
        if (d.kind === "function" && !impl && d.indent === scope.items) add(functions, `${scope.id}|${d.name}`, d);
        if ((d.kind === "method" || d.kind === "function") && impl?.inherent && impl.scope === scope.id) add(inherent, `${impl.scope}|${impl.type}|${d.name}`, d);
        if (d.kind === "type" && !impl && d.indent === scope.items && /\b(struct|enum|union)\b/.test(code[d.start - 1])) types.add(`${scope.id}|${d.name}`);
    }
    for (const b of impls) if (b.inherent) types.add(`${b.scope}|${b.type}`);
    const one = (ds: Decl[] | undefined) => (ds && ds.length === 1 ? ds[0] : undefined);

    const calls = (caller: Pick<Decl, "start" | "end" | "kind">): RustCall[] => {
        if (caller.kind !== "function" && caller.kind !== "method") return [];
        const scope = scopeAt(caller.start);
        const impl = implAt(caller.start);
        const body = code.slice(caller.start - 1, caller.end).join("\n");
        // An impl inside the body, such as a guard's `impl Drop`, has its own `self`: its lines prove no self-call.
        const nested: { from: number; to: number }[] = [];
        for (let n = caller.start + 1; n <= caller.end; n++) {
            if (!/^\s*(?:unsafe\s+)?impl\b/.test(code[n - 1])) continue;
            const indent = indentOf(code[n - 1]);
            let to = n;
            while (to < caller.end && (code[to].trim() === "" || indentOf(code[to]) > indent || /^\s*\}/.test(code[to]))) {
                to++;
                if (/^\s*\}/.test(code[to - 1]) && indentOf(code[to - 1]) === indent) break;
            }
            nested.push({ from: n, to });
        }
        const ownSelf = (line: number) => !nested.some((r) => r.from <= line && line <= r.to);
        const out: RustCall[] = [];
        for (let n = caller.start + 1; n <= caller.end && n <= code.length; n++) {
            for (const s of sitesOn(code[n - 1], n)) {
                let to: Decl | undefined;
                if (s.via === "bare") {
                    to = one(functions.get(`${scope.id}|${s.name}`));
                    // Any other mention of the name in the caller may bind it: a local, a parameter, a closure, a `use`, a nested `fn`.
                    const mentions = [...body.matchAll(new RegExp(`(^|[^\\w.:])${s.name}\\b(\\s*(?:::\\s*<[^()]*?>\\s*)?\\()?`, "g"))];
                    if (mentions.some((x) => !x[2]) || new RegExp(`\\bfn\\s+${s.name}\\b`).test(body.slice(body.indexOf("\n") + 1))) to = undefined;
                } else if ((s.via === "self" || s.via === "Self") && impl && impl.scope === scope.id && ownSelf(s.line)) {
                    to = one(inherent.get(`${impl.scope}|${impl.type}|${s.name}`));
                } else if (s.via === "type" && types.has(`${scope.id}|${s.type}`)) {
                    // Not when `T` is a generic parameter in scope, or the caller brings in or declares its own `T`.
                    const generic = new RegExp(`[<,]\\s*${s.type}\\b`);
                    const local = new RegExp(`\\buse\\b[^;]*\\b${s.type}\\b|\\b(?:struct|enum|union|type|trait)\\s+${s.type}\\b`);
                    if (!generic.test(code[caller.start - 1]) && !(impl && generic.test(impl.header)) && !local.test(body)) to = one(inherent.get(`${scope.id}|${s.type}|${s.name}`));
                }
                if (!to || to.start === caller.start) continue;
                // A call into a declaration around the caller, or inside it, links nothing.
                if ((to.start <= caller.start && caller.end <= to.end) || (caller.start <= to.start && to.end <= caller.end)) continue;
                out.push({ to, line: s.line });
            }
        }
        return out;
    };
    const analysis = { calls };
    cache.set(lines, analysis);
    return analysis;
};
