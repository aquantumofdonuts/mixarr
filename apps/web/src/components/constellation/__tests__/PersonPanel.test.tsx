import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
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
import { PersonPanel } from '../PersonPanel';

const mockGet = api.get as unknown as Mock;
const mockPost = api.post as unknown as Mock;

const releases = [
  { releaseId: 1, title: 'The Downward Spiral', year: 1994, master: 100 },
  { releaseId: 2, title: 'The Fragile', year: 1999, master: 200 },
];

function releasesOk() {
  mockGet.mockResolvedValue({
    data: { personId: 5, releases },
    error: null,
    status: 200,
  });
}

describe('PersonPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders nothing when personId is null', () => {
    const { container } = render(<PersonPanel personId={null} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('fetches and renders the discography for the person', async () => {
    releasesOk();
    render(<PersonPanel personId={5} displayName="Nine Inch Nails" onClose={vi.fn()} />);

    expect(mockGet).toHaveBeenCalledWith('/api/constellation/person/5/releases');
    expect(await screen.findByText('The Downward Spiral')).toBeInTheDocument();
    expect(screen.getByText('The Fragile')).toBeInTheDocument();
    expect(screen.getByText('Nine Inch Nails')).toBeInTheDocument();
  });

  it('shows an empty state when there are no releases', async () => {
    mockGet.mockResolvedValue({ data: { personId: 5, releases: [] }, error: null, status: 200 });
    render(<PersonPanel personId={5} onClose={vi.fn()} />);
    expect(await screen.findByTestId('person-panel-empty')).toBeInTheDocument();
  });

  it('shows an error state when the discography fetch fails', async () => {
    mockGet.mockResolvedValue({ data: null, error: 'boom', status: 500 });
    render(<PersonPanel personId={5} onClose={vi.fn()} />);
    expect(await screen.findByTestId('person-panel-error')).toHaveTextContent('boom');
  });

  it('POSTs the subscribe endpoint when "Monitor artist" is clicked', async () => {
    releasesOk();
    mockPost.mockResolvedValue({
      data: { added: true, mbid: 'mbid-abc', target: 'artist' },
      error: null,
      status: 200,
    });
    render(<PersonPanel personId={5} displayName="Nine Inch Nails" onClose={vi.fn()} />);
    await screen.findByText('The Downward Spiral');

    await userEvent.click(screen.getByRole('button', { name: /monitor artist/i }));

    expect(mockPost).toHaveBeenCalledWith('/api/constellation/person/5/subscribe', {
      releaseTitle: undefined,
      name: 'Nine Inch Nails',
    });
    expect(await screen.findByText(/monitoring this artist/i)).toBeInTheDocument();
  });

  it('POSTs a releaseTitle when a per-release "Add to Lidarr" is clicked', async () => {
    releasesOk();
    mockPost.mockResolvedValue({
      data: { added: true, mbid: 'mbid-abc', target: 'album' },
      error: null,
      status: 200,
    });
    render(<PersonPanel personId={5} displayName="Nine Inch Nails" onClose={vi.fn()} />);
    await screen.findByText('The Downward Spiral');

    const addButtons = screen.getAllByRole('button', { name: /add to lidarr/i });
    await userEvent.click(addButtons[0]);

    expect(mockPost).toHaveBeenCalledWith('/api/constellation/person/5/subscribe', {
      releaseTitle: 'The Downward Spiral',
      name: 'Nine Inch Nails',
    });
  });

  it('shows the honest needsManual message (not a generic error) on a 409', async () => {
    releasesOk();
    mockPost.mockResolvedValue({
      data: null,
      error: 'HTTP 409',
      status: 409,
    });
    render(<PersonPanel personId={5} displayName="Some Session Player" onClose={vi.fn()} />);
    await screen.findByText('The Downward Spiral');

    await userEvent.click(screen.getByRole('button', { name: /monitor artist/i }));

    const notice = await screen.findByTestId('person-panel-needs-manual');
    expect(notice).toHaveTextContent(/not in musicbrainz/i);
    // It offers a MusicBrainz search link rather than a generic error.
    const link = screen.getByRole('link', { name: /search musicbrainz/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('musicbrainz.org'));
    // Not a generic error banner.
    expect(screen.queryByText('HTTP 409')).not.toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', async () => {
    releasesOk();
    const onClose = vi.fn();
    render(<PersonPanel personId={5} onClose={onClose} />);
    await screen.findByText('The Downward Spiral');
    await userEvent.click(screen.getByRole('button', { name: /close panel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
