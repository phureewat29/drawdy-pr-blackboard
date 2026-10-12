import { describe, expect, it } from "@jest/globals";
import { LIMITS, type Review } from "../lib/model.ts";
import { READ } from "../lib/sources.ts";
import { reviewOf, honoFixture } from "../test/fixture.ts";
import { cardLimit, listCut, noDiff, notFound, notRead, quotaLow, SAID, tooLong, warningsOf } from "./warnings.ts";

describe("what a board can't show", () => {
    it("names the limits the board and the reads have", () => {
        expect(SAID).toEqual({ cards: LIMITS.cards, code: READ.code, tests: READ.tests, chars: READ.chars });
    });

    it("says each in a short title and a plain detail line, numbers grouped and plurals right", () => {
        expect(cardLimit({ functions: 7758, files: 2151 })).toEqual({ level: "warning", title: "Card limit reached", detail: "The board holds 32 cards: 7,758 functions and 2,151 files not pinned." });
        expect(cardLimit({ functions: 1, files: 0 })?.detail).toBe("The board holds 32 cards: 1 function not pinned.");
        expect(cardLimit({ functions: 0, files: 0 })).toBeNull();
        expect(notRead(1517)).toEqual({ level: "warning", title: "1,517 files not read", detail: "PR Blackboard reads up to 40 code and 40 test files, so some cards have no lines." });
        expect(notRead(0)).toBeNull();
        expect(tooLong(["a.rs"])).toEqual({ level: "warning", title: "1 file too long to read", detail: "Over 400,000 characters, so its cards have no lines." });
        expect(tooLong(["a.rs", "b.rs", "c.rs", "d.ts"])?.title).toBe("4 files too long to read");
        expect(notFound(["a.ts", "b.ts"])).toEqual({ level: "warning", title: "2 files not found", detail: "GitHub didn't send them, so their cards have no lines." });
        expect([tooLong([]), notFound([])]).toEqual([null, null]);
    });

    it("warns of GitHub requests running low, at 10 left or fewer, until the count resets", () => {
        const resetAt = new Date(2026, 9, 12, 14, 5).getTime();
        const now = resetAt - 38 * 60_000;
        expect(quotaLow({ left: 11, limit: 60, resetAt }, now)).toBeNull();
        // The reset in the reader's own clock: `2:05 PM`, or `14:05`.
        const at = new Date(resetAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
        expect(quotaLow({ left: 4, limit: 60, resetAt }, now)).toEqual({ level: "warning", title: "4 GitHub requests left", detail: `GitHub allows this network 60 an hour. Resets at ${at}.` });
        expect(quotaLow({ left: 1, limit: 60, resetAt }, now)?.title).toBe("1 GitHub request left");
        expect(quotaLow({ left: 0, limit: 60, resetAt }, now)?.title).toBe("No GitHub requests left");
        expect(quotaLow({ left: 4, limit: 60, resetAt: 0 }, now)?.detail).toBe("GitHub allows this network 60 an hour.");
        expect(quotaLow({ left: 4, limit: 60, resetAt }, resetAt + 1)).toBeNull();
        expect(quotaLow(null, now)).toBeNull();
    });

    it("finds in a review the files past GitHub's list, the diffs GitHub left out, and none on a review that has all", async () => {
        const review = await reviewOf(honoFixture());
        expect([listCut(review), noDiff(review)]).toEqual([null, null]);
        const cut: Review = { ...review, pr: { ...review.pr, changedFiles: 4512 } };
        expect(listCut(cut)).toEqual({ level: "warning", title: "GitHub lists 4 of 4,512 files", detail: "The other 4,508 aren't on the board." });
        const bare: Review = { ...review, files: review.files.map((f, i) => (i < 2 ? { ...f, hasPatch: false } : f)) };
        expect(noDiff(bare)).toEqual({ level: "warning", title: "No diff for 2 files", detail: "GitHub leaves out diffs too large to show." });
    });

    it("lists them for the PR card as the loading view does, the card limit first", async () => {
        const review = await reviewOf(honoFixture());
        expect(warningsOf(review, undefined, null, 0)).toEqual([]);
        const big: Review = { ...review, unpinned: { functions: 7758, files: 2151 } };
        expect(warningsOf(big, { left: 1517, long: ["src/compose.ts"], missing: [] }, { left: 2, limit: 60, resetAt: 0 }, 0).map((w) => w.title)).toEqual([
            "Card limit reached",
            "2 GitHub requests left",
            "1,517 files not read",
            "1 file too long to read",
        ]);
    });
});
