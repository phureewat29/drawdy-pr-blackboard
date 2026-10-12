/**
 * Which repository files a Python module is: a file (`a/b.py` or
 * `a/b/__init__.py`) under the one root Python searches that holds it, never
 * a standard-library module.
 */

import type { ModuleContext, ModuleTry } from "../../anylink.ts";
import { memoize } from "../../fp.ts";

/**
 * The standard library's top-level modules (Python 3.14's, and those 3.12
 * and 3.13 removed): an absolute import of one names no repository file, as
 * pyright reads them from typeshed, whatever a folder of the same name holds.
 */
const STDLIB = new Set(
    "__future__ abc aifc annotationlib antigravity argparse array ast asynchat asyncio asyncore atexit audioop base64 bdb binascii bisect builtins bz2 cProfile calendar cgi cgitb chunk cmath cmd code codecs codeop collections colorsys compileall compression concurrent configparser contextlib contextvars copy copyreg crypt csv ctypes curses dataclasses datetime dbm decimal difflib dis distutils doctest email encodings ensurepip enum errno faulthandler fcntl filecmp fileinput fnmatch fractions ftplib functools gc genericpath getopt getpass gettext glob graphlib grp gzip hashlib heapq hmac html http idlelib imaplib imghdr imp importlib inspect io ipaddress itertools json keyword lib2to3 linecache locale logging lzma mailbox mailcap marshal math mimetypes mmap modulefinder msilib msvcrt multiprocessing netrc nis nntplib nt ntpath nturl2path numbers opcode operator optparse os ossaudiodev pathlib pdb pickle pickletools pipes pkgutil platform plistlib poplib posix posixpath pprint profile pstats pty pwd py_compile pyclbr pydoc pydoc_data pyexpat queue quopri random re readline reprlib resource rlcompleter runpy sched secrets select selectors shelve shlex shutil signal site smtpd smtplib sndhdr socket socketserver spwd sqlite3 sre_compile sre_constants sre_parse ssl stat statistics string stringprep struct subprocess sunau symtable sys sysconfig syslog tabnanny tarfile telnetlib tempfile termios textwrap this threading time timeit tkinter token tokenize tomllib trace traceback tracemalloc tty turtle turtledemo types typing unicodedata unittest urllib uu uuid venv warnings wave weakref webbrowser winreg winsound wsgiref xdrlib xml xmlrpc zipapp zipfile zipimport zlib zoneinfo".split(" ")
);

/** Whether a module's file is a package, whose imported names may be its submodules. */
export const isPackage = (path: string): boolean => /(^|\/)__init__\.py$/.test(path);

/** The `__init__.py` of a file's folder and of each folder above it, nearest first: read until one is missing, they show where its package starts. */
export const packageMarkers = (path: string): string[] => {
    const dirs = path.split("/").slice(0, -1);
    const out: string[] = [];
    for (let k = dirs.length; k >= 1; k--) out.push([...dirs.slice(0, k), "__init__.py"].join("/"));
    return out;
};

/** What the files known say about where packages start, for one lookup context. */
type Layout = {
    exists: (path: string) => boolean;
    /** Known to be absent: a 404, when the reads report them; else anything not among the files given. */
    missing: (path: string) => boolean;
    /** The package root of a folder: above its topmost package, or the folder itself when it is no package; null when a marker on the way was never read. */
    rootOf: (dir: readonly string[]) => string | null;
    /** Folders that hold a top-level package of a file known, `""` aside: `src`, `Lib`, a sub-project's `python`. A file whose markers weren't all read places none. */
    sourceRoots: readonly string[];
    /** Every folder and every module (a `.py` path without it) the files known lie in. */
    shown: ReadonlySet<string>;
};

/** The layout one lookup context shows, read on its first lookup. */
const layoutOf = memoize(
    (ctx: ModuleContext): Layout => {
        const known = new Set(ctx.known);
        const exists = (path: string) => known.has(path) || ctx.text(path) !== undefined || ctx.exists?.(path) === true;
        const missing = (path: string) => (ctx.exists ? ctx.exists(path) === false : !exists(path));
        // A folder is a package, isn't, or wasn't looked at (undefined).
        const isPackageDir = (d: readonly string[]): boolean | undefined => {
            if (d.length === 0) return false;
            const marker = [...d, "__init__.py"].join("/");
            return exists(marker) ? true : missing(marker) ? false : undefined;
        };
        const rootOf = (dir: readonly string[]): string | null => {
            const here = isPackageDir(dir);
            if (here !== true) return here === false ? dir.join("/") : null;
            let top = dir;
            for (;;) {
                const above = isPackageDir(top.slice(0, -1));
                if (above === undefined) return null;
                if (!above) return top.slice(0, -1).join("/");
                top = top.slice(0, -1);
            }
        };
        const sourceRoots = new Set<string>();
        const shown = new Set<string>();
        for (const path of known) {
            const segs = path.split("/");
            for (let k = 1; k < segs.length; k++) shown.add(segs.slice(0, k).join("/"));
            if (!path.endsWith(".py")) continue;
            shown.add(path.slice(0, -3));
            const dir = segs.slice(0, -1);
            const root = isPackageDir(dir) ? rootOf(dir) : null;
            if (root !== null) sourceRoots.add(root);
        }
        if ([...known].some((p) => p.startsWith("src/"))) sourceRoots.add("src");
        sourceRoots.delete("");
        return { exists, missing, rootOf, sourceRoots: [...sourceRoots].sort(), shown };
    },
    { cache: new WeakMap() }
);

/** A module's files under a root, its package before its module file, as Python takes them. */
const filesUnder = (root: string, parts: readonly string[]): string[] => {
    const base = [...(root ? [root] : []), ...parts].join("/");
    return [`${base}/__init__.py`, `${base}.py`];
};

/**
 * Repository paths a Python module may be read from. A relative import names
 * the files beside the importing one. An absolute one names a module of the
 * standard library (no file), or files under the roots Python searches: the
 * importing file's package root (or, for a script or a test outside any
 * package, its own folder), the repository's root, and the folders that hold
 * a package of the files known (`src`, CPython's `Lib`). When two roots hold
 * the module, which one runs depends on how Python starts: it names none;
 * nor when a root may hold it, which the reads didn't find out.
 */
export const pythonModuleFiles = (from: string, spec: string, level: number, ctx: ModuleContext): string[] => {
    const dir = from.split("/").slice(0, -1);
    const parts = spec ? spec.split(".") : [];
    if (level > 0) {
        const base = [...dir.slice(0, Math.max(0, dir.length - (level - 1))), ...parts].join("/");
        return parts.length === 0 ? [base ? `${base}/__init__.py` : "__init__.py"] : [`${base}/__init__.py`, `${base}.py`];
    }
    if (parts.length === 0 || STDLIB.has(parts[0])) return [];
    const layout = layoutOf(ctx);
    const own = layout.rootOf(dir);
    if (own === null) return [];
    // A root holds the module, doesn't (its files are absent, or its first name is), or might.
    const held: string[][] = [];
    for (const root of new Set([own, "", ...layout.sourceRoots])) {
        const files = filesUnder(root, parts);
        if (files.some(layout.exists)) held.push(files.filter(layout.exists));
        else if (!files.every(layout.missing) && !(parts.length > 1 && filesUnder(root, parts.slice(0, 1)).every(layout.missing))) return [];
    }
    return held.length === 1 ? held[0] : [];
};

/**
 * What the read tier tries for a module: a relative import's files; for an
 * absolute one whose first name a known path shows under a root, every root
 * Python searches, so that a module two roots hold names none. A root is
 * tried deeper only where it holds the first name, as a package or a module
 * (a folder without `__init__.py` doesn't shadow one elsewhere). A name no
 * known path shows is a package from outside, or no link either way.
 */
export const pythonModuleTries = (from: string, spec: string, level: number, ctx: ModuleContext): ModuleTry[] => {
    if (level > 0) return [{ files: pythonModuleFiles(from, spec, level, ctx) }];
    const dir = from.split("/").slice(0, -1);
    const parts = spec ? spec.split(".") : [];
    if (parts.length === 0 || STDLIB.has(parts[0])) return [];
    const layout = layoutOf(ctx);
    const roots = [...new Set([layout.rootOf(dir) ?? "", "", ...layout.sourceRoots])];
    const under = (root: string, names: readonly string[]) => [...(root ? [root] : []), ...names].join("/");
    if (!roots.some((root) => layout.shown.has(under(root, parts.slice(0, 1))))) return [];
    // The package where its folder is known, else the module file.
    const likely = (root: string, names: readonly string[]) => {
        const [pkg, mod] = filesUnder(root, names);
        return layout.shown.has(under(root, names)) ? [pkg, mod] : [mod, pkg];
    };
    return roots.map((root) => (parts.length === 1 ? { files: likely(root, parts) } : { first: likely(root, parts.slice(0, 1)), files: likely(root, parts) }));
};
