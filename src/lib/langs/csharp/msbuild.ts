/**
 * Which project compiles a C# file, as far as its MSBuild files say without
 * running anything. A file's project is the nearest folder above it holding
 * a project file named for the folder (`src/Foo/Foo.csproj`), an SDK-style
 * one (an old-style project lists its files); its MSBuild files are that
 * one, the nearest `Directory.Build.props` and `Directory.Build.targets`
 * above the project (`Directory.build.*` too, which a Windows build finds),
 * and what they import. A file is compiled for sure only when all of them
 * were read and none may take it out: a `Compile Remove` or `Exclude` that
 * matches it (whatever its condition, in a target too), an excluded
 * pattern, default items turned off, or a pattern or an import whose path
 * can't be read.
 */

import type { ModuleContext } from "../../anylink.ts";

const dirOf = (path: string) => path.split("/").slice(0, -1).join("/");
const join = (dir: string, rel: string) => (dir ? `${dir}/${rel}` : rel);

/** A path with `\`, `.` and `..` resolved; null when it leaves the repository. */
const normalize = (path: string): string | null => {
    const out: string[] = [];
    for (const seg of path.replace(/\\/g, "/").split("/")) {
        if (seg === "" || seg === ".") continue;
        if (seg !== "..") out.push(seg);
        else if (out.length === 0) return null;
        else out.pop();
    }
    return out.join("/");
};

/** A folder and the folders above it, nearest first, the repository's root ("") last. */
const above = (dir: string): string[] => {
    const parts = dir ? dir.split("/") : [];
    return parts.map((_, i) => parts.slice(0, parts.length - i).join("/")).concat("");
};

/** The project files a file may belong to, nearest first: each folder's own `<folder>.csproj`. */
export const projectCandidates = (path: string): string[] =>
    above(dirOf(path))
        .filter((d) => d !== "")
        .map((d) => `${d}/${d.split("/").pop()}.csproj`);

/** What a file's project says of its sources: the MSBuild files still to read, whether something is unknown, and what takes files out. */
export type Project = { dir: string; want: string[]; unknown: boolean; removals: RegExp[] };

const attr = (tag: string, name: string): string | null => {
    const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
    return m ? (m[1] ?? m[2]) : null;
};

/** An MSBuild glob as a regular expression over repository paths, `**` any folders, a folder everything in it; without case, as on Windows. */
const globRe = (pattern: string): RegExp => {
    let re = "";
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i];
        if (c === "*" && pattern[i + 1] === "*") {
            i++;
            if (pattern[i + 1] === "/") i++;
            re += "(?:.*/)?";
            if (pattern[i] === "*" && i === pattern.length - 1) re += ".*";
        } else if (c === "*") re += "[^/]*";
        else if (c === "?") re += "[^/]";
        else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${re}(?:/.*)?$`, "i");
};

/** Properties set with no condition in the files read so far, which an import's path may name. */
const plainProperties = (xmls: readonly string[]): Map<string, string> => {
    const props = new Map<string, string>();
    for (const xml of xmls) {
        for (const g of xml.matchAll(/<PropertyGroup(\s[^>]*)?>([\s\S]*?)<\/PropertyGroup>/gi)) {
            if (/Condition/i.test(g[1] ?? "")) continue;
            for (const p of g[2].matchAll(/<(\w+)(\s[^>]*)?>([^<]*)<\/\1>/g)) if (!/Condition/i.test(p[2] ?? "")) props.set(p[1].toLowerCase(), p[3].trim());
        }
    }
    return props;
};

const ROOT = "\u0000";

/**
 * The repository path an MSBuild path names, relative to `base` unless it
 * starts at a known folder: this file's (`$(MSBuildThisFileDirectory)`), the
 * project's, or one `GetPathOfFileAbove` finds. Null when something in it
 * can't be known; `want`, files whose answers would tell.
 */
const pathOf = (value: string, file: string, projectDir: string, base: string, props: ReadonlyMap<string, string>, ctx: ModuleContext, want: string[]): string | null => {
    let failed = false;
    let v = value.trim().replace(/\$\(\[MSBuild\]::GetPathOfFileAbove\(\s*'([^']+)'\s*,\s*'([^']*)'\s*\)\)/gi, (_, name: string, start: string) => {
        const from = pathOf(start, file, projectDir, dirOf(file), props, ctx, want);
        if (from === null) return ((failed = true), "");
        for (const d of above(from)) {
            const c = join(d, name);
            const e = ctx.exists?.(c);
            if (e) return `${ROOT}/${c}`;
            if (e === undefined) {
                want.push(c);
                return ((failed = true), "");
            }
        }
        return ((failed = true), "");
    });
    v = v.replace(/\$\((\w+)\)/g, (m, name: string) => {
        const key = name.toLowerCase();
        if (key === "msbuildthisfiledirectory") return `${ROOT}/${dirOf(file)}/`;
        if (key === "msbuildprojectdirectory") return `${ROOT}/${projectDir}`;
        const p = props.get(key);
        if (p === undefined || /[$@%]\(/.test(p)) failed = true;
        return p ?? m;
    });
    if (failed || /[$@%]\(/.test(v)) return null;
    return v.startsWith(ROOT) ? normalize(v.slice(ROOT.length)) : normalize(join(base, v));
};

/** A file's project, read from the project file and the files it brings in, as far as the reads went; null when no project file is found. */
export const projectOf = (path: string, ctx: ModuleContext): Project | null => {
    let file: string | null = null;
    for (const c of projectCandidates(path)) {
        const e = ctx.exists?.(c);
        if (e === undefined) return { dir: "", want: [], unknown: true, removals: [] };
        if (e) {
            file = c;
            break;
        }
    }
    if (file === null) return null;
    const dir = dirOf(file);
    const want: string[] = [];
    let unknown = false;
    // The SDK's default excludes: the output folders and any folder whose name starts with a dot.
    const removals: RegExp[] = [globRe(join(dir, "bin/**")), globRe(join(dir, "obj/**")), globRe(join(dir, "**/.*/**"))];
    const files: string[] = [file];
    // The nearest Directory.Build.props and .targets at or above the project's folder.
    for (const ext of ["props", "targets"]) {
        for (const d of above(dir)) {
            const cs = [`Directory.Build.${ext}`, `Directory.build.${ext}`].map((n) => join(d, n));
            const es = cs.map((c) => ctx.exists?.(c));
            const hit = cs.find((_, i) => es[i] === true);
            if (hit) files.push(hit);
            else if (es.some((e) => e === undefined)) {
                want.push(...cs.filter((_, i) => es[i] === undefined));
                unknown = true;
            } else continue;
            break;
        }
    }
    const texts: string[] = [];
    for (let i = 0; i < files.length && i < 40; i++) {
        const f = files[i];
        const raw = ctx.text(f);
        if (raw === undefined) {
            if (ctx.exists?.(f) !== false) want.push(f);
            unknown = true;
            continue;
        }
        const xml = raw.replace(/<!--[\s\S]*?-->/g, "");
        texts.push(xml);
        if (i === 0 && !/<Project\b[^>]*\bSdk\s*=|<Sdk\b[^>]*\bName\s*=|<Import\b[^>]*\bSdk\s*=/i.test(xml)) unknown = true;
        const props = plainProperties(texts);
        for (const m of xml.matchAll(/<Import\b[^>]*>/gi)) {
            const project = attr(m[0], "Project");
            if (project === null || attr(m[0], "Sdk") !== null || /Sdk\.(props|targets)$/i.test(project)) continue;
            const p = pathOf(project, f, dir, dirOf(f), props, ctx, want);
            if (p === null) unknown = true;
            else if (!files.includes(p)) files.push(p);
        }
        if (/<EnableDefault(Compile)?Items\b[^>]*>\s*false\s*</i.test(xml)) unknown = true;
        const patterns: string[] = [];
        for (const m of xml.matchAll(/<Compile\b[^>]*>/gi)) for (const a of ["Remove", "Exclude"]) patterns.push(...(attr(m[0], a) ?? "").split(";"));
        for (const m of xml.matchAll(/<(DefaultItemExcludes(?:InProjectFolder)?)\b[^>]*>([^<]*)</gi)) patterns.push(...m[2].split(";").filter((p) => !new RegExp(`^\\s*\\$\\(${m[1]}\\)\\s*$`, "i").test(p)));
        for (const p of patterns) {
            if (p.trim() === "") continue;
            const at = pathOf(p, f, dir, dir, props, ctx, want);
            if (at === null) unknown = true;
            else removals.push(globRe(at));
        }
    }
    return { dir, want: [...new Set(want)], unknown, removals };
};

/** Whether a file is compiled for sure: its project is known, every MSBuild file it reads was read, and nothing may take the file out. */
export const compiled = (path: string, ctx: ModuleContext): boolean => {
    const p = projectOf(path, ctx);
    return !!p && !p.unknown && !p.removals.some((r) => r.test(path));
};
