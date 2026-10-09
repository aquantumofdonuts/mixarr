import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
beforeEach(() => { vi.clearAllMocks(); state.params = new URLSearchParams(); state.seed = null; });
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
