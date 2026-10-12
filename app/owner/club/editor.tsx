"use client";

import { useState, useTransition } from "react";

import type { Knowledge, Program, Policy, Rule, Topic } from "@/lib/engine/snapshot";
import type { ImpactStatus } from "@/lib/eval/impact";

import { ImpactVerdict } from "../_components/impact";

import {
  checkImpactAction,
  discardDraftAction,
  publishDraftAction,
  saveDraftAction,
  tryDraftAction,
} from "../actions";

const TOPIC_LABELS: Record<Topic, string> = {
  pricing: "prices",
  schedule: "schedule",
  registration: "signing up",
  trial: "free trial",
  siblings: "siblings",
  refunds: "refunds",
  weather: "weather",
  late_pickup: "late pickup",
  location: "location",
  tryouts: "tryouts",
  camp: "summer camp",
  injury: "injuries",
  payment_dispute: "payment disputes",
  financial_aid: "financial aid",
  coach_concern: "coach concerns",
  other: "anything else",
};

const PROGRAM_FIELDS = ["name", "ages", "schedule", "price", "availability", "notes"] as const;

const FIELD_LABELS: Record<(typeof PROGRAM_FIELDS)[number], { short: string; long: string }> = {
  name: { short: "Name", long: "Name" },
  ages: { short: "Ages", long: "Ages" },
  schedule: { short: "When", long: "When" },
  price: { short: "Price", long: "Price" },
  availability: { short: "Spaces", long: "Spaces (e.g. a full class, a waitlist)" },
  notes: { short: "Also", long: "Anything else parents should know" },
};

/** One program, policy or rule as parents would hear it, opening into a form to edit. */
function ItemCard({
  title,
  changed,
  open,
  onToggle,
  summary,
  children,
}: {
  title: string;
  changed: boolean;
  open: boolean;
  onToggle: () => void;
  summary: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border p-3 ${changed ? "border-[var(--warn)]" : "border-[var(--border)]"}`}>
      <div className="mb-1 flex items-center gap-2">
        <span className="font-medium">{title}</span>
        {changed && <span className="text-xs font-medium text-[var(--warn)]">changed</span>}
        <button onClick={onToggle} className="ml-auto text-sm text-[var(--accent)] hover:underline">
          {open ? "Done" : "Edit"}
        </button>
      </div>
      {open ? children : summary}
    </div>
  );
}

export function ClubEditor({
  initial,
  live,
  hasDraft,
  hasChanges,
  impact,
}: {
  initial: Knowledge;
  live: Knowledge;
  hasDraft: boolean;
  hasChanges: boolean;
  impact: ImpactStatus;
}) {
  const [k, setK] = useState<Knowledge>(initial);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [publishLabel, setPublishLabel] = useState("");
  // Cards show what parents are told; a card opens for editing only when asked.
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setEditing((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function update(fn: (draft: Knowledge) => void) {
    setK((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setDirty(true);
  }

  function save() {
    setError(null);
    start(async () => {
      const r = await saveDraftAction(k);
      if (r.error) setError(r.error);
      else setDirty(false);
    });
  }

  const liveProgram = (id: string) => live.programs.find((p) => p.id === id);
  const livePolicy = (id: string) => live.policies.find((p) => p.id === id);
  const liveRule = (id: string) => live.rules.find((r) => r.id === id);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-6">
        <StatusBar
          dirty={dirty}
          hasChanges={hasChanges}
          hasDraft={hasDraft}
          impact={impact}
          pending={pending}
          error={error}
          publishLabel={publishLabel}
          setPublishLabel={setPublishLabel}
          onSave={save}
          onDiscard={() =>
            start(async () => {
              await discardDraftAction();
              setK(live);
              setDirty(false);
            })
          }
          onCheck={() => start(() => checkImpactAction())}
          onPublish={() => start(() => publishDraftAction(publishLabel || "Updated club details"))}
        />

        <Section title="Programs" hint="Prices, ages, times and spaces. Parents are told exactly what's written here.">
          {k.programs.map((p, i) => {
            const lp = liveProgram(p.id);
            const changed = PROGRAM_FIELDS.some((f) => (lp?.[f] ?? "") !== (p[f] ?? ""));
            return (
              <ItemCard
                key={p.id}
                title={`${p.name} · ages ${p.ages}`}
                changed={changed}
                open={editing.has(p.id)}
                onToggle={() => toggle(p.id)}
                summary={
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                    {PROGRAM_FIELDS.filter((f) => f !== "name" && f !== "ages" && p[f]).map((f) => (
                      <div key={f} className="contents">
                        <dt className="text-[var(--muted)]">{FIELD_LABELS[f].short}</dt>
                        <dd>{p[f]}</dd>
                      </div>
                    ))}
                  </dl>
                }
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  {PROGRAM_FIELDS.map((field) => (
                    <Field
                      key={field}
                      label={FIELD_LABELS[field].long}
                      value={p[field] ?? ""}
                      changed={(lp?.[field] ?? "") !== (p[field] ?? "")}
                      wide={field === "schedule" || field === "availability" || field === "notes"}
                      onChange={(v) => update((d) => void ((d.programs[i] as Program)[field] = v))}
                    />
                  ))}
                </div>
              </ItemCard>
            );
          })}
        </Section>

        <Section title="Policies" hint="Refunds, weather, late pickup and the rest. Each one only comes up when a parent asks about it.">
          {k.policies.map((p, i) => (
            <ItemCard
              key={p.id}
              title={p.name}
              changed={livePolicy(p.id)?.detail !== p.detail}
              open={editing.has(p.id)}
              onToggle={() => toggle(p.id)}
              summary={<p className="text-sm">{p.detail}</p>}
            >
              <Field
                label="What parents are told"
                value={p.detail}
                changed={livePolicy(p.id)?.detail !== p.detail}
                wide
                onChange={(v) => update((d) => void ((d.policies[i] as Policy).detail = v))}
              />
            </ItemCard>
          ))}
        </Section>

        <Section
          title="Your rules"
          hint="How the assistant should behave. A rule only comes up in the conversations it's for."
        >
          {k.rules.map((r, i) => {
            const changed = JSON.stringify(liveRule(r.id)) !== JSON.stringify(r);
            return editing.has(r.id) ? (
              <RuleEditor
                key={r.id}
                rule={r}
                changed={changed}
                onChange={(fn) => update((d) => fn(d.rules[i]))}
                onRemove={() => update((d) => void d.rules.splice(i, 1))}
                onDone={() => toggle(r.id)}
              />
            ) : (
              <div
                key={r.id}
                className={`flex items-start gap-3 rounded-xl border p-3 ${changed ? "border-[var(--warn)]" : "border-[var(--border)]"} ${r.active ? "" : "opacity-60"}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{r.text || <span className="text-[var(--muted)]">(empty rule)</span>}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {r.scope === "always" ? "In every conversation" : `When it's about ${r.scope.map((t) => TOPIC_LABELS[t]).join(", ")}`}
                    {r.source === "feedback" && " · from one of your corrections"}
                    {!r.active && " · turned off"}
                    {changed && <span className="font-medium text-[var(--warn)]"> · changed</span>}
                  </p>
                </div>
                <button onClick={() => toggle(r.id)} className="text-sm text-[var(--accent)] hover:underline">
                  Edit
                </button>
              </div>
            );
          })}
          <button
            onClick={() => {
              const id = `owner-${Math.random().toString(36).slice(2, 8)}`;
              update((d) => void d.rules.push({ id, text: "", scope: ["other"], source: "owner", active: true }));
              toggle(id);
            }}
            className="self-start rounded-lg border border-dashed border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)]"
          >
            + Add a rule
          </button>
        </Section>
      </div>

      <TryIt unsaved={dirty} />
    </div>
  );
}

function StatusBar(props: {
  dirty: boolean;
  hasChanges: boolean;
  hasDraft: boolean;
  impact: ImpactStatus;
  pending: boolean;
  error: string | null;
  publishLabel: string;
  setPublishLabel: (v: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  onCheck: () => void;
  onPublish: () => void;
}) {
  const { dirty, hasChanges, impact, pending } = props;
  const checked = impact.state === "done";
  const harmful = impact.state === "done" && impact.worse > 0;

  if (!dirty && !hasChanges) {
    return (
      <p className="text-sm text-[var(--muted)]">
        This is what parents are told right now. Click <em>Edit</em> on anything to change it; your edits are saved as a
        draft, and parents see them only after you publish.
      </p>
    );
  }

  return (
    <div className="sticky top-2 z-10 flex flex-col gap-3 rounded-2xl border border-[var(--accent)] bg-[var(--surface)] p-4 shadow-md">
      <div className="text-sm">
        {dirty ? (
          <span className="font-medium text-[var(--warn)]">You have edits that aren&apos;t saved yet.</span>
        ) : hasChanges ? (
          <span className="font-medium">
            You have changes waiting. Parents still get the current version until you publish.
          </span>
        ) : null}
      </div>

      {hasChanges && !dirty && (
        <ImpactVerdict impact={impact} />
      )}

      {props.error && <p className="text-sm text-[var(--danger)]">{props.error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {dirty && (
          <button onClick={props.onSave} disabled={pending} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
            Save draft
          </button>
        )}
        {hasChanges && !dirty && (
          <>
            <button
              onClick={props.onCheck}
              disabled={pending || impact.state === "running"}
              className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40 ${
                checked ? "border border-[var(--border)]" : "bg-[var(--accent)] text-white"
              }`}
            >
              {checked ? "Check again" : "Check how this changes answers"}
            </button>
            <input
              value={props.publishLabel}
              onChange={(e) => props.setPublishLabel(e.target.value)}
              placeholder="What changed? (optional)"
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
            />
            <button
              onClick={() => {
                if (harmful && !confirmText("Some answers got worse with this change. Publish anyway?")) return;
                props.onPublish();
              }}
              disabled={pending}
              className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40 ${
                checked && !harmful ? "bg-[var(--accent)] text-white" : "border border-[var(--border)]"
              }`}
            >
              Publish to parents
            </button>
          </>
        )}
        {(hasChanges || dirty) && (
          <button onClick={props.onDiscard} disabled={pending} className="px-2 py-2 text-sm text-[var(--muted)] hover:underline">
            Discard changes
          </button>
        )}
      </div>
    </div>
  );
}

// window.confirm is used deliberately for the one irreversible-feeling action.
function confirmText(msg: string): boolean {
  return typeof window !== "undefined" ? window.confirm(msg) : false;
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-[var(--muted)]">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  changed,
  wide,
  onChange,
}: {
  label: string;
  value: string;
  changed: boolean;
  wide?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-[var(--muted)] ${wide ? "sm:col-span-2" : ""}`}>
      <span>
        {label} {changed && <span className="font-medium text-[var(--warn)]">· changed</span>}
      </span>
      <textarea
        value={value}
        rows={wide ? 2 : 1}
        onChange={(e) => onChange(e.target.value)}
        className={`resize-y rounded-lg border bg-transparent px-2.5 py-1.5 text-sm text-[var(--foreground)] ${
          changed ? "border-[var(--warn)]" : "border-[var(--border)]"
        }`}
      />
    </label>
  );
}

function RuleEditor({
  rule,
  changed,
  onChange,
  onRemove,
  onDone,
}: {
  rule: Rule;
  changed: boolean;
  onChange: (fn: (r: Rule) => void) => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  const always = rule.scope === "always";
  return (
    <div className={`rounded-xl border p-3 ${changed ? "border-[var(--warn)]" : "border-[var(--border)]"} ${rule.active ? "" : "opacity-60"}`}>
      <textarea
        value={rule.text}
        rows={2}
        placeholder="e.g. Always mention the free trial"
        onChange={(e) => onChange((r) => void (r.text = e.target.value))}
        className="w-full resize-y rounded-lg border border-[var(--border)] bg-transparent px-2.5 py-1.5 text-sm"
      />
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-[var(--muted)]">Applies to:</span>
        <button
          onClick={() => onChange((r) => void (r.scope = always ? ["other"] : "always"))}
          className={`rounded-full px-2 py-0.5 ${always ? "bg-[var(--accent)] text-white" : "bg-[var(--surface-2)]"}`}
        >
          every conversation
        </button>
        {!always &&
          (Object.keys(TOPIC_LABELS) as Topic[]).map((t) => {
            const on = (rule.scope as Topic[]).includes(t);
            return (
              <button
                key={t}
                onClick={() =>
                  onChange((r) => {
                    const cur = r.scope as Topic[];
                    const next = on ? cur.filter((x) => x !== t) : [...cur, t];
                    r.scope = next.length ? next : ["other"];
                  })
                }
                className={`rounded-full px-2 py-0.5 ${on ? "bg-[var(--accent)] text-white" : "bg-[var(--surface-2)] text-[var(--muted)]"}`}
              >
                {TOPIC_LABELS[t]}
              </button>
            );
          })}
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs">
        {rule.source === "feedback" && <span className="text-[var(--muted)]">From one of your corrections</span>}
        {changed && <span className="font-medium text-[var(--warn)]">changed</span>}
        <label className="ml-auto flex items-center gap-1">
          <input type="checkbox" checked={rule.active} onChange={(e) => onChange((r) => void (r.active = e.target.checked))} />
          turned on
        </label>
        <button onClick={onRemove} className="text-[var(--muted)] hover:text-[var(--danger)]">
          Remove
        </button>
        <button onClick={onDone} className="text-sm text-[var(--accent)] hover:underline">
          Done
        </button>
      </div>
    </div>
  );
}

type TryMsg = {
  role: "parent" | "assistant";
  body: string;
  escalate?: boolean;
  rules?: string[];
  reason?: string | null;
  topics?: Topic[];
};

function TryIt({ unsaved }: { unsaved: boolean }) {
  const [msgs, setMsgs] = useState<TryMsg[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send(e: React.FormEvent) {
    e.preventDefault();
    const message = text;
    setText("");
    setError(null);
    const history = msgs.map((m) => ({ role: m.role, body: m.body, topics: m.topics }));
    setMsgs((m) => [...m, { role: "parent", body: message }]);
    start(async () => {
      const r = await tryDraftAction(history, message, "text");
      if ("error" in r) setError(r.error);
      else setMsgs((m) => [...m, { role: "assistant", body: r.reply, escalate: r.escalate, rules: r.rules, reason: r.escalationReason, topics: r.topics }]);
    });
  }

  return (
    <aside className="flex h-fit flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] lg:sticky lg:top-4">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <div className="font-semibold">Try your changes</div>
        <p className="text-xs text-[var(--muted)]">
          Chat as a parent against your saved draft. Nothing here reaches real families.
          {unsaved && <span className="text-[var(--warn)]"> Save first to try your latest edits.</span>}
        </p>
      </div>
      <div className="flex max-h-[50vh] min-h-40 flex-col gap-2 overflow-y-auto p-3">
        {msgs.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.role === "parent" ? "items-end" : "items-start"}`}>
            <div
              className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-sm ${
                m.role === "parent" ? "bg-[var(--accent)] text-white" : "bg-[var(--surface-2)]"
              }`}
            >
              {m.body}
            </div>
            {m.escalate && <span className="mt-0.5 text-[10px] text-[var(--danger)]">would hand to you: {m.reason}</span>}
            {m.rules && m.rules.length > 0 && (
              <details className="mt-0.5 text-[10px] text-[var(--muted)]">
                <summary className="cursor-pointer">rules used ({m.rules.length})</summary>
                <ul className="list-disc pl-4">
                  {m.rules.map((r, j) => (
                    <li key={j}>{r}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
        {pending && <div className="text-xs text-[var(--muted)]">typing…</div>}
        {error && <div className="text-xs text-[var(--danger)]">{error}</div>}
      </div>
      <form onSubmit={send} className="flex gap-2 border-t border-[var(--border)] p-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. when is summer camp?"
          className="min-w-0 flex-1 rounded-full border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm"
        />
        <button disabled={pending || !text.trim()} className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-40">
          Send
        </button>
      </form>
      {msgs.length > 0 && (
        <button onClick={() => setMsgs([])} className="pb-3 text-xs text-[var(--muted)] hover:underline">
          Clear
        </button>
      )}
    </aside>
  );
}
