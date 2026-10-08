import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../auth';
import { ToastProvider, useToast } from '@/components/ui/toast';
import { useArtistAdd } from '@/app/search/hooks/useArtistAdd';
import { api } from '../api';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
const user = (id: number) => ({ id, username: `User ${id}`, displayName: `User ${id}`, role: 'user' });
const auth = (id: number | null) => ({ user: id === null ? null : user(id), setupRequired: false });
let client: QueryClient;
let finishAdd: (value: any) => void;

function Consumer() {
  const { user: actor, login, logout } = useAuth();
  const { addToast } = useToast();
  const { handleAddArtist } = useArtistAdd(() => {});
  return <>
    <p>Actor {actor?.id ?? 'anonymous'}</p>
    <button onClick={() => addToast({ type: 'info', title: 'Actor 1 private notification', duration: 0 })}>Notify</button>
    <button onClick={() => void handleAddArtist({ foreignArtistId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', artistName: 'Actor 1 private artist' })}>Start add</button>
    <button onClick={() => void login('next-user', 'fixture-value')}>Switch actor</button>
    <button onClick={() => void logout()}>Logout</button>
  </>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(['auth'], auth(1));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(auth(2)), { headers: { 'Content-Type': 'application/json' } })));
  vi.spyOn(api, 'post').mockImplementation(() => new Promise(resolve => { finishAdd = resolve; }));
  render(<QueryClientProvider client={client}><AuthProvider><ToastProvider><Consumer /></ToastProvider></AuthProvider></QueryClientProvider>);
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('authenticated consumer notification boundary', () => {
  it.each([['Logout', 'Actor anonymous'], ['Switch actor', 'Actor 2']])('clears existing notifications on %s', async (action, nextActor) => {
    fireEvent.click(screen.getByRole('button', { name: 'Notify' }));
    expect(screen.getByText('Actor 1 private notification')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: action }));
    await waitFor(() => expect(screen.getByText(nextActor)).toBeInTheDocument());
    expect(screen.queryByText('Actor 1 private notification')).not.toBeInTheDocument();
  });

  it.each([['Logout', 'Actor anonymous'], ['Switch actor', 'Actor 2']])('ignores an original actor add response after %s', async (action, nextActor) => {
    fireEvent.click(screen.getByRole('button', { name: 'Start add' }));
    fireEvent.click(screen.getByRole('button', { name: action }));
    await waitFor(() => expect(screen.getByText(nextActor)).toBeInTheDocument());
    await act(async () => finishAdd({ data: { success: true }, error: null }));
    expect(screen.queryByText('Actor 1 private artist added to Lidarr')).not.toBeInTheDocument();
    expect(screen.queryByText('Artist added')).not.toBeInTheDocument();
  });
});
