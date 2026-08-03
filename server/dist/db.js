import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = join(__dirname, "..");
const MIGRATIONS_DIR = join(SERVER_ROOT, "migrations");
export class AppDatabase {
    #db;
    constructor(path) {
        this.#db = new DatabaseSync(path);
        this.#db.exec("PRAGMA foreign_keys = ON");
        this.applyMigrations();
    }
    get sqlite() {
        return this.#db;
    }
    close() {
        this.#db.close();
    }
    applyMigrations() {
        const current = Number(this.#db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
        const files = readdirSync(MIGRATIONS_DIR)
            .filter((f) => /^\d{3}_.+\.sql$/.test(f))
            .sort();
        let version = current;
        for (const file of files) {
            const fileVersion = Number(file.slice(0, 3));
            if (fileVersion <= version)
                continue;
            const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
            this.#db.exec(sql);
            this.#db.exec(`PRAGMA user_version = ${fileVersion}`);
            version = fileVersion;
        }
    }
}
export function openDatabase(path) {
    return new AppDatabase(path);
}
//# sourceMappingURL=db.js.map