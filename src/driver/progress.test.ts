import { describe, expect, it } from "@jest/globals";
import { createJob, MAX_ROWS, took } from "./progress.ts";

/** A job on a clock that moves only when told. */
const clocked = () => {
    let now = 0;
    return { job: createJob(() => now), tick: (ms: number) => void (now += ms) };
};

/** Each step as `state label · note meta`, its rows under it as `  state label`. */
const lines = (job: ReturnType<typeof createJob>) =>
    job.steps().flatMap((s) => [
        [s.state, s.label, s.note ? `· ${s.note}` : "", s.meta ?? ""].filter(Boolean).join(" "),
        ...(s.rows ?? []).map((r) => `  ${r.state} ${r.label}`),
        ...(s.more ? [`  and ${s.more} more`] : []),
    ]);

const FILES = Array.from({ length: 15 }, (_, i) => `src/f${i}.ts`);

describe("an open's loading steps", () => {
    it("lists every step an open shows, to do, before it starts", () => {
        expect(lines(createJob())).toEqual(["todo Reading the PR", "todo Reading the changed files", "todo Finding the lines", "todo Pinning the cards"]);
    });

    it("says what each step took once it ends, and starting a step ends the one before it", () => {
        const { job, tick } = clocked();
        job.step("pr", "active");
        job.step("pr", "active", { note: "23 GitHub requests" });
        tick(2840);
        job.step("pr", "done");
        job.reading(["src/a.ts"], 0);
        tick(40);
        job.step("pin", "active", { label: "Pinning 3 cards" });
        expect(lines(job)).toEqual(["done Reading the PR · 23 GitHub requests 2.8 s", "done Reading 1 changed file 0.1 s", "active Pinning 3 cards"]);
    });

    it("counts a step's requests while it runs, gives the time it took once it ends, and where it stopped if it fails", () => {
        const { job, tick } = clocked();
        job.step("pr", "active", { note: "GitHub requests", count: [8, 23] });
        expect(lines(job)[0]).toBe("active Reading the PR · GitHub requests 8 / 23");
        tick(2840);
        job.step("pr", "done", { note: "23 GitHub requests" });
        expect(lines(job)[0]).toBe("done Reading the PR · 23 GitHub requests 2.8 s");
        const limited = createJob();
        limited.step("pr", "active", { note: "GitHub requests", count: [9, 23] });
        limited.fail({ level: "failure", title: "GitHub rate limit reached", detail: "Try again in 12 minutes." });
        expect(lines(limited)[0]).toBe("failed Reading the PR · GitHub requests 9 / 23");
    });

    it("lists the changed files under their step while it runs, at most 10 and how many more, the next one to read under way", () => {
        const { job } = clocked();
        job.step("pr", "done");
        job.reading(FILES, 0);
        job.read("src/f0.ts", "done");
        job.read("src/f1.ts", "long");
        const files = job.steps().find((s) => s.key === "files")!;
        expect([files.label, files.state, files.meta, files.more]).toEqual(["Reading 15 changed files", "active", "2 / 15", 5]);
        expect(files.rows).toHaveLength(MAX_ROWS);
        expect(files.rows!.slice(0, 4)).toEqual([
            { label: "src/f0.ts", state: "done", file: true },
            { label: "src/f1.ts", state: "warning", file: true },
            { label: "src/f2.ts", state: "active", file: true },
            { label: "src/f3.ts", state: "todo", file: true },
        ]);
    });

    it("ends the files step once every file is read, with a warning for each kind left out, and starts linking, which counts the files it reads", () => {
        const { job, tick } = clocked();
        job.step("pr", "done");
        job.reading(["src/a.ts", "src/b.ts", "src/c.ts"], 1517);
        job.read("src/a.ts", "done");
        job.read("src/b.ts", "missing");
        tick(300);
        job.read("src/c.ts", "long");
        job.followed(31);
        expect(lines(job)).toEqual(["done Reading the PR 0.1 s", "warning Reading 3 changed files 0.3 s", "active Finding the lines 31 files", "todo Pinning the cards"]);
        expect(job.annotations().map((a) => a.title)).toEqual(["1,517 files not read", "1 file too long to read", "1 file not found"]);
        expect(job.unread()).toEqual({ left: 1517, long: ["src/c.ts"], missing: ["src/b.ts"] });
    });

    it("goes straight to linking when no changed file is read whole, and drops the steps a stored review never runs", () => {
        const none = createJob();
        none.step("pr", "done");
        none.reading([], 0);
        expect(none.steps().map((s) => `${s.key} ${s.state}`)).toEqual(["pr done", "link active", "pin todo"]);
        const stored = createJob();
        stored.step("pr", "done");
        stored.step("pin", "active", { label: "Pinning 10 cards" });
        expect(stored.steps().map((s) => `${s.key} ${s.state}`)).toEqual(["pr done", "pin active"]);
    });

    it("shows the parser's step only while a parser downloads, a row per language, and opens it again for a language an import needs later", () => {
        const { job, tick } = clocked();
        job.step("pr", "done");
        job.reading(["src/a.ts"], 0);
        job.parser("TypeScript", "active");
        expect(lines(job)).toEqual(["done Reading the PR 0.1 s", "active Downloading the parser", "  active TypeScript", "active Reading 1 changed file 0 / 1", "  active src/a.ts", "todo Finding the lines", "todo Pinning the cards"]);
        job.parser("JavaScript", "active");
        tick(500);
        job.parser("TypeScript", "done");
        expect(lines(job).slice(1, 4)).toEqual(["active Downloading 2 parsers", "  done TypeScript", "  active JavaScript"]);
        job.parser("JavaScript", "done");
        expect(lines(job)[1]).toBe("done Downloading 2 parsers 0.5 s");
        job.parser("Python", "active");
        expect(lines(job).slice(1, 5)).toEqual(["active Downloading 3 parsers", "  done TypeScript", "  done JavaScript", "  active Python"]);
    });

    it("fails at the step it is at, stops what ran beside it, keeps the failed rows, and puts why under the steps", () => {
        const { job, tick } = clocked();
        job.step("pr", "done");
        job.reading(["src/a.ts"], 0);
        job.parser("TypeScript", "active");
        tick(2400);
        job.parser("TypeScript", "failed");
        expect(job.at()).toBe("parser");
        job.fail({ level: "failure", title: "Download failed", detail: "Couldn't download the TypeScript parser from cdn.jsdelivr.net. Try again." });
        expect(lines(job)).toEqual(["done Reading the PR 0.1 s", "failed Downloading the parser 2.4 s", "  failed TypeScript", "todo Reading 1 changed file", "todo Finding the lines", "todo Pinning the cards"]);
        expect(job.annotations()).toEqual([{ level: "failure", title: "Download failed", detail: "Couldn't download the TypeScript parser from cdn.jsdelivr.net. Try again." }]);
        const read = createJob();
        read.step("pr", "active");
        expect(read.at()).toBe("pr");
        read.fail({ level: "failure", title: "GitHub rate limit reached", detail: "Try again in 12 minutes." });
        expect(read.steps().map((s) => s.state)).toEqual(["failed", "todo", "todo", "todo"]);
    });

    it("lists its warnings as the PR card does, the card limit first, and why it failed last", () => {
        const job = createJob();
        job.step("pr", "done");
        job.warn("pr", { level: "warning", title: "4 GitHub requests left", detail: "" });
        job.reading(["src/a.ts"], 12);
        job.read("src/a.ts", "done");
        job.step("link", "done");
        job.warn("pin", { level: "warning", title: "Card limit reached", detail: "" });
        job.step("pin", "active");
        job.fail({ level: "failure", title: "Pinning failed", detail: "" });
        expect(job.annotations().map((a) => a.title)).toEqual(["Card limit reached", "4 GitHub requests left", "12 files not read", "Pinning failed"]);
    });

    it("ends a step with a warning found on its way, even one found after it ended", () => {
        const job = createJob();
        job.step("pr", "done");
        job.warn("pr", null);
        expect(job.steps()[0].state).toBe("done");
        job.warn("pr", { level: "warning", title: "4 GitHub requests left", detail: "GitHub allows this network 60 an hour." });
        expect(job.steps()[0].state).toBe("warning");
    });

    it("names the step a rebuild is at: the one under way, else the last one ended", () => {
        const job = createJob();
        expect(job.current()).toBe("Reading the PR");
        job.step("pr", "active");
        job.reading(["src/a.ts"], 0);
        expect(job.current()).toBe("Reading 1 changed file");
        job.read("src/a.ts", "done");
        job.step("link", "done");
        expect(job.current()).toBe("Finding the lines");
    });

    it("gives the time a step took as CI does, a tenth of a second at least", () => {
        expect([took(40), took(420), took(2840), took(9949), took(12_345), took(64_000)]).toEqual(["0.1 s", "0.4 s", "2.8 s", "9.9 s", "12 s", "64 s"]);
    });
});
