/**
 * Each changed file's part of a review: its hunks, the declarations its
 * changed lines fall in (parsed units, or line patterns where no parser
 * reads it), the changed lines outside every declaration, and a test file's
 * cases.
 */

import { addedHunks, addedLines, allLines, parsePatch, type DiffLine, type Hunk } from "../diff.ts";
import type { Unit } from "../facts.ts";
import { partition } from "../fp.ts";
import type { PrFile } from "../github.ts";
import { languageOf, roleOf, type Language } from "../language.ts";
import type { Analysed, Parsed, ReviewFile } from "../model.ts";
import { changedSymbols, changeSpan, innermostByLine, looseRuns, testCases, type ChangedSymbol, type LooseChange } from "../symbols.ts";

/** A card's first line: the declaration's first line, or its first change when that comes earlier. */
export const pinFrom = (s: ChangedSymbol) => Math.min(s.from, s.start);

/**
 * A parsed file's changes: each changed line belongs to the innermost unit
 * whose range, from its first attached comment to its last line, holds the
 * line's head position (a deletion sits at the head line after it). Added
 * blank lines belong to nothing; the rest is loose.
 */
const parsedChanges = (path: string, lang: Language, parsed: Parsed, hunks: readonly Hunk[], nameOf: (u: Unit) => string) => {
    const text = parsed.flat.text.split("\n");
    const changed = allLines(hunks).filter((l) => l.t !== "ctx" && !(l.t === "add" && (text[l.at - 1] ?? "").trim() === ""));
    const owners = innermostByLine(parsed.units, text.length, (u) => [u.docLine, u.endLine]);
    const [owned, loose] = partition(changed, (l) => owners[l.at] !== undefined);
    const linesOf = new Map(parsed.units.map((u) => [u, [] as DiffLine[]]));
    for (const l of owned) linesOf.get(owners[l.at]!)!.push(l);
    const added = addedLines(changed);
    const units = parsed.units.filter((u) => linesOf.get(u)!.length > 0);
    const symbols = units.map(
        (u): ChangedSymbol => ({
            id: u.id,
            path,
            lang,
            name: u.name,
            label: nameOf(u),
            kind: u.kind,
            status: added.has(u.nameLine) ? "new" : "changed",
            start: u.startLine,
            end: u.endLine,
            ...changeSpan(linesOf.get(u)!),
        })
    );
    return { symbols, loose: looseRuns(path, loose), units };
};

/** The review's files, and the parsed unit behind each changed declaration of a parsed file, by its id. */
export const reviewFiles = (prFiles: readonly PrFile[], analysed: Analysed, heads: ReadonlyMap<string, readonly string[]>, nameOf: (u: Unit) => string): { files: ReviewFile[]; units: Map<string, Unit> } => {
    const units = new Map<string, Unit>();
    const changesOf = (f: PrFile, role: ReviewFile["role"], lang: Language, hunks: readonly Hunk[]): { symbols: ChangedSymbol[]; loose: LooseChange[] } => {
        const parsed = role === "code" && f.status !== "removed" ? analysed.facts.get(f.path) : undefined;
        if (!parsed) return role === "code" ? changedSymbols(f.path, lang, heads.get(f.path) ?? null, hunks) : { symbols: [], loose: [] };
        const found = parsedChanges(f.path, lang, parsed, hunks, nameOf);
        for (const u of found.units) units.set(u.id, u);
        return found;
    };
    const files = prFiles.map((f): ReviewFile => {
        const role = roleOf(f.path);
        const lang = languageOf(f.path);
        // A file added whole is all new: when GitHub leaves its patch out, its text read gives it.
        const whole = f.patch === undefined && f.status === "added" ? analysed.texts.get(f.path) : undefined;
        const hunks = f.patch ? parsePatch(f.patch) : whole !== undefined ? addedHunks(whole) : [];
        const found = changesOf(f, role, lang, hunks);
        return {
            path: f.path,
            ...(f.previousPath ? { previousPath: f.previousPath } : {}),
            status: f.status,
            role,
            lang,
            additions: f.additions,
            deletions: f.deletions,
            hunks,
            hasPatch: f.patch !== undefined || whole !== undefined,
            symbols: found.symbols,
            // A loose run inside the lines a change card shows is already on that card.
            loose: found.loose.filter((r) => !found.symbols.some((s) => pinFrom(s) <= r.from && r.to <= s.end)),
            cases: role === "test" ? testCases(hunks) : [],
        };
    });
    return { files, units };
};
