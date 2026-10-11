"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/owner", label: "Inbox", match: (p: string) => p === "/owner" || p.startsWith("/owner/threads") },
  { href: "/owner/club", label: "Club details & rules", match: (p: string) => p.startsWith("/owner/club") },
  { href: "/owner/tests", label: "How it's doing", match: (p: string) => p.startsWith("/owner/tests") },
];

export function OwnerNav({ attention }: { attention: React.ReactNode }) {
  const path = usePathname();
  return (
    <nav className="flex flex-wrap items-center gap-1 text-sm">
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
  );
}
