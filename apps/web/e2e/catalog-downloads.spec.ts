import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect } from './catalog-fixtures';
import type { SlskdDownload } from '../src/lib/hooks';

const record = (id: number, status: SlskdDownload['status']): SlskdDownload => ({
  id, connectionId:11, username:'catalog-peer', artistName:`Download Artist ${id}`, albumName:'A release with extended collaborator credits', albumYear:2025,
  filename:`C:\\Shared\\Album\\${'Long filename '.repeat(12)}${id}.flac`,fileSize:'50000000',status,createdAt:'2026-10-07T12:00:00.000Z',updatedAt:'2026-10-07T12:00:00.000Z',
  ...(status==='completed'?{finalPath:'/music/Artist/Album/track.flac'}:{}),
});
async function downloadFixture(page: Page, initial: SlskdDownload[]) {
  const state={rows:initial,reads:[] as URL[],actions:[] as {id:number;remove:boolean;method:string}[],readFailure:false,actionFailure:false};
  await page.route('**/api/slskd/downloads**',async route=>{
    const request=route.request(), url=new URL(request.url()), method=request.method();
    if(url.pathname==='/api/slskd/downloads' && method==='GET') {
      state.reads.push(url); if(state.readFailure)return route.fulfill({status:503,json:{error:'Download service offline'}});
      const status=url.searchParams.get('status'); const limit=Number(url.searchParams.get('limit')||100);
      if(limit!==100 || (status && !['queued_locally','pending','downloading','organizing','completed','failed','cancelled'].includes(status)))throw new Error(`Unexpected download query: ${url}`);
      return route.fulfill({json:state.rows.filter(row=>!status || row.status===status).slice(0,limit)});
    }
    const match=url.pathname.match(/^\/api\/slskd\/downloads\/(\d+)(\/retry)?$/);
    if(!match || (match[2]?method!=='POST':method!=='DELETE'))throw new Error(`Unhandled download route: ${method} ${url}`);
    const id=Number(match[1]), row=state.rows.find(row=>row.id===id), remove=url.searchParams.get('remove')==='true';
    state.actions.push({id,remove,method});
    if(state.actionFailure)return route.fulfill({status:503,json:{error:'Could not update this download'}});
    if(!row)return route.fulfill({status:404,json:{error:'Download not found'}});
    if(match[2])row.status='pending'; else if(remove)state.rows=state.rows.filter(row=>row.id!==id);else row.status='cancelled';
    return route.fulfill({json:{success:true}});
  });
  return state;
}

test('filters replace history, reload restores them, invalid values stay bounded, and statistics describe the loaded set',async({catalogPage:page})=>{
  const state=await downloadFixture(page,Array.from({length:105},(_,index)=>record(index+1,index%2?'completed':'failed')));
  await page.goto('/search?q=Earlier');
  await page.goto('/downloads?keep=value&status=not-real');
  const initialLength = await page.evaluate(() => history.length);
  await expect(page.getByRole('article')).toHaveCount(100); await expect(page.getByText(/100 loaded records/)).toBeVisible(); await expect(page.getByText(/Counts describe this loaded set only/)).toBeVisible();
  const filter=page.getByRole('combobox',{name:'Download status',exact:true}); await expect(filter).toHaveValue('all');expect(state.reads[0].searchParams.has('status')).toBe(false);
  await filter.selectOption('failed');await expect(page).toHaveURL(/status=failed/);await expect(page.getByRole('article')).toHaveCount(53);expect(new URL(page.url()).searchParams.get('keep')).toBe('value');
  await filter.selectOption('completed');await expect(page.getByRole('article')).toHaveCount(52);expect(await page.evaluate(() => history.length)).toBe(initialLength);
  await Promise.all([page.waitForEvent('load'), page.evaluate(() => window.location.reload())]);await expect(filter).toHaveValue('completed');await expect(page.getByRole('article')).toHaveCount(52);expect(state.reads.every(url=>url.searchParams.get('limit')==='100')).toBe(true);
  await page.goBack();await expect(page).toHaveURL('/search?q=Earlier');
});

test('loading, empty, failure, and explicit retry remain distinct',async({catalogPage:page})=>{
  const state=await downloadFixture(page,[]); state.readFailure=true;
  await page.goto('/downloads?status=failed');await expect(page.getByText('Could not load downloads.',{exact:true})).toBeVisible({timeout:15000});await expect(page.getByText('No failed downloads in the returned set.',{exact:true})).toHaveCount(0);
  state.readFailure=false;await page.getByRole('button',{name:'Retry loading downloads',exact:true}).click();await expect(page.getByText('No failed downloads in the returned set.',{exact:true})).toBeVisible();
  await page.getByRole('combobox',{name:'Download status',exact:true}).selectOption('all');await expect(page.getByText('No downloads yet. Soulseek downloads will appear here.',{exact:true})).toBeVisible();
});

test('cancel names the transfer, describes tracking-only effects, retains failed confirmation, and retries once explicitly',async({catalogPage:page})=>{
  const state=await downloadFixture(page,[record(1,'downloading'),record(2,'failed')]);state.actionFailure=true;
  await page.goto('/downloads');const row=page.getByRole('article',{name:'Download 1',exact:true});await row.getByRole('button',{name:'Cancel tracking',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Cancel download tracking',exact:true});await expect(dialog).toContainText('Download Artist 1');await expect(dialog).toContainText('1.flac');await expect(dialog).toContainText('Mixarr tracking only. The remote slskd transfer may continue.');
  await dialog.getByRole('button',{name:'Mark cancelled',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Could not update this download');expect(state.actions).toEqual([{id:1,remove:false,method:'DELETE'}]);
  state.actionFailure=false;await dialog.getByRole('button',{name:'Retry',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(row).toContainText('Cancelled');expect(state.actions).toHaveLength(2);await expect(page.getByRole('article',{name:'Download 2',exact:true})).toBeVisible();
});

test('failed transfers retry inline and removal clearly keeps downloaded files',async({catalogPage:page})=>{
  const state=await downloadFixture(page,[record(1,'failed'),record(2,'completed')]);state.actionFailure=true;
  await page.goto('/downloads');const failed=page.getByRole('article',{name:'Download 1',exact:true});await failed.getByRole('button',{name:'Retry download',exact:true}).click();await expect(failed.getByRole('alert')).toContainText('Could not update this download');expect(state.actions).toHaveLength(1);
  state.actionFailure=false;await failed.getByRole('button',{name:'Retry download',exact:true}).click();await expect(failed).toContainText('Pending');expect(state.actions).toHaveLength(2);
  const completed=page.getByRole('article',{name:'Download 2',exact:true});await expect(completed).toContainText('/music/Artist/Album/track.flac');await completed.getByRole('button',{name:'Remove record',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Remove download record',exact:true});await expect(dialog).toContainText('Download Artist 2');await expect(dialog).toContainText('Downloaded files are kept.');await dialog.getByRole('button',{name:'Remove record',exact:true}).click();await expect(completed).toHaveCount(0);expect(state.actions.at(-1)).toEqual({id:2,remove:true,method:'DELETE'});
});

test('All refreshes returned active work, stops at terminal status, and stops when navigating away',async({catalogPage:page})=>{
  const state=await downloadFixture(page,[record(1,'downloading')]);await page.clock.install();await page.goto('/downloads');await expect(page.getByRole('article')).toHaveCount(1);
  const first=state.reads.length;state.rows[0].status='completed';await page.clock.fastForward(5001);await expect(page.getByRole('article')).toContainText('Completed');expect(state.reads.length).toBe(first+1);
  await page.clock.fastForward(15000);expect(state.reads.length).toBe(first+1);
  await page.getByRole('combobox',{name:'Download status',exact:true}).selectOption('pending');await expect(page.getByText('No pending downloads in the returned set.',{exact:true})).toBeVisible();const activeFilter=state.reads.length;
  await page.clock.fastForward(5001);await expect.poll(()=>state.reads.length).toBe(activeFilter+1);
  await page.goto('/search');const departed=state.reads.length;await page.clock.fastForward(15000);expect(state.reads.length).toBe(departed);
});

test.describe('member access',()=>{
  test.use({catalogRole:'user'});
  test('keeps owned transfer actions available for members',async({catalogPage:page})=>{
    await downloadFixture(page,[record(1,'failed'),record(2,'queued_locally')]);await page.goto('/downloads');await expect(page.getByRole('button',{name:'Retry download',exact:true})).toBeEnabled();await expect(page.getByRole('article',{name:'Download 2',exact:true})).toContainText('Queued locally');await expect(page.getByRole('button',{name:'Cancel tracking',exact:true})).toBeEnabled();
  });
});
for(const theme of ['light','dark'] as const)test(`320px ${theme} download rows and confirmation fit, wrap long filenames, and expose 44px actions`,async({catalogPage:page})=>{
  await downloadFixture(page,[record(1,'pending'),record(2,'completed')]);await page.setViewportSize({width:320,height:700});
  await page.addInitScript(value=>localStorage.setItem('theme',value),theme);await page.goto('/downloads');await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const cancel=page.getByRole('button',{name:'Cancel tracking',exact:true});expect((await cancel.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const dir=process.env.CATALOG_EVIDENCE_DIR||'/tmp/t25-evidence';await mkdir(dir,{recursive:true});await page.screenshot({path:`${dir}/downloads-${theme}-320.png`,fullPage:true,animations:'disabled'});
  await cancel.focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog',{name:'Cancel download tracking',exact:true});await expect(dialog).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`${dir}/downloads-confirm-${theme}-320.png`,animations:'disabled'});await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(cancel).toBeFocused();
});


test('held initial loading cannot masquerade as an empty response',async({catalogPage:page})=>{
  let release!:()=>Promise<void>;
  await page.route('**/api/slskd/downloads**',route=>new Promise<void>(resolve=>{release=async()=>{await route.fulfill({json:[]});resolve();};}));
  await page.goto('/downloads');await expect(page.getByText('Loading downloads…',{exact:true})).toBeVisible();await expect(page.getByText(/No downloads yet/)).toHaveCount(0);
  await release();await expect(page.getByText('No downloads yet. Soulseek downloads will appear here.',{exact:true})).toBeVisible();
});

test('pending actions and failures stay on their own rows',async({catalogPage:page})=>{
  await downloadFixture(page,[record(1,'failed'),record(2,'failed')]);let release!:()=>Promise<void>;
  await page.route('**/api/slskd/downloads/1/retry',route=>new Promise<void>(resolve=>{release=async()=>{await route.fulfill({status:503,json:{error:'First transfer failed'}});resolve();};}));
  await page.goto('/downloads');const first=page.getByRole('article',{name:'Download 1',exact:true}),second=page.getByRole('article',{name:'Download 2',exact:true});
  await first.getByRole('button',{name:'Retry download',exact:true}).click();await expect(first.getByRole('button',{name:'Queuing retry…',exact:true})).toBeDisabled();await expect(second.getByRole('button',{name:'Retry download',exact:true})).toBeEnabled();
  await second.getByRole('button',{name:'Retry download',exact:true}).click();await expect(second).toContainText('Pending');await release();await expect(first.getByRole('alert')).toContainText('First transfer failed');await expect(second.getByRole('alert')).toHaveCount(0);await expect(first.getByRole('button',{name:'Retry download',exact:true})).toBeEnabled();
});
