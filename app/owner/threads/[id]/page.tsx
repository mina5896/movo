import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getThread } from "@/lib/db/conversations";
import { draftImpact, type ImpactStatus } from "@/lib/eval/impact";
import { describeChange, feedbackForMessages, type FeedbackRow } from "@/lib/feedback";
import { getReview } from "@/lib/review";

import { AutoRefresh } from "../../_components/auto-refresh";
import { ImpactVerdict } from "../../_components/impact";
import { PublishButton } from "../../_components/publish-button";
import { Card, Pill, timeAgo } from "../../_components/ui";
import { CorrectButton, ProposalActions, ReplyBox, ReviewFlag } from "./client";

type Meta = { topics?: string[]; nextStep?: string | null; latencyMs?: number } | null;

async function Thread({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const thread = getThread(id);
  if (!thread) notFound();
  const fbs = feedbackForMessages(thread.messages.map((m) => m.id));
  const impact = draftImpact();

  return (
    <div className="flex flex-col gap-4">
      <AutoRefresh every={5000} />
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/owner" className="text-sm text-[var(--muted)] hover:underline">
          ← Inbox
        </Link>
        <h1 className="text-xl font-semibold">
          {thread.family.parentFirstName} {thread.family.parentLastName ?? ""}
        </h1>
        {thread.family.phone && <span className="text-sm text-[var(--muted)]">{thread.family.phone}</span>}
        {thread.status === "needs_attention" && <Pill tone="danger">needs you</Pill>}
        {thread.status === "resolved" && <Pill tone="good">resolved</Pill>}
      </div>

      {thread.attentionReason && (
        <Card className="border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm">
          <span className="font-medium">Why this needs you:</span> {thread.attentionReason}
        </Card>
      )}

      <Card className="flex flex-col gap-4 p-4">
        {thread.messages.length === 0 && <p className="text-sm text-[var(--muted)]">No messages yet.</p>}
        {thread.messages.map((m) => {
          const meta = m.meta as Meta;
          const rules = (m.usedRules as { id: string; text: string }[] | null) ?? [];
          const mine = m.role === "parent";
          const fb = fbs.filter((f) => f.messageId === m.id);
          const review = getReview(m.review);
          return (
            <div key={m.id} className={`flex flex-col ${mine ? "items-start" : "items-end"}`}>
              <div className="mb-0.5 flex items-center gap-2 text-xs text-[var(--muted)]">
                <span className="font-medium">
                  {m.role === "parent" ? thread.family.parentFirstName : m.role === "owner" ? "You" : "Assistant"}
                </span>
                <span>{m.channel === "voice" ? "📞 call" : "💬 text"}</span>
                <span>{timeAgo(m.createdAt)}</span>
                {m.escalated && <Pill tone="danger">handed to you</Pill>}
              </div>
              <div
                className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
                  mine
                    ? "bg-[var(--surface-2)]"
                    : m.role === "owner"
                      ? "bg-[var(--foreground)] text-[var(--background)]"
                      : "bg-[var(--accent-soft)]"
                }`}
              >
                {m.body}
              </div>
              {m.role === "assistant" && (
                <div className="mt-1 flex max-w-[80%] flex-col items-end gap-1">
                  {review?.state === "flagged" && !fb.some((f) => f.status === "pending") && (
                    <ReviewFlag messageId={m.id} concern={review.concern ?? ""} suggestion={review.suggestion} />
                  )}
                  {(rules.length > 0 || meta?.topics) && (
                    <details className="text-right text-xs text-[var(--muted)]">
                      <summary className="cursor-pointer">
                        {review?.state === "ok" && <span className="mr-2 text-[var(--good)]">✓ double-checked</span>}
                        {review?.state === "dismissed" && <span className="mr-2">you said this was fine ·</span>}
                        Why it said this
                      </summary>
                      <div className="mt-1 text-left">
                        {meta?.topics && <p>Topics it recognised: {meta.topics.join(", ")}</p>}
                        <p className="mt-1">Your rules it was given:</p>
                        <ul className="list-disc pl-4">
                          {rules.map((r) => (
                            <li key={r.id}>{r.text}</li>
                          ))}
                        </ul>
                      </div>
                    </details>
                  )}
                  {fb.map((f) => (
                    <Card key={f.id} className="w-full p-3 text-left text-sm">
                      <p className="text-xs text-[var(--muted)]">You said: &ldquo;{f.ownerNote}&rdquo;</p>
                      {f.proposal && (
                        <>
                          <p className="mt-1">{f.proposal.summary}</p>
                          {f.status === "pending" && (
                            <ul className="mt-1 list-disc pl-4 text-xs">
                              {f.proposal.changes.map((c, i) => (
                                <li key={i}>{describeChange(c)}</li>
                              ))}
                              <li>New test: {f.proposal.test.title} - {f.proposal.test.criteria}</li>
                            </ul>
                          )}
                        </>
                      )}
                      <div className="mt-2">
                        {f.status === "pending" && <ProposalActions feedbackId={f.id} />}
                        {f.status === "applied" && <AppliedFix fb={f} impact={impact} />}
                        {f.status === "published" && (
                          <p className="text-xs text-[var(--good)]">
                            ✓ Live for parents, with a test so this can&apos;t come back.
                          </p>
                        )}
                        {f.status === "dismissed" && <p className="text-xs text-[var(--muted)]">Discarded.</p>}
                      </div>
                    </Card>
                  ))}
                  {!fb.some((f) => f.status === "pending") && review?.state !== "flagged" && <CorrectButton messageId={m.id} />}
                </div>
              )}
            </div>
          );
        })}
      </Card>

      <Card className="p-4">
        <ReplyBox threadId={thread.id} status={thread.status} />
      </Card>
    </div>
  );
}

/** An approved fix waiting in the draft: where its check stands, and publish when it's safe. */
function AppliedFix({ fb, impact }: { fb: FeedbackRow; impact: ImpactStatus | null }) {
  if (!impact) return <p className="text-xs text-[var(--muted)]">Added to your changes.</p>;
  return (
    <div className="flex flex-col gap-2">
      {impact.state === "running" && <AutoRefresh every={4000} />}
      <ImpactVerdict impact={impact} />
      {impact.state === "done" && (
        <div className="flex flex-wrap items-center gap-3">
          <PublishButton label={fb.proposal?.summary.slice(0, 120) ?? "Correction"} harmful={impact.worse > 0} />
          <Link href="/owner/club" className="text-xs text-[var(--muted)] underline">
            See all unpublished changes
          </Link>
        </div>
      )}
    </div>
  );
}

export default function ThreadPage({ params }: PageProps<"/owner/threads/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--muted)]">Loading…</p>}>
      <Thread params={params} />
    </Suspense>
  );
}
