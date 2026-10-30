'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog, Skeleton } from '@/components/ui';
import { Input } from '@/components/ui/input';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ResultState } from '@/components/ui/result-state';
import { PageHeader } from '@/components/layout/page-header';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle';
import Edit from 'lucide-react/dist/esm/icons/edit';
import KeyRound from 'lucide-react/dist/esm/icons/key-round';
import LogOut from 'lucide-react/dist/esm/icons/log-out';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus';
import XCircle from 'lucide-react/dist/esm/icons/x-circle';
import { useQuery, useQueryClient } from '@tanstack/react-query';

interface UserData {
  id: number;
  username: string;
  displayName: string;
  email?: string;
  role: 'admin' | 'user';
  isActive: boolean;
  lastLogin: string | null;
  createdAt: string;
  _count?: {
    connections: number;
    subscriptions: number;
    importSources: number;
  };
}

export default function UsersPage() {
  const { user, logout } = useAuth();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  const [passwordForm, setPasswordForm] = useState({ current: '', new: '', confirm: '' });
  const [createForm, setCreateForm] = useState({ username: '', password: '', displayName: '', email: '', role: 'user' as 'admin' | 'user' });
  const [editForm, setEditForm] = useState({ displayName: '', email: '', role: 'user' as 'admin' | 'user', isActive: true, password: '' });
  const [confirmTarget, setConfirmTarget] = useState<number | null>(null);

  // Fetch users with React Query (only for admins)
  const { data: usersData, isLoading, isFetching, isError, error } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.get<{ users: UserData[] }>('/api/admin/users', { signal });
      if (error) throw new Error(error);
      return data?.users ?? [];
    },
    enabled: user?.role === 'admin',
    staleTime: 30 * 1000,
  });
  const users = usersData ?? [];
  const isRefreshing = isFetching && !isLoading;

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
  };

  const handleChangePassword = async () => {
    if (passwordForm.new !== passwordForm.confirm) {
      addToast({ type: 'error', title: 'Passwords do not match' });
      return;
    }
    
    const { error } = await api.post('/api/auth/password', {
      currentPassword: passwordForm.current,
      newPassword: passwordForm.new,
    });

    if (error) {
      addToast({ type: 'error', title: 'Failed to change password', message: error });
    } else {
      addToast({ type: 'success', title: 'Password changed successfully' });
      setShowPasswordModal(false);
      setPasswordForm({ current: '', new: '', confirm: '' });
    }
  };

  const handleCreateUser = async () => {
    if (!createForm.username || !createForm.password) {
      addToast({ type: 'error', title: 'Username and password are required' });
      return;
    }
    
    const { error } = await api.post('/api/admin/users', createForm);
    
    if (error) {
      addToast({ type: 'error', title: 'Failed to create user', message: error });
    } else {
      addToast({ type: 'success', title: 'User created successfully' });
      setShowCreateModal(false);
      setCreateForm({ username: '', password: '', displayName: '', email: '', role: 'user' });
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    }
  };

  const handleEditUser = async () => {
    if (!editingUser) return;
    
    const payload: Record<string, string | boolean | null> = {
      displayName: editForm.displayName,
      email: editForm.email || null,
      role: editForm.role,
      isActive: editForm.isActive,
    };
    
    if (editForm.password) {
      payload.password = editForm.password;
    }
    
    const { error } = await api.put(`/api/admin/users/${editingUser.id}`, payload);
    
    if (error) {
      addToast({ type: 'error', title: 'Failed to update user', message: error });
    } else {
      addToast({ type: 'success', title: 'User updated successfully' });
      setShowEditModal(false);
      setEditingUser(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    }
  };

  const handleDeleteClick = (userId: number) => setConfirmTarget(userId);
  const confirmDelete = async () => {
    if (confirmTarget === null) return;

    const { error } = await api.delete(`/api/admin/users/${confirmTarget}`);

    if (error) {
      addToast({ type: 'error', title: 'Failed to delete user', message: error });
    } else {
      addToast({ type: 'success', title: 'User deleted' });
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    }
    setConfirmTarget(null);
  };

  const openEditModal = (u: UserData) => {
    setEditingUser(u);
    setEditForm({
      displayName: u.displayName,
      email: u.email || '',
      role: u.role,
      isActive: u.isActive,
      password: '',
    });
    setShowEditModal(true);
  };

  const formatDate = (date: string | null) => {
    if (!date) return 'Never';
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <>
      <PageHeader
        title="User Management"
        description="Manage your account and users"
      >
        {user?.role === 'admin' && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            <Button onClick={() => setShowCreateModal(true)}>
              <UserPlus className="h-4 w-4 mr-2" /> Add User
            </Button>
          </div>
        )}
      </PageHeader>

      {/* Current User Card */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Your Account
          </CardTitle>
          <CardDescription>Manage your account settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">Username</p>
              <p className="break-words font-mono">{user?.username}</p>
            </div>
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">Display Name</p>
              <p className="break-words font-medium">{user?.displayName}</p>
            </div>
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">Role</p>
              <div className="flex items-center gap-2">
                <span className="font-medium capitalize">{user?.role}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-4 border-t">
            <Button variant="outline" onClick={() => setShowPasswordModal(true)}>
              <KeyRound className="h-4 w-4 mr-2" /> Change Password
            </Button>
            <Button variant="outline" onClick={logout}>
              <LogOut className="h-4 w-4 mr-2" /> Sign Out
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* User List (Admin only) */}
      {user?.role === 'admin' && (
        <Card>
          <CardHeader>
            <CardTitle>All Users</CardTitle>
            <CardDescription>{isLoading ? 'Loading users…' : isError ? 'User list unavailable' : <><span className="font-mono">{users.length}</span> users</>}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 p-4 rounded-container border bg-card">
                    <Skeleton className="w-8 h-8 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-1/4" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                    <Skeleton className="h-6 w-16 rounded-full" />
                  </div>
                ))}
              </div>
            ) : isError ? (
              <ResultState kind="error" message={error.message} action={<Button variant="outline" onClick={handleRefresh}>Retry</Button>} />
            ) : users.length === 0 ? (
              <ResultState kind="no-records" message="Add a user to give them access to Mixarr." />
            ) : (
              <div className="divide-y border-y">
                {users.map((u) => (
                  <div
                    key={u.id}
                    className={`flex min-w-0 flex-wrap items-center justify-between gap-3 py-3 ${!u.isActive ? 'bg-muted/50' : ''}`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <p className="min-w-0 break-words font-medium">{u.displayName || u.username}</p>
                          <span className="text-xs text-muted-foreground capitalize">{u.role}</span>
                          {!u.isActive && (
                            <Badge variant="secondary">Inactive</Badge>
                          )}
                        </div>
                        <p className="break-words font-mono text-xs text-muted-foreground">
                          #{u.id} · @{u.username} · Last login: {formatDate(u.lastLogin)}
                        </p>
                        {u._count && (
                          <p className="font-mono text-xs text-muted-foreground">
                            {u._count.connections} connections · {u._count.subscriptions} subscriptions · {u._count.importSources} imports
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditModal(u)}
                        aria-label={`Edit user ${u.username}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      {u.id !== user?.id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteClick(u.id)}
                          aria-label={`Delete user ${u.username}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={confirmTarget !== null}
        onClose={() => setConfirmTarget(null)}
        onConfirm={confirmDelete}
        title="Delete user?"
        description="This will permanently delete the user and all their data."
        confirmLabel="Delete"
        variant="destructive"
      />

      {/* Change Password Modal */}
      <Modal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        title="Change Password"
      >
        <div className="space-y-4">
          <div>
            <Input
              label="Current Password"
              type="password"
              value={passwordForm.current}
              onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
            />
          </div>
          <div>
            <Input
              label="New Password"
              type="password"
              value={passwordForm.new}
              onChange={(e) => setPasswordForm({ ...passwordForm, new: e.target.value })}
            />
          </div>
          <div>
            <Input
              label="Confirm New Password"
              type="password"
              value={passwordForm.confirm}
              onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
            />
          </div>
        </div>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowPasswordModal(false)}>
            Cancel
          </Button>
          <Button onClick={handleChangePassword}>Change Password</Button>
        </ModalFooter>
      </Modal>

      {/* Create User Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create User"
      >
        <div className="space-y-4">
          <div>
            <Input
              label="Username *"
              value={createForm.username}
              onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
              placeholder="johndoe"
            />
          </div>
          <div>
            <Input
              label="Display Name"
              value={createForm.displayName}
              onChange={(e) => setCreateForm({ ...createForm, displayName: e.target.value })}
              placeholder="John Doe"
            />
          </div>
          <div>
            <Input
              label="Email"
              type="email"
              value={createForm.email}
              onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
              placeholder="john@example.com (for SSO)"
            />
          </div>
          <div>
            <Input
              label="Password *"
              type="password"
              value={createForm.password}
              onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
            />
          </div>
          <div>
            <Select
              label="Role"
              value={createForm.role}
              onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as 'admin' | 'user' })}
              options={[
                { value: 'user', label: 'Standard User' },
                { value: 'admin', label: 'Administrator' },
              ]}
            />
          </div>
        </div>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowCreateModal(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreateUser}>Create User</Button>
        </ModalFooter>
      </Modal>

      {/* Edit User Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title={`Edit User: ${editingUser?.username}`}
      >
        <div className="space-y-4">
          <div>
            <Input
              label="Display Name"
              value={editForm.displayName}
              onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
            />
          </div>
          <div>
            <Input
              label="Email"
              type="email"
              value={editForm.email}
              onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              placeholder="john@example.com (for SSO)"
            />
          </div>
          <div>
            <Select
              label="Role"
              value={editForm.role}
              onChange={(e) => setEditForm({ ...editForm, role: e.target.value as 'admin' | 'user' })}
              options={[
                { value: 'user', label: 'Standard User' },
                { value: 'admin', label: 'Administrator' },
              ]}
              disabled={editingUser?.id === user?.id}
            />
            {editingUser?.id === user?.id && (
              <p className="text-xs text-muted-foreground mt-1">Cannot change your own role</p>
            )}
          </div>
          <div>
            <p id="edit-user-status" className="text-sm font-medium">Status</p>
            <div role="radiogroup" aria-labelledby="edit-user-status" className="mt-2 flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="isActive"
                  checked={editForm.isActive}
                  onChange={() => setEditForm({ ...editForm, isActive: true })}
                  disabled={editingUser?.id === user?.id}
                />
                <CheckCircle className="h-4 w-4 text-status-success" />
                Active
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="isActive"
                  checked={!editForm.isActive}
                  onChange={() => setEditForm({ ...editForm, isActive: false })}
                  disabled={editingUser?.id === user?.id}
                />
                <XCircle className="h-4 w-4 text-status-error" />
                Inactive
              </label>
            </div>
            {editingUser?.id === user?.id && (
              <p className="text-xs text-muted-foreground mt-1">Cannot deactivate your own account</p>
            )}
          </div>
          <div>
            <Input
              label="New Password (leave blank to keep current)"
              type="password"
              value={editForm.password}
              onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
              placeholder="Enter new password"
            />
          </div>
        </div>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowEditModal(false)}>
            Cancel
          </Button>
          <Button onClick={handleEditUser}>Save Changes</Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
