import { beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }));
import { api } from '@/lib/api';
import { ArtistLookup } from '../ArtistLookup';
const id = '11111111-1111-4111-8111-111111111111';
const ok = (data: unknown) => ({ data, error: null, status: 200 });
beforeEach(() => vi.resetAllMocks());
it('validates and deduplicates candidates and never chooses from a name automatically', async () => {
  vi.mocked(api.get).mockResolvedValue(ok({ results: [{ id, name: 'Name', country: { bad: true } }, { id: id.toUpperCase(), name: 'duplicate' }, { id: 'invalid', name: 'bad' }, null, { id: '22222222-2222-4222-8222-222222222222', name: '' }] }) as any);
  const changed = vi.fn(); render(<ArtistLookup label="Artist" onChange={changed} />);
  await userEvent.type(screen.getByLabelText('Artist'), 'Name'); await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findAllByRole('radio')).toHaveLength(1); expect(screen.getByText('No disambiguation supplied')).toBeInTheDocument();
  expect(changed.mock.calls.every(([person]) => person === null)).toBe(true); expect(api.get).toHaveBeenCalledTimes(1);
});
it('ignores stale lookup and identity results after editing, actor changes and unmount', async () => {
  let complete!: (value: any) => void; vi.mocked(api.get).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const changed = vi.fn(); const view = render(<ArtistLookup label="Artist" actorId={7} onChange={changed} />);
  await userEvent.type(screen.getByLabelText('Artist'), 'Name'); await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  const signal = vi.mocked(api.get).mock.calls[0][1]!.signal!; await userEvent.type(screen.getByLabelText('Artist'), ' edited'); expect(signal.aborted).toBe(true);
  await act(async () => complete(ok({ results: [{ id, name: 'Stale' }] }))); expect(screen.queryByRole('radio')).toBeNull();
  vi.mocked(api.get).mockResolvedValue(ok({ results: [{ id, name: 'Name' }] }) as any); await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  vi.mocked(api.get).mockImplementation(() => new Promise(resolve => { complete = resolve; })); await userEvent.click(await screen.findByRole('radio'));
  view.rerender(<ArtistLookup label="Artist" actorId={8} onChange={changed} />);
  await act(async () => complete(ok({ mbid: id, personId: 1, needsManual: false })));
  expect(changed.mock.calls.every(([person]) => person === null)).toBe(true); view.unmount();
});
it('retries a restored identity failure and resolves a missing cached name using the verified inspector contract', async () => {
  vi.mocked(api.get).mockResolvedValueOnce({ data: null, error: 'Offline', status: 500 }).mockImplementation(async url => ok(url.includes('/detail') ? { mbid: id, name: 'Restored Name' } : { mbid: id, personId: 15, displayName: '', needsManual: false }) as any);
  const changed = vi.fn(); render(<ArtistLookup label="Artist" initialPersonId={15} onChange={changed} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Retry artist' }));
  expect(await screen.findByText('Restored Name selected')).toBeInTheDocument();
  expect(screen.getByText('Discogs person ID: 15')).toHaveClass('font-mono');
  expect(changed).toHaveBeenLastCalledWith({ mbid: id, personId: 15, name: 'Restored Name' });
  expect(api.get).toHaveBeenCalledTimes(3);
});
it('retains candidate choices during resolution failure and retries the actual lookup', async () => {
  vi.mocked(api.get).mockResolvedValueOnce(ok({ results: [{ id, name: 'Name' }] }) as any).mockResolvedValueOnce({ data: null, error: 'Offline', status: 500 }).mockResolvedValueOnce(ok({ mbid: id, personId: 15, needsManual: false }) as any);
  const changed = vi.fn(); render(<ArtistLookup label="Artist" onChange={changed} />);
  await userEvent.type(screen.getByLabelText('Artist'), 'Name'); await userEvent.click(screen.getByRole('button', { name: 'Search' })); await userEvent.click(await screen.findByRole('radio'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline'); expect(screen.getAllByRole('radio')).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: 'Retry artist' })); await waitFor(() => expect(changed).toHaveBeenLastCalledWith({ mbid: id, personId: 15, name: 'Name' }));
});

it('shows verified numeric metadata only after deliberate candidate resolution and clears it when edited', async () => {
  let complete!: (value: any) => void;
  vi.mocked(api.get).mockResolvedValueOnce(ok({ results: [{ id, name: 'Name' }] }) as any).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  render(<ArtistLookup label="Artist" onChange={vi.fn()} />);
  await userEvent.type(screen.getByLabelText('Artist'), 'Name'); await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(screen.queryByText(/Discogs person ID:/)).toBeNull(); await userEvent.click(await screen.findByRole('radio'));
  expect(screen.queryByText(/Discogs person ID:/)).toBeNull();
  await act(async () => complete(ok({ mbid: id, personId: 15, needsManual: false })));
  expect(screen.getByText('Name selected')).toBeInTheDocument(); expect(screen.getByText('Discogs person ID: 15')).toHaveClass('font-mono');
  await userEvent.type(screen.getByLabelText('Artist'), ' edited'); expect(screen.queryByText(/Discogs person ID:/)).toBeNull();
});
it('does not present an unresolved restored numeric identifier as a verified selection', async () => {
  vi.mocked(api.get).mockResolvedValue(ok({ personId: 15, mbid: null, needsManual: true }) as any);
  render(<ArtistLookup label="Artist" initialPersonId={15} onChange={vi.fn()} />);
  expect(await screen.findByText(/No verified graph identity/)).toBeInTheDocument(); expect(screen.queryByText(/Discogs person ID:/)).toBeNull();
});
