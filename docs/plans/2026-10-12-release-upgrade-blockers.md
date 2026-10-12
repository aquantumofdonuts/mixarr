# Release upgrade blockers implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the verified v2.3.5-to-3.0.0 upgrade preserve existing data and schedules, build the actual published images, and submit a green PR to dev without merging or publishing.

**Architecture:** Adopt Prisma Migrate with a v2.3.5 schema baseline and an additive constellation migration. Verify existing schemas before marking baselines applied; use generated diffs only for comparison, never execute them. Await dependency readiness and scheduler initialization before listening. All deployment paths use the same schema-deployment script.

**Tech Stack:** Existing TypeScript, Prisma 5.22, MySQL/MariaDB, Redis, Docker, Vitest, GitHub Actions.

## Root-cause evidence

The preceding audit at dev 520543d reproduced missing native build tools in both published Dockerfiles, destructive db push against the unmanaged soulseek_diversions table, slim continuing after schema errors, and scheduler initialization rejecting before MariaDB became ready while health later passed. Evidence is in /tmp/mixarr-upgrade-audit/REPORT.md and its adjacent logs.

## Task 1: Data-preserving deployment and startup

Files: apps/api/prisma/baseline.prisma; apps/api/prisma/migrations; apps/api/prisma/legacy-migrations; apps/api/src/scripts/deploy-schema.ts; apps/api/src/lib/startup.ts; apps/api/src/index.ts; apps/api/tests/scripts/deploy-schema.test.ts; apps/api/tests/lib/startup.test.ts; apps/api/package.json; package-lock.json.

1. Write/run failing unit regressions: only table-drop diff statements can be ignored during comparison, partial/mutated layouts are rejected; dependency failure prevents scheduler/listen, and scheduler failure prevents listen.
2. Archive the incomplete historical migration chain. Generate a complete v2.3.5 baseline SQL from its checked-in schema and six-table additive migration from the baseline/current schema diff.
3. Implement the checked baselining CLI with existing Prisma/Node tools: no table creation on an unsupported existing schema, no reset/drop generated SQL execution, finally disconnect. Accept verified v2.3.5 and already-current db-push installations; refuse unresolved migration failures.
4. Wait up to 60 seconds for actual DB and Redis readiness; await scheduler initialization before importing queue workers and opening HTTP listen; fail the process on initialization error. Test ordering, retry limit and failures.
5. Keep Prisma CLI as a production dependency for slim deployments. Run focused tests, types, lint, and actual migration checks before committing.

## Task 2: Wire and guard production paths

Files: docker/Dockerfile.unified; docker/Dockerfile.slim; docker/entrypoint-slim.sh; docker-compose.yml; .github/workflows/database.yml; .github/workflows/ci.yml; scripts/release-upgrade-smoke.sh; scripts/release-upgrade-fixture.cjs; CHANGELOG.md; README.md; docs/ISSUES.md.

1. Install python3/make/g++ only in published image build stages. Replace production db push calls with the compiled schema-deployment CLI and fail on errors. Preserve fixed ports, data mounts, credentials and session configuration.
2. Run actual unified/slim build validation on PRs and execute upgrade smoke coverage using an immutable published v2.3.5 image and synthetic isolated volumes/network. Build/upgrade failures must fail CI; always clean only owned test resources.
3. Exercise both fresh install and existing-data upgrade; retain unmanaged diversion data, credentials, settings, record states and login session. Verify scheduled jobs initialize before health, and failed schema sync prevents API startup.
4. Update release/upgrade guidance: backups, stable SESSION_SECRET/data volumes, intentional custom API incompatibilities and separate accepted C137 provider deferral.
5. Run shell/YAML validation and actual image builds before committing.

## Task 3: Verification, review and PR to dev

1. Repeat the upgrade rehearsal on the exact fixed images, including slim with external services, idempotent restart, fresh schema and unsupported schema rejection. Run relevant API tests and typecheck.
2. Completion audit: verify build tools, safe legacy adoption, data preservation, failure behavior, readiness, deployment wiring, automated upgrade coverage, docs, cleanup and PR target. Generate counts deterministically.
3. Full review: inspect resource lifecycle, migration ordering, concurrency/failure behavior, runtime dependencies, CI permissions and generated SQL. Repair findings and recheck.
4. Commit verified changes without Co-Authored-By, push fix branch, create PR against dev, satisfy CI checks, and stop. Do not merge either PR, tag, publish or deploy.

## Plan review

Baseline adoption checks must precede migration-history writes. Extra tables are ignored only during comparison and never dropped. Partial constellation layouts must fail before baselining. Existing failed migrations must remain failures. Fresh databases use migrate deploy directly. Native Prisma migration locking applies; adoption must not silently ignore concurrent/failed resolve operations. Both image runtime copies include schema, baseline and compiled CLI; Prisma CLI survives production pruning. Startup must not listen before scheduler readiness. Test resources are synthetic and namespaced; cleanup traps never target existing Mixarr containers/volumes. No new dependency is required. Plan review passed.

## Completion audit and full review — 2026-10-12

Scope: implementation requirements in Tasks 1–3, extracted from the plan above. The separate delivery steps (PR creation and green hosted CI) are pending at this checkpoint and are verified in the PR checks before reporting completion. The implementation checklist length is computed from the audit array: 12 items, 12 COMPLETE (100%).

| # | Requirement | Exists | Not stub | Wired | E2E traced | Status | Evidence |
|---|---|---|---|---|---|---|---|
| 1 | Task 1.2: Complete legacy schema baseline and additive constellation tables | yes | yes | yes | yes | COMPLETE | prisma/baseline.prisma matches v2.3.5 after trailing-whitespace normalization; generated SQL has six CREATE TABLE statements; both image fresh installs pass. |
| 2 | Task 1.2: Historical partial migration files remain available | yes | yes | yes | yes | COMPLETE | All 18 archived SQL files match their Git originals byte-for-byte; completed old history survives the MySQL adoption regression. |
| 3 | Task 1.3: Checked adoption of legacy and already-current databases | yes | yes | yes | yes | COMPLETE | src/scripts/deploy-schema.ts is called by all deployment paths; MySQL regressions preserve accounts/settings and an existing graph person. |
| 4 | Task 1.3: Unmanaged tables and existing records survive upgrades | yes | yes | yes | yes | COMPLETE | Both pinned v2.3.5 image rehearsals preserve 23 rows across 13 models plus soulseek_diversions; generated comparison SQL is never executed. |
| 5 | Task 1.3: Unsupported and partial schemas fail safely | yes | yes | yes | yes | COMPLETE | MySQL drift/partial-layout tests leave migration history absent; both images exit 1 on later schema drift before API startup. |
| 6 | Task 1.3: Unresolved migrations remain unresolved | yes | yes | yes | yes | COMPLETE | Real MySQL regression rejects a synthetic failed migration without clearing its failure record. |
| 7 | Task 1.4: Dependency readiness and scheduler restoration precede listening | yes | yes | yes | yes | COMPLETE | src/index.ts awaits prepareStartup before importing queue workers; unit tests cover deferred restoration, retry, cancellation and failure; both image logs must restore the persisted schedule before workers start and HTTP listens. |
| 8 | Task 1.5, Task 2.1: Runtime CLI and native build dependencies are present | yes | yes | yes | yes | COMPLETE | Prisma remains after slim production pruning; exact unified/slim Dockerfiles build and both compiled schema CLIs run successfully. |
| 9 | Task 2.1, Task 2.2: Deployment and CI use checked migrations | yes | yes | yes | yes | COMPLETE | Unified/slim entrypoints, both Compose paths and database/test/smoke workflows invoke the shared CLI; YAML/shell checks pass; no production db push remains. |
| 10 | Task 2.2, Task 2.3: Both published variants have reproducible upgrade checks | yes | yes | yes | yes | COMPLETE | CI builds the actual release Dockerfiles and invokes scripts/release-upgrade-smoke.sh; both local rehearsals pass upgrade, restart, old-session/password login, drift rejection and fresh install. |
| 11 | Task 2.4: Upgrade instructions and release scope are explicit | yes | yes | yes | yes | COMPLETE | README Upgrading and CHANGELOG cover backups, stable mounts/session secret, drift/failure repair, rollback and custom API changes; C137 stays deferred. |
| 12 | Task 3.1, Task 3.2: Regression evidence and isolated resource cleanup | yes | yes | yes | yes | COMPLETE | 2,607 API tests, seven real MySQL tests, types and lint pass; smoke traps remove owned containers/networks/volumes; disposable DB/Redis services removed. |

Completion-theater scan found no TODOs, placeholders, unimplemented branches or unused production helpers in the changed code. The extra-table SQL parser accepts only comparison statements; it never executes generated DROP statements. Current-schema table names protect partial constellation installations during legacy comparison.

### Full review verdict: PASS

The four-lens review (rubber-duck trace, failure/attack analysis, best practices, generated-code review) covered every changed runtime/configuration file and the generated migration chain. A subsequent startup trace found that eager queue-worker imports still preceded the dependency gate. Those imports now follow readiness and scheduler restoration, which also lets stale-job cleanup run before persisted queues resume. The image rehearsal asserts the actual schedule → workers → HTTP log order. No unresolved release-blocking finding remains in this change.

- Lifecycle: Prisma disconnects in finally; subprocess failures propagate; startup read deadlines remove abort listeners; smoke resources are namespaced and cleaned on exit.
- Failure and concurrency: unresolved migration failures are not erased. Verified baselines are recorded before additive deployment; Prisma migration locking remains enabled. Concurrent first adoption may safely reject one instance; the documented deployment order runs migrations once before replicas. Partial DDL is rejected for operator inspection instead of being reset.
- Boundaries and dependencies: CLI execution uses Node execFile with arguments, not a shell or interpolated database URL. SQL data values are parameterized; fixed destructive test setup is guarded by an exact disposable database URL. Runtime Prisma uses the existing pinned dependency; build tools stay in dependency stages. No new package is introduced.
- Wiring/configuration: source and compiled CLI paths resolve the same checked schema; both runtime images have executed them. Existing data mounts, credentials and session configuration survive the rehearsals. No UI or provider contract changes are introduced by these repairs.
- Review improvement: added completed historical migration-history coverage. Its first fixture attempted to resolve an archived name absent from the active directory (Prisma P3017); the fixture now creates Prisma history using the CLI and inserts the original archived name/checksum. The corrected seven-case MySQL suite passes.

### Verification commands and recorded results

- `CI=true REDIS_URL=redis://127.0.0.1:16389 DATABASE_URL=mysql://root@127.0.0.1:13316/mixarr_upgrade_test npm test --workspace=@mixarr/api`: 158 files passed; 2,607 tests passed, 45 skipped. The opt-in MySQL suite was run separately below.
- `RELEASE_UPGRADE_TEST_DATABASE_URL=mysql://root@127.0.0.1:13316/mixarr_upgrade_test npx vitest run tests/scripts/deploy-schema.database.test.ts` (apps/api): seven passed.
- `npm run typecheck`: all four workspace tasks passed. Changed API-source ESLint: zero errors, four console warnings in the CLI. API build passed.
- Actual `docker/Dockerfile.unified` and `docker/Dockerfile.slim` builds passed. `bash scripts/release-upgrade-smoke.sh unified mixarr-upgrade-fix:unified` and the corresponding slim command passed. They use immutable v2.3.5 image digests checked into the script and synthetic fixtures only.
- YAML parsing, `bash -n`, fixture `node --check`, generated-SQL checks, archived-file comparisons and `git diff --check` passed.

Local logs are under `/tmp/mixarr-release-blockers-*.log` and `/tmp/mixarr-upgrade-fix-*.log`; hosted CI repeats the migration and image rehearsals. Live provider compatibility is not certified: **C137 deferred: provider verification will be performed separately**.

Hosted CI checkpoint: the first test attempt hit an unchanged discovery UI test's five-second timeout. The test and all 825 web tests passed locally; the same-commit hosted retry passed without changing assertions or timeouts. All non-image checks passed. The image run was superseded by the final queue-worker startup ordering repair; final hosted results are recorded in the PR checks.
