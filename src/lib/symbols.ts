/**
 * Which declarations a diff touches in the files no parser reads: the
 * languages without a rule table, `.vue` and `.svelte`, and a file a parser
 * can't read (`@flow`, or too many errors). Also the test cases a test
 * file's diff adds or removes, and the names cards go by.
 *
 * Works from the head version of each file with line patterns and
 * indentation, not a parser: declarations are found by shape (`function x`,
 * `const x = (`, a method inside a class, `def`, `func`, `fn`), and a
 * declaration runs until the code returns to its indentation. That holds for
 * formatted code in the common languages, which is what PRs carry. A name
 * says nothing about which declaration it means, so these cards draw no
 * strings.
 */

import { addedLines, allLines, type DiffLine, type Hunk } from "./diff.ts";
import type { Language } from "./language.ts";

export type DeclKind = "function" | "method" | "class" | "type" | "value" | "namespace";

type Decl = {
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
    /** `path:line`, unique within a PR: the line its name is on. */
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

const indentOf = (line: string): number => {
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

/** Languages whose declaration patterns start with a keyword, so a name after it is never a statement. */
const KEYWORD_LED = new Set<Language>(["py", "go", "rs"]);

const KEYWORDS = new Set([
    "if", "for", "while", "switch", "catch", "return", "function", "else", "do", "try", "await", "new", "throw",
    "typeof", "delete", "void", "yield", "super", "import", "export", "case", "with", "elif", "when",
]);

type Pattern = {
    re: RegExp;
    kind: DeclKind;
    group?: number;
    /** The group naming the type a method belongs to: Go's receiver. */
    owner?: number;
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
    { re: /^func\s+\(\s*(?:\w+\s+)?\*?\s*(\w+)[^)]*\)\s*(\w+)/, kind: "method", group: 2, owner: 1 },
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

const PATTERNS: Partial<Record<Language, Pattern[]>> = { ts: JS, js: JS, py: PY, go: GO, rs: RS, rb: RB, java: C_FAMILY, kt: C_FAMILY, swift: C_FAMILY, cs: C_FAMILY, php: C_FAMILY, c: C_FAMILY };

/** A Go label, which gofmt puts at column 0 inside a function: `loop:`. */
const GO_LABEL = /^[A-Za-z_]\w*:\s*$/;

/** Where a declaration starting at `start` ends, by indentation. */
const extentEnd = (lines: readonly string[], start: number, lang: Language): number => {
    const indent = indentOf(lines[start - 1]);
    let last = start;
    for (let i = start + 1; i <= lines.length; i++) {
        const line = lines[i - 1];
        if (isBlank(line)) continue;
        if (indentOf(line) > indent || (lang === "go" && GO_LABEL.test(line))) {
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
    const patterns = PATTERNS[lang] ?? [];
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
            // A statement in a class can look like a method, so a keyword is no name. Python's, Go's and
            // Rust's patterns take only what follows `def`, `func` or `fn`: `def delete` and `fn new` are declarations.
            if (!m || !name || (!KEYWORD_LED.has(lang) && KEYWORDS.has(name.replace(/^#/, "")))) continue;
            // A method is a direct member of its class, not a statement.
            if (p.inClassOnly && container && (indent !== firstMemberIndent(lines, container, lang) || /;\s*$/.test(line))) continue;
            const end = extentEnd(lines, i, lang);
            if (p.arrowField && !opensBody(lines, i, end, indent)) continue;
            const kind = p.kind === "function" && container && indent > container.indent ? "method" : p.kind;
            const owner = p.owner ? m[p.owner] : container?.name;
            const decl: Decl = { name, kind, start: i, end, indent, ...(owner ? { parent: owner } : {}) };
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

/** How a method's card joins its type's name to its own, by language. */
const OWNER_SEPARATOR: Partial<Record<Language, string>> = { py: ".", go: ".", rs: "::" };

/**
 * A card's name for a declaration. A Python, Go or Rust method takes its
 * type's name (`Server.Start()`): a package has many a `then()`.
 */
export const labelOf = (decl: Pick<Decl, "name" | "kind" | "parent">, lang?: Language): string => {
    const separator = lang && OWNER_SEPARATOR[lang];
    switch (decl.kind) {
        case "function":
        case "method":
            return decl.kind === "method" && separator && decl.parent ? `${decl.parent.split("::").pop()}${separator}${decl.name}()` : `${decl.name}()`;
        case "class":
            return lang === "rs" ? `impl ${decl.name}` : `class ${decl.name}`;
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

/** For each line up to `count`, the item whose span holds it and is shortest, the first on a tie. */
export const innermostByLine = <T>(items: readonly T[], count: number, span: (item: T) => readonly [number, number]): (T | undefined)[] => {
    const best: (T | undefined)[] = new Array(count + 1).fill(undefined);
    const size: number[] = [];
    for (const item of items) {
        const [from, to] = span(item);
        for (let line = from; line <= Math.min(to, count); line++) {
            if (best[line] !== undefined && to - from >= size[line]) continue;
            best[line] = item;
            size[line] = to - from;
        }
    }
    return best;
};

/** A declaration's changed lines summed up: their span, as head positions, and how many each side has. */
export const changeSpan = (lines: readonly DiffLine[]): Pick<ChangedSymbol, "from" | "to" | "add" | "del"> => {
    const ats = lines.map((l) => l.at);
    return {
        from: ats.reduce((a, b) => Math.min(a, b)),
        to: ats.reduce((a, b) => Math.max(a, b)),
        add: lines.filter((l) => l.t === "add").length,
        del: lines.filter((l) => l.t === "del").length,
    };
};

/** The declarations a file's diff changes, in line order, and the changes outside every declaration. */
export const changedSymbols = (
    path: string,
    lang: Language,
    head: readonly string[] | null,
    hunks: readonly Hunk[]
): { symbols: ChangedSymbol[]; loose: LooseChange[] } => {
    const changed = allLines(hunks).filter((l) => l.t !== "ctx");
    if (!head) return { symbols: [], loose: looseRuns(path, changed) };
    const decls = findDecls(head, lang);
    const starts = new Map(decls.map((d) => [d.start, d]));
    const innermost = innermostByLine(decls, head.length, (d) => [d.start, d.end]);
    const linesOf = new Map(decls.map((d) => [d, [] as DiffLine[]]));
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
        if (target) linesOf.get(target)!.push(l);
        else loose.push(l);
        previous = { line: l, target };
    }
    const added = addedLines(changed);
    const symbols = decls
        .filter((d) => linesOf.get(d)!.length > 0)
        .map((d): ChangedSymbol => ({
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
            ...changeSpan(linesOf.get(d)!),
        }));
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
