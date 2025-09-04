**AI-Coach is the primary place you’ll tweak for “clone/coach quality”** (voice, prompts/templates, scoring thresholds, persona rules).
…but great engagement is a **full-stack loop**. You’ll often touch a few other services to *feed better signals in* and *deliver them better out*.

## What lives in AI-Coach (tune here first)

* **NLG templates & tone** (supportive/strict/mentor), persona rules.
* **Bias scoring logic** (prompting or model thresholds).
* **Feature usage** (which indicators/behaviour features affect advice).
* **Safety rails** (never give buy/sell directives; length limits).
* **Response shape** (what fields the reflection returns: insight, labels, confidence, sparklines).

## What *also* affects coach quality (other stacks)

| Goal                                  | Stack you touch          | Why it matters                                                                                                             |
| ------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Better inputs (context/indicators)    | **Workers**              | Compute richer features (e.g., volatility regime, “pump” shape, user-specific entry pattern) → AI has better raw material. |
| Faster delivery (moments that matter) | **Edge/BFF + Core**      | WS reliability & outbox replay; coach message must arrive within \~1–3s of the trade/import to feel “alive.”               |
| Personalization memory                | **Core**                 | Store user bias profile, tone preference, past interventions → pass into AI to tailor advice.                              |
| Schema evolution                      | **Contracts**            | Add optional fields or new event types to carry the new context you want AI to see (backward-compatible).                  |
| UX framing & CTA                      | **Web-UI**               | How the reflection is shown (inline chart, “Try what-if?” button) drives engagement as much as the words.                  |
| Measurement & A/B                     | **Web-UI + Edge + Core** | Capture accept/ignore, dwell, “helpful?” taps; run template/tone experiments and log outcomes.                             |

### Quick example

You want the coach to call out “buying the green candle after a +8–12% spike.”
Changes needed:

* **Workers:** add `spike_strength_24h`, `pullback_after_spike` features.
* **Contracts:** add those fields to `coach.reflect` payload (optional).
* **Core:** persist features; include in outbox payload.
* **AI-Coach:** update prompt/template to reference new features; adjust thresholds.
* **Web-UI:** show a tiny sparkline highlighting the spike; add “Set alert instead” CTA.

## Engagement improvement loop (who changes what)

```mermaid
flowchart LR
  A[Signals/Features (Workers)] --> B[Schemas (Contracts)]
  B --> C[Event Payload (Core)]
  C --> D[Prompt & Templates (AI-Coach)]
  D --> E[Delivery/Timing (Edge)]
  E --> F[Presentation & CTA (Web-UI)]
  F --> G[Telemetry: clicks, dwell, 'helpful?']
  G --> H[Experiment analysis (Core/Analytics)]
  H --> A
```

## Where you’ll iterate, by phase

* **MVP (deterministic + light LLM):**

  * Tune **heuristic thresholds** & **templates** in **AI-Coach**.
  * Occasionally add a **new feature** in **Workers** and surface it via **Contracts/Core**.
  * Optimize **Edge/Web-UI** for fast, clear delivery.
* **Post-MVP (learning loops):**

  * Add offline eval sets and A/B test harness.
  * Introduce per-user **coach memory** (Core) and **persona knobs** (AI-Coach).
  * Expand **Workers** feature library and market-data coverage.

## Practical checklist (use this when “coach feels off”)

1. **Is the input rich enough?** If not → Workers + Contracts + Core.
2. **Is it arriving fast?** If not → Edge/Core (WS/outbox path).
3. **Does the message land?** If not → AI-Coach (tone/template) + Web-UI (framing/CTA).
4. **Can we measure it?** If not → add telemetry fields + experiment flag.

### TL;DR

You’ll **tune AI-Coach the most**, but meaningful improvements usually touch **Workers (features)**, **Contracts/Core (payloads & memory)**, **Edge (timing)**, and **Web-UI (presentation & CTA)**. Think **system loop**, not a single box.
