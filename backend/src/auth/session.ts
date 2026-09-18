/** Configures the SQLite-backed session middleware and authenticated-request guard. */
import session from 'express-session';
import sqliteStore from 'better-sqlite3-session-store';
import type Database from 'better-sqlite3';
import type { Config } from '../config.js';
import type { RequestHandler } from 'express';
import { AppError } from '../middleware/errors.js';

declare module 'express-session' {
  interface SessionData { dealerId: string; username: string }
}
export const cookieName = 'inua.sid';
/** Creates finite, HttpOnly sessions backed by the supplied SQLite connection. */
export function createSession(config: Config, db: Database.Database) {
  const Store = sqliteStore(session);
  // The adapter's own timer cannot be cancelled and ignores expired.clear=false.
  // Override only timer ownership so application shutdown can close SQLite safely.
  class ManagedStore extends Store {
    declare cleanup: NodeJS.Timeout;
    override startInterval() {
      this.cleanup = setInterval(() => this.clearExpiredSessions(), 15 * 60 * 1000);
      this.cleanup.unref();
    }
  }
  const store = new ManagedStore({ client: db });
  return {
    middleware: session({
      store, name: cookieName, secret: config.sessionSecret,
      resave: false, saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: 60 * 60 * 1000 },
    }),
    close: () => clearInterval(store.cleanup),
  };
}
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.session.dealerId) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
  next();
};
