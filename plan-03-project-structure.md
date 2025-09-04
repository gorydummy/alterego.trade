### C.2 Project Structure (copy‑ready)

```
apps/bff/
  src/
    server.ts
    app.ts
    env.ts
    middleware/
      authGuard.ts
      schema.ts
    plugins/
      requestId.ts
      pino.ts
      securityHeaders.ts
      rateLimit.ts
      session.ts
      csrf.ts
      errorHandler.ts
    lib/
      db.ts
      redis.ts
      queue.ts
      cron.ts
      http/
        hmac.ts
        idempotency.ts
      crypto/
        keyring.ts
        tokenSeal.ts
    ws/
      relay.ts
      clientRegistry.ts
      auth.ts
    routes/
      auth.routes.ts
      brokers.routes.ts
      trades.routes.ts
      simulations.routes.ts
      digest.routes.ts
      rules.routes.ts
      events.routes.ts
    modules/
      auth/
        AuthService.ts
        SessionRepo.ts
        AuditRepo.ts
      brokers/
        BrokerService.ts
        adapters/
          coinbase.adapter.ts
          binance.adapter.ts
      trades/
        TradeRepo.ts
        ImportService.ts
      biases/
        BiasRepo.ts
        ScoreService.ts
      digest/
        DigestRepo.ts
        DigestService.ts
      rules/
        RuleRepo.ts
        RuleService.ts
      events/
        OutboxRepo.ts
        EventService.ts
    workers/
      common/jobBase.ts
      import.worker.ts
      score.worker.ts
      sim.worker.ts
      digest.worker.ts
  test/
    unit/
    integration/
    contracts/
```

---

### C.3 Core Files — Pseudocode (granular stubs)

#### src/server.ts

```ts
import Fastify from 'fastify';
import { registerPlugins } from './app';

async function main() {
  const app = Fastify({ trustProxy: true });
  await registerPlugins(app);
  const port = Number(process.env.PORT || 4000);
  await app.listen({ port, host: '0.0.0.0' });
}
main().catch(err => { console.error(err); process.exit(1); });
```

#### src/app.ts

```ts
export async function registerPlugins(app: FastifyInstance) {
  app.register(requestId);
  app.register(pinoLogger, { redact: ['req.headers.authorization'] });
  app.register(securityHeaders);
  app.register(rateLimit);
  app.register(sessionPlugin); // HttpOnly cookie
  app.register(csrfPlugin);    // double submit

  app.register(dbPlugin);      // Prisma
  app.register(redisPlugin);
  app.register(queuePlugin);   // BullMQ queues

  app.register(wsRelay);       // /ws/coach

  app.register(authRoutes, { prefix: '/api/auth' });
  app.register(brokerRoutes, { prefix: '/api/brokers' });
  app.register(tradeRoutes, { prefix: '/api/trades' });
  app.register(simRoutes, { prefix: '/api/simulations' });
  app.register(digestRoutes, { prefix: '/api/digests' });
  app.register(ruleRoutes, { prefix: '/api/rules' });
  app.register(eventRoutes, { prefix: '/api/events' });

  app.setErrorHandler(errorHandler);
}
```

#### src/env.ts

```ts
export const Env = z.object({
  NODE_ENV: z.enum(['development','test','production']),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  HMAC_KEY_ID: z.string(),
  HMAC_SECRET: z.string().min(32),
  KMS_PROVIDER: z.enum(['aws','gcp','local']),
  KMS_KEY_ID: z.string(),
  OAUTH_COINBASE_CLIENT_ID: z.string(),
  OAUTH_COINBASE_CLIENT_SECRET: z.string(),
  BASE_URL: z.string().url(),
}).parse(process.env);
```

#### plugins/securityHeaders.ts

```ts
app.addHook('onRequest', (req, reply, done) => {
  reply.header('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
  reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  reply.header('X-Content-Type-Options', 'nosniff');
  done();
});
```

#### lib/db.ts

```ts
import { PrismaClient } from '@prisma/client';
export const prisma = new PrismaClient({ log: ['error','warn'] });
```

#### lib/redis.ts

```ts
import { createClient } from 'redis';
export const redis = createClient({ url: Env.REDIS_URL });
await redis.connect();
```

#### lib/queue.ts

```ts
import { Queue, Worker, QueueEvents } from 'bullmq';
export const q_import = new Queue('q_import', { connection: redisConn });
export const q_score  = new Queue('q_score',  { connection: redisConn });
export const q_sim    = new Queue('q_sim',    { connection: redisConn });
export const q_digest = new Queue('q_digest', { connection: redisConn });

export function enqueueImport(args) { return q_import.add('import', args, { jobId: hash(args) }); }
```

#### lib/http/hmac.ts

```ts
export function sign(body: string, ts: string) { return hmacSHA256(Env.HMAC_SECRET, ts + body); }
export function verify(signature: string, body: string, ts: string) { /* compare, skew window, replay cache */ }
```

#### lib/http/idempotency.ts

```ts
export async function ensureIdempotent(req, reply) {
  const key = req.headers['idempotency-key'];
  if (!key) return; // optional per route
  const cacheKey = `idem:${req.userId}:${req.routerPath}:${key}`;
  const prev = await redis.get(cacheKey);
  if (prev) return reply.send(JSON.parse(prev));
  reply.hook('onSend', async (payload) => { await redis.setEx(cacheKey, 300, payload); });
}
```

#### ws/relay.ts

```ts
// GET /ws/coach
// 1) authenticate via session cookie
// 2) register client by userId; support lastEventId
// 3) stream new events from Outbox, backfill since lastEventId; handle backpressure
```

#### routes/auth.routes.ts

```ts
app.post('/signup', schema(SignupDto), async (req, reply) => { /* hash pw (argon2id), create user, session cookie, audit */ });
app.post('/login', schema(LoginDto), async (...) => { /* verify pw, rotate session, audit */ });
app.post('/logout', authGuard, async (...) => { /* destroy session */ });
app.get('/me', authGuard, async (...) => { /* return user summary */ });
```

#### routes/brokers.routes.ts

```ts
app.post('/:broker/connect/start', authGuard, async (req, reply) => {
  // create OAuth intent in Redis (state, pkce_verifier); return authorize URL
});
app.get('/:broker/connect/callback', async (req, reply) => {
  // verify state, exchange code → tokens; seal tokens; save BrokerConnection; audit
});
app.post('/:broker/pause', authGuard, async (...) => { /* status=paused */ });
```

#### routes/trades.routes.ts

```ts
app.post('/import', authGuard, ensureIdempotent, async (req, reply) => {
  const jobId = await ImportService.enqueue(userId, req.body.since);
  reply.code(202).send({ jobId });
});
app.get('/', authGuard, async (...) => { /* list trades w/ cursor */ });
app.get('/:id/bias', authGuard, async (...) => { /* list BiasTag for trade */ });
```

#### routes/simulations.routes.ts

```ts
app.post('/simple', authGuard, schema(SimulationRequest), async (req, reply) => {
  // call SimService.run(userId, params) → returns curves + delta (cached)
});
```

#### routes/digest.routes.ts

```ts
app.get('/weekly/latest', authGuard, async (...) => { /* return latest Digest */ });
```

#### routes/rules.routes.ts

```ts
app.get('/', authGuard, async (...) => { /* list rules */ });
app.post('/upsert', authGuard, schema(RuleUpsertDto), async (...) => { /* upsert by kind */ });
```

#### routes/events.routes.ts

```ts
app.get('/', authGuard, async (req, reply) => { /* list events since lastEventId from Outbox */ });
```

#### modules/trades/ImportService.ts

```ts
export class ImportService {
  static async enqueue(userId: string, since?: string) {
    const jobArgs = { userId, since: since ?? dayjs().subtract(30,'day').toISOString() };
    return enqueueImport(jobArgs); // deterministic jobId handled by queue.ts
  }
}
```

#### workers/common/jobBase.ts

```ts
export function withJobBase(handler) {
  return async (job) => {
    try { await handler(job); metrics.ok(job.name); }
    catch (e) { metrics.fail(job.name); throw e; }
  };
}
```

#### workers/import.worker.ts

```ts
new Worker('q_import', withJobBase(async (job) => {
  const { userId, since } = job.data;
  const adapter = await BrokerService.forUser(userId);
  let cursor;
  do {
    const { trades, next } = await adapter.fetchTrades({ userId, since, cursor });
    const stored = await TradeRepo.upsertMany(userId, normalize(trades));
    await EventService.progress(userId, job.id, { stored, ... });
    cursor = next;
  } while (cursor);
  // enqueue scoring for new trades
  await q_score.add('score', { userId, since }, { jobId: hash(userId+since) });
}));
```

#### workers/score.worker.ts

```ts
new Worker('q_score', withJobBase(async (job) => {
  const { userId, since } = job.data;
  for await (const trade of TradeRepo.streamSince(userId, since)) {
    const features = await IndicatorsService.compute(trade);
    const tag = Heuristics.score(features); // label+confidence
    await BiasRepo.create({ tradeId: trade.id, ...tag, features });
    await OutboxRepo.append(userId, 'coach.reflect', buildReflectPayload(trade, tag, features));
  }
}));
```

#### workers/sim.worker.ts

```ts
new Worker('q_sim', withJobBase(async (job) => {
  const { userId, tradeId, horizonDays } = job.data;
  const res = await SimService.compute(userId, tradeId, horizonDays);
  return res; // client route will read from cache/DB
}));
```

#### workers/digest.worker.ts

```ts
new Worker('q_digest', withJobBase(async (job) => {
  const { userId, period } = job.data;
  const payload = await DigestService.aggregate(userId, period);
  const digest = await DigestRepo.upsertLatest(userId, period, payload);
  await OutboxRepo.append(userId, 'digest.ready', { digestId: digest.id, period });
}));
```

---

### C.4 API Endpoints & DTO Mapping (brief)

| Endpoint                            | Method | DTO In              | DTO Out          | Notes           |
| ----------------------------------- | ------ | ------------------- | ---------------- | --------------- |
| `/api/auth/signup`                  | POST   | `SignupDto`         | `SessionDto`     | Argon2id, audit |
| `/api/auth/login`                   | POST   | `LoginDto`          | `SessionDto`     | rotate session  |
| `/api/brokers/:id/connect/start`    | POST   | n/a                 | `{url,state}`    | OAuth intent    |
| `/api/brokers/:id/connect/callback` | GET    | `code,state`        | 200              | seal tokens     |
| `/api/trades/import`                | POST   | `ImportRequest`     | `202 {jobId}`    | Idempotency‑Key |
| `/api/trades`                       | GET    | query               | `TradeDto[]`     | cursor paging   |
| `/api/trades/:id/bias`              | GET    | n/a                 | `BiasTagDto[]`   |                 |
| `/api/simulations/simple`           | POST   | `SimulationRequest` | `{curves,delta}` | cached          |
| `/api/digests/weekly/latest`        | GET    | n/a                 | `DigestDto`      |                 |
| `/api/rules`                        | GET    | n/a                 | `RuleDto[]`      |                 |
| `/api/rules/upsert`                 | POST   | `RuleUpsertDto`     | `RuleDto`        |                 |
| `/api/events`                       | GET    | `since`             | `CoachEvent[]`   | replay backlog  |

> DTOs reference: `packages/shared/src/dto/*.ts` (Zod). Ensure alignment with Part B.

---

### C.5 Tests — Entry Points

```
apps/bff/test/unit/
  trades/tradeRepo.test.ts
  biases/biasRepo.test.ts
  events/outboxRepo.test.ts
  auth/sessionRepo.test.ts
  lib/tokenSeal.test.ts

apps/bff/test/integration/
  importAndScore.pipeline.test.ts   # Postgres+Redis via Testcontainers
  ws/relay.reconnect.test.ts        # lastEventId backfill

apps/bff/test/contracts/
  routes.schemas.test.ts            # DTO validation vs shared zod
  ml/hmac_signature.test.ts         # HMAC verify
```

---

### C.6 Env & Config (BFF)

* `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`
* `HMAC_KEY_ID`, `HMAC_SECRET` (→ ML service)
* `KMS_PROVIDER`, `KMS_KEY_ID`
* `OAUTH_COINBASE_CLIENT_ID`, `OAUTH_COINBASE_CLIENT_SECRET`
* `BASE_URL` (for OAuth callback construction)

---

### C.7 Definition of Ready (DoR) for BFF Implementation

* Entities/fields locked (Part B).
* Shared DTOs published in `@app/shared`.
* Broker stub endpoints defined for tests.
* Redis/Postgres available (Testcontainers config).
* Security headers/CSRF/session policies agreed.

---
