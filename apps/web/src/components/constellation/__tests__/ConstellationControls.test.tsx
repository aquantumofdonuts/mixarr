import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConstellationControls } from '../ConstellationControls';

function setup(over: Partial<React.ComponentProps<typeof ConstellationControls>> = {}) {
  const onRoleMaskChange = vi.fn();
  const onHideHotnessChange = vi.fn();
  const onGenreHighlightChange = vi.fn();
  render(
    <ConstellationControls
      onRoleMaskChange={onRoleMaskChange}
      onHideHotnessChange={onHideHotnessChange}
      onGenreHighlightChange={onGenreHighlightChange}
      {...over}
    />,
  );
  return { onRoleMaskChange, onHideHotnessChange, onGenreHighlightChange };
}

describe('ConstellationControls — role filter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts with all roles checked and reports no filter (undefined)', () => {
    const { onRoleMaskChange } = setup();
    // Every role option checkbox is checked by default (== no filter).
    for (const name of [/performer/i, /producer/i, /composer/i, /engineer/i, /artwork/i]) {
      expect(screen.getByRole('checkbox', { name })).toBeChecked();
    }
    // No change emitted until the user interacts.
    expect(onRoleMaskChange).not.toHaveBeenCalled();
  });

  it('emits the OR-ed bitmask for a proper subset of roles', async () => {
    const { onRoleMaskChange } = setup();
    // Uncheck everything except performer(1) + composer(4) => mask 5.
    await userEvent.click(screen.getByRole('checkbox', { name: /producer/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /engineer/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /artwork/i }));

    // performer + composer remain checked => 1 | 4 = 5.
    expect(onRoleMaskChange).toHaveBeenLastCalledWith(5);
  });

  it('reports undefined again when the user unchecks down to none', async () => {
    const { onRoleMaskChange } = setup();
    for (const name of [/performer/i, /producer/i, /composer/i, /engineer/i, /artwork/i]) {
      await userEvent.click(screen.getByRole('checkbox', { name }));
    }
    // None selected => no filter.
    expect(onRoleMaskChange).toHaveBeenLastCalledWith(undefined);
  });
});

describe('ConstellationControls — hide hotness', () => {
  beforeEach(() => vi.clearAllMocks());

  it('toggles hide-hotness on and off', async () => {
    const { onHideHotnessChange } = setup();
    const toggle = screen.getByRole('checkbox', { name: /hide hotness/i });
    await userEvent.click(toggle);
    expect(onHideHotnessChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(toggle);
    expect(onHideHotnessChange).toHaveBeenLastCalledWith(false);
  });
});

describe('ConstellationControls — genre highlight', () => {
  beforeEach(() => vi.clearAllMocks());

  it('emits the selected genre and null for "all"', async () => {
    const { onGenreHighlightChange } = setup();
    const select = screen.getByLabelText(/highlight genre/i);
    await userEvent.selectOptions(select, 'rock');
    expect(onGenreHighlightChange).toHaveBeenLastCalledWith('rock');

    await userEvent.selectOptions(select, '__all__');
    expect(onGenreHighlightChange).toHaveBeenLastCalledWith(null);
  });

  it('renders a genre legend with color swatches', () => {
    setup();
    const legend = screen.getByTestId('genre-legend');
    // At least one swatch for a known genre.
    expect(legend).toHaveTextContent(/rock/i);
  });
});
