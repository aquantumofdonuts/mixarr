import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConstellationSettings } from '../constellation-settings';
import { useConstellationSettings, useConstellationUsage } from '@/lib/hooks';
import { UnsavedChangesProvider } from '@/hooks/useUnsavedChanges';
const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), user: { id: 7, role: 'admin' } as { id: number; role: string } | null }));
vi.mock('@/lib/api', () => ({ api: { get: mocks.get, put: mocks.put }, endpoints: {} }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: mocks.user }) }));
const defaults = { constellationIndexEnabled: false, constellationIndexPath: '/data/constellation/index.db', orbitEdgeBudget: 250000, dailyApiBudget: 5000, fanoutN: 8, pathMaxDegrees: 6, indexRefresh: 'monthly' };
let client: QueryClient;
const key = ['settings', 'constellation', 7, 'admin'];
const mount = () => render(<QueryClientProvider client={client}><UnsavedChangesProvider><ConstellationSettings /></UnsavedChangesProvider></QueryClientProvider>);
const edit = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name, { exact: true }), { target: { value } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save constellation settings' }));
beforeEach(() => {
  mocks.user = { id: 7, role: 'admin' }; mocks.get.mockReset(); mocks.put.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: 2 }, mutations: { retry: 2 } } });
  client.setQueryData(['auth'], { user: mocks.user });
  mocks.get.mockImplementation(async (path: string) => ({ data: path.endsWith('/usage') ? { day: '2026-10-09', used: 17, limit: 5000 } : { settings: defaults }, error: null }));
  mocks.put.mockImplementation(async (_path: string, changes: object) => ({ data: { success: true, settings: { ...defaults, ...changes } }, error: null }));
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); });

describe('Constellation settings', () => {
  it('renders all seven stored fields, exact usage, UTC reset and honest refresh/cost text', async () => {
    mount(); await screen.findByLabelText('Index path');
    expect(screen.getByLabelText('Index path')).toHaveValue(defaults.constellationIndexPath);
    expect(screen.getByLabelText('Orbit edge budget')).toHaveValue(250000); expect(screen.getByLabelText('Daily API budget')).toHaveValue(5000);
    expect(screen.getByLabelText('Fan-out')).toHaveValue(8); expect(screen.getByLabelText('Path max degrees')).toHaveValue(6);
    expect(screen.getByLabelText('Index refresh preference')).toHaveValue('monthly'); expect(screen.getByLabelText('Local credit index')).not.toBeChecked();
    expect(await screen.findByText('17 / 5000')).toBeVisible(); expect(screen.getByText('00:00 UTC')).toBeVisible();
    expect(screen.getByText(/~100GB\+ uncompressed/)).toBeVisible(); expect(screen.getByText(/Automatic index refresh is unavailable/)).toBeVisible();
    expect(screen.queryByText('Constellation settings saved')).toBeNull();
  });
  it('saves only changed keys to its own endpoint', async () => {
    mount(); await screen.findByLabelText('Daily API budget'); edit('Daily API budget', '2000'); save();
    await screen.findByText('Constellation settings saved');
    expect(mocks.put).toHaveBeenCalledTimes(1); expect(mocks.put).toHaveBeenCalledWith('/api/settings/constellation', { dailyApiBudget: 2000 }, { signal: expect.any(AbortSignal) });
  });
  it.each(['0', '-1', '1.5', ''])('rejects nonpositive/noninteger/empty budget %s before HTTP and focuses first invalid field', async value => {
    mount(); await screen.findByLabelText('Orbit edge budget'); edit('Orbit edge budget', value); edit('Daily API budget', '0'); save();
    expect(screen.getByRole('alert')).toHaveTextContent('Orbit edge budget must be a positive integer.'); expect(screen.getByLabelText('Orbit edge budget')).toHaveFocus(); expect(mocks.put).not.toHaveBeenCalled();
  });
  it('rejects an empty index path first', async () => {
    mount(); await screen.findByLabelText('Index path'); edit('Index path', ''); edit('Fan-out', '0'); save();
    expect(screen.getByRole('alert')).toHaveTextContent('Index path must not be empty.'); expect(screen.getByLabelText('Index path')).toHaveFocus(); expect(mocks.put).not.toHaveBeenCalled();
  });
  it('preserves server validation errors and drafts with no automatic write retries', async () => {
    mocks.put.mockResolvedValue({ data: null, error: 'Validation failed: dailyApiBudget' });
    mount(); await screen.findByLabelText('Daily API budget'); edit('Daily API budget', '2'); save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Validation failed: dailyApiBudget'); expect(mocks.put).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Daily API budget')).toHaveValue(2); expect(screen.getByRole('button', { name: 'Save constellation settings' })).toBeEnabled();
  });
  it.each([null, {}, { success: true, settings: {} }])('does not accept malformed save confirmation %s', async data => {
    mocks.put.mockResolvedValue({ data, error: null }); mount(); await screen.findByLabelText('Fan-out'); edit('Fan-out', '3'); save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid save response'); expect(screen.queryByText('Constellation settings saved')).toBeNull(); expect(screen.getByLabelText('Fan-out')).toHaveValue(3); expect(mocks.put).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}, { settings: {} }, { settings: { ...defaults, dailyApiBudget: 0 } }])('rejects missing or malformed load %s and permits explicit Retry', async data => {
    mocks.get.mockImplementation(async (path: string) => ({ data: path.endsWith('/usage') ? { day: '2026-10-09', used: 1, limit: 3 } : data, error: null }));
    mount(); expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load constellation settings: invalid response.');
    expect(screen.queryByText('Constellation settings saved')).toBeNull(); expect(screen.getByRole('button', { name: 'Save constellation settings' })).toBeDisabled();
    mocks.get.mockImplementation(async () => ({ data: { settings: defaults }, error: null })); fireEvent.click(screen.getByRole('button', { name: 'Retry loading constellation settings' })); await screen.findByLabelText('Index path');
  });
  it.each([null, {}, { day: '2026-10-09', used: -1, limit: 3 }, { day: '2026-02-30', used: 1, limit: 3 }])('does not invent usage from malformed read %s', async data => {
    mocks.get.mockImplementation(async (path: string) => ({ data: path.endsWith('/usage') ? data : { settings: defaults }, error: null }));
    mount(); expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load constellation usage: invalid response.'); expect(screen.queryByText(/0 \/ /)).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry loading constellation usage' })).toBeVisible();
  });
  it('keeps dirty drafts and their navigation guard through refetch and errors', async () => {
    mount(); await screen.findByLabelText('Fan-out'); edit('Fan-out', '5');
    await act(async () => client.setQueryData(key, { ...defaults, fanoutN: 20 }));
    expect(screen.getByLabelText('Fan-out')).toHaveValue(5);
    mocks.get.mockResolvedValue({ error: 'Read unavailable', data: null }); await act(async () => client.invalidateQueries({ queryKey: key }));
    expect(screen.getByLabelText('Fan-out')).toHaveValue(5); const unload = new Event('beforeunload', { cancelable: true }); act(() => window.dispatchEvent(unload)); expect(unload.defaultPrevented).toBe(true);
  });
  it('retains edits made during a pending save against the submitted baseline', async () => {
    let release!: (value: unknown) => void; mocks.put.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    mount(); await screen.findByLabelText('Fan-out'); edit('Fan-out', '4'); save(); await waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(1)); edit('Fan-out', '5');
    await act(async () => release({ data: { success: true, settings: { ...defaults, fanoutN: 4 } }, error: null }));
    expect(screen.getByLabelText('Fan-out')).toHaveValue(5); expect(screen.getByText('Unsaved constellation settings changes')).toBeVisible(); save();
    await waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(2)); expect(mocks.put).toHaveBeenLastCalledWith('/api/settings/constellation', { fanoutN: 5 }, { signal: expect.any(AbortSignal) });
  });
  it('aborts a retired mutation and cannot refill another actor cache', async () => {
    let release!: (value: unknown) => void; mocks.put.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const view = mount(); await screen.findByLabelText('Fan-out'); edit('Fan-out', '4'); save(); await waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(1));
    const signal = mocks.put.mock.calls[0][2].signal as AbortSignal;
    mocks.user = { id: 8, role: 'admin' }; client.setQueryData(['auth'], { user: mocks.user }); view.rerender(<QueryClientProvider client={client}><UnsavedChangesProvider><ConstellationSettings /></UnsavedChangesProvider></QueryClientProvider>);
    expect(signal.aborted).toBe(true); await screen.findByLabelText('Fan-out');
    await act(async () => release({ data: { success: true, settings: { ...defaults, fanoutN: 4 } }, error: null }));
    expect(screen.getByLabelText('Fan-out')).toHaveValue(8); expect(screen.queryByText('Constellation settings saved')).toBeNull(); expect(client.getQueryData(['settings', 'constellation', 8, 'admin'])).toEqual(defaults);
  });
  it('hides for non-admins without fetching; both hooks independently disable their queries', async () => {
    mocks.user = { id: 9, role: 'user' };
    function Queries() { useConstellationSettings(); useConstellationUsage(); return <ConstellationSettings />; }
    render(<QueryClientProvider client={client}><Queries /></QueryClientProvider>);
    await act(async () => {}); expect(screen.queryByRole('region', { name: 'Constellation settings' })).toBeNull(); expect(mocks.get).not.toHaveBeenCalled();
  });
});
