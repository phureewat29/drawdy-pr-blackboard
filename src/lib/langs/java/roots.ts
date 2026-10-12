/**
 * Where a Java file's package and types live. A file's package clause,
 * against its folders, gives its source root; a test root
 * (`…/src/<set>/java`) also sees `…/src/main/java`. No other root: which
 * modules a build puts beside the file, and so which copy of a class two
 * modules declare, the files don't say.
 */

import type { GFile, GImport } from "../../anyfacts.ts";
import { memoize } from "../../fp.ts";
import { child, hasToken, namedChildren, textOf, type Flat } from "../../syntax.ts";
import { dotted, namesOf, TYPE_DECLARATIONS } from "./nodes.ts";

/** The package a file's clause names; "" for the default package. */
const packageOf = (t: Flat): string => {
    const pd = namedChildren(t, 0).find((c) => t.type[c] === "package_declaration");
    const name = pd !== undefined ? namedChildren(t, pd).find((c) => t.type[c] === "scoped_identifier" || t.type[c] === "identifier") : undefined;
    return name !== undefined ? dotted(t, name).join(".") : "";
};

/** The folder a file's package starts in: its own folder less the package's folders, or null when they differ. */
const rootOf = (path: string, pkg: string): string | null => {
    const dir = path.split("/").slice(0, -1);
    const segs = pkg ? pkg.split(".") : [];
    if (segs.length > dir.length) return null;
    for (let i = 0; i < segs.length; i++) if (dir[dir.length - segs.length + i] !== segs[i]) return null;
    return dir.slice(0, dir.length - segs.length).join("/");
};

const SOURCE_SET = /^(.*\/)?src\/([^/]+)\/java$/;

/**
 * The roots a file's package and imports are read in, its own first. Never
 * another module's: which modules a build puts on the classpath, and
 * whether an unread one declares the same name, the reads can't tell.
 */
export const rootsSeen = (root: string): string[] => {
    const m = SOURCE_SET.exec(root);
    return m && m[2] !== "main" ? [root, `${m[1] ?? ""}src/main/java`] : [root];
};

/** A path under a root. */
export const inRoot = (root: string, rel: string): string => (root ? `${root}/${rel}` : rel);

/** The file, relative to its root, that a top-level type of a package is in. */
export const packageFile = (pkg: string, name: string): string => [...namesOf(pkg), `${name}.java`].join("/");

/** Where a type named by its parts lies: its package, its top-level type (the first part written with a capital, Java's convention for types) and that type's file, then the names nested in it. */
export const typeFile = (segs: readonly string[]): { pkg: string; top: string; rel: string; nested: string[] } | null => {
    if (segs.length === 0) return null;
    let i = segs.findIndex((s) => /^[A-Z]/.test(s));
    if (i < 0) i = segs.length - 1;
    return { pkg: segs.slice(0, i).join("."), top: segs[i], rel: [...segs.slice(0, i), `${segs[i]}.java`].join("/"), nested: segs.slice(i + 1) };
};

/** What a file is to Java: its package and root, its imports by kind, the type names it declares. */
export type Outline = {
    pkg: string;
    root: string | null;
    /** `import a.b.C;` */
    singles: GImport[];
    /** `import static a.b.C.m;` */
    statics: GImport[];
    /** `import static a.b.C.*;` */
    staticStars: GImport[];
    /** Every class-like declaration's name, local and nested ones too. */
    declared: ReadonlySet<string>;
    /** Its top-level types' names. */
    tops: ReadonlySet<string>;
    /** Every type parameter's name. */
    params: ReadonlySet<string>;
    /** Whether it uses Lombok, which writes members into its classes (`@Getter`, `@Data`, `@Builder`). */
    lombok: boolean;
};

export const outlineOf = memoize(
    (f: GFile): Outline => {
        const t = f.flat;
        const pkg = packageOf(t);
        const isStatic = (i: GImport) => hasToken(t, i.stmt, "static");
        const declared = new Set<string>();
        const tops = new Set<string>();
        const params = new Set<string>();
        for (let n = 0; n < t.count; n++) {
            if (TYPE_DECLARATIONS.has(t.type[n])) {
                declared.add(textOf(t, child(t, n, "name")));
                if (t.parent[n] === 0) tops.add(textOf(t, child(t, n, "name")));
            } else if (t.type[n] === "type_parameter") for (const c of namedChildren(t, n)) if (t.type[c] === "type_identifier") params.add(textOf(t, c));
        }
        return {
            pkg,
            root: rootOf(f.path, pkg),
            singles: f.imports.filter((i) => i.name !== "*" && !isStatic(i)),
            statics: f.imports.filter((i) => i.name !== "*" && isStatic(i)),
            staticStars: f.imports.filter((i) => i.name === "*" && isStatic(i)),
            declared,
            tops,
            params,
            lombok: f.imports.some((i) => i.spec === "lombok" || i.spec.startsWith("lombok.")) || t.text.includes("@lombok."),
        };
    },
    { cache: new WeakMap() }
);
