import { randomUUID } from "node:crypto";

import { hashKnowledge } from "@/lib/engine/snapshot";
import { SEED_KNOWLEDGE } from "@/lib/seed-knowledge";

import { db } from "./index";
import { families, snapshots, threads } from "./schema";

export function seed() {
  const existing = db.select().from(snapshots).all();
  if (existing.length > 0) {
    console.log(`already seeded (${existing.length} snapshots) - nothing to do`);
    return;
  }

  const id = randomUUID();
  db.insert(snapshots)
    .values({
      id,
      hash: hashKnowledge(SEED_KNOWLEDGE),
      status: "live",
      label: "Club details as of the brief",
      data: SEED_KNOWLEDGE,
      publishedAt: Math.floor(Date.now() / 1000),
    })
    .run();

  // A couple of families so the owner's inbox isn't empty on first run.
  const sample = [
    { parentFirstName: "Dana", parentLastName: "Whitfield", phone: "+15550100" },
    { parentFirstName: "Marcus", parentLastName: "Ortiz", phone: "+15550101" },
  ];
  for (const f of sample) {
    const familyId = randomUUID();
    db.insert(families).values({ id: familyId, ...f }).run();
    db.insert(threads).values({ id: randomUUID(), familyId, status: "open" }).run();
  }

  console.log(`seeded live snapshot ${hashKnowledge(SEED_KNOWLEDGE)} + ${sample.length} families`);
}

if (process.argv[1]?.includes("seed")) seed();
