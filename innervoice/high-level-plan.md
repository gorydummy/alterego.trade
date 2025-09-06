```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                CLIENT LAYER                                  │
│                                                                              │
│  Web UI (Next.js · React · TypeScript)                                       │
│    • Journaling (pre/post) · Decision Gate · Weekly Digest views             │
│    • Auth session cookies · WebSocket/SSE for live gate results              │
└───────────────┬──────────────────────────────────────────────────────────────┘
                │ HTTPS / WS
                v
┌──────────────────────────────────────────────────────────────────────────────┐
│                                 EDGE-BFF                                     │
│            Node.js (Fastify) · JSON Schema validation (Ajv)                  │
│  • Auth/session, rate limit (Redis)                                          │
│  • Validates payloads against contracts                                      │
│  • Writes/reads via Core-API                                                 │
│  • Emits domain events → Upstash Redis Streams                               │
│  • Streams decisions back to UI (WS/SSE)                                     │
└───────────────┬───────────────┬──────────────────────────────────────────────┘
                │               │ events (produce)
                │               v
                │       ┌───────────────────────┐
                │       │   Upstash Redis       │
                │       │  • Streams (events)   │
                │       │  • KV/TTL (cooldowns) │
                │       │  • Rate limits/locks  │
                │       └──────────┬────────────┘
                │                  │ consume
                v                  v
┌───────────────────────────┐  ┌───────────────────────────────────────────────┐
│         Core-API          │  │                    Workers                    │
│  Node.js (Fastify)        │  │  Node.js workers on Cloud Run                 │
│  • CRUD: intents,         │  │  • intent-evaluator                           │
│    journals, personas     │  │  • adherence-scorer                           │
│  • Outbox (DB→Streams)    │  │  • digest-builder (cron)                      │
│  • Business rules read    │  │  • cooldown-scheduler (cron)                  │
└───────┬───────────┬───────┘  │  • Calls AI-Coach when needed                 │
        │           │          └───────────┬───────────────────────────────────┘
        │           │ SQL                  │ HTTP gRPC/HTTP
        v           v                      v
┌───────────────────────────┐        ┌─────────────────────────────────────────┐
│         Neon (PG)         │        │                AI-Coach                 │
│  • Intents, Journals      │        │  Service to render Strict-Clone output  │
│  • Personas/Rules         │        │  • Templates + policy guardrails        │
│  • Cooldowns, Outbox      │        │  • Non-advisory linter                  │
└───────────────────────────┘        │  • Connects to LLM provider             │
                                     └─────────────────────────────────────────┘
                 ┌─────────────────────────────────────────────────────────────┐
                 │           R2 (S3-compatible Object Storage)                 │
                 │  • Attachments: charts, screenshots, exports                │
                 └─────────────────────────────────────────────────────────────┘

                               ┌───────────────────────────────────────────────┐
                               │                 CONTRACTS                     │
                               │  NPM package: JSON Schemas + TS types         │
                               │  (optional Python models generated)           │
                               │  Used by: UI · Edge-BFF · Core-API · Workers  │
                               └───────────────────────────────────────────────┘

                               ┌───────────────────────────────────────────────┐
                               │                   INFRA                       │
                               │  Cloud Run (services & workers),              │
                               │  GitHub Actions (CI/CD),                      │
                               │  Logs/metrics (Cloud Logging/OTel),           │
                               │  Scheduled jobs (cron via Cloud Run/QStash)   │
                               └───────────────────────────────────────────────┘
```

### Stacks by component

* **Web UI:** Next.js · React · TypeScript · cookie session; WS/SSE client.
* **Edge-BFF:** Node.js (Fastify) · Ajv (JSON Schema) · Redis rate limit · WS/SSE.
* **Core-API:** Node.js (Fastify) · SQL migrations · Outbox pattern.
* **Workers:** Node.js on Cloud Run; consume Redis Streams; scheduled via cron.
* **AI-Coach:** Template renderer + persona policy guardrails + non-advisory linter; calls LLM provider.
* **Data:** Neon (Postgres), Upstash Redis (Streams/KV/TTL), R2 object storage.
* **Contracts:** JSON Schemas + generated TS types (and optional Python models) published as an NPM package.
* **Infra/DevX:** Cloud Run, GitHub Actions, container registry, logging/metrics, cron.

Perfect—let’s **plan first**, no scaffolding, no real code. Here’s the blueprint you can review and tweak before we touch repos.

# Foundations (principles & rails)

* **Contracts-first:** JSON Schemas as the single source of truth for requests, events, and templates.
* **Event-driven core:** Write to DB → append to **outbox** → dispatcher emits domain events → workers react.
* **First-person, non-advisory guardrails:** persona policy JSON + output linter; fixed gate outcomes `{GO, WAIT, SIZE_DOWN, SIMULATE, NO_GO}`.
* **Idempotency & auditability:** request IDs, unique constraints, event log.
* **Least moving parts now:** Redis Streams for events; Postgres for truth; R2 for blobs.
* **Versioning:** semantic versions on schemas & events; backward-compatible workers.
* **Security:** cookie session, CSRF, per-user RLS (later), column encryption for sensitive notes.

---

# Entity–Relationship Diagram (ERD)

```
Users (user_id PK)
  └─< Personas (persona_id PK, key enum: crypto|shortterm|swing|indexdca)
Users 1─* PreTradeIntents (intent_id PK, user_id FK, persona_id FK, created_at, direction, timeframe,
                           plan_json, risk_json, context_json, gate_result, gate_reason, status)
  └─0..1 Overrides (override_id PK, intent_id FK, rule_id, rationale, risk_statement,
                    safeguards, decision, reason, decided_at)

Users 1─* JournalEntries (entry_id PK, user_id FK, persona_id FK, linked_intent_id FK?,
                          entry_type enum{pre,post,note}, created_at, content_json,
                          emotions, adherence_json, outcome_json, retro_json)
  └─* Attachments (attachment_id PK, entry_id FK, url, kind, meta_json)

Users 1─* Cooldowns (cooldown_id PK, user_id FK, reason, starts_at, ends_at, active)
Users 1─* FrictionTasks (task_id PK, user_id FK, source_type enum{intent,entry},
                         source_id, cta_id, payload_json, status enum{open,done,cancelled}, created_at)

Rulesets (ruleset_id PK, persona_id FK, version, active)
  └─* RuleDefinitions (rule_id PK, ruleset_id FK, name, description, policy_json)

EventsOutbox (outbox_id PK, type, version, ts, data_json, dispatched bool, attempts, last_error)
EventLog     (event_id PK, type, version, ts, data_json, producer, correlation_id)

WeeklyDigests (digest_id PK, user_id FK, window_start, window_end, stats_json, text, created_at)
```

**Indexes (examples):**

* `pre_trade_intents (user_id, created_at desc)`, `(persona_id, created_at)`, `(status)`
* `journal_entries (user_id, created_at desc)`, `(persona_id, entry_type, created_at)`
* `cooldowns (user_id, active)`
* `eventlog (ts desc)`

**JSONB columns (flexible but validated at the edge):**

* `plan_json`, `risk_json`, `context_json`, `content_json`, `adherence_json`, `outcome_json`, `retro_json`, `payload_json`, `policy_json`, `stats_json`, `data_json`.

---

# Core user flows (pseudocode sequence)

## A) Submit Pre-Trade Intent → Decision Gate

```
UI -> BFF: POST /pretrade-intents  (payload validated by schema)
BFF:
  assert validate(schema.preTradeIntent, payload)
  guard: reject if cooldown.active OR portfolio_drawdown >= limit (policy)
  db.insert(pre_trade_intents, payload)
  outbox.append("pretrade.intent.submitted", data=payload)
  ack to UI {intent_id}

Dispatcher (polls outbox):
  for each new row:
    publish RedisStream "events": {"type":"pretrade.intent.submitted", data}

Worker(intent-evaluator):
  on event:
    gate = evaluate(payload, persona_policy, rules)
    emit RedisStream "events": {"type":"pretrade.decision.returned", data:{intent_id, gate}}

BFF (SSE/WS stream per user):
  on "pretrade.decision.returned" for user:
    push to UI

Core-API:
  persist gate_result/reason on intent
  eventlog.append(...)
```

## B) Pre / Post Trade Journaling

```
UI -> BFF: POST /journal-entries (pre or post) (schema.journalEntry)
BFF: validate → db.insert(journal_entries) → outbox "journal.entry.created"
Worker(adherence-scorer): compute adherence metrics → update entry → maybe emit cooldown.started
```

## C) Cooldown policy

```
Worker(adherence-scorer):
  if loss_streak >= threshold OR rule_breach:
    db.insert(cooldowns, starts_now, ends_at = now + policy.duration)
    outbox "cooldown.started"

BFF (on new intent):
  if cooldown.active: gate to WAIT and return friction CTAs
```

## D) Weekly Digest

```
Cron -> worker(digest-builder):
  stats = aggregate last 7 days (journals, intents)
  text = ai-coach.render("weekly-digest", {stats, persona})
  db.insert(weekly_digests, {stats, text})
  notify user
```

---

# Stack-by-stack plan

## 1) Web UI (Next.js/React/TS)

**Project structure**

```
app/
  (routes) /intents, /journal, /digest, /settings
features/
  intents/ (forms, list, view, stream hook)
  journal/ (pre, post, note editors)
  digest/ (weekly view)
  persona/ (policy viewer, cooldown banner)
lib/
  api/ (typed fetch wrappers to BFF)
  streaming/ (SSE/WS client)
  contracts/ (TS types from schemas)
state/
  session/, ui-flags/, toasts/
```

**Integration**

```
function submitIntent(form):
  payload = mapFormToPreTradeIntent(form)
  assert validateClient(payload)         // optional client-side schema
  POST BFF /pretrade-intents
  subscribeSSE("/users/{me}/stream")    // receive decision event
  render GatePanel(result)

function createJournal(entry):
  POST BFF /journal-entries
  navigate("/journal/{entry_id}")
```

**Tech**

* Cookie session auth; CSRF on POST.
* SSE for decisions (simple, works behind proxies). WS only if you need duplex.

---

## 2) Edge-BFF (Node/Fastify + Ajv + Redis)

**Project structure**

```
src/
  plugins/
    ajv.ts (load compiled JSON Schemas)
    auth.ts (session extraction)
    rateLimit.ts (redis token bucket)
    streams.ts (redis client)
  routes/
    intents.post.ts
    journal.post.ts
    stream.sse.ts
  services/
    outbox.ts (db write + queue)
    guardrails.ts (cooldown/drawdown guards)
  middlewares/
  config/
```

**DB & integration**

```
route POST /pretrade-intents:
  requireAuth()
  validate(schema.preTradeIntent, req.body)
  guardrails.check(user_id)
  tx:
    db.insert(pre_trade_intents, body)
    db.insert(events_outbox, "pretrade.intent.submitted", body)
  return {intent_id}

route GET /stream (SSE):
  subscribe RedisStream "events"
  filter by user_id
  send decision messages
```

**Tech**

* Ajv with compiled schemas.
* Idempotency: `Idempotency-Key` header → Redis SETNX for 24h.

---

## 3) Core-API (Node/Fastify + Prisma or SQLx)

**Project structure**

```
src/
  modules/
    intents/ (repo, queries, projections)
    journal/ (repo, queries)
    cooldowns/
    digests/
    outbox/ (append-only, dispatcher)
    rules/ (load persona policy)
```

**Patterns**

```
function persistAndOutbox(table, record, eventType):
  tx:
    db.insert(table, record)
    db.insert(events_outbox, {type: eventType, data: record})

function dispatchOutbox():
  rows = db.select(events_outbox where dispatched=false limit N)
  for row in rows:
    publish(redisStream, row)
    markDispatched(row)
```

**Tables (starter)**

* `pre_trade_intents`, `journal_entries`, `attachments`, `cooldowns`, `friction_tasks`,
  `rulesets`, `rule_definitions`, `events_outbox`, `event_log`, `weekly_digests`.

---

## 4) Workers (Cloud Run jobs / containers)

**Services**

* `intent-evaluator`: turns `pretrade.intent.submitted` → `pretrade.decision.returned`.
* `adherence-scorer`: updates `journal_entries.adherence_json`; emits `cooldown.started` when needed.
* `digest-builder` (cron): aggregates stats; asks AI-coach to render text; persists `weekly_digests`.
* `cooldown-scheduler` (cron): expires cooldowns; emits `cooldown.ended`.

**Consumption model (pseudocode)**

```
loop readRedisStream("events"):
  switch event.type:
    case "pretrade.intent.submitted": handleIntent(event.data)
    case "journal.entry.created":     handleJournal(event.data)
    ...
ack event
```

**Idempotency**

```
if event_id processed? skip; else process and record in worker_offsets
```

---

## 5) AI-Coach (Template rendering + guardrails)

**Project structure**

```
templates/ (journal-pre, journal-post, decision-gate, weekly-digest, cooldown, override-review)
policies/  (persona JSONs)
src/
  render.ts (load template, render with view)
  guardrails.ts (banlist/allowlist phrase linter)
  providers/llm.ts (abstract LLM calls)
```

**Flow (pseudocode)**

```
function renderDecision(view):
  text = renderTemplate("decision-gate", view)
  assert guardrails.pass(text, personaPolicy.boundaries)
  return text
```

**Tech**

* Mustache/Handlebars for deterministic rendering.
* LLM optional: use for digest narrative only; still re-lint outputs.

---

## 6) Data layer (Neon Postgres)

**Guidelines**

* JSONB for flexible sub-objects; validate at edge; add partial indexes when specific keys are queried often.
* Use **created\_at** on everything; foreign keys with `ON DELETE SET NULL` for optional links (e.g., `linked_intent_id`).
* Consider **RLS** later (per-user isolation).

**Example constraints (conceptual)**

```
CHECK (gate_result IN ('GO','WAIT','SIZE_DOWN','SIMULATE','NO_GO'))
UNIQUE (user_id, intent_id)
```

---

## 7) Events & Contracts

**Event types (v0.1)**

* `pretrade.intent.submitted`
* `pretrade.decision.returned`
* `pretrade.override.requested`
* `pretrade.override.resolved`
* `journal.entry.created`
* `rules.breach.detected`
* `cooldown.started`
* `cooldown.ended`
* `digest.weekly.created`

**Contract governance**

```
schema.version = semver
services pin versions; workers accept N-1
contracts npm package publishes schemas + TS types
```

---

# What to validate now (before scaffolding)

1. **ERD:** any missing entities? (e.g., broker accounts, instruments catalog, prop-challenge metadata)
2. **Gate outcomes:** fixed set OK? Any additional “explainability” fields?
3. **Cooldown rules:** driven by persona policy only, or also user-custom rules?
4. **Delivery channel:** SSE good for decisions, or do you need WS for other reasons?
5. **Weekly digest scope:** narrative only vs. PDF/HTML export stored in R2?
