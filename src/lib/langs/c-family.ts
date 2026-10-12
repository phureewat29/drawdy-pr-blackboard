/** What the packs of the C family share: their common keywords, and line patterns that find a declaration by keyword where there is one, else by the shape of a signature. */

import type { Lines } from "./pack.ts";

/** The keywords JavaScript, TypeScript, Java, PHP and C# have in common, for their highlighting. */
export const C_LIKE = "if else for while do switch case break continue default return new delete throw try catch finally class extends this super static public private protected const let var void null true false import export from as typeof instanceof in of async await yield function interface enum type implements package";

/** C's keywords and C++'s best known, for both: C code seldom names a thing `class`. */
export const C_KEYWORDS = "if else for while do switch case break continue default return struct union enum typedef static const void int char long short unsigned signed float double sizeof include define NULL true false class public private protected template typename namespace using virtual auto";

/** Java, Kotlin, Swift, C#, PHP, C and C++. */
export const C_FAMILY: Lines = {
    patterns: [
        { re: /^\s*(?:[\w@]+\s+)*(?:class|interface|enum|struct|object|protocol|record|extension|trait)\s+(\w+)/, kind: "class", container: true },
        { re: /^\s*(?:[\w@]+\s+)*(?:fun|func|function)\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?(\w+)\s*[(<]/, kind: "function" },
        { re: /^\s*(?:(?:public|private|protected|internal|static|final|virtual|override|async|abstract|synchronized|inline|extern|const|unsafe)\s+)*[\w<>\[\],.?*&: ]+\s+\*?(\w+)\s*\([^;]*$/, kind: "function" },
    ],
};
