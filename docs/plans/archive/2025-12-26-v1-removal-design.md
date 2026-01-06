# V1 Removal and V2 Promotion Design

> **Date:** December 26, 2025  
> **Status:** Approved

## Overview

Remove legacy v1 Python/Flask code and promote v2 TypeScript/Node.js code to project root.

## Decisions

1. **Clean slate approach** - Delete v1 files entirely (git history preserves them)
2. **Rename v2 references** - `start-v2.sh` → `start.sh`
3. **Update instruction paths** - Fix all `v2/apps/` → `apps/` references

## Phase 1: Delete v1 Files

**Files to delete:**
- `app.py`, `requirements.txt`, `Dockerfile`, `entrypoint.sh`
- `docker-compose.yml.bak`, `commit.sh`, `release.sh`

**Folders to delete:**
- `models/`, `routes/`, `services/`, `static/`, `templates/`
- `instance/`, `__pycache__/`, `.cache*`, `logs/`, `certs/`

**Keep:**
- `.git/`, `.github/`, `docs/`, `v2/`

## Phase 2: Migrate v2 to Root

**Move to root:**
- `apps/`, `packages/`, `caddy/`
- `docker-compose.yml`, `package.json`, `package-lock.json`
- `tsconfig.base.json`, `turbo.json`, `Caddyfile`
- `.env`, `.env.example`, `.gitignore`

**Rename:**
- `start-v2.sh` → `start.sh`

**Delete (not needed):**
- `v2/node_modules/`, `v2/.turbo/`, `v2/GAP-ANALYSIS.md`

## Phase 3: Update Documentation

- Update `.github/instructions/` path references
- Update README paths
- Mark ISSUES.md #30 complete

## Phase 4: Verification

- `npm install`
- `docker compose build`
- `docker compose up -d`
- Run tests
