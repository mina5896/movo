export function timeAgo(sec: number): string {
  const d = Math.floor(Date.now() / 1000) - sec;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export function Card({ children, className = "", id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <div id={id} className={`rounded-2xl border border-[var(--border)] bg-[var(--surface)] ${className}`}>
      {children}
    </div>
  );
}

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "danger" | "good" | "warn" | "accent";
  children: React.ReactNode;
}) {
  const styles = {
    neutral: "bg-[var(--surface-2)] text-[var(--muted)]",
    danger: "bg-[var(--danger-soft)] text-[var(--danger)]",
    good: "bg-[var(--good-soft)] text-[var(--good)]",
    warn: "bg-[var(--warn-soft)] text-[var(--warn)]",
    accent: "bg-[var(--accent-soft)] text-[var(--accent)]",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>{children}</span>;
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** The headline score in words, for an owner who shouldn't have to read percentages. */
export function health(passRate: number): { label: string; tone: string } {
  if (passRate >= 0.9) return { label: "Doing well", tone: "text-[var(--good)]" };
  if (passRate >= 0.75) return { label: "Mostly good, a few answers to look at", tone: "text-[var(--warn)]" };
  return { label: "Needs your attention", tone: "text-[var(--danger)]" };
}
