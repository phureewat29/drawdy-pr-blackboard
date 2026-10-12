/**
 * The file kinds a card shows whole, with no declarations to find: styles,
 * markup, data, docs, shell scripts and SQL. Each is a pack for its
 * extensions and colours; one that grows line patterns or a linker moves to
 * a folder of its own.
 */

import type { LanguagePack } from "./pack.ts";

const hashComments = /^\s*#(?!\[)/;

const shell: LanguagePack = {
    id: "sh",
    name: "Shell",
    extensions: ["sh", "bash", "zsh"],
    names: /^(Dockerfile|Makefile)$/i,
    fences: ["shell", "console", "shellscript"],
    highlight: { keywords: "if then else elif fi for while do done case esac function return local export in", comment: "#" },
    lines: { comments: hashComments },
};

const sql: LanguagePack = {
    id: "sql",
    name: "SQL",
    extensions: ["sql"],
    highlight: { keywords: "select from where and or not insert into values update set delete create table alter drop index join left right inner outer on group by order having limit as null is distinct union", comment: "--", types: false },
    lines: { comments: /^\s*--/ },
};

/** Markdown shows as plain text. */
export const FORMATS: readonly LanguagePack[] = [
    { id: "css", name: "CSS", extensions: ["css", "scss", "less"], highlight: { blocks: true } },
    { id: "html", name: "HTML", extensions: ["html", "xml", "svg"] },
    { id: "json", name: "JSON", extensions: ["json", "jsonc"] },
    { id: "yaml", name: "YAML", extensions: ["yml", "yaml"], highlight: { comment: "#" }, lines: { comments: hashComments } },
    { id: "toml", name: "TOML", extensions: ["toml"], highlight: { comment: "#" }, lines: { comments: hashComments } },
    { id: "md", name: "Markdown", extensions: ["md", "mdx", "rst"], fences: ["markdown"], highlight: false },
    shell,
    sql,
];
