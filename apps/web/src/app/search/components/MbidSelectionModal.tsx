'use client';

import { Button } from '@/components/ui/button';
import { Modal, ModalFooter } from '@/components/ui/modal';
import type { MbidCandidate, ArtistResult } from '../hooks/useSearch';

export interface MbidSelectionModalProps {
  candidates: MbidCandidate[] | null;
  artist: ArtistResult | null;
  onSelect: (mbid: string) => void;
  onClose: () => void;
}

/**
 * Modal shown when an artist name matches multiple MusicBrainz entries.
 * Displays the list of MBID candidates for disambiguation so the user
 * can pick the correct one.
 */
export function MbidSelectionModal({
  candidates,
  artist,
  onSelect,
  onClose,
}: MbidSelectionModalProps) {
  return (
    <Modal
      isOpen={candidates !== null && artist !== null}
      onClose={onClose}
      title="Select Artist"
      size="lg"
    >
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground mb-4">
          Multiple matches found in MusicBrainz for &quot;{artist?.artistName}&quot;.
          Please select the correct artist:
        </p>
        {candidates?.map((candidate) => (
          <button
            key={candidate.id}
            className="w-full p-3 text-left rounded-lg border hover:bg-muted/50 transition-colors"
            onClick={() => onSelect(candidate.id)}
          >
            <div className="font-medium">{candidate.name}</div>
            {candidate.disambiguation && (
              <div className="text-sm text-muted-foreground">
                {candidate.disambiguation}
              </div>
            )}
            {candidate.country && (
              <div className="text-xs text-muted-foreground">
                Country: {candidate.country}
              </div>
            )}
          </button>
        ))}
      </div>
      <ModalFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}
