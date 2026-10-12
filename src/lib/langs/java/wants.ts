/**
 * What the read tier fetches for Java's names, one file per name, in the
 * roots a file sees, its own first; the JDK's packages nowhere. For a
 * changed file, its single-type and static imports' files and the names it
 * uses that its package may declare beside it; for every other file read,
 * the java.lang names its declarations' headers write (`String`, `Error`),
 * to know its package holds none of them; for every file read, its
 * classes' supertypes, round after round.
 */

import type { GFile, GImport } from "../../anyfacts.ts";
import type { ModuleContext } from "../../anylink.ts";
import { textOf } from "../../syntax.ts";
import { JAVA_LANG, jdkPackage } from "./library.ts";
import { mayBeType, namesOf, supertypeNodes, typeParts, TYPE_DECLARATIONS } from "./nodes.ts";
import { inRoot, outlineOf, packageFile, rootsSeen, typeFile, type Outline } from "./roots.ts";

/** The bodies whose code runs: what a declaration's header (its types, parameters, bounds) never holds. */
const BODY_BLOCKS = new Set(["block", "constructor_body", "lambda_expression", "static_initializer"]);

/** How one file's names lead to files, each wanted in the first root it sees not known to lack it. */
type Lookups = {
    imported: ReadonlyMap<string, GImport>;
    /** A type of the file's own package. */
    besides: (name: string) => void;
    /** A type by its fully qualified parts. */
    byFqn: (segs: readonly string[]) => void;
    /** A type the file writes, by its parts, where the names in `declared` aren't its own: the file its first name leads to. */
    written: (segs: readonly string[], declared: ReadonlySet<string>) => void;
};

const lookupsOf = (o: Outline, root: string, ctx: ModuleContext, want: (path: string) => void): Lookups => {
    const own = rootsSeen(root);
    const imported = new Map<string, GImport>();
    for (const i of [...o.singles, ...o.statics]) imported.set(i.local, i);
    const look = (rel: string, pkg: string) => {
        if (/^javax?\./.test(`${pkg}.`) || jdkPackage(pkg)) return;
        for (const r of own) {
            if (ctx.exists?.(inRoot(r, rel)) === false) continue;
            return want(inRoot(r, rel));
        }
    };
    const byFqn = (segs: readonly string[]) => {
        const tf = typeFile(segs);
        if (tf) look(tf.rel, tf.pkg);
    };
    const besides = (name: string) => look(packageFile(o.pkg, name), o.pkg);
    const written = (segs: readonly string[], declared: ReadonlySet<string>) => {
        const [first] = segs;
        if (!first || declared.has(first) || o.params.has(first)) return;
        const i = imported.get(first);
        if (i) return byFqn([...namesOf(i.spec), ...(o.singles.includes(i) ? [first] : [])]);
        if (/^[A-Z]/.test(first)) return besides(first);
        if (segs.length > 1) byFqn(segs);
    };
    return { imported, besides, byFqn, written };
};

/** A changed file's imports, and the types it names that it neither declares nor imports. */
const wantNamesUsed = (f: GFile, o: Outline, look: Lookups) => {
    const t = f.flat;
    for (const i of o.singles) look.byFqn([...namesOf(i.spec), i.local]);
    for (const i of [...o.statics, ...o.staticStars]) look.byFqn(namesOf(i.spec));
    for (const s of f.sites) {
        if (s.shape !== "bare" || !/^[A-Z]/.test(s.name) || !mayBeType(t, s.node)) continue;
        if (!o.declared.has(s.name) && !o.params.has(s.name) && !look.imported.has(s.name)) look.besides(s.name);
    }
    // A qualified type, `a.b.Foo` or `Outer.Inner`.
    for (let n = 0; n < t.count; n++) if (t.type[n] === "scoped_type_identifier" && t.type[t.parent[n]] !== "scoped_type_identifier") look.written(typeParts(t, n), o.declared);
};

/** The java.lang names a declaration's header writes, outside the code its bodies run. */
const wantHeaderJavaLang = (f: GFile, o: Outline, look: Lookups) => {
    const t = f.flat;
    for (let n = 0; n < t.count; n++) {
        if (t.type[n] !== "type_identifier" || !JAVA_LANG.has(textOf(t, n)) || o.declared.has(textOf(t, n)) || look.imported.has(textOf(t, n))) continue;
        let x = t.parent[n];
        while (x > 0 && !BODY_BLOCKS.has(t.type[x])) x = t.parent[x];
        if (x <= 0) look.besides(textOf(t, n));
    }
};

/** A class's supertypes, written where its members, and so a nested type of its own, aren't in scope; a changed file's anonymous classes' too. */
const wantSupertypes = (f: GFile, o: Outline, look: Lookups, changed: boolean) => {
    const t = f.flat;
    for (let n = 0; n < t.count; n++) if (TYPE_DECLARATIONS.has(t.type[n]) || (changed && t.type[n] === "class_body" && t.type[t.parent[n]] === "object_creation_expression")) for (const s of supertypeNodes(t, n)) look.written(typeParts(t, s), o.tops);
};

/** The files Java's names need, given the files read and what the reads found so far; asked again after each round of reads. */
export const javaWants = (files: readonly GFile[], ctx: ModuleContext, changed: (path: string) => boolean): string[] => {
    const out: string[] = [];
    const want = (path: string) => void out.push(path);
    for (const f of files) {
        const o = outlineOf(f);
        // A file of a JDK package names nothing (see `resolver.ts`): nothing to read for it.
        if (o.root === null || jdkPackage(o.pkg)) continue;
        const look = lookupsOf(o, o.root, ctx, want);
        const isChanged = changed(f.path);
        if (isChanged) wantNamesUsed(f, o, look);
        else wantHeaderJavaLang(f, o, look);
        wantSupertypes(f, o, look, isChanged);
    }
    return [...new Set(out)];
};
