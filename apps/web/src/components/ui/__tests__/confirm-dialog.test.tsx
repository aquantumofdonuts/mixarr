import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ConfirmDialog } from '../confirm-dialog';

describe('confirmation dialog accessibility', () => {
  it('uses its single visible title as the accessible dialog name', () => {
    const confirm = vi.fn(), close = vi.fn();
    render(<ConfirmDialog open onClose={close} onConfirm={confirm} title="Delete subscription?" description="This removes the schedule, saved results, and run history." confirmLabel="Delete" />);
    const dialog = screen.getByRole('dialog', { name: 'Delete subscription?' });
    expect(within(dialog).getAllByRole('heading', { name: 'Delete subscription?' })).toHaveLength(1);
    expect(within(dialog).getByText(/saved results, and run history/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalledOnce(); expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(confirm).toHaveBeenCalledOnce();
  });
});
