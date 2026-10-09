'use client';

import { ArtistSearch, type ArtistSearchProps } from './ArtistSearch';
export interface AISearchProps extends ArtistSearchProps { aiPrompt: string; aiProviders: string[] }
export function AISearch({ aiPrompt, aiProviders, ...props }: AISearchProps) {
  return <><div className="border-y py-3 text-sm"><p>Recommendations for: {aiPrompt}</p>{aiProviders.length > 0 && <p className="text-muted-foreground">Providers: {aiProviders.join(', ')}</p>}</div><ArtistSearch {...props} /></>;
}
