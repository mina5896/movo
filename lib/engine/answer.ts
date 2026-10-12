import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod";

import { classify } from "./classify";
import { EngineError, parseStructured } from "./client";
import { describeContext, upcomingDays, type Notice } from "./context";
import { unsupportedFigures } from "./grounding";
import { addUsage, costOf, MODELS, type Usage } from "./models";
import { buildPrompt } from "./prompt";
import type { Knowledge, Rule, Topic } from "./snapshot";

export type Effort = "low" | "medium" | "high";

/** Effort is the main quality/latency dial for the parent-facing path. */
const ANSWER_EFFORT = (process.env.MOVO_ANSWER_EFFORT ?? "medium") as Effort;

/** The model and effort a reply is written with, per channel. Tests can override them to compare. */
export type Tuning = { model: string; effort: Effort };

/**
 * A caller is waiting in silence, so voice runs at low effort. Measured on 30
 * test questions asked on a call: the same 30/30 pass as medium, median turn
 * 4.1s instead of 5.0s. Sonnet at low effort was faster still (3.2s) but
 * failed 3 of 30, including two needless handoffs. See DECISIONS.md.
 */
export const TUNING: Record<"text" | "voice", Tuning> = {
  text: { model: MODELS.ANSWERER, effort: ANSWER_EFFORT },
  voice: { model: MODELS.ANSWERER, effort: (process.env.MOVO_VOICE_EFFORT ?? "low") as Effort },
};

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
  /** Defaults to the real time. Tests pin it so "tonight" means the same thing every run. */
  now?: Date;
  /** The owner's current notices. */
  notices?: Notice[];
  /** Overrides the channel's model and effort; used to compare settings, never in live traffic. */
  tuning?: Tuning;
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
  /**
   * The check in code that every price, time and date came from the club
   * details. `retried`: the first draft failed it and was rewritten.
   * `unsupported`: figures still unsupported after that, for the owner to see.
   */
  grounding: { retried: boolean; firstDraft: string | null; unsupported: string[] };
  /** The date and notices the reply was written against, so a reviewer can judge it the same way. */
  context: string;
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
  const tuning = input.tuning ?? TUNING[channel];
  const now = input.now ?? new Date();
  const notices = input.notices ?? [];
  const context = describeContext(now, notices);

  const classification = await classify(knowledge, history, message);
  // A follow-up ("actually, can someone call me") is classified on its own
  // words, but the reply may still need the policies the last answers used -
  // without them the assistant would disown what it said a turn ago.
  const carried = history
    .filter((t) => t.role === "assistant" && t.topics)
    .slice(-CARRIED_TURNS)
    .flatMap((t) => t.topics!);
  const topics = [...new Set([...classification.topics, ...carried])];
  const prompt = buildPrompt(knowledge, topics, context);

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

  const messages = [
    ...history.map((t) => ({
      role: (t.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
      content: t.role === "owner" ? `[message from the club owner] ${t.body}` : t.body,
    })),
    { role: "user" as const, content: message },
  ];
  const call = (msgs: typeof messages) =>
    parseStructured({
      model: tuning.model,
      max_tokens: 16000,
      system,
      messages: msgs,
      output_config: { format: zodOutputFormat(AnswerSchema), effort: tuning.effort },
    });

  const started = Date.now();
  let response = await call(messages);
  let usage = addUsage(classification.usage, response.usage);
  let costUsd = costOf(classification.model, classification.usage) + costOf(response.model, response.usage);

  const sources = {
    texts: [JSON.stringify(knowledge), ...notices.map((n) => n.text), ...history.map((t) => t.body), message],
    nearbyDays: upcomingDays(now, 14),
  };
  let grounding: AnswerResult["grounding"] = { retried: false, firstDraft: null, unsupported: [] };

  // One rewrite when the first draft has a figure nothing supports. Most of
  // the time that's a calculation it can show, or a guess it can drop.
  const first = response.parsed_output;
  const firstBad = first ? unsupportedFigures(first.reply, sources) : [];
  if (first && response.stop_reason !== "refusal" && firstBad.length > 0) {
    const retry = await call([
      ...messages,
      { role: "assistant", content: JSON.stringify(first) },
      {
        role: "user",
        content: `[Automatic check by the club's system, not from the parent] Your reply mentions ${firstBad.join(", ")}, which the club details, notices and conversation don't contain. Write the reply again using only figures from those. If a figure is your own calculation from the club's figures, show the working briefly. If you don't have the figure, say you'll check with the owner and escalate. Same format as before.`,
      },
    ]);
    usage = addUsage(usage, retry.usage);
    costUsd += costOf(retry.model, retry.usage);
    if (retry.parsed_output && retry.stop_reason !== "refusal") {
      response = retry;
      grounding = {
        retried: true,
        firstDraft: first.reply,
        unsupported: unsupportedFigures(retry.parsed_output.reply, sources),
      };
    } else {
      grounding = { retried: true, firstDraft: first.reply, unsupported: firstBad };
    }
  }

  const latencyMs = Date.now() - started;
  const trajectory = {
    system: system.map((b) => b.text).join("\n\n---\n\n"),
    classifierTopics: classification.topics,
    injectedRuleIds: prompt.injectedRules.map((r) => r.id),
    history,
    message,
  };

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
      usage,
      costUsd,
      servedModel: response.model,
      latencyMs,
      grounding,
      context,
      trajectory,
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
  if (!response.model.startsWith(tuning.model)) {
    throw new EngineError(
      `expected ${tuning.model}, was served ${response.model}`,
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
    usage,
    costUsd,
    servedModel: response.model,
    latencyMs,
    grounding,
    context,
    trajectory,
  };
}
