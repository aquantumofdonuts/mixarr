# GitHub Pages website

`index.html` is the static project website. Pages deploys changes under `website/` only after a push to `prod` (or a manual workflow dispatch). Updating `dev` does not publish the site.

The public site announces [v3.0.0](https://github.com/aquantumofdonuts/mixarr/releases/tag/v3.0.0), released October 29, 2026. Unified `:v3.0.0` and slim `:v3.0.0-slim` images are published for AMD64 and ARM64; `:latest` and `:slim` are moving stable aliases. The Compose and Docker Run examples use the versioned unified image and a saved session secret. Existing users follow the root README's upgrade instructions with their current volumes and environment.

The gallery shows the v3.0.0 catalog with fictional demonstration data. UI captures do not establish live provider compatibility. Known issues include TIDAL and Jellyfin compatibility and remain linked from the site.

To refresh screenshots, build and start the web app locally, then run from the repository root:

```bash
(cd apps/web && npx eslint src --ext .ts,.tsx --no-cache)
npm run build --workspace=@mixarr/web -- --no-lint
npm run start --workspace=@mixarr/web -- --hostname 127.0.0.1 --port 3027
# In another terminal:
E2E_BASE_URL=http://127.0.0.1:3027 npx playwright test --config website/playwright.config.ts
```

The capture suite reuses the strict catalog browser fixtures, blocks external requests, and checks loaded data, images, and browser errors before writing PNGs. It uses fictional artists, identities, credits, and records; it never signs in to a provider or writes to Lidarr. `screenshots.json` records the source commit, viewport, theme, and captured routes. The dashboard image remains for the repository README.

The commands run ESLint without its cache because the current dependency override causes Next’s cached lint command to fail with `flatCache.load is not a function`.

Copy sources: `packages/shared-types/src/subscription.ts` (56 registered types), the app routes and artist/Constellation components (catalog behavior), the root README/Compose files (deployment), and `docs/releases/v3.0.0.md` (release announcement). Keep provider limitations visible when refreshing copy.

Serve this directory locally to check the static page, for example `python3 -m http.server 3028 --directory website`. Check the gallery/lightbox, carousel, installation tabs, image loading, and mobile navigation before committing.

## Release documentation maintenance

- Keep the visible release heading, social metadata, structured `softwareVersion`, image examples, release links, and `sitemap.xml` date consistent.
- Update the README, deployment templates, changelog, and release-note source together. Keep versioned image tags distinct from moving stable aliases.
- Retain the same published release tag and image digests for documentation-only corrections. Update the existing GitHub release body from the release-note source; do not create a duplicate announcement or rebuild application images.
- After a documentation PR reaches `prod`, verify the Pages deployment and public HTML. Preserve production history when synchronizing the update into `dev`.

The October 10 screenshot capture predates publication; its fictional fixtures remain suitable for the v3.0.0 gallery. See `screenshots.json` for capture provenance and `docs/releases/RELEASE_PROCEDURE.md` for the publication workflow.
