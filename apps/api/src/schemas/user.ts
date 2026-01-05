import { z } from 'zod';

// Valid user roles
export const userRoles = ['admin', 'user'] as const;

export type UserRole = (typeof userRoles)[number];

// Username regex pattern
const usernameRegex = /^[a-zA-Z0-9_-]+$/;

// Schema for POST /admin/users
export const createUserSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(usernameRegex, 'Username can only contain letters, numbers, underscores, and hyphens'),
  password: z.string().min(8).max(100),
  displayName: z.string().min(1).max(100).optional(),
  email: z.string().email().nullable().optional(),
  role: z.enum(userRoles).default('user').optional(),
  isActive: z.boolean().default(true).optional(),
});

// Schema for PUT /admin/users/:id (all fields optional for partial updates)
export const updateUserSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(usernameRegex, 'Username can only contain letters, numbers, underscores, and hyphens')
    .optional(),
  password: z.string().min(8).max(100).optional(),
  displayName: z.string().min(1).max(100).optional(),
  email: z.string().email().nullable().optional(),
  role: z.enum(userRoles).optional(),
  isActive: z.boolean().optional(),
});

// Schema for password changes
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8).max(100),
});

// Schema for POST /auth/login
export const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

// Export inferred types
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
