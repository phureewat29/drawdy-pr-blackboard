/** The cause of an error whose message is already in words for the reader. */
const IN_WORDS = "in-words";

/** An error the panel shows as it is; a failed open's annotation takes `title` over it. */
export const inWords = (message: string, title?: string): Error => Object.assign(new Error(message, { cause: IN_WORDS }), title ? { title } : {});

/** The title an error in words was given, if any. */
export const titleOf = (err: Error): string | undefined => ("title" in err && typeof err.title === "string" ? err.title : undefined);

export const isInWords = (err: unknown): err is Error => err instanceof Error && err.cause === IN_WORDS;
