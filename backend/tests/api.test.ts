import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { fixture, origin, password, payment, cart } from './helpers.js';

describe('authenticated checkout API',() => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => { f = fixture(() => {throw new Error('broker offline');}); });
  afterEach(() => f.close());
  async function login() {
    const client = request.agent(f.app);
    const response = await client.post('/api/auth/login').set('Origin',origin).send({username:' demo ',password}).expect(200);
    return {client,response};
  }
  it('enforces origin, credentials, authenticated routes, secure cookie attributes and logout',async () => {
    await request(f.app).get('/api/products').expect(401);
    await request(f.app).post('/api/auth/login').send({username:'demo',password}).expect(403);
    await request(f.app).post('/api/auth/login').set('Origin','https://evil.invalid').send({username:'demo',password}).expect(403);
    await request(f.app).post('/api/auth/login').set('Origin',origin).send({username:'demo',password:'wrong'}).expect(401);
    await request(f.app).post('/api/auth/login').set('Origin',origin).send({username:'',password:''}).expect(400);
    const {client,response} = await login();
    const cookie = response.headers['set-cookie'][0];
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Lax');
    const second = await client.post('/api/auth/login').set('Origin',origin).send({username:'demo',password}).expect(200);
    expect(second.headers['set-cookie'][0].split(';')[0]).not.toBe(cookie.split(';')[0]);
    await request(f.app).get('/api/auth/me').set('Cookie',cookie).expect(401);
    expect((await client.get('/api/auth/me').expect(200)).body.data.walletId).toBe(1);
    const activeCookie = second.headers['set-cookie'][0];
    await client.post('/api/auth/logout').set('Origin',origin).expect(200);
    await request(f.app).get('/api/auth/me').set('Cookie',activeCookie).expect(401);
  });
  it('persists the worked purchase, replays it, returns history and downloads a PDF even if queue wake fails',async () => {
    const {client} = await login();
    expect((await client.get('/api/products').expect(200)).body.data).toHaveLength(5);
    expect((await client.get('/api/wallet').expect(200)).body.data.balanceMinor).toBe(240000);
    const preview = await client.post('/api/transactions/preview').set('Origin',origin).send(cart).expect(200);
    expect(preview.body.data).toMatchObject({purchaseTotalMinor:210000,deductionTotalMinor:140000,customerDueMinor:70000,walletAfterMinor:100000});
    expect((await client.get('/api/wallet')).body.data.balanceMinor).toBe(240000);
    const key = randomUUID();
    const result = await client.post('/api/transactions').set('Origin',origin).set('Idempotency-Key',key).send(payment).expect(201);
    const replay = await client.post('/api/transactions').set('Origin',origin).set('Idempotency-Key',key).send(payment).expect(200);
    expect(replay.body).toEqual(result.body);
    expect((await client.get('/api/wallet')).body.data.balanceMinor).toBe(100000);
    expect((await client.get('/api/transactions')).body.data.total).toBe(1);
    expect((await client.get(`/api/transactions/${result.body.data.id}`)).body).toEqual(result.body);
    const receipt = await client.get(`/api/transactions/${result.body.data.id}/receipt`).expect(200).expect('Content-Type',/application\/pdf/);
    expect(receipt.body.subarray(0,5).toString()).toBe('%PDF-');
    const logs = JSON.stringify(f.events);
    expect(logs).toContain(result.body.data.id); expect(logs).not.toContain(password); expect(logs).not.toContain('123456');
  });
  it('validates code/key and stale prices without writing and protects historical snapshots',async () => {
    const {client} = await login();
    await client.post('/api/transactions').set('Origin',origin).set('Idempotency-Key',randomUUID()).send({...payment,verificationCode:'000000'}).expect(400);
    await client.post('/api/transactions').set('Origin',origin).send(payment).expect(400);
    expect((await client.get('/api/transactions')).body.data.total).toBe(0);
    const key = randomUUID();
    const saved = (await client.post('/api/transactions').set('Origin',origin).set('Idempotency-Key',key).send(payment).expect(201)).body.data;
    await client.patch('/api/products/1').set('Origin',origin).send({name:'Changed feed',priceMinor:180000}).expect(200);
    await client.post('/api/transactions/preview').set('Origin',origin).send(cart).expect(409);
    const old = (await client.get(`/api/transactions/${saved.id}`)).body.data;
    expect(old.items[0]).toMatchObject({productName:'Animal feeds 10kg',unitPriceMinor:150000});
    await client.post('/api/transactions').set('Origin',origin).set('Idempotency-Key',key).send({...payment,items:[...payment.items].reverse()}).expect(200);
    const created = await client.post('/api/products').set('Origin',origin).send({name:' New seeds ',priceMinor:10000}).expect(201);
    expect(created.body.data.name).toBe('New seeds');
    await client.delete(`/api/products/${created.body.data.id}`).set('Origin',origin).expect(200);
    expect((await client.get('/api/products')).body.data).toHaveLength(5);
  });
  it('rejects session expiry and hides purchases from another dealer',async () => {
    const {client} = await login();
    const saved = (await client.post('/api/transactions').set('Origin',origin).set('Idempotency-Key',randomUUID()).send(payment).expect(201)).body.data;
    f.db.prepare('UPDATE transactions SET dealer_id = ? WHERE id = ?').run('other-dealer',saved.id);
    await client.get(`/api/transactions/${saved.id}`).expect(404);
    await client.get(`/api/transactions/${saved.id}/receipt`).expect(404);
    expect((await client.get('/api/transactions')).body.data.total).toBe(0);
    f.sessionDb.prepare("UPDATE sessions SET expire = '2000-01-01T00:00:00.000Z'").run();
    await client.get('/api/wallet').expect(401);
  });
  it('returns bounded JSON errors, correlation IDs and rate limits without leaking raw input',async () => {
    const malformed = await request(f.app).post('/api/auth/login').set('Origin',origin).set('Content-Type','application/json').send('{bad').expect(400);
    expect(malformed.body.error.code).toBe('INVALID_INPUT');
    expect(malformed.body.error.requestId).toBe(malformed.headers['x-request-id']);
    for (let i=0;i<20;i++) await request(f.app).post('/api/auth/login').set('Origin',origin).send({username:'demo',password:'wrong'}).expect(401);
    await request(f.app).post('/api/auth/login').set('Origin',origin).send({username:'demo',password}).expect(429);
    expect(JSON.stringify(f.events)).not.toContain('wrong');
  });
});
