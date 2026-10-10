vi.mock('@/components/artists/AddArtistOptions', () => ({ useAddArtistOptions: () => ({ dialog: null, runWithOptions: (request: { mbid?: string }, execute: (options: unknown) => Promise<unknown>) => Promise.resolve(execute(request.mbid?.includes('-') && request.mbid.length === 36 ? { mbid: request.mbid } : {})).catch(() => null) }) }));
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { FeedCard } from './FeedCard';
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
vi.mock('next/navigation', () => ({ usePathname: () => '/', useSearchParams: () => new URLSearchParams('view=list&seed=one'), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/useListContext', () => ({ useListContext: () => ({ remember: vi.fn() }) }));
const props = { id: 'feed-1-2', artistName: 'Radiohead', artistMbid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', imageUrl: null, onApprove: vi.fn(), onDismiss: vi.fn() };
describe('compact discovery row', () => {
  it('offers primary actions without hover or touch activation and opens the shared inspector', async () => {
    const user = userEvent.setup(), approve = vi.fn(), dismiss = vi.fn();
    render(<FeedCard {...props} onApprove={approve} onDismiss={dismiss} />);
    expect(screen.getByRole('link', { name: 'Radiohead' })).toHaveAttribute('href', '/?view=list&seed=one&artist=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    const add = screen.getByRole('button', { name: 'Add artist Radiohead' });
    add.focus(); await user.keyboard('{Enter}'); expect(approve).toHaveBeenCalledWith('feed-1-2', { mbid: props.artistMbid });
    fireEvent.touchStart(screen.getByRole('button', { name: 'Dismiss Radiohead' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Radiohead' })); expect(dismiss).toHaveBeenCalledWith('feed-1-2');
    expect(add.closest('article')).not.toHaveClass('group');
  });
  it('uses original source evidence and relevant metadata', () => {
    render(<FeedCard {...props} tags={['rock', 'alternative']} listeners={5000000} sourceRecords={[{ key: 'result:1', kind: 'subscription-result', label: 'New releases', subscriptionId: 3, runId: 7, recordedAt: '2026-10-01T00:00:00Z', recordStatus: 'pending', sourceUrl: null }]} sourceRecordCount={2} />);
    expect(screen.getByRole('link', { name: 'New releases' })).toHaveAttribute('href', '/subscriptions/3?tab=results');
    expect(screen.getByText(/Discovered through/)).toHaveTextContent('1 more source record');
    expect(screen.getByText(/5M listeners/)).toBeInTheDocument(); expect(screen.getByText(/rock/)).toBeInTheDocument();
  });
  it('keeps disabled actions and a precise pending status during acquisition', () => {
    render(<FeedCard {...props} acquisitionState="adding" />);
    expect(screen.getByRole('button', { name: 'Add artist Radiohead' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dismiss Radiohead' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for Lidarr confirmation');
  });
  it.each(['added', 'already-in-library'] as const)('retains %s as a confirmed row', state => {
    render(<FeedCard {...props} acquisitionState={state} />);
    expect(screen.getByRole('status')).toHaveTextContent(state === 'added' ? 'Added to Lidarr' : 'Already in Lidarr');
    expect(screen.queryByRole('button', { name: /Add artist/ })).not.toBeInTheDocument();
  });
  it.each(['failed', 'uncertain'] as const)('shows the actual %s message and Retry', state => {
    render(<FeedCard {...props} acquisitionState={state} acquisitionMessage="Provider timed out; membership is unknown" />);
    expect(screen.getByRole('status')).toHaveTextContent('Provider timed out; membership is unknown');
    expect(screen.getByRole('button', { name: 'Retry Radiohead' })).toBeEnabled();
  });
  it('requires explicit identity recovery instead of guessing an MBID', () => {
    render(<FeedCard {...props} artistMbid={null} acquisitionState="identity-required" />);
    expect(screen.queryByRole('button', { name: /Add artist/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Identify artist Radiohead' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('matching MusicBrainz artist');
  });
  it('links connection recovery to settings', () => {
    render(<FeedCard {...props} acquisitionState="connection-required" />);
    expect(screen.getByRole('link', { name: 'Connect Lidarr' })).toHaveAttribute('href', '/connections');
  });
  it('uses the same persistent actions in the artwork view', () => {
    render(<FeedCard {...props} view="artwork" />);
    expect(screen.getByRole('button', { name: 'Add artist Radiohead' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Dismiss Radiohead' })).toBeVisible();
    expect(screen.getByTestId('image-placeholder')).toBeInTheDocument();
  });
});

it('opens the inspector from artwork with the same stable identity', () => {
  render(<FeedCard {...props} />);
  expect(screen.getByRole('link', { name: 'Inspect artwork for Radiohead' })).toHaveAttribute('href', '/?view=list&seed=one&artist=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
});
