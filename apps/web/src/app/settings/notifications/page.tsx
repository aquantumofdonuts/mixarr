'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog, EmptyState } from '@/components/ui';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { Select } from '@/components/ui/select';
import { Modal } from '@/components/ui/modal';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeader } from '@/components/layout/page-header';
import { api } from '@/lib/api';
import { formatEvents, type NotificationEvent } from '@/lib/notification-events';
import Bell from 'lucide-react/dist/esm/icons/bell';
import Check from 'lucide-react/dist/esm/icons/check';
import Edit2 from 'lucide-react/dist/esm/icons/edit-2';
import Mail from 'lucide-react/dist/esm/icons/mail';
import MessageCircle from 'lucide-react/dist/esm/icons/message-circle';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Send from 'lucide-react/dist/esm/icons/send';
import TestTube from 'lucide-react/dist/esm/icons/test-tube';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Webhook from 'lucide-react/dist/esm/icons/webhook';
import X from 'lucide-react/dist/esm/icons/x';

interface NotificationChannel {
  id: number;
  type: 'discord' | 'webhook' | 'telegram' | 'pushover' | 'email';
  name: string;
  config: Record<string, any>;
  events: string[];
  isActive: boolean;
  createdAt: string;
}

const channelTypeIcons: Record<string, React.ElementType> = {
  discord: MessageCircle,
  webhook: Webhook,
  telegram: Send,
  pushover: Bell,
  email: Mail,
};

const channelTypeLabels: Record<string, string> = {
  discord: 'Discord',
  webhook: 'Webhook',
  telegram: 'Telegram',
  pushover: 'Pushover',
  email: 'Email',
};

export default function NotificationsSettingsPage() {
  const { addToast } = useToast();
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingChannel, setEditingChannel] = useState<NotificationChannel | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<number | null>(null);

  // Form state
  const [form, setForm] = useState({
    type: 'discord' as NotificationChannel['type'],
    name: '',
    webhookUrl: '',
    username: '',
    url: '',
    method: 'POST',
    headers: '',
    events: [] as string[],
    isActive: true,
  });

  useEffect(() => {
    fetchChannels();
    fetchEvents();
  }, []);

  const fetchChannels = async () => {
    setLoading(true);
    const { data, error } = await api.get<NotificationChannel[]>('/api/notifications/channels');
    if (error) {
      addToast({ type: 'error', title: 'Failed to load channels', message: error });
    } else {
      setChannels(data || []);
    }
    setLoading(false);
  };

  const fetchEvents = async () => {
    const { data } = await api.get<string[]>('/api/notifications/events');
    if (data) setEvents(formatEvents(data));
  };

  const openAddModal = () => {
    setEditingChannel(null);
    setForm({
      type: 'discord',
      name: '',
      webhookUrl: '',
      username: '',
      url: '',
      method: 'POST',
      headers: '',
      events: [],
      isActive: true,
    });
    setShowModal(true);
  };

  const openEditModal = (channel: NotificationChannel) => {
    setEditingChannel(channel);
    setForm({
      type: channel.type,
      name: channel.name,
      webhookUrl: channel.config.webhookUrl || '',
      username: channel.config.username || '',
      url: channel.config.url || '',
      method: channel.config.method || 'POST',
      headers: channel.config.headers ? JSON.stringify(channel.config.headers) : '',
      events: channel.events,
      isActive: channel.isActive,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    // Build config based on type
    let config: Record<string, any> = {};
    
    if (form.type === 'discord') {
      if (!form.webhookUrl) {
        addToast({ type: 'error', title: 'Validation Error', message: 'Discord webhook URL is required' });
        return;
      }
      config = {
        webhookUrl: form.webhookUrl,
        username: form.username || undefined,
      };
    } else if (form.type === 'webhook') {
      if (!form.url) {
        addToast({ type: 'error', title: 'Validation Error', message: 'Webhook URL is required' });
        return;
      }
      config = {
        url: form.url,
        method: form.method,
        headers: form.headers ? JSON.parse(form.headers) : undefined,
      };
    }

    if (form.events.length === 0) {
      addToast({ type: 'error', title: 'Validation Error', message: 'Select at least one event' });
      return;
    }

    const payload = {
      type: form.type,
      name: form.name || `My ${channelTypeLabels[form.type]}`,
      config,
      events: form.events,
      isActive: form.isActive,
    };

    const { error } = editingChannel
      ? await api.put(`/api/notifications/channels/${editingChannel.id}`, payload)
      : await api.post('/api/notifications/channels', payload);

    if (error) {
      addToast({ type: 'error', title: 'Failed to save channel', message: error });
    } else {
      addToast({ type: 'success', title: editingChannel ? 'Channel updated' : 'Channel created' });
      setShowModal(false);
      fetchChannels();
    }
  };

  const handleDeleteClick = (id: number) => setConfirmTarget(id);
  const confirmDelete = async () => {
    if (confirmTarget === null) return;

    const { error } = await api.delete(`/api/notifications/channels/${confirmTarget}`);
    if (error) {
      addToast({ type: 'error', title: 'Failed to delete channel', message: error });
    } else {
      addToast({ type: 'success', title: 'Channel deleted' });
      fetchChannels();
    }
    setConfirmTarget(null);
  };

  const handleTest = async (id: number) => {
    setTestingId(id);
    const { error } = await api.post(`/api/notifications/channels/${id}/test`);
    setTestingId(null);
    
    if (error) {
      addToast({ type: 'error', title: 'Test failed', message: error });
    } else {
      addToast({ type: 'success', title: 'Test notification sent!' });
    }
  };

  const toggleEvent = (eventValue: string) => {
    setForm(prev => ({
      ...prev,
      events: prev.events.includes(eventValue)
        ? prev.events.filter(e => e !== eventValue)
        : [...prev.events, eventValue],
    }));
  };

  const toggleActive = async (channel: NotificationChannel) => {
    const { error } = await api.put(`/api/notifications/channels/${channel.id}`, {
      isActive: !channel.isActive,
    });
    if (error) {
      addToast({ type: 'error', title: 'Failed to update channel', message: error });
    } else {
      fetchChannels();
    }
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Configure notification channels for Mixarr events"
      >
        <Button onClick={openAddModal}>
          <Plus className="w-4 h-4 mr-2" />
          Add Channel
        </Button>
      </PageHeader>

      <div className="p-6 space-y-6">
        {loading ? (
          <div className="text-muted-foreground text-center py-12">Loading...</div>
        ) : channels.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="No Notification Channels"
            description="Add a notification channel to receive alerts about subscriptions, artist additions, and more."
            action={{ label: 'Add Your First Channel', onClick: openAddModal }}
          />
        ) : (
          <div className="grid gap-4">
            {channels.map(channel => {
              const Icon = channelTypeIcons[channel.type] || Bell;
              return (
                <Card key={channel.id} className={!channel.isActive ? 'opacity-60' : ''}>
                  <CardContent className="flex items-center justify-between py-4">
                    <div className="flex items-center gap-4">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <Icon className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium">{channel.name}</h4>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            channel.isActive 
                              ? 'bg-status-success/20 text-status-success' 
                              : 'bg-gray-500/20 text-gray-500'
                          }`}>
                            {channel.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {channelTypeLabels[channel.type]} · {channel.events.length} events
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTest(channel.id)}
                        disabled={testingId === channel.id}
                      >
                        <TestTube className="w-4 h-4 mr-1" />
                        {testingId === channel.id ? 'Sending...' : 'Test'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditModal(channel)}
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleActive(channel)}
                      >
                        {channel.isActive ? <X className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteClick(channel.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmTarget !== null}
        onClose={() => setConfirmTarget(null)}
        onConfirm={confirmDelete}
        title="Delete notification channel?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
      />

      {/* Add/Edit Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingChannel ? 'Edit Channel' : 'Add Notification Channel'}>
        <div className="space-y-4">
          {/* Channel Type */}
          {!editingChannel && (
            <div>
              <label className="text-sm font-medium">Channel Type</label>
              <Select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as NotificationChannel['type'] })}
                options={[
                  { value: 'discord', label: 'Discord Webhook' },
                  { value: 'webhook', label: 'Generic Webhook' },
                  // Future: telegram, pushover, email
                ]}
              />
            </div>
          )}

          {/* Name */}
          <div>
            <label className="text-sm font-medium">Name</label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={`My ${channelTypeLabels[form.type]}`}
            />
          </div>

          {/* Discord Config */}
          {form.type === 'discord' && (
            <>
              <div>
                <label className="text-sm font-medium">Webhook URL</label>
                <Input
                  value={form.webhookUrl}
                  onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
                  placeholder="https://discord.com/api/webhooks/..."
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Create a webhook in your Discord channel settings.
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">Bot Username (optional)</label>
                <Input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="Mixarr"
                />
              </div>
            </>
          )}

          {/* Webhook Config */}
          {form.type === 'webhook' && (
            <>
              <div>
                <label className="text-sm font-medium">URL</label>
                <Input
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="https://..."
                />
              </div>
              <div>
                <label className="text-sm font-medium">Method</label>
                <Select
                  value={form.method}
                  onChange={(e) => setForm({ ...form, method: e.target.value })}
                  options={[
                    { value: 'POST', label: 'POST' },
                    { value: 'PUT', label: 'PUT' },
                  ]}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Headers (JSON, optional)</label>
                <Input
                  value={form.headers}
                  onChange={(e) => setForm({ ...form, headers: e.target.value })}
                  placeholder='{"Authorization": "Bearer token"}'
                />
              </div>
            </>
          )}

          {/* Events */}
          <div>
            <label className="text-sm font-medium mb-2 block">Events to Notify</label>
            <div className="space-y-2 bg-muted/50 rounded-lg p-3">
              {events.map(event => (
                <label key={event.value} className="flex items-start gap-3 cursor-pointer">
                  <Checkbox
                    checked={form.events.includes(event.value)}
                    onCheckedChange={() => toggleEvent(event.value)}
                  />
                  <div>
                    <div className="font-medium text-sm">{event.label}</div>
                    <div className="text-xs text-muted-foreground">{event.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Active Toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={form.isActive}
              onCheckedChange={(checked) => setForm({ ...form, isActive: !!checked })}
            />
            <span className="text-sm">Channel is active</span>
          </label>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {editingChannel ? 'Save Changes' : 'Create Channel'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
