declare module "better-sqlite3-session-store" {
  import session from "express-session";
  import type Database from "better-sqlite3";
  export default function sqliteStore(module: typeof session): {
    new (options: {
      client: Database.Database;
      expired?: { clear?: boolean; intervalMs?: number };
    }): Omit<session.Store, "get" | "set" | "destroy"> & {
      get(
        sid: string,
        callback: (err: unknown, session?: session.SessionData | null) => void,
      ): void;
      set(
        sid: string,
        session: session.SessionData,
        callback?: (err?: unknown) => void,
      ): void;
      destroy(sid: string, callback?: (err?: unknown) => void): void;
      startInterval(): void;
      clearExpiredSessions(): void;
    };
  };
}
