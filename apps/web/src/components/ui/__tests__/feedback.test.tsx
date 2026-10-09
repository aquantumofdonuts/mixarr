import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from '../toast';
import { ResultState } from '../result-state';
import { BulkToolbar } from '../bulk-toolbar';
import { Button } from '../button';
import { removeActedItems } from '@/lib/list-state';

afterEach(() => { cleanup(); vi.useRealTimers(); });
function Feedback({ onUndo = () => {} }: { onUndo?: () => void }) {
  const { addToast } = useToast();
  return <button onClick={() => addToast({ type: 'info', title: 'Decision saved', message: 'This can be restored.', action: { label: 'Undo', onClick: onUndo } })}>Save decision</button>;
}

describe('recoverable feedback', () => {
  it('announces feedback without stealing focus and supports a keyboard action', async () => {
    const user = userEvent.setup(), undo = vi.fn();
    render(<ToastProvider><Feedback onUndo={undo} /></ToastProvider>);
    const save = screen.getByRole('button', { name: 'Save decision' });
    await user.click(save); expect(save).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Decision saved');
    await user.tab(); expect(screen.getByRole('button', { name: 'Undo' })).toHaveFocus();
    await user.keyboard('{Enter}'); expect(undo).toHaveBeenCalledTimes(1);
  });
  it('gives Undo ten seconds and clears all timers on teardown', () => {
    vi.useFakeTimers();
    const { unmount } = render(<ToastProvider><Feedback /></ToastProvider>);
    fireEvent.click(screen.getByText('Save decision'));
    act(() => vi.advanceTimersByTime(9999)); expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1)); expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Save decision')); unmount(); expect(vi.getTimerCount()).toBe(0);
  });
  it('clears a dismissed toast timer and labels dismissal', () => {
    vi.useFakeTimers();
    render(<ToastProvider><Feedback /></ToastProvider>);
    fireEvent.click(screen.getByText('Save decision'));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Decision saved' }));
    expect(vi.getTimerCount()).toBe(0); expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('creates distinct notifications when crypto.randomUUID is unavailable on HTTP', () => {
    const cryptoObject = globalThis.crypto;
    vi.stubGlobal('crypto', {});
    try {
      render(<ToastProvider><Feedback /></ToastProvider>);
      fireEvent.click(screen.getByText('Save decision')); fireEvent.click(screen.getByText('Save decision'));
      expect(screen.getAllByRole('status')).toHaveLength(2);
      fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss Decision saved' })[0]);
      expect(screen.getAllByRole('status')).toHaveLength(1);
    } finally { vi.stubGlobal('crypto', cryptoObject); }
  });
  it.each([
    ['not-searched', 'Start a search'], ['no-matches', 'No matches'], ['no-records', 'No records yet'],
    ['error', 'Results unavailable'], ['partial-results', 'Some results are unavailable'],
  ] as const)('presents %s with a distinct recovery action', async (kind, title) => {
    const retry = vi.fn(), user = userEvent.setup();
    render(<ResultState kind={kind} message="Lidarr is unavailable. Existing results remain visible." action={<Button onClick={retry}>Retry</Button>} />);
    const state = screen.getByRole(kind === 'error' ? 'alert' : 'status');
    expect(state).toHaveTextContent(title); expect(state).toHaveTextContent('Lidarr is unavailable');
    await user.click(screen.getByRole('button', { name: 'Retry' })); expect(retry).toHaveBeenCalledOnce();
  });
  it('keeps failed and unrelated selections after a scoped action', async () => {
    const user = userEvent.setup();
    function List() {
      const [selected, setSelected] = useState(new Set(['one', 'two', 'three']));
      return <BulkToolbar selectedCount={selected.size} scopeLabel="Selected loaded artists" pending={false}
        actions={[{ label: 'Add selected', onClick: () => setSelected(previous => removeActedItems(previous, new Set(['one']))) }]} />;
    }
    render(<List />);
    expect(screen.getByRole('status')).toHaveTextContent('3 selected · Selected loaded artists');
    screen.getByRole('button', { name: 'Add selected' }).focus(); await user.keyboard('{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent('2 selected · Selected loaded artists');
  });
  it('blocks every bulk action while pending and does not expose a zero-selection toolbar', async () => {
    const action = vi.fn();
    const { rerender } = render(<BulkToolbar selectedCount={2} scopeLabel="This page" pending actions={[{ label: 'Add', onClick: action }]} onClear={action} />);
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveAttribute('aria-busy', 'true');
    for (const button of screen.getAllByRole('button')) { expect(button).toBeDisabled(); fireEvent.click(button); }
    expect(action).not.toHaveBeenCalled();
    rerender(<BulkToolbar selectedCount={0} scopeLabel="This page" pending={false} actions={[]} />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
});

it('ignores a retained async notification callback after provider teardown', () => {
  vi.useFakeTimers(); let late!: ReturnType<typeof useToast>['addToast'];
  function Capture() { late = useToast().addToast; return null; }
  const { unmount } = render(<ToastProvider><Capture /></ToastProvider>); unmount();
  act(() => late({ type: 'info', title: 'Late private outcome' }));
  expect(vi.getTimerCount()).toBe(0);
});
it('keeps notification ownership alive across child navigation and detaches it after provider replacement', () => {
  let first!: ReturnType<typeof useToast>['isCurrent'];
  let latest!: ReturnType<typeof useToast>['isCurrent'];
  function Capture() { latest = useToast().isCurrent; first ??= latest; return null; }
  const view = render(<ToastProvider key="first"><Capture /></ToastProvider>);
  expect(first()).toBe(true);
  view.rerender(<ToastProvider key="first"><p>Another route</p></ToastProvider>);
  expect(first()).toBe(true);
  view.rerender(<ToastProvider key="second"><Capture /></ToastProvider>);
  expect(first()).toBe(false); expect(latest()).toBe(true);
  view.unmount(); expect(latest()).toBe(false);
});
