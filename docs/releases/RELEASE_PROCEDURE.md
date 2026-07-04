# Release Procedure

## Branch model

| Branch | Purpose |
|--------|---------|
| `dev`  | Integration branch. All work happens here via direct commits or merged PRs. |
| `prod` | Production. **Never commit directly.** Only updated via reviewed PR from `dev`. |

Branch protection on `prod` requires a passing CI check and at least one approved PR before merge.

## How it works

`version.ts` and `constants.ts` derive their values from their respective
`package.json` files — no more manual string updates. The only files you touch
at release time are the three `package.json` files and `website/index.html`.
Pushing a `v*.*.*` tag to `prod` automatically triggers the Docker image build.

## Steps

### 1. Prepare the release in dev

Make sure `dev` is clean and all intended commits are present.

```bash
git checkout dev && git pull
```

### 2. Bump the version

Run in the repo root:

```bash
npm version minor --workspaces --include-workspace-root
# Or: patch / major as appropriate.
# This updates package.json, apps/api/package.json, apps/web/package.json,
# creates a git commit, and creates a vX.Y.Z tag locally.
```

Then update the one remaining manual location:

| File | What to change |
|------|----------------|
| `website/index.html` | `"softwareVersion"` in JSON-LD (line ~56) |

### 3. Update CHANGELOG.md

Add a new `[vX.Y.Z] - YYYY-MM-DD` section at the top. Update the comparison links at the bottom of the file.

### 4. Write release notes

Create `docs/releases/vX.Y.Z.md` using a previous release as the template. Cover new features, fixes, upgrade instructions, and any breaking changes.

### 5. Commit and push dev

```bash
git add -A
git commit --amend --no-edit   # fold website + changelog into the version bump commit
git push origin dev
```

Do **not** push the tag yet — that happens after the PR merges to prod.

### 6. Open a PR from dev → prod

```bash
gh pr create --base prod --title "release: vX.Y.Z" \
  --body "$(cat docs/releases/vX.Y.Z.md)"
```

CI runs automatically. Review and merge when it passes.

### 7. Push the tag (triggers Docker build)

After the PR merges:

```bash
git checkout prod && git pull
git push origin prod --follow-tags
```

Pushing the `vX.Y.Z` tag triggers `publish-docker.yml` automatically — both `unified` and `slim` images are built and published to GHCR.

### 8. Create the GitHub Release

After the Docker build completes:

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file docs/releases/vX.Y.Z.md --target prod
```

### 9. Verify

- Check [Actions → Publish Docker Images](https://github.com/aquantumofdonuts/mixarr/actions/workflows/publish-docker.yml) — both builds should succeed.
- Confirm the images are published: `ghcr.io/aquantumofdonuts/mixarr:vX.Y.Z` and `:latest`.

### 10. Backmerge prod into dev

```bash
git checkout dev && git merge prod && git push origin dev
```

This keeps dev in sync with any merge commit that landed on prod.

## Hotfix procedure

Never fix a production bug by going through `dev`. Instead:

```bash
git checkout prod
git checkout -b hotfix/description
# fix the bug, commit
git push origin hotfix/description
# open PR → prod, merge after CI passes
git checkout prod && git pull
npm version patch --workspaces --include-workspace-root
git push origin prod --follow-tags
# then backmerge to dev:
git checkout dev && git merge prod && git push origin dev
```
