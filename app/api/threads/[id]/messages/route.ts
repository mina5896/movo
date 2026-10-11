import * as z from "zod";

import { handleParentMessage } from "@/lib/db/conversations";

const Body = z.object({
  body: z.string().trim().min(1).max(2000),
  channel: z.enum(["text", "voice"]).default("text"),
});

export async function POST(request: Request, ctx: RouteContext<"/api/threads/[id]/messages">) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "message is required" }, { status: 400 });

  try {
    const { reply } = await handleParentMessage(id, parsed.data.body, parsed.data.channel);
    return Response.json({ reply: { id: reply.id, role: reply.role, channel: reply.channel, body: reply.body } });
  } catch (err) {
    console.error("parent message failed", err);
    // The parent message is stored and the thread is flagged for the owner.
    return Response.json(
      {
        error: "assistant_unavailable",
        fallback: "Sorry, I couldn't answer that just now. I've let the club owner know and they'll reply to you here.",
      },
      { status: 502 },
    );
  }
}
