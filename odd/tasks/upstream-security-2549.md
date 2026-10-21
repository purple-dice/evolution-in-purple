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

- [ ] T1 RED: reproduce attacks 1-3 on a local server before the patch
- [ ] T2 Patch `abstract.router.ts` + check `instanceId` consumers (chatbots, S3)
- [ ] T3 GREEN: attacks 1-3 blocked, cases 4-6 unchanged; tsc, build, lint

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
- `instance.guard.ts:26` also uses `originalUrl.includes('/instance/create')`.

## Evidence

(commit ids and verification output per task)
