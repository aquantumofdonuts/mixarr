import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock the api wrapper so no real fetch happens.
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
}));

import { api } from '@/lib/api';
import { PathFinder } from '../PathFinder';
import type { PathResult } from '@/types/constellation';

const mockGet = api.get as unknown as Mock;

function pathOk(result: PathResult) {
  return { data: result, error: null, status: 200 };
}

async function fillIds(from: string, to: string) {
  await userEvent.type(screen.getByLabelText(/from artist id/i), from);
  await userEvent.type(screen.getByLabelText(/to artist id/i), to);
}

describe('PathFinder', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('submits a shortest-path query to the correct endpoint and renders the chain', async () => {
    mockGet.mockResolvedValue(
      pathOk({ nodes: [1, 42, 7], degrees: 2, mode: 'shortest' }),
    );
    render(<PathFinder />);

    await fillIds('1', '7');
    await userEvent.click(screen.getByRole('button', { name: /find path/i }));

    expect(mockGet).toHaveBeenCalledWith(
      '/api/constellation/path?from=1&to=7&mode=shortest',
    );

    const chain = await screen.findByTestId('path-finder-chain');
    // Each hop id appears as a clickable button.
    expect(within(chain).getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(within(chain).getByRole('button', { name: '42' })).toBeInTheDocument();
    expect(within(chain).getByRole('button', { name: '7' })).toBeInTheDocument();
    // Degrees are reported.
    expect(screen.getByTestId('path-finder-result')).toHaveTextContent(/2 degrees/i);
    // Shortest mode carries no totalBridge.
    expect(screen.queryByTestId('path-finder-total-bridge')).not.toBeInTheDocument();
  });

  it('shows a "Searching…" state for the (slower) interesting mode, then the chain + totalBridge', async () => {
    let resolve!: (v: unknown) => void;
    mockGet.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<PathFinder />);

    // Switch to interesting mode.
    await userEvent.click(screen.getByRole('radio', { name: /interesting/i }));
    await fillIds('1', '9');
    await userEvent.click(screen.getByRole('button', { name: /find path/i }));

    // In-flight: the honest "Searching…" state is shown.
    expect(await screen.findByTestId('path-finder-searching')).toBeInTheDocument();

    expect(mockGet).toHaveBeenCalledWith(
      '/api/constellation/path?from=1&to=9&mode=interesting',
    );

    // Resolve the request.
    resolve(pathOk({ nodes: [1, 5, 9], degrees: 2, mode: 'interesting', totalBridge: 1.5 }));

    const chain = await screen.findByTestId('path-finder-chain');
    expect(within(chain).getByRole('button', { name: '5' })).toBeInTheDocument();
    // Interesting mode reports the total bridge score.
    expect(screen.getByTestId('path-finder-total-bridge')).toHaveTextContent(/1\.5/);
    // The searching state is gone.
    expect(screen.queryByTestId('path-finder-searching')).not.toBeInTheDocument();
  });

  it('shows the honest "no path" message on a 404 (not a generic error)', async () => {
    mockGet.mockResolvedValue({ data: null, error: 'no path within 6 degrees', status: 404 });
    render(<PathFinder />);

    await fillIds('1', '99999');
    await userEvent.click(screen.getByRole('button', { name: /find path/i }));

    const empty = await screen.findByTestId('path-finder-empty');
    expect(empty).toHaveTextContent(/no path within 6 degrees/i);
    // Not surfaced as a generic error banner.
    expect(screen.queryByTestId('path-finder-error')).not.toBeInTheDocument();
  });

  it('shows an error state on a non-404 failure', async () => {
    mockGet.mockResolvedValue({ data: null, error: 'boom', status: 500 });
    render(<PathFinder />);

    await fillIds('1', '2');
    await userEvent.click(screen.getByRole('button', { name: /find path/i }));

    expect(await screen.findByTestId('path-finder-error')).toHaveTextContent('boom');
    expect(screen.queryByTestId('path-finder-empty')).not.toBeInTheDocument();
  });

  it('calls onSelectPerson with the hop id when a chain node is clicked', async () => {
    mockGet.mockResolvedValue(pathOk({ nodes: [1, 42, 7], degrees: 2, mode: 'shortest' }));
    const onSelectPerson = vi.fn();
    render(<PathFinder onSelectPerson={onSelectPerson} />);

    await fillIds('1', '7');
    await userEvent.click(screen.getByRole('button', { name: /find path/i }));

    const chain = await screen.findByTestId('path-finder-chain');
    await userEvent.click(within(chain).getByRole('button', { name: '42' }));
    expect(onSelectPerson).toHaveBeenCalledWith(42);
  });

  it('does not query when the ids are incomplete', async () => {
    render(<PathFinder />);
    await userEvent.type(screen.getByLabelText(/from artist id/i), '1');
    await userEvent.click(screen.getByRole('button', { name: /find path/i }));
    expect(mockGet).not.toHaveBeenCalled();
  });
});
