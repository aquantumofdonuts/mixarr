import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import NotificationsPage from '../page';
import { UnsavedChangesProvider } from '@/hooks/useUnsavedChanges';
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), addToast: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { get: mocks.get, post: mocks.post, put: mocks.put } }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ addToast: mocks.addToast }) }));
let channels: unknown, events: unknown;
beforeEach(() => { channels = []; events = ['job.completed']; mocks.get.mockReset(); mocks.post.mockReset(); mocks.put.mockReset(); mocks.addToast.mockReset(); mocks.get.mockImplementation(async (path: string) => ({ data: path.endsWith('/channels') ? channels : events, error: null })); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const mount = () => render(<UnsavedChangesProvider><NotificationsPage /></UnsavedChangesProvider>);
it.each([['channels', null], ['channels', {}], ['channels', [null]], ['channels', [{ id: 1, type: { toString: 1 }, name: 'malformed', config: {}, events: [], isActive: true }]], ['events', null], ['events', {}], ['events', [42]]])('reports malformed/missing %s response %# without claiming an empty loaded editor', async (scope, data) => {
  if (scope === 'channels') channels = data; else events = data;
  mount(); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(`Failed to load ${scope}: invalid response.`));
  expect(screen.getByRole('button', { name: 'Add Channel' })).toBeDisabled(); if (scope === 'channels') expect(screen.queryByText('No Notification Channels')).toBeNull();
});
it('accepts an empty channel list and opens a clean new-channel draft', async () => {
  mount(); await screen.findByText('No Notification Channels'); fireEvent.click(screen.getByRole('button', { name: 'Add Channel' }));
  expect(screen.getByText('Channel draft unchanged')).toBeVisible(); expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(''); expect(screen.getByRole('checkbox', { name: 'job.completed' })).toBeVisible();
});
it('retries a read failure without automatically writing a channel', async () => {
  channels = null; mount(); await screen.findByRole('alert'); channels = []; fireEvent.click(screen.getByRole('button', { name: 'Retry loading channels' }));
  await screen.findByText('No Notification Channels'); expect(mocks.post).not.toHaveBeenCalled();
});
it('locks native notification controls while create is pending and restores the dirty draft after failure', async () => {
  let release!: (value: { data: unknown; error: string }) => void;
  mocks.post.mockReturnValue(new Promise(resolve => { release = resolve; }));
  mount(); await screen.findByText('No Notification Channels'); fireEvent.click(screen.getByRole('button', { name: 'Add Channel' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'pending draft' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Webhook URL' }), { target: { value: 'https://hook.example' } }); fireEvent.click(screen.getByRole('checkbox', { name: 'job.completed' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create Channel' }));
  expect(screen.getByRole('textbox', { name: 'Name' })).toBeDisabled(); expect(screen.getByRole('combobox', { name: 'Channel Type' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: 'job.completed' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await act(async () => release({ data: null, error: 'Channel temporarily unavailable' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Channel temporarily unavailable'); expect(screen.getByRole('textbox', { name: 'Name' })).toBeEnabled();
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('pending draft'); expect(screen.getByRole('textbox', { name: 'Webhook URL' })).toHaveValue('https://hook.example');
  const unload = new Event('beforeunload', { cancelable: true }); act(() => window.dispatchEvent(unload)); expect(unload.defaultPrevented).toBe(true);
});

const maskedChannel = { id: 101, type: 'webhook', name: 'Stored webhook', config: { url: 'https://hook.example', method: 'POST', headers: '••••••••' }, events: ['job.completed'], isActive: true, createdAt: '2026-10-09T00:00:00Z' };
async function editMaskedChannel() {
  channels = [maskedChannel]; mount(); await screen.findByText('Stored webhook');
  const card = screen.getByText('Stored webhook').closest('.rounded-card')!;
  fireEvent.click(within(card as HTMLElement).getAllByRole('button')[1]);
}
it('renames a masked webhook using the unchanged header sentinel without exposing credentials', async () => {
  mocks.put.mockResolvedValue({ data: maskedChannel, error: null }); await editMaskedChannel();
  expect(screen.getByRole('textbox', { name: 'Headers (JSON, optional)' })).toHaveValue('••••••••');
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Renamed hook' } }); fireEvent.click(screen.getByRole('button', { name: 'Save channel changes' }));
  await waitFor(() => expect(mocks.put).toHaveBeenCalledWith('/api/notifications/channels/101', expect.objectContaining({ name: 'Renamed hook', config: { url: 'https://hook.example', method: 'POST', headers: '••••••••' } })));
});
it('replaces masked headers with an explicitly edited JSON object', async () => {
  mocks.put.mockResolvedValue({ data: maskedChannel, error: null }); await editMaskedChannel();
  fireEvent.change(screen.getByRole('textbox', { name: 'Headers (JSON, optional)' }), { target: { value: '{"X-Fixture":"replacement"}' } }); fireEvent.click(screen.getByRole('button', { name: 'Save channel changes' }));
  await waitFor(() => expect(mocks.put).toHaveBeenCalledWith('/api/notifications/channels/101', expect.objectContaining({ config: { url: 'https://hook.example', method: 'POST', headers: { 'X-Fixture': 'replacement' } } })));
});
it('refuses edited invalid headers on a masked channel and focuses the field', async () => {
  await editMaskedChannel(); fireEvent.change(screen.getByRole('textbox', { name: 'Headers (JSON, optional)' }), { target: { value: '"arbitrary string"' } }); fireEvent.click(screen.getByRole('button', { name: 'Save channel changes' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Headers must be a JSON object with string values.'); expect(screen.getByRole('textbox', { name: 'Headers (JSON, optional)' })).toHaveFocus(); expect(mocks.put).not.toHaveBeenCalled();
});
it('refuses a new-channel header sentinel instead of treating it as an existing credential', async () => {
  mount(); await screen.findByText('No Notification Channels'); fireEvent.click(screen.getByRole('button', { name: 'Add Channel' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Channel Type' }), { target: { value: 'webhook' } }); fireEvent.change(screen.getByRole('textbox', { name: 'URL' }), { target: { value: 'https://hook.example' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Headers (JSON, optional)' }), { target: { value: '••••••••' } }); fireEvent.click(screen.getByRole('button', { name: 'Create Channel' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Headers must be a JSON object with string values.'); expect(screen.getByRole('textbox', { name: 'Headers (JSON, optional)' })).toHaveFocus(); expect(mocks.post).not.toHaveBeenCalled();
});
