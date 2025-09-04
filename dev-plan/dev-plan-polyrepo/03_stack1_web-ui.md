# 03 — Stack 1: Web‑UI (Next.js)

## Purpose
Chat‑centric UI for reflections, trade timelines, simulations, and weekly digest.

## Structure
```
apps/web-ui/
  src/
    pages/
    components/
    lib/apiClient.ts   # adds CSRF + Idempotency-Key
    lib/wsClient.ts    # WS with resume/since
    store/
  public/
```

## Key Endpoints (via S2 Edge)
- `GET /api/me`, `POST /api/login`
- `POST /api/trades/import` (Idempotency‑Key required)
- `GET /api/events?since=...`
- `WS /ws` for `coach.reflect`, `import.progress`, `digest.ready`

## Pseudocode – apiClient
```ts
export async function post(path: string, body: any, idem: string) {
  const csrf = readCookie('csrf_token');
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Idempotency-Key': idem },
    credentials: 'include',
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

## Security
- Same-origin cookies; CSRF double-submit handled by S2.
- No secrets in browser storage; JWT cookie is HttpOnly.
