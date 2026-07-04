'use client';

import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
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
  subscriptionRuns: (id: number) => ['subscriptions', id, 'runs'] as const,
  subscriptionResults: (id: number, status: string, page: number) =>
    ['subscriptions', id, 'results', status, page] as const,
  subscriptionRunDetails: (id: number, runId: number) =>
    ['subscriptions', id, 'runs', runId] as const,
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
  recommendations: ['discover', 'recommendations'] as const,
  
  // Search
  searchArtists: (query: string) => ['search', 'artists', query] as const,
  
  // Settings
  settings: ['settings'] as const,
  aiSettings: ['settings', 'ai'] as const,
  
  // Feed
  feed: ['feed'] as const,
  feedItems: (limit: number, offset: number) => ['feed', 'items', limit, offset] as const,
};

// Feed Types

export interface FeedItem {
  id: string;
  artistName: string;
  artistMbid: string | null;
  imageUrl: string | null;
  score: number;
  subscriptionCount: number;
  sourceCount: number;
  sources: string[];
  createdAt: string;
  status?: 'pending' | 'added' | 'dismissed';
  // Metadata for display
  tags: string[] | null;
  listeners: number | null;
  subscriptionName: string | null;
}

export interface FeedStats {
  pending: number;
  addedToday: number;
}

export interface FeedResponse {
  items: FeedItem[];
  stats: FeedStats;
  total: number;
}

// Feed Hooks

export function useFeed(limit = 50) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.feed, limit],
    queryFn: async ({ pageParam = 0 }) => {
      const { data, error } = await api.get<FeedResponse>(
        `/api/feed?limit=${limit}&offset=${pageParam}`
      );
      if (error) throw new Error(error);
      return data!;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const totalFetched = allPages.reduce((sum, page) => sum + page.items.length, 0);
      return totalFetched < lastPage.total ? totalFetched : undefined;
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });
}

export function useApproveFeedItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.post<{ artistName: string }>(
        `/api/feed/${id}/approve`
      );
      if (error) throw new Error(error);
      return data!;
    },
    onMutate: async (id) => {
      // Cancel any outgoing refetches to prevent race condition
      await queryClient.cancelQueries({ queryKey: queryKeys.feed });

      // Snapshot every feed query for rollback. Feed queries are keyed
      // ['feed', limit], so prefix-matching setQueriesData/getQueriesData
      // must be used here — exact-key setQueryData(['feed']) would miss them.
      const previousData = queryClient.getQueriesData({ queryKey: queryKeys.feed });

      // Optimistic update - mark item as 'added'
      queryClient.setQueriesData({ queryKey: queryKeys.feed }, (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: FeedResponse) => ({
            ...page,
            items: page.items.map((item: FeedItem) =>
              item.id === id ? { ...item, status: 'added' as const } : item
            ),
            stats: {
              pending: Math.max(0, page.stats.pending - 1),
              addedToday: page.stats.addedToday + 1,
            },
          })),
        };
      });

      return { previousData };
    },
    onError: (_err, _id, context) => {
      // Rollback each snapshotted query on error
      for (const [key, data] of context?.previousData ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: queryKeys.feed });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStats });
    },
  });
}

export function useDismissFeedItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.post<{ artistName: string }>(
        `/api/feed/${id}/dismiss`
      );
      if (error) throw new Error(error);
      return data!;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.feed });
      // Prefix-match all ['feed', limit] queries — see useApproveFeedItem
      const previousData = queryClient.getQueriesData({ queryKey: queryKeys.feed });

      queryClient.setQueriesData({ queryKey: queryKeys.feed }, (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: FeedResponse) => ({
            ...page,
            items: page.items.map((item: FeedItem) =>
              item.id === id ? { ...item, status: 'dismissed' as const } : item
            ),
            stats: {
              ...page.stats,
              pending: Math.max(0, page.stats.pending - 1),
            },
          })),
        };
      });

      return { previousData };
    },
    onError: (_err, _id, context) => {
      for (const [key, data] of context?.previousData ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.feed });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStats });
    },
  });
}

// Dashboard Hooks

interface DashboardStats {
  activeSubscriptions: number;
  artistsAdded: number;
  pendingReviews: number;
  runningJobs: number;
  activeConnections: number;
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

export function useCreateSubscription() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (data: {
      name: string;
      type: string;
      config: Record<string, unknown>;
      schedule?: string;
      resultHandling: 'preview' | 'queue' | 'auto';
    }) => {
      const { data: result, error } = await api.post<{ subscription: Subscription }>('/api/subscriptions', data);
      if (error) throw new Error(error);
      return result!.subscription;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStats });
    },
  });
}

export function useUpdateSubscription() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, data }: {
      id: number;
      data: {
        name?: string;
        config?: Record<string, unknown>;
        schedule?: string;
        resultHandling?: 'preview' | 'queue' | 'auto';
        isActive?: boolean;
      };
    }) => {
      const { data: result, error } = await api.put<{ subscription: Subscription }>(`/api/subscriptions/${id}`, data);
      if (error) throw new Error(error);
      return result!.subscription;
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
      // 500 is the API's max page size; total lets the UI show truncation
      const params = new URLSearchParams({ status, limit: '500' });
      if (itemType) params.append('itemType', itemType);
      const { data, error } = await api.get<{ items: ReviewItem[]; total: number }>(
        `/api/imports/review/queue?${params.toString()}`
      );
      if (error) throw new Error(error);
      return { items: data!.items, total: data!.total ?? data!.items.length };
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

export interface LibraryArtist {
  id: number;
  name: string;
  foreignArtistId: string;
  monitored: boolean;
}

export interface Profiles {
  qualityProfiles: Array<{ id: number; name: string }>;
  metadataProfiles: Array<{ id: number; name: string }>;
  rootFolders: Array<{ id: number; path: string }>;
  defaults?: {
    qualityProfileId?: number;
    metadataProfileId?: number;
    rootFolderPath?: string;
    monitorOption?: string;
    searchOnAdd?: boolean;
  };
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
// slskd Download Hooks

export interface SlskdDownload {
  id: number;
  connectionId: number;
  username: string;
  artistName: string;
  albumName?: string;
  albumYear?: number;
  filename: string;
  fileSize: number;
  downloadPath?: string;
  organizedPath?: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export function useSlskdDownloads(status?: string) {
  const queryParams = status ? `?status=${status}` : '';
  return useQuery({
    queryKey: ['slskd', 'downloads', status],
    queryFn: async () => {
      const { data, error } = await api.get<SlskdDownload[]>(`/api/slskd/downloads${queryParams}`);
      if (error) throw new Error(error);
      return data!;
    },
    staleTime: 10 * 1000, // Refresh every 10s for active downloads
    refetchInterval: status === 'downloading' || status === 'pending' ? 5000 : false,
  });
}

export function useRetrySlskdDownload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await api.post<{ success: boolean }>(`/api/slskd/downloads/${id}/retry`);
      if (error) throw new Error(error);
      return data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slskd', 'downloads'] });
    },
  });
}

export function useCancelSlskdDownload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, remove = false }: { id: number; remove?: boolean }) => {
      const queryParams = remove ? '?remove=true' : '';
      const { data, error } = await api.delete<{ success: boolean }>(`/api/slskd/downloads/${id}${queryParams}`);
      if (error) throw new Error(error);
      return data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slskd', 'downloads'] });
    },
  });
}

// ─── Subscription Detail Types ───────────────────────────────────────────────

export const RESULTS_PAGE_SIZE = 50;

export interface SubscriptionDetail {
  id: number;
  name: string;
  type: string;
  config: Record<string, unknown>;
  schedule: string | null;
  resultHandling: string;
  resultLimit: number;
  isActive: boolean;
  lastRun: string | null;
}

export interface SubscriptionRun {
  id: number;
  status: string;
  resultsCount: number;
  addedCount: number;
  skippedCount: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface SubscriptionResult {
  id: number;
  itemType: string;
  name: string;
  artistName: string | null;
  mbid: string | null;
  status: string;
  skipReason: string | null;
  createdAt: string;
  imageUrl?: string | null;
  inLibrary?: boolean;
}

export interface SubscriptionResultsPage {
  results: SubscriptionResult[];
  total: number;
  limit: number;
  offset: number;
  statusCounts: Record<string, number>;
}

// ─── Subscription Detail Hooks ───────────────────────────────────────────────

export function useSubscriptionDetail(id: number) {
  return useQuery({
    queryKey: queryKeys.subscription(id),
    queryFn: async () => {
      const { data, error } = await api.get<{ subscription: SubscriptionDetail }>(`/api/subscriptions/${id}`);
      if (error) throw new Error(error);
      return data!.subscription;
    },
    staleTime: 30 * 1000,
    enabled: Number.isFinite(id),
  });
}

export function useSubscriptionRuns(id: number) {
  return useQuery({
    queryKey: queryKeys.subscriptionRuns(id),
    queryFn: async () => {
      const { data, error } = await api.get<{ runs: SubscriptionRun[] }>(`/api/subscriptions/${id}/runs`);
      if (error) throw new Error(error);
      return data!.runs;
    },
    staleTime: 30 * 1000,
    enabled: Number.isFinite(id),
  });
}

export function useSubscriptionResults(id: number, status: string, page: number) {
  return useQuery({
    queryKey: queryKeys.subscriptionResults(id, status, page),
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(RESULTS_PAGE_SIZE),
        offset: String(page * RESULTS_PAGE_SIZE),
      });
      if (status) params.set('status', status);
      const { data, error } = await api.get<SubscriptionResultsPage>(
        `/api/subscriptions/${id}/results?${params.toString()}`
      );
      if (error) throw new Error(error);
      return data!;
    },
    staleTime: 30 * 1000,
    placeholderData: (prev) => prev,
    enabled: Number.isFinite(id),
  });
}

export function useSubscriptionRunDetails(id: number, runId: number | null) {
  return useQuery({
    queryKey: queryKeys.subscriptionRunDetails(id, runId ?? -1),
    queryFn: async () => {
      const { data, error } = await api.get<{ run: SubscriptionRun; results: SubscriptionResult[] }>(
        `/api/subscriptions/${id}/runs/${runId}`
      );
      if (error) throw new Error(error);
      return data!;
    },
    staleTime: 30 * 1000,
    enabled: Number.isFinite(id) && runId !== null,
  });
}

/** Shared cache surgery for approve/reject: flip one row's status everywhere it appears. */
function updateResultStatus(
  queryClient: ReturnType<typeof useQueryClient>,
  subscriptionId: number,
  resultId: number,
  newStatus: string
) {
  queryClient.setQueriesData<SubscriptionResultsPage>(
    { queryKey: ['subscriptions', subscriptionId, 'results'] },
    (old) =>
      old
        ? { ...old, results: old.results.map((r) => (r.id === resultId ? { ...r, status: newStatus } : r)) }
        : old
  );
  // For run-details views (shape: { run, results }) — skip plain runs-list (SubscriptionRun[])
  queryClient.setQueriesData<{ run: SubscriptionRun; results: SubscriptionResult[] }>(
    { queryKey: ['subscriptions', subscriptionId, 'runs'] },
    (old) =>
      old && 'results' in old
        ? { ...old, results: old.results.map((r) => (r.id === resultId ? { ...r, status: newStatus } : r)) }
        : old
  );
}

export function useApproveResult(subscriptionId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (resultId: number) => {
      const { error } = await api.post(`/api/subscriptions/${subscriptionId}/results/${resultId}/approve`);
      if (error) throw new Error(error);
    },
    onSuccess: (_data, resultId) => {
      updateResultStatus(queryClient, subscriptionId, resultId, 'added');
      queryClient.invalidateQueries({ queryKey: ['subscriptions', subscriptionId, 'results'] });
    },
  });
}

export function useRejectResult(subscriptionId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (resultId: number) => {
      const { error } = await api.post(`/api/subscriptions/${subscriptionId}/results/${resultId}/reject`);
      if (error) throw new Error(error);
    },
    onSuccess: (_data, resultId) => {
      updateResultStatus(queryClient, subscriptionId, resultId, 'rejected');
      queryClient.invalidateQueries({ queryKey: ['subscriptions', subscriptionId, 'results'] });
    },
  });
}