'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Skeleton } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/layout/page-header';
import { useAuth } from '@/lib/auth';
import { useReviewQueue, useUpdateReviewItem, useBulkUpdateReview } from '@/lib/hooks';
import { SlskdSearchModal } from '@/components/slskd/SearchModal';
import Check from 'lucide-react/dist/esm/icons/check';
import CheckSquare from 'lucide-react/dist/esm/icons/check-square';
import Clock from 'lucide-react/dist/esm/icons/clock';
import Disc from 'lucide-react/dist/esm/icons/disc';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Music2 from 'lucide-react/dist/esm/icons/music-2';
import Search from 'lucide-react/dist/esm/icons/search';
import Square from 'lucide-react/dist/esm/icons/square';
import User from 'lucide-react/dist/esm/icons/user';
import Users from 'lucide-react/dist/esm/icons/users';
import X from 'lucide-react/dist/esm/icons/x';

export default function QueuePage() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [itemTypeFilter, setItemTypeFilter] = useState<'artist' | 'album' | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [processingId, setProcessingId] = useState<number | null>(null);
  const { addToast } = useToast();
  
  // slskd Search state
  const [slskdModalOpen, setSlskdModalOpen] = useState(false);
  const [slskdSearchArtist, setSlskdSearchArtist] = useState<{ name: string; image?: string } | null>(null);

  // React Query hooks with caching
  const { data: queueData, isLoading } = useReviewQueue(statusFilter, itemTypeFilter);
  const items = queueData?.items ?? [];
  const totalItems = queueData?.total ?? items.length;
  const updateMutation = useUpdateReviewItem();
  const bulkUpdateMutation = useBulkUpdateReview();

  // Reset selection when status filter changes
  const handleStatusChange = (status: 'pending' | 'approved' | 'rejected') => {
    setStatusFilter(status);
    setSelectedIds(new Set());
  };

  // Reset selection when item type filter changes
  const handleItemTypeChange = (itemType: 'artist' | 'album' | undefined) => {
    setItemTypeFilter(itemType);
    setSelectedIds(new Set());
  };

  const handleUpdateStatus = async (id: number, status: 'approved' | 'rejected') => {
    setProcessingId(id);
    try {
      await updateMutation.mutateAsync({ id, status });
      addToast({ type: 'success', title: status === 'approved' ? 'Item approved' : 'Item rejected' });
    } catch {
      addToast({ type: 'error', title: 'Failed to update item' });
    }
    setProcessingId(null);
  };

  const handleBulkUpdate = async (status: 'approved' | 'rejected') => {
    if (selectedIds.size === 0) return;
    
    try {
      await bulkUpdateMutation.mutateAsync({ ids: Array.from(selectedIds), status });
      addToast({ type: 'success', title: `${selectedIds.size} items ${status}` });
      setSelectedIds(new Set());
    } catch {
      addToast({ type: 'error', title: 'Failed to update items' });
    }
  };

  const toggleSelect = (id: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.map(item => item.id)));
    }
  };

  const filteredItems = items.filter(item =>
    item.artistName.toLowerCase().includes(search.toLowerCase()) ||
    (item.albumName && item.albumName.toLowerCase().includes(search.toLowerCase()))
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="warning">Pending</Badge>;
      case 'approved':
        return <Badge variant="success">Approved</Badge>;
      case 'rejected':
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <>
      <PageHeader
        title="Review Queue"
        description="Review and approve pending artist imports"
      />

      {/* Filters and bulk actions */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="flex gap-2">
          {(['pending', 'approved', 'rejected'] as const).map(status => (
            <Button
              key={status}
              variant={statusFilter === status ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleStatusChange(status)}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Button>
          ))}
        </div>

        {/* Item type filter */}
        <div className="flex gap-1 bg-muted rounded-container p-1">
          <Button
            variant={itemTypeFilter === undefined ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => handleItemTypeChange(undefined)}
            className="h-7 px-3"
          >
            All
          </Button>
          <Button
            variant={itemTypeFilter === 'artist' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => handleItemTypeChange('artist')}
            className="h-7 px-3"
          >
            <Users className="h-3 w-3 mr-1" />
            Artists
          </Button>
          <Button
            variant={itemTypeFilter === 'album' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => handleItemTypeChange('album')}
            className="h-7 px-3"
          >
            <Disc className="h-3 w-3 mr-1" />
            Albums
          </Button>
        </div>

        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search artists..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {statusFilter === 'pending' && selectedIds.size > 0 && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => handleBulkUpdate('approved')} disabled={bulkUpdateMutation.isPending}>
              {bulkUpdateMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
              Approve ({selectedIds.size})
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleBulkUpdate('rejected')} disabled={bulkUpdateMutation.isPending}>
              {bulkUpdateMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <X className="h-4 w-4 mr-1" />}
              Reject ({selectedIds.size})
            </Button>
          </div>
        )}
      </div>

      {/* Items list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4 rounded-container border bg-card">
              <Skeleton className="w-12 h-12 rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <EmptyState
          icon={Music2}
          title={`No ${statusFilter} items in the queue`}
          description={'Items are added when subscriptions run with "queue" result handling'}
        />
      ) : (
        <div className="space-y-2">
          {/* Truncation notice when the queue exceeds the page size */}
          {totalItems > items.length && (
            <p className="text-sm text-muted-foreground px-4">
              Showing the {items.length} most recent of {totalItems} items — approve or reject items to see more.
            </p>
          )}

          {/* Select all header */}
          {statusFilter === 'pending' && filteredItems.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 bg-muted/50 rounded-container">
              <button onClick={toggleSelectAll} className="text-muted-foreground hover:text-foreground">
                {selectedIds.size === filteredItems.length ? (
                  <CheckSquare className="h-5 w-5" />
                ) : (
                  <Square className="h-5 w-5" />
                )}
              </button>
              <span className="text-sm text-muted-foreground">
                {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select all'}
              </span>
            </div>
          )}

          {filteredItems.map((item) => (
            <Card key={item.id} className="hover:bg-muted/50 transition-colors">
              <CardContent className="px-4 py-3">
                <div className={`flex items-center ${statusFilter === 'pending' ? 'gap-4' : 'gap-3'}`}>
                  {statusFilter === 'pending' && (
                    <button
                      onClick={() => toggleSelect(item.id)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {selectedIds.has(item.id) ? (
                        <CheckSquare className="h-5 w-5 text-primary" />
                      ) : (
                        <Square className="h-5 w-5" />
                      )}
                    </button>
                  )}

                  <div className="flex-shrink-0 w-10 h-10 rounded-md overflow-hidden bg-muted">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.artistName}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <Music2 className="h-5 w-5" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold truncate">{item.artistName}</h3>
                      {item.itemType === 'album' && (
                        <Badge variant="outline" className="text-xs">
                          <Disc className="h-3 w-3 mr-1" />
                          Album
                        </Badge>
                      )}
                      {getStatusBadge(item.status)}
                      {user?.role === 'admin' && item.user && (
                        <Badge variant="outline" className="text-xs">
                          <User className="h-3 w-3 mr-1" />
                          {item.user.displayName || item.user.username}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {item.source}
                      {item.albumName && ` · ${item.albumName}`}
                      {item.releaseYear && ` (${item.releaseYear})`}
                    </p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(item.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  {statusFilter === 'pending' && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setSlskdSearchArtist({ name: item.artistName, image: item.imageUrl || undefined });
                          setSlskdModalOpen(true);
                        }}
                        title="Search on Soulseek"
                      >
                        <Search className="h-4 w-4 text-status-info" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleUpdateStatus(item.id, 'approved')}
                        disabled={processingId === item.id}
                        title="Approve"
                      >
                        {processingId === item.id ? (
                          <Loader2 className="h-4 w-4 animate-spin text-status-success" />
                        ) : (
                          <Check className="h-4 w-4 text-status-success" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleUpdateStatus(item.id, 'rejected')}
                        disabled={processingId === item.id}
                        title="Reject"
                      >
                        {processingId === item.id ? (
                          <Loader2 className="h-4 w-4 animate-spin text-destructive" />
                        ) : (
                          <X className="h-4 w-4 text-destructive" />
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* slskd Search Modal */}
      {slskdSearchArtist && (
        <SlskdSearchModal
          isOpen={slskdModalOpen}
          onClose={() => {
            setSlskdModalOpen(false);
            setSlskdSearchArtist(null);
          }}
          artistName={slskdSearchArtist.name}
          artistImage={slskdSearchArtist.image}
        />
      )}
    </>
  );
}
