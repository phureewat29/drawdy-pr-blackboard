/** The cause of an error whose message is already in words for the reader. */
const IN_WORDS = "in-words";

/** An error the panel shows as it is. */
export const inWords = (message: string): Error => new Error(message, { cause: IN_WORDS });

export const isInWords = (err: unknown): err is Error => err instanceof Error && err.cause === IN_WORDS;
