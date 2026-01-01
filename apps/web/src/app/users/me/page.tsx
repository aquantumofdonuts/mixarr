'use client';

import { useState } from 'react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Modal, ModalFooter, useToast } from '@/components/ui';
import { PageHeader } from '@/components/layout/page-header';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { User, KeyRound, Shield, LogOut, AtSign } from 'lucide-react';

export default function MyProfilePage() {
  const { user, logout } = useAuth();
  const { addToast } = useToast();
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: '', new: '', confirm: '' });
  const [profileForm, setProfileForm] = useState({ 
    displayName: user?.displayName || '', 
    email: '' 
  });
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  const handleChangePassword = async () => {
    if (passwordForm.new !== passwordForm.confirm) {
      addToast({ type: 'error', title: 'Passwords do not match' });
      return;
    }
    
    if (passwordForm.new.length < 8) {
      addToast({ type: 'error', title: 'Password must be at least 8 characters' });
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

  const handleUpdateProfile = async () => {
    setIsUpdatingProfile(true);
    
    const { error } = await api.put('/api/auth/profile', {
      displayName: profileForm.displayName,
      email: profileForm.email || null,
    });

    if (error) {
      addToast({ type: 'error', title: 'Failed to update profile', message: error });
    } else {
      addToast({ type: 'success', title: 'Profile updated successfully' });
      setShowProfileModal(false);
      // Refresh auth state to get updated user info
      window.location.reload();
    }
    setIsUpdatingProfile(false);
  };

  const openProfileModal = () => {
    setProfileForm({
      displayName: user?.displayName || '',
      email: '',
    });
    setShowProfileModal(true);
  };

  return (
    <>
      <PageHeader
        title="My Profile"
        description="Manage your personal account settings"
      />

      {/* Profile Info Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Profile Information
          </CardTitle>
          <CardDescription>Your account details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <AtSign className="h-3 w-3" /> Username
              </p>
              <p className="font-medium">{user?.username}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Display Name</p>
              <p className="font-medium">{user?.displayName || user?.username}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <Shield className="h-3 w-3" /> Role
              </p>
              <p className="font-medium capitalize">{user?.role}</p>
            </div>
          </div>
          <div className="pt-4 border-t">
            <Button variant="outline" onClick={openProfileModal}>
              Edit Profile
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Security Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Security
          </CardTitle>
          <CardDescription>Manage your password and security settings</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => setShowPasswordModal(true)}>
            <KeyRound className="h-4 w-4 mr-2" />
            Change Password
          </Button>
        </CardContent>
      </Card>

      {/* Session Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LogOut className="h-5 w-5" />
            Session
          </CardTitle>
          <CardDescription>Manage your current session</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={logout}>
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </CardContent>
      </Card>

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
          <Button variant="ghost" onClick={() => setShowPasswordModal(false)}>
            Cancel
          </Button>
          <Button onClick={handleChangePassword}>Change Password</Button>
        </ModalFooter>
      </Modal>

      {/* Edit Profile Modal */}
      <Modal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        title="Edit Profile"
      >
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Display Name</label>
            <Input
              value={profileForm.displayName}
              onChange={(e) => setProfileForm({ ...profileForm, displayName: e.target.value })}
              placeholder="Your display name"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Email (optional)</label>
            <Input
              type="email"
              value={profileForm.email}
              onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
              placeholder="your@email.com"
            />
          </div>
        </div>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setShowProfileModal(false)}>
            Cancel
          </Button>
          <Button onClick={handleUpdateProfile} disabled={isUpdatingProfile}>
            {isUpdatingProfile ? 'Saving...' : 'Save Changes'}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
