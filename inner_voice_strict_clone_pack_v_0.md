# Inner Voice – Strict Clone Template Pack (v0.1)

This pack contains:

- **Strict‑Clone prompt templates** (first‑person, non‑advisory) for: journaling (pre/post), decision gate, weekly digest, adherence checks, cooldown talk‑downs, and friction CTAs.
- **Persona policy JSONs** for Short‑Term, Swing, Crypto, and Index/DCA (free tier), plus a schema to validate them.
- **Contracts**: JSON Schemas for `JournalEntry` and `PreTradeIntent` + core events for your workers bus.
- **TypeScript types** (derived from the schemas) and example payloads.
- **Repo layout guidance** for the polyrepo.

---

## 0) Suggested Repo Layout (Polyrepo)

```
contracts/                      # NPM package (shared JSON Schemas + TS types)
  package.json
  src/
    schemas/
      persona-policy.schema.json
      journal-entry.schema.json
      pre-trade-intent.schema.json
      events/
        pretrade.intent.submitted.schema.json
        pretrade.decision.returned.schema.json
        pretrade.override.requested.schema.json
        pretrade.override.resolved.schema.json
        journal.entry.created.schema.json
        rules.breach.detected.schema.json
        cooldown.started.schema.json
        cooldown.ended.schema.json
    types/
      index.d.ts                 # generated via json-schema-to-typescript

ai-coach/
  templates/strict-clone/
    journal-pre.tmpl
    journal-post.tmpl
    decision-gate.tmpl
    weekly-digest.tmpl
    adherence-check.tmpl
    cooldown-talkdown.tmpl
    override-review.tmpl
  persona_policies/
    short-term.json
    swing.json
    crypto.json
    index-dca.json

edge-bff/
  ... (WS auth, rule checks proxy)

core-api/
  ... (CRUD, rule engine, schema validation)

workers/
  ... (intent evaluation, metrics, digests, cooldown scheduler)

infra/ (Cloud Run, Neon, Upstash, R2)
```

---

## 1) Strict‑Clone Prompt Templates (first‑person, non‑advisory)

> **Template syntax:** moustache‑style `{{var}}`. Render server fills with validated contract objects. All outputs **must** be first‑person and non‑advisory (no signals, no price targets). The clone speaks as **my inner voice**.

### 1.1 `journal-pre.tmpl`

```
# Pre‑Trade Journal ({{persona.name}})

I’m about to trade {{instrument.symbol}} ({{direction}}) on the {{timeframe}} timeframe.

**Why now (my thesis):** {{thesis}}
**Setup tags:** {{#setup_tags}}{{.}}, {{/setup_tags}}
**Catalysts / risks:** {{catalysts}}
**Planned entry:** {{entry.plan}}
**Stop / invalidation:** {{risk.invalidation}}
**Risk per trade (units/%):** {{risk.units}} / {{risk.percent}}%
**Max portfolio drawdown guard:** {{risk.portfolio_drawdown_limit}}%

**Rule check:**
{{#rules}}
- [{{#passed}}✓{{/passed}}{{^passed}}✕{{/passed}}] {{id}} — {{name}} {{#explanation}}({{.}}){{/explanation}}
{{/rules}}

**Emotional state:** {{emotions}}
**Recent context:** W/L streak {{context.streak}}, sleep {{context.sleep_quality}}, distractions {{context.distractions}}

**Go/No‑Go intuition (not advice):** I only proceed if my rules pass and risk is inside limits. If not, I’ll either wait, size down, or simulate.
```

### 1.2 `journal-post.tmpl`

```
# Post‑Trade Reflection ({{persona.name}})

**Outcome:** {{outcome.result}} | PnL: {{outcome.pnl}} | Duration: {{outcome.duration}}
**Plan adherence:** {{adherence.score}}/100
- Entry per plan: {{adherence.entry_ok}}
- Exit per plan: {{adherence.exit_ok}}
- Deviations: {{adherence.deviations}}

**What went well:** {{retro.positives}}
**What I tripped on:** {{retro.mistakes}}
**One change next time:** {{retro.one_change}}

**Metrics:** MAE {{metrics.mae}}, MFE {{metrics.mfe}}, Slippage {{metrics.slippage}}

If I broke a rule, I log it and accept the cooldown if applicable. I don’t justify; I learn and adjust.
```

### 1.3 `decision-gate.tmpl`

```
# Decision Gate ({{persona.name}}) — First‑Person, Non‑Advisory

I’m evaluating an intent to {{direction}} {{instrument.symbol}} on {{timeframe}}.

**Snapshot:**
- Risk budget left: {{risk.budget_left}} | Cooldown active: {{risk.cooldown_active}}
- Recent streak: {{context.streak}} | Volatility: {{context.volatility}}
- Key rules failed: {{#failed_rules}}{{id}}{{^last}}, {{/last}}{{/failed_rules}}{{^failed_rules}}none{{/failed_rules}}

**My gate result:** **{{gate.result}}** (one of GO | WAIT | SIZE_DOWN | SIMULATE | NO_GO)

**Reasoning (non‑advisory):** {{gate.reasoning}}

**Friction actions I will take:**
{{#friction_ctas}}
- {{label}} → {{action}}
{{/friction_ctas}}

If I request an override, I must state the rule I’m overriding and the concrete risk I accept. Overrides are logged and counted.
```

### 1.4 `weekly-digest.tmpl`

```
# Weekly Digest ({{persona.name}})

**Week range:** {{window.start}} → {{window.end}}

**Stats:** Trades {{stats.trades}}, Win% {{stats.win_rate}}%, Expectancy {{stats.expectancy}}, Best/Worst {{stats.best}} / {{stats.worst}}

**Rule adherence:** avg {{adherence.avg}}/100; breaches: {{adherence.breaches}}
**Themes spotted:** {{themes}}
**One focus next week:** {{focus}}
**Friction plan:** {{friction_plan}}
```

### 1.5 `adherence-check.tmpl`

```
# Adherence Check ({{persona.name}})

I verify today’s plan against my rules. Any ✕ becomes a blocker unless explicitly overridden.
{{#rules}}
- [{{#passed}}✓{{/passed}}{{^passed}}✕{{/passed}}] {{name}}
{{/rules}}

If blocked, I either **wait** or **simulate**. I don’t force trades.
```

### 1.6 `cooldown-talkdown.tmpl`

```
# Cooldown — Talk‑Down ({{persona.name}})

I’m on cooldown until {{cooldown.ends_at}} because {{cooldown.reason}}. I protect my capital and my future self by stepping aside now. I’ll channel energy into:
- Reviewing the last {{cooldown.review_window}} trades
- Practicing in simulator
- Re‑writing my checklist with one concrete change
```

### 1.7 `override-review.tmpl`

```
# Override Review ({{persona.name}})

I requested to override: {{override.rule_id}} — {{override.rationale}}.

**Risk I accept:** {{override.risk_statement}}
**Safeguards:** {{override.safeguards}}
**Decision:** {{override.decision}} (APPROVED/REJECTED)
**Reason:** {{override.reason}}
```

---

## 2) Persona Policies (JSON + validating schema)

### 2.1 `persona-policy.schema.json`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://contracts.inner-voice.ai/schemas/persona-policy.schema.json",
  "title": "PersonaPolicy",
  "type": "object",
  "required": ["id", "name", "audience", "objectives", "tone", "boundaries", "defaults", "evaluation_weights", "friction_ctas", "cooldown_rules"],
  "properties": {
    "id": {"type": "string"},
    "version": {"type": "string", "default": "0.1.0"},
    "name": {"type": "string"},
    "audience": {"type": "string"},
    "objectives": {"type": "array", "items": {"type": "string"}},
    "tone": {"type": "object", "required": ["person", "style", "tenor"],
      "properties": {
        "person": {"const": "first"},
        "style": {"type": "array", "items": {"type": "string"}},
        "tenor": {"type": "string"}
      }
    },
    "boundaries": {
      "type": "object",
      "required": ["non_advisory", "banned_phrasing", "allowed_phrasing"],
      "properties": {
        "non_advisory": {"const": true},
        "banned_phrasing": {"type": "array", "items": {"type": "string"}},
        "allowed_phrasing": {"type": "array", "items": {"type": "string"}}
      }
    },
    "defaults": {
      "type": "object",
      "properties": {
        "risk": {
          "type": "object",
          "properties": {
            "risk_unit_percent": {"type": "number"},
            "portfolio_drawdown_limit_percent": {"type": "number"},
            "max_concurrent_positions": {"type": "integer"}
          }
        },
        "timeframes": {"type": "array", "items": {"type": "string"}}
      }
    },
    "evaluation_weights": {
      "type": "object",
      "properties": {
        "rules_pass": {"type": "number"},
        "recent_behavior": {"type": "number"},
        "market_conditions": {"type": "number"},
        "emotional_state": {"type": "number"}
      }
    },
    "friction_ctas": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "label", "action"],
        "properties": {
          "id": {"type": "string"},
          "label": {"type": "string"},
          "action": {"type": "string"}
        }
      }
    },
    "cooldown_rules": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "trigger", "duration_minutes"],
        "properties": {
          "id": {"type": "string"},
          "trigger": {"type": "string"},
          "duration_minutes": {"type": "integer"}
        }
      }
    }
  }
}
```

### 2.2 Persona JSONs

#### `crypto.json`
```json
{
  "id": "persona.crypto",
  "version": "0.1.0",
  "name": "Crypto Day/Swing",
  "audience": "Crypto day traders & prop-challenge candidates",
  "objectives": [
    "Keep me inside pre-declared risk and process",
    "Block impulsive entries; prefer simulate/wait",
    "Reinforce journaling and post-trade review"
  ],
  "tone": {
    "person": "first",
    "style": ["direct", "calm", "blunt-when-needed"],
    "tenor": "strict clone, not a coach; no advice"
  },
  "boundaries": {
    "non_advisory": true,
    "banned_phrasing": [
      "Buy now", "Sell now", "Set a target at", "This coin will", "You should"
    ],
    "allowed_phrasing": [
      "I will only act if my rules pass", "I’m choosing to wait", "I’ll simulate instead", "I’m reducing size within my risk policy"
    ]
  },
  "defaults": {
    "risk": {
      "risk_unit_percent": 0.5,
      "portfolio_drawdown_limit_percent": 6,
      "max_concurrent_positions": 3
    },
    "timeframes": ["1m", "5m", "15m", "1h"]
  },
  "evaluation_weights": {
    "rules_pass": 0.5,
    "recent_behavior": 0.2,
    "market_conditions": 0.2,
    "emotional_state": 0.1
  },
  "friction_ctas": [
    {"id": "cta.wait.alert", "label": "Set price alert", "action": "edge-bff:setAlert"},
    {"id": "cta.sim.paper", "label": "Practice in simulator", "action": "core-api:startPaperTrade"},
    {"id": "cta.size.down", "label": "Reduce size by half", "action": "core-api:adjustSize"},
    {"id": "cta.cooldown", "label": "Start 60‑min cooldown", "action": "workers:startCooldown(60)"}
  ],
  "cooldown_rules": [
    {"id": "cd.loss-streak-3", "trigger": "consecutive_losses>=3", "duration_minutes": 120},
    {"id": "cd-rule-breach", "trigger": "rule_breach=true", "duration_minutes": 60}
  ]
}
```

#### `short-term.json`
```json
{
  "id": "persona.shortterm",
  "version": "0.1.0",
  "name": "Short‑Term Equities",
  "audience": "Intraday/short swing equities",
  "objectives": ["Enforce checklists", "Favor wait/smaller size over impulse"],
  "tone": {"person": "first", "style": ["concise", "firm"], "tenor": "non‑advisory"},
  "boundaries": {"non_advisory": true, "banned_phrasing": ["Buy now", "Target"], "allowed_phrasing": ["I’ll wait", "I’ll simulate"]},
  "defaults": {"risk": {"risk_unit_percent": 0.25, "portfolio_drawdown_limit_percent": 5, "max_concurrent_positions": 2}, "timeframes": ["1m", "5m", "15m"]},
  "evaluation_weights": {"rules_pass": 0.55, "recent_behavior": 0.2, "market_conditions": 0.15, "emotional_state": 0.1},
  "friction_ctas": [
    {"id": "cta.wait.alert", "label": "Set alert", "action": "edge-bff:setAlert"},
    {"id": "cta.sim.paper", "label": "Simulate", "action": "core-api:startPaperTrade"}
  ],
  "cooldown_rules": [
    {"id": "cd.loss-streak-2", "trigger": "consecutive_losses>=2", "duration_minutes": 90}
  ]
}
```

#### `swing.json`
```json
{
  "id": "persona.swing",
  "version": "0.1.0",
  "name": "Swing",
  "audience": "Multi‑day swing",
  "objectives": ["Process consistency", "Limit overtrading"],
  "tone": {"person": "first", "style": ["measured", "structured"], "tenor": "non‑advisory"},
  "boundaries": {"non_advisory": true, "banned_phrasing": ["Buy now"], "allowed_phrasing": ["I’ll wait for my trigger"]},
  "defaults": {"risk": {"risk_unit_percent": 0.5, "portfolio_drawdown_limit_percent": 7, "max_concurrent_positions": 5}, "timeframes": ["1h", "4h", "1d"]},
  "evaluation_weights": {"rules_pass": 0.45, "recent_behavior": 0.25, "market_conditions": 0.2, "emotional_state": 0.1},
  "friction_ctas": [{"id": "cta.wait.alert", "label": "Set alert", "action": "edge-bff:setAlert"}],
  "cooldown_rules": [{"id": "cd.loss-streak-3", "trigger": "consecutive_losses>=3", "duration_minutes": 240}]
}
```

#### `index-dca.json` (free tier)
```json
{
  "id": "persona.indexdca",
  "version": "0.1.0",
  "name": "Index/DCA",
  "audience": "Long‑term index accumulation",
  "objectives": ["Automate journaling cadence", "Avoid timing impulses"],
  "tone": {"person": "first", "style": ["calm", "minimalist"], "tenor": "non‑advisory"},
  "boundaries": {"non_advisory": true, "banned_phrasing": ["Time the market"], "allowed_phrasing": ["I stick to my cadence"]},
  "defaults": {"risk": {"risk_unit_percent": 0.1, "portfolio_drawdown_limit_percent": 0, "max_concurrent_positions": 1}, "timeframes": ["1w", "1m"]},
  "evaluation_weights": {"rules_pass": 0.6, "recent_behavior": 0.2, "market_conditions": 0.1, "emotional_state": 0.1},
  "friction_ctas": [{"id": "cta.schedule.dca", "label": "Schedule next DCA", "action": "core-api:scheduleDCA"}],
  "cooldown_rules": []
}
```

---

## 3) Contracts — JSON Schemas

### 3.1 `journal-entry.schema.json`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://contracts.inner-voice.ai/schemas/journal-entry.schema.json",
  "title": "JournalEntry",
  "type": "object",
  "required": ["id", "user_id", "created_at", "entry_type", "persona", "content"],
  "properties": {
    "id": {"type": "string", "format": "uuid"},
    "user_id": {"type": "string", "format": "uuid"},
    "created_at": {"type": "string", "format": "date-time"},
    "linked_intent_id": {"type": "string", "format": "uuid"},
    "entry_type": {"type": "string", "enum": ["pre", "post", "note"]},
    "persona": {"type": "string", "enum": ["crypto", "shortterm", "swing", "indexdca"]},
    "content": {
      "type": "object",
      "required": ["instrument", "timeframe", "thesis", "risk"],
      "properties": {
        "instrument": {"type": "object", "required": ["symbol", "class"], "properties": {
          "symbol": {"type": "string"},
          "class": {"type": "string", "enum": ["crypto", "equity", "forex", "index", "other"]}
        }},
        "direction": {"type": "string", "enum": ["long", "short", "flat"]},
        "timeframe": {"type": "string"},
        "thesis": {"type": "string", "maxLength": 2000},
        "setup_tags": {"type": "array", "items": {"type": "string"}},
        "catalysts": {"type": "string"},
        "entry": {"type": "object", "properties": {
          "plan": {"type": "string"},
          "price": {"type": "number"},
          "order_type": {"type": "string", "enum": ["market", "limit", "stop", "other"]}
        }},
        "risk": {"type": "object", "required": ["units", "percent", "invalidation"], "properties": {
          "units": {"type": "number", "minimum": 0},
          "percent": {"type": "number", "minimum": 0, "maximum": 100},
          "invalidation": {"type": "string"},
          "portfolio_drawdown_limit": {"type": "number"}
        }},
        "rules": {"type": "array", "items": {"type": "object", "required": ["id", "name", "passed"], "properties": {
          "id": {"type": "string"},
          "name": {"type": "string"},
          "passed": {"type": "boolean"},
          "explanation": {"type": "string"}
        }}}
      }
    },
    "emotions": {"type": "string"},
    "context": {"type": "object", "properties": {
      "streak": {"type": "integer"},
      "sleep_quality": {"type": "string", "enum": ["poor", "ok", "good"]},
      "distractions": {"type": "string"}
    }},
    "outcome": {"type": "object", "properties": {
      "result": {"type": "string", "enum": ["win", "loss", "breakeven", "na"]},
      "pnl": {"type": "number"},
      "duration": {"type": "string"},
      "mfe": {"type": "number"},
      "mae": {"type": "number"},
      "slippage": {"type": "number"}
    }},
    "adherence": {"type": "object", "properties": {
      "score": {"type": "integer", "minimum": 0, "maximum": 100},
      "entry_ok": {"type": "boolean"},
      "exit_ok": {"type": "boolean"},
      "deviations": {"type": "string"}
    }},
    "retro": {"type": "object", "properties": {
      "positives": {"type": "string"},
      "mistakes": {"type": "string"},
      "one_change": {"type": "string"}
    }},
    "attachments": {"type": "array", "items": {"type": "string", "format": "uri"}}
  }
}
```

### 3.2 `pre-trade-intent.schema.json`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://contracts.inner-voice.ai/schemas/pre-trade-intent.schema.json",
  "title": "PreTradeIntent",
  "type": "object",
  "required": ["id", "user_id", "submitted_at", "persona", "instrument", "direction", "timeframe", "plan", "risk", "context"],
  "properties": {
    "id": {"type": "string", "format": "uuid"},
    "user_id": {"type": "string", "format": "uuid"},
    "submitted_at": {"type": "string", "format": "date-time"},
    "persona": {"type": "string", "enum": ["crypto", "shortterm", "swing", "indexdca"]},
    "instrument": {"type": "object", "required": ["symbol", "class"], "properties": {
      "symbol": {"type": "string"},
      "class": {"type": "string", "enum": ["crypto", "equity", "forex", "index", "other"]}
    }},
    "direction": {"type": "string", "enum": ["long", "short"]},
    "timeframe": {"type": "string"},
    "plan": {"type": "object", "required": ["entry", "stop", "invalidates"], "properties": {
      "entry": {"type": "string"},
      "stop": {"type": "string"},
      "target": {"type": "string"},
      "invalidates": {"type": "string"}
    }},
    "risk": {"type": "object", "required": ["size_units", "risk_unit_percent"], "properties": {
      "size_units": {"type": "number"},
      "risk_unit_percent": {"type": "number"},
      "budget_left_percent": {"type": "number"},
      "portfolio_drawdown_percent": {"type": "number"},
      "cooldown_active": {"type": "boolean"}
    }},
    "rules": {"type": "array", "items": {"type": "object", "required": ["id", "name", "passed"], "properties": {
      "id": {"type": "string"},
      "name": {"type": "string"},
      "passed": {"type": "boolean"},
      "evidence": {"type": "string"}
    }}}
    ,
    "context": {"type": "object", "required": ["streak", "volatility"], "properties": {
      "streak": {"type": "integer", "description": "positive=win streak, negative=loss streak"},
      "volatility": {"type": "string", "enum": ["low", "mid", "high"]},
      "recent_hours_traded": {"type": "number"},
      "sleep_quality": {"type": "string", "enum": ["poor", "ok", "good"]},
      "distractions": {"type": "string"}
    }},
    "gate": {"type": "object", "properties": {
      "result": {"type": "string", "enum": ["GO", "WAIT", "SIZE_DOWN", "SIMULATE", "NO_GO"]},
      "reasoning": {"type": "string"}
    }},
    "friction_ctas": {"type": "array", "items": {"type": "object", "required": ["id", "label", "action"], "properties": {
      "id": {"type": "string"},
      "label": {"type": "string"},
      "action": {"type": "string"}
    }}}
    ,
    "override": {"type": "object", "properties": {
      "requested": {"type": "boolean"},
      "rule_id": {"type": "string"},
      "rationale": {"type": "string"},
      "risk_statement": {"type": "string"},
      "safeguards": {"type": "string"},
      "decision": {"type": "string", "enum": ["APPROVED", "REJECTED"]},
      "reason": {"type": "string"}
    }}}
  }
}
```

---

## 4) Event Contracts (for Workers bus)

> Envelope: `{ "type": string, "version": string, "data": object, "ts": ISO-8601 }`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://contracts.inner-voice.ai/schemas/events/pretrade.intent.submitted.schema.json",
  "title": "EvtPreTradeIntentSubmitted",
  "type": "object",
  "required": ["type", "version", "ts", "data"],
  "properties": {
    "type": {"const": "pretrade.intent.submitted"},
    "version": {"const": "0.1.0"},
    "ts": {"type": "string", "format": "date-time"},
    "data": {"$ref": "https://contracts.inner-voice.ai/schemas/pre-trade-intent.schema.json"}
  }
}
```

Analogous: `pretrade.decision.returned`, `pretrade.override.requested`, `pretrade.override.resolved`, `journal.entry.created`, `rules.breach.detected`, `cooldown.started`, `cooldown.ended` (same envelope, `data` shape specific to each event).

---

## 5) TypeScript Types (generated)

> Generate with `json-schema-to-typescript` at build time. Example output signatures:

```ts
export interface JournalEntry { /* derived from schema */ }
export interface PreTradeIntent { /* derived from schema */ }
export interface PersonaPolicy { /* derived from schema */ }
```

---

## 6) Examples

### 6.1 Example `PreTradeIntent` (crypto, intraday)

```json
{
  "id": "4f5a7a36-3c3f-4b6a-bb0f-5b8d9a1cb9ce",
  "user_id": "b8c0fa1f-8e4a-4f1e-9a1e-77f0b2f5e2b1",
  "submitted_at": "2025-09-04T09:12:33Z",
  "persona": "crypto",
  "instrument": {"symbol": "BTCUSDT", "class": "crypto"},
  "direction": "long",
  "timeframe": "5m",
  "plan": {"entry": "Break of 5m consolidation high", "stop": "Below consolidation low", "target": "Risk:Reward >= 2R", "invalidates": "Loss of 1h structure"},
  "risk": {"size_units": 1.0, "risk_unit_percent": 0.5, "budget_left_percent": 3.5, "portfolio_drawdown_percent": 2.0, "cooldown_active": false},
  "rules": [
    {"id": "r.setup.validated", "name": "Setup validated", "passed": true, "evidence": "Volume expansion"},
    {"id": "r.no-chase", "name": "No chasing after >1.5R move", "passed": false, "evidence": ">1.8R already moved"}
  ],
  "context": {"streak": -2, "volatility": "high", "recent_hours_traded": 5, "sleep_quality": "ok", "distractions": "Slack pings"},
  "gate": {"result": "WAIT", "reasoning": "Key rule failed (no-chase). I’ll wait for a pullback or simulate."},
  "friction_ctas": [
    {"id": "cta.wait.alert", "label": "Set price alert", "action": "edge-bff:setAlert"},
    {"id": "cta.sim.paper", "label": "Practice in simulator", "action": "core-api:startPaperTrade"}
  ]
}
```

### 6.2 Example `JournalEntry` (post‑trade)

```json
{
  "id": "d1d9562c-84af-4b9f-a6e9-1f6d5e8d43b3",
  "user_id": "b8c0fa1f-8e4a-4f1e-9a1e-77f0b2f5e2b1",
  "created_at": "2025-09-04T12:40:10Z",
  "linked_intent_id": "4f5a7a36-3c3f-4b6a-bb0f-5b8d9a1cb9ce",
  "entry_type": "post",
  "persona": "crypto",
  "content": {
    "instrument": {"symbol": "BTCUSDT", "class": "crypto"},
    "direction": "long",
    "timeframe": "5m",
    "thesis": "Range break with volume and 1h trend support",
    "setup_tags": ["breakout", "volume"],
    "catalysts": "US session open",
    "entry": {"plan": "Breakout retest", "price": 63850.5, "order_type": "limit"},
    "risk": {"units": 0.5, "percent": 0.5, "invalidation": "Back inside range", "portfolio_drawdown_limit": 6},
    "rules": [
      {"id": "r.setup.validated", "name": "Setup validated", "passed": true},
      {"id": "r.no-chase", "name": "No chasing after >1.5R move", "passed": true}
    ]
  },
  "emotions": "Focused at entry, anxious into pullback",
  "context": {"streak": -2, "sleep_quality": "ok", "distractions": "low"},
  "outcome": {"result": "win", "pnl": 1.2, "duration": "24m", "mfe": 2.3, "mae": 0.6, "slippage": 0.1},
  "adherence": {"score": 86, "entry_ok": true, "exit_ok": true, "deviations": "Took partials early"},
  "retro": {"positives": "Planned and patient", "mistakes": "Partial too soon", "one_change": "Let first partial at 1R"},
  "attachments": []
}
```

---

## 7) Friction CTA Map (IDs → Implementation)

```
cta.wait.alert        → edge-bff → core-api alerts service (Redis pub/sub) → mobile/web push
cta.sim.paper         → core-api simulator endpoint → workers persist paper trade
cta.size.down         → core-api order‑sizing policy endpoint
cta.cooldown          → workers scheduler → Upstash TTL key → core-api surfaces state
cta.schedule.dca      → core-api recurring scheduler → Cloud Run cron
```

---

## 8) Non‑Advisory Guardrails (runtime checks)

- Output linter blocks banned phrases in persona policy.
- Gate can only produce {GO, WAIT, SIZE_DOWN, SIMULATE, NO_GO}; **no explicit entry calls**.
- If `cooldown_active=true`, force {WAIT | SIMULATE} unless override approved.
- If `portfolio_drawdown_percent ≥ limit`, force `NO_GO`.
- All overrides emit `pretrade.override.requested/…resolved` events.

---

## 9) Notes for Integration

- Validate all inbound objects against schemas at edge‑bff.
- Store raw inputs + evaluated outputs (gate result + reasoning) for transparency.
- Generate TS types in `contracts` and pin versions in all services.
- Workers implement: `intent-evaluator`, `adherence-scorer`, `digest-builder`, `cooldown-scheduler`.
- R2 for attachments (charts, screenshots) referenced by URI in entries.

---

_End of v0.1 pack._

