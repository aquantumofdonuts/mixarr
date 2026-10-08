# Catalog themes

`index.css` imports only `catalog.css`. The legacy listening-room stylesheet is inactive.

Paper, charcoal, and graphite surfaces let artwork supply the color. Links and focus rings use slate. Primary buttons use ink (light neutral in dark mode); secondary controls and selection use neutral fills. Green/amber describe real outcomes; red describes errors and destructive consequences.

Tokens remain HSL triples for existing `hsl(var(--…))` and Tailwind consumers. `--accent` is the neutral hover surface, `--link` is slate, `--primary-hover` is the button hover, and `--input` is a control boundary with greater contrast than the subtle `--border` divider. Readable metadata uses adjusted `--muted-foreground`; the originally proposed light ink-500 does not meet body-text contrast on every surface.

`next-themes` sets `data-theme="light"` or `data-theme="dark"`; system mode follows OS preference, including a CSS fallback before hydration. Tailwind's selector dark strategy uses that same attribute. There is no second dark class.

`--font-display`, `--font-text`, and `--font-mono` resolve to system stacks without font downloads. Names and prose use the text stack; identifiers, counts, and timestamps use mono. Controls use the shared 4px radius.

`src/lib/__tests__/catalog-contrast.test.ts` reads the actual declarations, verifies text pairs at 4.5:1 and focus/control boundaries at 3:1, and checks generated dark utilities. These checks cover token pairs, not every page-specific opacity, chart encoding, or overridden class; the route sweep and browser audit remain required.
