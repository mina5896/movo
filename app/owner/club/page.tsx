import { connection } from "next/server";
import { Suspense } from "react";

import { draftHasChanges, getDraft, getLive } from "@/lib/db/snapshots";
import { impactFor } from "@/lib/eval/impact";

import { AutoRefresh } from "../_components/auto-refresh";
import { ClubEditor } from "./editor";

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
      <Suspense fallback={<p className="text-sm text-[var(--muted)]">Loading…</p>}>
        <Editor />
      </Suspense>
    </div>
  );
}
