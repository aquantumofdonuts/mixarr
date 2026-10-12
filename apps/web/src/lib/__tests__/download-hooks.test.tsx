import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const actor = vi.hoisted(() => ({ id: 1 as number | null, role: 'user' }));
vi.mock('../auth', () => ({ useAuth: () => ({ user: actor.id === null ? null : { id: actor.id, role: actor.role } }) }));
vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
import { api } from '../api';
import { useSlskdDownloads, useRetrySlskdDownload, useCancelSlskdDownload } from '../hooks';
let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => {
  vi.clearAllMocks(); actor.id=1; actor.role='user';
  client = new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:2,retryDelay:0}}});
  client.setQueryData(['auth'],{user:{id:1,role:'user'}});
  vi.mocked(api.get).mockResolvedValue({data:[],error:null,status:200});
});
afterEach(() => { cleanup(); client.clear(); vi.useRealTimers(); });
const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(1); }); };
it('requests bounded data with a signal and scopes cached results by actor, role, and status', async () => {
  const {result,rerender}=renderHook(({status})=>useSlskdDownloads(status),{wrapper,initialProps:{status:'failed'}});
  await waitFor(()=>expect(result.current.data).toEqual([]));
  expect(api.get).toHaveBeenCalledWith('/api/slskd/downloads?limit=100&status=failed',{signal:expect.any(AbortSignal)});
  actor.id=2; rerender({status:'failed'}); expect(result.current.data).toBeUndefined(); await waitFor(()=>expect(api.get).toHaveBeenCalledTimes(2));
  actor.role='admin'; rerender({status:'failed'}); expect(result.current.data).toBeUndefined(); await waitFor(()=>expect(api.get).toHaveBeenCalledTimes(3));
  rerender({status:'completed'}); await waitFor(()=>expect(api.get).toHaveBeenCalledTimes(4));
});
it('does not request anonymous data and aborts an in-flight read on unmount', async () => {
  actor.id=null; const anonymous=renderHook(()=>useSlskdDownloads(),{wrapper}); expect(anonymous.result.current.fetchStatus).toBe('idle'); expect(api.get).not.toHaveBeenCalled(); anonymous.unmount(); actor.id=1;
  vi.mocked(api.get).mockImplementation(()=>new Promise(()=>{}));
  const mounted=renderHook(()=>useSlskdDownloads(),{wrapper}); const signal=vi.mocked(api.get).mock.calls[0][1]!.signal!;
  expect(signal.aborted).toBe(false); mounted.unmount(); expect(signal.aborted).toBe(true);
});
it('polls All while returned work is active, avoids overlap, and stops when records are terminal', async () => {
  vi.useFakeTimers(); vi.mocked(api.get).mockResolvedValueOnce({data:[{status:'queued_locally'}],error:null,status:200});
  let finish!: (response: any)=>void; vi.mocked(api.get).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const mounted=renderHook(()=>useSlskdDownloads(),{wrapper}); await settle(); expect(mounted.result.current.data).toEqual([{status:'queued_locally'}]);
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000);}); expect(api.get).toHaveBeenCalledTimes(2);
  await act(async()=>{await vi.advanceTimersByTimeAsync(15000);}); expect(api.get).toHaveBeenCalledTimes(2);
  await act(async()=>{finish({data:[{status:'completed'}],error:null,status:200});}); await settle();
  await act(async()=>{await vi.advanceTimersByTimeAsync(15000);}); expect(api.get).toHaveBeenCalledTimes(2);
  mounted.unmount(); await act(async()=>{await vi.advanceTimersByTimeAsync(10000);}); expect(api.get).toHaveBeenCalledTimes(2);
});
it.each(['queued_locally','pending','downloading','organizing'])('keeps explicit %s filters polling even when empty', async status => {
  vi.useFakeTimers(); renderHook(()=>useSlskdDownloads(status),{wrapper}); await settle();
  await act(async()=>{await vi.advanceTimersByTimeAsync(10001);}); expect(api.get).toHaveBeenCalledTimes(3);
});
it('preserves the last loaded work and recovers after a polling failure', async () => {
  vi.useFakeTimers(); vi.mocked(api.get).mockResolvedValueOnce({data:[{status:'downloading'}],error:null,status:200}).mockResolvedValueOnce({data:null,error:'Offline',status:503}).mockResolvedValueOnce({data:[{status:'completed'}],error:null,status:200});
  const {result}=renderHook(()=>useSlskdDownloads(),{wrapper}); await settle(); await act(async()=>{await vi.advanceTimersByTimeAsync(5001);});
  expect(result.current.isError).toBe(true); expect(result.current.data).toEqual([{status:'downloading'}]);
  await act(async()=>{await vi.advanceTimersByTimeAsync(5001);}); expect(result.current.isError).toBe(false); expect(result.current.data).toEqual([{status:'completed'}]);
});
it.each([null,{}])('rejects invalid successful read response %j', async data => {
  vi.mocked(api.get).mockResolvedValue({data:data as any,error:null,status:200}); const {result}=renderHook(()=>useSlskdDownloads(),{wrapper}); await waitFor(()=>expect(result.current.isError).toBe(true));
});
it.each(['retry','cancel'] as const)('never automatically retries %s despite the actual global retry policy and requires confirmed success', async kind => {
  const transport=kind==='retry'?vi.mocked(api.post):vi.mocked(api.delete); transport.mockResolvedValue({data:{success:false},error:null,status:200});
  const {result}=renderHook(()=>({retry:useRetrySlskdDownload(),cancel:useCancelSlskdDownload()}),{wrapper});
  await act(async()=>{await expect(kind==='retry'?result.current.retry.mutateAsync(11):result.current.cancel.mutateAsync({id:11,remove:true})).rejects.toThrow(/not confirmed/);}); expect(transport).toHaveBeenCalledTimes(1);
});
it.each(['retry','cancel'] as const)('ignores late %s completion after actor replacement and invalidates only confirmed current actions', async kind => {
  const transport=kind==='retry'?vi.mocked(api.post):vi.mocked(api.delete); let finish!: (response:any)=>void;
  transport.mockImplementation(()=>new Promise(resolve=>{finish=resolve;})); const invalidate=vi.spyOn(client,'invalidateQueries');
  const {result}=renderHook(()=>({retry:useRetrySlskdDownload(),cancel:useCancelSlskdDownload()}),{wrapper});
  const send=()=>kind==='retry'?result.current.retry.mutateAsync(11):result.current.cancel.mutateAsync({id:11,remove:true});
  let pending!:Promise<unknown>; await act(async()=>{pending=send();await Promise.resolve();}); client.setQueryData(['auth'],{user:{id:2}});
  await act(async()=>{finish({data:{success:true},error:null,status:200});await pending;}); expect(invalidate).not.toHaveBeenCalled();
  await act(async()=>{pending=send();await Promise.resolve();}); await act(async()=>{finish({data:{success:true},error:null,status:200});await pending;}); expect(invalidate).toHaveBeenCalledWith({queryKey:['slskd','downloads']});
});


it.each(['retry','cancel'] as const)('ignores late %s completion after a same-actor role change', async kind => {
  const transport=kind==='retry'?vi.mocked(api.post):vi.mocked(api.delete); let finish!: (response:any)=>void;
  transport.mockImplementation(()=>new Promise(resolve=>{finish=resolve;})); const invalidate=vi.spyOn(client,'invalidateQueries');
  const {result}=renderHook(()=>({retry:useRetrySlskdDownload(),cancel:useCancelSlskdDownload()}),{wrapper});
  let pending!:Promise<unknown>; await act(async()=>{pending=kind==='retry'?result.current.retry.mutateAsync(11):result.current.cancel.mutateAsync({id:11});await Promise.resolve();});
  client.setQueryData(['auth'],{user:{id:1,role:'admin'}});
  await act(async()=>{finish({data:{success:true},error:null,status:200});await pending;});expect(invalidate).not.toHaveBeenCalled();
});

it('honors production query retry:1 (two attempts), preserves loaded work, and resumes after failure', async () => {
  vi.useFakeTimers(); client.setDefaultOptions({queries:{retry:1},mutations:{retry:1}});
  vi.mocked(api.get).mockResolvedValueOnce({data:[{status:'pending'}],error:null,status:200}).mockResolvedValue({data:null,error:'Offline',status:503});
  const {result}=renderHook(()=>useSlskdDownloads(),{wrapper}); await settle();
  await act(async()=>{await vi.advanceTimersByTimeAsync(5001);}); expect(api.get).toHaveBeenCalledTimes(2);expect(result.current.isError).toBe(false);
  await act(async()=>{await vi.advanceTimersByTimeAsync(1001);}); expect(api.get).toHaveBeenCalledTimes(3);expect(result.current.isError).toBe(true);expect(result.current.data).toEqual([{status:'pending'}]);
  vi.mocked(api.get).mockResolvedValue({data:[{status:'completed'}],error:null,status:200});
  await act(async()=>{await vi.advanceTimersByTimeAsync(5001);});expect(result.current.isError).toBe(false);expect(result.current.data).toEqual([{status:'completed'}]);
  const count=vi.mocked(api.get).mock.calls.length;await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});expect(api.get).toHaveBeenCalledTimes(count);
});
