import { existsSync } from "fs";
import { join } from "path";
import { STORAGE_ROOT } from "../storage/init.js";
import { MemoryStore } from "../storage/memory-store.js";
import { SQLiteMemoryStore } from "../storage/memory-sqlite-store.js";

const sourcePath = process.argv[2] || join(STORAGE_ROOT, "memories", "memories.jsonl");
if (!existsSync(sourcePath)) {
  console.log(JSON.stringify({ migrated: 0, source: sourcePath, message: "No legacy JSONL memory store found" }));
  process.exit(0);
}

const source = new MemoryStore(sourcePath);
const target = new SQLiteMemoryStore();
let migrated = 0;
for (const memory of source.list()) {
  target.apply({ decision: "ADD", memory });
  migrated++;
}
target.close();
console.log(JSON.stringify({ migrated, source: sourcePath, target: join(STORAGE_ROOT, "memories", "memory.sqlite") }));
