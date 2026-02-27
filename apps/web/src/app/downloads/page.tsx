'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Skeleton } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/layout/page-header';
import { useSlskdDownloads, useRetrySlskdDownload, useCancelSlskdDownload, SlskdDownload } from '@/lib/hooks';
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle';
import Clock from 'lucide-react/dist/esm/icons/clock';
import Download from 'lucide-react/dist/esm/icons/download';
import File from 'lucide-react/dist/esm/icons/file';
import FolderOpen from 'lucide-react/dist/esm/icons/folder-open';
import HardDrive from 'lucide-react/dist/esm/icons/hard-drive';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Music from 'lucide-react/dist/esm/icons/music';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import User from 'lucide-react/dist/esm/icons/user';
import XCircle from 'lucide-react/dist/esm/icons/x-circle';

type StatusFilter = 'all' | 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled';

const statusOptions: { value: StatusFilter; label: string; icon: React.ElementType }[] = [
  { value: 'all', label: 'All', icon: Download },
  { value: 'pending', label: 'Pending', icon: Clock },
  { value: 'downloading', label: 'Downloading', icon: Loader2 },
  { value: 'completed', label: 'Completed', icon: CheckCircle },
  { value: 'failed', label: 'Failed', icon: XCircle },
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString();
}

function getStatusBadge(status: SlskdDownload['status']) {
  switch (status) {
    case 'pending':
      return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
    case 'downloading':
      return <Badge variant="default" className="bg-status-info"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Downloading</Badge>;
    case 'completed':
      return <Badge variant="success"><CheckCircle className="h-3 w-3 mr-1" />Completed</Badge>;
    case 'failed':
      return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Failed</Badge>;
    case 'cancelled':
      return <Badge variant="outline">Cancelled</Badge>;
  }
}

function DownloadCard({ 
  download, 
  onRetry, 
  onCancel,
  isRetrying,
  isCancelling 
}: { 
  download: SlskdDownload; 
  onRetry: () => void;
  onCancel: (remove: boolean) => void;
  isRetrying: boolean;
  isCancelling: boolean;
}) {
  const filename = download.filename.split('/').pop() || download.filename;
  const folder = download.filename.split('/').slice(0, -1).join('/');
  
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className="w-12 h-12 flex-shrink-0 rounded-lg bg-muted flex items-center justify-center">
            <Music className="h-6 w-6 text-muted-foreground" />
          </div>
          
          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold truncate">{download.artistName}</h3>
                {download.albumName && (
                  <p className="text-sm text-muted-foreground truncate">
                    {download.albumName} {download.albumYear && `(${download.albumYear})`}
                  </p>
                )}
              </div>
              {getStatusBadge(download.status)}
            </div>
            
            {/* File info */}
            <div className="mt-2 space-y-1 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <File className="h-3 w-3" />
                <span className="truncate">{filename}</span>
              </div>
              {folder && (
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-3 w-3" />
                  <span className="truncate">{folder}</span>
                </div>
              )}
              <div className="flex items-center gap-4 flex-wrap">
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {download.username}
                </span>
                <span className="flex items-center gap-1">
                  <HardDrive className="h-3 w-3" />
                  {formatBytes(download.fileSize)}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDate(download.createdAt)}
                </span>
              </div>
            </div>
            
            {/* Error message */}
            {download.error && (
              <div className="mt-2 p-2 rounded bg-destructive/10 text-destructive text-sm">
                {download.error}
              </div>
            )}
            
            {/* Organized path */}
            {download.organizedPath && (
              <div className="mt-2 p-2 rounded bg-success/10 text-success text-sm flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                Organized to: {download.organizedPath}
              </div>
            )}
          </div>
          
          {/* Actions */}
          <div className="flex flex-col gap-2">
            {download.status === 'failed' && (
              <Button 
                size="sm" 
                variant="outline" 
                onClick={onRetry}
                disabled={isRetrying}
              >
                {isRetrying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
              </Button>
            )}
            {(download.status === 'pending' || download.status === 'downloading') && (
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => onCancel(false)}
                disabled={isCancelling}
              >
                {isCancelling ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
              </Button>
            )}
            {(download.status === 'completed' || download.status === 'cancelled' || download.status === 'failed') && (
              <Button 
                size="sm" 
                variant="ghost" 
                onClick={() => onCancel(true)}
                disabled={isCancelling}
                title="Remove from list"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DownloadsPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const { addToast } = useToast();
  
  const queryStatus = statusFilter === 'all' ? undefined : statusFilter;
  const { data: downloads = [], isLoading, refetch, isFetching } = useSlskdDownloads(queryStatus);
  const retryMutation = useRetrySlskdDownload();
  const cancelMutation = useCancelSlskdDownload();
  
  const handleRetry = async (id: number) => {
    setRetryingId(id);
    try {
      await retryMutation.mutateAsync(id);
      addToast({ type: 'success', title: 'Download queued for retry' });
    } catch {
      addToast({ type: 'error', title: 'Failed to retry download' });
    }
    setRetryingId(null);
  };
  
  const handleCancel = async (id: number, remove: boolean) => {
    setCancellingId(id);
    try {
      await cancelMutation.mutateAsync({ id, remove });
      addToast({ 
        type: 'success', 
        title: remove ? 'Download removed' : 'Download cancelled' 
      });
    } catch {
      addToast({ type: 'error', title: 'Failed to cancel download' });
    }
    setCancellingId(null);
  };
  
  // Stats for the header
  const stats = {
    total: downloads.length,
    pending: downloads.filter(d => d.status === 'pending').length,
    downloading: downloads.filter(d => d.status === 'downloading').length,
    completed: downloads.filter(d => d.status === 'completed').length,
    failed: downloads.filter(d => d.status === 'failed').length,
  };

  return (
    <>
      <PageHeader
        title="slskd Downloads"
        description="Track and manage your Soulseek downloads"
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-sm text-muted-foreground">Total</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-status-warning">{stats.pending}</div>
            <div className="text-sm text-muted-foreground">Pending</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-status-info">{stats.downloading}</div>
            <div className="text-sm text-muted-foreground">Downloading</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-status-success">{stats.completed}</div>
            <div className="text-sm text-muted-foreground">Completed</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-status-error">{stats.failed}</div>
            <div className="text-sm text-muted-foreground">Failed</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          {statusOptions.map((option) => (
            <Button
              key={option.value}
              variant={statusFilter === option.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(option.value)}
            >
              <option.icon className={`h-4 w-4 mr-1 ${option.value === 'downloading' && statusFilter === option.value ? 'animate-spin' : ''}`} />
              {option.label}
            </Button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Downloads List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4 rounded-lg border bg-card">
              <Skeleton className="w-12 h-12 rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          ))}
        </div>
      ) : downloads.length === 0 ? (
        <EmptyState
          icon={Download}
          title="No downloads"
          description={statusFilter === 'all'
            ? 'Downloads from slskd will appear here.'
            : `No ${statusFilter} downloads.`}
        />
      ) : (
        <div className="space-y-4">
          {downloads.map((download) => (
            <DownloadCard
              key={download.id}
              download={download}
              onRetry={() => handleRetry(download.id)}
              onCancel={(remove) => handleCancel(download.id, remove)}
              isRetrying={retryingId === download.id}
              isCancelling={cancellingId === download.id}
            />
          ))}
        </div>
      )}
    </>
  );
}
