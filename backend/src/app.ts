/** Builds the Express application and composes middleware, sessions, and API routes. */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import helmet from 'helmet';
import type Database from 'better-sqlite3';
import type { Config } from './config.js';
import { projectRoot } from './config.js';
import { createSession, requireAuth } from './auth/session.js';
import { authRoutes } from './auth/routes.js';
import { productRoutes } from './products/routes.js';
import { walletRoutes } from './wallets/routes.js';
import { transactionRoutes } from './transactions/routes.js';
import { AppError, errorHandler } from './middleware/errors.js';

export interface RequestLogger { info(message:string,meta?:Record<string,unknown>):void }
/** Creates an importable app for production startup and isolated HTTP tests. */
export function createApp(options: {
  config: Config; db: Database.Database; sessionDb: Database.Database;
  logger: RequestLogger; onPurchase?: () => void;
}) {
  const {config,db,sessionDb,logger} = options;
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy',1);
  app.use((req,res,next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-ID',res.locals.requestId);
    const start = performance.now();
    res.on('finish',() => {
      // Paths are route templates to avoid logging arbitrary client text or identifiers.
      try { logger.info('http.request',{
        requestId:res.locals.requestId,method:req.method,
        path:req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched',
        status:res.statusCode,durationMs:Math.round(performance.now()-start),
        ...(res.locals.errorCode ? {errorCode:res.locals.errorCode} : {}),
        ...(res.locals.transactionId ? {transactionId:res.locals.transactionId,outcome:res.locals.purchaseOutcome} : {}),
      }); } catch { /* Logging availability cannot alter an HTTP response. */ }
    });
    next();
  });
  app.use(helmet());
  app.use('/api',(_req,res,next) => {res.setHeader('Cache-Control','no-store');next();});
  app.use('/api',(req,_res,next) => {
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.get('Origin') !== config.appOrigin)
      throw new AppError(403,'FORBIDDEN_ORIGIN','The request origin is not allowed.');
    next();
  });
  app.use(express.json({limit:'32kb'}));
  const sessions = createSession(config,sessionDb);
  app.use('/api',sessions.middleware);
  app.get('/api/health',(_req,res) => {
    db.prepare('SELECT 1').get();
    res.json({data:{status:'ok'}});
  });
  app.use('/api/auth',authRoutes(db,config));
  app.use('/api/products',requireAuth,productRoutes(db));
  app.use('/api/wallet',requireAuth,walletRoutes(db));
  app.use('/api/transactions',requireAuth,transactionRoutes(db,config,options.onPurchase ?? (() => {})));
  app.use('/api',(_req,_res,next) => next(new AppError(404,'NOT_FOUND','The endpoint was not found.')));
  const frontend = resolve(projectRoot,'frontend/dist');
  if (existsSync(resolve(frontend,'index.html'))) {
    app.use(express.static(frontend));
    app.get(['/', '/login', '/products', '/summary'],(_req,res) => res.sendFile(resolve(frontend,'index.html')));
  }
  app.use((_req,_res,next) => next(new AppError(404,'NOT_FOUND','The page was not found.')));
  app.use(errorHandler);
  return {app,close:sessions.close};
}
