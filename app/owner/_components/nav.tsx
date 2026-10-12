"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/owner", label: "Home", icon: "🏠", match: (p: string) => p === "/owner" || p.startsWith("/owner/threads") },
  { href: "/owner/club", label: "Club details", icon: "📋", match: (p: string) => p.startsWith("/owner/club") },
  { href: "/owner/tests", label: "How it's doing", icon: "✓", match: (p: string) => p.startsWith("/owner/tests") },
];

/** Tabs across the top on a wide screen; a bar at the bottom on a phone, where the owner usually is. */
export function OwnerNav({ attention }: { attention: React.ReactNode }) {
  const path = usePathname();
  return (
    <>
      <nav className="hidden items-center gap-1 text-sm sm:flex">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-full px-3 py-1.5 ${
              l.match(path) ? "bg-[var(--accent)] text-white" : "text-[var(--muted)] hover:bg-[var(--surface-2)]"
            }`}
          >
            {l.label}
            {l.href === "/owner" && attention}
          </Link>
        ))}
      </nav>
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-[var(--border)] bg-[var(--surface)] sm:hidden">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
              l.match(path) ? "font-semibold text-[var(--accent)]" : "text-[var(--muted)]"
            }`}
          >
            <span className="text-base leading-none">
              {l.icon}
              {l.href === "/owner" && attention}
            </span>
            {l.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
