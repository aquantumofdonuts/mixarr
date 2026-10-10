# Catalog themes

`index.css` imports only `catalog.css`. The unused listening-room stylesheet was removed after confirming that no source imports remained.

Paper, charcoal, and graphite surfaces let artwork supply the color. Links and focus rings use slate. Primary buttons use ink (light neutral in dark mode); secondary controls and selection use neutral fills. Green/amber describe real outcomes; red describes errors and destructive consequences.

Tokens remain HSL triples for existing `hsl(var(--…))` and Tailwind consumers. `--accent` is the neutral hover surface, `--link` is slate, `--primary-hover` is the button hover, and `--success`, `--warning`, `--error`, and `--info` remain semantic text/icon colors; badges use their matching `status-*-surface` tints. `--input` is a control boundary with greater contrast than the subtle `--border` divider. Readable metadata uses adjusted `--muted-foreground`; the originally proposed light ink-500 does not meet body-text contrast on every surface.

`next-themes` sets `data-theme="light"` or `data-theme="dark"`; system mode follows OS preference, including a CSS fallback before hydration. Tailwind's selector dark strategy uses that same attribute. There is no second dark class.

`--font-display`, `--font-text`, and `--font-mono` resolve to system stacks without font downloads. Names and prose use the text stack; identifiers, counts, and timestamps use mono. Controls use the shared 4px radius.

`src/lib/__tests__/catalog-contrast.test.ts` reads the actual declarations, verifies text pairs at 4.5:1 and focus/control boundaries at 3:1, and checks generated dark utilities. These checks cover token pairs, not every page-specific opacity, chart encoding, or overridden class; the route sweep and browser audit remain required.

Operational routes use the same compact `PageHeader`, divided neutral rows, and mono identifiers, counts and timestamps. Jobs, logs, users and preview distinguish request failure with Retry from a valid empty result. Log details use native disclosure controls, preview selection uses native checkboxes, and account/setup fields use associated labels. Login and setup keep the same system typography without decorative backgrounds; setup retains account, application URL, HTTPS and connection prerequisites.

The five-surface catalog gallery received explicit owner approval on October 9, 2026. Responsive/keyboard browser evidence and genuine Chromium 200% zoom are tracked separately from that visual decision. See the [completion matrix](../../../../../docs/plans/2026-10-07-music-catalog-ux-completion.md) and [full review](../../../../../docs/plans/2026-10-09-music-catalog-ux-full-review.md) for the exact tested revisions, owner-deferred provider verification (C137, October 10, 2026), baseline limitations and cleanup evidence. Theme acceptance does not certify unrelated account mutations or external-provider compatibility.
