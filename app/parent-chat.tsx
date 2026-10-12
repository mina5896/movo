"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Msg = { id: string; role: "parent" | "assistant" | "owner"; channel: "text" | "voice"; body: string };

const STORAGE_KEY = "movo.parent.thread";

// The Web Speech API is not in TypeScript's DOM lib; this is the slice we use.
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
};

function makeRecognition(): Recognition | null {
  const w = window as unknown as Record<string, (new () => Recognition) | undefined>;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = "en-US";
  r.interimResults = false;
  r.continuous = false;
  return r;
}

/**
 * Browsers ship several voices of very different quality and default to a
 * flat, robotic one. Prefer the neural voices when the machine has them: Edge's
 * "Online (Natural)" voices, macOS "Premium"/"Enhanced" downloads, then
 * Chrome's Google voice. A hosted TTS service would sound better still (see
 * DECISIONS.md), at the cost of another provider and per-reply billing.
 */
const VOICE_PREFERENCES: RegExp[] = [
  /Online \(Natural\)/i,
  /\(Premium\)/i,
  /\(Enhanced\)/i,
  /^Google US English$/i,
  /^(Samantha|Ava|Allison|Zoe|Evan|Nathan)\b/i,
  /^Google UK English Female$/i,
];

let chosenVoice: SpeechSynthesisVoice | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (chosenVoice) return chosenVoice;
  const english = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
  if (english.length === 0) return null; // voices load asynchronously; try again next time
  for (const pref of VOICE_PREFERENCES) {
    const match = english.find((v) => pref.test(v.name) && v.lang.toLowerCase().startsWith("en-us")) ??
      english.find((v) => pref.test(v.name));
    if (match) return (chosenVoice = match);
  }
  return (chosenVoice = english.find((v) => v.default) ?? english[0]);
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  // Some browsers only populate the voice list after this event.
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {
    chosenVoice = null;
    pickVoice();
  });
}

/** Said once if a reply on a call takes longer than this. */
const FILLER_AFTER_MS = 1500;
const FILLERS = ["One moment.", "Let me check.", "Sure, one second."];

function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.rate = 1;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  });
}

export function ParentChat() {
  // Rendered client-only (see parent-chat-loader.tsx), so window is safe here.
  const [threadId, setThreadId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [firstName, setFirstName] = useState("");
  const [phone, setPhone] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onCall, setOnCall] = useState(false);
  const [callState, setCallState] = useState<"listening" | "thinking" | "speaking" | "idle">("idle");
  const [voiceSupported] = useState(() => makeRecognition() !== null);
  const onCallRef = useRef(false);
  const recRef = useRef<Recognition | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async (id: string) => {
    const res = await fetch(`/api/threads/${id}`, { cache: "no-store" });
    if (res.status === 404) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
      setThreadId(null);
      return;
    }
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages);
      setFirstName(data.parentFirstName);
    }
  }, []);

  // Poll so a reply the owner types in the inbox shows up here.
  useEffect(() => {
    if (!threadId) return;
    const first = setTimeout(() => refresh(threadId), 0);
    const t = setInterval(() => refresh(threadId), 4000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [threadId, refresh]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentFirstName: firstName, phone: phone || undefined }),
    });
    if (!res.ok) return setError("Please enter your first name.");
    const { threadId: id } = await res.json();
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {}
    setThreadId(id);
  }

  async function send(body: string, channel: "text" | "voice"): Promise<string | null> {
    if (!threadId || !body.trim()) return null;
    setSending(true);
    setError(null);
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: "parent", channel, body }]);
    try {
      const res = await fetch(`/api/threads/${threadId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, channel }),
      });
      const data = await res.json();
      // On a call the reply is spoken straight away; the thread catches up alongside.
      if (channel === "voice") void refresh(threadId);
      else await refresh(threadId);
      if (!res.ok) {
        setError(data.fallback ?? "Something went wrong.");
        return data.fallback ?? null;
      }
      return data.reply.body as string;
    } catch {
      setError("Couldn't reach the club. Check your connection and try again.");
      return null;
    } finally {
      setSending(false);
    }
  }

  async function submitText(e: React.FormEvent) {
    e.preventDefault();
    const body = draft;
    setDraft("");
    await send(body, "text");
  }

  function listen() {
    const rec = makeRecognition();
    if (!rec) return;
    recRef.current = rec;
    let heard = "";
    rec.onresult = (e) => {
      heard = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join(" ");
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed") {
        setError("Microphone access was blocked.");
        endCall();
      }
    };
    rec.onend = async () => {
      if (!onCallRef.current) return;
      if (!heard.trim()) return listen(); // silence: keep the line open
      setCallState("thinking");
      // A person on the phone says something rather than going silent while they look it up.
      const filler = setTimeout(() => {
        if (onCallRef.current) void speak(FILLERS[Math.floor(Math.random() * FILLERS.length)]);
      }, FILLER_AFTER_MS);
      const reply = await send(heard, "voice");
      clearTimeout(filler);
      if (!onCallRef.current) return;
      if (reply) {
        setCallState("speaking");
        await speak(reply);
      }
      if (onCallRef.current) listen();
    };
    setCallState("listening");
    rec.start();
  }

  async function startCall() {
    onCallRef.current = true;
    setOnCall(true);
    const greeting = `Hi ${firstName}, this is Riverside Kickers. How can I help?`;
    setCallState("speaking");
    await speak(greeting);
    if (onCallRef.current) listen();
  }

  function endCall() {
    onCallRef.current = false;
    setOnCall(false);
    setCallState("idle");
    recRef.current?.stop();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  function newConversation() {
    endCall();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setThreadId(null);
    setMessages([]);
    setFirstName("");
    setPhone("");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col items-center bg-[var(--surface-2)] px-4 py-6">
      <div className="mb-4 flex w-full max-w-md items-center justify-between text-sm">
        <span className="text-[var(--muted)]">Parent view</span>
        <Link href="/owner" className="font-medium text-[var(--accent)] hover:underline">
          Owner view →
        </Link>
      </div>

      <div className="flex w-full max-w-md flex-1 flex-col overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <header className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)] text-lg text-white">
            ⚽
          </div>
          <div className="flex-1">
            <div className="font-semibold">Riverside Kickers</div>
            <div className="text-xs text-[var(--muted)]">Usually replies instantly</div>
          </div>
          {threadId && (
            <button onClick={newConversation} className="text-xs text-[var(--muted)] hover:underline">
              Start over
            </button>
          )}
        </header>

        {!threadId ? (
          <form onSubmit={start} className="flex flex-1 flex-col justify-center gap-4 p-6">
            <p className="text-sm text-[var(--muted)]">
              Text the club any time. If you&apos;d rather talk, you can switch to a call and pick up where
              you left off.
            </p>
            <label className="flex flex-col gap-1 text-sm">
              Your first name
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
                autoFocus
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Phone <span className="text-xs text-[var(--muted)]">(optional - links your texts and calls)</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
                inputMode="tel"
              />
            </label>
            <button className="rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-white">
              Start chatting
            </button>
            {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
          </form>
        ) : (
          <>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-4" style={{ maxHeight: "60vh" }}>
              {messages.length === 0 && (
                <p className="mt-8 text-center text-sm text-[var(--muted)]">
                  Ask about programs, prices, schedules, the weather - anything.
                </p>
              )}
              {messages.map((m) => (
                <Bubble key={m.id} m={m} />
              ))}
              {sending && !onCall && (
                <div className="self-start rounded-2xl bg-[var(--surface-2)] px-4 py-2 text-sm text-[var(--muted)]">
                  typing…
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {error && <p className="px-4 pb-2 text-sm text-[var(--danger)]">{error}</p>}

            {onCall ? (
              <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--accent-soft)] px-4 py-3">
                <div className="text-sm">
                  <div className="font-medium">On a call</div>
                  <div className="text-xs text-[var(--muted)]">
                    {callState === "listening" && "Listening… speak now"}
                    {callState === "thinking" && "One moment…"}
                    {callState === "speaking" && "Speaking…"}
                  </div>
                </div>
                <button onClick={endCall} className="rounded-full bg-[var(--danger)] px-4 py-2 text-sm font-medium text-white">
                  End call
                </button>
              </div>
            ) : (
              <form onSubmit={submitText} className="flex items-center gap-2 border-t border-[var(--border)] px-3 py-3">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Text Riverside Kickers"
                  className="flex-1 rounded-full border border-[var(--border)] bg-transparent px-4 py-2 text-sm"
                  disabled={sending}
                />
                <button
                  disabled={sending || !draft.trim()}
                  className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  Send
                </button>
                <button
                  type="button"
                  onClick={startCall}
                  disabled={!voiceSupported || sending}
                  title={voiceSupported ? "Call the club" : "Voice needs Chrome or Edge"}
                  className="rounded-full border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-40"
                >
                  📞
                </button>
              </form>
            )}
          </>
        )}
      </div>
      {!voiceSupported && threadId && (
        <p className="mt-3 text-xs text-[var(--muted)]">Voice calls need Chrome or Edge.</p>
      )}
    </div>
  );
}

function Bubble({ m }: { m: Msg }) {
  const mine = m.role === "parent";
  return (
    <div className={`flex max-w-[85%] flex-col ${mine ? "self-end items-end" : "self-start items-start"}`}>
      <div
        className={`whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
          mine ? "bg-[var(--accent)] text-white" : "bg-[var(--surface-2)]"
        }`}
      >
        {m.body}
      </div>
      <span className="mt-0.5 px-1 text-[10px] text-[var(--muted)]">
        {m.channel === "voice" ? "📞 call" : ""}
        {m.role === "owner" ? `${m.channel === "voice" ? " · " : ""}from the owner` : ""}
      </span>
    </div>
  );
}
