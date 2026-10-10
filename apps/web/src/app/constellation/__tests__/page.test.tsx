import { beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const state = vi.hoisted(() => ({ params: new URLSearchParams(), push: vi.fn(), replace: vi.fn(), seed: null as any, props: null as any, player: false }));
vi.mock('next/navigation', () => ({ usePathname: () => '/constellation', useSearchParams: () => state.params, useRouter: () => ({ push: state.push, replace: state.replace }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 7 } }) }));
vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/components/constellation/ConstellationView', async () => {
  const { useConstellationPlayer } = await import('@/components/constellation/ConstellationPlayer');
  return { ConstellationView: (props: any) => { state.seed = props.seed; state.props = props; state.player = !!useConstellationPlayer(); return <div data-testid="graph" />; } };
});
import { api } from '@/lib/api';
import ConstellationPage from '../page';
const mbid = '11111111-1111-4111-8111-111111111111';
beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.get).mockResolvedValue({ data: null, error: null, status: 200 }); state.params = new URLSearchParams(); state.seed = null; });
it('requires explicit named candidate resolution before offering Explore', async () => {
  vi.mocked(api.get).mockImplementation(async url => ({ data: url.includes('/identity') ? { mbid, personId: 15, needsManual: false } : { results: [{ id: mbid, name: 'Common Name', disambiguation: 'British artist' }] }, error: null, status: 200 }) as any);
  const view = render(<ConstellationPage />);
  expect(screen.queryByTestId('graph')).toBeNull();
  expect(screen.getByRole('button', { name: 'Explore artist' })).toBeDisabled();
  await userEvent.type(screen.getByLabelText('Seed artist'), 'Common Name');
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(screen.getByRole('button', { name: 'Explore artist' })).toBeDisabled();
  await userEvent.click(await screen.findByRole('radio'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Explore artist' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Explore artist' }));
  expect(state.push).toHaveBeenCalledWith(`/constellation?seed=${mbid}&focus=15`, { scroll: false });
  state.params = new URLSearchParams(`seed=${mbid}&focus=15`); view.rerender(<ConstellationPage />);
  expect(state.seed).toEqual({ type: 'artist', id: mbid }); expect(state.player).toBe(true);
});
it('does not offer an orbit when a candidate has no verified graph identity', async () => {
  vi.mocked(api.get).mockImplementation(async url => ({ data: url.includes('/identity') ? { mbid, personId: null, needsManual: true } : { results: [{ id: mbid, name: 'Common Name' }] }, error: null, status: 200 }) as any);
  render(<ConstellationPage />); await userEvent.type(screen.getByLabelText('Seed artist'), 'Common Name');
  await userEvent.click(screen.getByRole('button', { name: 'Search' })); await userEvent.click(await screen.findByRole('radio'));
  expect(await screen.findByText(/No verified graph identity/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Explore artist' })).toBeDisabled(); expect(state.push).not.toHaveBeenCalled();
});
it('restores validated seed/focus/path and preserves inspector and unrelated query identifiers', () => {
  state.params = new URLSearchParams(`seed=${mbid}&focus=15&from=15&to=20&mode=interesting&artist=${mbid}&q=retained`);
  render(<ConstellationPage />);
  expect(state.props).toMatchObject({ requestedFocus: 15, pathFrom: 15, pathTo: 20, pathMode: 'interesting' });
  state.props.onFocusChange(20);
  expect(state.push).toHaveBeenCalledWith(expect.stringContaining(`artist=${mbid}&q=retained`), { scroll: false });
  expect(state.push.mock.calls[0][0]).toContain('focus=20');
  state.props.onPathChange(20, 25, 'shortest'); expect(state.push.mock.calls[1][0]).toContain('from=20&to=25&mode=shortest');
});
it('rejects invalid seed and unsafe numeric URL identifiers', () => {
  state.params = new URLSearchParams('seed=name&focus=-1'); const view = render(<ConstellationPage />);
  expect(screen.getByRole('alert')).toHaveTextContent('valid MusicBrainz'); expect(screen.queryByTestId('graph')).toBeNull();
  state.params = new URLSearchParams(`seed=${mbid}&focus=999999999999999999999999&from=0&to=1x`); view.rerender(<ConstellationPage />);
  expect(state.props).toMatchObject({ requestedFocus: null, pathFrom: null, pathTo: null });
});

it('restores the seed by its MBID independently of walking focus across Back and reload', async () => {
  const other = '22222222-2222-4222-8222-222222222222';
  vi.mocked(api.get).mockImplementation(async url => {
    const identity = url.includes(other) ? other : mbid;
    return { data: url.endsWith('/detail') ? { mbid: identity, name: identity === mbid ? 'British seed' : 'Canadian seed' } : { mbid: identity, personId: identity === mbid ? 1 : 7, needsManual: false }, error: null, status: 200 } as any;
  });
  state.params = new URLSearchParams(`seed=${mbid}&focus=42`);
  const view = render(<ConstellationPage />);
  await waitFor(() => expect(screen.getByLabelText('Seed artist')).toHaveValue('British seed')); expect(screen.getByText('Discogs person ID: 1')).toBeInTheDocument();
  expect(state.props.requestedFocus).toBe(42); expect(screen.getByRole('button', { name: 'Explore artist' })).toBeEnabled();
  state.params = new URLSearchParams(`seed=${other}&focus=7`); view.rerender(<ConstellationPage />);
  await waitFor(() => expect(screen.getByLabelText('Seed artist')).toHaveValue('Canadian seed'));
  state.params = new URLSearchParams(`seed=${mbid}&focus=42`); view.rerender(<ConstellationPage />);
  await waitFor(() => expect(screen.getByLabelText('Seed artist')).toHaveValue('British seed')); expect(screen.queryByText('Discogs person ID: 7')).toBeNull();
  expect(vi.mocked(api.get).mock.calls.some(([url]) => url.includes('personId=42'))).toBe(false);
  view.unmount(); render(<ConstellationPage />); await waitFor(() => expect(screen.getByLabelText('Seed artist')).toHaveValue('British seed'));
});

it('keeps an edited deliberate selection through focus navigation and preserves it during its own Explore commit', async () => {
  const other = '22222222-2222-4222-8222-222222222222';
  vi.mocked(api.get).mockImplementation(async url => {
    if (url.includes('/musicbrainz/artist')) return { data: { results: [{ id: other, name: 'Canadian choice', disambiguation: 'Deliberate identity' }] }, error: null, status: 200 } as any;
    const identity = url.includes(other) ? other : mbid;
    return { data: url.endsWith('/detail') ? { mbid: identity, name: 'British restored seed' } : { mbid: identity, personId: identity === mbid ? 1 : 7, needsManual: false }, error: null, status: 200 } as any;
  });
  state.params = new URLSearchParams(`seed=${mbid}&focus=1`); const view = render(<ConstellationPage />);
  await waitFor(() => expect(screen.getByLabelText('Seed artist')).toHaveValue('British restored seed'));
  await userEvent.clear(screen.getByLabelText('Seed artist')); await userEvent.type(screen.getByLabelText('Seed artist'), 'Canadian');
  expect(screen.getByRole('button', { name: 'Explore artist' })).toBeDisabled(); expect(screen.queryByText(/Discogs person ID:/)).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Search' })); await userEvent.click(await screen.findByRole('radio'));
  await screen.findByText('Canadian choice selected');
  state.params = new URLSearchParams(`seed=${mbid}&focus=42`); view.rerender(<ConstellationPage />);
  expect(screen.getByLabelText('Seed artist')).toHaveValue('Canadian choice'); expect(screen.getByText('Discogs person ID: 7')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Explore artist' })); expect(state.push).toHaveBeenLastCalledWith(`/constellation?seed=${other}&focus=7`, { scroll: false });
  state.params = new URLSearchParams(`seed=${other}&focus=7`); view.rerender(<ConstellationPage />);
  expect(screen.getByLabelText('Seed artist')).toHaveValue('Canadian choice');
  expect(vi.mocked(api.get).mock.calls.some(([url]) => url === `/api/search/artist/${other}/detail`)).toBe(false);
});

it.each([false, true])('preserves new typing and its pending search across an own Explore commit (initially restored: %s)', async initiallyRestored => {
  let complete!: (value: any) => void;
  if (initiallyRestored) {
    state.params = new URLSearchParams('seed=22222222-2222-4222-8222-222222222222&focus=7');
    vi.mocked(api.get).mockResolvedValueOnce({ data: { mbid: '22222222-2222-4222-8222-222222222222', personId: 7, displayName: 'Previous seed', needsManual: false }, error: null, status: 200 });
  }
  vi.mocked(api.get).mockResolvedValueOnce({ data: { results: [{ id: mbid, name: 'British choice' }] }, error: null, status: 200 })
    .mockResolvedValueOnce({ data: { mbid, personId: 1, needsManual: false }, error: null, status: 200 })
    .mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const view = render(<ConstellationPage />);
  if (initiallyRestored) { await screen.findByText('Previous seed selected'); await userEvent.clear(screen.getByLabelText('Seed artist')); }
  await userEvent.type(screen.getByLabelText('Seed artist'), 'British'); await userEvent.click(screen.getByRole('button', { name: 'Search' })); await userEvent.click(await screen.findByRole('radio'));
  await userEvent.click(screen.getByRole('button', { name: 'Explore artist' }));
  await userEvent.clear(screen.getByLabelText('Seed artist')); await userEvent.type(screen.getByLabelText('Seed artist'), 'Canadian draft'); await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  const signal = vi.mocked(api.get).mock.calls[initiallyRestored ? 3 : 2][1]!.signal!;
  state.params = new URLSearchParams(`seed=${mbid}&focus=1`); view.rerender(<ConstellationPage />);
  expect(screen.getByLabelText('Seed artist')).toHaveValue('Canadian draft'); expect(signal.aborted).toBe(false);
  expect(screen.getByRole('button', { name: 'Explore artist' })).toBeDisabled(); expect(screen.queryByText(/Discogs person ID:/)).toBeNull();
  await act(async () => complete({ data: { results: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Canadian candidate' }] }, error: null, status: 200 }));
  expect(await screen.findByRole('radio', { name: /Canadian candidate/ })).toBeInTheDocument(); expect(api.get).toHaveBeenCalledTimes(initiallyRestored ? 4 : 3);
});

it('retires an obsolete own-commit marker on different URL navigation before a genuine Back', async () => {
  const other = '22222222-2222-4222-8222-222222222222';
  vi.mocked(api.get).mockImplementation(async url => ({ data: url.includes('/identity') ? { mbid: url.includes(other) ? other : mbid, personId: url.includes(other) ? 7 : 1, displayName: url.includes(other) ? 'Other restored seed' : 'British restored seed', needsManual: false } : { results: [{ id: mbid, name: 'British choice' }] }, error: null, status: 200 }) as any);
  const view = render(<ConstellationPage />);
  await userEvent.type(screen.getByLabelText('Seed artist'), 'British'); await userEvent.click(screen.getByRole('button', { name: 'Search' })); await userEvent.click(await screen.findByRole('radio'));
  await userEvent.click(screen.getByRole('button', { name: 'Explore artist' }));
  state.params = new URLSearchParams(`seed=${other}&focus=7`); view.rerender(<ConstellationPage />); await screen.findByText('Other restored seed selected');
  await userEvent.type(screen.getByLabelText('Seed artist'), ' edited'); expect(screen.queryByText(/Discogs person ID:/)).toBeNull();
  state.params = new URLSearchParams(`seed=${mbid}&focus=1`); view.rerender(<ConstellationPage />);
  expect(await screen.findByText('British restored seed selected')).toBeInTheDocument(); expect(screen.getByText('Discogs person ID: 1')).toBeInTheDocument();
});
