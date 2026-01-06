# Sprint 5: Polish & Testing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Final polish - improve test coverage, clean up remaining code smells, update documentation.

**Architecture:** Focus on test gaps, remove dead code, ensure consistent patterns across codebase.

---

## Task Overview

| # | Task | Effort | Focus |
|---|------|--------|-------|
| 1 | Add missing error handler tests | 30 min | `tests/middleware/error-handler.test.ts` |
| 2 | Add logger tests | 20 min | `tests/lib/logger.test.ts` |
| 3 | Clean up unused imports | 20 min | All source files |
| 4 | Remove console.log statements | 20 min | Replace with logger |
| 5 | Add JSDoc to public functions | 30 min | Key exports |
| 6 | Update ISSUES.md with completed work | 15 min | `docs/ISSUES.md` |
| 7 | Final verification & summary | 15 min | Full test suite, TypeScript check |

---

## Task 1: Add Missing Error Handler Tests

**Files:**
- Create: `apps/api/tests/middleware/error-handler.test.ts`

**Tests to write:**
- Error handler returns correlation ID
- Error handler handles ZodError
- Error handler returns 500 for unknown errors
- Error handler includes stack in development mode

---

## Task 2: Add Logger Tests

**Files:**
- Create: `apps/api/tests/lib/logger.test.ts`

**Tests to write:**
- Logger outputs correct format in dev mode
- Logger outputs JSON in production mode
- Logger includes context prefix
- All log levels work correctly

---

## Task 3: Clean Up Unused Imports

**Files:**
- Scan all `apps/api/src/**/*.ts` files
- Remove unused imports

**Command:**
```bash
npx eslint apps/api/src --rule 'no-unused-vars: error' --fix
```

---

## Task 4: Remove console.log Statements

**Files:**
- Scan all `apps/api/src/**/*.ts` files
- Replace `console.log` with `logger.info`
- Replace `console.error` with `logger.error`
- Replace `console.warn` with `logger.warn`

---

## Task 5: Add JSDoc to Public Functions

**Priority files:**
- `apps/api/src/lib/logger.ts`
- `apps/api/src/middleware/validate.ts`
- `apps/api/src/middleware/correlation.ts`
- `apps/api/src/middleware/rate-limit.ts`

---

## Task 6: Update ISSUES.md

**File:** `docs/ISSUES.md`

Document completed work from all 5 sprints.

---

## Task 7: Final Verification

**Commands:**
```bash
cd apps/api && npx tsc --noEmit
cd apps/api && npm test
```

**Summary:**
- Total tests added
- Total files modified
- Key improvements made
