import { DatabaseSync } from "node:sqlite";
export declare class AppDatabase {
    #private;
    constructor(path: string);
    get sqlite(): DatabaseSync;
    close(): void;
    private applyMigrations;
}
export declare function openDatabase(path: string): AppDatabase;
//# sourceMappingURL=db.d.ts.map