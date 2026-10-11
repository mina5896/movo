import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod";

import { classify } from "./classify";
import { anthropic, EngineError } from "./client";
import { addUsage, costOf, MODELS, type Usage } from "./models";
import { buildPrompt } from "./prompt";
import type { Knowledge, Rule, Topic } from "./snapshot";

/** Effort is the main quality/latency dial for the parent-facing path. */
const ANSWER_EFFORT = (process.env.MOVO_ANSWER_EFFORT ?? "medium") as
  | "low"
  | "medium"
  | "high";

const AnswerSchema = z.object({
  reply: z.string().describe("The message to send the parent. Nothing else."),
  escalate: z
    .boolean()
    .describe("True if the owner must handle or confirm this before the parent is relied upon."),
  escalation_reason: z
    .string()
    .describe("Why this needs the owner, in one short line for the owner's inbox. Empty if not escalating."),
  next_step: z
    .string()
    .describe("What the parent has been told will happen next. Empty if the reply fully answered them."),
});

export type Turn = {
  role: "parent" | "assistant" | "owner";
  body: string;
  /** Assistant turns: the topics that reply was given, so a follow-up keeps them. */
  topics?: Topic[];
};

/** How many recent assistant turns' topics stay in scope for a follow-up. */
const CARRIED_TURNS = 2;

export type AnswerInput = {
  knowledge: Knowledge;
  history: Turn[];
  message: string;
  channel: "text" | "voice";
  parentFirstName?: string | null;
};

export type AnswerResult = {
  reply: string;
  escalate: boolean;
  escalationReason: string | null;
  nextStep: string | null;
  topics: Topic[];
  /** The rules the code injected for this turn, not a model self-report. */
  usedRules: Pick<Rule, "id" | "text">[];
  status: "ok" | "truncated" | "refusal";
  stopReason: string | null;
  usage: Usage;
  /** Classifier and answerer, each priced at its own model's rate. */
  costUsd: number;
  servedModel: string;
  latencyMs: number;
  /** Everything needed to explain this answer later without re-running it. */
  trajectory: {
    system: string;
    classifierTopics: Topic[];
    injectedRuleIds: string[];
    history: Turn[];
    message: string;
  };
};

/**
 * The one place an answer is produced. The parent chat route, the voice route
 * and the eval runner all call this - so an eval score describes the system
 * parents actually talk to, rather than a re-implementation that drifts.
 *
 * `knowledge` is passed in rather than read here: that is what lets the eval
 * harness score a draft snapshot while live traffic keeps using the published
 * one, and what makes a published edit take effect on the very next answer.
 */
export async function answer(input: AnswerInput): Promise<AnswerResult> {
  const { knowledge, history, message, channel } = input;

  const classification = await classify(knowledge, history, message);
  // A follow-up ("actually, can someone call me") is classified on its own
  // words, but the reply may still need the policies the last answers used -
  // without them the assistant would disown what it said a turn ago.
  const carried = history
    .filter((t) => t.role === "assistant" && t.topics)
    .slice(-CARRIED_TURNS)
    .flatMap((t) => t.topics!);
  const topics = [...new Set([...classification.topics, ...carried])];
  const prompt = buildPrompt(knowledge, topics);

  const channelNote =
    channel === "voice"
      ? "\n\nThis parent is on a phone call. Write the reply to be read aloud: one or two short sentences, no lists, no URLs, no markdown."
      : "";
  const nameNote = input.parentFirstName
    ? `\n\nThe parent's first name is ${input.parentFirstName}.`
    : "\n\nYou do not know this parent's first name yet. Do not invent one.";

  const system = [
    ...prompt.system.slice(0, -1),
    {
      ...prompt.system[prompt.system.length - 1],
      text: prompt.system[prompt.system.length - 1].text + nameNote + channelNote,
    },
  ];

  const started = Date.now();
  const response = await anthropic().messages.parse({
    model: MODELS.ANSWERER,
    max_tokens: 16000,
    system,
    messages: [
      ...history.map((t) => ({
        role: (t.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
        content: t.role === "owner" ? `[message from the club owner] ${t.body}` : t.body,
      })),
      { role: "user" as const, content: message },
    ],
    output_config: { format: zodOutputFormat(AnswerSchema), effort: ANSWER_EFFORT },
  });

  const latencyMs = Date.now() - started;

  // Guard the stop reason before touching content: a refusal is a graded
  // outcome with no usable reply, not an exception and not a wrong answer.
  if (response.stop_reason === "refusal") {
    return {
      reply: "",
      escalate: true,
      escalationReason: `The assistant declined to answer (${response.stop_details?.category ?? "unknown"}).`,
      nextStep: null,
      topics,
      usedRules: prompt.injectedRules.map((r) => ({ id: r.id, text: r.text })),
      status: "refusal",
      stopReason: response.stop_reason,
      usage: addUsage(classification.usage, response.usage),
      costUsd: costOf(classification.model, classification.usage) + costOf(response.model, response.usage),
      servedModel: response.model,
      latencyMs,
      trajectory: {
        system: system.map((b) => b.text).join("\n\n---\n\n"),
        classifierTopics: classification.topics,
        injectedRuleIds: prompt.injectedRules.map((r) => r.id),
        history,
        message,
      },
    };
  }

  if (!response.parsed_output) {
    throw new EngineError(
      `answerer returned no parseable output (stop_reason=${response.stop_reason})`,
      response.stop_reason === "max_tokens" ? "harness" : "unparseable",
    );
  }

  // Asserting the served model catches a silent provider substitution, which
  // would otherwise score a different system than the one under test.
  if (!response.model.startsWith(MODELS.ANSWERER)) {
    throw new EngineError(
      `expected ${MODELS.ANSWERER}, was served ${response.model}`,
      "model_mismatch",
    );
  }

  const out = response.parsed_output;
  return {
    reply: out.reply,
    escalate: out.escalate,
    escalationReason: out.escalation_reason || null,
    nextStep: out.next_step || null,
    topics,
    usedRules: prompt.injectedRules.map((r) => ({ id: r.id, text: r.text })),
    status: response.stop_reason === "max_tokens" ? "truncated" : "ok",
    stopReason: response.stop_reason ?? null,
    usage: addUsage(classification.usage, response.usage),
    costUsd: costOf(classification.model, classification.usage) + costOf(response.model, response.usage),
    servedModel: response.model,
    latencyMs,
    trajectory: {
      system: system.map((b) => b.text).join("\n\n---\n\n"),
      classifierTopics: classification.topics,
      injectedRuleIds: prompt.injectedRules.map((r) => r.id),
      history,
      message,
    },
  };
}
