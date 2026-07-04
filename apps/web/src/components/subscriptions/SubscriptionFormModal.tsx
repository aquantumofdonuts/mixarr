'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import {
  subscriptionTypes,
  presetCategories,
  scheduleOptions,
  REQUIRED_FIELDS,
  getResultHandlingOptions,
  getSubscriptionTypeConfig,
} from '@/lib/subscription-constants';
import { buildSubscriptionDescriptor } from '@/lib/subscription-descriptor';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import Plus from 'lucide-react/dist/esm/icons/plus';

// ============================================================================
// Types
// ============================================================================

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

interface SubscriptionFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingSubscription: Subscription | null;
  presets: Preset[];
  hasLidarr: boolean;
  onSave: (data: {
    id?: number;
    name: string;
    type: string;
    config: Record<string, unknown>;
    schedule: string;
    resultHandling: string;
  }) => Promise<void>;
}

// ============================================================================
// Form State Type
// ============================================================================

interface FormState {
  type: string;
  name: string;
  schedule: string;
  resultHandling: string;
  limit: string;
  country: string;
  tag: string;
  playlistId: string;
  aiStrategy: string;
  aiSource: string;
  // Discogs fields
  labelId: string;
  labelName: string;
  discogsStyle: string;
  // Bandcamp fields
  bandcampTag: string;
  bandcampSort: string;
  // ListenBrainz fields
  listenbrainzPeriod: string;
  listenbrainzRecType: string;
  listenbrainzYear: string;
  listenbrainzPlaylistId: string;
  listenbrainzSeedMbid: string;
  listenbrainzRadioMode: string;
  // Public playlist fields
  publicPlaylistUrl: string;
  includeAllArtists: boolean;
  discoverAlbums: boolean;
}

const getDefaultFormState = (): FormState => ({
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

/** Map a stored config object onto form fields; shared by edit and preset flows. */
const buildFormState = (
  type: string,
  name: string,
  config: Record<string, unknown>,
  overrides: Partial<Pick<FormState, 'schedule' | 'resultHandling'>> = {}
): FormState => ({
  type,
  name,
  schedule: overrides.schedule ?? '',
  resultHandling: overrides.resultHandling ?? 'preview',
  limit: (config.limit as number)?.toString() || '50',
  country: (config.country as string) || '',
  tag: (config.tag as string) || (config.categoryId as string) || '',
  playlistId: (config.playlistId as string) || '',
  aiStrategy: (config.strategy as string) || 'similar',
  aiSource: (config.source as string) || 'spotify',
  labelId: (config.labelId as number)?.toString() || '',
  labelName: (config.labelName as string) || '',
  discogsStyle: (config.style as string) || '',
  bandcampTag: (config.tag as string) || '',
  bandcampSort: (config.sort as string) || 'pop',
  listenbrainzPeriod: (config.period as string) || 'all_time',
  listenbrainzRecType: (config.recommendationType as string) || 'similar_artist',
  listenbrainzYear: (config.year as number)?.toString() || String(new Date().getFullYear()),
  listenbrainzPlaylistId: (config.playlistId as string) || '',
  listenbrainzSeedMbid: (config.seedMbid as string) || '',
  listenbrainzRadioMode: (config.mode as string) || 'medium',
  publicPlaylistUrl: (config.playlistUrl as string) || '',
  includeAllArtists: (config.includeAllArtists as boolean) || false,
  discoverAlbums: (config.discoverAlbums as boolean) || false,
});

const getFormStateFromSubscription = (subscription: Subscription): FormState =>
  buildFormState(subscription.type, subscription.name, subscription.config, {
    schedule: subscription.schedule || '',
    resultHandling: subscription.resultHandling || 'preview',
  });

const getFormStateFromPreset = (preset: Preset): FormState =>
  buildFormState(preset.type, preset.name, preset.config);

// ============================================================================
// Component
// ============================================================================

export function SubscriptionFormModal({
  isOpen,
  onClose,
  editingSubscription,
  presets,
  hasLidarr,
  onSave,
}: SubscriptionFormModalProps) {
  // Modal step state
  const [modalStep, setModalStep] = useState<'presets' | 'form'>('presets');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedFromPreset, setSelectedFromPreset] = useState(false);

  // Form state
  const [form, setForm] = useState<FormState>(getDefaultFormState());
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Artist search autocomplete state (for listenbrainz_radio)
  const [artistSearch, setArtistSearch] = useState('');
  const [artistResults, setArtistResults] = useState<Array<{ id: string; name: string; disambiguation?: string }>>([]);
  const [isSearchingArtist, setIsSearchingArtist] = useState(false);
  const [showArtistDropdown, setShowArtistDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  // Name editing state (for edit mode pencil-to-unlock)
  const [isNameEditing, setIsNameEditing] = useState(false);

  // Compute derived values
  const resultHandlingOptions = getResultHandlingOptions(hasLidarr);
  const typeConfig = getSubscriptionTypeConfig(form.type);
  const filteredPresets = selectedCategory
    ? presets.filter((p) => p.category === selectedCategory)
    : presets;

  // Reset modal state when opened/closed or when editing subscription changes
  useEffect(() => {
    if (isOpen) {
      if (editingSubscription) {
        setForm(getFormStateFromSubscription(editingSubscription));
        setModalStep('form');
      } else {
        setForm(getDefaultFormState());
        setModalStep('presets');
        setSelectedCategory(null);
      }
      setSelectedFromPreset(false);
      setValidationErrors({});
      setSubmitError(null);
      setIsSubmitting(false);
      setArtistSearch('');
      setArtistResults([]);
      setShowArtistDropdown(false);
      setIsNameEditing(false);
    }
  }, [isOpen, editingSubscription]);

  // Search artists with debounce for listenbrainz_radio
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
        setHighlightedIndex(-1);
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

  // Validation
  const validateForm = (): Record<string, string> => {
    const errors: Record<string, string> = {};

    // Validate name
    const trimmedName = (form.name || '').trim();
    if (trimmedName.length === 0) {
      errors.name = 'Name is required';
    } else if (trimmedName.length > 255) {
      errors.name = 'Name must be 255 characters or less';
    }

    // Validate limit (the number input doesn't enforce min/max for typed values)
    const limitValue = parseInt(form.limit, 10);
    if (isNaN(limitValue) || limitValue < 1 || limitValue > 200) {
      errors.limit = 'Limit must be a number between 1 and 200';
    }

    // Validate type-specific required fields
    const requiredFields = REQUIRED_FIELDS[form.type] || [];

    for (const { field, label } of requiredFields) {
      const value = form[field as keyof FormState];
      if (!value || (typeof value === 'string' && value.trim() === '')) {
        errors[field] = `${label} is required`;
      }
    }

    return errors;
  };

  // Build config object from form state
  const buildConfig = (): Record<string, unknown> => {
    const config: Record<string, unknown> = { limit: parseInt(form.limit, 10) };

    if (form.type === 'lastfm_chart' || form.type === 'lastfm_geo') {
      config.country = form.country || 'global';
    }
    if (form.type === 'lastfm_tag' || form.type === 'lastfm_tag_albums' || form.type === 'lastfm_tag_similar') {
      config.tag = form.tag;
    }
    if (form.type === 'spotify_category') {
      config.categoryId = form.tag;
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

    return config;
  };

  const descriptorPreview = buildSubscriptionDescriptor(form.type, buildConfig(), typeConfig?.label || form.type);

  // Handlers
  const handleSave = async () => {
    if (isSubmitting) return;

    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      return;
    }
    setValidationErrors({});
    setSubmitError(null);

    const config = buildConfig();
    const name = (form.name || subscriptionTypes.find((t) => t.value === form.type)?.label || form.type).trim();

    setIsSubmitting(true);
    try {
      await onSave({
        id: editingSubscription?.id,
        name,
        type: form.type,
        config,
        schedule: form.schedule || '',
        resultHandling: form.resultHandling,
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Failed to save subscription');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectPreset = (preset: Preset) => {
    setForm(getFormStateFromPreset(preset));
    setSelectedFromPreset(true);
    setModalStep('form');
  };

  const handleClose = () => {
    setValidationErrors({});
    setArtistSearch('');
    setArtistResults([]);
    setShowArtistDropdown(false);
    onClose();
  };

  const handleTypeChange = (newType: string) => {
    const newTypeLabel = subscriptionTypes.find((t) => t.value === newType)?.label || newType;
    setForm({ ...form, type: newType, name: newTypeLabel });
    setValidationErrors({});
    setArtistSearch('');
    setArtistResults([]);
  };

  // Modal title
  const modalTitle = editingSubscription
    ? 'Edit Subscription'
    : modalStep === 'presets'
      ? 'Choose a Preset'
      : 'Configure Subscription';

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={modalTitle} size="lg">
      {/* Step 1: Preset Selection (only for new subscriptions) */}
      {!editingSubscription && modalStep === 'presets' && (
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
            {presetCategories.map((cat) => (
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
              filteredPresets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => selectPreset(preset)}
                  className="w-full flex items-center justify-between p-3 rounded-container border hover:bg-accent transition-colors text-left"
                >
                  <div>
                    <p className="font-medium">{preset.name}</p>
                    <p className="text-sm text-muted-foreground">{preset.description}</p>
                    {typeof preset.config.tag === 'string' && preset.config.tag && (
                      <p className="text-xs text-muted-foreground/70 mt-0.5 italic">Tag can be changed to any genre</p>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))
            )}
          </div>

          <div className="border-t pt-4">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setSelectedFromPreset(false);
                setModalStep('form');
              }}
            >
              <Plus className="h-4 w-4 mr-2" /> Create Custom Subscription
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Configuration Form */}
      {(editingSubscription || modalStep === 'form') && (
        <div className="space-y-4">
          {!editingSubscription && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedFromPreset(false);
                setModalStep('presets');
              }}
              className="mb-2"
            >
              ← Back to Presets
            </Button>
          )}

          {/* Subscription Type */}
          <div>
            <label className="text-sm font-medium" htmlFor="sub-type">Type</label>
            <Select
              id="sub-type"
              value={form.type}
              onChange={(e) => handleTypeChange(e.target.value)}
              options={subscriptionTypes.map((t) => ({
                value: t.value,
                label: `${t.label}${t.warning ? ' (!)' : ''}`,
                sublabel: t.description,
              }))}
              disabled={!!editingSubscription || selectedFromPreset}
            />
            {typeConfig && <p className="text-xs text-muted-foreground mt-1">{typeConfig.description}</p>}
            {typeConfig?.warning && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> {typeConfig.warning}
              </p>
            )}
          </div>

          {/* Display Label */}
          <div>
            <label className="text-sm font-medium" htmlFor="sub-name">Display Label</label>
            {editingSubscription && !isNameEditing ? (
              <div className="flex gap-2">
                <Input
                  id="sub-name"
                  value={form.name || descriptorPreview || typeConfig?.label || ''}
                  readOnly
                  className="bg-muted cursor-not-allowed flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsNameEditing(true)}
                  title="Rename subscription"
                  className="shrink-0"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Input
                id="sub-name"
                value={form.name || (editingSubscription ? '' : typeConfig?.label || '')}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={descriptorPreview}
                autoFocus={isNameEditing}
                maxLength={255}
              />
            )}
            {validationErrors.name && (
              <p className="text-xs text-destructive mt-1">{validationErrors.name}</p>
            )}
          </div>

          {/* Schedule */}
          <div>
            <label className="text-sm font-medium" htmlFor="sub-schedule">Schedule</label>
            <Select
              id="sub-schedule"
              value={form.schedule}
              onChange={(e) => setForm({ ...form, schedule: e.target.value })}
              options={scheduleOptions}
            />
          </div>

          {/* Result Handling */}
          <div>
            <label className="text-sm font-medium" htmlFor="sub-result-handling">Result Handling</label>
            <Select
              id="sub-result-handling"
              value={form.resultHandling}
              onChange={(e) => setForm({ ...form, resultHandling: e.target.value })}
              options={resultHandlingOptions}
            />
            <p className="text-xs text-muted-foreground mt-1">
              {form.resultHandling === 'preview' && 'Results are stored for viewing but not added to Lidarr'}
              {form.resultHandling === 'queue' && 'Results are added to review queue for manual approval'}
              {form.resultHandling === 'auto' && 'Results are automatically added to Lidarr'}
            </p>
            {!hasLidarr && form.resultHandling === 'auto' && (
              <p className="text-xs text-amber-500 mt-1">
                Auto-add requires a Lidarr connection. Results will be queued instead.
              </p>
            )}
          </div>

          {/* Limit */}
          <div>
            <label className="text-sm font-medium" htmlFor="sub-limit">Limit</label>
            <Input
              id="sub-limit"
              type="number"
              value={form.limit}
              onChange={(e) => setForm({ ...form, limit: e.target.value })}
              placeholder="50"
              min="1"
              max="200"
            />
            {validationErrors.limit && (
              <p className="text-xs text-destructive mt-1">{validationErrors.limit}</p>
            )}
          </div>

          {/* ============================================================== */}
          {/* Type-Specific Fields */}
          {/* ============================================================== */}

          {/* Last.fm Chart / Geo - Country */}
          {(form.type === 'lastfm_chart' || form.type === 'lastfm_geo') && (
            <div>
              <label className="text-sm font-medium" htmlFor="sub-country">Country</label>
              <Input
                id="sub-country"
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                placeholder="global"
              />
            </div>
          )}

          {/* Last.fm Tag */}
          {(form.type === 'lastfm_tag' || form.type === 'lastfm_tag_albums' || form.type === 'lastfm_tag_similar') && (
            <div>
              <label className="text-sm font-medium" htmlFor="sub-tag">
                Tag
                {REQUIRED_FIELDS[form.type]?.some((r) => r.field === 'tag') && (
                  <span className="text-destructive ml-1">*</span>
                )}
              </label>
              <Input
                id="sub-tag"
                value={form.tag}
                onChange={(e) => setForm({ ...form, tag: e.target.value })}
                placeholder="e.g., rock, metal, jazz"
              />
              {selectedFromPreset && form.tag && (
                <p className="text-xs text-muted-foreground mt-1">Pre-filled from preset — change to any tag you like</p>
              )}
              {validationErrors.tag && <p className="text-xs text-destructive mt-1">{validationErrors.tag}</p>}
            </div>
          )}

          {/* Spotify Playlist */}
          {form.type === 'spotify_playlist' && (
            <div>
              <label className="text-sm font-medium" htmlFor="sub-playlist-id">
                Playlist ID
                {REQUIRED_FIELDS[form.type]?.some((r) => r.field === 'playlistId') && (
                  <span className="text-destructive ml-1">*</span>
                )}
              </label>
              <Input
                id="sub-playlist-id"
                value={form.playlistId}
                onChange={(e) => setForm({ ...form, playlistId: e.target.value })}
                placeholder="Spotify playlist ID"
              />
              {validationErrors.playlistId && (
                <p className="text-xs text-destructive mt-1">{validationErrors.playlistId}</p>
              )}
            </div>
          )}

          {/* Spotify Public Playlist */}
          {form.type === 'spotify_public_playlist' && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium" htmlFor="sub-playlist-url">
                  Playlist URL
                  {REQUIRED_FIELDS[form.type]?.some((r) => r.field === 'publicPlaylistUrl') && (
                    <span className="text-destructive ml-1">*</span>
                  )}
                </label>
                <Input
                  id="sub-playlist-url"
                  value={form.publicPlaylistUrl}
                  onChange={(e) => setForm({ ...form, publicPlaylistUrl: e.target.value })}
                  placeholder="https://open.spotify.com/playlist/..."
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Paste any public Spotify playlist URL (no login required)
                </p>
                {validationErrors.publicPlaylistUrl && (
                  <p className="text-xs text-destructive mt-1">{validationErrors.publicPlaylistUrl}</p>
                )}
              </div>
              <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-container">
                <input
                  type="checkbox"
                  id="discoverAlbums"
                  checked={form.discoverAlbums}
                  onChange={(e) => setForm({ ...form, discoverAlbums: e.target.checked })}
                  className="h-4 w-4 rounded border-input"
                />
                <label htmlFor="discoverAlbums" className="text-sm">
                  <span className="font-medium">Discover Albums</span>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    Queue albums instead of artists. Only specific albums will be monitored in Lidarr.
                  </p>
                </label>
              </div>
              {!form.discoverAlbums && (
                <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-container">
                  <input
                    type="checkbox"
                    id="includeAllArtists"
                    checked={form.includeAllArtists}
                    onChange={(e) => setForm({ ...form, includeAllArtists: e.target.checked })}
                    className="h-4 w-4 rounded border-input"
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

          {/* Deezer Playlist */}
          {form.type === 'deezer_playlist' && (
            <div>
              <label className="text-sm font-medium" htmlFor="sub-playlist-id">
                Playlist ID
                {REQUIRED_FIELDS[form.type]?.some((r) => r.field === 'playlistId') && (
                  <span className="text-destructive ml-1">*</span>
                )}
              </label>
              <Input
                id="sub-playlist-id"
                value={form.playlistId}
                onChange={(e) => setForm({ ...form, playlistId: e.target.value })}
                placeholder="Deezer playlist ID"
              />
              {validationErrors.playlistId && (
                <p className="text-xs text-destructive mt-1">{validationErrors.playlistId}</p>
              )}
            </div>
          )}

          {/* TIDAL Playlist */}
          {form.type === 'tidal_playlist' && (
            <div>
              <label className="text-sm font-medium" htmlFor="sub-playlist-id">
                Playlist ID
                {REQUIRED_FIELDS[form.type]?.some((r) => r.field === 'playlistId') && (
                  <span className="text-destructive ml-1">*</span>
                )}
              </label>
              <Input
                id="sub-playlist-id"
                value={form.playlistId}
                onChange={(e) => setForm({ ...form, playlistId: e.target.value })}
                placeholder="TIDAL playlist UUID"
              />
              {validationErrors.playlistId && (
                <p className="text-xs text-destructive mt-1">{validationErrors.playlistId}</p>
              )}
            </div>
          )}

          {/* ListenBrainz Top / Similar - Time Period */}
          {(form.type === 'listenbrainz_top' || form.type === 'listenbrainz_similar') && (
            <div>
              <label className="text-sm font-medium" htmlFor="sub-lb-period">Time Period</label>
              <Select
                id="sub-lb-period"
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

          {/* ListenBrainz Recommendations - Recommendation Type */}
          {form.type === 'listenbrainz_recommendations' && (
            <div>
              <label className="text-sm font-medium" htmlFor="sub-lb-rectype">Recommendation Type</label>
              <Select
                id="sub-lb-rectype"
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

          {/* ListenBrainz Year */}
          {form.type === 'listenbrainz_year' && (
            <div>
              <label className="text-sm font-medium" htmlFor="sub-lb-year">Year</label>
              <Input
                id="sub-lb-year"
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

          {/* ListenBrainz Playlist */}
          {form.type === 'listenbrainz_playlist' && (
            <div>
              <label className="text-sm font-medium" htmlFor="sub-lb-playlist-id">
                Playlist ID
                {REQUIRED_FIELDS[form.type]?.some((r) => r.field === 'listenbrainzPlaylistId') && (
                  <span className="text-destructive ml-1">*</span>
                )}
              </label>
              <Input
                id="sub-lb-playlist-id"
                value={form.listenbrainzPlaylistId}
                onChange={(e) => setForm({ ...form, listenbrainzPlaylistId: e.target.value })}
                placeholder="e.g., abc123-def456-..."
              />
              <p className="text-xs text-muted-foreground mt-1">
                The playlist MBID from the ListenBrainz playlist URL.
              </p>
              {validationErrors.listenbrainzPlaylistId && (
                <p className="text-xs text-destructive mt-1">{validationErrors.listenbrainzPlaylistId}</p>
              )}
            </div>
          )}

          {/* ListenBrainz Radio - Artist Search + Radio Mode */}
          {form.type === 'listenbrainz_radio' && (
            <>
              <div className="relative">
                <label className="text-sm font-medium" htmlFor="sub-seed-artist">
                  Seed Artist{' '}
                  {REQUIRED_FIELDS[form.type]?.some((r) => r.field === 'listenbrainzSeedMbid') && (
                    <span className="text-destructive">*</span>
                  )}
                </label>
                <div className="relative">
                  <Input
                    id="sub-seed-artist"
                    role="combobox"
                    aria-expanded={showArtistDropdown && artistResults.length > 0}
                    aria-controls="seed-artist-listbox"
                    aria-autocomplete="list"
                    aria-activedescendant={
                      highlightedIndex >= 0 ? `seed-artist-option-${highlightedIndex}` : undefined
                    }
                    value={artistSearch}
                    onChange={(e) => {
                      setArtistSearch(e.target.value);
                      // Clear the MBID if user is typing a new search
                      if (form.listenbrainzSeedMbid) {
                        setForm({ ...form, listenbrainzSeedMbid: '' });
                      }
                    }}
                    onFocus={() => artistResults.length > 0 && setShowArtistDropdown(true)}
                    onBlur={() => setShowArtistDropdown(false)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setShowArtistDropdown(true);
                        setHighlightedIndex((i) => Math.min(i + 1, artistResults.length - 1));
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setHighlightedIndex((i) => Math.max(i - 1, 0));
                      } else if (e.key === 'Enter') {
                        if (showArtistDropdown && highlightedIndex >= 0 && artistResults[highlightedIndex]) {
                          e.preventDefault();
                          const artist = artistResults[highlightedIndex];
                          setForm({ ...form, listenbrainzSeedMbid: artist.id });
                          setArtistSearch(artist.name);
                          setShowArtistDropdown(false);
                        }
                      } else if (e.key === 'Escape') {
                        setShowArtistDropdown(false);
                      }
                    }}
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
                  <div
                    id="seed-artist-listbox"
                    role="listbox"
                    className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-auto"
                  >
                    {artistResults.map((artist, idx) => (
                      <button
                        key={artist.id}
                        id={`seed-artist-option-${idx}`}
                        type="button"
                        role="option"
                        aria-selected={idx === highlightedIndex}
                        className={`w-full px-3 py-2 text-left hover:bg-accent flex flex-col ${
                          idx === highlightedIndex ? 'bg-accent' : ''
                        }`}
                        // Prevent the input blur so onClick fires reliably
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setHighlightedIndex(idx)}
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

                {!form.listenbrainzSeedMbid &&
                  artistSearch.length >= 2 &&
                  !isSearchingArtist &&
                  artistResults.length === 0 && (
                    <p className="text-xs text-muted-foreground mt-1">No artists found. Try a different search.</p>
                  )}

                {validationErrors.listenbrainzSeedMbid && (
                  <p className="text-xs text-destructive mt-1">{validationErrors.listenbrainzSeedMbid}</p>
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
                <label className="text-sm font-medium" htmlFor="sub-lb-radio-mode">Radio Mode</label>
                <Select
                  id="sub-lb-radio-mode"
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

          {/* Discogs Label */}
          {form.type === 'discogs_label' && (
            <>
              <div>
                <label className="text-sm font-medium" htmlFor="sub-label-id">
                  Label ID
                  {REQUIRED_FIELDS[form.type]?.some((r) => r.field === 'labelId') && (
                    <span className="text-destructive ml-1">*</span>
                  )}
                </label>
                <Input
                  id="sub-label-id"
                  value={form.labelId}
                  onChange={(e) => setForm({ ...form, labelId: e.target.value })}
                  placeholder="Discogs label ID (e.g., 1234)"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Find the label ID from the Discogs URL: discogs.com/label/<strong>1234</strong>-Label-Name
                </p>
                {validationErrors.labelId && <p className="text-xs text-destructive mt-1">{validationErrors.labelId}</p>}
              </div>
              <div>
                <label className="text-sm font-medium" htmlFor="sub-label-name">Label Name (for display)</label>
                <Input
                  id="sub-label-name"
                  value={form.labelName}
                  onChange={(e) => setForm({ ...form, labelName: e.target.value })}
                  placeholder="e.g., Warp Records"
                />
              </div>
            </>
          )}

          {/* Discogs Style */}
          {form.type === 'discogs_style' && (
            <div>
              <label className="text-sm font-medium" htmlFor="sub-discogs-style">
                Style/Genre
                {REQUIRED_FIELDS[form.type]?.some((r) => r.field === 'discogsStyle') && (
                  <span className="text-destructive ml-1">*</span>
                )}
              </label>
              <Select
                id="sub-discogs-style"
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
                <p className="text-xs text-destructive mt-1">{validationErrors.discogsStyle}</p>
              )}
            </div>
          )}

          {/* Bandcamp Tag / New */}
          {(form.type === 'bandcamp_tag' || form.type === 'bandcamp_new') && (
            <>
              <div>
                <label className="text-sm font-medium" htmlFor="sub-bandcamp-tag">
                  Tag
                  {REQUIRED_FIELDS[form.type]?.some((r) => r.field === 'bandcampTag') && (
                    <span className="text-destructive ml-1">*</span>
                  )}
                </label>
                <Input
                  id="sub-bandcamp-tag"
                  value={form.bandcampTag}
                  onChange={(e) => setForm({ ...form, bandcampTag: e.target.value })}
                  placeholder="e.g., electronic, metal, ambient"
                />
                <p className="text-xs text-muted-foreground mt-1">Browse tags at bandcamp.com/tags</p>
                {validationErrors.bandcampTag && (
                  <p className="text-xs text-destructive mt-1">{validationErrors.bandcampTag}</p>
                )}
              </div>
              {form.type === 'bandcamp_tag' && (
                <div>
                  <label className="text-sm font-medium" htmlFor="sub-bandcamp-sort">Sort By</label>
                  <Select
                    id="sub-bandcamp-sort"
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

          {/* AI Recommendation */}
          {form.type === 'ai_recommendation' && (
            <>
              <div>
                <label className="text-sm font-medium" htmlFor="sub-ai-source">AI Source</label>
                <Select
                  id="sub-ai-source"
                  value={form.aiSource}
                  onChange={(e) => setForm({ ...form, aiSource: e.target.value })}
                  options={[
                    { value: 'spotify', label: 'Spotify Library' },
                    { value: 'lastfm', label: 'Last.fm Scrobbles' },
                  ]}
                />
                <p className="text-xs text-muted-foreground mt-1">Which library to base recommendations on</p>
              </div>
              <div>
                <label className="text-sm font-medium" htmlFor="sub-ai-strategy">AI Strategy</label>
                <Select
                  id="sub-ai-strategy"
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

          {/* Footer */}
          {submitError && (
            <p className="text-sm text-destructive flex items-center gap-1">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {submitError}
            </p>
          )}
          <ModalFooter>
            <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save'}
            </Button>
          </ModalFooter>
        </div>
      )}
    </Modal>
  );
}
