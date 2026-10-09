import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '../page';
import { UnsavedChangesProvider } from '@/hooks/useUnsavedChanges';

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), addToast: vi.fn(), router: { replace: vi.fn() } }));
vi.mock('@/lib/api', () => ({ api: { get: mocks.get, put: mocks.put } }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 7, role: 'admin' }, isLoading: false }) }));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { version: '2.3.5' } }) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ addToast: mocks.addToast }) }));
vi.mock('@/components/settings/constellation-settings', () => ({ ConstellationSettings: () => null }));
vi.mock('@/components/settings/sso-settings', () => ({ SSOSettings: () => null }));

const aiDefaults = { openaiEnabled: false, openaiConfigured: false, anthropicEnabled: false, anthropicConfigured: false, openaiBaseUrl: null, openaiModel: null };
let responses: Map<string, unknown>;
const mount = () => render(<UnsavedChangesProvider><SettingsPage /></UnsavedChangesProvider>);
beforeEach(() => {
  responses = new Map([['/api/settings', { settings: {} }], ['/api/settings/global', { settings: {} }], ['/api/ai/settings', { settings: aiDefaults }]]);
  mocks.get.mockReset(); mocks.put.mockReset(); mocks.addToast.mockReset();
  mocks.get.mockImplementation(async (path: string) => ({ data: responses.get(path), error: null }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const scopes = [
  ['/api/settings', 'personal', 'Save personal settings', 'Personal settings saved'],
  ['/api/settings/global', 'global', 'Save Global Settings', 'Global settings saved'],
  ['/api/ai/settings', 'AI', 'Save AI settings', 'AI settings saved'],
] as const;
for (const [path, scope, save, saved] of scopes) {
  describe(`${scope} settings response boundary`, () => {
    it.each([
      ['missing body', null], ['missing settings field', {}], ['array settings', { settings: [] }], ['primitive settings', { settings: 'invalid' }],
    ])('reports %s as a load failure without a saved baseline', async (_name, data) => {
      responses.set(path, data); mount();
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(`Failed to load ${scope} settings: invalid response.`);
      expect(alert).toBeVisible(); expect(screen.queryByText(saved, { exact: true })).toBeNull();
      expect(screen.getByRole('button', { name: save })).toBeDisabled(); expect(mocks.put).not.toHaveBeenCalled();
    });
  });
}
it.each([
  ['/api/settings', 'personal', { settings: { maxConcurrentJobs: 'four' } }],
  ['/api/settings/global', 'global', { settings: { baseUrl: 42 } }],
  ['/api/ai/settings', 'AI', { settings: { ...aiDefaults, openaiEnabled: 'false' } }],
])('rejects malformed known values from %s', async (path, scope, data) => {
  responses.set(path, data); mount(); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(`Failed to load ${scope} settings: invalid response.`));
});
it('accepts successful empty personal/global records and the AI route nullable defaults', async () => {
  mount(); await screen.findByText('Personal settings saved', { exact: true });
  expect(screen.getByText('Global settings saved', { exact: true })).toBeVisible(); expect(await screen.findByText('AI settings saved', { exact: true })).toBeVisible();
  expect(screen.getByLabelText('Max Concurrent Jobs', { exact: true })).toHaveValue(3); expect(screen.getByLabelText('Base URL', { exact: true })).toHaveValue('');
  expect(screen.getByLabelText('Base URL (Optional)')).toHaveValue(''); expect(screen.getByLabelText('Model (Optional)')).toHaveValue('');
});
it('an invalid AI read leaves another section draft intact and protected', async () => {
  responses.set('/api/ai/settings', { settings: [] }); mount(); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to load AI settings: invalid response.'));
  fireEvent.change(screen.getByLabelText('Max Concurrent Jobs', { exact: true }), { target: { value: '7' } });
  expect(screen.getByText('Unsaved personal settings changes')).toBeVisible(); expect(screen.getByLabelText('Max Concurrent Jobs', { exact: true })).toHaveValue(7);
  const unload = new Event('beforeunload', { cancelable: true }); act(() => window.dispatchEvent(unload)); expect(unload.defaultPrevented).toBe(true);
});
it('ignores a retired read when a fresh mounted settings document has loaded its baseline', async () => {
  let release!: (result: { data: unknown; error: null }) => void;
  const pending = new Promise<{ data: unknown; error: null }>(resolve => { release = resolve; });
  mocks.get.mockImplementation((path: string) => path === '/api/settings' ? pending : Promise.resolve({ data: responses.get(path), error: null }));
  const first = mount(); first.unmount();
  mocks.get.mockImplementation(async (path: string) => ({ data: responses.get(path), error: null }));
  mount(); await screen.findByText('Personal settings saved', { exact: true });
  await act(async () => release({ data: { settings: { maxConcurrentJobs: 99 } }, error: null }));
  await waitFor(() => expect(screen.getByLabelText('Max Concurrent Jobs', { exact: true })).toHaveValue(3)); expect(mocks.addToast).not.toHaveBeenCalled();
});
it('accepts nullable known defaults returned by the existing settings contracts', async () => {
  responses.set('/api/settings', { settings: { defaultResultHandling: null, maxConcurrentJobs: null, notifyOnComplete: null, notifyOnError: null } });
  responses.set('/api/settings/global', { settings: { baseUrl: null } });
  responses.set('/api/ai/settings', { settings: { ...aiDefaults, openaiApiKey: null, anthropicApiKey: null } });
  mount(); await screen.findByText('Personal settings saved', { exact: true });
  expect(screen.getByText('Global settings saved', { exact: true })).toBeVisible(); expect(await screen.findByText('AI settings saved', { exact: true })).toBeVisible();
  expect(screen.getByLabelText('Max Concurrent Jobs', { exact: true })).toHaveValue(3); expect(screen.getByLabelText('Base URL', { exact: true })).toHaveValue('');
});
it.each([{ settings: {} }, { settings: { ...aiDefaults, openaiModel: 3 } }])('rejects missing AI flags or malformed optional fields', async data => {
  responses.set('/api/ai/settings', data); mount(); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to load AI settings: invalid response.'));
});
