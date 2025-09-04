# Share Package
Put all shared schemas in a **single “contracts” package** and consume it from every service. Emit both **TypeScript types + runtime Zod validators** (for Node clients) and **JSON Schema** (to code-gen **Pydantic** models for the Python AI service). Version it with **semver** and guard changes with **contract tests**.

Here’s a copy-ready plan you can drop in your docs/repo.

---

# Shared Contracts (Zod) — Monorepo Pattern

## Why this pattern

* **One source of truth** for DTOs/events.
* **Runtime validation** (Zod) + **static types** (TS) for Node services.
* **JSON Schema** export → **Pydantic** (Python) codegen, keeping AI service in lock-step.
* Works for **Web**, **Edge/BFF**, **Core**, **Workers**, **Mobile**, **AI Coach**.

---

## Repo layout (monorepo)

```
.
├─ apps/
│  ├─ edge/          # S2
│  ├─ core/          # S3
│  ├─ workers/       # S4
│  ├─ web/           # S1
│  └─ ai-coach/      # S5 (Python)
├─ packages/
│  ├─ contracts/     # <-- THE shared Zod package (authoritative)
│  └─ contracts-py/  # generated Pydantic models (do not edit)
├─ package.json
├─ pnpm-workspace.yaml  # or npm/yarn workspaces, Turborepo optional
└─ turbo.json           # optional, for build caching
```

---

## `packages/contracts` (authoritative)

**package.json**

```json
{
  "name": "@tc/contracts",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.cjs",
  "module": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist", "schemas"],
  "scripts": {
    "build": "tsup src/index.ts --dts --format cjs,esm",
    "gen:schemas": "ts-node scripts/gen-schemas.ts",
    "check": "tsc -p tsconfig.json"
  },
  "dependencies": { "zod": "^3.23.8", "zod-to-json-schema": "^3.23.5" },
  "devDependencies": { "tsup": "^8.0.1", "typescript": "^5.6.2", "ts-node": "^10.9.2" }
}
```

**src/index.ts (example slice)**

```ts
import { z } from "zod";

/** Entities (align with our ERD) */
export const Trade = z.object({
  id: z.string().cuid2(),
  userId: z.string(),
  broker: z.enum(["coinbase","binance"]),
  extId: z.string(),
  symbol: z.string(),               // e.g., "BTC-USD"
  side: z.enum(["BUY","SELL"]),
  qty: z.number().positive(),
  price: z.number().positive(),
  fee: z.number().nonnegative().optional(),
  ts: z.string().datetime()
});
export type Trade = z.infer<typeof Trade>;

export const BiasTag = z.object({
  id: z.string().cuid2(),
  tradeId: z.string(),
  label: z.enum(["FOMO","PANIC","DISCIPLINE","NEUTRAL"]),
  confidence: z.number().min(0).max(1),
  features: z.record(z.any()),
  createdAt: z.string().datetime()
});
export type BiasTag = z.infer<typeof BiasTag>;

export const WeeklyDigest = z.object({
  id: z.string().cuid2(),
  userId: z.string(),
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  stats: z.object({
    tradesTotal: z.number().int().nonnegative(),
    biasCounts: z.record(z.number().int().nonnegative()),
    pnlDeltaIfNoFomo: z.number()
  })
});
export type WeeklyDigest = z.infer<typeof WeeklyDigest>;

/** Event envelope (versioned) */
export const EventEnvelope = z.object({
  eventId: z.string(),
  type: z.enum(["import.progress","coach.reflect","digest.ready"]),
  v: z.number().int().positive(),           // schema version
  ts: z.string().datetime(),
  payload: z.unknown()
});

/** Event payloads */
export const EImportProgress = z.object({
  jobId: z.string(),
  percent: z.number().min(0).max(100).optional(),
  fetched: z.number().int().nonnegative(),
  stored: z.number().int().nonnegative()
});

export const ECoachReflect = z.object({
  tradeId: z.string(),
  labels: z.array(z.object({ name: BiasTag.shape.label, confidence: z.number() })),
  insight: z.string().max(280),
  sparklines: z.array(z.number()).max(256).optional(),
  tone: z.enum(["supportive","strict"]).default("supportive")
});

export const EDigestReady = z.object({
  digestId: z.string(),
  period: z.object({ start: z.string().date(), end: z.string().date() })
});

/** Registry */
export const EventRegistry = {
  "import.progress": EImportProgress,
  "coach.reflect":   ECoachReflect,
  "digest.ready":    EDigestReady
} as const;

export type EventType = keyof typeof EventRegistry;
```

**scripts/gen-schemas.ts**

```ts
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import * as fs from "fs";
import * as path from "path";
import { Trade, BiasTag, WeeklyDigest, EventEnvelope, EImportProgress, ECoachReflect, EDigestReady } from "../src";

const artifacts = {
  Trade, BiasTag, WeeklyDigest, EventEnvelope,
  EImportProgress, ECoachReflect, EDigestReady
};

fs.mkdirSync(path.join(process.cwd(), "schemas"), { recursive: true });

for (const [name, schema] of Object.entries(artifacts)) {
  const json = zodToJsonSchema(schema, { name, target: "jsonSchema7" });
  fs.writeFileSync(path.join("schemas", `${name}.schema.json`), JSON.stringify(json, null, 2));
}
console.log("✅ JSON Schemas generated to packages/contracts/schemas");
```

> Running `pnpm -w --filter @tc/contracts build && pnpm -w --filter @tc/contracts gen:schemas` produces:
>
> * `dist/` (ESM+CJS+types) for Node services & RN mobile
> * `schemas/*.schema.json` for Python codegen

---

## Consuming in Node services (S1/S2/S3/S4)

```ts
// Example in Edge (S2)
import { EventEnvelope, ECoachReflect } from "@tc/contracts";

const ev = EventEnvelope.parse(incoming);      // envelope runtime check
if (ev.type === "coach.reflect") {
  const payload = ECoachReflect.parse(ev.payload);
  // safe to fan-out to WS
}
```

---

## Python (S5 AI Coach) — generate Pydantic models

Generate once per build from the JSON Schemas (no hand-sync):

```
apps/ai-coach/
  gen_models.py
  models/   # generated, git-ignored
```

**requirements.txt (excerpt)**

```
pydantic==2.*
datamodel-code-generator==0.25.*
```

**gen\_models.py**

```python
import subprocess, os, glob

SCHEMAS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "packages", "contracts", "schemas")
OUT_DIR = os.path.join(os.path.dirname(__file__), "models")
os.makedirs(OUT_DIR, exist_ok=True)

for schema in glob.glob(os.path.join(SCHEMAS_DIR, "*.schema.json")):
    subprocess.run([
        "datamodel-codegen",
        "--input", schema,
        "--input-file-type", "jsonschema",
        "--output-model-type", "pydantic_v2.BaseModel",
        "--use-standard-collections",
        "--disable-appending-item-suffix",
        "--target-python-version", "3.11",
        "--output", os.path.join(OUT_DIR, os.path.basename(schema).replace(".schema.json",".py"))
    ], check=True)

print("✅ Generated Pydantic models from JSON Schemas.")
```

**FastAPI usage**

```python
from models.ECoachReflect import ECoachReflect  # generated
from models.EventEnvelope import EventEnvelope

def handle_reflect(ev_json: dict):
    env = EventEnvelope.model_validate(ev_json)
    assert env.type == "coach.reflect"
    payload = ECoachReflect.model_validate(env.payload)
    # safe usage here
```

> This keeps Python models **always in sync** with contracts.

---

## Versioning & compatibility policy

* **Semver on @tc/contracts**:

  * **PATCH**: docs/comments/typo; no schema changes.
  * **MINOR**: **backward-compatible** additive changes (new optional fields, new event types).
  * **MAJOR**: breaking changes (remove/rename/required field change).
* **Events are versioned** in the envelope (`v`). When you *must* break payload shape:

  * Emit **both versions** for a deprecation window (e.g., `coach.reflect v1` and `v2`).
  * Consumers switch at their own pace.

**Rule of thumb:** prefer additive changes. Make new fields **optional** first; backfill; only then consider making them required.

---

## Publishing & distribution options

* **Monorepo workspaces (recommended):** All services live in one repo. Each `apps/*` depends on `@tc/contracts` via a workspace link (`"@tc/contracts": "workspace:*"`). No registry needed.
* **Polyrepo:** Publish `@tc/contracts` to a private NPM (GitHub Packages/Verdaccio):

  * `npm publish --access=restricted`
  * Consumers pin `^0.2.0`. Use **Changesets** to automate versioning & changelogs.
* **Mobile (React Native):** Just import `@tc/contracts` like any other TS package.

---

## CI guardrails

Add to CI (already proposed in Test Strategy):

1. **Build + schema export** on each contracts change:

   * Run `pnpm --filter @tc/contracts build gen:schemas`.
   * Upload `schemas/` as an artifact.
2. **Contract tests**:

   * Consumers (S1/S2/S3/S4) import `@tc/contracts` and validate sample payloads.
   * AI service runs `gen_models.py` and validates round-trip (json → Pydantic → json).
3. **Breaking change detection** (optional):

   * Keep a baseline `schemas/*.json` snapshot; diff in CI and fail if a field changed type/requiredness without a semver bump.
4. **Pact tests** (Edge↔Core, Workers↔AI) to ensure providers satisfy consumers with the **current contracts version**.

---

## Developer workflow

* Add/modify a schema in `packages/contracts/src`.
* Run locally:

  ```bash
  pnpm -w --filter @tc/contracts build gen:schemas
  pnpm -w --filter ./apps/ai-coach python gen_models.py
  ```
* Update consumers if needed; run tests.
* Commit with Changesets (`pnpm changeset`); merge → CI publishes new contracts (if polyrepo) and rebuilds services.

---

## FAQ

**Q: Why not OpenAPI first and generate everything from it?**
A: We want **runtime validation in Node** + **first-class TS types**. Zod gives that. We still export **JSON Schema**, so Python stays aligned. If you prefer OpenAPI later, we can **generate OpenAPI** from Zod via `zod-openapi` without throwing away this setup.

**Q: Can the AI Coach *import* Zod directly?**
A: Not in Python. That’s why we export JSON Schema and **generate Pydantic** models at build time.

**Q: How do we handle events over WS and SSE?**
A: Every event is an **envelope + typed payload**. Zod validates on send/receive in Node; Pydantic validates in Python. Version `v` lives in the envelope.

---
