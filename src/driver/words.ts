/** Errors in the reader's words: for the panel's line, and as a failed open's annotation. */

import { explainGithub, githubFailure } from "../lib/github.ts";
import type { Annotation } from "../shared/protocol.ts";
import { protocolError } from "./ddp.ts";
import type { StepKey } from "./progress.ts";

/** The cause of an error whose message is already in words for the reader. */
const IN_WORDS = "in-words";

const TURN_ON = "Turn it on in Extensions › PR Blackboard › Manage permissions.";

/** A failed step's title, when its error has none of its own. */
const STEP_FAILED: Record<StepKey, string> = { pr: "Couldn't read the PR", parser: "Download failed", files: "Reading failed", link: "Couldn't find the lines", pin: "Pinning failed" };

/** An error the panel shows as it is; a failed open's annotation takes `title` over it. */
export const inWords = (message: string, title?: string): Error => Object.assign(new Error(message, { cause: IN_WORDS }), title ? { title } : {});

const isInWords = (err: unknown): err is Error => err instanceof Error && err.cause === IN_WORDS;

const titleOf = (err: Error): string | undefined => ("title" in err && typeof err.title === "string" ? err.title : undefined);

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const unauthorized = (err: unknown): boolean => protocolError(err)?.type === "unauthorized";

export const explain = (err: unknown): string => {
    const github = githubFailure(err);
    if (github) return explainGithub(github);
    if (unauthorized(err)) return `PR Blackboard needs permission for this. ${TURN_ON}`;
    if (isInWords(err)) return err.message;
    return `Something went wrong: ${messageOf(err)}`;
};

/** Why an open failed at `step`, as a CI annotation under it: what went wrong in a few words, then the words for the reader. */
export const failureOf = (err: unknown, step?: StepKey): Annotation => {
    const failure = (title: string, detail: string): Annotation => ({ level: "failure", title, detail });
    const github = githubFailure(err);
    switch (github?.kind) {
        case "rate-limited":
            return failure("GitHub rate limit reached", explainGithub(github));
        case "not-found":
            return failure("PR not found", "Check the link: PR Blackboard opens public PRs only.");
        case "network":
            return failure("Can't reach GitHub", "Check your connection and try again.");
        case "http":
            return failure(`GitHub error ${github.status}`, "Try again in a moment.");
    }
    if (unauthorized(err)) return failure("Permission needed", TURN_ON);
    if (!isInWords(err)) return failure("Something went wrong", messageOf(err));
    return failure(titleOf(err) ?? (step ? STEP_FAILED[step] : "Couldn't open the PR"), err.message);
};
