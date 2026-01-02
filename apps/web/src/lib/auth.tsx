'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

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

export function useAuth() {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Auth query function - can be used outside of React components
async function fetchAuthStatus(): Promise<AuthResponse> {
  const res = await fetch('/api/auth/me', {
    credentials: 'include',
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
    onSuccess: (data) => {
      // Update auth cache immediately
      queryClient.setQueryData(['auth'], { 
        user: data.user, 
        setupRequired: false 
      });
    },
  });

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: async () => {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    },
    onSuccess: () => {
      // Clear auth cache and all other cached data
      queryClient.setQueryData(['auth'], { user: null, setupRequired: false });
      queryClient.invalidateQueries(); // Invalidate all queries on logout
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
      {children}
    </AuthContext.Provider>
  );
}

// Export query keys for use in other components
export const authQueryKey = ['auth'];
