import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect, ARTIST_IDS, catalogQueue } from './catalog-fixtures';
const makeRow = (id: number, userId = 7) => ({ ...catalogQueue[0], id, userId, artistName: 'Same name', mbid: ARTIST_IDS[id % 2] as string | null, user: { username: `owner-${userId}`, displayName: `Owner ${userId}` } });
type Row = ReturnType<typeof makeRow>;
async function navigateCatalog(page: Page, name: 'Review Queue' | 'Library') {
  const menu = page.getByRole('button', { name: 'Open menu', exact: true });
  if (await menu.isVisible()) {
    await menu.click();
    const drawer = page.getByRole('dialog', { name: 'Mixarr navigation', exact: true });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('link', { name, exact: true }).click();
    await expect(drawer).toHaveCount(0);
  } else await page.getByRole('link', { name, exact: true }).click();
}

async function mutableQueue(page: Page, initial: Row[]) {
  const state = { rows: initial, approvals: [] as Record<string, unknown>[], rejections: [] as Record<string, unknown>[], restores: [] as Record<string, unknown>[], failFirstBulk: false, restoreFails: false };
  const rejected = new Map<string, Row[]>();
  await page.route('**/api/imports/review/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (path.endsWith('/queue')) {
      const status = url.searchParams.get('status') || 'pending', q = url.searchParams.get('q') || '', itemType = url.searchParams.get('itemType');
      const matches = state.rows.filter(row => row.status === status && (!itemType || row.itemType === itemType) && row.artistName.toLowerCase().includes(q.toLowerCase())).sort((a,b) => b.id-a.id);
      const cursor = url.searchParams.get('cursor'), after = cursor ? JSON.parse(Buffer.from(cursor, 'base64url').toString()).id : Infinity;
      const rows = matches.filter(row => row.id < after), items = rows.slice(0,50), last = items.at(-1);
      return route.fulfill({ json: { items, total: matches.length, nextCursor: rows.length > 50 && last ? Buffer.from(JSON.stringify({ v: 1, id: last.id, createdAt: last.createdAt, actor: 7, admin: true, status, itemType, q })).toString('base64url') : null } });
    }
    const body = request.postDataJSON();
    if (path.endsWith('/restore')) {
      state.restores.push(body);
      if (state.restoreFails && state.restores.length === 1) return route.fulfill({ status: 503, json: { error: 'Restoration temporarily unavailable' } });
      const restored = rejected.get(body.undoToken) || []; state.rows.push(...restored); rejected.delete(body.undoToken);
      return route.fulfill({ json: { restoredIds: restored.map(row => row.id) } });
    }
    const ids: number[] = path.endsWith('/bulk') ? body.ids : [Number(path.split('/').at(-1))];
    if (body.status === 'rejected') {
      state.rejections.push({ ...body, ids }); const token = `opaque-signed-${state.rejections.length}`;
      const rows = state.rows.filter(row => ids.includes(row.id)); rejected.set(token, rows); state.rows = state.rows.filter(row => !ids.includes(row.id));
      return route.fulfill({ json: { success: true, undoToken: token, undoExpiresAt: new Date(Date.now()+120000).toISOString() } });
    }
    state.approvals.push({ ...body, ids });
    const partial = state.failFirstBulk && state.approvals.length === 1;
    const outcomes = ids.map((id,index) => ({ id, state: partial && index === 1 ? 'uncertain' : partial ? 'already-in-library' : 'added', message: partial && index === 1 ? 'Verify exact membership before retry' : 'Confirmed exact provider identity' }));
    state.rows = state.rows.filter(row => !outcomes.some(outcome => outcome.id === row.id && outcome.state !== 'uncertain'));
    return route.fulfill({ json: { success: !partial, outcomes, added: outcomes.filter(o=>o.state==='added').length, alreadyInLibrary: outcomes.filter(o=>o.state==='already-in-library').length, failed: outcomes.filter(o=>o.state==='uncertain').length } });
  });
  return state;
}

test('all 520 records are reachable, complete server search resets paging, and direct links have no invented Previous', async ({ catalogPage: page }) => {
  const requested: URL[] = []; page.on('request', request => { if (new URL(request.url()).pathname === '/api/imports/review/queue') requested.push(new URL(request.url())); });
  await page.goto('/queue?keep=value'); await expect(page.getByText('Queue Artist 520', { exact: true })).toBeVisible();
  for (let next = 1; next <= 10; next++) {
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(page.getByText(`Queue Artist ${String(520-next*50).padStart(3,'0')}`, { exact: true })).toBeVisible();
  }
  await expect(page.getByText('Queue Artist 001', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Previous page', exact: true })).toBeEnabled();
  await page.reload(); await expect(page.getByText('Queue Artist 001', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Previous page', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Back to first page', exact: true }).click(); await expect(page.getByText('Queue Artist 520', { exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Next page', exact: true }).click(); await expect(page.getByText('Queue Artist 470', { exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Previous page', exact: true }).click(); await expect(page.getByText('Queue Artist 520', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search review queue' }).fill('Queue Artist 001'); await expect(page).toHaveURL(/q=Queue\+Artist\+001/); await expect(page.locator('article')).toHaveCount(1); expect(new URL(page.url()).searchParams.has('cursor')).toBe(false); expect(new URL(page.url()).searchParams.get('keep')).toBe('value');
  expect(requested.every(url => url.searchParams.get('limit')==='50')).toBe(true); expect(requested.filter(url => url.searchParams.has('cursor')).length).toBeGreaterThanOrEqual(11);
});

test('single acquisition preserves unrelated same-name selection and owner-only administration', async ({ catalogPage: page }) => {
  const state = await mutableQueue(page,[makeRow(2),makeRow(1),makeRow(3,8)]);
  await page.goto('/queue'); await page.getByRole('checkbox', { name: 'Select loaded page', exact: true }).check();
  const foreign = page.getByRole('article', { name: 'Review item 3', exact: true }); await expect(foreign.getByRole('checkbox')).not.toBeChecked(); await expect(foreign.getByRole('button', { name: 'Reject', exact: true })).toBeDisabled(); await expect(foreign.getByText(/Owner: Owner 8/)).toBeVisible();
  const row = page.getByRole('article', { name: 'Review item 2', exact: true }); await row.getByRole('button', { name: 'Add artist', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Add artist options', exact: true });
  await dialog.getByRole('combobox', { name: 'Root folder', exact: true }).selectOption('/archive'); await dialog.getByLabel('Search on add', { exact: true }).uncheck(); await dialog.getByRole('button', { name: 'Confirm add', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(page.getByRole('checkbox', { name: 'Select review item 1', exact: true })).toBeChecked(); await expect(page.getByText('Added to Lidarr', { exact: true })).toBeVisible();
  expect(state.approvals).toEqual([expect.objectContaining({ ids: [2], mbid: ARTIST_IDS[0], rootFolderPath: '/archive', searchOnAdd: false })]);
  await page.getByRole('article', { name: 'Review item 1', exact: true }).getByRole('link', { name: 'Same name', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Common Name', exact: true })).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.getByRole('checkbox', { name: 'Select review item 1', exact: true })).toBeChecked();
});

test('partial bulk results stay visible and selected, and options retry only failed numeric IDs', async ({ catalogPage: page }) => {
  const state = await mutableQueue(page,[makeRow(2),makeRow(1)]); state.failFirstBulk=true;
  await page.goto('/queue'); await page.getByRole('checkbox', { name: 'Select loaded page', exact: true }).check(); await page.getByRole('button', { name: 'Add selected items', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Add artist options', exact: true });
  await dialog.getByRole('combobox', { name: 'Root folder', exact: true }).selectOption('/archive'); await dialog.getByLabel('Search on add', { exact: true }).uncheck(); await dialog.getByRole('button', { name: 'Confirm add', exact: true }).click();
  await expect(page.getByText('Already in Lidarr', { exact: true })).toBeVisible(); await expect(page.getByText('Outcome uncertain', { exact: true })).toBeVisible(); await expect(page.getByRole('checkbox', { name: 'Select review item 1', exact: true })).toBeChecked(); await expect(dialog.getByRole('alert')).toBeVisible(); await expect(dialog.getByRole('combobox', { name: 'Root folder', exact: true })).toHaveValue('/archive');
  await dialog.getByRole('button', { name: 'Confirm add', exact: true }).click(); await expect(dialog).toHaveCount(0); expect(state.approvals.map(body=>body.ids)).toEqual([[2,1],[1]]); expect(state.approvals.every(body=>body.rootFolderPath==='/archive' && body.searchOnAdd===false)).toBe(true);
});

test('keyboard Undo posts the signed rejection token, retries explicitly, and restores actual queue rows', async ({ catalogPage: page }) => {
  const state = await mutableQueue(page,[makeRow(2),makeRow(1)]); state.restoreFails=true;
  await page.goto('/queue'); await page.getByRole('article', { name: 'Review item 2', exact: true }).getByRole('button', { name: 'Reject', exact: true }).click(); await expect(page.getByRole('article', { name: 'Review item 2', exact: true })).toHaveCount(0);
  const undo = page.getByRole('button', { name: 'Undo', exact: true }); await undo.focus(); await page.keyboard.press('Enter');
  const retry = page.getByRole('button', { name: 'Retry Undo', exact: true }); await expect(retry).toBeVisible(); expect(state.restores).toEqual([{ undoToken:'opaque-signed-1' }]); await retry.focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('article', { name: 'Review item 2', exact: true })).toBeVisible(); expect(state.restores).toEqual([{ undoToken:'opaque-signed-1' },{ undoToken:'opaque-signed-1' }]); expect(page.url()).not.toContain('signed');
});

test('rejecting the last page returns to a visited page with filters preserved', async ({ catalogPage: page }) => {
  const state = await mutableQueue(page,Array.from({ length:51 },(_,index)=>makeRow(index+1)));
  await page.goto('/queue?status=pending&itemType=artist&q=Same'); await page.getByRole('button', { name:'Next page',exact:true }).click(); await expect(page.getByRole('article', { name:'Review item 1',exact:true })).toBeVisible(); await page.getByRole('article', { name:'Review item 1',exact:true }).getByRole('button', {name:'Reject',exact:true}).click(); await expect(page.getByRole('article', {name:'Review item 51',exact:true})).toBeVisible(); const url=new URL(page.url()); expect(url.searchParams.has('cursor')).toBe(false); expect(url.searchParams.get('q')).toBe('Same'); expect(url.searchParams.get('itemType')).toBe('artist'); expect(state.rejections[0].ids).toEqual([1]); await page.getByRole('button', {name:'Undo',exact:true}).focus(); await page.keyboard.press('Enter'); await expect.poll(()=>state.restores.length).toBe(1); await expect(page.getByText('51 matching review items', {exact:false})).toBeVisible();
});

test('mobile rows keep explicit actions, native selection, and scoped bulk controls within 320 pixels', async ({ catalogPage: page }) => {
  await mutableQueue(page,[makeRow(2),makeRow(1)]); await page.setViewportSize({width:320,height:700}); await page.goto('/queue'); await page.getByRole('checkbox', {name:'Select loaded page',exact:true}).check(); await expect(page.getByRole('region', {name:'Bulk actions',exact:true})).toContainText('Loaded page'); await expect(page.getByRole('button', {name:'Add selected items',exact:true})).toBeVisible(); expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const evidence=`${process.env.CATALOG_EVIDENCE_DIR || '/tmp/mixarr-catalog-evidence'}/review`; await mkdir(evidence,{recursive:true}); await page.screenshot({path:`${evidence}/mobile.png`,animations:'disabled'});
  const lastRow = page.getByRole('article', {name:'Review item 1',exact:true}); await lastRow.getByRole('button', {name:'Add artist',exact:true}).scrollIntoViewIfNeeded(); await lastRow.getByRole('button', {name:'Add artist',exact:true}).click(); const dialog=page.getByRole('dialog', {name:'Add artist options',exact:true}); await dialog.getByRole('button', {name:'Cancel',exact:true}).click(); await lastRow.getByRole('button', {name:'Reject',exact:true}).scrollIntoViewIfNeeded(); await lastRow.getByRole('button', {name:'Reject',exact:true}).click(); await expect(lastRow).toHaveCount(0); await expect(page.getByRole('region', {name:'Bulk actions',exact:true})).toContainText('1 selected');
});

test('unknown album artists require a chosen canonical identity while preserving the original review record', async ({ catalogPage: page }) => {
  const row = { ...makeRow(17), mbid: null, itemType: 'album', albumName: 'Only this album', albumMbid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  const state = await mutableQueue(page,[row]); await page.goto('/queue?itemType=album'); await page.getByRole('button', {name:'Add album',exact:true}).click(); const dialog = page.getByRole('dialog', {name:'Add artist options',exact:true}); await expect(dialog.getByRole('radio', {name:/Canadian ensemble/})).toBeVisible(); expect(state.approvals).toEqual([]); await dialog.getByRole('radio', {name:/Canadian ensemble/}).check(); await dialog.getByRole('combobox', {name:'Root folder',exact:true}).selectOption('/archive'); await dialog.getByLabel('Search on add', {exact:true}).uncheck(); await dialog.getByRole('button', {name:'Confirm add',exact:true}).click(); await expect(dialog).toHaveCount(0); expect(state.approvals).toEqual([expect.objectContaining({ids:[17],mbid:ARTIST_IDS[1],rootFolderPath:'/archive',searchOnAdd:false})]); expect(state.approvals[0]).not.toHaveProperty('monitorOption');
});
test('a visible signed Undo remains actionable after native navigation to the library', async ({ catalogPage: page }) => {
  const state = await mutableQueue(page,[makeRow(2),makeRow(1)]);
  await page.route('**/api/search/lidarr/artists/fix-all/status', route=>route.fulfill({json:{jobId:null,status:null,total:0,processed:0,fixed:0,failed:0}}));
  await page.goto('/library'); await expect(page.getByRole('heading', {name:'Lidarr Library',exact:true})).toBeVisible();
  await navigateCatalog(page, 'Review Queue'); await page.getByRole('article', {name:'Review item 2',exact:true}).getByRole('button', {name:'Reject',exact:true}).click(); await expect(page.getByRole('button', {name:'Undo',exact:true})).toBeVisible();
  await navigateCatalog(page, 'Library'); await expect(page).toHaveURL(/\/library$/); const undo = page.getByRole('button', {name:'Undo',exact:true}); await expect(undo).toBeVisible(); await undo.focus(); await page.keyboard.press('Enter'); await expect.poll(()=>state.restores.length).toBe(1); await expect(page.getByText('Rejection restored', {exact:true})).toBeVisible(); expect(state.restores).toEqual([{undoToken:'opaque-signed-1'}]);
});
test('empty queues and no-match searches have distinct recovery and preserve unrelated filters', async ({ catalogPage: page }) => {
  await mutableQueue(page,[]); await page.goto('/queue?keep=value'); await expect(page.getByText('No pending review items.', {exact:true})).toBeVisible(); await expect(page.getByRole('button', {name:'Clear queue filters',exact:true})).toHaveCount(0);
  await page.getByRole('textbox', {name:'Search review queue',exact:true}).fill('Not present'); await expect(page.getByText('No review items match your search or item type.', {exact:true})).toBeVisible(); await page.getByRole('button', {name:'Clear queue filters',exact:true}).click(); await expect(page.getByText('No pending review items.', {exact:true})).toBeVisible(); expect(new URL(page.url()).searchParams.get('keep')).toBe('value'); expect(new URL(page.url()).searchParams.has('q')).toBe(false);
});

test('a restoration finishing after logout cannot publish feedback into the replacement notification owner', async ({ catalogPage: page }) => {
  await mutableQueue(page,[makeRow(2),makeRow(1)]);
  await page.route('**/api/search/lidarr/artists/fix-all/status', route=>route.fulfill({json:{jobId:null,status:null,total:0,processed:0,fixed:0,failed:0}}));
  await page.route('**/api/auth/logout', route=>route.fulfill({json:{success:true}}));
  let finish!: ()=>Promise<void>, restores=0;
  await page.route('**/api/imports/review/restore', route=>new Promise<void>(resolve=>{restores++;finish=async()=>{await route.fulfill({json:{restoredIds:[2]}});resolve();};}));
  await page.goto('/library'); await expect(page.getByRole('heading', {name:'Lidarr Library',exact:true})).toBeVisible(); await navigateCatalog(page, 'Review Queue'); await page.getByRole('article', {name:'Review item 2',exact:true}).getByRole('button', {name:'Reject',exact:true}).click(); await expect(page.getByRole('button', {name:'Undo',exact:true})).toBeVisible(); await navigateCatalog(page, 'Library'); await page.getByRole('button', {name:'Undo',exact:true}).click(); await expect.poll(()=>restores).toBe(1);
  const menu = page.getByRole('button', {name:'Open menu',exact:true});
  if (await menu.isVisible()) {
    await menu.click(); const drawer = page.getByRole('dialog', {name:'Mixarr navigation',exact:true}); await expect(drawer).toBeVisible(); const logout = drawer.getByRole('button', {name:'Logout',exact:true}); await logout.focus(); await page.keyboard.press('Enter'); await expect(drawer).toHaveCount(0);
  } else { await page.getByRole('button', {name:'Account menu',exact:true}).click(); await page.getByRole('button', {name:'Logout',exact:true}).click(); }
  await expect(page).toHaveURL(/\/login(?:\?|$)/); await expect(page.getByRole('button', {name:'Undo',exact:true})).toHaveCount(0); const completed=page.waitForResponse('**/api/imports/review/restore'); await finish(); await (await completed).finished(); await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))); await expect(page.getByText('Rejection restored', {exact:true})).toHaveCount(0); await expect(page.getByText('Could not restore rejection', {exact:true})).toHaveCount(0); expect(restores).toBe(1);
});


test('queue status, item type and empty-state recovery replace filters without consuming Back history', async ({ catalogPage: page }) => {
  await page.goto('/search?q=Earlier');
  await page.goto('/queue?keep=value');
  await expect(page.getByText('Queue Artist 520', { exact: true })).toBeVisible();
  const initialLength = await page.evaluate(() => history.length);
  await page.getByRole('combobox', { name: 'Review status', exact: true }).selectOption('rejected');
  await expect(page.getByText('No rejected review items.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBe(initialLength);
  await page.getByRole('combobox', { name: 'Review item type', exact: true }).selectOption('album');
  await expect(page.getByText('No review items match your search or item type.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBe(initialLength);
  await page.getByRole('button', { name: 'Clear queue filters', exact: true }).click();
  await expect(page.getByText('No rejected review items.', { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.has('itemType')).toBe(false);
  expect(await page.evaluate(() => history.length)).toBe(initialLength);
  await page.getByRole('button', { name: 'View pending items', exact: true }).click();
  await expect(page.getByText('Queue Artist 520', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBe(initialLength);
  expect(new URL(page.url()).searchParams.get('keep')).toBe('value');
  await page.goBack();
  await expect(page).toHaveURL('/search?q=Earlier');
});
