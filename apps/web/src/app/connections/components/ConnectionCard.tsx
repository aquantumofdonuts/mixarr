'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Check from 'lucide-react/dist/esm/icons/check';
import Edit from 'lucide-react/dist/esm/icons/edit';
import Plus from 'lucide-react/dist/esm/icons/plus';
import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-2';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import X from 'lucide-react/dist/esm/icons/x';

export interface Connection {
  id: number;
  userId: number | null;
  type: 'lidarr' | 'spotify' | 'lastfm' | 'tautulli' | 'jellyfin' | 'deezer' | 'tidal' | 'listenbrainz' | 'discogs' | 'slskd';
  name: string;
  isActive: boolean;
  lastTest: string | null;
  createdAt: string;
  user?: { username: string; displayName: string } | null;
}

export interface ConnectionCardProps {
  typeConfig: { value: string; label: string; color: string; description: string; icon?: string };
  connections: Connection[];
  isAdmin: boolean;
  onAdd: (type: string) => void;
  onEdit: (id: number) => void;
  onTest: (id: number) => void;
  onDelete: (id: number) => void;
  testingId: number | null;
}

export function ConnectionCard({
  typeConfig,
  connections,
  isAdmin,
  onAdd,
  onEdit,
  onTest,
  onDelete,
  testingId,
}: ConnectionCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div
            className="h-10 w-10 rounded flex items-center justify-center text-white font-bold"
            style={{ backgroundColor: typeConfig.color }}
          >
            {typeConfig.icon ?? typeConfig.label[0]}
          </div>
          <div>
            <CardTitle className="text-lg">{typeConfig.label}</CardTitle>
            <CardDescription>{typeConfig.description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {connections.length === 0 ? (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onAdd(typeConfig.value)}
          >
            <Plus className="h-4 w-4 mr-2" /> Configure
          </Button>
        ) : (
          <div className="space-y-2">
            {connections.map((conn) => (
              <div key={conn.id} className="p-3 rounded-lg border space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {conn.isActive ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <X className="h-4 w-4 text-red-500" />
                    )}
                    <span className="font-medium">{conn.name}</span>
                    {/* Owner badges visible to admins */}
                    {isAdmin && (
                      conn.userId === null ? (
                        <Badge variant="secondary" className="text-xs">Global</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">Personal</Badge>
                      )
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onTest(conn.id)}
                      disabled={testingId === conn.id}
                      title="Test connection"
                    >
                      <TestTube2 className={`h-4 w-4 ${testingId === conn.id ? 'animate-pulse' : ''}`} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => onEdit(conn.id)} title="Edit">
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => onDelete(conn.id)} title="Delete">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                {/* TODO: OAuthButtons — will be filled in E1.4 */}
                {/* TODO: LidarrMaintenance — will be filled in E1.5 */}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
