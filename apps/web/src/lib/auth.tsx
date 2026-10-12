'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient, type QueryFunctionContext } from '@tanstack/react-query';

interface User {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
}

interface AuthResponse {
  user: User | null;
  setupRequired: boolean;
  apiError?: boolean; // True when API is unreachable
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  setupRequired: boolean;
  apiError: boolean; // True when API is unreachable - don't redirect
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refetchAuth: () => void;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function safeReturnTo(value: string | null): string {
  if (!value?.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return '/';
  const target = new URL(value, 'https://mixarr.invalid');
  return target.origin === 'https://mixarr.invalid' ? `${target.pathname}${target.search}${target.hash}` : '/';
}

export function useAuth() {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Auth query function - can be used outside of React components
async function fetchAuthStatus({ signal }: QueryFunctionContext): Promise<AuthResponse> {
  const res = await fetch('/api/auth/me', {
    credentials: 'include',
    signal,
  });
  
  if (!res.ok) {
    // On error (e.g., API not ready), signal that we don't know the state
    // The UI should keep retrying rather than redirecting
    return { user: null, setupRequired: false, apiError: true };
  }
  
  return res.json();
}

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [shouldPoll, setShouldPoll] = React.useState(false);

  // Use React Query for auth state - cached for 5 minutes
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['auth'],
    queryFn: fetchAuthStatus,
    staleTime: 5 * 60 * 1000, // Auth is fresh for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    refetchOnWindowFocus: true, // Do check auth on window focus
    retry: 3, // Retry up to 3 times on failure
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000), // Exponential backoff
    refetchInterval: shouldPoll ? 2000 : false, // Keep polling if API is down
  });

  const [cacheActor, setCacheActor] = React.useState<number | null | undefined>(() =>
    data && !data.apiError ? data.user?.id ?? null : undefined);
  const actor = data && !data.apiError ? data.user?.id ?? null : cacheActor;
  const protectedQueries = { predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[0] !== 'auth' };

  // Hold consumers during session changes so old data cannot paint or refill a new session.
  React.useEffect(() => {
    if (actor === cacheActor) return;
    let current = true;
    void queryClient.cancelQueries({ predicate: query => query.queryKey[0] !== 'auth' }).then(() => {
      if (!current) return;
      queryClient.removeQueries({ predicate: query => query.queryKey[0] !== 'auth' });
      setCacheActor(actor);
    });
    return () => { current = false; };
  }, [actor, cacheActor, queryClient]);

  // Update polling state based on API error
  React.useEffect(() => {
    setShouldPoll(data?.apiError ?? false);
  }, [data?.apiError]);

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        credentials: 'include',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Login failed');
      }

      return res.json();
    },
    onSuccess: async (data) => {
      await queryClient.cancelQueries({ queryKey: ['auth'], exact: true });
      await queryClient.cancelQueries(protectedQueries);
      queryClient.removeQueries(protectedQueries);
      setCacheActor(data.user?.id ?? null);
      // Publish the authenticated actor only after protected reads have been removed.
      queryClient.setQueryData(['auth'], { 
        user: data.user, 
        setupRequired: data.setupRequired ?? false 
      });
    },
  });

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Logout failed');
    },
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: ['auth'], exact: true });
      await queryClient.cancelQueries(protectedQueries);
      queryClient.removeQueries(protectedQueries);
      setCacheActor(null);
      // Publish the logged-out actor after cancelling and removing protected reads.
      queryClient.setQueryData(['auth'], { user: null, setupRequired: false });
      router.push('/login');
    },
  });

  const login = React.useCallback(
    async (username: string, password: string) => {
      await loginMutation.mutateAsync({ username, password });
    },
    [loginMutation]
  );

  const logout = React.useCallback(async () => {
    await logoutMutation.mutateAsync();
  }, [logoutMutation]);

  const refetchAuth = React.useCallback(() => {
    refetch();
  }, [refetch]);

  return (
    <AuthContext.Provider
      value={{
        user: data?.user ?? null,
        isLoading,
        isAuthenticated: !!data?.user,
        setupRequired: data?.setupRequired ?? false,
        apiError: data?.apiError ?? false,
        login,
        logout,
        refetchAuth,
      }}
    >
      {/* Reset consumer state and detach old notification closures when the verified actor changes. */}
      {cacheActor === actor ? <React.Fragment key={String(cacheActor)}>{children}</React.Fragment> : null}
    </AuthContext.Provider>
  );
}

// Export query keys for use in other components
export const authQueryKey = ['auth'];
