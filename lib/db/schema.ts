import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch())`;

/**
 * A knowledge snapshot is an immutable blob of everything the assistant is
 * allowed to know: programs, policies and behaviour rules. The answer engine
 * reads one at answer time, so a published edit can never be served stale, and
 * an eval run can name the exact bytes it scored.
 *
 * `live` is what parents get. `draft` is what the owner is editing. Publishing
 * promotes a draft; the previous live row becomes `archived`.
 */
export const snapshots = sqliteTable("snapshots", {
  id: text("id").primaryKey(),
  /** sha256 of `data` - lets an eval run pin the exact knowledge it scored. */
  hash: text("hash").notNull(),
  status: text("status", { enum: ["live", "draft", "archived"] }).notNull(),
  label: text("label").notNull(),
  /** JSON: { programs, policies, rules } - see lib/engine/snapshot.ts */
  data: text("data", { mode: "json" }).notNull(),
  basedOnId: text("based_on_id"),
  createdAt: integer("created_at").notNull().default(now),
  publishedAt: integer("published_at"),
});

/**
 * Short-lived announcements from the owner: tonight's weather call, a closed
 * field. They take effect at once rather than going through the draft and the
 * check, because "practice is cancelled tonight" is useless in four minutes,
 * and they expire by themselves so they can't go stale the way the old camp
 * dates did.
 */
export const notices = sqliteTable("notices", {
  id: text("id").primaryKey(),
  text: text("text").notNull(),
  expiresAt: integer("expires_at").notNull(),
  removedAt: integer("removed_at"),
  createdAt: integer("created_at").notNull().default(now),
});

export const families = sqliteTable("families", {
  id: text("id").primaryKey(),
  parentFirstName: text("parent_first_name").notNull(),
  parentLastName: text("parent_last_name"),
  phone: text("phone"),
  notes: text("notes"),
  createdAt: integer("created_at").notNull().default(now),
});

/**
 * One thread per family, spanning every channel. Voice and text turns land in
 * the same `messages` table tagged by channel, so a parent who starts by text
 * and then calls never has to repeat themselves, and the owner reads one
 * conversation rather than two transcripts.
 */
export const threads = sqliteTable(
  "threads",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id),
    status: text("status", { enum: ["open", "needs_attention", "resolved"] })
      .notNull()
      .default("open"),
    /** Why the assistant handed this to a human, when it did. */
    attentionReason: text("attention_reason"),
    subject: text("subject"),
    createdAt: integer("created_at").notNull().default(now),
    lastMessageAt: integer("last_message_at").notNull().default(now),
  },
  (t) => [index("threads_status_idx").on(t.status, t.lastMessageAt)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id),
    role: text("role", { enum: ["parent", "assistant", "owner"] }).notNull(),
    channel: text("channel", { enum: ["text", "voice"] }).notNull(),
    body: text("body").notNull(),
    /** Assistant turns only: did it escalate, and which snapshot/rules produced it. */
    escalated: integer("escalated", { mode: "boolean" }).notNull().default(false),
    snapshotId: text("snapshot_id").references(() => snapshots.id),
    usedRules: text("used_rules", { mode: "json" }),
    /** JSON: { usage, stopReason, latencyMs, model } */
    meta: text("meta", { mode: "json" }),
    /**
     * Assistant turns only. JSON: a second model's read of this reply, so the
     * owner is pointed at doubtful answers instead of reading every one. See
     * lib/review.ts.
     */
    review: text("review", { mode: "json" }),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("messages_thread_idx").on(t.threadId, t.createdAt)],
);

/**
 * The owner's plain-words correction on a specific assistant turn. Each one
 * becomes two durable artifacts: a scoped rule (so behaviour changes) and an
 * eval case pinned to this turn (so no future edit can silently undo it).
 * That pairing is what makes "never correct the same mistake twice" mechanical
 * rather than aspirational.
 */
export const feedback = sqliteTable("feedback", {
  id: text("id").primaryKey(),
  messageId: text("message_id")
    .notNull()
    .references(() => messages.id),
  ownerNote: text("owner_note").notNull(),
  /** JSON: the change and test proposed from the note, shown to the owner before anything is applied. */
  proposal: text("proposal", { mode: "json" }),
  /** applied: in the draft, not yet live. published: parents get it. */
  status: text("status", { enum: ["pending", "applied", "published", "dismissed"] })
    .notNull()
    .default("pending"),
  /** Rule id inside the draft snapshot, once the owner approves the proposal. */
  proposedRuleId: text("proposed_rule_id"),
  evalCaseId: text("eval_case_id").references(() => evalCases.id),
  createdAt: integer("created_at").notNull().default(now),
});

/**
 * One eval case. `turns` is a script: a single parent message, or a multi-turn
 * persona the simulated-parent agent plays out. `expectations` holds the
 * deterministic assertions (must_mention / must_not_mention / must_escalate)
 * plus the judged axes.
 */
export const evalCases = sqliteTable(
  "eval_cases",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    /** JSON string[]: topic, persona, difficulty - used to stratify the split. */
    tags: text("tags", { mode: "json" }).notNull(),
    turns: text("turns", { mode: "json" }).notNull(),
    expectations: text("expectations", { mode: "json" }).notNull(),
    source: text("source", { enum: ["seed", "generated", "feedback"] }).notNull(),
    /** Set when source = feedback: the turn the owner corrected. */
    originMessageId: text("origin_message_id").references(() => messages.id),
    /** Random stratified split, drawn once - never selected by baseline score. */
    split: text("split", { enum: ["train", "test"] }).notNull().default("test"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("eval_cases_active_idx").on(t.active)],
);

export const evalRuns = sqliteTable("eval_runs", {
  id: text("id").primaryKey(),
  snapshotId: text("snapshot_id")
    .notNull()
    .references(() => snapshots.id),
  /** Denormalised so a run stays interpretable if the snapshot row is gone. */
  snapshotHash: text("snapshot_hash").notNull(),
  label: text("label").notNull(),
  /** "oracle" and "null" are the harness self-tests, not real scores. */
  kind: text("kind", { enum: ["real", "oracle", "null"] }).notNull().default("real"),
  reps: integer("reps").notNull().default(2),
  /** Grader version is pinned per run: scores from different graders aren't comparable. */
  graderVersion: text("grader_version").notNull(),
  status: text("status", { enum: ["running", "done", "failed"] }).notNull().default("running"),
  /** JSON: per-axis means, CI half-widths, counts. Recomputed from rows, never trusted blind. */
  summary: text("summary", { mode: "json" }),
  costUsd: text("cost_usd"),
  startedAt: integer("started_at").notNull().default(now),
  finishedAt: integer("finished_at"),
});

/**
 * One scored attempt. Only attempts that produced a gradeable answer land
 * here - plumbing failures go to `evalErrors` so they can never be averaged in
 * as a model mistake.
 */
export const evalResults = sqliteTable(
  "eval_results",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => evalRuns.id),
    caseId: text("case_id")
      .notNull()
      .references(() => evalCases.id),
    rep: integer("rep").notNull(),
    reply: text("reply").notNull(),
    escalated: integer("escalated", { mode: "boolean" }).notNull().default(false),
    usedRules: text("used_rules", { mode: "json" }),
    /** JSON per axis: { correctness: {pass, reason}, ruleAdherence: {...}, ... } */
    scores: text("scores", { mode: "json" }).notNull(),
    /** A truncated answer is counted and shown, but not averaged in as wrong. */
    status: text("status", { enum: ["ok", "truncated", "refusal"] }).notNull().default("ok"),
    stopReason: text("stop_reason"),
    /** Every message, rule and judge input/output, so a surprising score is traceable. */
    trajectory: text("trajectory", { mode: "json" }),
    usage: text("usage", { mode: "json" }),
    judgeUsage: text("judge_usage", { mode: "json" }),
    /** Final successful request only - retries and backoff stay out of this column. */
    latencyMs: integer("latency_ms"),
    attempts: integer("attempts").notNull().default(1),
    servedModel: text("served_model"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("eval_results_run_idx").on(t.runId, t.caseId)],
);

/** Attempts that never produced a scorable output. Kept out of the headline. */
export const evalErrors = sqliteTable("eval_errors", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => evalRuns.id),
  caseId: text("case_id").notNull(),
  rep: integer("rep").notNull(),
  failureClass: text("failure_class", {
    enum: ["harness", "serving", "timeout", "model_mismatch", "grader", "unparseable"],
  }).notNull(),
  message: text("message").notNull(),
  attempts: integer("attempts").notNull().default(1),
  createdAt: integer("created_at").notNull().default(now),
});

/**
 * The owner's own pass/fail on a sampled answer, collected without showing
 * them the judge's verdict. Agreement between these labels and the judge is
 * what tells the owner how much to trust a judged score at all.
 */
export const calibrationLabels = sqliteTable("calibration_labels", {
  id: text("id").primaryKey(),
  resultId: text("result_id")
    .notNull()
    .references(() => evalResults.id),
  axis: text("axis").notNull(),
  ownerLabel: text("owner_label", { enum: ["pass", "fail"] }).notNull(),
  ownerNote: text("owner_note"),
  createdAt: integer("created_at").notNull().default(now),
});
