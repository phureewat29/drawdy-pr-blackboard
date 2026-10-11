/**
 * Which declarations a diff touches, and which of them call each other, in
 * the files the parser doesn't read: Python, Go, Rust and the rest, `.vue`
 * and `.svelte`, and JavaScript or TypeScript it can't read (`@flow`, or too
 * many errors). Also the test cases a test file's diff adds or removes.
 *
 * Works from the head version of each file with line patterns and
 * indentation, not a parser: declarations are found by shape (`function x`,
 * `const x = (`, a method inside a class, `def`, `func`, `fn`), and a
 * declaration runs until the code returns to its indentation. That holds for
 * formatted code in the common languages, which is what pull requests carry.
 * A name says nothing about which declaration it means, so these files draw
 * only `calls` strings, and `imports` from import lines (`model.ts`).
 */

import type { DiffLine, Hunk } from "./diff.ts";
import type { Language } from "./language.ts";
import { rustFile } from "./rust.ts";

export type DeclKind = "function" | "method" | "class" | "type" | "value" | "namespace";

export type Decl = {
    name: string;
    kind: DeclKind;
    /** First and last head line, 1-based, inclusive. */
    start: number;
    end: number;
    indent: number;
    /** The class (or impl block) a method sits in. */
    parent?: string;
};

export type ChangedSymbol = {
    /** `path:line`, unique within a pull request: the line its name is on. */
    id: string;
    path: string;
    lang: Language;
    /** The name as code refers to it, such as `toError` or `#handleError`. */
    name: string;
    /** The name as a reader sees it, such as `toError()` or `class Hono`. */
    label: string;
    kind: DeclKind;
    parent?: string;
    /** The declaration is itself an added line. */
    status: "new" | "changed";
    start: number;
    end: number;
    /** The span of changed lines, as head positions. */
    from: number;
    to: number;
    add: number;
    del: number;
};

/** Changed lines that sit outside any declaration, such as imports. */
export type LooseChange = { path: string; from: number; to: number; add: number; del: number };

export const indentOf = (line: string): number => {
    const m = /^[ \t]*/.exec(line)![0];
    return m.replace(/\t/g, "    ").length;
};

const isBlank = (line: string) => line.trim() === "";
const HASH_COMMENTS = new Set<Language>(["py", "rb", "sh", "yaml", "toml"]);
/** A comment line, in the language's own syntax: `#` is a comment in Python but a private name in TypeScript. */
export const isComment = (line: string, lang: Language) =>
    /^\s*(\/\/|\/\*|\*(\s|\/|$))/.test(line) ||
    (HASH_COMMENTS.has(lang) && /^\s*#(?!\[)/.test(line)) ||
    (lang === "py" && /^\s*("""|''')/.test(line)) ||
    (lang === "sql" && /^\s*--/.test(line));
/** A line that closes a block or a bracket list: `}`, `)`, `]`, `>`, Ruby's `end`. */
const isCloser = (line: string) => /^\s*(\}|\)|\]|>|end\b)/.test(line);
/** A closing line that opens the body at once, as in `): Response {`. */
const opensAgain = (line: string) => /(\{|\(|\[|=>|:)\s*$/.test(line.trim());

const KEYWORDS = new Set([
    "if", "for", "while", "switch", "catch", "return", "function", "else", "do", "try", "await", "new", "throw",
    "typeof", "delete", "void", "yield", "super", "import", "export", "case", "with", "elif", "when",
]);

type Pattern = {
    re: RegExp;
    kind: DeclKind;
    group?: number;
    container?: boolean;
    inClassOnly?: boolean;
    topOnly?: boolean;
    /** A class field typed as a function across lines (`fetch: (`): only counts when the closing line opens a body. */
    arrowField?: boolean;
};

const JS: Pattern[] = [
    { re: /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class", container: true },
    // `type X,` inside a multi-line import is no declaration.
    { re: /^\s*(?:export\s+)?(?:declare\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)(?=\s*(?:[=<{]|extends\b|$))/, kind: "type" },
    { re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, kind: "function" },
    {
        re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s+)?(?:function\b|\(|<|[A-Za-z_$][\w$]*\s*=>)/,
        kind: "function",
    },
    { re: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, kind: "value", topOnly: true },
    {
        re: /^\s+(?:(?:public|private|protected|static|readonly|override|abstract|declare)\s+)*(#?[A-Za-z_$][\w$]*)\s*(?:\?|!)?\s*(?::[^=]*)?=\s*(?:async\s+)?(?:\(|[A-Za-z_$][\w$]*\s*=>|function\b)/,
        kind: "method",
        inClassOnly: true,
    },
    {
        re: /^\s+(?:(?:public|private|protected|static|readonly|override|declare)\s+)*(#?[A-Za-z_$][\w$]*)\s*[?!]?\s*:\s*\(\s*$/,
        kind: "method",
        inClassOnly: true,
        arrowField: true,
    },
    {
        re: /^\s+(?:(?:public|private|protected|static|readonly|async|override|abstract|get|set)\s+)*\*?\s*(#?[A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/,
        kind: "method",
        inClassOnly: true,
    },
];

const PY: Pattern[] = [
    { re: /^\s*class\s+(\w+)/, kind: "class", container: true },
    { re: /^\s*(?:async\s+)?def\s+(\w+)/, kind: "function" },
];

const GO: Pattern[] = [
    { re: /^func\s+\([^)]*\)\s*(\w+)/, kind: "method" },
    { re: /^func\s+(\w+)/, kind: "function" },
    { re: /^type\s+(\w+)/, kind: "type" },
];

const RS: Pattern[] = [
    { re: /^\s*impl(?:<[^>]*>)?\s+(?:[\w:<>, ]+\s+for\s+)?([\w:]+)/, kind: "class", container: true },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:(?:async|const|unsafe|extern(?:\s+"[^"]*")?)\s+)*fn\s+(\w+)/, kind: "function" },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|type|union)\s+(\w+)/, kind: "type" },
];

const RB: Pattern[] = [
    { re: /^\s*(?:class|module)\s+([\w:]+)/, kind: "class", container: true },
    { re: /^\s*def\s+(?:self\.)?([\w?!=]+)/, kind: "function" },
];

/** Java, Kotlin, Swift, C#, PHP, C and C++: by keyword where there is one, else by the shape of a signature. */
const C_FAMILY: Pattern[] = [
    { re: /^\s*(?:[\w@]+\s+)*(?:class|interface|enum|struct|object|protocol|record|extension|trait)\s+(\w+)/, kind: "class", container: true },
    { re: /^\s*(?:[\w@]+\s+)*(?:fun|func|function)\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?(\w+)\s*[(<]/, kind: "function" },
    { re: /^\s*(?:(?:public|private|protected|internal|static|final|virtual|override|async|abstract|synchronized|inline|extern|const|unsafe)\s+)*[\w<>\[\],.?*&: ]+\s+\*?(\w+)\s*\([^;]*$/, kind: "function" },
];

const patternsFor = (lang: Language): Pattern[] => {
    switch (lang) {
        case "ts":
        case "js":
            return JS;
        case "py":
            return PY;
        case "go":
            return GO;
        case "rs":
            return RS;
        case "rb":
            return RB;
        case "java":
        case "kt":
        case "swift":
        case "cs":
        case "php":
        case "c":
            return C_FAMILY;
        default:
            return [];
    }
};

/** Where a declaration starting at `start` ends, by indentation. */
const extentEnd = (lines: readonly string[], start: number): number => {
    const indent = indentOf(lines[start - 1]);
    let last = start;
    for (let i = start + 1; i <= lines.length; i++) {
        const line = lines[i - 1];
        if (isBlank(line)) continue;
        if (indentOf(line) > indent) {
            last = i;
            continue;
        }
        if (isCloser(line)) {
            last = i;
            if (opensAgain(line)) continue;
        }
        break;
    }
    return last;
};

/** Every declaration in a file, with its extent. */
export const findDecls = (lines: readonly string[], lang: Language): Decl[] => {
    const patterns = patternsFor(lang);
    if (patterns.length === 0) return [];
    const decls: Decl[] = [];
    // Containers in the order found; one that has ended leaves once it is the last.
    const containers: Decl[] = [];
    // The last line of the functions found so far.
    let functionsEnd = 0;
    for (let i = 1; i <= lines.length; i++) {
        const line = lines[i - 1];
        if (isBlank(line) || isComment(line, lang)) continue;
        const indent = indentOf(line);
        while (containers.length > 0 && containers[containers.length - 1].end < i) containers.pop();
        const container = containers[containers.length - 1];
        // Helpers nested in a function belong to it: a reader thinks of the
        // change as one to the outer function.
        if (i <= functionsEnd) continue;
        for (const p of patterns) {
            if (p.topOnly && indent > 0) continue;
            if (p.inClassOnly && !container) continue;
            const m = p.re.exec(line);
            const name = m?.[p.group ?? 1];
            // A statement in a class can look like a method, so a keyword is no name. Rust's patterns
            // take only what follows `fn` or `struct`, and a Rust constructor is `fn new`.
            if (!m || !name || (lang !== "rs" && KEYWORDS.has(name.replace(/^#/, "")))) continue;
            // A method is a direct member of its class, not a statement.
            if (p.inClassOnly && container && (indent !== firstMemberIndent(lines, container, lang) || /;\s*$/.test(line))) continue;
            const end = extentEnd(lines, i);
            if (p.arrowField && !opensBody(lines, i, end, indent)) continue;
            const kind = p.kind === "function" && container && indent > container.indent ? "method" : p.kind;
            const decl: Decl = { name, kind, start: i, end, indent, ...(container ? { parent: container.name } : {}) };
            decls.push(decl);
            if (p.container) containers.push(decl);
            if (kind === "function" || kind === "method") functionsEnd = Math.max(functionsEnd, end);
            break;
        }
    }
    return decls;
};

/** Whether a field's type, closing at its own indentation, goes on to a body: `) => R = (a) => {`. */
const opensBody = (lines: readonly string[], start: number, end: number, indent: number): boolean => {
    for (let i = start + 1; i <= end; i++) {
        const line = lines[i - 1];
        if (!isBlank(line) && indentOf(line) === indent && isCloser(line)) return /(=>\s*\{|=\s*\()\s*$/.test(line.trim());
    }
    return false;
};

const firstMemberIndent = (lines: readonly string[], container: Decl, lang: Language): number => {
    for (let i = container.start + 1; i <= container.end; i++) {
        const line = lines[i - 1];
        if (!isBlank(line) && !isComment(line, lang) && !isCloser(line)) return indentOf(line);
    }
    return container.indent + 2;
};

/** A card's name for a declaration. A Rust method takes its type's name, `GetAddrInfoRequest::then()`: a crate has many a `then()`. */
export const labelOf = (decl: Pick<Decl, "name" | "kind" | "parent">, lang?: Language): string => {
    switch (decl.kind) {
        case "function":
        case "method":
            return lang === "rs" && decl.kind === "method" && decl.parent ? `${decl.parent.split("::").pop()}::${decl.name}()` : `${decl.name}()`;
        case "class":
            return `class ${decl.name}`;
        case "type":
            return `type ${decl.name}`;
        case "namespace":
            return `namespace ${decl.name}`;
        case "value":
            return decl.name;
    }
};

/**
 * The declaration a doc comment or decorator belongs to: the next one, when
 * only comments, decorators and blank lines lie between.
 */
const documented = (lines: readonly string[], starts: ReadonlyMap<number, Decl>, line: number, lang: Language): Decl | null => {
    for (let i = line; i <= Math.min(lines.length, line + 60); i++) {
        const decl = starts.get(i);
        if (decl && i > line) return decl;
        const text = lines[i - 1];
        if (!(isBlank(text) || isComment(text, lang) || /^\s*@/.test(text))) return decl ?? null;
    }
    return null;
};

/** Each line's innermost declaration: the shortest that holds it, the first found on a tie. */
const innermostByLine = (decls: readonly Decl[], count: number): (Decl | null)[] => {
    const out: (Decl | null)[] = new Array(count + 1).fill(null);
    for (const d of decls) {
        for (let line = d.start; line <= Math.min(d.end, count); line++) {
            const best = out[line];
            if (best === null || d.end - d.start < best.end - best.start) out[line] = d;
        }
    }
    return out;
};

/**
 * The declarations a file's diff changes, in line order, plus the changes
 * that sit outside every declaration.
 */
export const changedSymbols = (
    path: string,
    lang: Language,
    head: readonly string[] | null,
    hunks: readonly Hunk[]
): { symbols: ChangedSymbol[]; loose: LooseChange[] } => {
    const changed = hunks.flatMap((h) => h.lines).filter((l) => l.t !== "ctx");
    if (!head) return { symbols: [], loose: looseRuns(path, changed) };
    const decls = findDecls(head, lang);
    const starts = new Map<number, Decl>();
    for (const d of decls) if (!starts.has(d.start)) starts.set(d.start, d);
    const innermost = innermostByLine(decls, head.length);
    const added = new Set(changed.filter((l) => l.t === "add").map((l) => l.n!));
    const owner = new Map<Decl, DiffLine[]>();
    const loose: DiffLine[] = [];
    let previous: { line: DiffLine; target: Decl | null } | null = null;
    for (const l of changed) {
        const text = l.text;
        // A blank line goes with the change right above it, or nowhere.
        const target: Decl | null | undefined = isBlank(text)
            ? previous && l.at - previous.line.at <= 1
                ? previous.target
                : undefined
            : ((isComment(text, lang) || /^\s*@/.test(text) ? documented(head, starts, l.at, lang) : null) ?? innermost[l.at] ?? null);
        if (target === undefined) continue;
        if (target) {
            const owned = owner.get(target);
            if (owned) owned.push(l);
            else owner.set(target, [l]);
        } else loose.push(l);
        previous = { line: l, target };
    }
    const symbols = [...owner.entries()]
        .sort(([a], [b]) => a.start - b.start)
        .map(([d, lines]): ChangedSymbol => {
            const ats = lines.map((l) => l.at);
            return {
                id: `${path}:${d.start}`,
                path,
                lang,
                name: d.name,
                label: labelOf(d, lang),
                kind: d.kind,
                ...(d.parent ? { parent: d.parent } : {}),
                status: added.has(d.start) ? "new" : "changed",
                start: d.start,
                end: d.end,
                from: ats.reduce((a, b) => Math.min(a, b)),
                to: ats.reduce((a, b) => Math.max(a, b)),
                add: lines.filter((l) => l.t === "add").length,
                del: lines.filter((l) => l.t === "del").length,
            };
        });
    return { symbols, loose: looseRuns(path, loose) };
};

/** Changed lines grouped into runs that sit close together. */
export const looseRuns = (path: string, lines: readonly DiffLine[]): LooseChange[] => {
    const runs: LooseChange[] = [];
    for (const l of [...lines].sort((a, b) => a.at - b.at)) {
        const last = runs[runs.length - 1];
        const add = l.t === "add" ? 1 : 0;
        const del = l.t === "del" ? 1 : 0;
        if (last && l.at - last.to <= 6) runs[runs.length - 1] = { ...last, to: Math.max(last.to, l.at), add: last.add + add, del: last.del + del };
        else runs.push({ path, from: l.at, to: l.at, add, del });
    }
    return runs;
};

/** Names too common to link code by: a match would mostly be a coincidence. */
const COMMON = new Set([
    "get", "set", "has", "add", "map", "run", "call", "apply", "bind", "then", "catch", "init", "main", "test", "it",
    "describe", "constructor", "toString", "value", "data", "default", "index", "render", "update", "create", "handle",
    "use", "new", "next", "push", "pop", "on", "off", "emit", "start", "stop", "close", "open", "read", "write", "load",
    "parse", "format", "name", "type", "key", "id", "size", "length", "error", "result", "options", "config", "self",
]);

/**
 * How code refers to a symbol. A method is reached through an object
 * (`this.run(`, `app.onError(`), so a bare word with its name, often a
 * parameter, doesn't count. Null when the name is too short or too common.
 */
const calledAs = (symbol: Pick<ChangedSymbol, "name" | "kind">): ((t: CallToken) => boolean) | null => {
    const bare = symbol.name.replace(/^#/, "");
    if (bare.length < 3 || COMMON.has(bare)) return null;
    if (symbol.name.startsWith("#")) return () => true;
    return symbol.kind === "method" ? (t) => t.member : (t) => t.plain;
};

/** A name followed by `(`, maybe through type arguments or `?.`: `run(`, `run<T>(`, `run?.(`. */
const CALL_TOKEN = /(#?[A-Za-z_$][\w$]*)\s*(?:<[^<>()]*>)?\s*(?:\?\.)?\(/g;

/** `member`: reached through `.`, `::` or `->`; `plain`: after no word character, `$`, `#` or `.`. */
type CallToken = { name: string; line: number; member: boolean; plain: boolean };

const tokenCache = new WeakMap<readonly string[], CallToken[][]>();

/** Each line's calls, once per file, so finding who calls what is one pass rather than one per pair. */
const callTokens = (lines: readonly string[], lang: Language): CallToken[][] => {
    const hit = tokenCache.get(lines);
    if (hit) return hit;
    const out = lines.map((line, i) =>
        isComment(line, lang)
            ? []
            : [...line.matchAll(CALL_TOKEN)].map((m) => {
                  const at = m.index!;
                  const two = line.slice(Math.max(0, at - 2), at);
                  return { name: m[1], line: i + 1, member: line[at - 1] === "." || two === "::" || two === "->", plain: at === 0 || !/[\w$#.]/.test(line[at - 1]) };
              })
    );
    tokenCache.set(lines, out);
    return out;
};

const declCache = new WeakMap<readonly string[], Decl[]>();
const rustOf = (lines: readonly string[]) => {
    let decls = declCache.get(lines);
    if (!decls) declCache.set(lines, (decls = findDecls(lines, "rs")));
    return rustFile(lines, decls);
};

/**
 * The head lines of `caller` that call `target`. Rust counts only a call the
 * file proves (`rust.ts`); other languages, the name followed by `(`.
 * Comment lines don't count.
 */
export const callsTo = (
    path: string,
    lines: readonly string[],
    lang: Language,
    caller: Pick<Decl, "start" | "end" | "kind">,
    target: Pick<ChangedSymbol, "path" | "name" | "kind" | "start">
): number[] => {
    if (lang === "rs") return path === target.path ? [...new Set(rustOf(lines).calls(caller).filter((c) => c.to.start === target.start).map((c) => c.line))] : [];
    const matches = calledAs(target);
    if (!matches) return [];
    const rows = new Set<number>();
    const tokens = callTokens(lines, lang);
    for (let n = Math.max(1, caller.start + 1); n <= Math.min(lines.length, caller.end); n++) if (tokens[n - 1].some((t) => t.name === target.name && matches(t))) rows.add(n);
    return [...rows];
};

/** One declaration calling another, with the head lines in `from` that do. */
export type CallEdge = { from: string; to: string; calls: number[] };

/**
 * Which changed declarations call which: an edge from `a` to `b` means
 * `a`'s code calls `b`, with the rows that do. A private `#name` only links
 * within its file; Rust only what `rust.ts` proves.
 */
export const callEdges = (symbols: readonly ChangedSymbol[], headByPath: ReadonlyMap<string, readonly string[]>): CallEdge[] => {
    const edges: CallEdge[] = [];
    const order = new Map(symbols.map((s, i) => [s, i]));
    const byName = new Map<string, ChangedSymbol[]>();
    for (const s of symbols) {
        const named = byName.get(s.name);
        if (named) named.push(s);
        else byName.set(s.name, [s]);
    }
    const byStart = new Map(symbols.map((s) => [`${s.path}:${s.start}`, s]));
    for (const a of symbols) {
        const lines = headByPath.get(a.path);
        if (!lines || a.kind === "class") continue;
        const rows = new Map<ChangedSymbol, Set<number>>();
        if (a.lang === "rs") {
            for (const c of rustOf(lines).calls(a)) {
                const b = byStart.get(`${a.path}:${c.to.start}`);
                if (b) rows.set(b, (rows.get(b) ?? new Set()).add(c.line));
            }
        } else {
            const tokens = callTokens(lines, a.lang);
            for (let n = a.start + 1; n <= Math.min(lines.length, a.end); n++) {
                for (const t of tokens[n - 1]) {
                    for (const b of byName.get(t.name) ?? []) if (calledAs(b)?.(t)) rows.set(b, (rows.get(b) ?? new Set()).add(n));
                }
            }
        }
        const targets = [...rows.keys()].sort((x, y) => order.get(x)! - order.get(y)!);
        for (const b of targets) {
            if (a === b) continue;
            if (b.path === a.path && b.start <= a.start && a.end <= b.end) continue;
            if (a.path === b.path && a.start <= b.start && b.end <= a.end) continue;
            if (b.name.startsWith("#") && b.path !== a.path) continue;
            edges.push({ from: a.id, to: b.id, calls: [...rows.get(b)!].sort((x, y) => x - y) });
        }
    }
    return edges;
};

/** A test case or group (`describe`), with its line's indent in columns, so a card can nest cases under their group. */
export type TestCase = { name: string; at: number; t: "add" | "del"; group: boolean; indent: number };

const CASE_PATTERNS: RegExp[] = [
    /\b(describe|context|suite|it|test|specify)(?:\.(?:each|only|skip|concurrent|todo)(?:\([^)]*\))?)*\(\s*(['"`])(.+?)\2/,
    /^\s*(?:async\s+)?def\s+(test)_?(\w+)/,
    /^\s*func\s+(Test)(\w+)\s*\(/,
];

/** The test cases a test file's diff adds or removes, by name. */
export const testCases = (hunks: readonly Hunk[]): TestCase[] => {
    const out: TestCase[] = [];
    for (const h of hunks) {
        h.lines.forEach((l, i) => {
            if (l.t === "ctx") return;
            const t = l.t;
            const indent = /^\s*/.exec(l.text.replace(/\t/g, "    "))![0].length;
            const js = CASE_PATTERNS[0].exec(l.text);
            if (js) {
                out.push({ name: js[3], at: l.at, t, group: /^(describe|context|suite)$/.test(js[1]), indent });
                return;
            }
            // `it.each([...])(` with the name on the next line.
            if (/\b(it|test)\.each\(.*\)\(\s*$/.test(l.text)) {
                const next = /^\s*(['"`])(.+?)\1/.exec(h.lines[i + 1]?.text ?? "");
                if (next) out.push({ name: next[2], at: l.at, t, group: false, indent });
                return;
            }
            const py = CASE_PATTERNS[1].exec(l.text) ?? CASE_PATTERNS[2].exec(l.text);
            if (py) out.push({ name: `${py[1]}${py[1] === "test" ? "_" : ""}${py[2]}`, at: l.at, t, group: false, indent });
        });
    }
    return out;
};
