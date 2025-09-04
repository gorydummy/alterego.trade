# 04 — Stack 2: Edge/BFF (Express/Fastify)

## Responsibilities
- Public REST/WS, CSRF, JWT session verify (JWKS), idempotency keys.
- Fanout of Core events to WS clients.
- Proxy to Core with `X-User-Id`, manage rate limits.

## Routes
- Public: `/login`, `/logout`, `/me`
- User APIs (proxy to Core): `/trades/*`, `/simulations/*`, `/digests/*`
- Events: `/ws` (auth on upgrade), `/events?since=...` (replay via Core)

## Pseudocode – WS Auth
```ts
app.ws('/ws', (socket, req) => {
  const jwt = extractFromCookie(req);
  const user = verifyJwt(jwt, jwks);
  subscribeUser(user.id, socket);
});
```

## Security
- Headers: HSTS, CSP, Referrer-Policy, Permissions-Policy.
- Rate limits per IP+user; `Retry-After` on 429.
- Idempotency-Key enforced for mutating POSTs.
