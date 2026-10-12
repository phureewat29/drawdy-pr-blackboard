/**
 * Where a Python file's code may change `sys.path`, which decides where an
 * absolute import is read from: an import that may run after the change
 * names nothing.
 */

import { child, namedChildren, textOf, type Flat } from "../../syntax.ts";

/** Builtins that read their arguments and keep no hold of them. */
const READERS = new Set("print len list tuple sorted str repr any all enumerate iter set frozenset reversed id type isinstance".split(" "));

/**
 * Where a file's code first changes `sys.path`, or might, or -1. The list
 * goes by any name: `sys.path` through `import sys as s` or any attribute
 * chain ending in `.sys` (`os.sys.path`), `from sys import path` or `*`,
 * and a name the list is assigned to. A change: any method called on it, an
 * item or slice set or deleted, an augmented assignment, the attribute
 * rebound, the list passed to any call but a builtin that only reads it
 * (`print`, `list`, `len`, ... where the file uses that name only to call
 * it), `site.addsitedir`.
 */
export const firstPathChange = (t: Flat): number => {
    // A star import, or a write through `globals()`, `vars()` or `setattr`, may give any builtin's name another meaning unseen.
    let hidden: boolean | undefined;
    const namesHidden = (): boolean => {
        if (hidden === undefined) {
            hidden = false;
            for (let x = 0; x < t.count && !hidden; x++) {
                if (t.type[x] === "wildcard_import") hidden = true;
                else if (t.type[x] === "call") {
                    const f = child(t, x, "function");
                    if (f >= 0 && t.type[f] === "identifier" && /^(?:globals|vars|setattr)$/.test(textOf(t, f))) hidden = true;
                }
            }
        }
        return hidden;
    };
    // A builtin that only reads its arguments, where the file uses its name for nothing but calls.
    const calledOnly = new Map<string, boolean>();
    const reads = (fn: number): boolean => {
        if (fn < 0 || t.type[fn] !== "identifier" || !READERS.has(textOf(t, fn)) || namesHidden()) return false;
        const name = textOf(t, fn);
        let hit = calledOnly.get(name);
        if (hit === undefined) {
            hit = true;
            for (let x = 0; x < t.count && hit; x++) if (t.type[x] === "identifier" && textOf(t, x) === name && !(t.type[t.parent[x]] === "call" && t.field[x] === "function")) hit = false;
            calledOnly.set(name, hit);
        }
        return hit;
    };
    const sysNames = new Set(["sys"]);
    const siteNames = new Set(["site"]);
    const pathNames = new Set<string>();
    for (let n = 0; n < t.count; n++) {
        if (t.type[n] === "import_statement") {
            for (const c of namedChildren(t, n)) {
                if (t.type[c] !== "aliased_import") continue;
                const name = textOf(t, child(t, c, "name")).replace(/\s+/g, "");
                if (name === "sys") sysNames.add(textOf(t, child(t, c, "alias")));
                if (name === "site") siteNames.add(textOf(t, child(t, c, "alias")));
            }
        } else if (t.type[n] === "import_from_statement") {
            const mod = child(t, n, "module_name");
            const from = mod >= 0 ? textOf(t, mod).replace(/\s+/g, "") : "";
            for (const c of namedChildren(t, n)) {
                if (c === mod) continue;
                const name = t.type[c] === "aliased_import" ? textOf(t, child(t, c, "name")) : t.type[c] === "dotted_name" ? textOf(t, c) : null;
                const local = t.type[c] === "aliased_import" ? textOf(t, child(t, c, "alias")) : name;
                // `from sys import path`, or `*`; `sys` taken from any module (`from os import sys`).
                if (from === "sys" && (t.type[c] === "wildcard_import" || name === "path")) pathNames.add(local ?? "path");
                if (name === "sys" && local) sysNames.add(local);
                if (name === "site" && local) siteNames.add(local);
            }
        }
    }
    // `sys`, by any of its names or as an attribute (`os.sys`).
    const isSys = (e: number) => e >= 0 && ((t.type[e] === "identifier" && sysNames.has(textOf(t, e))) || (t.type[e] === "attribute" && textOf(t, child(t, e, "attribute")) === "sys"));
    const isSysPath = (e: number) => e >= 0 && t.type[e] === "attribute" && isSys(child(t, e, "object")) && textOf(t, child(t, e, "attribute")) === "path";
    const isPath = (e: number) => isSysPath(e) || (e >= 0 && t.type[e] === "identifier" && pathNames.has(textOf(t, e)));
    // A name the list is assigned to, and one that name is: `search = sys.path`.
    for (let grew = true; grew; ) {
        grew = false;
        for (let n = 0; n < t.count; n++) {
            if (t.type[n] !== "assignment") continue;
            const left = child(t, n, "left");
            if (left >= 0 && t.type[left] === "identifier" && !pathNames.has(textOf(t, left)) && isPath(child(t, n, "right"))) {
                pathNames.add(textOf(t, left));
                grew = true;
            }
        }
    }
    let first = -1;
    const found = (n: number) => {
        if (first < 0 || t.start[n] < first) first = t.start[n];
    };
    for (let n = 0; n < t.count; n++) {
        const ty = t.type[n];
        if (ty === "call") {
            const fn = child(t, n, "function");
            const obj = fn >= 0 && t.type[fn] === "attribute" ? child(t, fn, "object") : -1;
            const attr = fn >= 0 && t.type[fn] === "attribute" ? textOf(t, child(t, fn, "attribute")) : "";
            // A method on the list, the list handed to a call (`prepend(sys.path, ...)`), `site.addsitedir`.
            const args = child(t, n, "arguments");
            const passed = args >= 0 && namedChildren(t, args).some((a) => isPath(a) || ((t.type[a] === "keyword_argument" || t.type[a] === "list_splat" || t.type[a] === "parenthesized_expression") && namedChildren(t, a).some(isPath)));
            if (isPath(obj) || (passed && !reads(fn)) || (attr === "addsitedir" && t.type[obj] === "identifier" && siteNames.has(textOf(t, obj)))) found(n);
        } else if (ty === "assignment" || ty === "augmented_assignment") {
            const left = child(t, n, "left");
            if (isSysPath(left) || (ty === "augmented_assignment" && isPath(left)) || (left >= 0 && t.type[left] === "subscript" && isPath(child(t, left, "value")))) found(n);
        } else if (ty === "delete_statement") {
            for (let x = n + 1; x < t.count && t.start[x] < t.end[n]; x++) {
                if (isSysPath(x) || (t.type[x] === "subscript" && isPath(child(t, x, "value")))) {
                    found(n);
                    break;
                }
            }
        }
    }
    return first;
};
