import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectionCard, type Connection, type ConnectionCardProps } from '../components/ConnectionCard';
vi.mock('../components/OAuthButtons', () => ({ OAuthButtons: ({ canModify }: { canModify: boolean }) => <span>OAuth modify: {String(canModify)}</span> }));
vi.mock('../components/LidarrMaintenance', () => ({ LidarrMaintenance: () => <span>Library maintenance</span> }));
const makeConnection = (overrides: Partial<Connection> = {}): Connection => ({ id: 1, userId: 7, type: 'spotify', name: 'My Spotify', isActive: true, lastTest: null, createdAt: '2025-01-01T00:00:00Z', ...overrides });
const props: ConnectionCardProps = { typeConfig: { value: 'spotify', label: 'Spotify', color: '#1DB954', description: 'Import playlists' }, connections: [makeConnection()], currentUserId: 7, isAdmin: false, onAdd: vi.fn(), onEdit: vi.fn(), onTest: vi.fn(), onDelete: vi.fn(), testingId: null };
beforeEach(() => vi.clearAllMocks());
describe('configured connection rows', () => {
  it('separates enabled state, timestamp and unknown session verdict without decorative swatches', () => {
    const { container } = render(<ConnectionCard {...props} connections={[makeConnection({ lastTest: '2026-10-07T12:00:00Z' })]} />);
    expect(screen.getByText(/My Spotify/)).toBeInTheDocument();
    expect(screen.getByText('Enabled: Yes')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(container.querySelector('time')).toHaveAttribute('dateTime', '2026-10-07T12:00:00Z');
    expect(container.querySelector('[style]')).toBeNull();
    expect(screen.queryByText('Pass')).not.toBeInTheDocument();
  });
  it('shows a failed result and Retry independently of the saved timestamp and active flag', () => {
    render(<ConnectionCard {...props} testStates={{ 1: { verdict: 'fail', message: 'Invalid key', testedAt: '2026-10-09T12:00:00Z' } }} />);
    expect(screen.getByText('Fail')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid key');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(props.onTest).toHaveBeenCalledWith(1);
  });
  it('shows explicit Test/edit/delete actions for an owned personal connection', () => {
    render(<ConnectionCard {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(props.onTest).toHaveBeenCalledWith(1);
    expect(props.onEdit).toHaveBeenCalledWith(1);
    expect(props.onDelete).toHaveBeenCalledWith(1);
  });
  it('restricts modifying global and other-owner connections for a member while retaining Test', () => {
    render(<ConnectionCard {...props} connections={[makeConnection({ userId: null }), makeConnection({ id: 2, userId: 9, name: 'Other user' })]} />);
    expect(screen.getAllByRole('button', { name: 'Test' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.getAllByText('OAuth modify: false')).toHaveLength(2);
  });
  it('allows admin modification and labels the actual owner neutrally', () => {
    render(<ConnectionCard {...props} isAdmin connections={[makeConnection({ userId: 9, user: { username: 'owner', displayName: 'Owner' } })]} />);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByText('Personal · Owner')).toBeInTheDocument();
  });
  it('tracks concurrent tests independently by ID', () => {
    render(<ConnectionCard {...props} connections={[makeConnection(), makeConnection({ id: 2, name: 'Second' }), makeConnection({ id: 3, name: 'Third' })]} testingId={1} testStates={{ 1: { verdict: 'testing' }, 2: { verdict: 'testing' } }} />);
    expect(within(screen.getByRole('article', { name: 'My Spotify' })).getByRole('button', { name: 'Test' })).toBeDisabled();
    expect(within(screen.getByRole('article', { name: 'Second' })).getByRole('button', { name: 'Test' })).toBeDisabled();
    expect(within(screen.getByRole('article', { name: 'Third' })).getByRole('button', { name: 'Test' })).toBeEnabled();
  });
  it('preserves Lidarr maintenance for admins and Last.fm preview', () => {
    const preview = vi.fn();
    const { rerender } = render(<ConnectionCard {...props} isAdmin connections={[makeConnection({ type: 'lidarr' })]} />);
    expect(screen.getByText('Library maintenance')).toBeInTheDocument();
    rerender(<ConnectionCard {...props} connections={[makeConnection({ type: 'lastfm' })]} onPreview={preview} />);
    expect(screen.queryByText('Library maintenance')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Preview Artists' }));
    expect(preview).toHaveBeenCalledWith(1, 'lastfm');
    expect(screen.getByText('Authorization: Not reported by this provider')).toBeInTheDocument();
  });
  it('never renders an available provider when no configured rows exist', () => {
    render(<ConnectionCard {...props} connections={[]} />);
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Configure' })).toBeNull();
  });
});
