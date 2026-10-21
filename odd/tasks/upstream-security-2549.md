# Feature: upstream-security-2549 — cross-instance authorization bypass (CWE-639)

Security-critical (AGENTS.md hard rule (c)). Adapted backport of upstream
evolution-foundation/evolution-api#2549 (merge 7a55a2bf); the upstream patch is
NOT imported as-is.

## Problem

`auth.guard.ts:28-34` authorizes the apikey against `req.params.instanceName`, then
`RouterBroker.dataValidate` (`src/api/abstract/abstract.router.ts:34-42`) merges
`request.query` (and, for any URL containing `/instance/create`, the body) into the
same `instance` object, so callers can switch to another tenant's instance:

- `?instanceName=VICTIM` / `?instanceId=VICTIM` on any `/:instanceName` route.
- `POST /<any>/<route>/MINE?x=/instance/create` + body `{"instanceName":"VICTIM"}`
  (`originalUrl` includes the query string).
- `{"__proto__":{"instanceId":"VICTIM"}}` in the body through the same path.

## Why not upstream as-is

- It strips `instanceName` from the create body, but `POST /instance/create` has no
  path param and `createInstance` reads `instanceData.instanceName` only from it
  (`instance.controller.ts:65,76,91`) → create breaks (still true on upstream/develop).
- Stripping it from the query breaks `GET /instance/fetchInstances?instanceName=`
  (no path param, `instance.controller.ts:402-429`): orbit takes `[0]` with the global
  key and would silently get another tenant's hash.
- It does not close the `?x=/instance/create` body path.

## Fix (option 4)

In `dataValidate`: merge the body only when the matched route is exactly
`/instance/create` (`baseUrl` + `route.path`), and when the route has
`:instanceName`, re-bind it from params at the end and drop `instanceId`.
`fetchInstances` and create keep their current behavior (no contract change).

## Checklist

- [x] T1 RED: reproduce attacks 1-3 on a local server before the patch
- [x] T2 Patch `abstract.router.ts` + check `instanceId` consumers (chatbots, S3)
- [x] T3 GREEN: attacks 1-3 blocked, cases 4-6 unchanged; tsc, build, lint

## Test plan (local, G = global key, instances A/B with tokens TA/TB)

1. `GET /instance/connectionState/A?instanceName=B` (TA) → must report A.
2. `POST /message/sendText/A?x=/instance/create` body `instanceName: B` (TA) → must not act on B.
3. `GET /webhook/find/A?instanceName=B` (TA) → A's config.
4. `POST /instance/create` body `instanceName: C` (G) → 201, name C.
5. `GET /instance/fetchInstances?instanceName=A` (G) → only A.
6. `GET /instance/fetchInstances?instanceName=B` (TA) → never B.

## Follow-ups

- Websocket: any instance token is accepted and `sendNode` targets any
  `data.instanceId` without ownership check (`websocket.controller.ts:41-49,81-83`). High priority, separate feature.
- `instance.guard.ts:26,43` also uses `originalUrl.includes('/instance/create')`.
- S3 `getMedia` (`s3.service.ts:14-17`) filters by `instance.instanceId`, which is never set
  on HTTP routes → unfiltered query across instances when S3 is enabled. Pre-existing.

## Evidence

Local server (Postgres 15, Redis 7, port 8089), probe script outside the repo.

| Case | Before patch (RED) | After patch (GREEN) |
|---|---|---|
| 1 `connectionState/A?instanceName=B` (TA) | `instanceName: B` — **bypass** | `instanceName: A` |
| 3 `webhook/find/A?instanceName=B` (TA) | B's webhook — **bypass** | A's webhook |
| 2 `webhook/set/A?x=/instance/create` body `instanceName: B` (TA) | 403 "name B already in use" (blocked by `instanceLoggedGuard`, not exploitable) | same 403 |
| 7 `webhook/find/A?instanceId=<B>` (TA) | A's webhook (route keys by name) | A's webhook |
| 4 create C (G) | 201 | 201 |
| 5 `fetchInstances?instanceName=A` (G) | A | A |
| 6 `fetchInstances?instanceName=B` (TA) | 401 | 401 |

`tsc --noEmit` OK, `npm run build` OK, eslint on the changed file OK.
Static finding refuted by the run: the spoofed `?x=/instance/create` body path is
already rejected by `instance.guard.ts` (it also uses `originalUrl.includes`, which
wrongly 403s such requests — harmless, follow-up).
