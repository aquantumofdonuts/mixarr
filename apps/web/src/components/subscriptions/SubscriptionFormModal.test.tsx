import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SubscriptionFormModal } from './SubscriptionFormModal';
import type { Subscription } from './SubscriptionCard';

const base: Subscription = { id: 11, userId: 7, name: 'Night discoveries', type: 'spotify_playlist', config: { limit: 10 }, schedule: '', resultHandling: 'preview', isActive: true, lastRun: null, lastRunStatus: null, lastRunCount: null, nextRun: null };
describe('subscription form validation', () => {
  it('renders a required editable category input before attempting to save', () => {
    render(<SubscriptionFormModal isOpen onClose={vi.fn()} editingSubscription={{ ...base, type: 'spotify_category' }} presets={[]} hasLidarr onSave={vi.fn()} />);
    const category = screen.getByLabelText(/Category/);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(category).toHaveFocus(); expect(category).toHaveAccessibleDescription('Category is required');
  });
  it('lets a new subscription label be cleared and focuses its required error', () => {
    render(<SubscriptionFormModal isOpen onClose={vi.fn()} editingSubscription={null} presets={[]} hasLidarr onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Create Custom Subscription/ }));
    const name = screen.getByLabelText('Display Label');
    fireEvent.change(name, { target: { value: '' } });
    expect(name).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(name).toHaveFocus(); expect(name).toHaveAccessibleDescription('Name is required');
  });
  it.each([
    ['lastfm_tag', 'sub-tag', 'Tag'], ['lastfm_tag_albums', 'sub-tag', 'Tag'],
    ['lastfm_tag_similar', 'sub-tag', 'Tag'], ['tidal_playlist', 'sub-playlist-id', 'Playlist ID'],
    ['deezer_playlist', 'sub-playlist-id', 'Playlist ID'], ['spotify_public_playlist', 'sub-playlist-url', 'Playlist URL'],
    ['listenbrainz_playlist', 'sub-lb-playlist-id', 'Playlist ID'], ['discogs_label', 'sub-label-id', 'Label ID'],
    ['discogs_style', 'sub-discogs-style', 'Style'], ['bandcamp_tag', 'sub-bandcamp-tag', 'Tag'],
    ['bandcamp_new', 'sub-bandcamp-tag', 'Tag'],
  ])('focuses the required field for %s', (type, id, label) => {
    render(<SubscriptionFormModal isOpen onClose={vi.fn()} editingSubscription={{ ...base, type }} presets={[]} hasLidarr onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(document.getElementById(id)).toHaveFocus();
    expect(document.getElementById(id)).toHaveAccessibleDescription(`${label} is required`);
  });
  it('focuses and associates the first invalid field while preserving entered values', () => {
    const save = vi.fn(); render(<SubscriptionFormModal isOpen onClose={vi.fn()} editingSubscription={base} presets={[]} hasLidarr onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const playlist = screen.getByLabelText(/Playlist ID/);
    expect(playlist).toHaveFocus(); expect(playlist).toHaveAttribute('aria-invalid', 'true');
    expect(playlist).toHaveAccessibleDescription('Playlist ID is required');
    expect(screen.getByLabelText('Display Label')).toHaveValue('Night discoveries');
    expect(save).not.toHaveBeenCalled();
  });
  it('focuses Limit before later required fields and exposes both errors', () => {
    render(<SubscriptionFormModal isOpen onClose={vi.fn()} editingSubscription={base} presets={[]} hasLidarr onSave={vi.fn()} />);
    const limit = screen.getByLabelText('Limit'); fireEvent.change(limit, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(limit).toHaveFocus(); expect(limit).toHaveAccessibleDescription('Limit must be a number between 1 and 200');
    expect(screen.getByLabelText(/Playlist ID/)).toHaveAccessibleDescription('Playlist ID is required');
  });
  it('focuses the visible seed artist field for a missing MBID', () => {
    render(<SubscriptionFormModal isOpen onClose={vi.fn()} editingSubscription={{ ...base, type: 'listenbrainz_radio' }} presets={[]} hasLidarr onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('combobox', { name: /Seed Artist/ })).toHaveFocus();
    expect(screen.getByRole('combobox', { name: /Seed Artist/ })).toHaveAccessibleDescription('Seed Artist MBID is required');
  });
});
