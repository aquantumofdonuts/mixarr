'use client';

import { useState } from 'react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Modal, ModalFooter, useToast, Select, Badge } from '@/components/ui';
import { PageHeader } from '@/components/layout/page-header';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { User, KeyRound, Shield, LogOut, UserPlus, Trash2, Edit, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
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

  // Fetch users with React Query (only for admins)
  const { data: usersData, isLoading, isFetching } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => {
      const { data, error } = await api.get<{ users: UserData[] }>('/api/admin/users');
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
    
    const payload: Record<string, any> = {
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

  const handleDeleteUser = async (userId: number) => {
    if (!confirm('Are you sure you want to delete this user? This will delete all their data.')) return;
    
    const { error } = await api.delete(`/api/admin/users/${userId}`);
    
    if (error) {
      addToast({ type: 'error', title: 'Failed to delete user', message: error });
    } else {
      addToast({ type: 'success', title: 'User deleted' });
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    }
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
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Your Account
          </CardTitle>
          <CardDescription>Manage your account settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground">Username</p>
              <p className="font-medium">{user?.username}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Display Name</p>
              <p className="font-medium">{user?.displayName}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Role</p>
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                <span className="font-medium capitalize">{user?.role}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-4 border-t">
            <Button variant="outline" onClick={() => setShowPasswordModal(true)}>
              <KeyRound className="h-4 w-4 mr-2" /> Change Password
            </Button>
            <Button variant="destructive" onClick={logout}>
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
            <CardDescription>Manage system users ({users.length} total)</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading users...</div>
            ) : users.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No users found</div>
            ) : (
              <div className="space-y-3">
                {users.map((u) => (
                  <div
                    key={u.id}
                    className={`flex items-center justify-between p-4 rounded-lg border ${!u.isActive ? 'opacity-60 bg-muted/50' : ''}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center ${u.isActive ? 'bg-primary/10' : 'bg-muted'}`}>
                        <User className={`h-5 w-5 ${u.isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{u.displayName}</p>
                          <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>
                            {u.role}
                          </Badge>
                          {!u.isActive && (
                            <Badge variant="destructive">Inactive</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          @{u.username} · Last login: {formatDate(u.lastLogin)}
                        </p>
                        {u._count && (
                          <p className="text-xs text-muted-foreground">
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
                        title="Edit user"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      {u.id !== user?.id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteUser(u.id)}
                          title="Delete user"
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

      {/* Change Password Modal */}
      <Modal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        title="Change Password"
      >
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Current Password</label>
            <Input
              type="password"
              value={passwordForm.current}
              onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
            />
          </div>
          <div>
            <label className="text-sm font-medium">New Password</label>
            <Input
              type="password"
              value={passwordForm.new}
              onChange={(e) => setPasswordForm({ ...passwordForm, new: e.target.value })}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Confirm New Password</label>
            <Input
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
            <label className="text-sm font-medium">Username *</label>
            <Input
              value={createForm.username}
              onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
              placeholder="johndoe"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Display Name</label>
            <Input
              value={createForm.displayName}
              onChange={(e) => setCreateForm({ ...createForm, displayName: e.target.value })}
              placeholder="John Doe"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Email</label>
            <Input
              type="email"
              value={createForm.email}
              onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
              placeholder="john@example.com (for SSO)"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Password *</label>
            <Input
              type="password"
              value={createForm.password}
              onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Role</label>
            <Select
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
            <label className="text-sm font-medium">Display Name</label>
            <Input
              value={editForm.displayName}
              onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Email</label>
            <Input
              type="email"
              value={editForm.email}
              onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              placeholder="john@example.com (for SSO)"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Role</label>
            <Select
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
            <label className="text-sm font-medium">Status</label>
            <div className="flex items-center gap-4 mt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="isActive"
                  checked={editForm.isActive}
                  onChange={() => setEditForm({ ...editForm, isActive: true })}
                  disabled={editingUser?.id === user?.id}
                />
                <CheckCircle className="h-4 w-4 text-green-500" />
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
                <XCircle className="h-4 w-4 text-red-500" />
                Inactive
              </label>
            </div>
            {editingUser?.id === user?.id && (
              <p className="text-xs text-muted-foreground mt-1">Cannot deactivate your own account</p>
            )}
          </div>
          <div>
            <label className="text-sm font-medium">New Password (leave blank to keep current)</label>
            <Input
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
