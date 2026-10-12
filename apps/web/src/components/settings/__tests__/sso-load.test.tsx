import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SSOSettings } from '../sso-settings';
import { UnsavedChangesProvider } from '@/hooks/useUnsavedChanges';
const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), addToast: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { get: mocks.get, put: mocks.put } }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ addToast: mocks.addToast }) }));
const google = { id: 1, type: 'google', name: 'Google', isEnabled: false, config: { clientId: 'known.apps.googleusercontent.com', clientSecret: '********', allowedDomains: ['example.com'] } };
let response: unknown;
beforeEach(() => { response = { providers: [] }; mocks.get.mockReset(); mocks.put.mockReset(); mocks.addToast.mockReset(); mocks.get.mockImplementation(async (path: string) => ({ data: path === '/api/sso/providers' ? response : { baseUrl: 'https://mixarr.example' }, error: null })); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const mount = () => render(<UnsavedChangesProvider><SSOSettings /></UnsavedChangesProvider>);
it.each([null, {}, { providers: {} }, { providers: [null] }, { providers: [{ ...google, isEnabled: 'true' }] }, { providers: [{ ...google, config: [] }] }])('rejects missing/malformed SSO response %# without claiming saved or crashing', async data => {
  response = data; mount(); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to load SSO providers: invalid response.'));
  expect(screen.queryByText('Loading...')).toBeNull(); expect(screen.queryByText('Provider settings saved')).toBeNull();
  fireEvent.click(screen.getByRole('heading', { name: 'Google' })); expect(screen.queryByText('Provider settings saved')).toBeNull(); expect(screen.getByRole('button', { name: 'Save Google settings' })).toBeDisabled();
});
it('accepts an empty provider list as a new provider draft baseline', async () => {
  mount(); await waitFor(() => expect(screen.queryByText('Loading...')).toBeNull()); fireEvent.click(screen.getByRole('button', { name: 'Configure Google' }));
  expect(screen.getByText('No saved provider configuration')).toBeVisible(); expect(screen.getByRole('textbox', { name: 'Client ID' })).toHaveValue(''); expect(screen.getByRole('button', { name: 'Save Google settings' })).toBeDisabled();
});
it('preserves masked secrets and legitimate array-valued Google domains when saving an unrelated draft field', async () => {
  response = { providers: [google] }; mocks.put.mockResolvedValue({ data: { provider: { ...google, isEnabled: true } }, error: null }); mount();
  await waitFor(() => expect(screen.queryByText('Loading...')).toBeNull()); fireEvent.click(screen.getByRole('button', { name: 'Configure Google' }));
  expect(screen.getByLabelText('Client Secret*')).toHaveValue('********'); expect(screen.getByLabelText('Allowed Domains')).toHaveValue('example.com');
  fireEvent.click(screen.getByRole('switch', { name: 'Enable Google' })); fireEvent.click(screen.getByRole('button', { name: 'Save Google settings' }));
  await waitFor(() => expect(mocks.put).toHaveBeenCalledWith('/api/sso/providers/google', { name: 'Google', config: google.config, isEnabled: true }));
  expect(await screen.findByText('Provider settings saved')).toBeVisible();
});
it('a malformed provider save keeps the submitted draft dirty and explicitly retryable', async () => {
  response = { providers: [google] }; mocks.put.mockResolvedValue({ data: {}, error: null }); mount(); await waitFor(() => expect(screen.queryByText('Loading...')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Configure Google' })); fireEvent.change(screen.getByRole('textbox', { name: 'Client ID' }), { target: { value: 'draft.apps.googleusercontent.com' } }); fireEvent.click(screen.getByRole('button', { name: 'Save Google settings' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid save response; retry or reload to confirm Google settings.'));
  expect(screen.getByRole('textbox', { name: 'Client ID' })).toHaveValue('draft.apps.googleusercontent.com'); expect(screen.getByRole('button', { name: 'Save Google settings' })).toBeEnabled(); expect(mocks.addToast).not.toHaveBeenCalled();
  const unload = new Event('beforeunload', { cancelable: true }); act(() => window.dispatchEvent(unload)); expect(unload.defaultPrevented).toBe(true);
});
it('retries a failed provider read explicitly and ignores a retired pending read', async () => {
  response = null; const first = mount(); await screen.findByRole('alert'); response = { providers: [google] }; fireEvent.click(screen.getByRole('button', { name: 'Retry loading SSO providers' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull()); first.unmount();
  let release!: (value: { data: unknown; error: null }) => void; const pending = new Promise<{ data: unknown; error: null }>(resolve => { release = resolve; }); mocks.get.mockImplementation(() => pending);
  const retired = mount(); retired.unmount(); await act(async () => release({ data: {}, error: null })); expect(mocks.addToast).not.toHaveBeenCalled();
});

it('serializes explicitly edited Google domains as an array without rewriting secrets', async () => {
  response = { providers: [google] }; mocks.put.mockResolvedValue({ data: { provider: google }, error: null }); mount();
  await waitFor(() => expect(screen.queryByText('Loading...')).toBeNull()); fireEvent.click(screen.getByRole('button', { name: 'Configure Google' }));
  fireEvent.change(screen.getByLabelText('Allowed Domains'), { target: { value: ' example.com, company.org, ' } }); fireEvent.click(screen.getByRole('button', { name: 'Save Google settings' }));
  await waitFor(() => expect(mocks.put).toHaveBeenCalledWith('/api/sso/providers/google', { name: 'Google', config: { ...google.config, allowedDomains: ['example.com', 'company.org'] }, isEnabled: false }));
  expect(await screen.findByText('Provider settings saved')).toBeVisible();
});
it('preserves an untouched LDAP TLS boolean and masked password when saving another field', async () => {
  const ldap = { id: 2, type: 'ldap', name: 'LDAP', isEnabled: false, config: { serverUrl: 'ldaps://directory.example', bindDn: 'cn=admin', bindPassword: '********', searchBaseDn: 'dc=example', searchFilter: '(uid={{username}})', emailAttribute: 'mail', displayNameAttribute: 'cn', useTls: true } };
  response = { providers: [ldap] }; mocks.put.mockResolvedValue({ data: { provider: { ...ldap, isEnabled: true } }, error: null }); mount();
  await waitFor(() => expect(screen.queryByText('Loading...')).toBeNull()); fireEvent.click(screen.getByRole('button', { name: 'Configure LDAP' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Enable LDAP' })); fireEvent.click(screen.getByRole('button', { name: 'Save LDAP settings' }));
  await waitFor(() => expect(mocks.put).toHaveBeenCalledWith('/api/sso/providers/ldap', { name: 'LDAP', config: ldap.config, isEnabled: true }));
  expect(await screen.findByText('Provider settings saved')).toBeVisible();
});

it('preserves an untouched legacy Google domains string when saving only enabled state', async () => {
  const legacy = { ...google, config: { ...google.config, allowedDomains: 'example.com,company.org' } };
  response = { providers: [legacy] }; mocks.put.mockResolvedValue({ data: { provider: { ...legacy, isEnabled: true } }, error: null }); mount();
  await waitFor(() => expect(screen.queryByText('Loading...')).toBeNull()); fireEvent.click(screen.getByRole('button', { name: 'Configure Google' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Enable Google' })); fireEvent.click(screen.getByRole('button', { name: 'Save Google settings' }));
  await waitFor(() => expect(mocks.put).toHaveBeenCalledWith('/api/sso/providers/google', { name: 'Google', config: legacy.config, isEnabled: true }));
});
