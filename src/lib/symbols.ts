/**
 * Which declarations a diff touches in the files no parser reads: the
 * languages without a linker, `.vue` and `.svelte`, and a file a parser
 * can't read (`@flow`, or too many errors). Also the test cases a test
 * file's diff adds or removes, and the names cards go by.
 *
 * Works from the head version of each file with line patterns and
 * indentation, not a parser: declarations are found by shape (`function x`,
 * `const x = (`, a method inside a class, `def`, `func`, `fn`), and a
 * declaration runs until the code returns to its indentation. That holds for
 * formatted code in the common languages, which is what PRs carry. Each
 * pack gives its patterns, comment lines, card names and test cases
 * (`LanguagePack.lines`, `naming`, `cases`). A name says nothing about which
 * declaration it means, so these cards draw no strings.
 */

import { addedLines, allLines, type DiffLine, type Hunk } from "./diff.ts";
import { PACKS } from "./langs/index.ts";
import type { LinePattern, UnitKind } from "./langs/pack.ts";
import { packById, type Language } from "./language.ts";

export type DeclKind = UnitKind;

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
/** A comment line, in the language's own syntax: `#` is a comment in Python but a private name in TypeScript. */
export const isComment = (line: string, lang: Language) => /^\s*(\/\/|\/\*|\*(\s|\/|$))/.test(line) || packById(lang)?.lines?.comments?.test(line) === true;
/** A line that closes a block or a bracket list: `}`, `)`, `]`, `>`, Ruby's `end`. */
const isCloser = (line: string) => /^\s*(\}|\)|\]|>|end\b)/.test(line);
/** A closing line that opens the body at once, as in `): Response {`. */
const opensAgain = (line: string) => /(\{|\(|\[|=>|:)\s*$/.test(line.trim());

const KEYWORDS = new Set([
    "if", "for", "while", "switch", "catch", "return", "function", "else", "do", "try", "await", "new", "throw",
    "typeof", "delete", "void", "yield", "super", "import", "export", "case", "with", "elif", "when",
]);

/** Where a declaration starting at `start` ends, by indentation. */
const extentEnd = (lines: readonly string[], start: number, inside: RegExp | undefined): number => {
    const indent = indentOf(lines[start - 1]);
    let last = start;
    for (let i = start + 1; i <= lines.length; i++) {
        const line = lines[i - 1];
        if (isBlank(line)) continue;
        if (indentOf(line) > indent || inside?.test(line)) {
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
    const read = packById(lang)?.lines;
    const patterns: readonly LinePattern[] = read?.patterns ?? [];
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
            if (!m || !name || (!read?.keywordLed && KEYWORDS.has(name.replace(/^#/, "")))) continue;
            // A method is a direct member of its class, not a statement.
            if (p.inClassOnly && container && (indent !== firstMemberIndent(lines, container, lang) || /;\s*$/.test(line))) continue;
            const end = extentEnd(lines, i, read?.inside);
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

/**
 * A card's name for a declaration, as its language names members
 * (`LanguagePack.naming`): a Python, Go or Rust method takes its type's name
 * (`Server.Start()`), since a package has many a `then()`.
 */
export const labelOf = (decl: Pick<Decl, "name" | "kind" | "parent">, lang?: Language): string => {
    const naming = lang ? packById(lang)?.naming : undefined;
    const member = naming?.member;
    switch (decl.kind) {
        case "function":
        case "method":
            return decl.kind === "method" && member && decl.parent ? `${decl.parent.split("::").pop()}${member}${decl.name}()` : `${decl.name}()`;
        case "class":
            return `${naming?.container ?? "class"} ${decl.name}`;
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

/** Every pack's test-case rule, in pack order, each once: a test file's own language isn't known to name its cases. */
const CASE_RULES = [...new Set(PACKS.flatMap((p) => (p.cases ? [p.cases] : [])))];

/** The test cases a test file's diff adds or removes, by name: the first rule that answers for a line names its case. */
export const testCases = (hunks: readonly Hunk[]): TestCase[] => {
    const out: TestCase[] = [];
    for (const h of hunks) {
        h.lines.forEach((l, i) => {
            if (l.t === "ctx") return;
            const indent = /^\s*/.exec(l.text.replace(/\t/g, "    "))![0].length;
            for (const rule of CASE_RULES) {
                const c = rule(l.text, h.lines[i + 1]?.text);
                if (c === undefined) continue;
                if (c) out.push({ name: c.name, at: l.at, t: l.t, group: c.group, indent });
                return;
            }
        });
    }
    return out;
};
