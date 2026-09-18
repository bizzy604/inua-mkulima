import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import { openDatabase, migrate, seed } from '../src/db/index.js';

export const password = 'Demo-checkout-123!';
const hash = bcrypt.hashSync(password,4);
export const origin = 'http://localhost:5173';
export const cart = {
  items:[
    {productId:1,quantity:1,expectedUnitPriceMinor:150000,deductionMinor:90000},
    {productId:2,quantity:2,expectedUnitPriceMinor:30000,deductionMinor:50000},
  ],expectedDeductionTotalMinor:140000,
};
export const payment = {...cart,verificationCode:'123456'};
export function fixture(onPurchase?: () => void) {
  const dir = mkdtempSync(join(tmpdir(),'inua-api-'));
  const config = parseConfig({
    NODE_ENV:'test',APP_ORIGIN:origin,DATABASE_PATH:join(dir,'business.db'),
    SESSION_DATABASE_PATH:join(dir,'sessions.db'),SESSION_SECRET:'test-only-secret-32-characters-long',
    DEMO_USERNAME:'demo',DEMO_PASSWORD_HASH:hash,DEMO_DEALER_ID:'demo-dealer',
    DEMO_VERIFICATION_CODE:'123456',RABBITMQ_URL:'amqp://localhost',LOKI_URL:'http://localhost:3100',LOG_DIR:join(dir,'logs'),
  });
  const db = openDatabase(config.databasePath);
  migrate(db); seed(db,config.demoDealerId);
  const sessionDb = openDatabase(config.sessionDatabasePath);
  const events: Record<string,unknown>[] = [];
  const {app,close} = createApp({config,db,sessionDb,onPurchase,logger:{info:(message,meta) => events.push({message,...meta})}});
  return {app,db,sessionDb,config,events,close:() => {
    close();sessionDb.close();db.close();rmSync(dir,{recursive:true,force:true});
  }};
}
