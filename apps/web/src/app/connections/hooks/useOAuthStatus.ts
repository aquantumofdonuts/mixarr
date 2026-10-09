'use client';

import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type OAuthType = 'spotify' | 'deezer' | 'tidal';
export interface OAuthStatus { authorized: boolean; expired: boolean; needsReauthorization: boolean; }
export const oauthQueryKeys = {
  status: (type: OAuthType, connectionId: number, actor?: string) =>
    ['connections', connectionId, type, 'oauth-status', actor] as const,
};

export function useOAuthStatus(type: OAuthType, connectionId: number | null) {
  const queryClient = useQueryClient();
  const actor = () => {
    const user = queryClient.getQueryData<{ user?: { id: number; role: string } }>(['auth'])?.user;
    return `${user?.id}:${user?.role}`;
  };
  const owner = actor();
  const lifetime = useRef({ active: true, controller: new AbortController() });
  useEffect(() => {
    const current = { active: true, controller: new AbortController() };
    lifetime.current = current;
    return () => { current.active = false; current.controller.abort(); };
  }, [type, connectionId, owner]);
  const key = oauthQueryKeys.status(type, connectionId ?? 0, owner);
  const statusQuery = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.get<OAuthStatus>(`/api/connections/${connectionId}/${type}/status`, { signal });
      if (error) throw new Error(error);
      if (!data || typeof data.authorized !== 'boolean' || typeof data.needsReauthorization !== 'boolean' ||
          !(typeof data.expired === 'boolean' || (type === 'deezer' && data.expired === undefined))) {
        throw new Error('Invalid authorization status response');
      }
      // ponytail: Deezer's actual status response has no expiry field.
      return { ...data, expired: data.expired ?? false };
    },
    enabled: connectionId !== null,
    retry: false,
  });
  const authorizeMutation = useMutation({
    retry: false,
    mutationFn: async () => {
      const current = lifetime.current, actionOwner = actor();
      if (connectionId === null) throw new Error('No connection ID');
      const { data, error } = await api.get<{ authUrl: string }>(`/api/connections/${connectionId}/${type}/auth`, { signal: current.controller.signal });
      if (!current.active || actionOwner !== actor()) return;
      if (error || !data?.authUrl) throw new Error(error || 'Failed to get authorization URL');
      const url = new URL(data.authUrl);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Invalid authorization URL');
      window.location.href = url.href;
    },
  });
  const revokeMutation = useMutation({
    retry: false,
    mutationFn: async () => {
      const current = lifetime.current, actionOwner = actor();
      if (connectionId === null) throw new Error('No connection ID');
      const { error } = await api.post(`/api/connections/${connectionId}/${type}/revoke`, undefined, { signal: current.controller.signal });
      if (!current.active || actionOwner !== actor()) return;
      if (error) throw new Error(error);
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });
  useEffect(() => {
    authorizeMutation.reset();
    revokeMutation.reset();
    // Retire the observer as well as its request when the target/actor changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, connectionId, owner]);
  const error = statusQuery.error || authorizeMutation.error || revokeMutation.error || null;
  return {
    status: statusQuery.isError ? null : statusQuery.data ?? null,
    error,
    authorize: () => authorizeMutation.mutate(),
    revoke: () => revokeMutation.mutate(),
    retry: () => {
      if (statusQuery.error) void statusQuery.refetch();
      else if (authorizeMutation.error) authorizeMutation.mutate();
      else if (revokeMutation.error) revokeMutation.mutate();
      else void statusQuery.refetch();
    },
    isChecking: statusQuery.isFetching,
    isLoading: authorizeMutation.isPending || revokeMutation.isPending,
  };
}
