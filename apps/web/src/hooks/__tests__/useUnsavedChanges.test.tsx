import React, { StrictMode, useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnsavedChangesProvider, useUnsavedChanges } from '../useUnsavedChanges';

function Draft({ dirty }: { dirty: boolean }) { useUnsavedChanges(dirty); return null; }
function Status() {
  const { hasUnsavedChanges, guardedNavigation, confirmDiscard } = useUnsavedChanges();
  return <><output>{hasUnsavedChanges ? 'dirty' : 'clean'}</output><button onClick={() => guardedNavigation(() => window.dispatchEvent(new Event('action')))}>Leave</button><button onClick={confirmDiscard}>Discard</button></>;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('settings dirty registry', () => {
  it('aggregates independent drafts and unregisters only the removed scope', () => {
    const { rerender } = render(<UnsavedChangesProvider><Draft dirty /><Draft dirty /><Status /></UnsavedChangesProvider>);
    expect(screen.getByText('dirty')).toBeVisible();
    rerender(<UnsavedChangesProvider><Draft dirty={false} /><Draft dirty /><Status /></UnsavedChangesProvider>);
    expect(screen.getByText('dirty')).toBeVisible();
    rerender(<UnsavedChangesProvider><Draft dirty={false} /><Status /></UnsavedChangesProvider>);
    expect(screen.getByText('clean')).toBeVisible();
  });
  it('prompts native beforeunload only while a draft is dirty and cleans up on unmount', () => {
    const { rerender, unmount } = render(<UnsavedChangesProvider><Draft dirty={false} /></UnsavedChangesProvider>);
    const unload = () => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
    expect(unload()).toBe(false);
    rerender(<UnsavedChangesProvider><Draft dirty /></UnsavedChangesProvider>); expect(unload()).toBe(true);
    rerender(<UnsavedChangesProvider><Draft dirty={false} /></UnsavedChangesProvider>); expect(unload()).toBe(false);
    rerender(<UnsavedChangesProvider><Draft dirty /></UnsavedChangesProvider>); unmount(); expect(unload()).toBe(false);
  });
  it('cancel blocks imperative navigation; confirmed discard avoids a duplicate unload prompt', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const action = vi.fn(); window.addEventListener('action', action);
    render(<UnsavedChangesProvider><Draft dirty /><Status /></UnsavedChangesProvider>);
    fireEvent.click(screen.getByText('Leave')); expect(action).not.toHaveBeenCalled();
    confirm.mockReturnValue(true); fireEvent.click(screen.getByText('Leave')); expect(action).toHaveBeenCalledOnce();
    const event = new Event('beforeunload', { cancelable: true }); act(() => window.dispatchEvent(event)); expect(event.defaultPrevented).toBe(false);
    window.removeEventListener('action', action);
  });
  it('clean navigation never asks to discard', () => {
    const confirm = vi.spyOn(window, 'confirm');
    render(<UnsavedChangesProvider><Draft dirty={false} /><Status /></UnsavedChangesProvider>);
    fireEvent.click(screen.getByText('Leave')); expect(confirm).not.toHaveBeenCalled();
  });
  it('modified clicks and external targets retain their browser semantics', () => {
    render(<UnsavedChangesProvider><a href="/settings">Settings</a><a href="https://example.com/settings" target="_blank">External</a></UnsavedChangesProvider>);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }); screen.getByText('Settings').dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
    const external = new MouseEvent('click', { bubbles: true, cancelable: true }); screen.getByText('External').dispatchEvent(external); expect(external.defaultPrevented).toBe(false);
  });
});


it('protects the first dirty commit before passive draft effects and cleans up in StrictMode', () => {
  const protections: boolean[] = [];
  function FirstCommit({ dirty }: { dirty: boolean }) {
    useUnsavedChanges(dirty);
    useEffect(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      protections.push(event.defaultPrevented);
    }, [dirty]);
    return <output>{dirty ? 'unsaved draft' : 'saved draft'}</output>;
  }
  const { rerender, unmount } = render(<StrictMode><UnsavedChangesProvider><FirstCommit dirty={false} /></UnsavedChangesProvider></StrictMode>);
  protections.length = 0;
  rerender(<StrictMode><UnsavedChangesProvider><FirstCommit dirty /></UnsavedChangesProvider></StrictMode>);
  expect(protections).toEqual([true]);
  rerender(<StrictMode><UnsavedChangesProvider><FirstCommit dirty={false} /></UnsavedChangesProvider></StrictMode>);
  expect(protections).toEqual([true, false]);
  unmount();
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});
