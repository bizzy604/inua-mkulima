/** Provides login, session restoration, and logout for the configured demo dealer. */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import type { Config } from '../config.js';
import { AppError } from '../middleware/errors.js';
import { cookieName, requireAuth } from './session.js';
import { rateLimit } from 'express-rate-limit';

export function authRoutes(db: Database.Database, config: Config) {
  const router = Router();
  const context = (dealerId: string, username: string) => {
    const wallet = db.prepare('SELECT id FROM wallets WHERE dealer_id = ?').get(dealerId) as {id:number}|undefined;
    if (!wallet) throw new AppError(404, 'WALLET_NOT_FOUND', 'The assigned wallet was not found.');
    return {dealerId, username, walletId: wallet.id};
  };
  router.post('/login', rateLimit({
    windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many sign-in attempts. Try again later.')),
  }), async (req, res) => {
    const {username,password} = z.object({username:z.string().trim().min(1).max(100),password:z.string().min(1).max(256)}).strict().parse(req.body);
    const passwordMatches = await bcrypt.compare(password, config.demoPasswordHash);
    if (username !== config.demoUsername || !passwordMatches)
      throw new AppError(401, 'INVALID_CREDENTIALS', 'The username or password is incorrect.');
    const data = context(config.demoDealerId, username);
    await new Promise<void>((resolve,reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.dealerId = config.demoDealerId;
    req.session.username = username;
    await new Promise<void>((resolve,reject) => req.session.save(error => error ? reject(error) : resolve()));
    res.json({data});
  });
  router.get('/me', requireAuth, (req,res) => res.json({data:context(req.session.dealerId!,req.session.username!)}));
  router.post('/logout', requireAuth, async (req,res) => {
    await new Promise<void>((resolve,reject) => req.session.destroy(error => error ? reject(error) : resolve()));
    res.clearCookie(cookieName,{httpOnly:true,sameSite:'lax',secure:config.cookieSecure,path:'/'});
    res.json({data:{loggedOut:true}});
  });
  return router;
}
