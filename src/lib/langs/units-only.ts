/**
 * The linker of a language whose names can't be proven yet: it reads the
 * language's files into units, so a changed declaration gets a card of its
 * own, and resolves no name, so its files draw no line.
 *
 * Its rule table has units and nothing else: no scopes, bindings, sites or
 * imports, so nothing in its files refers to anything. Its resolver reads its
 * files apart from every other rule table's and names nothing, so no other
 * language's name resolves into them either. A declaration inside an ERROR
 * node is no unit: the parser recovered around it, so what holds it isn't
 * known; nor is one right before an ERROR node, where the parser recovered
 * at its end. Its lines go to the unit around it, or to its file's card.
 */

import type { LangRules } from "../anyfacts.ts";
import type { OwnResolver } from "../anylink.ts";
import { lineOf, perTree, type Flat } from "../syntax.ts";
import type { LanguagePack, RulesLinker } from "./pack.ts";

/** How a units-only language's definitions read: which are units, what their cards are called, and which join the one before. */
export type UnitRules = Pick<LangRules, "unit" | "extraUnits" | "continues" | "label">;

/** Reads its files apart from every other rule table's, and names nothing. */
const NO_NAMES: OwnResolver = { program: () => () => [] };

/** Whether a node sits inside an ERROR node. */
export const inError = (t: Flat, n: number): boolean => {
    for (let p = t.parent[n]; p >= 0; p = t.parent[p]) if (t.type[p] === "ERROR") return true;
    return false;
};

/** Whether the parser recovered from an error right after a node: the next of its siblings, comments aside, is an ERROR node. */
const errorAfter = (t: Flat, n: number): boolean => {
    let x = t.next[n];
    while (x >= 0 && /comment/.test(t.type[x])) x = t.next[x];
    return x >= 0 && t.type[x] === "ERROR";
};

/** A unit the parser's recovery leaves in doubt is none. */
const sure = <R extends { outer: number }>(t: Flat, node: number, r: R | null): r is R => r !== null && !inError(t, node) && !errorAfter(t, r.outer);

/**
 * A rule-table linker with units alone. Its test files make no link, so the
 * read tier leaves them unread (`local`), as before the language had a parser.
 */
export const unitsOnly = (packs: readonly LanguagePack[], units: string, rules: UnitRules, isImport?: (t: Flat, n: number) => boolean): RulesLinker => ({
    kind: "rules",
    packs,
    units,
    rules: {
        unit: (t, capture, node) => {
            if (inError(t, node)) return null;
            const r = rules.unit(t, capture, node);
            return sure(t, node, r) ? r : null;
        },
        ...(rules.extraUnits ? { extraUnits: (t: Flat) => rules.extraUnits!(t).filter((r) => sure(t, r.node, r)) } : {}),
        ...(rules.continues ? { continues: rules.continues } : {}),
        label: rules.label,
        scope: () => null,
        binds: () => undefined,
        identifiers: new Set(),
        role: () => ({ kind: "skip" }),
        isCallee: () => false,
        isType: () => false,
        imports: () => [],
    },
    resolver: NO_NAMES,
    ...(isImport ? { isImport } : {}),
    local: true,
});

/** The outermost comment nodes of a tree, in order. */
const commentsOf = (types: ReadonlySet<string>) =>
    perTree((t: Flat): number[] => {
        const out: number[] = [];
        for (let n = 0; n < t.count; n++) if (types.has(t.type[n]) && !(t.parent[n] >= 0 && types.has(t.type[t.parent[n]]))) out.push(n);
        return out;
    });

/**
 * Where the comments right above an offset start, read in the text rather
 * than among the tree's siblings: each comment on a line of its own, with no
 * blank line between it and what it documents. For a grammar whose tree puts
 * a comment inside the declaration before it (an indented block runs on over
 * it), or gives doc comments a type of their own.
 */
export const docAbove = (types: ReadonlySet<string>) => {
    const comments = commentsOf(types);
    return (t: Flat, at: number): number => {
        const list = comments(t);
        // The comments ending at or before `at`, nearest first: comments don't overlap, so their ends rise with their starts.
        let i = list.length - 1;
        while (i >= 0 && t.end[list[i]] > at) i--;
        let first = at;
        for (; i >= 0; i--) {
            const c = list[i];
            const between = t.text.slice(t.end[c], first);
            if (/\S/.test(between) || (between.match(/\n/g) ?? []).length > 1) break;
            const line = t.text.lastIndexOf("\n", t.start[c] - 1) + 1;
            if (/\S/.test(t.text.slice(line, t.start[c]))) break;
            first = t.start[c];
        }
        return first;
    };
};

/** The first node after a node's subtree, in tree order, or the node count. */
export const afterSubtree = (t: Flat, n: number): number => {
    let x = n;
    while (x >= 0 && t.next[x] < 0) x = t.parent[x];
    return x >= 0 ? t.next[x] : t.count;
};

/**
 * Where a node's code ends: its last token outside a comment, so not the
 * blank lines and comments an indented block runs on over. A string ends at
 * its closing quote, past the last token inside it.
 */
export const codeEnd = (t: Flat, n: number, layout: Pick<Layout, "comments" | "strings">): number => {
    for (let i = afterSubtree(t, n) - 1; i > n; i--) {
        if (t.first[i] >= 0 || t.end[i] <= t.start[i]) continue;
        let end = t.end[i];
        let comment = false;
        for (let p = t.parent[i]; p >= 0 && p !== n; p = t.parent[p]) {
            if (layout.comments.has(t.type[p])) comment = true;
            if (layout.strings.has(t.type[p])) end = t.end[p];
        }
        if (!comment && !layout.comments.has(t.type[i])) return end;
    }
    return t.end[n];
};

/** How a language's code lies: its comment and string nodes, and how a declaration's first token reads (`fun`, `@Test`). */
export type Layout = { comments: ReadonlySet<string>; strings: ReadonlySet<string>; declares: RegExp };

/** Each opening bracket's closer; a Map, since a token's type may be `constructor`. */
const OPENS = new Map([["(", ")"], ["[", "]"], ["{", "}"]]);
const CLOSES = new Set([")", "]", "}"]);

/** Each token of a node's subtree in order, comments aside and a string as one token. */
const tokensOf = (t: Flat, n: number, layout: Layout, visit: (token: number) => void) => {
    for (let i = n, end = afterSubtree(t, n); i < end; i++) {
        const comment = layout.comments.has(t.type[i]);
        const str = layout.strings.has(t.type[i]);
        if (!comment && (str || t.first[i] < 0) && t.end[i] > t.start[i]) visit(i);
        if (comment || str) i = afterSubtree(t, i) - 1;
    }
};

/** Per tree, each line's first code token, by line. */
const firstTokens = (layout: Layout) =>
    perTree((t: Flat) => {
        const first = new Int32Array(t.lineStarts.length + 1).fill(-1);
        tokensOf(t, 0, layout, (n) => {
            const line = lineOf(t, t.start[n]);
            if (first[line] < 0) first[line] = n;
        });
        return first;
    });

/**
 * Whether the code's layout agrees with the parser's range for a unit, its
 * node ending at `end`, for a grammar whose tree can be wrong with no error in
 * it (Scala's reads `a |` at a line's end as a postfix operator, so a value
 * ends a line early). The unit's brackets balance; no line inside it after
 * its name, as far left as its first, opens another declaration (it swallowed
 * the one after it); and the next line of code is no further right unless it
 * opens a declaration after a unit that is complete (else the unit ended early).
 */
export const laidOut = (layout: Layout) => {
    const firsts = firstTokens(layout);
    return (t: Flat, node: number, end: number, nameStart: number): boolean => {
        const first = firsts(t);
        const column = (n: number) => t.text.slice(t.lineStarts[lineOf(t, t.start[n]) - 1], t.start[n]).replace(/\t/g, "    ").length;
        const declares = (n: number) => layout.declares.test(t.text.slice(t.start[n], t.start[n] + 40));
        const indent = column(first[lineOf(t, t.start[node])]);
        const last = lineOf(t, end - 1);
        for (let line = lineOf(t, nameStart) + 1; line <= last; line++) if (first[line] >= 0 && column(first[line]) <= indent && declares(first[line])) return false;
        // A unit that ends on `:`, `=`, an open bracket, a comma or an operator goes on below: what follows further right is its own.
        const open = /(?:[:=({[,]|\b(?:with|extends|match|then|else|do|yield)|[-+*/%<>&|^!~?])$/.test(t.text.slice(Math.max(t.start[node], end - 40), end));
        let next = last + 1;
        while (next < first.length && first[next] < 0) next++;
        if (next < first.length && column(first[next]) > indent && (open || !declares(first[next]))) return false;
        const stack: string[] = [];
        let balanced = true;
        tokensOf(t, node, layout, (n) => {
            const ty = t.type[n];
            if (t.start[n] >= end) return;
            if (OPENS.has(ty)) stack.push(OPENS.get(ty)!);
            else if (CLOSES.has(ty) && stack.pop() !== ty) balanced = false;
        });
        return balanced && stack.length === 0;
    };
};
