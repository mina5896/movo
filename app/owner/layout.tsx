import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { attentionCount } from "@/lib/db/conversations";

import { OwnerNav } from "./_components/nav";

async function AttentionBadge() {
  await connection();
  const n = attentionCount();
  if (n === 0) return null;
  return (
    <span className="ml-1.5 rounded-full bg-[var(--danger)] px-1.5 py-0.5 text-[10px] font-semibold text-white">{n}</span>
  );
}

export default function OwnerLayout({ children }: LayoutProps<"/owner">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-white">⚽</span>
            Riverside Kickers
          </div>
          {/* The active tab depends on the URL, which only exists at request time. */}
          <Suspense fallback={<div className="h-8" />}>
            <OwnerNav
              attention={
                <Suspense fallback={null}>
                  <AttentionBadge />
                </Suspense>
              }
            />
          </Suspense>
          <Link href="/" className="text-sm text-[var(--accent)] hover:underline">
            Parent view →
          </Link>
        </div>
      </header>
      {/* Bottom padding on a phone keeps the last item clear of the tab bar. */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-24 sm:pb-6">{children}</main>
    </div>
  );
}
