import Anthropic from "@anthropic-ai/sdk";
import type { AutoParseableOutputFormat } from "@anthropic-ai/sdk/lib/parser";
import type { Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";

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

type StructuredParams<T> = Omit<MessageCreateParamsNonStreaming, "output_config"> & {
  output_config: NonNullable<MessageCreateParamsNonStreaming["output_config"]> & { format: AutoParseableOutputFormat<T> };
};

/**
 * A structured-output call, read across every text block. The SDK's own
 * `messages.parse` parses each text block on its own, and the model now and
 * then splits its JSON over two: found while writing tests, where about 1 call
 * in 50 failed with "Unterminated string in JSON". A refusal or a cut-off
 * reply comes back with `parsed_output: null` for the caller to handle.
 */
export async function parseStructured<T>(params: StructuredParams<T>): Promise<Message & { parsed_output: T | null }> {
  const message = await anthropic().messages.create(params);
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  if (!text || message.stop_reason === "refusal" || message.stop_reason === "max_tokens") {
    return { ...message, parsed_output: null };
  }
  try {
    return { ...message, parsed_output: params.output_config.format.parse(text) };
  } catch (err) {
    throw new EngineError(`unparseable structured output: ${err instanceof Error ? err.message : err}`, "unparseable");
  }
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
