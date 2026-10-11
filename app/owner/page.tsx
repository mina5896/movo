import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { listThreads } from "@/lib/db/conversations";

import { AutoRefresh } from "./_components/auto-refresh";
import { Card, Pill, timeAgo } from "./_components/ui";

async function Threads() {
  await connection();
  const threads = listThreads().filter((t) => t.lastMessage);
  const needsYou = (t: (typeof threads)[number]) => t.status === "needs_attention" || t.flagged.length > 0;
  const waiting = threads.filter(needsYou);
  const rest = threads.filter((t) => !needsYou(t));

  if (threads.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-[var(--muted)]">
        No conversations yet. <Link href="/" className="text-[var(--accent)] underline">Talk to the assistant as a parent</Link> to
        see one appear here.
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh every={5000} />
      <section>
        <h2 className="mb-2 text-sm font-semibold">
          Needs you {waiting.length > 0 && <span className="text-[var(--danger)]">({waiting.length})</span>}
        </h2>
        {waiting.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Nothing waiting on you.</p>
        ) : (
          <List threads={waiting} />
        )}
      </section>
      {rest.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Handled by the assistant</h2>
          <p className="mb-2 text-xs text-[var(--muted)]">
            Every reply is double-checked by a second model. Anything it doubts moves up to &ldquo;Needs you&rdquo;.
          </p>
          <List threads={rest} />
        </section>
      )}
    </div>
  );
}

function List({ threads }: { threads: ReturnType<typeof listThreads> }) {
  return (
    <Card className="divide-y divide-[var(--border)]">
      {threads.map((t) => (
        <Link key={t.id} href={`/owner/threads/${t.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--surface-2)]">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-sm font-semibold">
            {t.family.parentFirstName[0]?.toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                {t.family.parentFirstName} {t.family.parentLastName ?? ""}
              </span>
              {t.channels.includes("text") && <Pill>💬 text</Pill>}
              {t.channels.includes("voice") && <Pill>📞 call</Pill>}
              {t.status === "resolved" && <Pill tone="good">resolved</Pill>}
              <span className="ml-auto text-xs text-[var(--muted)]">{timeAgo(t.lastMessageAt)}</span>
            </div>
            {t.attentionReason && <p className="mt-0.5 text-sm text-[var(--danger)]">{t.attentionReason}</p>}
            {t.flagged.length > 0 && (
              <p className="mt-0.5 text-sm text-[var(--warn)]">
                ⚠ {t.flagged.length === 1 ? "A reply may be wrong" : `${t.flagged.length} replies may be wrong`}: {t.flagged[0]}
              </p>
            )}
            {t.lastMessage && (
              <p className="mt-0.5 truncate text-sm text-[var(--muted)]">
                {t.lastMessage.role === "parent" ? "" : t.lastMessage.role === "owner" ? "You: " : "Assistant: "}
                {t.lastMessage.body}
              </p>
            )}
          </div>
        </Link>
      ))}
    </Card>
  );
}

export default function InboxPage() {
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Inbox</h1>
      <Suspense fallback={<p className="text-sm text-[var(--muted)]">Loading…</p>}>
        <Threads />
      </Suspense>
    </div>
  );
}
