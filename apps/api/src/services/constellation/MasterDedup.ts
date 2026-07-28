export interface ReleaseRef { releaseId: number; masterId: number | null; }

// A stable key per master; null-master releases key on their own release id.
export const masterKey = (r: ReleaseRef) => (r.masterId != null ? `m${r.masterId}` : `r${r.releaseId}`);

export function dedupToMasters(releases: ReleaseRef[]): Set<string> {
  return new Set(releases.map(masterKey));
}

export function sharedMasterCount(a: ReleaseRef[], b: ReleaseRef[]): number {
  const setA = dedupToMasters(a);
  const setB = dedupToMasters(b);
  let n = 0;
  for (const k of setA) if (setB.has(k)) n++;
  return n;
}
