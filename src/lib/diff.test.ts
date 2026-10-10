import { describe, expect, it } from "@jest/globals";
import { changesIn, parsePatch } from "./diff.ts";

const PATCH = ["@@ -10,4 +10,5 @@ function f() {", " a", "-b", "-c", "+B", "+C", "+D", " e", "\\ No newline at end of file"].join("\n");

describe("parsePatch", () => {
    const [hunk] = parsePatch(PATCH);

    it("numbers both sides and keeps GitHub's context", () => {
        expect(hunk).toMatchObject({ oldStart: 10, newStart: 10, newEnd: 14, oldEnd: 13 });
        expect(hunk.lines.map((l) => [l.t, l.o, l.n])).toEqual([
            ["ctx", 10, 10],
            ["del", 11, undefined],
            ["del", 12, undefined],
            ["add", undefined, 11],
            ["add", undefined, 12],
            ["add", undefined, 13],
            ["ctx", 13, 14],
        ]);
    });

    it("places deleted lines where the next head line is", () => {
        expect(hunk.lines.filter((l) => l.t === "del").map((l) => l.at)).toEqual([11, 11]);
    });

    it("finds the changes in a range of head lines, deletions included", () => {
        expect(changesIn([hunk], 11, 11).map((l) => l.t)).toEqual(["del", "del", "add"]);
    });
});
