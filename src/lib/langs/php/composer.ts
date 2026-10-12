/**
 * Where Composer's autoloader looks for a class: the PSR-4 map of the
 * repository's root `composer.json` (`autoload` and `autoload-dev`), the
 * longest namespace prefix first, each of its folders in order, then the
 * fallback folders; the first file that exists is the one it loads. A class
 * no prefix maps (a Composer package's, PHP's own) is no file of the
 * repository's, and names nothing.
 */

import { memoize } from "../../fp.ts";

type Prefix = { prefix: string; dirs: string[] };

/** A folder as the map writes it, `src/`, as a path prefix; "" for the root. */
const folder = (dir: string): string => `${dir}/`.replace(/^(\.?\/)+/, "").replace(/\/+$/, "/");

/** The PSR-4 prefixes of a `composer.json`, the longest first; none when it isn't JSON. */
const prefixesOf = memoize((text: string): Prefix[] => {
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch {
        return [];
    }
    const map = new Map<string, string[]>();
    for (const section of ["autoload", "autoload-dev"]) {
        const psr4 = (json as Record<string, Record<string, unknown> | undefined> | null)?.[section]?.["psr-4"];
        if (!psr4) continue;
        for (const [prefix, dirs] of Object.entries(psr4)) {
            const list = (Array.isArray(dirs) ? dirs : [dirs]).filter((d): d is string => typeof d === "string" && !d.startsWith("/") && !d.includes(".."));
            map.set(prefix, [...(map.get(prefix) ?? []), ...list.map(folder)]);
        }
    }
    return [...map].map(([prefix, dirs]) => ({ prefix, dirs })).sort((a, b) => b.prefix.length - a.prefix.length);
});

/** The files Composer tries for a class, in order: `Foo\Bar\Baz` under `"Foo\\": "src/"` is `src/Bar/Baz.php`. Prefixes match case for case, as Composer's do. */
export const classFiles = (composerJson: string | undefined, fqn: string): string[] => {
    if (composerJson === undefined) return [];
    const out: string[] = [];
    for (const { prefix, dirs } of prefixesOf(composerJson)) {
        if (prefix !== "" && (!prefix.endsWith("\\") || !fqn.startsWith(prefix))) continue;
        const rest = fqn.slice(prefix.length);
        if (!/^\w+(\\\w+)*$/.test(rest)) continue;
        for (const d of dirs) out.push(`${d}${rest.replace(/\\/g, "/")}.php`);
    }
    return out;
};
