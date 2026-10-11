"use client";

import dynamic from "next/dynamic";

// Client-only: the chat restores the parent's thread from localStorage, which
// the server can't see, so rendering it on the server would only mismatch.
export const ParentChatLoader = dynamic(() => import("./parent-chat").then((m) => m.ParentChat), {
  ssr: false,
  loading: () => <div className="flex-1 bg-[var(--surface-2)]" />,
});
