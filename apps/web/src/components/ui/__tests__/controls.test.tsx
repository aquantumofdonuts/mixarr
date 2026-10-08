import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '../button';
import { Input } from '../input';
import { Select } from '../select';
import { Checkbox } from '../checkbox';
import { Tabs, Tab, TabPanel } from '../tabs';

afterEach(cleanup);

describe('catalog controls', () => {
  it('activates buttons with the keyboard and prevents disabled/loading activation', async () => {
    const user = userEvent.setup(), onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Add artist</Button>);
    await user.tab(); await user.keyboard('{Enter}'); expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<Button onClick={onClick} isLoading>Add artist</Button>);
    expect(screen.getByRole('button', { name: /Add artist/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Add artist/ })).toHaveAttribute('aria-busy', 'true');
    await user.click(screen.getByRole('button', { name: /Add artist/ }));
    rerender(<Button onClick={onClick} disabled>Add artist</Button>);
    await user.click(screen.getByRole('button', { name: /Add artist/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it('defaults actions to button and preserves explicitly requested native submission', async () => {
    const user = userEvent.setup(), submit = vi.fn(event => event.preventDefault());
    render(<form onSubmit={submit}><Button>Preview</Button><Button type="submit">Save</Button></form>);
    await user.click(screen.getByRole('button', { name: 'Preview' })); expect(submit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save' })); expect(submit).toHaveBeenCalledTimes(1);
  });
  it('associates native field labels and errors without dropping an existing description', async () => {
    const user = userEvent.setup();
    render(<><p id="hint">Use a stable identity</p><Input label="Artist" error="Choose an artist" aria-describedby="hint" />
      <Select label="Root folder" error="Choose a folder" options={[{ value: 'music', label: 'Music' }]} /></>);
    const artist = screen.getByRole('textbox', { name: 'Artist' });
    expect(artist).toHaveAccessibleDescription('Use a stable identity Choose an artist');
    expect(artist).toHaveAttribute('aria-invalid', 'true');
    await user.type(artist, 'Common Name'); expect(artist).toHaveValue('Common Name');
    const folder = screen.getByRole('combobox', { name: 'Root folder' });
    expect(folder).toHaveAccessibleDescription('Choose a folder');
    await user.selectOptions(folder, 'music'); expect(folder).toHaveValue('music');
  });
  it('keeps external labels/forwarded refs compatible and clears resolved error semantics', () => {
    const ref = React.createRef<HTMLInputElement>();
    const { rerender } = render(<><label htmlFor="existing">Existing artist</label><Input id="existing" ref={ref} error="Invalid" /></>);
    expect(ref.current).toBe(screen.getByLabelText('Existing artist'));
    rerender(<><label htmlFor="existing">Existing artist</label><Input id="existing" ref={ref} /></>);
    expect(ref.current).not.toHaveAttribute('aria-invalid'); expect(ref.current).not.toHaveAttribute('aria-describedby');
  });
  it('sets the native indeterminate property and supports keyboard and label activation', async () => {
    const user = userEvent.setup(), onCheckedChange = vi.fn();
    const ref = React.createRef<HTMLInputElement>();
    const { rerender } = render(<Checkbox ref={ref} label="Select loaded artists" indeterminate onCheckedChange={onCheckedChange} />);
    expect(ref.current?.indeterminate).toBe(true);
    await user.tab(); await user.keyboard(' '); expect(onCheckedChange).toHaveBeenCalledWith(true);
    rerender(<Checkbox ref={ref} label="Select loaded artists" indeterminate={false} checked={false} onCheckedChange={onCheckedChange} />);
    expect(ref.current?.indeterminate).toBe(false);
    await user.click(screen.getByText('Select loaded artists')); expect(onCheckedChange).toHaveBeenCalledTimes(2);
  });
  it('uses roving tab focus and arrows without submitting the surrounding form', async () => {
    const user = userEvent.setup(), submit = vi.fn(event => event.preventDefault());
    function Example() {
      const [value, setValue] = React.useState('results');
      return <form onSubmit={submit}><Tabs value={value} onChange={setValue}>
        <Tab value="results" label="Results" /><Tab value="runs" label="Runs" />
        <TabPanel value="results">Artist results</TabPanel><TabPanel value="runs">Run history</TabPanel>
      </Tabs></form>;
    }
    render(<Example />); await user.tab(); await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Runs' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Run history');
    await user.keyboard('{Enter}'); expect(submit).not.toHaveBeenCalled();
    await user.keyboard('{Home}'); expect(screen.getByRole('tab', { name: 'Results' })).toHaveFocus();
  });
});
