# Local message queue and logs

From the repository root, start Docker Desktop using Linux containers, then run:

```sh
docker compose -f infra/compose.yaml up -d
docker compose -f infra/compose.yaml ps
curl http://127.0.0.1:3100/ready
```

Loki can take about a minute to report ready on first startup. RabbitMQ and Loki use named persistent volumes. `docker compose -f infra/compose.yaml down` preserves them. The pinned images expose ports only on localhost; this configuration and its disposable credentials are for local assessment use.

Set the backend configuration:

```dotenv
RABBITMQ_URL=amqp://inua:local-rabbitmq-only@127.0.0.1:5672
LOKI_URL=http://127.0.0.1:3100
LOG_DIR=./logs
LOG_LEVEL=info
```

RabbitMQ management is at http://127.0.0.1:15672 (username `inua`, password `local-rabbitmq-only`). The only business queue is `purchase.completed`, durable with persistent messages. Confirmed publication marks the committed transaction as published. A single background loop checks up to 50 pending records at startup and every five seconds. Failed connections and local consumer writes pause before reconnecting. The consumer logs activity and never changes wallets.

Logs are JSON lines in `LOG_DIR/application.log`, rotated at 5 MiB with three previous files. A successful local append is required before acknowledging an activity event. Local writes are synchronous and deliberately small for this single-instance assessment; they are not a high-throughput logging architecture or a power-loss durability guarantee. Winston sends the same structured events to Loki with labels `app`, `environment`, and `level`; transaction/request IDs stay in the body. Loki uses a 500-event memory buffer, batches of 100, and a two-second timeout. During outages aggregation is best effort: old buffered events can be discarded, while the original file logs remain. Recovery and shutdown do not depend on Loki availability.

Query a completed transaction, replacing `TRANSACTION_ID` with the saved ID:

```sh
curl -G http://127.0.0.1:3100/loki/api/v1/query_range --data-urlencode 'query={app="inua-mkulima"} |= "purchase.completed.processed" |= "TRANSACTION_ID"' --data-urlencode 'since=1h' --data-urlencode 'limit=100'
```

Run the infrastructure verification from `backend` after configuring and starting services:

```sh
npm run test:infra
```

The check creates its own temporary SQLite database and file logs, publishes a pending fixture to the real RabbitMQ queue, verifies consumer activity locally and in Loki, then republishes the same stable event ID to exercise restart recovery. It asserts the wallet balance never changes and prints transaction IDs and the evidence directory. It exits nonzero if RabbitMQ/Loki cannot satisfy the checks. This is an infrastructure test, not a simulated replacement for the real dependencies. Run it with the application stopped so the temporary test logger observes its own message consumption.

To verify recovery of an actual purchase during a broker outage:

1. Stop RabbitMQ: `docker compose -f infra/compose.yaml stop rabbitmq`.
2. Complete a purchase through the API and save the transaction ID, idempotency key, payload and resulting wallet balance. The payment succeeds after its database commit; its event marker remains pending.
3. Restart RabbitMQ: `docker compose -f infra/compose.yaml start rabbitmq`.
4. Within the retry interval, find the transaction ID in the local `purchase.completed.processed` log and the Loki query above.
5. Retry the identical payment with its saved key. Verify the original purchase is returned and the wallet balance is unchanged.

No event consumer debits wallets. A process crash between publisher confirmation and the database marker can duplicate the activity event, so event IDs remain stable and duplicate activity logs are acceptable.

Protocol references: [amqplib channel API](https://amqp-node.github.io/amqplib/channel_api.html), [RabbitMQ confirms](https://www.rabbitmq.com/docs/confirms), [Loki HTTP API](https://grafana.com/docs/loki/latest/reference/loki-http-api/).
