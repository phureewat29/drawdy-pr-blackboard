/** Unified diff patches, as GitHub's files endpoint returns them per file. */

export type DiffLine = {
    t: "add" | "del" | "ctx";
    /** Line number on the base side (deleted and context lines). */
    o?: number;
    /** Line number on the head side (added and context lines). */
    n?: number;
    /**
     * Where the line sits on the head side: its own number, or for a deleted
     * line the number of the head line that follows it. Ranges of head lines
     * use it to take in the deletions between them.
     */
    at: number;
    text: string;
};

export type Hunk = {
    oldStart: number;
    newStart: number;
    /** Last head line the hunk shows (newStart - 1 when it shows none). */
    newEnd: number;
    oldEnd: number;
    lines: DiffLine[];
};

const HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

type RawHunk = { oldStart: number; newStart: number; lines: Omit<DiffLine, "at">[] };

export const parsePatch = (patch: string): Hunk[] => {
    const raw: RawHunk[] = [];
    let current: RawHunk | null = null;
    let o = 0;
    let n = 0;
    for (const line of patch.split("\n")) {
        const header = HEADER.exec(line);
        if (header) {
            o = Number(header[1]);
            n = Number(header[2]);
            current = { oldStart: o, newStart: n, lines: [] };
            raw.push(current);
            continue;
        }
        if (!current || line.startsWith("\\")) continue;
        const text = line.slice(1);
        if (line.startsWith("-")) current.lines.push({ t: "del", o: o++, text });
        else if (line.startsWith("+")) current.lines.push({ t: "add", n: n++, text });
        else current.lines.push({ t: "ctx", o: o++, n: n++, text });
    }
    return raw.map((h): Hunk => {
        const heads = h.lines.filter((l) => l.n !== undefined);
        const bases = h.lines.filter((l) => l.o !== undefined);
        const newEnd = heads.length > 0 ? heads[heads.length - 1].n! : h.newStart - 1;
        const oldEnd = bases.length > 0 ? bases[bases.length - 1].o! : h.oldStart - 1;
        // A deleted line sits where the next head line is, so the lines are read back to front.
        let next = newEnd + 1;
        const lines: DiffLine[] = [];
        for (let i = h.lines.length - 1; i >= 0; i--) {
            const l = h.lines[i];
            if (l.n !== undefined) next = l.n;
            lines.push({ ...l, at: l.n ?? next });
        }
        return { oldStart: h.oldStart, newStart: h.newStart, newEnd, oldEnd, lines: lines.reverse() };
    });
};

/** A file's lines from its text: a last line break ends the last line, so an empty text has none. */
export const textLines = (text: string): string[] => {
    const lines = text.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    return lines;
};

/**
 * The hunk of a file added whole, from its text: what its patch holds, for
 * when GitHub leaves the patch out.
 */
export const addedHunks = (text: string): Hunk[] => {
    const lines = textLines(text);
    if (lines.length === 0) return [];
    return [{ oldStart: 0, newStart: 1, newEnd: lines.length, oldEnd: -1, lines: lines.map((line, i) => ({ t: "add", n: i + 1, text: line, at: i + 1 })) }];
};

/** Every line of the patch, in order. */
export const allLines = (hunks: readonly Hunk[]): DiffLine[] => hunks.flatMap((h) => h.lines);

/** The head line numbers of the added lines among some. */
export const addedLines = (lines: readonly DiffLine[]): Set<number> => new Set(lines.filter((l) => l.t === "add").map((l) => l.n!));

/** Changed lines whose head position falls in [from, to]. */
export const changesIn = (hunks: readonly Hunk[], from: number, to: number): DiffLine[] =>
    allLines(hunks).filter((l) => l.t !== "ctx" && l.at >= from && l.at <= to);
