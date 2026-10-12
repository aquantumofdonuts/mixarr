export function bridgeScore(
  na: Set<number>, nb: Set<number>, aFull: boolean, bFull: boolean,
): { score: number | null; confident: boolean } {
  const confident = aFull && bFull;
  if (!confident) return { score: null, confident: false };
  let inter = 0;
  for (const x of na) if (nb.has(x)) inter++;
  const union = na.size + nb.size - inter;
  const score = union === 0 ? 0 : 1 - inter / union;
  return { score, confident: true };
}
