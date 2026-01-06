'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

// Query Keys - Centralized for cache invalidation

export const queryKeys = {
  // Auth
  auth: ['auth'] as const,
  
  // Dashboard
  dashboardStats: ['dashboard', 'stats'] as const,
  dashboardActivity: ['dashboard', 'activity'] as const,
  dashboardConnections: ['dashboard', 'connections'] as const,
  
  // Subscriptions
  subscriptions: ['subscriptions'] as const,
  subscription: (id: number) => ['subscriptions', id] as const,
  subscriptionHistory: (id: number) => ['subscriptions', id, 'history'] as const,
  presets: ['subscriptions', 'presets'] as const,
  
  // Connections
  connections: ['connections'] as const,
  connection: (id: number) => ['connections', id] as const,
  hasLidarr: ['connections', 'hasLidarr'] as const,
  
  // Queue / Review
  reviewQueue: (status: string, itemType?: string) => ['review', 'queue', status, itemType] as const,
  
  // Jobs
  jobs: ['jobs'] as const,
  
  // Logs
  logs: (params: Record<string, string>) => ['logs', params] as const,
  
  // Users
  users: ['users'] as const,
  
  // Discover
  library: (params: Record<string, string | number>) => ['discover', 'library', params] as const,
  profiles: ['discover', 'profiles'] as const,
  recommendations: (artistIds: string[]) => ['discover', 'recommendations', artistIds] as const,
  
  // Search
  searchArtists: (query: string) => ['search', 'artists', query] as const,
  
  // Settings
  settings: ['settings'] as const,
  aiSettings: ['settings', 'ai'] as const,
};

// Dashboard Hooks

interface DashboardStats {
  activeSubscriptions: number;
  artistsAdded: number;
  pendingReviews: number;
  runningJobs: number;
}

interface Activity {
  id: number;
  type: string;
  title: string;
  description: string;
  status: 'running' | 'completed' | 'failed';
  timestamp: string;
}

interface ConnectionSummary {
  total: number;
  active: number;
  connections: Array<{
    type: string;
    name: string;
    isActive: boolean;
    lastChecked: string | null;
  }>;
}

export function useDashboardStats() {
  return useQuery({
    queryKey: queryKeys.dashboardStats,
    queryFn: async () => {
      const { data, error } = await api.get<{ stats: DashboardStats }>('/api/dashboard/stats');
      if (error) throw new Error(error);
      return data!.stats;
    },
    staleTime: 30 * 1000, // Fresh for 30 seconds
  });
}

export function useDashboardActivity() {
  return useQuery({
    queryKey: queryKeys.dashboardActivity,
    queryFn: async () => {
      const { data, error } = await api.get<{ activities: Activity[] }>('/api/dashboard/activity');
      if (error) throw new Error(error);
      return data!.activities;
    },
    staleTime: 30 * 1000,
  });
}

export function useDashboardConnections() {
  return useQuery({
    queryKey: queryKeys.dashboardConnections,
    queryFn: async () => {
      const { data, error } = await api.get<{ summary: ConnectionSummary }>('/api/dashboard/connections/summary');
      if (error) throw new Error(error);
      return data!.summary;
    },
    staleTime: 60 * 1000, // Fresh for 1 minute
  });
}

// Subscriptions Hooks

interface Subscription {
  id: number;
  userId: number;
  name: string;
  type: string;
  config: Record<string, unknown>;
  schedule: string | null;
  resultHandling: 'preview' | 'queue' | 'auto';
  isActive: boolean;
  lastRun: string | null;
  lastRunStatus: 'success' | 'completed' | 'failed' | 'running' | null;
  lastRunCount: number | null;
  nextRun: string | null;
  user?: { username: string; displayName: string };
}

interface Preset {
  id: string;
  name: string;
  description: string;
  type: string;
  category: string;
  config: Record<string, unknown>;
}

export function useSubscriptions() {
  return useQuery({
    queryKey: queryKeys.subscriptions,
    queryFn: async () => {
      const { data, error } = await api.get<{ subscriptions: Subscription[] }>('/api/subscriptions');
      if (error) throw new Error(error);
      return data!.subscriptions;
    },
    staleTime: 30 * 1000,
  });
}

export function usePresets() {
  return useQuery({
    queryKey: queryKeys.presets,
    queryFn: async () => {
      const { data, error } = await api.get<{ presets: Preset[] }>('/api/subscriptions/presets/list');
      if (error) throw new Error(error);
      return data!.presets;
    },
    staleTime: 5 * 60 * 1000, // Presets rarely change
  });
}

export function useRunSubscription() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await api.post(`/api/jobs/run/subscription/${id}`);
      if (error) throw new Error(error);
      return data;
    },
    onSuccess: () => {
      // Invalidate subscriptions to refresh status
      queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStats });
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs });
    },
  });
}

export function useDeleteSubscription() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await api.delete(`/api/subscriptions/${id}`);
      if (error) throw new Error(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStats });
    },
  });
}

export function useToggleSubscription() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const { error } = await api.patch(`/api/subscriptions/${id}`, { isActive });
      if (error) throw new Error(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions });
    },
  });
}

// Review Queue Hooks

interface ReviewItem {
  id: number;
  userId: number;
  artistName: string;
  albumName: string | null;
  releaseYear: number | null;
  spotifyId: string | null;
  mbid: string | null;
  source: string;
  status: 'pending' | 'approved' | 'rejected';
  itemType: 'artist' | 'album';
  createdAt: string;
  imageUrl?: string;
  user?: { username: string; displayName: string };
}

export function useReviewQueue(status: 'pending' | 'approved' | 'rejected', itemType?: 'artist' | 'album') {
  return useQuery({
    queryKey: queryKeys.reviewQueue(status, itemType),
    queryFn: async () => {
      const params = new URLSearchParams({ status, limit: '100' });
      if (itemType) params.append('itemType', itemType);
      const { data, error } = await api.get<{ items: ReviewItem[] }>(
        `/api/imports/review/queue?${params.toString()}`
      );
      if (error) throw new Error(error);
      return data!.items;
    },
    staleTime: 30 * 1000,
  });
}

export function useUpdateReviewItem() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: 'approved' | 'rejected' }) => {
      const { error } = await api.put(`/api/imports/review/${id}`, { status });
      if (error) throw new Error(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStats });
    },
  });
}

export function useBulkUpdateReview() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ ids, status }: { ids: number[]; status: 'approved' | 'rejected' }) => {
      const { error } = await api.post('/api/imports/review/bulk', { ids, status });
      if (error) throw new Error(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStats });
    },
  });
}

// Connections Hooks

interface Connection {
  id: number;
  userId: number | null;
  type: 'lidarr' | 'spotify' | 'lastfm' | 'tautulli' | 'deezer' | 'tidal' | 'listenbrainz' | 'discogs';
  name: string;
  isActive: boolean;
  lastTest: string | null;
  createdAt: string;
  user?: { username: string; displayName: string } | null;
}

export function useConnections() {
  return useQuery({
    queryKey: queryKeys.connections,
    queryFn: async () => {
      const { data, error } = await api.get<{ connections: Connection[] }>('/api/connections');
      if (error) throw new Error(error);
      return data!.connections;
    },
    staleTime: 60 * 1000,
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await api.post<{ success: boolean; message?: string }>(
        `/api/connections/${id}/test`
      );
      if (error) throw new Error(error);
      return data;
    },
  });
}

export function useDeleteConnection() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await api.delete(`/api/connections/${id}`);
      if (error) throw new Error(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.connections });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardConnections });
    },
  });
}

export function useHasLidarr() {
  return useQuery({
    queryKey: queryKeys.hasLidarr,
    queryFn: async () => {
      const { data, error } = await api.get<{ hasLidarr: boolean }>('/api/connections/has-lidarr');
      if (error) throw new Error(error);
      return data!.hasLidarr;
    },
    staleTime: 30 * 1000, // Cache for 30 seconds
  });
}

// Jobs Hooks

interface Job {
  id: string;
  name: string;
  data: Record<string, unknown>;
  progress: number;
  attemptsMade: number;
  finishedOn?: number;
  processedOn?: number;
  failedReason?: string;
  state: 'waiting' | 'active' | 'completed' | 'failed';
}

export function useJobs() {
  return useQuery({
    queryKey: queryKeys.jobs,
    queryFn: async () => {
      const { data, error } = await api.get<{ jobs: Job[] }>('/api/jobs');
      if (error) throw new Error(error);
      return data!.jobs;
    },
    staleTime: 10 * 1000, // Jobs change frequently
    refetchInterval: 10 * 1000, // Auto-refresh every 10 seconds
  });
}

// Logs Hooks

interface LogEntry {
  id: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  category: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface LogsParams {
  level?: string;
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function useLogs(params: LogsParams) {
  const queryParams = new URLSearchParams();
  if (params.level) queryParams.set('level', params.level);
  if (params.category) queryParams.set('category', params.category);
  if (params.search) queryParams.set('search', params.search);
  queryParams.set('limit', String(params.limit ?? 100));
  queryParams.set('offset', String(params.offset ?? 0));
  
  return useQuery({
    queryKey: queryKeys.logs(Object.fromEntries(queryParams)),
    queryFn: async () => {
      const { data, error } = await api.get<{ 
        logs: LogEntry[]; 
        total: number; 
        hasMore: boolean;
        limit: number;
        offset: number;
      }>(`/api/logs?${queryParams.toString()}`);
      if (error) throw new Error(error);
      return data!;
    },
    staleTime: 30 * 1000,
  });
}

// Users Hooks

interface User {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
  createdAt: string;
  updatedAt: string;
}

export function useUsers() {
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: async () => {
      const { data, error } = await api.get<{ users: User[] }>('/api/auth/users');
      if (error) throw new Error(error);
      return data!.users;
    },
    staleTime: 60 * 1000,
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await api.delete(`/api/auth/users/${id}`);
      if (error) throw new Error(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users });
    },
  });
}

// Discover Hooks

interface LibraryArtist {
  id: number;
  name: string;
  foreignArtistId: string;
  monitored: boolean;
}

interface Profiles {
  qualityProfiles: Array<{ id: number; name: string }>;
  metadataProfiles: Array<{ id: number; name: string }>;
  rootFolders: Array<{ id: number; path: string }>;
}

export function useLibrary(params: { page: number; limit: number; search?: string }) {
  const queryParams = new URLSearchParams({
    page: params.page.toString(),
    limit: params.limit.toString(),
  });
  if (params.search) queryParams.set('search', params.search);
  
  return useQuery({
    queryKey: queryKeys.library({ ...params }),
    queryFn: async () => {
      const { data, error } = await api.get<{
        artists: LibraryArtist[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>(`/api/discover/library?${queryParams}`);
      if (error) throw new Error(error);
      return data!;
    },
    staleTime: 60 * 1000,
  });
}

export function useProfiles() {
  return useQuery({
    queryKey: queryKeys.profiles,
    queryFn: async () => {
      const { data, error } = await api.get<Profiles>('/api/discover/profiles');
      if (error) throw new Error(error);
      return data!;
    },
    staleTime: 5 * 60 * 1000, // Profiles rarely change
  });
}

// Settings Hooks

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: async () => {
      const { data, error } = await api.get<{ settings: Record<string, unknown> }>('/api/settings');
      if (error) throw new Error(error);
      return data!.settings;
    },
    staleTime: 60 * 1000,
  });
}

export function useAISettings() {
  return useQuery({
    queryKey: queryKeys.aiSettings,
    queryFn: async () => {
      const { data, error } = await api.get<{ settings: Record<string, unknown> }>('/api/ai/settings');
      if (error) throw new Error(error);
      return data!.settings;
    },
    staleTime: 60 * 1000,
  });
}
