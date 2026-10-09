import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import NotificationsPage from '../page';
import { UnsavedChangesProvider } from '@/hooks/useUnsavedChanges';
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), addToast: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { get: mocks.get, post: mocks.post } }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ addToast: mocks.addToast }) }));
let channels: unknown, events: unknown;
beforeEach(() => { channels = []; events = ['job.completed']; mocks.get.mockReset(); mocks.post.mockReset(); mocks.addToast.mockReset(); mocks.get.mockImplementation(async (path: string) => ({ data: path.endsWith('/channels') ? channels : events, error: null })); });
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
it('retains edits made during save when the follow-up channel read fails', async () => {
  let release!: (value: { data: unknown; error: null }) => void; const pending = new Promise<{ data: unknown; error: null }>(resolve => { release = resolve; }); mocks.post.mockReturnValue(pending);
  mount(); await screen.findByText('No Notification Channels'); fireEvent.click(screen.getByRole('button', { name: 'Add Channel' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Webhook URL' }), { target: { value: 'https://hook.example' } }); fireEvent.click(screen.getByRole('checkbox', { name: 'job.completed' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create Channel' })); fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'later draft' } }); channels = null;
  await act(async () => release({ data: {}, error: null })); await screen.findByText('Failed to load channels: invalid response.');
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('later draft'); expect(screen.getByText('Unsaved channel changes')).toBeVisible();
});
