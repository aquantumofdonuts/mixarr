export type { ConnectionFormProps } from './types';

import { LidarrForm } from './LidarrForm';
import { SpotifyForm } from './SpotifyForm';
import { LastfmForm } from './LastfmForm';
import { TautulliForm } from './TautulliForm';
import { JellyfinForm } from './JellyfinForm';
import { DeezerForm } from './DeezerForm';
import { TidalForm } from './TidalForm';
import { ListenBrainzForm } from './ListenBrainzForm';
import { DiscogsForm } from './DiscogsForm';
import { SlskdForm } from './SlskdForm';
import type { ConnectionFormProps } from './types';

export {
  LidarrForm,
  SpotifyForm,
  LastfmForm,
  TautulliForm,
  JellyfinForm,
  DeezerForm,
  TidalForm,
  ListenBrainzForm,
  DiscogsForm,
  SlskdForm,
};

export const connectionForms: Record<string, React.ComponentType<ConnectionFormProps>> = {
  lidarr: LidarrForm,
  spotify: SpotifyForm,
  lastfm: LastfmForm,
  tautulli: TautulliForm,
  jellyfin: JellyfinForm,
  deezer: DeezerForm,
  tidal: TidalForm,
  listenbrainz: ListenBrainzForm,
  discogs: DiscogsForm,
  slskd: SlskdForm,
};
