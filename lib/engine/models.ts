/**
 * Model choices, and the reasoning behind each one.
 *
 * ANSWERER is the assistant parents talk to: correctness and rule-following
 * matter more than cost here, so it is the strongest model.
 *
 * CLASSIFIER only labels a turn with topics so the right rules get injected.
 * That is a cheap, well-specified task, so it runs on the cheapest model.
 *
 * JUDGE grades eval answers. It is deliberately NOT the same model as
 * ANSWERER: a judge from the same model tends to prefer outputs that look like
 * its own. Same family is still a known limitation, recorded in DECISIONS.md.
 *
 * PARENT_SIM plays simulated parents in multi-turn eval cases.
 */
export const MODELS = {
  ANSWERER: "claude-opus-5-5",
  CLASSIFIER: "claude-haiku-5-5",
  JUDGE: "claude-sonnet-5-5",
  PARENT_SIM: "claude-sonnet-5-5",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

/**
 * USD per million tokens. Haiku 5.5's rate is for prompts up to 100K tokens,
 * which every call here stays well under.
 */
const RATES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/**
 * Cache multipliers relative to the input rate. These are the standard
 * Anthropic ratios rather than per-model published figures - verify against
 * the pricing page before quoting a cache-heavy bill to the owner.
 */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

/**
 * Cost from the tokens the API actually reported, for the model that actually
 * served the row - never a flat assumed rate, and never estimated from string
 * length. Returns 0 for an unknown model rather than guessing.
 */
export function costOf(model: string, usage: Usage | null | undefined): number {
  const rate = RATES[model];
  if (!rate || !usage) return 0;
  const perToken = rate.input / 1_000_000;
  return (
    (usage.input_tokens ?? 0) * perToken +
    (usage.output_tokens ?? 0) * (rate.output / 1_000_000) +
    (usage.cache_read_input_tokens ?? 0) * perToken * CACHE_READ_MULTIPLIER +
    (usage.cache_creation_input_tokens ?? 0) * perToken * CACHE_WRITE_MULTIPLIER
  );
}

export function addUsage(a: Usage | null, b: Usage | null): Usage {
  return {
    input_tokens: (a?.input_tokens ?? 0) + (b?.input_tokens ?? 0),
    output_tokens: (a?.output_tokens ?? 0) + (b?.output_tokens ?? 0),
    cache_read_input_tokens:
      (a?.cache_read_input_tokens ?? 0) + (b?.cache_read_input_tokens ?? 0),
    cache_creation_input_tokens:
      (a?.cache_creation_input_tokens ?? 0) + (b?.cache_creation_input_tokens ?? 0),
  };
}
