'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/layout/page-header';
import Waypoints from 'lucide-react/dist/esm/icons/waypoints';
import { ConstellationView } from '@/components/constellation/ConstellationView';
import { ConstellationPlayerProvider } from '@/components/constellation/ConstellationPlayer';
import type { ConstellationSeed } from '@/hooks/useConstellation';

/**
 * The Collaboration Constellation page (Task 22) — where the feature becomes
 * reachable. It assembles the graph, controls, path finder, person panel and the
 * playback bar into one authenticated route (`/constellation`, authenticated via
 * the app-wide {@link ProtectedLayout}).
 *
 * ## What this page owns vs. what the view owns
 * `ConstellationView` is self-contained (Task 21): it owns the control state
 * (roleMask / hideHotness / genreHighlight) and renders `ConstellationControls`,
 * `PathFinder` and the node→`PersonPanel` flow internally. Its only public prop
 * is `seed`. So the page's job is deliberately small:
 *
 *  1. Choose the **seed** artist and hand it to the view.
 *  2. Wrap everything in {@link ConstellationPlayerProvider} so the persistent
 *     player bar is mounted once and the `PersonPanel` ▶ triggers can drive it
 *     without prop-drilling.
 *
 * ## Seed control — numeric Discogs id
 * Mirrors {@link PathFinder}'s honest, dependency-free input: the backend seeds a
 * subgraph from a raw Discogs person/artist id, so a numeric id + Load button is
 * the truthful control here. A richer artist-search box is future work.
 */
export default function ConstellationPage() {
  const [seed, setSeed] = useState<ConstellationSeed>(null);
  const [idInput, setIdInput] = useState('');

  const trimmed = idInput.trim();
  const validId = /^[0-9]+$/.test(trimmed);

  const loadSeed = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validId) return;
    setSeed({ type: 'artist', id: trimmed });
  };

  return (
    <ConstellationPlayerProvider>
      <div className="space-y-6">
        <PageHeader
          title="Constellation"
          description="Explore how artists connect through shared collaborators — six degrees of the studio."
        >
          <form onSubmit={loadSeed} className="flex gap-2">
            <Input
              type="text"
              inputMode="numeric"
              aria-label="Discogs artist id"
              placeholder="Discogs artist id"
              value={idInput}
              onChange={(e) => setIdInput(e.target.value)}
              className="w-44"
            />
            <Button type="submit" disabled={!validId}>
              Load
            </Button>
          </form>
        </PageHeader>

        {/* Main canvas. The force graph fills an absolutely-sized parent, so the
            container needs an explicit height. Loading/error are surfaced from
            inside ConstellationView. */}
        <Card>
          <CardContent className="p-0">
            <div className="relative h-[70vh] min-h-[420px] w-full overflow-hidden rounded-container">
              {seed ? (
                // Key on the seed so a genuinely NEW source artist remounts the
                // view — resetting its internal walk state (breadcrumbs,
                // selectedPerson, roleMask). The same-seed case is unaffected.
                <ConstellationView key={`${seed.type}:${seed.id}`} seed={seed} />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
                  <Waypoints className="h-12 w-12 opacity-50" aria-hidden="true" />
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">
                      Chart a collaboration constellation
                    </p>
                    <p className="text-sm">
                      Enter a Discogs artist id above and press Load to seed the
                      graph, then click any node to travel its collaborators.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </ConstellationPlayerProvider>
  );
}
