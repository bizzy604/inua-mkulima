/** Publishes committed purchase activity to RabbitMQ and consumes it for local logging. */
import amqp, { type Channel, type ChannelModel, type ConfirmChannel, type ConsumeMessage } from 'amqplib';
import type Database from 'better-sqlite3';
import type { AppLogger } from './logger.js';

export const PURCHASE_QUEUE = 'purchase.completed';
export interface PurchaseEvent {
  eventId: string;
  eventType: 'purchase.completed';
  timestamp: string;
  requestId: string;
  transactionId: string;
  deductionTotalMinor: number;
}
interface PendingRow { id: string; request_id: string; created_at: string; deduction_total_minor: number }
export interface QueueHandle { wake(): void; stop(): Promise<void> }

/** Validates the intentionally small, identity-only event consumed from RabbitMQ. */
export function parsePurchaseEvent(content: Buffer): PurchaseEvent {
  if (content.length > 4096) throw new Error('Oversize purchase event');
  const value: unknown = JSON.parse(content.toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid purchase event');
  const event = value as Record<string, unknown>;
  if (Object.keys(event).sort().join(',') !== 'deductionTotalMinor,eventId,eventType,requestId,timestamp,transactionId'
      || event.eventType !== PURCHASE_QUEUE
      || !['eventId', 'requestId', 'transactionId', 'timestamp'].every((key) => typeof event[key] === 'string' && (event[key] as string).length > 0 && (event[key] as string).length <= 128)
      || event.eventId !== event.transactionId || !Number.isFinite(Date.parse(event.timestamp as string))
      || !Number.isSafeInteger(event.deductionTotalMinor) || (event.deductionTotalMinor as number) <= 0) {
    throw new Error('Invalid purchase event');
  }
  return event as unknown as PurchaseEvent;
}

/** Malformed messages are discarded. Local disk failures propagate and leave delivery unacked. */
export async function consumePurchaseMessage(message: ConsumeMessage, channel: Pick<Channel, 'ack' | 'reject'>, logger: AppLogger): Promise<void> {
  let event: PurchaseEvent;
  try { event = parsePurchaseEvent(message.content); }
  catch {
    logger.warn('purchase.event.invalid');
    channel.reject(message, false);
    return;
  }
  await logger.writeActivity('purchase.completed.processed', { ...event });
  channel.ack(message);
}

function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Dependency timeout')), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

async function closeConnection(connection: ChannelModel): Promise<void> {
  try { await bounded(connection.close(), 1000); }
  catch {
    // amqplib exposes no public force-close API; destroy the underlying socket only
    // after graceful close fails, so a disconnected peer cannot hold shutdown open.
    (connection as unknown as { connection?: { stream?: { destroy(): void } } }).connection?.stream?.destroy();
  }
}

/** Starts the durable publisher/consumer loop; it never performs a wallet debit. */
export function startQueue(
  db: Database.Database,
  logger: AppLogger,
  rabbitmqUrl: string,
  options: { intervalMs?: number; timeoutMs?: number; connect?: typeof amqp.connect } = {},
): QueueHandle {
  const intervalMs = options.intervalMs ?? 5000;
  const timeoutMs = options.timeoutMs ?? 3000;
  const connect = options.connect ?? amqp.connect;
  const pending = db.prepare('SELECT id, request_id, created_at, deduction_total_minor FROM transactions WHERE event_published_at IS NULL ORDER BY created_at, id LIMIT 50');
  const markPublished = db.prepare('UPDATE transactions SET event_published_at = ? WHERE id = ? AND event_published_at IS NULL');
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  let state: { connection: ChannelModel; publisher: ConfirmChannel; consumer: Channel } | undefined;
  let nextConnect = 0;
  const activeConsumers = new Set<Promise<void>>();

  function invalidate(connection: ChannelModel): void {
    if (state?.connection !== connection) return;
    state = undefined;
    nextConnect = Date.now() + intervalMs;
    void closeConnection(connection);
  }

  async function ensureConnection(): Promise<NonNullable<typeof state>> {
    if (state) return state;
    let abandoned = false;
    // Also close a late connection if our deadline or shutdown already won.
    const brokerUrl = new URL(rabbitmqUrl);
    if (!brokerUrl.searchParams.has('heartbeat')) brokerUrl.searchParams.set('heartbeat', '10');
    const connecting = connect(brokerUrl.toString(), { timeout: timeoutMs }).then((connection) => {
      connection.on('error', () => { logger.warn('rabbitmq.connection.error'); invalidate(connection); });
      connection.on('close', () => invalidate(connection));
      if (abandoned || stopped) { void closeConnection(connection); throw new Error('Connection abandoned'); }
      return connection;
    });
    let connection: ChannelModel | undefined;
    try {
      connection = await bounded(connecting, timeoutMs);
      const publisher = await bounded(connection.createConfirmChannel(), timeoutMs);
      publisher.on('error', () => { if (connection) invalidate(connection); });
      publisher.on('close', () => { if (connection) invalidate(connection); });
      const consumer = await bounded(connection.createChannel(), timeoutMs);
      consumer.on('error', () => { if (connection) invalidate(connection); });
      consumer.on('close', () => { if (connection) invalidate(connection); });
      await bounded(publisher.assertQueue(PURCHASE_QUEUE, { durable: true }), timeoutMs);
      await bounded(consumer.prefetch(1), timeoutMs);
      const created = { connection, publisher, consumer };
      state = created;
      await bounded(consumer.consume(PURCHASE_QUEUE, (message) => {
        if (!message) { invalidate(created.connection); return; }
        const work = consumePurchaseMessage(message, consumer, logger).catch(() => {
          logger.error('purchase.event.local_write_failed');
          // Closing requeues unacked work, with a delay before reconnecting.
          invalidate(created.connection);
        }).finally(() => { activeConsumers.delete(work); });
        activeConsumers.add(work);
      }, { noAck: false }), timeoutMs);
      if (stopped || state !== created) throw new Error('Connection no longer active');
      logger.info('rabbitmq.connected');
      return created;
    } catch (error) {
      abandoned = true;
      if (connection) { if (state?.connection === connection) state = undefined; await closeConnection(connection); }
      throw error;
    }
  }

  async function publish(publisher: ConfirmChannel, event: PurchaseEvent): Promise<void> {
    let returned = false;
    const onReturn = () => { returned = true; };
    publisher.on('return', onReturn);
    try {
      await bounded(new Promise<void>((resolve, reject) => {
        publisher.sendToQueue(PURCHASE_QUEUE, Buffer.from(JSON.stringify(event)), {
          persistent: true, mandatory: true, contentType: 'application/json', messageId: event.eventId, type: event.eventType,
        }, (error) => { if (error || returned) reject(error ?? new Error('Unroutable event')); else resolve(); });
      }), timeoutMs);
    } finally { publisher.removeListener('return', onReturn); }
  }

  async function iteration(): Promise<void> {
    if (stopped || Date.now() < nextConnect) return;
    try {
      const connected = await ensureConnection();
      for (const row of pending.all() as PendingRow[]) {
        if (stopped || state !== connected) break;
        const event: PurchaseEvent = { eventId: row.id, eventType: PURCHASE_QUEUE, timestamp: row.created_at, requestId: row.request_id, transactionId: row.id, deductionTotalMinor: row.deduction_total_minor };
        await publish(connected.publisher, event);
        // No wallet writes exist in this module. A crash before this marker may
        // duplicate the activity log, but never repeats the financial operation.
        markPublished.run(new Date().toISOString(), row.id);
        logger.info('purchase.completed.published', { transactionId: row.id, eventId: row.id, requestId: row.request_id });
      }
    } catch {
      logger.warn('purchase.event.publish_failed');
      nextConnect = Date.now() + intervalMs;
      if (state) invalidate(state.connection);
    }
  }

  function wake(): void {
    if (stopped || running) return;
    if (timer) clearTimeout(timer);
    running = iteration().finally(() => {
      running = undefined;
      if (!stopped) { timer = setTimeout(wake, intervalMs); timer.unref(); }
    });
  }
  wake();
  return {
    wake,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      const connected = state;
      state = undefined;
      if (connected) await closeConnection(connected.connection);
      if (running) await bounded(running, timeoutMs * 5 + 1500).catch(() => undefined);
      await bounded(Promise.allSettled(activeConsumers), 1000).catch(() => undefined);
    },
  };
}
