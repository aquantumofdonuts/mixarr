import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const addToast = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 7, username: 'kris', displayName: 'Kris', role: 'user' }, logout: vi.fn() }) }));
vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ addToast }) }));
vi.mock('@/components/layout/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));

import { api } from '@/lib/api';
import MyProfilePage from '../page';

beforeEach(() => { vi.clearAllMocks(); });

it('pre-fills the stored email so a display-name edit keeps it', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: { user: { displayName: 'Kris', email: 'kris@example.com' } }, error: null, status: 200 } as any);
  render(<MyProfilePage />);
  await userEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
  expect(await screen.findByLabelText('Email (optional)')).toHaveValue('kris@example.com');
  expect(api.get).toHaveBeenCalledWith('/api/auth/profile');
});

it('keeps the dialog closed when the profile cannot be loaded, so a save cannot erase the email', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: null, error: 'Request timed out', status: 0 } as any);
  render(<MyProfilePage />);
  await userEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
  await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', title: 'Failed to load profile' })));
  expect(screen.queryByLabelText('Email (optional)')).toBeNull();
  expect(api.put).not.toHaveBeenCalled();
});
