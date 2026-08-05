import { DatabaseSync } from "node:sqlite";
import { exportSnapshot } from "../../src/export/export.js";

const [dbPath, destination] = process.argv.slice(2);
if (!dbPath || !destination) {
  throw new Error("export worker requires dbPath and destination");
}

const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  exportSnapshot(db, destination);
} finally {
  db.close();
}
