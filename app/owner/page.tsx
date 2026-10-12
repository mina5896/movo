import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { listThreads, type ThreadSummary } from "@/lib/db/conversations";
import { draftImpact } from "@/lib/eval/impact";
import { latestLiveCheck } from "@/lib/eval/runner";
import { describeChildren, isLead, profileLine, stageLabel } from "@/lib/profile";

import { AutoRefresh } from "./_components/auto-refresh";
import { Card, Pill, health, timeAgo } from "./_components/ui";

/**
 * The owner's home: what needs them, which families to follow up, and whether
 * the assistant is doing well, in that order. Everything else is a click away.
 */
async function Home() {
  await connection();
  const threads = listThreads().filter((t) => t.lastMessage);
  const needsYou = (t: ThreadSummary) => t.status === "needs_attention" || t.flagged.length > 0;
  const waiting = threads.filter(needsYou);
  const leads = threads.filter((t) => !needsYou(t) && t.family.profile && isLead(t.family.profile));

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh every={5000} />
      <div>
        <h1 className="text-2xl font-semibold">{greeting()}</h1>
        <p className="mt-1 text-[var(--muted)]">
          {waiting.length === 0
            ? "Nothing needs you right now."
            : `${waiting.length} ${waiting.length === 1 ? "family needs" : "families need"} you.`}
          {leads.length > 0 && ` ${leads.length} interested in a trial or signing up.`}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section>
            <h2 className="mb-2 font-semibold">Needs you</h2>
            {waiting.length === 0 ? (
              <Card className="p-5 text-sm text-[var(--muted)]">
                ✓ All caught up. The assistant hands a conversation to you when it can&apos;t answer, and it shows up here.
              </Card>
            ) : (
              <div className="flex flex-col gap-3">
                {waiting.map((t) => (
                  <NeedsYouCard key={t.id} t={t} />
                ))}
              </div>
            )}
          </section>

          {threads.length > 0 ? (
            <section>
              <h2 className="mb-2 font-semibold">All conversations</h2>
              <Card className="divide-y divide-[var(--border)]">
                {threads.map((t) => (
                  <ConversationRow key={t.id} t={t} />
                ))}
              </Card>
            </section>
          ) : (
            <Card className="p-8 text-center text-sm text-[var(--muted)]">
              No conversations yet.{" "}
              <Link href="/" className="text-[var(--accent)] underline">
                Talk to the assistant as a parent
              </Link>{" "}
              to see one appear here.
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <section>
            <h2 className="mb-2 font-semibold">Families to follow up</h2>
            {leads.length === 0 ? (
              <Card className="p-4 text-sm text-[var(--muted)]">
                Families who want a trial or to sign up will show up here.
              </Card>
            ) : (
              <Card className="divide-y divide-[var(--border)]">
                {leads.map((t) => (
                  <LeadRow key={t.id} t={t} />
                ))}
              </Card>
            )}
          </section>
          <section>
            <h2 className="mb-2 font-semibold">The assistant</h2>
            <AssistantCard />
          </section>
        </div>
      </div>
    </div>
  );
}

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" }).format(new Date()),
  );
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function NeedsYouCard({ t }: { t: ThreadSummary }) {
  const children = t.family.profile ? describeChildren(t.family.profile.children) : "";
  return (
    <Link href={`/owner/threads/${t.id}`} className="block">
      <Card className="flex flex-col gap-2 p-4 transition hover:border-[var(--accent)]">
        <div className="flex flex-wrap items-center gap-2">
          <Avatar name={t.family.parentFirstName} />
          <span className="font-semibold">
            {t.family.parentFirstName} {t.family.parentLastName ?? ""}
          </span>
          {children && <span className="text-sm text-[var(--muted)]">· {children}</span>}
          <span className="ml-auto text-xs text-[var(--muted)]">{timeAgo(t.lastMessageAt)}</span>
        </div>
        {t.attentionReason && <p className="text-[15px]">{t.attentionReason}</p>}
        {t.flagged.length > 0 && (
          <p className="text-[15px]">
            <span className="font-medium text-[var(--warn)]">A reply may be wrong:</span> {t.flagged[0]}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white">
            {t.flagged.length > 0 && !t.attentionReason ? "Take a look" : "Reply"}
          </span>
          {t.draftReady && <span className="text-sm text-[var(--muted)]">A reply is drafted for you</span>}
        </div>
      </Card>
    </Link>
  );
}

function LeadRow({ t }: { t: ThreadSummary }) {
  const p = t.family.profile!;
  return (
    <Link href={`/owner/threads/${t.id}`} className="flex flex-col gap-0.5 px-4 py-3 text-sm hover:bg-[var(--surface-2)]">
      <div className="flex items-center gap-2">
        <span className="font-medium">{t.family.parentFirstName}</span>
        <Pill tone="good">{stageLabel(p.stage)}</Pill>
      </div>
      {profileLine(p) && <span className="text-[var(--muted)]">{profileLine(p)}</span>}
      {p.trial && <span>Trial: {p.trial}</span>}
      {p.followUp && <span className="text-[var(--muted)]">{p.followUp}</span>}
    </Link>
  );
}

function ConversationRow({ t }: { t: ThreadSummary }) {
  const line = t.family.profile ? profileLine(t.family.profile) : "";
  return (
    <Link href={`/owner/threads/${t.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--surface-2)]">
      <Avatar name={t.family.parentFirstName} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            {t.family.parentFirstName} {t.family.parentLastName ?? ""}
          </span>
          {t.channels.includes("voice") && <span className="text-xs text-[var(--muted)]">📞 called</span>}
          {(t.status === "needs_attention" || t.flagged.length > 0) && <Pill tone="danger">needs you</Pill>}
          <span className="ml-auto text-xs text-[var(--muted)]">{timeAgo(t.lastMessageAt)}</span>
        </div>
        {line && <p className="text-xs text-[var(--muted)]">{line}</p>}
        {t.lastMessage && (
          <p className="mt-0.5 truncate text-sm text-[var(--muted)]">
            {t.lastMessage.role === "parent" ? "" : t.lastMessage.role === "owner" ? "You: " : "Assistant: "}
            {t.lastMessage.body}
          </p>
        )}
      </div>
    </Link>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-sm font-semibold text-[var(--accent)]">
      {name[0]?.toUpperCase()}
    </div>
  );
}

/** How the assistant is doing, in one line, and whether changes are waiting to go out. */
function AssistantCard() {
  const check = latestLiveCheck();
  const changes = draftImpact();
  const s = check?.summary;
  const h = s ? health(s.passRate) : null;
  const toLook = s ? Object.values(s.perCase).filter((c) => c.rate < 1).length : 0;

  return (
    <Card className="flex flex-col gap-3 p-4 text-sm">
      {s && h ? (
        <div>
          <p className={`text-base font-semibold ${h.tone}`}>{h.label}</p>
          <p className="text-[var(--muted)]">
            Handled {Math.round(s.passRate * s.cases)} of {s.cases} practice conversations well · checked{" "}
            {timeAgo(check!.startedAt)}
          </p>
          {toLook > 0 && (
            <Link href="/owner/tests" className="mt-1 inline-block text-[var(--accent)] underline">
              {toLook} {toLook === 1 ? "answer" : "answers"} to look at
            </Link>
          )}
        </div>
      ) : (
        <p className="text-[var(--muted)]">
          Not checked yet.{" "}
          <Link href="/owner/tests" className="text-[var(--accent)] underline">
            Check it now
          </Link>
        </p>
      )}
      {changes && (
        <div className="border-t border-[var(--border)] pt-3">
          <p className="font-medium">You have changes waiting to go out.</p>
          <Link href="/owner/club" className="text-[var(--accent)] underline">
            {changes.state === "done" ? "Review and publish" : "Check and publish"}
          </Link>
        </div>
      )}
    </Card>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--muted)]">Loading…</p>}>
      <Home />
    </Suspense>
  );
}
