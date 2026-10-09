'use client';

import { useEffect, useRef, useState } from 'react';
import { AlbumCard } from '@/components/AlbumCard';
import type { AlbumResult } from '../hooks/useSearch';
export interface AlbumSearchProps {
  results: AlbumResult[];
  disabled?: boolean;
  onOpen?: (trigger: HTMLElement) => void;
  onAddArtist: (artistId: string, artistName: string) => Promise<{ success: boolean; error?: string }>;
}
export function AlbumSearch({ results, disabled = false, onOpen, onAddArtist }: AlbumSearchProps) {
  const [outcomes, setOutcomes] = useState<Record<string, { pending?: boolean; confirmed?: boolean; error?: string }>>({});
  const pending = useRef(new Set<string>()), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function add(id: string, name: string) {
    if (pending.current.has(id)) return;
    pending.current.add(id); setOutcomes(previous => ({ ...previous, [id]: { pending: true } }));
    try {
      const outcome = await onAddArtist(id, name);
      if (mounted.current) setOutcomes(previous => ({ ...previous, [id]: { confirmed: outcome.success, error: outcome.error } }));
    } catch (cause) {
      if (mounted.current) setOutcomes(previous => ({ ...previous, [id]: { error: cause instanceof Error ? cause.message : 'Addition failed' } }));
    } finally { pending.current.delete(id); }
  }
  return <div className="divide-y border-b">{results.map(album => {
    const artist = album['artist-credit']?.[0]?.artist;
    const outcome = artist ? outcomes[artist.id] : undefined;
    return <AlbumCard key={album.id} id={album.id} title={album.title} artistId={artist?.id} artistName={artist?.name} date={album.date}
      pending={outcome?.pending} confirmed={outcome?.confirmed} error={outcome?.error} disabled={disabled} onOpen={onOpen}
      onAddArtist={(id, name) => { void add(id, name); }} />;
  })}</div>;
}
