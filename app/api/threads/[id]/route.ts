import { getThread } from "@/lib/db/conversations";

/** The parent's view of their thread: bodies only, no internal metadata. */
export async function GET(_request: Request, ctx: RouteContext<"/api/threads/[id]">) {
  const { id } = await ctx.params;
  const thread = getThread(id);
  if (!thread) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({
    id: thread.id,
    parentFirstName: thread.family.parentFirstName,
    messages: thread.messages.map((m) => ({
      id: m.id,
      role: m.role,
      channel: m.channel,
      body: m.body,
      // Shown to the parent as "passed to the owner": they were told so in the reply itself.
      handedOver: m.escalated,
      createdAt: m.createdAt,
    })),
  });
}
