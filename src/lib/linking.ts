/**
 * The parser worker's side of the language packs (`langs/`): which linker
 * reads a file, a parsed file's facts, and every reference a PR's linkers
 * resolve. The driver never imports this module, which reaches every linker.
 */

import { indexFile, isGeneric } from "./anyfacts.ts";
import { resolveAny } from "./anylink.ts";
import type { PrInfo } from "./github.ts";
import { LINKERS } from "./langs/linkers.ts";
import type { Facts, Linker, Reading, Ref, RulesLinker } from "./langs/pack.ts";
import { grammarOf, packOfGrammar } from "./language.ts";
import type { Sources } from "./sources.ts";
import type { Syntax } from "./syntax.ts";

const BY_PACK = new Map(LINKERS.flatMap((l) => l.packs.map((p) => [p, l] as const)));
/** Each linker by the extensions its packs' grammars parse, and those it reads in blocks (`Linker.blocks`): the resolver asks it for every name it follows. */
const BY_EXTENSION = new Map(LINKERS.flatMap((l) => [...l.packs.flatMap((p) => (p.grammars ?? []).flatMap((g) => g.extensions)), ...(l.blocks?.extensions ?? [])].map((e) => [e, l] as const)));

/** The linker of a grammar's pack. */
export const linkerOfGrammar = (grammar: string): Linker | undefined => {
    const pack = packOfGrammar(grammar);
    return pack && BY_PACK.get(pack);
};

const extensionOf = (path: string) => path.split(".").pop()?.toLowerCase() ?? "";

/** The linker that reads a file, through its grammar (`grammarOf`) or its blocks; undefined when no parser reads it. */
export const linkerOf = (path: string): Linker | undefined => BY_EXTENSION.get(extensionOf(path));

/** How a file is parsed: its extension's grammar, or for one whose code sits in blocks, its linker's reading of its text; null when no grammar reads it. */
export const readingOf = (path: string, text: string): Reading | null => {
    const blocks = linkerOf(path)?.blocks;
    if (blocks?.extensions.includes(extensionOf(path))) return blocks.read(path, text);
    const grammar = grammarOf(path);
    return grammar ? { grammar, text } : null;
};

/** The rule table that reads a file, if a rule table does. */
export const rulesOf = (path: string): RulesLinker | undefined => {
    const linker = linkerOf(path);
    return linker?.kind === "rules" ? linker : undefined;
};

/** A file's facts: null when no parser reads it (another language, `@flow`, too many errors, or blocks that can't be read cleanly). */
export const parseFile = (syntax: Syntax, path: string, text: string): Facts | null => {
    const linker = linkerOf(path);
    const reading = readingOf(path, text);
    const t = reading && syntax.parse(path, text, reading);
    if (!t || !linker) return null;
    return linker.kind === "rules" ? indexFile(path, t, linker.rules) : linker.index(path, t);
};

/** Every reference that names a unit in a PR's parsed files: each own linker's, in `LINKERS` order, then every rule table's in one pass. */
export const linkAll = (pr: PrInfo, changed: ReadonlySet<string>, sources: Sources): Ref[] => {
    const parsed = [...sources.facts.values()];
    const own = [...sources.sessions].flatMap(([linker, session]) => session.link(parsed.filter((f) => linkerOf(f.path) === linker), pr, changed, sources.exists));
    return [...own, ...resolveAny(parsed.filter(isGeneric), (f) => rulesOf(f.path)!.resolver, (path) => sources.texts.get(path), sources.exists)];
};
