# SSO Authentication Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add SSO support (LDAP, SAML, Google, Plex) with admin-configurable providers and pre-provisioned user accounts.

**Architecture:** Extends existing Passport.js setup with additional strategies. New `SsoProvider` table stores encrypted configs. New `AuthIdentity` table links SSO identities to users. SSO only succeeds if admin pre-created user with matching email.

**Tech Stack:** Passport.js strategies (passport-ldapauth, passport-saml, passport-google-oauth20), Prisma migrations, React accordion components

**Design Doc:** [2025-12-28-sso-authentication-design.md](2025-12-28-sso-authentication-design.md)

---

## Phase 1: Database Schema

### Task 1: Add email field to User model

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/YYYYMMDD_add_user_email/migration.sql` (auto-generated)

**Step 1: Update Prisma schema**

In `apps/api/prisma/schema.prisma`, modify the User model:

```prisma
model User {
  id           Int       @id @default(autoincrement())
  username     String    @unique @db.VarChar(50)
  email        String?   @unique @db.VarChar(255)  // NEW: For SSO matching
  passwordHash String?   @map("password_hash") @db.VarChar(255)  // CHANGED: Now nullable
  displayName  String    @map("display_name") @db.VarChar(100)
  role         UserRole  @default(user)
  isActive     Boolean   @default(true) @map("is_active")
  lastLogin    DateTime? @map("last_login")
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")

  // Relations
  sessions       Session[]
  connections    Connection[]
  subscriptions  Subscription[]
  importSources  ImportSource[]
  reviewItems    ReviewItem[]
  settings       UserSetting[]
  authIdentities AuthIdentity[]  // NEW

  @@map("users")
}
```

**Step 2: Generate and run migration**

```bash
cd apps/api
npx prisma migrate dev --name add_user_email
```

Expected: Migration created and applied successfully.

**Step 3: Commit**

```bash
git add apps/api/prisma/
git commit -m "feat(db): add email field to User model, make passwordHash nullable"
```

---

### Task 2: Create SsoProviderType enum and SsoProvider table

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

**Step 1: Add enum and model to schema**

```prisma
enum SsoProviderType {
  ldap
  saml
  google
  plex
}

model SsoProvider {
  id        Int             @id @default(autoincrement())
  type      SsoProviderType @unique
  name      String          @db.VarChar(100)
  config    Json            // Encrypted credentials, URLs, mappings
  isEnabled Boolean         @default(false) @map("is_enabled")
  createdAt DateTime        @default(now()) @map("created_at")
  updatedAt DateTime        @updatedAt @map("updated_at")

  @@map("sso_providers")
}
```

**Step 2: Generate migration**

```bash
cd apps/api
npx prisma migrate dev --name add_sso_provider
```

**Step 3: Commit**

```bash
git add apps/api/prisma/
git commit -m "feat(db): add SsoProvider table and SsoProviderType enum"
```

---

### Task 3: Create AuthIdentity table

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

**Step 1: Add AuthIdentity model**

```prisma
model AuthIdentity {
  id             Int             @id @default(autoincrement())
  userId         Int             @map("user_id")
  provider       SsoProviderType
  providerUserId String          @map("provider_user_id") @db.VarChar(255)
  email          String          @db.VarChar(255)
  metadata       Json?           // Provider-specific data
  createdAt      DateTime        @default(now()) @map("created_at")
  lastUsedAt     DateTime?       @map("last_used_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerUserId])
  @@index([userId])
  @@index([provider, email])
  @@map("auth_identities")
}
```

**Step 2: Generate migration**

```bash
cd apps/api
npx prisma migrate dev --name add_auth_identity
```

**Step 3: Commit**

```bash
git add apps/api/prisma/
git commit -m "feat(db): add AuthIdentity table for SSO identity linking"
```

---

## Phase 2: SSO Provider Management API

### Task 4: Create SSO types and validation

**Files:**
- Create: `apps/api/src/types/sso.ts`
- Test: `apps/api/tests/api/sso.test.ts`

**Step 1: Write failing test**

Create `apps/api/tests/api/sso.test.ts`:

```typescript
/**
 * SSO Provider API Tests
 */

import { describe, it, expect } from 'vitest';
import { validateLdapConfig, validateSamlConfig, validateGoogleConfig, validatePlexConfig } from '../../src/types/sso.js';

describe('SSO Config Validation', () => {
  describe('validateLdapConfig', () => {
    it('should accept valid LDAP config', () => {
      const config = {
        serverUrl: 'ldap://ldap.example.com:389',
        bindDn: 'cn=admin,dc=example,dc=com',
        bindPassword: 'secret',
        searchBaseDn: 'ou=users,dc=example,dc=com',
        searchFilter: '(uid={{username}})',
        emailAttribute: 'mail',
        displayNameAttribute: 'cn',
      };
      expect(() => validateLdapConfig(config)).not.toThrow();
    });

    it('should reject LDAP config missing serverUrl', () => {
      const config = {
        bindDn: 'cn=admin,dc=example,dc=com',
        searchBaseDn: 'ou=users,dc=example,dc=com',
      };
      expect(() => validateLdapConfig(config)).toThrow('serverUrl is required');
    });
  });

  describe('validateGoogleConfig', () => {
    it('should accept valid Google config', () => {
      const config = {
        clientId: 'client-id.apps.googleusercontent.com',
        clientSecret: 'client-secret',
      };
      expect(() => validateGoogleConfig(config)).not.toThrow();
    });

    it('should reject Google config missing clientId', () => {
      const config = { clientSecret: 'secret' };
      expect(() => validateGoogleConfig(config)).toThrow('clientId is required');
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/api
npx vitest run tests/api/sso.test.ts -v
```

Expected: FAIL - Cannot find module '../../src/types/sso.js'

**Step 3: Implement types and validation**

Create `apps/api/src/types/sso.ts`:

```typescript
/**
 * SSO Configuration Types and Validation
 */

export interface LdapConfig {
  serverUrl: string;
  bindDn: string;
  bindPassword: string;
  searchBaseDn: string;
  searchFilter: string;
  usernameAttribute?: string;
  emailAttribute: string;
  displayNameAttribute: string;
  useTls?: boolean;
}

export interface SamlConfig {
  idpMetadataUrl?: string;
  idpSsoUrl?: string;
  idpCertificate?: string;
  emailAttribute?: string;
  displayNameAttribute?: string;
}

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  allowedDomains?: string[];
}

export interface PlexConfig {
  restrictToServerId?: string;
}

export type SsoConfig = LdapConfig | SamlConfig | GoogleConfig | PlexConfig;

export function validateLdapConfig(config: unknown): asserts config is LdapConfig {
  const c = config as Record<string, unknown>;
  if (!c.serverUrl || typeof c.serverUrl !== 'string') {
    throw new Error('serverUrl is required');
  }
  if (!c.bindDn || typeof c.bindDn !== 'string') {
    throw new Error('bindDn is required');
  }
  if (!c.searchBaseDn || typeof c.searchBaseDn !== 'string') {
    throw new Error('searchBaseDn is required');
  }
  if (!c.emailAttribute || typeof c.emailAttribute !== 'string') {
    throw new Error('emailAttribute is required');
  }
}

export function validateSamlConfig(config: unknown): asserts config is SamlConfig {
  const c = config as Record<string, unknown>;
  if (!c.idpMetadataUrl && !c.idpSsoUrl) {
    throw new Error('Either idpMetadataUrl or idpSsoUrl is required');
  }
}

export function validateGoogleConfig(config: unknown): asserts config is GoogleConfig {
  const c = config as Record<string, unknown>;
  if (!c.clientId || typeof c.clientId !== 'string') {
    throw new Error('clientId is required');
  }
  if (!c.clientSecret || typeof c.clientSecret !== 'string') {
    throw new Error('clientSecret is required');
  }
}

export function validatePlexConfig(config: unknown): asserts config is PlexConfig {
  // Plex config is optional - no required fields
  return;
}

export function validateSsoConfig(type: string, config: unknown): void {
  switch (type) {
    case 'ldap':
      validateLdapConfig(config);
      break;
    case 'saml':
      validateSamlConfig(config);
      break;
    case 'google':
      validateGoogleConfig(config);
      break;
    case 'plex':
      validatePlexConfig(config);
      break;
    default:
      throw new Error(`Unknown SSO provider type: ${type}`);
  }
}
```

**Step 4: Run test to verify it passes**

```bash
cd apps/api
npx vitest run tests/api/sso.test.ts -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/types/sso.ts apps/api/tests/api/sso.test.ts
git commit -m "feat(api): add SSO config types and validation"
```

---

### Task 5: Create SSO provider service

**Files:**
- Create: `apps/api/src/services/sso-provider.ts`
- Test: `apps/api/tests/api/sso.test.ts` (extend)

**Step 1: Write failing test**

Add to `apps/api/tests/api/sso.test.ts`:

```typescript
import { createMockPrisma, resetIdCounter } from '../utils/fixtures.js';
import { SsoProviderService } from '../../src/services/sso-provider.js';

describe('SsoProviderService', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let service: SsoProviderService;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
    service = new SsoProviderService(mockPrisma as any);
  });

  describe('getAll', () => {
    it('should return all providers with masked secrets', async () => {
      mockPrisma.ssoProvider.findMany.mockResolvedValue([
        {
          id: 1,
          type: 'google',
          name: 'Google',
          config: { clientId: 'id', clientSecret: 'secret123' },
          isEnabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.getAll();
      
      expect(result).toHaveLength(1);
      expect(result[0].config.clientSecret).toBe('********');
    });
  });

  describe('upsert', () => {
    it('should create new provider with encrypted config', async () => {
      mockPrisma.ssoProvider.upsert.mockResolvedValue({
        id: 1,
        type: 'google',
        name: 'Google',
        config: { clientId: 'id', clientSecret: 'encrypted' },
        isEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.upsert('google', {
        name: 'Google',
        config: { clientId: 'id', clientSecret: 'secret' },
      });

      expect(mockPrisma.ssoProvider.upsert).toHaveBeenCalled();
      expect(result.type).toBe('google');
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/api
npx vitest run tests/api/sso.test.ts -v
```

Expected: FAIL - Cannot find module '../../src/services/sso-provider.js'

**Step 3: Implement service**

Create `apps/api/src/services/sso-provider.ts`:

```typescript
/**
 * SSO Provider Service
 * 
 * Manages SSO provider configurations with encryption for secrets.
 */

import type { PrismaClient, SsoProvider, SsoProviderType } from '@prisma/client';
import { validateSsoConfig } from '../types/sso.js';

interface SsoProviderInput {
  name: string;
  config: Record<string, unknown>;
  isEnabled?: boolean;
}

// Fields that should be masked in responses
const SECRET_FIELDS = ['bindPassword', 'clientSecret', 'idpCertificate'];

export class SsoProviderService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get all SSO providers with secrets masked
   */
  async getAll(): Promise<SsoProvider[]> {
    const providers = await this.prisma.ssoProvider.findMany({
      orderBy: { type: 'asc' },
    });
    
    return providers.map(p => this.maskSecrets(p));
  }

  /**
   * Get a single provider by type with secrets masked
   */
  async getByType(type: SsoProviderType): Promise<SsoProvider | null> {
    const provider = await this.prisma.ssoProvider.findUnique({
      where: { type },
    });
    
    return provider ? this.maskSecrets(provider) : null;
  }

  /**
   * Create or update a provider
   */
  async upsert(type: SsoProviderType, input: SsoProviderInput): Promise<SsoProvider> {
    // Validate config based on type
    validateSsoConfig(type, input.config);
    
    // TODO: Encrypt sensitive fields before storing
    const encryptedConfig = input.config;
    
    const provider = await this.prisma.ssoProvider.upsert({
      where: { type },
      create: {
        type,
        name: input.name,
        config: encryptedConfig,
        isEnabled: input.isEnabled ?? false,
      },
      update: {
        name: input.name,
        config: encryptedConfig,
        isEnabled: input.isEnabled,
      },
    });
    
    return this.maskSecrets(provider);
  }

  /**
   * Delete a provider
   */
  async delete(type: SsoProviderType): Promise<void> {
    await this.prisma.ssoProvider.delete({
      where: { type },
    });
  }

  /**
   * Toggle provider enabled/disabled
   */
  async toggle(type: SsoProviderType, isEnabled: boolean): Promise<SsoProvider> {
    const provider = await this.prisma.ssoProvider.update({
      where: { type },
      data: { isEnabled },
    });
    
    return this.maskSecrets(provider);
  }

  /**
   * Get only enabled providers (for login page)
   */
  async getEnabled(): Promise<Array<{ type: SsoProviderType; name: string }>> {
    const providers = await this.prisma.ssoProvider.findMany({
      where: { isEnabled: true },
      select: { type: true, name: true },
    });
    
    return providers;
  }

  /**
   * Mask secret fields in config
   */
  private maskSecrets(provider: SsoProvider): SsoProvider {
    const config = provider.config as Record<string, unknown>;
    const masked: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(config)) {
      if (SECRET_FIELDS.includes(key) && typeof value === 'string') {
        masked[key] = '********';
      } else {
        masked[key] = value;
      }
    }
    
    return { ...provider, config: masked };
  }
}
```

**Step 4: Add ssoProvider to mock Prisma**

In `apps/api/tests/utils/fixtures.ts`, add to `createMockPrisma`:

```typescript
ssoProvider: {
  findUnique: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  delete: vi.fn(),
},
```

**Step 5: Run test to verify it passes**

```bash
cd apps/api
npx vitest run tests/api/sso.test.ts -v
```

Expected: PASS

**Step 6: Commit**

```bash
git add apps/api/src/services/sso-provider.ts apps/api/tests/api/sso.test.ts apps/api/tests/utils/fixtures.ts
git commit -m "feat(api): add SsoProviderService with secret masking"
```

---

### Task 6: Create SSO routes

**Files:**
- Create: `apps/api/src/routes/sso.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/tests/api/sso.test.ts` (extend)

**Step 1: Write failing test for routes**

Add to `apps/api/tests/api/sso.test.ts`:

```typescript
describe('SSO Routes', () => {
  describe('GET /api/sso/providers', () => {
    it('should require admin auth', async () => {
      // Route should return 403 for non-admin users
      // Implementation will test with supertest
    });
  });

  describe('GET /api/auth/sso/enabled', () => {
    it('should return enabled providers without auth', async () => {
      // Public endpoint - should return list of enabled providers
    });
  });
});
```

**Step 2: Create routes**

Create `apps/api/src/routes/sso.ts`:

```typescript
/**
 * SSO Provider Management Routes (Admin only)
 */

import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { SsoProviderService } from '../services/sso-provider.js';
import prisma from '../lib/db.js';
import type { SsoProviderType } from '@prisma/client';

export const ssoRouter = Router();
const ssoService = new SsoProviderService(prisma);

// All routes require admin
ssoRouter.use(requireAuth, requireAdmin);

// List all providers
ssoRouter.get('/providers', async (_req, res) => {
  try {
    const providers = await ssoService.getAll();
    res.json({ providers });
  } catch (error) {
    console.error('Failed to fetch SSO providers:', error);
    res.status(500).json({ error: 'Failed to fetch providers' });
  }
});

// Get single provider
ssoRouter.get('/providers/:type', async (req, res) => {
  try {
    const type = req.params.type as SsoProviderType;
    const provider = await ssoService.getByType(type);
    
    if (!provider) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }
    
    res.json({ provider });
  } catch (error) {
    console.error('Failed to fetch SSO provider:', error);
    res.status(500).json({ error: 'Failed to fetch provider' });
  }
});

// Create/update provider
ssoRouter.put('/providers/:type', async (req, res) => {
  try {
    const type = req.params.type as SsoProviderType;
    const { name, config, isEnabled } = req.body;
    
    if (!name || !config) {
      res.status(400).json({ error: 'Name and config are required' });
      return;
    }
    
    const provider = await ssoService.upsert(type, { name, config, isEnabled });
    res.json({ provider });
  } catch (error) {
    console.error('Failed to save SSO provider:', error);
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to save provider' });
    }
  }
});

// Delete provider
ssoRouter.delete('/providers/:type', async (req, res) => {
  try {
    const type = req.params.type as SsoProviderType;
    await ssoService.delete(type);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete SSO provider:', error);
    res.status(500).json({ error: 'Failed to delete provider' });
  }
});

// Toggle provider enabled/disabled
ssoRouter.patch('/providers/:type/toggle', async (req, res) => {
  try {
    const type = req.params.type as SsoProviderType;
    const { isEnabled } = req.body;
    
    if (typeof isEnabled !== 'boolean') {
      res.status(400).json({ error: 'isEnabled must be a boolean' });
      return;
    }
    
    const provider = await ssoService.toggle(type, isEnabled);
    res.json({ provider });
  } catch (error) {
    console.error('Failed to toggle SSO provider:', error);
    res.status(500).json({ error: 'Failed to toggle provider' });
  }
});

// Test connection (placeholder - provider-specific logic added later)
ssoRouter.post('/providers/:type/test', async (req, res) => {
  try {
    const type = req.params.type as SsoProviderType;
    // TODO: Implement provider-specific connection tests
    res.json({ success: true, message: `${type} connection test not yet implemented` });
  } catch (error) {
    console.error('Failed to test SSO provider:', error);
    res.status(500).json({ error: 'Connection test failed' });
  }
});
```

**Step 3: Add public endpoint for enabled providers**

Add to `apps/api/src/routes/auth.ts`:

```typescript
import { SsoProviderService } from '../services/sso-provider.js';

const ssoService = new SsoProviderService(prisma);

// Public: Get enabled SSO providers (for login page)
authRouter.get('/sso/enabled', async (_req, res) => {
  try {
    const providers = await ssoService.getEnabled();
    res.json({ providers });
  } catch (error) {
    console.error('Failed to fetch enabled SSO providers:', error);
    res.status(500).json({ error: 'Failed to fetch providers' });
  }
});
```

**Step 4: Register routes in index.ts**

In `apps/api/src/index.ts`, add:

```typescript
import { ssoRouter } from './routes/sso.js';

// After other routes
app.use('/api/sso', ssoRouter);
```

**Step 5: Run tests**

```bash
cd apps/api
npm test
```

Expected: All tests pass

**Step 6: Commit**

```bash
git add apps/api/src/routes/sso.ts apps/api/src/routes/auth.ts apps/api/src/index.ts
git commit -m "feat(api): add SSO provider management routes"
```

---

## Phase 3: Frontend SSO Settings UI

### Task 7: Create SSO settings component

**Files:**
- Create: `apps/web/src/components/settings/sso-settings.tsx`

**Step 1: Create the component**

Create `apps/web/src/components/settings/sso-settings.tsx`:

```tsx
'use client';

import { useState, useEffect } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { ChevronDown, ChevronRight, Check, X, Loader2 } from 'lucide-react';

interface SsoProvider {
  type: 'ldap' | 'saml' | 'google' | 'plex';
  name: string;
  config: Record<string, any>;
  isEnabled: boolean;
}

interface ProviderConfig {
  type: SsoProvider['type'];
  label: string;
  description: string;
  fields: Array<{
    key: string;
    label: string;
    type: 'text' | 'password' | 'textarea';
    placeholder?: string;
    required?: boolean;
    helpText?: string;
  }>;
}

const providerConfigs: ProviderConfig[] = [
  {
    type: 'ldap',
    label: 'LDAP',
    description: 'Active Directory or OpenLDAP authentication',
    fields: [
      { key: 'serverUrl', label: 'Server URL', type: 'text', placeholder: 'ldap://ldap.example.com:389', required: true },
      { key: 'bindDn', label: 'Bind DN', type: 'text', placeholder: 'cn=admin,dc=example,dc=com', required: true },
      { key: 'bindPassword', label: 'Bind Password', type: 'password', required: true },
      { key: 'searchBaseDn', label: 'Search Base DN', type: 'text', placeholder: 'ou=users,dc=example,dc=com', required: true },
      { key: 'searchFilter', label: 'Search Filter', type: 'text', placeholder: '(uid={{username}})' },
      { key: 'emailAttribute', label: 'Email Attribute', type: 'text', placeholder: 'mail', required: true },
      { key: 'displayNameAttribute', label: 'Display Name Attribute', type: 'text', placeholder: 'cn' },
    ],
  },
  {
    type: 'saml',
    label: 'SAML 2.0',
    description: 'Enterprise SSO with SAML Identity Providers',
    fields: [
      { key: 'idpMetadataUrl', label: 'IdP Metadata URL', type: 'text', placeholder: 'https://idp.example.com/metadata', helpText: 'OR enter IdP SSO URL and certificate manually below' },
      { key: 'idpSsoUrl', label: 'IdP SSO URL', type: 'text', placeholder: 'https://idp.example.com/sso' },
      { key: 'idpCertificate', label: 'IdP Certificate', type: 'textarea', placeholder: '-----BEGIN CERTIFICATE-----' },
      { key: 'emailAttribute', label: 'Email Attribute', type: 'text', placeholder: 'email' },
      { key: 'displayNameAttribute', label: 'Display Name Attribute', type: 'text', placeholder: 'displayName' },
    ],
  },
  {
    type: 'google',
    label: 'Google',
    description: 'Google Workspace or personal Google accounts',
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text', placeholder: 'xxx.apps.googleusercontent.com', required: true },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
      { key: 'allowedDomains', label: 'Allowed Domains', type: 'text', placeholder: 'example.com, company.org', helpText: 'Comma-separated list. Leave empty to allow all.' },
    ],
  },
  {
    type: 'plex',
    label: 'Plex',
    description: 'Authenticate with Plex.tv account',
    fields: [
      { key: 'restrictToServerId', label: 'Restrict to Server ID', type: 'text', placeholder: 'Optional - Plex server ID', helpText: 'Only allow users with access to this Plex server' },
    ],
  },
];

export function SsoSettings() {
  const [providers, setProviders] = useState<SsoProvider[]>([]);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [editingConfig, setEditingConfig] = useState<Record<string, Record<string, any>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const { addToast } = useToast();

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    const { data } = await api.get<{ providers: SsoProvider[] }>('/api/sso/providers');
    if (data) {
      setProviders(data.providers);
      // Initialize editing state
      const configs: Record<string, Record<string, any>> = {};
      data.providers.forEach(p => {
        configs[p.type] = { ...p.config };
      });
      setEditingConfig(configs);
    }
  };

  const handleToggle = async (type: string, currentEnabled: boolean) => {
    const { error } = await api.patch(`/api/sso/providers/${type}/toggle`, {
      isEnabled: !currentEnabled,
    });
    
    if (error) {
      addToast({ type: 'error', title: 'Failed to toggle provider' });
    } else {
      fetchProviders();
      addToast({ type: 'success', title: `${type.toUpperCase()} ${!currentEnabled ? 'enabled' : 'disabled'}` });
    }
  };

  const handleSave = async (type: string) => {
    setSaving(type);
    const config = editingConfig[type] || {};
    const providerConfig = providerConfigs.find(p => p.type === type);
    
    const { error } = await api.put(`/api/sso/providers/${type}`, {
      name: providerConfig?.label || type.toUpperCase(),
      config,
    });
    
    if (error) {
      addToast({ type: 'error', title: 'Failed to save', message: error });
    } else {
      addToast({ type: 'success', title: 'Configuration saved' });
      fetchProviders();
    }
    setSaving(null);
  };

  const handleTest = async (type: string) => {
    setTesting(type);
    const { data, error } = await api.post<{ success: boolean; message?: string }>(`/api/sso/providers/${type}/test`, {});
    
    if (error) {
      addToast({ type: 'error', title: 'Connection test failed', message: error });
    } else if (data?.success) {
      addToast({ type: 'success', title: 'Connection test passed', message: data.message });
    }
    setTesting(null);
  };

  const handleConfigChange = (type: string, key: string, value: string) => {
    setEditingConfig(prev => ({
      ...prev,
      [type]: { ...prev[type], [key]: value },
    }));
  };

  const getProvider = (type: string) => providers.find(p => p.type === type);

  return (
    <div className="space-y-4">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">SSO Authentication</h2>
        <p className="text-sm text-muted-foreground">
          Configure external authentication providers. Users must be pre-created with matching email addresses.
        </p>
      </div>

      {providerConfigs.map((config) => {
        const provider = getProvider(config.type);
        const isExpanded = expandedProvider === config.type;
        const isEnabled = provider?.isEnabled ?? false;

        return (
          <Card key={config.type} className="overflow-hidden">
            <CardHeader
              className="cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => setExpandedProvider(isExpanded ? null : config.type)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <div>
                    <CardTitle className="text-base">{config.label}</CardTitle>
                    <p className="text-sm text-muted-foreground">{config.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                  <span className={`text-xs px-2 py-1 rounded ${isEnabled ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'}`}>
                    {isEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                  <button
                    onClick={() => handleToggle(config.type, isEnabled)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      isEnabled ? 'bg-primary' : 'bg-muted'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        isEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </CardHeader>
            
            {isExpanded && (
              <CardContent className="border-t pt-4 space-y-4">
                {config.fields.map((field) => (
                  <div key={field.key}>
                    <label className="block text-sm font-medium mb-1">
                      {field.label}
                      {field.required && <span className="text-destructive ml-1">*</span>}
                    </label>
                    {field.type === 'textarea' ? (
                      <textarea
                        className="w-full px-3 py-2 border rounded-md bg-background text-sm font-mono"
                        rows={4}
                        value={editingConfig[config.type]?.[field.key] || ''}
                        onChange={(e) => handleConfigChange(config.type, field.key, e.target.value)}
                        placeholder={field.placeholder}
                      />
                    ) : (
                      <Input
                        type={field.type}
                        value={editingConfig[config.type]?.[field.key] || ''}
                        onChange={(e) => handleConfigChange(config.type, field.key, e.target.value)}
                        placeholder={field.placeholder}
                      />
                    )}
                    {field.helpText && (
                      <p className="text-xs text-muted-foreground mt-1">{field.helpText}</p>
                    )}
                  </div>
                ))}
                
                <div className="flex justify-end gap-2 pt-4 border-t">
                  <Button
                    variant="outline"
                    onClick={() => handleTest(config.type)}
                    disabled={testing === config.type}
                  >
                    {testing === config.type ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Testing...</>
                    ) : (
                      'Test Connection'
                    )}
                  </Button>
                  <Button
                    onClick={() => handleSave(config.type)}
                    disabled={saving === config.type}
                  >
                    {saving === config.type ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/web/src/components/settings/sso-settings.tsx
git commit -m "feat(web): add SSO settings accordion component"
```

---

### Task 8: Add SSO tab to Settings page

**Files:**
- Modify: `apps/web/src/app/settings/page.tsx`

**Step 1: Import and add SSO tab**

In `apps/web/src/app/settings/page.tsx`:

1. Add import at top:
```tsx
import { SsoSettings } from '@/components/settings/sso-settings';
import { Key } from 'lucide-react';
```

2. Add SSO section after AI Settings but before settingGroups.map:
```tsx
{/* SSO Settings (Admin only) */}
{isAdmin && (
  <Card>
    <CardHeader>
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Key className="h-5 w-5" />
        </div>
        <div>
          <CardTitle className="text-lg">Single Sign-On</CardTitle>
          <CardDescription>Configure LDAP, SAML, Google, and Plex authentication</CardDescription>
        </div>
      </div>
    </CardHeader>
    <CardContent>
      <SsoSettings />
    </CardContent>
  </Card>
)}
```

**Step 2: Commit**

```bash
git add apps/web/src/app/settings/page.tsx
git commit -m "feat(web): add SSO settings section to Settings page"
```

---

## Phase 4: Google OAuth Implementation

### Task 9: Install passport-google-oauth20

**Step 1: Install dependency**

```bash
cd apps/api
npm install passport-google-oauth20
npm install -D @types/passport-google-oauth20
```

**Step 2: Commit**

```bash
git add apps/api/package.json apps/api/package-lock.json
git commit -m "chore(api): add passport-google-oauth20 dependency"
```

---

### Task 10: Create Google OAuth strategy

**Files:**
- Create: `apps/api/src/auth/strategies/google.ts`
- Test: `apps/api/tests/auth/google.test.ts`

**Step 1: Write failing test**

Create `apps/api/tests/auth/google.test.ts`:

```typescript
/**
 * Google OAuth Strategy Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockPrisma, resetIdCounter } from '../utils/fixtures.js';

describe('Google OAuth Strategy', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
  });

  describe('handleGoogleCallback', () => {
    it('should link Google identity to existing user with matching email', async () => {
      const existingUser = {
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'user',
      };
      
      mockPrisma.user.findFirst.mockResolvedValue(existingUser);
      mockPrisma.authIdentity.upsert.mockResolvedValue({
        id: 1,
        userId: 1,
        provider: 'google',
        providerUserId: 'google-123',
        email: 'test@example.com',
        metadata: {},
        createdAt: new Date(),
        lastUsedAt: new Date(),
      });

      // Simulate callback
      const profile = {
        id: 'google-123',
        emails: [{ value: 'test@example.com' }],
        displayName: 'Test User',
      };

      const user = await mockPrisma.user.findFirst({
        where: { email: profile.emails[0].value },
      });

      expect(user).toBeDefined();
      expect(user?.email).toBe('test@example.com');
    });

    it('should reject login when no user exists with that email', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const profile = {
        id: 'google-456',
        emails: [{ value: 'unknown@example.com' }],
      };

      const user = await mockPrisma.user.findFirst({
        where: { email: profile.emails[0].value },
      });

      expect(user).toBeNull();
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/api
npx vitest run tests/auth/google.test.ts -v
```

Expected: PASS (tests mock layer only)

**Step 3: Implement strategy**

Create `apps/api/src/auth/strategies/google.ts`:

```typescript
/**
 * Google OAuth Strategy
 */

import { Strategy as GoogleStrategy, Profile } from 'passport-google-oauth20';
import type { PrismaClient } from '@prisma/client';

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  allowedDomains?: string[];
}

export function createGoogleStrategy(
  config: GoogleOAuthConfig,
  prisma: PrismaClient
): GoogleStrategy {
  return new GoogleStrategy(
    {
      clientID: config.clientId,
      clientSecret: config.clientSecret,
      callbackURL: config.callbackUrl,
      scope: ['profile', 'email'],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        
        if (!email) {
          return done(null, false, { message: 'No email in Google profile' });
        }

        // Check domain restriction
        if (config.allowedDomains?.length) {
          const domain = email.split('@')[1];
          if (!config.allowedDomains.includes(domain)) {
            return done(null, false, { message: 'Email domain not allowed' });
          }
        }

        // Find user by email (case-insensitive)
        const user = await prisma.user.findFirst({
          where: { email: { equals: email, mode: 'insensitive' } },
        });

        if (!user) {
          return done(null, false, { 
            message: 'No account found for this email. Contact your administrator.' 
          });
        }

        if (!user.isActive) {
          return done(null, false, { message: 'Your account has been disabled.' });
        }

        // Link or update identity
        await prisma.authIdentity.upsert({
          where: {
            provider_providerUserId: {
              provider: 'google',
              providerUserId: profile.id,
            },
          },
          create: {
            userId: user.id,
            provider: 'google',
            providerUserId: profile.id,
            email: email,
            metadata: {
              displayName: profile.displayName,
              picture: profile.photos?.[0]?.value,
            },
          },
          update: {
            lastUsedAt: new Date(),
            metadata: {
              displayName: profile.displayName,
              picture: profile.photos?.[0]?.value,
            },
          },
        });

        // Update user's last login
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLogin: new Date() },
        });

        return done(null, {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
        });
      } catch (error) {
        return done(error as Error);
      }
    }
  );
}
```

**Step 4: Commit**

```bash
git add apps/api/src/auth/strategies/google.ts apps/api/tests/auth/google.test.ts
git commit -m "feat(api): add Google OAuth strategy"
```

---

### Task 11: Add Google OAuth routes

**Files:**
- Modify: `apps/api/src/routes/auth.ts`

**Step 1: Add Google routes**

In `apps/api/src/routes/auth.ts`, add:

```typescript
import passport from 'passport';
import { createGoogleStrategy } from '../auth/strategies/google.js';

// Google OAuth - initiate
authRouter.get('/sso/google', async (req, res, next) => {
  // Load Google config from database
  const provider = await prisma.ssoProvider.findUnique({
    where: { type: 'google' },
  });
  
  if (!provider?.isEnabled) {
    res.status(400).json({ error: 'Google authentication is not available' });
    return;
  }

  const config = provider.config as any;
  const baseUrl = (await prisma.globalSetting.findUnique({ where: { key: 'baseUrl' } }))?.value as string || 'http://localhost:3010';
  
  // Register strategy dynamically
  passport.use('google-sso', createGoogleStrategy({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    callbackUrl: `${baseUrl}/api/auth/sso/google/callback`,
    allowedDomains: config.allowedDomains?.split(',').map((d: string) => d.trim()),
  }, prisma));

  passport.authenticate('google-sso', { scope: ['profile', 'email'] })(req, res, next);
});

// Google OAuth - callback
authRouter.get('/sso/google/callback', (req, res, next) => {
  passport.authenticate('google-sso', (err: Error | null, user: Express.User | false, info: { message?: string }) => {
    if (err) {
      console.error('Google OAuth error:', err);
      return res.redirect('/login?error=auth_failed');
    }
    if (!user) {
      const msg = encodeURIComponent(info?.message || 'Authentication failed');
      return res.redirect(`/login?error=${msg}`);
    }
    req.logIn(user, (loginErr) => {
      if (loginErr) {
        return res.redirect('/login?error=login_failed');
      }
      return res.redirect('/');
    });
  })(req, res, next);
});
```

**Step 2: Commit**

```bash
git add apps/api/src/routes/auth.ts
git commit -m "feat(api): add Google OAuth routes"
```

---

### Task 12: Add SSO buttons to login page

**Files:**
- Modify: `apps/web/src/app/login/page.tsx`

**Step 1: Add SSO buttons**

In the login page, after the password login form, add:

```tsx
// Fetch enabled providers
const [ssoProviders, setSsoProviders] = useState<Array<{ type: string; name: string }>>([]);

useEffect(() => {
  api.get<{ providers: Array<{ type: string; name: string }> }>('/api/auth/sso/enabled')
    .then(({ data }) => {
      if (data) setSsoProviders(data.providers);
    });
}, []);

// In the render, after the login form:
{ssoProviders.length > 0 && (
  <div className="mt-6">
    <div className="relative">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t" />
      </div>
      <div className="relative flex justify-center text-xs uppercase">
        <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
      </div>
    </div>
    
    <div className="mt-4 space-y-2">
      {ssoProviders.map((provider) => (
        <Button
          key={provider.type}
          variant="outline"
          className="w-full"
          onClick={() => window.location.href = `/api/auth/sso/${provider.type}`}
        >
          {provider.type === 'google' && '🔵 '}
          {provider.type === 'plex' && '🟠 '}
          {provider.type === 'ldap' && '🔑 '}
          {provider.type === 'saml' && '🔐 '}
          Login with {provider.name}
        </Button>
      ))}
    </div>
  </div>
)}
```

**Step 2: Commit**

```bash
git add apps/web/src/app/login/page.tsx
git commit -m "feat(web): add SSO login buttons to login page"
```

---

## Phase 5: Remaining Providers (LDAP, SAML, Plex)

### Task 13: Install remaining dependencies

```bash
cd apps/api
npm install passport-ldapauth @node-saml/passport-saml
npm install -D @types/passport-ldapauth
```

```bash
git add apps/api/package.json apps/api/package-lock.json
git commit -m "chore(api): add LDAP and SAML passport dependencies"
```

---

### Task 14: Create LDAP strategy

**Files:**
- Create: `apps/api/src/auth/strategies/ldap.ts`
- Test: `apps/api/tests/auth/ldap.test.ts`

Similar pattern to Google:
1. Write failing test
2. Implement strategy with user lookup by email
3. Add routes for LDAP login (POST with username/password)
4. Commit

---

### Task 15: Create SAML strategy

**Files:**
- Create: `apps/api/src/auth/strategies/saml.ts`
- Test: `apps/api/tests/auth/saml.test.ts`

Similar pattern:
1. Write failing test
2. Implement strategy with assertion validation and email lookup
3. Add ACS route and metadata endpoint
4. Commit

---

### Task 16: Create Plex OAuth strategy

**Files:**
- Create: `apps/api/src/auth/strategies/plex.ts`
- Test: `apps/api/tests/auth/plex.test.ts`

Plex uses a custom OAuth flow:
1. Write failing test
2. Implement Plex PIN-based auth flow
3. Add routes for Plex OAuth redirect and callback
4. Commit

---

## Phase 6: User Identity Management

### Task 17: Add identity management endpoints

**Files:**
- Modify: `apps/api/src/routes/auth.ts`
- Test: `apps/api/tests/api/auth.test.ts` (extend)

Add endpoints for admins to view and unlink user SSO identities:
- GET `/api/users/:id/identities`
- DELETE `/api/users/:id/identities/:identityId`

---

### Task 18: Add email field to user creation UI

**Files:**
- Modify: `apps/web/src/app/settings/page.tsx` (or user management component)

When creating users, admin can now specify email (required for SSO).

---

## Final Verification

### Task 19: Full integration test

**Step 1: Start application**

```bash
./start-dev.sh
```

**Step 2: Test checklist**

- [ ] SSO tab visible in Settings for admin
- [ ] Can configure and save Google provider
- [ ] Can enable/disable providers with toggle
- [ ] Login page shows SSO buttons when providers enabled
- [ ] Google OAuth redirects and callbacks work
- [ ] User without matching email is rejected
- [ ] User with matching email is logged in
- [ ] AuthIdentity record created after SSO login

**Step 3: Run full test suite**

```bash
cd apps/api
npm test
```

Expected: All tests pass

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 1-3 | Database schema (User.email, SsoProvider, AuthIdentity) |
| 2 | 4-6 | SSO provider management API |
| 3 | 7-8 | Frontend SSO settings UI |
| 4 | 9-12 | Google OAuth implementation |
| 5 | 13-16 | LDAP, SAML, Plex implementations |
| 6 | 17-18 | User identity management |
| 7 | 19 | Final verification |

**Total estimated time:** 4-6 hours for experienced developer
