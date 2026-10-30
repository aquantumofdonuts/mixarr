import { beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }));
import { api } from '@/lib/api';
import { PathFinder } from '../PathFinder';
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
let pathResponse: any;
const ok = (data: unknown) => ({ data, error: null, status: 200 });
beforeEach(() => {
  vi.resetAllMocks(); pathResponse = ok({ nodes: [1, 42, 7], degrees: 2, mode: 'shortest' });
  vi.mocked(api.get).mockImplementation(async url => {
    if (url.includes('/path?')) return await pathResponse;
    if (url.includes('/identity?mbid=')) { const index = ids.indexOf(url.split('=')[1]); return ok({ mbid: ids[index], personId: index ? 7 : 1, needsManual: false }) as any; }
    if (url.includes('/identity?personId=')) { const personId = Number(url.split('=')[1]); return ok({ mbid: personId === 1 ? ids[0] : ids[1], personId, displayName: personId === 1 ? 'From Name' : 'To Name', needsManual: false }) as any; }
    return ok({ results: ids.map((id, index) => ({ id, name: index ? 'To Name' : 'From Name', disambiguation: index ? 'Canadian ensemble' : 'British artist' })) }) as any;
  });
});
async function choose(label: string, index: number) {
  await userEvent.type(screen.getByLabelText(label), 'Name');
  const input = screen.getByLabelText(label); const region = input.parentElement!.parentElement!;
  await userEvent.click(within(region).getByRole('button', { name: 'Search' }));
  await userEvent.click((await within(region).findAllByRole('radio'))[index]);
  await within(region).findByText(`${index ? 'To Name' : 'From Name'} selected`);
}
it('submits resolved numeric people and displays names, keeping choice groups independent', async () => {
  const selected = vi.fn(), persisted = vi.fn(); render(<PathFinder onSelectPerson={selected} onPathChange={persisted} names={new Map([[42, 'Credited Collaborator']])} />);
  await choose('From artist', 0); await choose('To artist', 1);
  expect(within(screen.getByRole('group', { name: 'Choose from artist identity' })).getByRole('radio', { name: /From Name.*British/ })).toBeChecked();
  expect(within(screen.getByRole('group', { name: 'Choose to artist identity' })).getByRole('radio', { name: /To Name.*Canadian/ })).toBeChecked();
  await userEvent.click(screen.getByRole('button', { name: 'Find path' }));
  expect(api.get).toHaveBeenCalledWith('/api/constellation/path?from=1&to=7&mode=shortest', { signal: expect.any(AbortSignal) });
  expect(persisted).toHaveBeenCalledWith(1, 7, 'shortest');
  const chain = await screen.findByTestId('path-finder-chain');
  expect(within(chain).getByRole('button', { name: 'From Name' })).toBeInTheDocument();
  await userEvent.click(within(chain).getByRole('button', { name: 'Credited Collaborator' })); expect(selected).toHaveBeenCalledWith(42);
});
it('does not query a path from unselected names or identical resolved endpoints', async () => {
  render(<PathFinder />); await userEvent.type(screen.getByLabelText('From artist'), 'Name');
  expect(screen.getByRole('button', { name: 'Find path' })).toBeDisabled();
  await choose('From artist', 0); await choose('To artist', 0);
  expect(screen.getByRole('button', { name: 'Find path' })).toBeDisabled(); expect(screen.getByText('Pick two different artists.')).toBeInTheDocument();
  expect(vi.mocked(api.get).mock.calls.some(([url]) => url.includes('/path?'))).toBe(false);
});
it.each([404, 500])('shows honest no-path/error response %s', async status => {
  pathResponse = { data: null, error: status === 404 ? 'no path within 6 degrees' : 'boom', status };
  render(<PathFinder />); await choose('From artist', 0); await choose('To artist', 1); await userEvent.click(screen.getByRole('button', { name: 'Find path' }));
  expect(await screen.findByTestId(status === 404 ? 'path-finder-empty' : 'path-finder-error')).toHaveTextContent(pathResponse.error);
});
it('restores numeric endpoints through verified reverse identity and reruns the saved path', async () => {
  pathResponse = ok({ nodes: [1, 7], degrees: 1, mode: 'interesting', totalBridge: 1.5 });
  render(<PathFinder initialFrom={1} initialTo={7} initialMode="interesting" />);
  expect(await screen.findByTestId('path-finder-result')).toHaveTextContent('From Name');
  expect(screen.getByTestId('path-finder-total-bridge')).toHaveTextContent('1.5');
  expect(api.get).toHaveBeenCalledWith('/api/constellation/path?from=1&to=7&mode=interesting', { signal: expect.any(AbortSignal) });
});
it('aborts and ignores a pending path when an endpoint changes', async () => {
  let complete!: (value: any) => void; pathResponse = new Promise(resolve => { complete = resolve; });
  render(<PathFinder />); await choose('From artist', 0); await choose('To artist', 1); await userEvent.click(screen.getByRole('button', { name: 'Find path' }));
  const signal = vi.mocked(api.get).mock.calls.find(([url]) => url.includes('/path?'))![1]!.signal!;
  await userEvent.type(screen.getByLabelText('To artist'), 'edited'); expect(signal.aborted).toBe(true);
  await act(async () => complete(ok({ nodes: [1, 7], degrees: 1, mode: 'shortest' })));
  expect(screen.queryByTestId('path-finder-result')).toBeNull(); expect(screen.getByRole('button', { name: 'Find path' })).toBeDisabled();
});
it('keeps selected names and path when URL commit echoes resolved IDs without cached display names', async () => {
  const view = render(<PathFinder />); await choose('From artist', 0); await choose('To artist', 1);
  await userEvent.click(screen.getByRole('button', { name: 'Find path' })); await screen.findByTestId('path-finder-result');
  vi.mocked(api.get).mockClear();
  view.rerender(<PathFinder initialFrom={1} initialTo={7} />);
  await waitFor(() => expect(screen.getByTestId('path-finder-result')).toHaveTextContent('From Name'));
  expect(screen.getByLabelText('From artist')).toHaveValue('From Name');
  expect(vi.mocked(api.get).mock.calls.some(([url]) => url.includes('/identity?personId'))).toBe(false);
});
