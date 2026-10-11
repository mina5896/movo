import * as z from "zod";

import { startConversation } from "@/lib/db/conversations";

const Body = z.object({
  parentFirstName: z.string().trim().min(1).max(60),
  phone: z.string().trim().max(30).optional(),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "first name is required" }, { status: 400 });
  return Response.json(startConversation(parsed.data));
}
