'use client';

import { useState, useEffect } from 'react';
import { Button, Card, CardContent, Input, Modal, ModalFooter, useToast, Badge, Select } from '@/components/ui';
import { PageHeader } from '@/components/layout/page-header';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSubscriptions, usePresets, useRunSubscription, useDeleteSubscription, useToggleSubscription, queryKeys } from '@/lib/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Play, Pause, Trash2, Edit, Clock, TrendingUp, Music2, Globe, Tag, Eye, Sparkles, ChevronRight, Brain, Headphones, Disc, ShoppingBag, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

interface Subscription {
  id: number;
  userId: number;
  name: string;
  type: string;
  config: Record<string, any>;
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
  config: Record<string, any>;
}

const subscriptionTypes = [
  { value: 'lastfm_chart', label: 'Last.fm Charts', icon: TrendingUp, description: 'Top artists by country/global' },
  { value: 'lastfm_tag', label: 'Last.fm Tag', icon: Tag, description: 'Artists by genre/tag' },
  { value: 'lastfm_geo', label: 'Last.fm Geo', icon: Globe, description: 'Top artists by location' },
  { value: 'lastfm_library', label: 'Last.fm Library', icon: TrendingUp, description: 'Your top artists from scrobbles' },
  { value: 'lastfm_similar', label: 'Last.fm Similar', icon: Sparkles, description: 'Artists similar to your top artists' },
  { value: 'listenbrainz_top', label: 'ListenBrainz Top', icon: Headphones, description: 'Your top artists from listening history' },
  { value: 'listenbrainz_similar', label: 'ListenBrainz Similar', icon: Headphones, description: 'Artists from users with similar taste' },
  { value: 'listenbrainz_recommendations', label: 'ListenBrainz Recs', icon: Headphones, description: 'Personalized recommendations' },
  { value: 'listenbrainz_explore', label: 'ListenBrainz Explore', icon: Headphones, description: 'Fresh/trending new releases' },
  { value: 'listenbrainz_year', label: 'ListenBrainz Year', icon: Headphones, description: 'Your Year in Music top artists' },
  { value: 'listenbrainz_playlist', label: 'ListenBrainz Playlist', icon: Headphones, description: 'Artists from a playlist' },
  { value: 'listenbrainz_radio', label: 'ListenBrainz Radio', icon: Headphones, description: 'Artist radio recommendations' },
  { value: 'listenbrainz_loved', label: 'ListenBrainz Loved', icon: Headphones, description: 'Artists from your loved tracks' },
  { value: 'spotify_playlist', label: 'Spotify Playlist', icon: Music2, description: 'Artists from a playlist' },
  { value: 'spotify_new_releases', label: 'Spotify New Releases', icon: Music2, description: 'New album releases' },
  { value: 'spotify_followed', label: 'Spotify', icon: Music2, description: 'Your followed artists' },
  { value: 'spotify_saved_albums', label: 'Spotify', icon: Music2, description: 'Your saved albums' },
  { value: 'spotify_liked_songs', label: 'Spotify', icon: Music2, description: 'Your liked songs' },
  { value: 'spotify_library', label: 'Spotify Library', icon: Music2, description: 'All artists from your library' },
  { value: 'spotify_public_playlist', label: 'Public Spotify Playlist', icon: Music2, description: 'Any public playlist (no login required)' },
  { value: 'spotify_featured', label: 'Spotify Featured', icon: Music2, description: 'Featured playlists' },
  { value: 'spotify_category', label: 'Spotify Category', icon: Music2, description: 'Playlists by category/genre' },
  { value: 'spotify_discover_weekly', label: 'Spotify', icon: Music2, description: 'Discover Weekly playlist', warning: 'Must be followed/saved in Spotify first' },
  { value: 'spotify_daily_mix', label: 'Spotify', icon: Music2, description: 'Daily Mix playlists', warning: 'Must be followed/saved in Spotify first' },
  { value: 'spotify_release_radar', label: 'Spotify', icon: Music2, description: 'Release Radar playlist', warning: 'Must be followed/saved in Spotify first' },
  { value: 'spotify_on_repeat', label: 'Spotify', icon: Music2, description: 'On Repeat playlist', warning: 'Must be followed/saved in Spotify first' },
  { value: 'deezer_chart', label: 'Deezer Charts', icon: TrendingUp, description: 'Top chart artists (no login required)' },
  { value: 'deezer_genre', label: 'Deezer Genre', icon: Tag, description: 'Artists by genre (no login required)' },
  { value: 'deezer_search', label: 'Deezer Search', icon: Music2, description: 'Search for artists (no login required)' },
  { value: 'deezer_favorites', label: 'Deezer Favorites', icon: Music2, description: 'Your favorite tracks', warning: 'Requires Deezer OAuth app (currently unavailable)' },
  { value: 'deezer_history', label: 'Deezer History', icon: Music2, description: 'Your listening history', warning: 'Requires Deezer OAuth app (currently unavailable)' },
  { value: 'deezer_flow', label: 'Deezer Flow', icon: Sparkles, description: 'Your personalized Flow', warning: 'Requires Deezer OAuth app (currently unavailable)' },
  { value: 'deezer_playlist', label: 'Deezer Playlist', icon: Music2, description: 'Artists from a playlist', warning: 'Requires Deezer OAuth app (currently unavailable)' },
  { value: 'deezer_playlists', label: 'Deezer Playlists', icon: Music2, description: 'All your playlists', warning: 'Requires Deezer OAuth app (currently unavailable)' },
  { value: 'tidal_favorites', label: 'TIDAL Favorites', icon: Music2, description: 'Artists from your favorite tracks' },
  { value: 'tidal_followed_artists', label: 'TIDAL Followed', icon: Music2, description: 'Your followed artists' },
  { value: 'tidal_playlist', label: 'TIDAL Playlist', icon: Music2, description: 'Artists from a playlist' },
  { value: 'tidal_playlists', label: 'TIDAL Playlists', icon: Music2, description: 'All your playlists' },
  { value: 'tidal_discovery', label: 'TIDAL Discovery', icon: Sparkles, description: 'Your discovery mix' },
  { value: 'tidal_new_arrivals', label: 'TIDAL New Arrivals', icon: Music2, description: 'New arrival recommendations' },
  { value: 'tidal_mix', label: 'TIDAL My Mixes', icon: Sparkles, description: 'Your personalized mixes' },
  { value: 'discogs_label', label: 'Discogs Label', icon: Disc, description: 'Artists from a record label' },
  { value: 'discogs_style', label: 'Discogs Style', icon: Disc, description: 'Artists by style/genre' },
  { value: 'bandcamp_tag', label: 'Bandcamp Tag', icon: ShoppingBag, description: 'Popular releases by tag' },
  { value: 'bandcamp_new', label: 'Bandcamp New', icon: ShoppingBag, description: 'New releases by tag' },
  { value: 'musicbrainz_new', label: 'MusicBrainz', icon: Sparkles, description: 'New releases from MusicBrainz' },
  { value: 'ai_recommendation', label: 'AI Recommendations', icon: Brain, description: 'AI-powered artist discovery' },
  { value: 'tautulli_similar', label: 'Plex Similar', icon: Sparkles, description: 'Artists similar to your Plex listening history' },
];

const presetCategories = [
  { id: 'charts', label: 'Global Charts', icon: TrendingUp },
  { id: 'genre', label: 'Genre Tags', icon: Tag },
  { id: 'geographic', label: 'Geographic', icon: Globe },
  { id: 'spotify', label: 'Spotify', icon: Music2 },
  { id: 'deezer', label: 'Deezer', icon: Music2 },
  { id: 'tidal', label: 'TIDAL', icon: Music2 },
  { id: 'listenbrainz', label: 'ListenBrainz', icon: Headphones },
  { id: 'discogs', label: 'Discogs', icon: Disc },
  { id: 'bandcamp', label: 'Bandcamp', icon: ShoppingBag },
  { id: 'library', label: 'My Library', icon: Music2 },
  { id: 'musicbrainz', label: 'MusicBrainz', icon: Sparkles },
  { id: 'ai', label: 'AI', icon: Brain },
];

const scheduleOptions = [
  { value: '', label: 'Manual only' },
  { value: '0 0 * * *', label: 'Daily at midnight' },
  { value: '0 0 * * 0', label: 'Weekly (Sunday)' },
  { value: '0 0 1 * *', label: 'Monthly (1st)' },
  { value: '0 */6 * * *', label: 'Every 6 hours' },
  { value: '0 */12 * * *', label: 'Every 12 hours' },
];

const REQUIRED_FIELDS: Record<string, { field: string; label: string }[]> = {
  listenbrainz_radio: [{ field: 'listenbrainzSeedMbid', label: 'Seed Artist MBID' }],
  listenbrainz_playlist: [{ field: 'listenbrainzPlaylistId', label: 'Playlist ID' }],
  spotify_playlist: [{ field: 'playlistId', label: 'Playlist ID' }],
  spotify_public_playlist: [{ field: 'publicPlaylistUrl', label: 'Playlist URL' }],
  spotify_category: [{ field: 'tag', label: 'Category' }],
  lastfm_tag: [{ field: 'tag', label: 'Tag' }],
  discogs_label: [{ field: 'labelId', label: 'Label ID' }],
  discogs_style: [{ field: 'discogsStyle', label: 'Style' }],
  bandcamp_tag: [{ field: 'bandcampTag', label: 'Tag' }],
  bandcamp_new: [{ field: 'bandcampTag', label: 'Tag' }],
  tidal_playlist: [{ field: 'playlistId', label: 'Playlist ID' }],
  deezer_playlist: [{ field: 'playlistId', label: 'Playlist ID' }],
};

const resultHandlingOptions = [
  { value: 'preview', label: 'Preview only (store results, no action)' },
  { value: 'queue', label: 'Add to review queue' },
  { value: 'auto', label: 'Auto-add to Lidarr' },
];

export default function SubscriptionsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  // React Query hooks for data fetching with caching
  const { data: subscriptions = [], isLoading } = useSubscriptions();
  const { data: presets = [] } = usePresets();
  const runMutation = useRunSubscription();
  const deleteMutation = useDeleteSubscription();
  const toggleMutation = useToggleSubscription();
  
  const [showModal, setShowModal] = useState(false);
  const [modalStep, setModalStep] = useState<'presets' | 'form'>('presets');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [selectedFromPreset, setSelectedFromPreset] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const { addToast } = useToast();

  // Artist search autocomplete state
  const [artistSearch, setArtistSearch] = useState('');
  const [artistResults, setArtistResults] = useState<Array<{ id: string; name: string; disambiguation?: string }>>([]);
  const [isSearchingArtist, setIsSearchingArtist] = useState(false);
  const [showArtistDropdown, setShowArtistDropdown] = useState(false);

  const [form, setForm] = useState({
    type: 'lastfm_chart',
    name: '',
    schedule: '',
    resultHandling: 'preview',
    limit: '50',
    country: '',
    tag: '',
    playlistId: '',
    aiStrategy: 'similar',
    aiSource: 'spotify',
    // Discogs fields
    labelId: '',
    labelName: '',
    discogsStyle: '',
    // Bandcamp fields
    bandcampTag: '',
    bandcampSort: 'pop',
    // ListenBrainz fields
    listenbrainzPeriod: 'all_time',
    listenbrainzRecType: 'similar_artist',
    listenbrainzYear: String(new Date().getFullYear()),
    listenbrainzPlaylistId: '',
    listenbrainzSeedMbid: '',
    listenbrainzRadioMode: 'medium',
    // Public playlist fields
    publicPlaylistUrl: '',
    includeAllArtists: false,
    discoverAlbums: false,
  });

  // Search artists with debounce
  useEffect(() => {
    if (!artistSearch || artistSearch.length < 2) {
      setArtistResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearchingArtist(true);
      try {
        const { data } = await api.get<{ results: Array<{ id: string; name: string; disambiguation?: string }> }>(
          `/api/search/musicbrainz/artist?q=${encodeURIComponent(artistSearch)}`
        );
        setArtistResults(data?.results || []);
        setShowArtistDropdown(true);
      } catch (error) {
        console.error('Artist search failed:', error);
        setArtistResults([]);
      } finally {
        setIsSearchingArtist(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [artistSearch]);

  // Invalidate queries to trigger refetch
  const refetchSubscriptions = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions });
  };

  const validateForm = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    const requiredFields = REQUIRED_FIELDS[form.type] || [];
    
    for (const { field, label } of requiredFields) {
      const value = form[field as keyof typeof form];
      if (!value || (typeof value === 'string' && value.trim() === '')) {
        errors[field] = `${label} is required`;
      }
    }
    
    return errors;
  };

  const handleSave = async () => {
    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      addToast({ type: 'error', title: 'Please fill in all required fields' });
      return;
    }
    setValidationErrors({});

    const config: Record<string, any> = { limit: parseInt(form.limit, 10) };
    
    if (form.type === 'lastfm_chart' || form.type === 'lastfm_geo') {
      config.country = form.country || 'global';
    }
    if (form.type === 'lastfm_tag') {
      config.tag = form.tag;
    }
    if (form.type === 'spotify_playlist' || form.type === 'deezer_playlist' || form.type === 'tidal_playlist') {
      config.playlistId = form.playlistId;
    }
    if (form.type === 'ai_recommendation') {
      config.strategy = form.aiStrategy;
      config.source = form.aiSource;
    }
    if (form.type === 'discogs_label') {
      config.labelId = parseInt(form.labelId, 10) || null;
      config.labelName = form.labelName;
    }
    if (form.type === 'discogs_style') {
      config.style = form.discogsStyle;
    }
    if (form.type === 'bandcamp_tag' || form.type === 'bandcamp_new') {
      config.tag = form.bandcampTag;
      config.sort = form.type === 'bandcamp_new' ? 'date' : form.bandcampSort;
    }
    if (form.type === 'listenbrainz_top' || form.type === 'listenbrainz_similar') {
      config.period = form.listenbrainzPeriod;
    }
    if (form.type === 'listenbrainz_recommendations') {
      config.recommendationType = form.listenbrainzRecType;
    }
    if (form.type === 'listenbrainz_year') {
      config.year = parseInt(form.listenbrainzYear, 10) || new Date().getFullYear();
    }
    if (form.type === 'listenbrainz_playlist') {
      config.playlistId = form.listenbrainzPlaylistId;
    }
    if (form.type === 'listenbrainz_radio') {
      config.seedMbid = form.listenbrainzSeedMbid;
      config.mode = form.listenbrainzRadioMode || 'medium';
    }
    // spotify_new_releases always discovers albums (new releases are albums by definition)
    if (form.type === 'spotify_new_releases') {
      config.discoverAlbums = true;
    }
    if (form.type === 'spotify_public_playlist') {
      config.playlistUrl = form.publicPlaylistUrl;
      config.includeAllArtists = form.includeAllArtists;
      config.discoverAlbums = form.discoverAlbums;
    }

    const payload = {
      type: form.type,
      name: form.name || subscriptionTypes.find(t => t.value === form.type)?.label,
      schedule: form.schedule || null,
      resultHandling: form.resultHandling,
      config,
    };

    const { error } = editingId
      ? await api.put(`/api/subscriptions/${editingId}`, payload)
      : await api.post('/api/subscriptions', payload);

    if (error) {
      addToast({ type: 'error', title: 'Failed to save subscription', message: error });
    } else {
      addToast({ type: 'success', title: editingId ? 'Subscription updated' : 'Subscription created' });
      closeModal();
      refetchSubscriptions();
    }
  };

  const handleRun = async (id: number) => {
    setRunningId(id);
    try {
      await runMutation.mutateAsync(id);
      addToast({ type: 'success', title: 'Subscription started' });
    } catch (error) {
      addToast({ type: 'error', title: 'Failed to start subscription', message: error instanceof Error ? error.message : 'Unknown error' });
    }
    setRunningId(null);
  };

  const handleToggle = async (sub: Subscription) => {
    try {
      await toggleMutation.mutateAsync({ id: sub.id, isActive: !sub.isActive });
    } catch {
      addToast({ type: 'error', title: 'Failed to update subscription' });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this subscription?')) return;
    
    try {
      await deleteMutation.mutateAsync(id);
      addToast({ type: 'success', title: 'Subscription deleted' });
    } catch {
      addToast({ type: 'error', title: 'Failed to delete subscription' });
    }
  };

  const openModal = (subscription?: Subscription) => {
    if (subscription) {
      setEditingId(subscription.id);
      setForm({
        type: subscription.type,
        name: subscription.name,
        schedule: subscription.schedule || '',
        resultHandling: subscription.resultHandling || 'preview',
        limit: subscription.config.limit?.toString() || '50',
        country: subscription.config.country || '',
        tag: subscription.config.tag || '',
        playlistId: subscription.config.playlistId || '',
        aiStrategy: subscription.config.strategy || 'similar',
        aiSource: subscription.config.source || 'spotify',
        labelId: subscription.config.labelId?.toString() || '',
        labelName: subscription.config.labelName || '',
        discogsStyle: subscription.config.style || '',
        bandcampTag: subscription.config.tag || '',
        bandcampSort: subscription.config.sort || 'pop',
        listenbrainzPeriod: subscription.config.period || 'all_time',
        listenbrainzRecType: subscription.config.recommendationType || 'similar_artist',
        listenbrainzYear: subscription.config.year?.toString() || String(new Date().getFullYear()),
        listenbrainzPlaylistId: subscription.config.playlistId || '',
        listenbrainzSeedMbid: subscription.config.seedMbid || '',
        listenbrainzRadioMode: subscription.config.mode || 'medium',
        publicPlaylistUrl: subscription.config.playlistUrl || '',
        includeAllArtists: subscription.config.includeAllArtists || false,
        discoverAlbums: subscription.config.discoverAlbums || false,
      });
    } else {
      setEditingId(null);
      setForm({
        type: 'lastfm_chart',
        name: '',
        schedule: '',
        resultHandling: 'preview',
        limit: '50',
        country: '',
        tag: '',
        playlistId: '',
        aiStrategy: 'similar',
        aiSource: 'spotify',
        labelId: '',
        labelName: '',
        discogsStyle: '',
        bandcampTag: '',
        bandcampSort: 'pop',
        listenbrainzPeriod: 'all_time',
        listenbrainzRecType: 'similar_artist',
        listenbrainzYear: String(new Date().getFullYear()),
        listenbrainzPlaylistId: '',
        listenbrainzSeedMbid: '',
        listenbrainzRadioMode: 'medium',
        publicPlaylistUrl: '',
        includeAllArtists: false,
        discoverAlbums: false,
      });
      setModalStep('presets');
      setSelectedCategory(null);
    }
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
    setModalStep('presets');
    setSelectedCategory(null);
    setSelectedFromPreset(false);
    setValidationErrors({});
    setArtistSearch('');
    setArtistResults([]);
    setShowArtistDropdown(false);
  };

  const selectPreset = (preset: Preset) => {
    setForm({
      type: preset.type,
      name: preset.name,
      schedule: '',
      resultHandling: 'preview',
      limit: preset.config.limit?.toString() || '50',
      country: preset.config.country || '',
      tag: preset.config.tag || '',
      playlistId: preset.config.playlistId || '',
      aiStrategy: preset.config.strategy || 'similar',
      aiSource: preset.config.source || 'spotify',
      labelId: preset.config.labelId?.toString() || '',
      labelName: preset.config.labelName || '',
      discogsStyle: preset.config.style || '',
      bandcampTag: preset.config.tag || '',
      bandcampSort: preset.config.sort || 'pop',
      listenbrainzPeriod: preset.config.period || 'all_time',
      listenbrainzRecType: preset.config.recommendationType || 'similar_artist',
      listenbrainzYear: preset.config.year?.toString() || String(new Date().getFullYear()),
      listenbrainzPlaylistId: preset.config.playlistId || '',
      listenbrainzSeedMbid: preset.config.seedMbid || '',
      listenbrainzRadioMode: preset.config.mode || 'medium',
      publicPlaylistUrl: preset.config.playlistUrl || '',
      includeAllArtists: preset.config.includeAllArtists || false,
      discoverAlbums: preset.config.discoverAlbums || false,
    });
    setSelectedFromPreset(true);
    setModalStep('form');
  };

  const typeConfig = subscriptionTypes.find(t => t.value === form.type);
  const filteredPresets = selectedCategory 
    ? presets.filter(p => p.category === selectedCategory)
    : presets;

  return (
    <>
      <PageHeader
        title="Subscriptions"
        description="Automated music discovery from charts and playlists"
      >
        <Button onClick={() => openModal()}>
          <Plus className="h-4 w-4 mr-2" /> New Subscription
        </Button>
      </PageHeader>

      {/* Subscription List */}
      {subscriptions.length === 0 && !isLoading ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <TrendingUp className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">No subscriptions yet</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              Create a subscription to automatically discover new artists
            </p>
            <Button onClick={() => openModal()}>
              <Plus className="h-4 w-4 mr-2" /> Create Subscription
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {subscriptions.map((sub) => {
            const SubIcon = subscriptionTypes.find(t => t.value === sub.type)?.icon || TrendingUp;
            return (
              <Card key={sub.id}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="rounded-lg bg-primary/10 p-3 text-primary">
                      <SubIcon className="h-5 w-5" />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold truncate">
                          {sub.name}
                        </h3>
                        <Badge variant={sub.isActive ? 'success' : 'secondary'}>
                          {sub.isActive ? 'Active' : 'Paused'}
                        </Badge>
                        {sub.lastRunStatus && (
                          <Badge 
                            variant={
                              sub.lastRunStatus === 'success' || sub.lastRunStatus === 'completed' 
                                ? 'success' 
                                : sub.lastRunStatus === 'failed' 
                                  ? 'destructive' 
                                  : 'secondary'
                            }
                            className="text-xs"
                          >
                            {sub.lastRunStatus === 'success' || sub.lastRunStatus === 'completed'
                              ? `✓ ${sub.lastRunCount ?? 0} artists` 
                              : sub.lastRunStatus === 'failed' 
                                ? '✗ Failed' 
                                : '⟳ Running'}
                          </Badge>
                        )}
                        {/* Show owner badge for admins */}
                        {user?.role === 'admin' && sub.user && sub.userId !== user.id && (
                          <Badge variant="outline" className="text-xs">
                            {sub.user.displayName || sub.user.username}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {subscriptionTypes.find(t => t.value === sub.type)?.label}
                        {typeof sub.config.country === 'string' && sub.config.country !== 'global' ? ` · ${sub.config.country}` : null}
                        {typeof sub.config.tag === 'string' ? ` · ${sub.config.tag}` : null}
                      </p>
                      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                        {sub.schedule && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {scheduleOptions.find(s => s.value === sub.schedule)?.label || sub.schedule}
                          </span>
                        )}
                        {sub.lastRun && (
                          <span>Last: {new Date(sub.lastRun).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <Link href={`/subscriptions/${sub.id}`}>
                        <Button variant="ghost" size="icon" title="View results">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRun(sub.id)}
                        disabled={runningId === sub.id}
                        title="Run now"
                      >
                        <Play className={`h-4 w-4 ${runningId === sub.id ? 'animate-pulse' : ''}`} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggle(sub)}
                        title={sub.isActive ? 'Pause' : 'Resume'}
                      >
                        {sub.isActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openModal(sub)} title="Edit">
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(sub.id)} title="Delete">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editingId ? 'Edit Subscription' : modalStep === 'presets' ? 'Choose a Preset' : 'Configure Subscription'}
        size="lg"
      >
        {/* Step 1: Preset Selection (only for new subscriptions) */}
        {!editingId && modalStep === 'presets' && (
          <div className="space-y-4">
            {/* Category filter */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant={selectedCategory === null ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedCategory(null)}
              >
                All
              </Button>
              {presetCategories.map(cat => (
                <Button
                  key={cat.id}
                  variant={selectedCategory === cat.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedCategory(cat.id)}
                >
                  <cat.icon className="h-3 w-3 mr-1" />
                  {cat.label}
                </Button>
              ))}
            </div>

            {/* Preset list */}
            <div className="max-h-80 overflow-y-auto space-y-2">
              {filteredPresets.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No presets found</p>
              ) : (
                filteredPresets.map(preset => (
                  <button
                    key={preset.id}
                    onClick={() => selectPreset(preset)}
                    className="w-full flex items-center justify-between p-3 rounded-lg border hover:bg-accent transition-colors text-left"
                  >
                    <div>
                      <p className="font-medium">{preset.name}</p>
                      <p className="text-sm text-muted-foreground">{preset.description}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))
              )}
            </div>

            <div className="border-t pt-4">
              <Button variant="outline" className="w-full" onClick={() => { setSelectedFromPreset(false); setModalStep('form'); }}>
                <Plus className="h-4 w-4 mr-2" /> Create Custom Subscription
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Configuration Form */}
        {(editingId || modalStep === 'form') && (
          <div className="space-y-4">
            {!editingId && (
              <Button variant="ghost" size="sm" onClick={() => { setSelectedFromPreset(false); setModalStep('presets'); }} className="mb-2">
                ← Back to Presets
              </Button>
            )}

            <div>
              <label className="text-sm font-medium">Type</label>
              <Select
                value={form.type}
                onChange={(e) => {
                  setForm({ ...form, type: e.target.value });
                  setValidationErrors({});
                  setArtistSearch('');
                  setArtistResults([]);
                }}
                options={subscriptionTypes.map(t => ({ value: t.value, label: `${t.label}${t.warning ? ' (!)' : ''}`, sublabel: t.description }))}
                disabled={!!editingId || selectedFromPreset}
              />
              {typeConfig && (
                <p className="text-xs text-muted-foreground mt-1">{typeConfig.description}</p>
              )}
              {typeConfig?.warning && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> {typeConfig.warning}
                </p>
              )}
            </div>

            <div>
              <label className="text-sm font-medium">Name</label>
              <Input
                value={form.name || typeConfig?.label || ''}
                readOnly
                className="bg-muted cursor-not-allowed"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Schedule</label>
              <Select
                value={form.schedule}
                onChange={(e) => setForm({ ...form, schedule: e.target.value })}
                options={scheduleOptions}
              />
            </div>

            <div>
              <label className="text-sm font-medium">Result Handling</label>
              <Select
                value={form.resultHandling}
                onChange={(e) => setForm({ ...form, resultHandling: e.target.value })}
                options={resultHandlingOptions}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {form.resultHandling === 'preview' && 'Results are stored for viewing but not added to Lidarr'}
                {form.resultHandling === 'queue' && 'Results are added to review queue for manual approval'}
                {form.resultHandling === 'auto' && 'Results are automatically added to Lidarr'}
              </p>
            </div>

            <div>
              <label className="text-sm font-medium">Limit</label>
              <Input
                type="number"
                value={form.limit}
                onChange={(e) => setForm({ ...form, limit: e.target.value })}
                placeholder="50"
                min="1"
                max="200"
              />
            </div>

            {(form.type === 'lastfm_chart' || form.type === 'lastfm_geo') && (
              <div>
                <label className="text-sm font-medium">Country</label>
                <Input
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                  placeholder="global"
                />
              </div>
            )}

            {form.type === 'lastfm_tag' && (
              <div>
                <label className="text-sm font-medium">
                  Tag{REQUIRED_FIELDS[form.type]?.some(r => r.field === 'tag') && <span className="text-red-500 ml-1">*</span>}
                </label>
                <Input
                  value={form.tag}
                  onChange={(e) => setForm({ ...form, tag: e.target.value })}
                  placeholder="e.g., rock, metal, jazz"
                />
                {validationErrors.tag && (
                  <p className="text-xs text-red-600 mt-1">{validationErrors.tag}</p>
                )}
              </div>
            )}

            {form.type === 'spotify_playlist' && (
              <div>
                <label className="text-sm font-medium">
                  Playlist ID{REQUIRED_FIELDS[form.type]?.some(r => r.field === 'playlistId') && <span className="text-red-500 ml-1">*</span>}
                </label>
                <Input
                  value={form.playlistId}
                  onChange={(e) => setForm({ ...form, playlistId: e.target.value })}
                  placeholder="Spotify playlist ID"
                />
                {validationErrors.playlistId && (
                  <p className="text-xs text-red-600 mt-1">{validationErrors.playlistId}</p>
                )}
              </div>
            )}

            {form.type === 'spotify_public_playlist' && (
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">
                    Playlist URL{REQUIRED_FIELDS[form.type]?.some(r => r.field === 'publicPlaylistUrl') && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <Input
                    value={form.publicPlaylistUrl}
                    onChange={(e) => setForm({ ...form, publicPlaylistUrl: e.target.value })}
                    placeholder="https://open.spotify.com/playlist/..."
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Paste any public Spotify playlist URL (no login required)
                  </p>
                  {validationErrors.publicPlaylistUrl && (
                    <p className="text-xs text-red-600 mt-1">{validationErrors.publicPlaylistUrl}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                  <input
                    type="checkbox"
                    id="discoverAlbums"
                    checked={form.discoverAlbums}
                    onChange={(e) => setForm({ ...form, discoverAlbums: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <label htmlFor="discoverAlbums" className="text-sm">
                    <span className="font-medium">Discover Albums</span>
                    <p className="text-muted-foreground text-xs mt-0.5">
                      Queue albums instead of artists. Only specific albums will be monitored in Lidarr.
                    </p>
                  </label>
                </div>
                {!form.discoverAlbums && (
                  <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                    <input
                      type="checkbox"
                      id="includeAllArtists"
                      checked={form.includeAllArtists}
                      onChange={(e) => setForm({ ...form, includeAllArtists: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <label htmlFor="includeAllArtists" className="text-sm">
                      <span className="font-medium">Include Featured Artists</span>
                      <p className="text-muted-foreground text-xs mt-0.5">
                        Include all artists from collaborations, not just primary artists.
                      </p>
                    </label>
                  </div>
                )}
              </div>
            )}

            {form.type === 'deezer_playlist' && (
              <div>
                <label className="text-sm font-medium">
                  Playlist ID{REQUIRED_FIELDS[form.type]?.some(r => r.field === 'playlistId') && <span className="text-red-500 ml-1">*</span>}
                </label>
                <Input
                  value={form.playlistId}
                  onChange={(e) => setForm({ ...form, playlistId: e.target.value })}
                  placeholder="Deezer playlist ID"
                />
                {validationErrors.playlistId && (
                  <p className="text-xs text-red-600 mt-1">{validationErrors.playlistId}</p>
                )}
              </div>
            )}

            {form.type === 'tidal_playlist' && (
              <div>
                <label className="text-sm font-medium">
                  Playlist ID{REQUIRED_FIELDS[form.type]?.some(r => r.field === 'playlistId') && <span className="text-red-500 ml-1">*</span>}
                </label>
                <Input
                  value={form.playlistId}
                  onChange={(e) => setForm({ ...form, playlistId: e.target.value })}
                  placeholder="TIDAL playlist UUID"
                />
                {validationErrors.playlistId && (
                  <p className="text-xs text-red-600 mt-1">{validationErrors.playlistId}</p>
                )}
              </div>
            )}

            {(form.type === 'listenbrainz_top' || form.type === 'listenbrainz_similar') && (
              <div>
                <label className="text-sm font-medium">Time Period</label>
                <Select
                  value={form.listenbrainzPeriod}
                  onChange={(e) => setForm({ ...form, listenbrainzPeriod: e.target.value })}
                  options={[
                    { value: 'week', label: 'Last Week' },
                    { value: 'month', label: 'Last Month' },
                    { value: 'quarter', label: 'Last 3 Months' },
                    { value: 'half_yearly', label: 'Last 6 Months' },
                    { value: 'year', label: 'Last Year' },
                    { value: 'all_time', label: 'All Time' },
                  ]}
                />
              </div>
            )}

            {form.type === 'listenbrainz_recommendations' && (
              <div>
                <label className="text-sm font-medium">Recommendation Type</label>
                <Select
                  value={form.listenbrainzRecType}
                  onChange={(e) => setForm({ ...form, listenbrainzRecType: e.target.value })}
                  options={[
                    { value: 'similar_artist', label: 'Similar Artists' },
                    { value: 'top_artist', label: 'Based on Top Artists' },
                  ]}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Choose how ListenBrainz generates recommendations for you.
                </p>
              </div>
            )}

            {form.type === 'listenbrainz_year' && (
              <div>
                <label className="text-sm font-medium">Year</label>
                <Input
                  type="number"
                  value={form.listenbrainzYear}
                  onChange={(e) => setForm({ ...form, listenbrainzYear: e.target.value })}
                  placeholder={String(new Date().getFullYear())}
                  min="2014"
                  max={new Date().getFullYear()}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Get your top artists from a specific year (2014-present).
                </p>
              </div>
            )}

            {form.type === 'listenbrainz_playlist' && (
              <div>
                <label className="text-sm font-medium">
                  Playlist ID{REQUIRED_FIELDS[form.type]?.some(r => r.field === 'listenbrainzPlaylistId') && <span className="text-red-500 ml-1">*</span>}
                </label>
                <Input
                  value={form.listenbrainzPlaylistId}
                  onChange={(e) => setForm({ ...form, listenbrainzPlaylistId: e.target.value })}
                  placeholder="e.g., abc123-def456-..."
                />
                <p className="text-xs text-muted-foreground mt-1">
                  The playlist MBID from the ListenBrainz playlist URL.
                </p>
                {validationErrors.listenbrainzPlaylistId && (
                  <p className="text-xs text-red-600 mt-1">{validationErrors.listenbrainzPlaylistId}</p>
                )}
              </div>
            )}

            {form.type === 'listenbrainz_radio' && (
              <>
                <div className="relative">
                  <label className="text-sm font-medium">
                    Seed Artist {REQUIRED_FIELDS[form.type]?.some(r => r.field === 'listenbrainzSeedMbid') && <span className="text-red-500">*</span>}
                  </label>
                  <div className="relative">
                    <Input
                      value={artistSearch}
                      onChange={(e) => {
                        setArtistSearch(e.target.value);
                        // Clear the MBID if user is typing a new search
                        if (form.listenbrainzSeedMbid) {
                          setForm({ ...form, listenbrainzSeedMbid: '' });
                        }
                      }}
                      onFocus={() => artistResults.length > 0 && setShowArtistDropdown(true)}
                      onBlur={() => setTimeout(() => setShowArtistDropdown(false), 200)}
                      placeholder="Search for an artist..."
                    />
                    {isSearchingArtist && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                  
                  {/* Dropdown results */}
                  {showArtistDropdown && artistResults.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-auto">
                      {artistResults.map((artist) => (
                        <button
                          key={artist.id}
                          type="button"
                          className="w-full px-3 py-2 text-left hover:bg-accent flex flex-col"
                          onClick={() => {
                            setForm({ ...form, listenbrainzSeedMbid: artist.id });
                            setArtistSearch(artist.name);
                            setShowArtistDropdown(false);
                          }}
                        >
                          <span className="font-medium">{artist.name}</span>
                          {artist.disambiguation && (
                            <span className="text-xs text-muted-foreground">{artist.disambiguation}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  
                  {/* Show selected MBID */}
                  {form.listenbrainzSeedMbid && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Selected MBID: <code className="bg-muted px-1 rounded">{form.listenbrainzSeedMbid}</code>
                    </p>
                  )}
                  
                  {!form.listenbrainzSeedMbid && artistSearch.length >= 2 && !isSearchingArtist && artistResults.length === 0 && (
                    <p className="text-xs text-muted-foreground mt-1">No artists found. Try a different search.</p>
                  )}
                  
                  {validationErrors.listenbrainzSeedMbid && (
                    <p className="text-xs text-red-600 mt-1">{validationErrors.listenbrainzSeedMbid}</p>
                  )}
                </div>
                
                {/* Keep advanced MBID input as fallback */}
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Advanced: Enter MBID directly
                  </summary>
                  <div className="mt-2">
                    <Input
                      value={form.listenbrainzSeedMbid}
                      onChange={(e) => {
                        setForm({ ...form, listenbrainzSeedMbid: e.target.value });
                        // Clear search when manually entering MBID
                        if (artistSearch) setArtistSearch('');
                      }}
                      placeholder="e.g., 8bfac288-ccc5-448d-9573-c33ea2aa5c30"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Find the MBID from the MusicBrainz artist URL.
                    </p>
                  </div>
                </details>
                
                <div>
                  <label className="text-sm font-medium">Radio Mode</label>
                  <Select
                    value={form.listenbrainzRadioMode}
                    onChange={(e) => setForm({ ...form, listenbrainzRadioMode: e.target.value })}
                    options={[
                      { value: 'easy', label: 'Easy (more similar)' },
                      { value: 'medium', label: 'Medium (balanced)' },
                      { value: 'hard', label: 'Hard (more adventurous)' },
                    ]}
                  />
                </div>
              </>
            )}

            {form.type === 'discogs_label' && (
              <>
                <div>
                  <label className="text-sm font-medium">
                    Label ID{REQUIRED_FIELDS[form.type]?.some(r => r.field === 'labelId') && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <Input
                    value={form.labelId}
                    onChange={(e) => setForm({ ...form, labelId: e.target.value })}
                    placeholder="Discogs label ID (e.g., 1234)"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Find the label ID from the Discogs URL: discogs.com/label/<strong>1234</strong>-Label-Name
                  </p>
                  {validationErrors.labelId && (
                    <p className="text-xs text-red-600 mt-1">{validationErrors.labelId}</p>
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium">Label Name (for display)</label>
                  <Input
                    value={form.labelName}
                    onChange={(e) => setForm({ ...form, labelName: e.target.value })}
                    placeholder="e.g., Warp Records"
                  />
                </div>
              </>
            )}

            {form.type === 'discogs_style' && (
              <div>
                <label className="text-sm font-medium">
                  Style/Genre{REQUIRED_FIELDS[form.type]?.some(r => r.field === 'discogsStyle') && <span className="text-red-500 ml-1">*</span>}
                </label>
                <Select
                  value={form.discogsStyle}
                  onChange={(e) => setForm({ ...form, discogsStyle: e.target.value })}
                  options={[
                    { value: '', label: 'Select a style...' },
                    { value: 'Rock', label: 'Rock' },
                    { value: 'Electronic', label: 'Electronic' },
                    { value: 'Jazz', label: 'Jazz' },
                    { value: 'Funk / Soul', label: 'Funk / Soul' },
                    { value: 'Hip Hop', label: 'Hip Hop' },
                    { value: 'Classical', label: 'Classical' },
                    { value: 'Pop', label: 'Pop' },
                    { value: 'Folk, World, & Country', label: 'Folk, World, & Country' },
                    { value: 'Reggae', label: 'Reggae' },
                    { value: 'Latin', label: 'Latin' },
                    { value: 'Blues', label: 'Blues' },
                    { value: 'Non-Music', label: 'Non-Music (Spoken, Comedy)' },
                    { value: 'Stage & Screen', label: 'Stage & Screen (Soundtracks)' },
                    { value: 'Brass & Military', label: 'Brass & Military' },
                    { value: "Children's", label: "Children's" },
                  ]}
                />
                {validationErrors.discogsStyle && (
                  <p className="text-xs text-red-600 mt-1">{validationErrors.discogsStyle}</p>
                )}
              </div>
            )}

            {(form.type === 'bandcamp_tag' || form.type === 'bandcamp_new') && (
              <>
                <div>
                  <label className="text-sm font-medium">
                    Tag{REQUIRED_FIELDS[form.type]?.some(r => r.field === 'bandcampTag') && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <Input
                    value={form.bandcampTag}
                    onChange={(e) => setForm({ ...form, bandcampTag: e.target.value })}
                    placeholder="e.g., electronic, metal, ambient"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Browse tags at bandcamp.com/tags
                  </p>
                  {validationErrors.bandcampTag && (
                    <p className="text-xs text-red-600 mt-1">{validationErrors.bandcampTag}</p>
                  )}
                </div>
                {form.type === 'bandcamp_tag' && (
                  <div>
                    <label className="text-sm font-medium">Sort By</label>
                    <Select
                      value={form.bandcampSort}
                      onChange={(e) => setForm({ ...form, bandcampSort: e.target.value })}
                      options={[
                        { value: 'pop', label: 'Popularity' },
                        { value: 'date', label: 'Newest' },
                      ]}
                    />
                  </div>
                )}
              </>
            )}

            {form.type === 'ai_recommendation' && (
              <>
                <div>
                  <label className="text-sm font-medium">AI Source</label>
                  <Select
                    value={form.aiSource}
                    onChange={(e) => setForm({ ...form, aiSource: e.target.value })}
                    options={[
                      { value: 'spotify', label: 'Spotify Library' },
                      { value: 'lastfm', label: 'Last.fm Scrobbles' },
                    ]}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Which library to base recommendations on
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium">AI Strategy</label>
                  <Select
                    value={form.aiStrategy}
                    onChange={(e) => setForm({ ...form, aiStrategy: e.target.value })}
                    options={[
                      { value: 'similar', label: 'Similar Artists' },
                      { value: 'genre_expansion', label: 'Genre Expansion' },
                      { value: 'discovery', label: 'Discovery (Adventurous)' },
                    ]}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {form.aiStrategy === 'similar' && 'Find artists with similar sound and style'}
                    {form.aiStrategy === 'genre_expansion' && 'Explore related genres and subgenres'}
                    {form.aiStrategy === 'discovery' && 'Discover new and diverse artists'}
                  </p>
                </div>
              </>
            )}

            <ModalFooter>
              <Button variant="outline" onClick={closeModal}>Cancel</Button>
              <Button onClick={handleSave}>Save</Button>
            </ModalFooter>
          </div>
        )}
      </Modal>
    </>
  );
}
