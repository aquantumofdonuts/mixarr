import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubscriptionCard, type Subscription } from './SubscriptionCard';

const subscription: Subscription = { id: 11, userId: 7, name: 'Night discoveries', type: 'lastfm_tag', config: { tag: 'jazz' }, schedule: '0 0 * * *', resultHandling: 'preview', isActive: true, lastRun: '2026-10-07T20:00:00Z', lastRunStatus: 'completed', lastRunCount: 0, nextRun: null };
const actions = { onRun: vi.fn(), onToggle: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() };
function show(overrides: Partial<Subscription> = {}, isRunning = false) { return render(<SubscriptionCard subscription={{ ...subscription, ...overrides }} currentUser={{ id: 7, username: 'listener', displayName: 'Listener', role: 'user' }} isRunning={isRunning} {...actions} />); }
beforeEach(() => vi.clearAllMocks());
describe('subscription catalog rows', () => {
  it('links the name to detail and results directly with no nested buttons', () => {
    show();
    expect(screen.getByRole('heading', { name: 'Night discoveries' })).toContainElement(screen.getByRole('link', { name: 'Night discoveries' }));
    expect(screen.getByRole('link', { name: 'Night discoveries' })).toHaveAttribute('href', '/subscriptions/11');
    const results = screen.getByRole('link', { name: 'View results' });
    expect(results).toHaveAttribute('href', '/subscriptions/11?tab=results');
    expect(results.querySelector('button')).toBeNull();
  });
  it('keeps Run now separate from the schedule toggle', () => {
    show(); fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    expect(actions.onRun).toHaveBeenCalledWith(11);
    expect(actions.onToggle).not.toHaveBeenCalled();
    expect(actions.onEdit).not.toHaveBeenCalled(); expect(actions.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Pause schedule' }));
    expect(actions.onToggle).toHaveBeenCalledWith(subscription);
    expect(actions.onRun).toHaveBeenCalledOnce();
  });
  it('labels resume explicitly and prevents duplicate running requests', () => {
    show({ isActive: false }, true);
    expect(screen.getByRole('button', { name: 'Run now' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Resume schedule' }));
    expect(actions.onToggle).toHaveBeenCalledOnce(); expect(actions.onRun).not.toHaveBeenCalled();
  });
  it('offers independently focusable edit and delete actions in native overflow', async () => {
    show(); const user = userEvent.setup();
    const disclosure = screen.getByText('More actions').closest('summary')!;
    expect(disclosure.closest('details')).not.toHaveAttribute('open');
    await user.click(disclosure);
    expect(disclosure.closest('details')).toHaveAttribute('open');
    screen.getByRole('button', { name: 'Edit subscription' }).focus();
    await user.keyboard('{Enter}');
    expect(actions.onEdit).toHaveBeenCalledWith(subscription); expect(actions.onDelete).not.toHaveBeenCalled();
    await user.click(disclosure);
    screen.getByRole('button', { name: 'Delete subscription' }).focus();
    await user.keyboard(' ');
    expect(actions.onDelete).toHaveBeenCalledWith(11);
    expect(actions.onRun).not.toHaveBeenCalled(); expect(actions.onToggle).not.toHaveBeenCalled();
  });
  it('keeps native detail and results links in keyboard tab order', async () => {
    show(); const user = userEvent.setup();
    await user.tab(); expect(screen.getByRole('link', { name: 'Night discoveries' })).toHaveFocus();
    await user.tab(); expect(screen.getByRole('link', { name: 'View results' })).toHaveFocus();
    await user.tab(); expect(screen.getByRole('button', { name: 'Run now' })).toHaveFocus();
  });
  it('shows explicit schedule and completed zero added-or-queued record evidence', () => {
    show(); expect(screen.getByText('Daily at midnight')).toBeInTheDocument();
    expect(screen.getByText(/Last run: Completed/)).toHaveTextContent('Last run: Completed · 0 records marked added or queued');
    expect(screen.getByText('0')).toHaveClass('font-mono');
    expect(screen.queryByText(/0 artists/)).not.toBeInTheDocument();
  });
  it('shows a running status when the start timestamp is unavailable', () => {
    show({ lastRun: null, lastRunStatus: 'running', lastRunCount: null }, true);
    expect(screen.getByText('Last run: Running')).toBeInTheDocument();
    expect(screen.queryByText('Not run yet')).not.toBeInTheDocument();
  });
  it('does not manufacture a result count or run date without evidence', () => {
    show({ schedule: null, lastRun: null, lastRunStatus: null, lastRunCount: null });
    expect(screen.getByText('Manual only')).toBeInTheDocument(); expect(screen.getByText('Not run yet')).toBeInTheDocument();
    expect(screen.queryByText(/0 records marked added or queued/)).not.toBeInTheDocument();
  });
});
