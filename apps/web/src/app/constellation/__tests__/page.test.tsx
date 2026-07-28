import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// The page assembles the (heavy) constellation graph inside the player
// provider. We stub ConstellationView so no canvas / network runs, capture the
// `seed` prop it receives, and — critically — have the stub consume
// `useConstellationPlayer()` so the test can prove the view is mounted INSIDE
// `ConstellationPlayerProvider` (the hook returns null outside a provider).
//
// Note on architecture (Task 21): ConstellationView is SELF-CONTAINED — it owns
// the control state (roleMask/hideHotness/genreHighlight) and renders
// ConstellationControls, PathFinder and PersonPanel internally. Its only public
// prop is `seed`. So the page's contract with the view is exactly the seed +
// the surrounding player provider; those are what this test asserts.
// ---------------------------------------------------------------------------
const viewState = vi.hoisted(() => ({
  seed: undefined as unknown,
  playerAvailable: false,
  // Incremented once per MOUNT (not per render), so a remount — which the page
  // forces via a seed-derived `key` — is observable.
  mounts: 0,
}));

vi.mock('@/components/constellation/ConstellationView', async () => {
  const { useEffect } = await import('react');
  const { useConstellationPlayer } = await import(
    '@/components/constellation/ConstellationPlayer'
  );
  const ConstellationView = ({ seed }: { seed: unknown }) => {
    viewState.seed = seed;
    const player = useConstellationPlayer();
    viewState.playerAvailable = player !== null;
    useEffect(() => {
      viewState.mounts += 1;
    }, []);
    return (
      <div data-testid="constellation-view" data-player={player ? 'yes' : 'no'}>
        constellation-view
      </div>
    );
  };
  return { __esModule: true, ConstellationView, default: ConstellationView };
});

// The real player provider mounts ConstellationPlayer, which resolves playback
// via the api — stub it so nothing hits the network if a play is triggered.
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
    post: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
  },
}));

import ConstellationPage from '../page';

beforeEach(() => {
  viewState.seed = undefined;
  viewState.playerAvailable = false;
  viewState.mounts = 0;
});

describe('ConstellationPage', () => {
  it('shows the empty state and no graph before a seed is chosen', () => {
    render(<ConstellationPage />);

    expect(screen.queryByTestId('constellation-view')).not.toBeInTheDocument();
    // Prompt to seed an artist.
    expect(screen.getByText(/enter a discogs artist id/i)).toBeInTheDocument();
  });

  it('entering an id + Load seeds the ConstellationView with { type: "artist", id }', async () => {
    const user = userEvent.setup();
    render(<ConstellationPage />);

    await user.type(screen.getByLabelText(/discogs artist id/i), '12345');
    await user.click(screen.getByRole('button', { name: /load/i }));

    expect(screen.getByTestId('constellation-view')).toBeInTheDocument();
    expect(viewState.seed).toEqual({ type: 'artist', id: '12345' });
  });

  it('mounts the view inside the player provider (a play trigger is available)', async () => {
    const user = userEvent.setup();
    render(<ConstellationPage />);

    await user.type(screen.getByLabelText(/discogs artist id/i), '99');
    await user.click(screen.getByRole('button', { name: /load/i }));

    // The stubbed view read a non-null player context → it lives inside
    // ConstellationPlayerProvider, so PersonPanel/release ▶ triggers can play.
    expect(viewState.playerAvailable).toBe(true);
    expect(screen.getByTestId('constellation-view')).toHaveAttribute(
      'data-player',
      'yes',
    );
  });

  it('remounts the view when a different artist is loaded (resets walk state)', async () => {
    const user = userEvent.setup();
    render(<ConstellationPage />);

    const input = screen.getByLabelText(/discogs artist id/i);
    const load = screen.getByRole('button', { name: /load/i });

    await user.type(input, '111');
    await user.click(load);
    expect(viewState.seed).toEqual({ type: 'artist', id: '111' });
    expect(viewState.mounts).toBe(1);

    // Load a genuinely different source artist.
    await user.clear(input);
    await user.type(input, '222');
    await user.click(load);

    // The seed prop updates to B, and the seed-derived `key` forces a fresh
    // mount (breadcrumbs/selection/roleMask reset rather than lingering).
    expect(viewState.seed).toEqual({ type: 'artist', id: '222' });
    expect(viewState.mounts).toBe(2);
  });

  it('ignores non-numeric input (keeps the empty state)', async () => {
    const user = userEvent.setup();
    render(<ConstellationPage />);

    await user.type(screen.getByLabelText(/discogs artist id/i), 'abc');
    // Load is disabled for invalid ids, so the graph never seeds.
    expect(screen.getByRole('button', { name: /load/i })).toBeDisabled();
    expect(screen.queryByTestId('constellation-view')).not.toBeInTheDocument();
    expect(viewState.seed).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Nav entry: the sidebar must link to /constellation so the feature is
// reachable. The Sidebar pulls auth + a health query + router hooks — mock the
// minimum so it renders its nav links.
// ---------------------------------------------------------------------------
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { role: 'admin', username: 'admin', displayName: 'Admin' },
    logout: vi.fn(),
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined }),
}));

import { Sidebar } from '@/components/layout/sidebar';

describe('Sidebar nav', () => {
  it('renders a Constellation link to /constellation', () => {
    render(<Sidebar />);

    const link = screen.getByRole('link', { name: /constellation/i });
    expect(link).toHaveAttribute('href', '/constellation');
  });
});
