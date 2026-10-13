/** Repository paths, and the files an import specifier may stand for. */

/** A tsconfig `paths` entry: a pattern with at most one `*`, and the targets it maps to. */
export type PathMapping = { pattern: string; targets: string[] };

const CODE_EXT = [".ts", ".tsx", ".d.ts", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const JS_EXT = /\.(js|jsx|mjs|cjs)$/;
/** Components are imported by their whole name: `./Button.vue`. */
const COMPONENT_EXT = /\.(vue|svelte)$/;

export const dirOf = (path: string) => path.split("/").slice(0, -1).join("/");

export const joinPath = (dir: string, rel: string): string => {
    const parts = dir ? dir.split("/") : [];
    for (const seg of rel.split("/")) {
        if (seg === "..") parts.pop();
        else if (seg !== "." && seg !== "") parts.push(seg);
    }
    return parts.join("/");
};

/** The files a module path may be: itself (a Vue or Svelte component's too), a `.js` written for its `.ts`, with an extension added, or a folder's index. */
const expand = (base: string): string[] => {
    const out: string[] = [];
    if (CODE_EXT.some((e) => base.endsWith(e)) || COMPONENT_EXT.test(base)) out.push(base);
    if (JS_EXT.test(base)) {
        const stem = base.replace(JS_EXT, "");
        out.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`, `${stem}.d.ts`);
    }
    for (const e of CODE_EXT) out.push(`${base}${e}`);
    for (const e of CODE_EXT) out.push(`${base}/index${e}`);
    return [...new Set(out)];
};

/** The JavaScript a declaration file stands for, in the order asked for: `x.d.ts` for `x.js`, `x.mjs`, `x.cjs` or `x.jsx`; none for any other file. */
export const implementations = (path: string): string[] => {
    const m = /\.d\.([mc]?)ts$/.exec(path);
    if (!m) return [];
    const stem = path.slice(0, m.index);
    return m[1] === "m" ? [`${stem}.mjs`] : m[1] === "c" ? [`${stem}.cjs`] : [`${stem}.js`, `${stem}.mjs`, `${stem}.cjs`, `${stem}.jsx`];
};

/** What a bare specifier's `*` matches in a pattern, or null when the pattern doesn't match it. */
const starMatch = (spec: string, pattern: string): string | null => {
    const star = pattern.indexOf("*");
    if (star < 0) return spec === pattern ? "" : null;
    const [prefix, suffix] = [pattern.slice(0, star), pattern.slice(star + 1)];
    return spec.startsWith(prefix) && spec.endsWith(suffix) && spec.length >= pattern.length - 1 ? spec.slice(star, spec.length - suffix.length) : null;
};

/**
 * Repository paths an import may resolve to, in the order TypeScript and
 * bundlers try them; a bare specifier tries the tsconfig `paths`, the most
 * specific pattern first.
 */
export const moduleCandidates = (from: string, spec: string, paths: readonly PathMapping[]): { candidates: string[]; bare: boolean } => {
    if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") return { candidates: expand(joinPath(dirOf(from), spec)), bare: false };
    if (spec.startsWith("/")) return { candidates: expand(spec.slice(1)), bare: false };
    const out: string[] = [];
    for (const m of [...paths].sort((a, b) => b.pattern.replace("*", "").length - a.pattern.replace("*", "").length)) {
        const rest = starMatch(spec, m.pattern);
        if (rest === null) continue;
        for (const target of m.targets) out.push(...expand(m.pattern.includes("*") ? target.replace("*", rest) : target));
    }
    return { candidates: [...new Set(out)], bare: true };
};
