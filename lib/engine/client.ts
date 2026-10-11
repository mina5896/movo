import Anthropic from "@anthropic-ai/sdk";

const globalForClient = globalThis as unknown as { __movoAnthropic?: Anthropic };

/**
 * A bare constructor is correct here: the SDK resolves ANTHROPIC_API_KEY, then
 * ANTHROPIC_AUTH_TOKEN, then an `ant auth login` profile on disk.
 */
export function anthropic(): Anthropic {
  if (!globalForClient.__movoAnthropic) {
    globalForClient.__movoAnthropic = new Anthropic({ maxRetries: 3 });
  }
  return globalForClient.__movoAnthropic;
}

/** Thrown when a response carried no gradeable answer - never scored as wrong. */
export class EngineError extends Error {
  constructor(
    message: string,
    readonly failureClass:
      | "harness"
      | "serving"
      | "timeout"
      | "model_mismatch"
      | "grader"
      | "unparseable",
  ) {
    super(message);
    this.name = "EngineError";
  }
}
