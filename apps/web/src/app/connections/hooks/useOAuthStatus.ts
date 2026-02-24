'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type OAuthType = 'spotify' | 'deezer' | 'tidal';

export interface OAuthStatus {
  authorized: boolean;
  expired: boolean;
  needsReauthorization: boolean;
}

export const oauthQueryKeys = {
  status: (type: OAuthType, connectionId: number) =>
    ['connections', connectionId, type, 'oauth-status'] as const,
};

/**
 * Consolidated OAuth status hook for Spotify, Deezer, and TIDAL connections.
 *
 * Fetches auth status when connectionId is provided, and exposes
 * `authorize()` / `revoke()` actions with loading state.
 */
export function useOAuthStatus(type: OAuthType, connectionId: number | null) {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: oauthQueryKeys.status(type, connectionId ?? 0),
    queryFn: async () => {
      const { data, error } = await api.get<OAuthStatus>(
        `/api/connections/${connectionId}/${type}/status`
      );
      if (error) throw new Error(error);
      return data!;
    },
    enabled: connectionId !== null,
  });

  const authorizeMutation = useMutation({
    mutationFn: async () => {
      if (connectionId === null) throw new Error('No connection ID');
      const { data, error } = await api.get<{ authUrl: string }>(
        `/api/connections/${connectionId}/${type}/auth`
      );
      if (!data?.authUrl) {
        throw new Error(error || 'Failed to get authorization URL');
      }
      window.location.href = data.authUrl;
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async () => {
      if (connectionId === null) throw new Error('No connection ID');
      const { error } = await api.post(
        `/api/connections/${connectionId}/${type}/revoke`
      );
      if (error) throw new Error(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: oauthQueryKeys.status(type, connectionId ?? 0),
      });
    },
  });

  return {
    status: statusQuery.data ?? null,
    error: statusQuery.error || authorizeMutation.error || revokeMutation.error || null,
    authorize: () => authorizeMutation.mutate(),
    revoke: () => revokeMutation.mutate(),
    isLoading: authorizeMutation.isPending || revokeMutation.isPending,
  };
}
