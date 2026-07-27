import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock the api wrapper so no real fetch happens.
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { api } from '@/lib/api';
import {
  ConstellationPlayer,
  ConstellationPlayerProvider,
  type NowPlayingRequest,
} from '../ConstellationPlayer';
import { PersonPanel } from '../PersonPanel';

const mockGet = api.get as unknown as Mock;

const DEEZER = {
  source: 'deezer' as const,
  previewUrl: 'https://cdn.deezer.com/preview.mp3',
  title: 'Closer',
  artist: 'Nine Inch Nails',
  coverUrl: 'https://cdn.deezer.com/cover.jpg',
};

const YOUTUBE = {
  source: 'youtube' as const,
  youtubeUrl: 'https://www.youtube.com/results?search_query=Some%20Session%20Player',
};

// jsdom does not implement media playback; stub play/pause/load + `paused`.
let playMock: Mock;
let pauseMock: Mock;

beforeEach(() => {
  vi.resetAllMocks();
  playMock = vi.fn().mockResolvedValue(undefined);
  pauseMock = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(playMock);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pauseMock);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  // The toggle plays when the element reports paused; keep it "paused" so a user
  // click always resolves to a play() call.
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get: () => true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function playReq(req: Partial<NowPlayingRequest> = {}): NowPlayingRequest {
  return { artist: 'Nine Inch Nails', ...req };
}

describe('ConstellationPlayer', () => {
  it('renders nothing when there is no request', () => {
    const { container } = render(<ConstellationPlayer request={null} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('calls /play with the artist/track/owned query params', async () => {
    mockGet.mockResolvedValue({ data: DEEZER, error: null, status: 200 });
    render(
      <ConstellationPlayer
        request={playReq({ track: 'Closer', owned: true })}
        onClose={vi.fn()}
      />,
    );
    await screen.findByTestId('player-audio');
    const url = mockGet.mock.calls[0][0] as string;
    expect(url).toContain('/api/constellation/play?');
    expect(url).toContain('artist=Nine+Inch+Nails');
    expect(url).toContain('track=Closer');
    expect(url).toContain('owned=true');
  });

  it("deezer source: the <audio> gets the previewUrl and play() fires on the user's click", async () => {
    mockGet.mockResolvedValue({ data: DEEZER, error: null, status: 200 });
    render(<ConstellationPlayer request={playReq({ track: 'Closer' })} onClose={vi.fn()} />);

    const audio = await screen.findByTestId('player-audio');
    expect(audio).toHaveAttribute('src', DEEZER.previewUrl);
    // Deezer source badge is shown (honest source labelling).
    expect(screen.getByTestId('player-source-deezer')).toBeInTheDocument();
    // No autoplay: play() only fires when the user hits the toggle.
    expect(playMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('player-play-toggle'));
    expect(playMock).toHaveBeenCalledTimes(1);
  });

  it('youtube source: renders a link-out with the right href and does NOT autoplay any audio', async () => {
    mockGet.mockResolvedValue({ data: YOUTUBE, error: null, status: 200 });
    render(
      <ConstellationPlayer request={{ artist: 'Some Session Player' }} onClose={vi.fn()} />,
    );

    const link = await screen.findByTestId('player-youtube-link');
    expect(link).toHaveAttribute('href', YOUTUBE.youtubeUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    // A link-out, not an embed: no <audio>, no play().
    expect(screen.queryByTestId('player-audio')).not.toBeInTheDocument();
    expect(playMock).not.toHaveBeenCalled();
    // Honest expectation-setting: source badge + no-preview note.
    expect(screen.getByTestId('player-source-youtube')).toBeInTheDocument();
    expect(screen.getByTestId('player-no-preview')).toBeInTheDocument();
  });

  it('shows the "in your library" owned badge when the request is owned', async () => {
    mockGet.mockResolvedValue({ data: { ...DEEZER, owned: true }, error: null, status: 200 });
    render(<ConstellationPlayer request={playReq({ owned: true })} onClose={vi.fn()} />);
    expect(await screen.findByTestId('player-owned-badge')).toBeInTheDocument();
  });

  it('pauses + cleans up the audio element on unmount (no leaked playback)', async () => {
    mockGet.mockResolvedValue({ data: DEEZER, error: null, status: 200 });
    const { unmount } = render(
      <ConstellationPlayer request={playReq({ track: 'Closer' })} onClose={vi.fn()} />,
    );
    await screen.findByTestId('player-audio');

    unmount();
    expect(pauseMock).toHaveBeenCalled();
  });

  it('shows an error state when playback resolution fails', async () => {
    mockGet.mockResolvedValue({ data: null, error: 'boom', status: 500 });
    render(<ConstellationPlayer request={playReq()} onClose={vi.fn()} />);
    expect(await screen.findByTestId('player-error')).toHaveTextContent('boom');
  });

  it('fires onClose from the close control', async () => {
    mockGet.mockResolvedValue({ data: DEEZER, error: null, status: 200 });
    const onClose = vi.fn();
    render(<ConstellationPlayer request={playReq()} onClose={onClose} />);
    await screen.findByTestId('player-audio');
    await userEvent.click(screen.getByTestId('player-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('PersonPanel play wiring (context-driven trigger)', () => {
  const releases = [{ releaseId: 1, title: 'The Downward Spiral', year: 1994, master: 100 }];

  it("the header ▶ resolves and plays the person's representative track", async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/releases')) {
        return Promise.resolve({ data: { personId: 5, releases }, error: null, status: 200 });
      }
      if (url.includes('/play')) {
        return Promise.resolve({ data: DEEZER, error: null, status: 200 });
      }
      return Promise.resolve({ data: null, error: 'unexpected', status: 500 });
    });

    render(
      <ConstellationPlayerProvider>
        <PersonPanel personId={5} displayName="Nine Inch Nails" onClose={vi.fn()} />
      </ConstellationPlayerProvider>,
    );
    await screen.findByText('The Downward Spiral');

    await userEvent.click(screen.getByTestId('person-panel-play'));

    // The page-level player resolved a source and rendered its bar.
    expect(await screen.findByTestId('player-source-deezer')).toBeInTheDocument();
    const playCall = mockGet.mock.calls.find((c) => String(c[0]).includes('/play'));
    expect(playCall?.[0]).toContain('artist=Nine+Inch+Nails');
  });

  it('a per-release ▶ plays that release title', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/releases')) {
        return Promise.resolve({ data: { personId: 5, releases }, error: null, status: 200 });
      }
      return Promise.resolve({ data: DEEZER, error: null, status: 200 });
    });

    render(
      <ConstellationPlayerProvider>
        <PersonPanel personId={5} displayName="Nine Inch Nails" onClose={vi.fn()} />
      </ConstellationPlayerProvider>,
    );
    await screen.findByText('The Downward Spiral');

    await userEvent.click(screen.getByTestId('person-panel-play-release-1'));

    const playCall = mockGet.mock.calls.find((c) => String(c[0]).includes('/play'));
    expect(playCall?.[0]).toContain('track=The+Downward+Spiral');
  });
});
