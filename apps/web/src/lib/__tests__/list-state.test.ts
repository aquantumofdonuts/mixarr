import { describe, expect, it } from 'vitest';
import { readPage, updateQuery, updateListFilters, retainSelection, removeActedItems } from '../list-state';

describe('catalog URL and selection state', () => {
  it.each([null, '', '-1', '1.5', 'NaN', '1e3', 'Infinity', '9007199254740993', '9'.repeat(400)])('rejects invalid page %s', value => {
    expect(readPage(value)).toBe(1);
  });
  it.each([['0', 1], ['3', 3], ['10001', 10000], ['9007199254740991', 10000]])('bounds valid page %s', (value, page) => expect(readPage(value)).toBe(page));
  it('changes only named parameters and preserves repeated seeds', () => {
    const current = new URLSearchParams('seed=one&seed=two&q=old&source=lastfm&artist=abc');
    const next = new URLSearchParams(updateQuery(current, { q: 'new', artist: null, tab: '' }));
    expect(next.getAll('seed')).toEqual(['one', 'two']);
    expect(next.get('source')).toBe('lastfm');
    expect(next.get('q')).toBe('new');
    expect(next.has('artist')).toBe(false);
    expect(current.get('q')).toBe('old');
    expect(updateQuery(new URLSearchParams('q=old'), { q: null })).toBe('');
  });
  it('resets page and release cursor on committed filter changes', () => {
    const next = new URLSearchParams(updateListFilters(new URLSearchParams('page=3&cursor=opaque&source=old&seed=one&seed=two'), { source: 'new' }));
    expect(next.has('page')).toBe(false);
    expect(next.has('cursor')).toBe(false);
    expect(next.getAll('seed')).toEqual(['one', 'two']);
  });
  it('prunes missing identities and removes only successful actions', () => {
    const selected = new Set(['mbid:one', 'mbid:two', 'provider:unresolved']);
    expect(retainSelection(selected, new Set(['mbid:two', 'provider:unresolved']))).toEqual(new Set(['mbid:two', 'provider:unresolved']));
    expect(removeActedItems(selected, new Set(['mbid:one']))).toEqual(new Set(['mbid:two', 'provider:unresolved']));
    expect(selected.size).toBe(3);
  });
});
