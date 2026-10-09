import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAddArtistOptions } from '../AddArtistOptions';
import { api } from '@/lib/api';
const mocks = vi.hoisted(() => ({ actor: 1, execute: vi.fn(), current: null as null | (() => boolean) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: mocks.actor } }) }));
vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }));
const mbid = '11111111-1111-4111-8111-111111111111';
const profiles = { qualityProfiles: [{ id: 1, name: 'Default' }, { id: 9, name: 'Alternative' }], metadataProfiles: [{ id: 2, name: 'Metadata' }], rootFolders: [{ id: 1, path: '/music' }, { id: 2, path: '/archive' }], defaults: { qualityProfileId: 1, metadataProfileId: 2, rootFolderPath: '/music', monitorOption: 'missing', monitorNewItems: 'none', searchOnAdd: false } };
function Harness({ scope = 'A', identity = mbid, album = false }: { scope?: string; identity?: string; album?: boolean }) {
  const action = useAddArtistOptions(scope);
  return <><button onClick={() => void action.runWithOptions({ name: 'Artist', mbid: identity, album }, async (options, current) => { mocks.current = current; return mocks.execute(options); })}>Start</button>{action.dialog}</>;
}
beforeEach(() => { vi.clearAllMocks(); mocks.actor = 1; mocks.execute.mockResolvedValue(true); vi.mocked(api.get).mockResolvedValue({ data: profiles, error: null, status: 200 } as any); });
afterEach(cleanup);
async function open() { fireEvent.click(screen.getByRole('button', { name: 'Start' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm add' })).toBeEnabled()); }
describe('shared acquisition action step', () => {
  it('initializes real defaults and passes changed controls including explicit false', async () => {
    render(<Harness />); await open();
    expect(screen.getByRole('checkbox', { name: 'Search on add' })).not.toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Monitor albums' })).toHaveValue('missing');
    fireEvent.change(screen.getByRole('combobox', { name: 'Root folder' }), { target: { value: '/archive' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Quality profile' }), { target: { value: '9' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Monitor albums' }), { target: { value: 'future' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm add' }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledWith({ qualityProfileId: 9, metadataProfileId: 2, rootFolderPath: '/archive', monitorOption: 'future', monitorNewItems: 'none', searchOnAdd: false, mbid }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('retains entered options and requires an explicit retry after a failed provider response', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('Provider offline')).mockResolvedValueOnce(true);
    render(<Harness />); await open();
    fireEvent.change(screen.getByRole('combobox', { name: 'Root folder' }), { target: { value: '/archive' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm add' })); await screen.findByText('Provider offline');
    expect(screen.getByRole('combobox', { name: 'Root folder' })).toHaveValue('/archive'); expect(mocks.execute).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm add' })); await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(2));
    expect(mocks.execute.mock.calls[0]).toEqual(mocks.execute.mock.calls[1]);
  });
  it('focuses the first invalid option and makes no acquisition decision', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ...profiles, defaults: { ...profiles.defaults, rootFolderPath: '/unavailable' } }, error: null } as any);
    render(<Harness />); await open(); fireEvent.click(screen.getByRole('button', { name: 'Confirm add' }));
    expect(screen.getByRole('combobox', { name: 'Root folder' })).toHaveFocus(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('shows targeted album semantics and sends search control without ineffective artist monitoring controls', async () => {
    render(<Harness album />); await open();
    expect(screen.getByText(/Only this album will be monitored/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Monitor albums' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm add' })); await waitFor(() => expect(mocks.execute).toHaveBeenCalled());
    expect(mocks.execute.mock.calls[0][0]).toEqual({ qualityProfileId: 1, metadataProfileId: 2, rootFolderPath: '/music', searchOnAdd: false, mbid });
  });
  it('keeps malformed provider profiles recoverable instead of crashing', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { available: false }, error: null } as any);
    render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByText('Lidarr options unavailable; retry'); expect(screen.getByRole('button', { name: 'Retry options' })).toBeEnabled(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(['scope', 'actor'])('revokes original action ownership across %s A to B to A transitions', async change => {
    let finish!: (value: unknown) => void; mocks.execute.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<Harness />); await open(); fireEvent.click(screen.getByRole('button', { name: 'Confirm add' }));
    await waitFor(() => expect(mocks.current).toBeTypeOf('function')); const originalCurrent = mocks.current!;
    if (change === 'actor') mocks.actor = 2; view.rerender(<Harness scope={change === 'scope' ? 'B' : 'A'} />);
    mocks.actor = 1; view.rerender(<Harness scope="A" />);
    expect(originalCurrent()).toBe(false); await act(async () => finish(true)); expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('aborts pending option reads on scope replacement', async () => {
    let signal!: AbortSignal;
    vi.mocked(api.get).mockImplementation((_path, request) => { signal = request!.signal!; return new Promise(() => {}); });
    const view = render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'Start' })); await waitFor(() => expect(signal).toBeDefined());
    view.rerender(<Harness scope="B" />); expect(signal.aborted).toBe(true); expect(mocks.execute).not.toHaveBeenCalled();
  });
});
