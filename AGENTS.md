# AGENTS.md

Canonical index for `purple-dice/evolution-in-purple`, a fork of Evolution API 2.3.7 (TypeScript, Express,
Prisma, Baileys 7.0.0-rc.9). Read by Pi (gentle-ai) and Claude Code; `CLAUDE.md` only points here. Detailed
patterns live in the skills under `.claude/skills/`, loaded on demand.

This engine replaces Evolution API for three consumer products: **orbit**, **canal-whatsapp** (a.k.a. alien)
and **stenfar**. Anything they consume is a public contract.

## Repo map

| Path | Content |
| --- | --- |
| `src/main.ts` | Bootstrap (Express server, routers, monitors) |
| `src/api/controllers/` | HTTP handlers (thin layer) |
| `src/api/services/` | Business logic; `monitor.service.ts` owns the WhatsApp instance registry |
| `src/api/routes/` | Express routes (`RouterBroker` pattern) |
| `src/api/guards/` | API-key auth and instance resolution (security-critical) |
| `src/api/dto/`, `src/validate/` | Plain-class DTOs and JSONSchema7 validation |
| `src/api/integrations/channel/` | WhatsApp providers: Baileys (`whatsapp/`), Meta Business API (`meta/`), `evolution/` |
| `src/api/integrations/chatbot/` | Chatwoot, Typebot, OpenAI, Dify, Flowise, N8N, EvoAI, EvolutionBot |
| `src/api/integrations/event/` | Webhook, WebSocket, RabbitMQ, SQS, NATS, Kafka, Pusher |
| `src/api/integrations/storage/` | S3 / MinIO |
| `src/config/`, `src/cache/`, `src/utils/`, `src/exceptions/` | Env config, Redis/local cache, helpers, HTTP exceptions |
| `prisma/` | Three schemas (`postgresql-schema.prisma`, `mysql-schema.prisma`, `psql_bouncer-schema.prisma`) + `postgresql-migrations/` and `mysql-migrations/` |
| `odd/` | Active feature docs (`odd/tasks/`), closed ones (`odd/archive/`), `odd/agent-protocol.md` |
| `.claude/skills/purple-*` | Project skills (shared with Pi via `.pi/settings.json`) |
| `VERSION`, `CHANGELOG.md` | Fork versioning, managed by the `purple-release` skill |
| `dist/` | Build output — never edit |

## Commands & danger zones

- **Local / safe:** `npm run dev:server` (tsx watch), `npm start`, `npm run build` (`tsc --noEmit && tsup`),
  `npm run lint:check`, `npx tsc --noEmit`, `make check-docs`, `npm run db:generate`,
  `docker-compose -f docker-compose.dev.yaml up -d`.
- **Database:** always `export DATABASE_PROVIDER=postgresql` (or `mysql`) first. `npm run db:migrate:dev`
  only against a local database. Every schema change ships migrations for BOTH providers.
- **PROD — never without explicit user approval:** `npm run db:deploy`, image publish workflows, any deploy,
  release tag, or push to a shared environment.
- `npm run lint` auto-fixes files; prefer `lint:check` when verifying.

## Commits

- Conventional Commits (enforced by commitlint), English, subject <= 100 chars.
- Tests and docs travel in the same commit as the behavior they cover.
- Husky runs `lint-staged` on pre-commit and `build` + `lint:check` on pre-push. Never `--no-verify`.
- No `Co-Authored-By` or AI attribution.
- The parent agent commits; subagents never commit (`odd/agent-protocol.md` §2).
- Push, PR and merge are user decisions. Releases only via the `purple-release` skill.

## Hard rules

### (a) Consumer contract

Webhook payloads (event names, field names, shapes) and REST routes (paths, params, response shapes)
consumed by orbit, canal-whatsapp or stenfar MUST NOT break without versioning and a `CHANGELOG.md` note.
Adding optional fields is fine; renaming, removing, retyping or changing semantics is a breaking change.
Procedure: skill `purple-contract`.

### (b) Upstream sync

- We cherry-pick from `evolution-foundation/evolution-api` (git remote `upstream`); we never merge it wholesale.
- NEVER import license activation, telemetry or EvoHub code.
- Record the source PR number and/or upstream sha in the commit body (e.g. `Upstream: #1234 / abc1234`).
- Procedure: skill `purple-upstream-sync`.

### (c) Multi-instance isolation

Several clients share one server. Every operation is scoped by `instanceName` / `instanceId`; every Prisma
query on tenant data includes `where: { instanceId }`. A request authenticated for one instance must never
read or mutate another. Changes to auth guards, API-key handling or instance resolution are
**security-critical**: call them out in the PR and get explicit review.

### (d) WhatsApp JIDs

Preserve `@lid` addressing end to end. Never strip a JID with `split('@')[0]` (or equivalent) to build an
outbound target — that turns a `@lid` into a bogus phone number and the message goes nowhere or to the wrong
user. Normalize only through the existing JID helpers. Detail: skill `purple-baileys`.

### (e) No code comments

Code must be self-declarative: never add comments to source code. Express intent through names — extract
a well-named function, constant or variable instead of explaining a line. Rationale belongs in the commit
body and the PR description. Existing upstream comments may stay; do not add new ones.

## Skills per task

Read the matching skill BEFORE writing code. Skills live in `.claude/skills/<name>/SKILL.md`.

| Task | Skills |
| --- | --- |
| Any TypeScript change in `src/` | `purple-typescript` |
| Baileys channel, JIDs, connection/session, message send/receive | `purple-baileys` + `purple-typescript` |
| Webhook payload, event, REST route or DTO consumed externally | `purple-contract` + `purple-typescript` |
| Cherry-picking / porting from upstream | `purple-upstream-sync` |
| Version bump, `CHANGELOG.md`, image publish | `purple-release` |

## How this repo fits ODD

ODD (gentle-ai) is the workflow; its protocol is not repeated here. What this repo adds:

- **Feature docs:** each feature lives in `odd/tasks/<feature>.md` (objective, scope, checklist, acceptance
  criteria, evidence with commit ids). Closed features move to `odd/archive/`.
- **Operational rules** for agents and parents: `odd/agent-protocol.md`.
- **Contract first:** if a change touches anything a consumer reads, the first task states the contract
  change (skill `purple-contract`).

## CodeGraph — ordering rule

- Structural questions (map, call flow, references, impact) are answered with CodeGraph **before** any
  `grep`/`find`. Read-only commands only: `status`, `query`, `explore`, `context`, `node`, `files`,
  `callers`, `callees`, `impact`, `affected`.
- Each worktree has its own `.codegraph/` index. `index` only to recover a corrupt index.
- Fall back to `grep`/`find`/`read` only if CodeGraph fails, and say so explicitly.

## Verification

There is no test suite yet (`npm test` is an upstream placeholder). Before handing off a change, run:

```bash
npx tsc --noEmit
npm run build
npm run lint:check
make check-docs      # docs drift guard (pointers, skill frontmatter)
```

Behavior that needs a real WhatsApp account (pairing, sending, receiving) requires a human with a phone;
report it as unverified rather than faking it. When tests are added, they ship with the behavior.

## Documentation conventions

1. This file is an index: hard rules + pointers. Implementation detail goes to skills.
2. Whoever changes behavior updates the affected skill or this index in the same commit.
3. Changes to the hard rules are decided by the user.
4. Run `make check-docs` before committing doc changes.

## Codebase reference

Condensed from the upstream Evolution API guidelines.

### Architecture

- **Multi-provider DB:** PostgreSQL (`@db.Integer`, `@db.JsonB`) and MySQL (`@db.Int`, `@db.Json`) via Prisma,
  provider chosen by `DATABASE_PROVIDER`; `runWithProvider.js` substitutes it into schema/migration paths.
- **Events:** EventEmitter2 internally; external delivery via webhook (with retry), WebSocket, RabbitMQ, SQS,
  NATS, Kafka, Pusher. All go through `event.manager.ts`.
- **Cache:** Redis primary, node-cache fallback; set explicit TTLs and invalidate on writes.
- **Instances:** `WAMonitoringService.waInstances[instanceName]` holds live channel services; one WhatsApp
  connection per instance with lifecycle management.
- **Media:** stored in S3/MinIO when enabled; otherwise inline base64.

### Patterns

```typescript
// Service: business logic, Evolution returns null on not-found
export class ExampleService {
  constructor(private readonly waMonitor: WAMonitoringService) {}
  private readonly logger = new Logger('ExampleService');

  public async find(instance: InstanceDto): Promise<ExampleDto | null> {
    try {
      return (await this.waMonitor.waInstances[instance.instanceName].findData()) || null;
    } catch (error) {
      this.logger.error('Error finding data:', error);
      return null;
    }
  }
}

// Controller: thin pass-through
export class ExampleController {
  constructor(private readonly exampleService: ExampleService) {}
  public async find(instance: InstanceDto) {
    return this.exampleService.find(instance);
  }
}

// Router: RouterBroker + JSONSchema7 validation
this.router.post(this.routerPath('create'), ...guards, async (req, res) => {
  const response = await this.dataValidate<ExampleDto>({
    request: req,
    schema: exampleSchema,
    ClassRef: ExampleDto,
    execute: (instance, data) => controller.create(instance, data),
  });
  res.status(201).json(response);
});
```

- **DTOs** are plain classes — no `class-validator` decorators. Validation is JSONSchema7 in `src/validate/`
  (`$id: v4()`, explicit `required`).
- **Instance lookup:** throw `NotFoundException` when `waMonitor.waInstances[name]` is missing.
- **Chatbots** extend `BaseChatbotService` / `BaseChatbotController` (keyword, regex, advanced triggers;
  per-contact sessions).
- **Channels** extend the base channel service; keep provider-specific logic inside its folder.

### Code style

- TypeScript strict, 2-space indent, single quotes, trailing commas, 120-char lines, `simple-import-sort`.
- Files `feature.kind.ts` (e.g. `whatsapp.baileys.service.ts`); classes `PascalCase`, functions/variables
  `camelCase`, constants `UPPER_SNAKE_CASE`.
- Logging via the project `Logger` (Pino); never log API keys or tokens.
- Code, API responses and docs in English. No code comments (hard rule (e)).

### Environment

- Copy `.env.example` to `.env` locally; never commit secrets.
- Key settings: `DATABASE_PROVIDER`, `DATABASE_CONNECTION_URI`, `AUTHENTICATION_API_KEY`, `CACHE_REDIS_*`,
  `WEBHOOK_*`, `S3_*`. See `src/config/env.config.ts` for the full list.
- Security reports: `SECURITY.md`.
