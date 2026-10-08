import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal, ModalFooter } from '../modal';

afterEach(() => { cleanup(); document.body.style.overflow = ''; vi.useRealTimers(); });

function FormDialog({ onClose = vi.fn() }: { onClose?: () => void }) {
  return <Modal isOpen onClose={onClose} title="Artist options">
    <button disabled>Disabled action</button>
    <div hidden><button>Hidden action</button></div>
    <div style={{ display: 'none' }}><button>CSS hidden action</button></div>
    <input type="hidden" />
    <label htmlFor="artist-name">Artist name</label><input id="artist-name" />
    <div><ModalFooter><button>Save</button></ModalFooter></div>
  </Modal>;
}

describe('modal lifecycle', () => {
  it('focuses the first meaningful visible control and traps focus at both ends', async () => {
    const user = userEvent.setup();
    render(<FormDialog />);
    await act(async () => {});
    expect(screen.getByLabelText('Artist name')).toHaveFocus();
    screen.getByRole('button', { name: 'Save' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
    screen.getByRole('button', { name: 'Close' }).focus();
    await user.tab();
    expect(screen.getByLabelText('Artist name')).toHaveFocus();
  });
  it('calls onClose once even if a child animation ends before the old fallback deadline', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<FormDialog onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.animationEnd(screen.getByRole('dialog'));
    act(() => vi.advanceTimersByTime(1000));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('restores focus and the original body overflow on unmount', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger); trigger.focus(); document.body.style.overflow = 'clip';
    const { unmount } = render(<FormDialog />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('clip');
    expect(trigger).toHaveFocus(); trigger.remove();
  });
  it('does not reset focus or release the body lock when the close callback changes', () => {
    const { rerender } = render(<FormDialog />);
    screen.getByRole('button', { name: 'Save' }).focus();
    rerender(<FormDialog onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
  });
  it('keeps nested footers outside the scrolling content', () => {
    render(<FormDialog />);
    const footer = screen.getByRole('button', { name: 'Save' }).parentElement!;
    expect(screen.getByLabelText('Artist name').closest('[data-modal-body]')).not.toBeNull();
    expect(footer.closest('[data-modal-body]')).toBeNull();
    expect(screen.getByRole('dialog')).toContainElement(footer);
  });
  it('honors a refused close and uses the latest handler for Escape', () => {
    const oldClose = vi.fn(), latestClose = vi.fn();
    const { rerender } = render(<FormDialog onClose={oldClose} />);
    rerender(<FormDialog onClose={latestClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(latestClose).toHaveBeenCalledTimes(1);
    expect(oldClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
  });
  it('only closes the topmost modal and retains the parent lock when the child closes', () => {
    const parentClose = vi.fn(), childClose = vi.fn();
    function Nested({ childOpen }: { childOpen: boolean }) {
      return <><Modal isOpen onClose={parentClose} title="Parent"><button>Parent action</button></Modal>
        <Modal isOpen={childOpen} onClose={childClose} title="Child"><button>Child action</button></Modal></>;
    }
    const { rerender } = render(<Nested childOpen />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(childClose).toHaveBeenCalledTimes(1); expect(parentClose).not.toHaveBeenCalled();
    rerender(<Nested childOpen={false} />);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' }); expect(parentClose).toHaveBeenCalledTimes(1);
  });
  it('treats a truly nested child as topmost regardless of layout-effect order', () => {
    const parentClose = vi.fn(), childClose = vi.fn();
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
    function Nested({ childOpen }: { childOpen: boolean }) {
      return <Modal isOpen onClose={parentClose} title="Parent">
        <button>Parent action</button>
        <Modal isOpen={childOpen} onClose={childClose} title="Child"><button>Child action</button></Modal>
      </Modal>;
    }
    const { rerender, unmount } = render(<Nested childOpen />);
    expect(screen.getByRole('button', { name: 'Child action' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(childClose).toHaveBeenCalledTimes(1); expect(parentClose).not.toHaveBeenCalled();
    rerender(<Nested childOpen={false} />);
    unmount(); expect(trigger).toHaveFocus(); trigger.remove();
  });
  it('initially focuses the meaningful footer action and restores the original trigger', () => {
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
    const { unmount } = render(<Modal isOpen onClose={vi.fn()} title="Confirm">
      <p>Remove this connection?</p><ModalFooter><button>Cancel</button><button>Remove</button></ModalFooter>
    </Modal>);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    unmount(); expect(trigger).toHaveFocus(); trigger.remove();
  });
  it('contains focus moved outside the dialog', () => {
    const outside = document.createElement('button'); document.body.append(outside);
    render(<FormDialog />);
    outside.focus();
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    outside.remove();
  });
  it('moves focus to the first invalid field when validation updates', () => {
    const { rerender } = render(<Modal isOpen onClose={vi.fn()} title="Validation"><input aria-label="Name" /></Modal>);
    screen.getByRole('button', { name: 'Close' }).focus();
    rerender(<Modal isOpen onClose={vi.fn()} title="Validation"><input aria-label="Name" aria-invalid="true" /></Modal>);
    expect(screen.getByLabelText('Name')).toHaveFocus();
  });
});

it('uses the same modal lifecycle for a full-height right artist panel', () => {
  const close = vi.fn();
  const { unmount } = render(<Modal isOpen onClose={close} placement="inspector" title="Artist"><button>Artist action</button></Modal>);
  expect(screen.getByRole('dialog')).toHaveClass('h-dvh', 'sm:max-w-2xl');
  expect(screen.getByRole('dialog').parentElement).toHaveClass('justify-end');
  fireEvent.keyDown(document, { key: 'Escape' }); expect(close).toHaveBeenCalledTimes(1);
  unmount(); expect(document.body.style.overflow).toBe('');
});
