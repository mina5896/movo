import { connection } from "next/server";
import { Suspense } from "react";

import { activeNotices } from "@/lib/db/notices";
import { draftHasChanges, getDraft, getLive } from "@/lib/db/snapshots";
import { describeMoment } from "@/lib/engine/context";
import { impactFor } from "@/lib/eval/impact";

import { AutoRefresh } from "../_components/auto-refresh";
import { Card } from "../_components/ui";
import { ClubEditor } from "./editor";
import { NoticeForm, RemoveNotice } from "./notices";

async function Notices() {
  await connection();
  const live = activeNotices();
  return (
    <Card className="mb-6 flex flex-col gap-3 p-4">
      <div>
        <h2 className="font-semibold">Notices for parents</h2>
        <p className="text-sm text-[var(--muted)]">
          Tonight&apos;s weather call, a closed field. The assistant knows straight away, and the notice disappears by itself.
        </p>
      </div>
      {live.length > 0 && (
        <ul className="flex flex-col gap-2">
          {live.map((n) => (
            <li key={n.id} className="flex items-start gap-3 rounded-xl bg-[var(--accent-soft)] px-3 py-2 text-sm">
              <div className="flex-1">
                <p>{n.text}</p>
                <p className="text-xs text-[var(--muted)]">Until {describeMoment(new Date(n.expiresAt * 1000 - 60_000))}</p>
              </div>
              <RemoveNotice id={n.id} />
            </li>
          ))}
        </ul>
      )}
      <NoticeForm />
    </Card>
  );
}

async function Editor() {
  await connection();
  const live = getLive();
  const draft = getDraft();
  const hasChanges = draftHasChanges();
  const current = draft ?? live;
  const impact = hasChanges && draft ? impactFor(draft.hash) : ({ state: "none" } as const);

  return (
    <>
      {impact.state === "running" && <AutoRefresh every={4000} />}
      <ClubEditor
        key={`${current.id}:${current.hash}`}
        initial={current.data}
        live={live.data}
        hasDraft={!!draft}
        hasChanges={hasChanges}
        impact={impact}
      />
    </>
  );
}

export default function ClubPage() {
  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Club details &amp; rules</h1>
      <p className="mb-4 text-sm text-[var(--muted)]">
        Everything the assistant knows. Change it here, try it, check how answers change, then publish.
      </p>
      <Suspense fallback={null}>
        <Notices />
      </Suspense>
      <Suspense fallback={<p className="text-sm text-[var(--muted)]">Loading…</p>}>
        <Editor />
      </Suspense>
    </div>
  );
}
