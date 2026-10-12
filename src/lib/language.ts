/** What kind of file a path is, from its name alone. */

export type Language =
    | "ts"
    | "js"
    | "py"
    | "go"
    | "rs"
    | "java"
    | "kt"
    | "swift"
    | "rb"
    | "php"
    | "cs"
    | "c"
    | "css"
    | "html"
    | "json"
    | "yaml"
    | "toml"
    | "md"
    | "sh"
    | "sql"
    | "text";

const EXTENSIONS: Record<string, Language> = {
    ts: "ts",
    tsx: "ts",
    mts: "ts",
    cts: "ts",
    js: "js",
    jsx: "js",
    mjs: "js",
    cjs: "js",
    vue: "js",
    svelte: "js",
    py: "py",
    go: "go",
    rs: "rs",
    java: "java",
    kt: "kt",
    kts: "kt",
    scala: "java",
    swift: "swift",
    rb: "rb",
    php: "php",
    cs: "cs",
    c: "c",
    h: "c",
    cc: "c",
    cpp: "c",
    hpp: "c",
    m: "c",
    css: "css",
    scss: "css",
    less: "css",
    html: "html",
    xml: "html",
    svg: "html",
    json: "json",
    jsonc: "json",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    md: "md",
    mdx: "md",
    rst: "md",
    txt: "text",
    sh: "sh",
    bash: "sh",
    zsh: "sh",
    sql: "sql",
};

export const languageOf = (path: string): Language => {
    const name = path.split("/").pop() ?? path;
    if (/^(Dockerfile|Makefile)$/i.test(name)) return "sh";
    const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
    return EXTENSIONS[ext] ?? "text";
};

/** Names a Markdown code fence gives its language by, besides file extensions. */
const FENCES: Record<string, Language> = {
    typescript: "ts",
    javascript: "js",
    python: "py",
    golang: "go",
    rust: "rs",
    kotlin: "kt",
    ruby: "rb",
    csharp: "cs",
    cpp: "c",
    shell: "sh",
    console: "sh",
    shellscript: "sh",
    markdown: "md",
};

/** The language of a fenced code block, from its info string: `ts`, `typescript`, `tsx title="x"`. */
export const languageOfFence = (info: string | undefined): Language => {
    const name = (info ?? "").trim().split(/\s+/)[0].toLowerCase();
    return FENCES[name] ?? EXTENSIONS[name] ?? "text";
};

/**
 * The part a file plays in a PR, which decides where its card goes
 * and whether it starts folded:
 * - `code`: the change itself;
 * - `test`: tests, folded to their case names;
 * - `docs` and `config`: shown after the code;
 * - `generated`: lockfiles, builds, snapshots and vendored code, folded.
 */
export type FileRole = "code" | "test" | "docs" | "config" | "generated";

const GENERATED = [
    /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock|Pipfile\.lock|Gemfile\.lock|composer\.lock|Podfile\.lock|flake\.lock)$/,
    /(^|\/)(dist|build|out|vendor|third_party|node_modules|generated|__generated__)\//,
    /\.(min\.(js|css)|map|snap|pb\.go|lock)$/,
    /(^|\/)__snapshots__\//,
    /\.generated\.[^/]+$/,
];

const TEST = [
    /(^|\/)(__tests__|__mocks__|tests?|spec|specs|e2e|testdata|fixtures)\//i,
    /\.(test|spec|e2e)\.[^/]+$/i,
    /_test\.(go|py|rb|exs?)$/,
    /(^|\/)test_[^/]+\.py$/,
    /Tests?\.(java|kt|cs|swift)$/,
];

const DOCS = [/\.(md|mdx|rst|txt|adoc)$/i, /(^|\/)(docs?|documentation)\//i, /(^|\/)(LICENSE|CHANGELOG|README|CONTRIBUTING)(\.[^/]*)?$/i];

const CONFIG = [
    /\.(json|jsonc|ya?ml|toml|ini|cfg|conf|env|properties|lock)$/i,
    /(^|\/)\.[^/]+$/,
    /(^|\/)[^/]*\.config\.[^/]+$/,
    /(^|\/)(Dockerfile|Makefile|Procfile)$/,
    // Tooling and agent folders (`.github/`, `.claude/`, `.vscode/`, `.devcontainer/`): not the change itself.
    /(^|\/)\.[^/]+\//,
];

export const roleOf = (path: string): FileRole => {
    if (GENERATED.some((re) => re.test(path))) return "generated";
    if (TEST.some((re) => re.test(path))) return "test";
    if (DOCS.some((re) => re.test(path))) return "docs";
    if (CONFIG.some((re) => re.test(path))) return "config";
    return "code";
};
