# Release Procedure

## Branches and checks

Application release changes land in `dev` through a PR. Update `prod` through the reviewed `dev` → `prod` release PR; do not commit directly to `prod`. Preserve repository review and signature rules. Documentation-only follow-ups use the procedure at the end of this guide.

Require passing lint/type checks, tests, application builds, release migration safety, both release-image rehearsals, browser smoke tests, and CodeQL on the final candidate. Run the same checks on the final production commit before tagging it.

## Prepare in dev

1. Update the root and four workspace `package.json` versions and regenerate `package-lock.json`. For a new version, use `npm version <version> --workspaces --include-workspace-root --no-git-tag-version`. Skip the bump if the intended version is already prepared; do not create a release tag on dev.
2. Update `website/index.html` (`softwareVersion` and visible release text), `CHANGELOG.md`, and `docs/releases/vX.Y.Z.md`. Cover breaking changes, upgrades, rollback, validation, and known limitations. Application version strings derive from package manifests.
3. Commit on a preparation branch, open a PR to `dev`, and merge after checks pass. Update the `dev` → `prod` release PR with the final scope and evidence.

## Merge production

Verify release checks and issue-resolution evidence before merging. The production merge updates the public website and starts production CI; it does not publish images or migrate users' databases.

Record the pre-merge `dev` tip. If repository cleanup automatically deletes `dev` after the release PR merges, restore it at that tip without rewriting its history. Open the `prod` → `dev` history-synchronization PR before tagging: GitHub Advanced Security's aggregate `CodeQL` check is PR-only, and this records it on the production commit. Leave that PR open until publication and deployment verification finish; production-push security analysis still runs normally.

Containers migrate their own databases when users upgrade. Database Migrations is an optional manual workflow for an operator-managed external database. Configure its `production` environment `DATABASE_URL` secret and back up the target before dispatching it. Never dispatch against an unverified database or use reset/data-loss flags to bypass the schema guard.

## Tag the tested production commit

Wait for all production checks, including both image rehearsals and browser smoke tests. Create the tag explicitly at the final production commit:

```bash
git fetch origin
git switch prod
git merge --ff-only origin/prod
git tag -a vX.Y.Z -m "Release vX.Y.Z" origin/prod
git push origin refs/tags/vX.Y.Z
```

Do not reuse a tag from before the release PR merged, rely on `--follow-tags`, or move an existing published tag. Publication rejects tags that do not match current production code, package/lockfile versions, and successful release checks.

## Publish and verify

The tag starts Publish Docker Images. Unified and slim images build and rehearse a v2.3.5 upgrade on native AMD64 and ARM64 runners. Neither stable manifest is updated until all four platform builds and rehearsals succeed. Wait for both manifest jobs and inspect both architectures for:

- `ghcr.io/aquantumofdonuts/mixarr:vX.Y.Z` and `:latest`
- `ghcr.io/aquantumofdonuts/mixarr:vX.Y.Z-slim` and `:slim`

Rehearse upgrades with published versioned images and disposable data. Verify API health, the bundled frontend proxy, preserved records and sessions, restored schedules, restart, and fresh installation. Users must back up the database and persistent data, retain volume mounts and `SESSION_SECRET`, and upgrade the web/API bundle together. Rollback requires restoring the pre-upgrade backup.

Manual publication is only a recovery path: dispatch from `prod` with the existing release tag and satisfy the same checks. It cannot publish arbitrary dev code or an unversioned alias.

After image publication and verification, create the GitHub Release:

```bash
gh release create vX.Y.Z --verify-tag --title "vX.Y.Z" --notes-file docs/releases/vX.Y.Z.md
```

For each resolved issue, add a friendly comment thanking the requester, describing the fix and upgrade steps, and linking the published release. Close it as completed; keep unresolved or partially fulfilled requests open.

## Synchronize branches

Open a PR to bring the production release commit back into `dev`, preserve its code exactly, and merge through normal repository rules. Confirm both branch trees agree and the working tree is clean. Hotfixes start from `prod`, land through a production PR, receive a new version/tag after checks, and are synchronized back into `dev`.

Retain production ancestry when synchronizing. With maintainer permission, a repository that disables merge commits in the PR UI can accept a normal, non-force Git merge into `dev`; use the existing permissions and preserve both histories. Do not force-reset branches or change review/signature rules. Confirm `git diff origin/prod origin/dev` is empty and `git merge-base --is-ancestor origin/prod origin/dev` succeeds.

## Documentation corrections after publication

Documentation-only follow-ups may use a PR to `prod`, followed by history synchronization into `dev`. Update the README, website, public deployment examples, and release-note source together. Verify links, code examples, template syntax, and desktop/mobile website behavior; merging website changes to `prod` publishes Pages.

Update the existing GitHub release body from its source:

```bash
gh release edit vX.Y.Z --notes-file docs/releases/vX.Y.Z.md
```

Do not move the release tag, bump application versions, or republish images for copy changes. The tag continues to identify the tested application release even if `prod` later contains documentation corrections. The manual image-publishing guard still requires the tag to match current `prod`; if source changes require a new image after production advances, prepare a new version instead of retagging a published release.
