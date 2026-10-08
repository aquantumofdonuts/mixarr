import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DashboardTiles } from './DashboardTiles';

const mocks = vi.hoisted(() => ({ stats: { current: {} as any }, role: 'user', refetch: vi.fn() }));
vi.mock('@/lib/hooks', () => ({ useDashboardStats: () => mocks.stats.current }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 1, role: mocks.role } }) }));
beforeEach(() => {
  mocks.role = 'user'; mocks.refetch.mockReset();
  mocks.stats.current = { data: { activeSubscriptions: 2, pendingDiscoveryRecords: 8, artistsAdded: 99, subscriptionRecordsMarkedAdded: 4, pendingReviews: 3, activeConnections: 5 }, refetch: mocks.refetch };
});
describe('catalog summary', () => {
  it('links discovery and pending review scopes and separates subscription navigation from its active count', () => {
    render(<DashboardTiles />);
    expect(screen.getByRole('link', { name: /8 Pending discovery records/ })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /3 Your pending review records/ })).toHaveAttribute('href', '/queue');
    expect(screen.getByText('Active subscriptions').closest('a')).toBeNull();
    expect(screen.getByRole('link', { name: 'Open your subscriptions' })).toHaveAttribute('href', '/subscriptions');
    expect(screen.queryByText(/Connections/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Artists added|Added today/i)).not.toBeInTheDocument();
  });
  it('renders explicit added-result record counts without suggesting a clickable artist total', () => {
    render(<DashboardTiles />);
    const label = screen.getByText('Results marked added (30d)');
    expect(label.closest('a')).toBeNull();
    expect(label.closest('div')).not.toHaveClass('cursor-pointer');
    expect(screen.getByText('4')).toBeInTheDocument();
  });
  it('uses actor-scoped values for admins and leaves their pending count unlinked because the admin queue is broader', () => {
    mocks.role = 'admin'; render(<DashboardTiles />);
    expect(screen.getByText('Your pending review records').closest('a')).toBeNull();
    expect(screen.getByText('Active subscriptions').closest('a')).toBeNull();
    expect(screen.getByText('Active connections').closest('a')).toBeNull();
    expect(screen.getByRole('link', { name: 'Open all review records' })).toHaveAttribute('href', '/queue');
    expect(screen.getByRole('link', { name: 'Open all subscriptions' })).toHaveAttribute('href', '/subscriptions');
    expect(screen.getByRole('link', { name: 'Manage connections' })).toHaveAttribute('href', '/connections');
    expect(screen.queryByText(/Global|Total artists/)).not.toBeInTheDocument();
  });
  it('retains real zeroes for empty actor scopes', () => {
    mocks.stats.current.data = { activeSubscriptions: 0, pendingDiscoveryRecords: 0, artistsAdded: 0, subscriptionRecordsMarkedAdded: 0, pendingReviews: 0, activeConnections: 0 };
    render(<DashboardTiles />);
    expect(screen.getByRole('link', { name: /0 Your pending review records/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /0 Pending discovery records/ })).toBeInTheDocument();
  });
  it('shows unknown values during loading rather than manufacturing zeroes', () => {
    mocks.stats.current = { isLoading: true, refetch: mocks.refetch };
    render(<DashboardTiles />);
    expect(screen.getByRole('region', { name: 'Your catalog summary' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
  it('reports errors without stale or invented counts and retries', () => {
    mocks.stats.current = { error: new Error('Unavailable'), data: { pendingReviews: 999 }, refetch: mocks.refetch };
    render(<DashboardTiles />);
    expect(screen.getByText('Summary unavailable.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /— Pending discovery records/ })).toBeInTheDocument();
    expect(screen.queryByText('999')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry summary' })); expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
