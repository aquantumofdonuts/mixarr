# SSO Test Connection Fix - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement real connection tests for SSO providers and fix the button disabled logic.

**Architecture:** Add provider-specific test functions to the SSO routes, using ldapjs for LDAP binding and fetch for SAML metadata. Frontend button enabled when provider is saved (not just enabled).

**Tech Stack:** Express, ldapjs, node-fetch, Vitest

---

### Task 1: Fix Frontend Button Disabled Logic

**Files:**
- Modify: `apps/web/src/components/settings/sso-settings.tsx:383`

**Step 1: Update button disabled condition**

Change from:
```tsx
disabled={testingProvider === config.type || !isEnabled}
```

To:
```tsx
disabled={testingProvider === config.type || !isSaved}
```

**Step 2: Verify change**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No type errors

**Step 3: Commit**

```bash
git add apps/web/src/components/settings/sso-settings.tsx
git commit -m "fix(sso): allow test connection before enabling provider"
```

---

### Task 2: Write Failing Test for Provider Not Found

**Files:**
- Create: `apps/api/tests/unit/routes/sso-test.test.ts`

**Step 1: Create test file with first test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ssoRouter } from '../../../src/routes/sso.js';

// Mock auth middleware
vi.mock('../../../src/middleware/auth.js', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

// Mock prisma
vi.mock('../../../src/lib/db.js', () => ({
  default: {
    ssoProvider: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import prisma from '../../../src/lib/db.js';

describe('SSO Test Connection', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/sso', ssoRouter);
  });

  describe('POST /api/sso/providers/:type/test', () => {
    it('should return 404 when provider not configured', async () => {
      vi.mocked(prisma.ssoProvider.findUnique).mockResolvedValue(null);

      const response = await request(app)
        .post('/api/sso/providers/ldap/test')
        .send();

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('not configured');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/unit/routes/sso-test.test.ts -v`
Expected: FAIL - test returns 200 with placeholder message instead of 404

---

### Task 3: Implement Provider Check in Test Endpoint

**Files:**
- Modify: `apps/api/src/routes/sso.ts:138-149`

**Step 1: Update test endpoint to check provider exists**

Replace:
```typescript
// Test connection (placeholder)
ssoRouter.post('/providers/:type/test', async (req, res) => {
  try {
    if (!isValidProviderType(req.params.type)) {
      res.status(400).json({ error: 'Invalid provider type' });
      return;
    }
    const type = req.params.type;
    res.json({ success: true, message: `${type} connection test not yet implemented` });
  } catch (error) {
    console.error('Failed to test SSO provider:', error);
    res.status(500).json({ error: 'Connection test failed' });
  }
});
```

With:
```typescript
// Test connection
ssoRouter.post('/providers/:type/test', async (req, res) => {
  try {
    if (!isValidProviderType(req.params.type)) {
      res.status(400).json({ success: false, message: 'Invalid provider type' });
      return;
    }
    const type = req.params.type;
    
    const provider = await ssoService.getByType(type);
    if (!provider) {
      res.status(404).json({ success: false, message: 'Provider not configured. Save configuration first.' });
      return;
    }

    // Provider-specific tests will be added next
    res.json({ success: true, message: `${type} connection test not yet implemented` });
  } catch (error) {
    console.error('Failed to test SSO provider:', error);
    res.status(500).json({ success: false, message: 'Connection test failed' });
  }
});
```

**Step 2: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/unit/routes/sso-test.test.ts -v`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/api/src/routes/sso.ts apps/api/tests/unit/routes/sso-test.test.ts
git commit -m "feat(sso): return 404 when testing unconfigured provider"
```

---

### Task 4: Write Failing Tests for Google Validation

**Files:**
- Modify: `apps/api/tests/unit/routes/sso-test.test.ts`

**Step 1: Add Google test cases**

```typescript
    describe('Google provider', () => {
      it('should return error when clientId format invalid', async () => {
        vi.mocked(prisma.ssoProvider.findUnique).mockResolvedValue({
          id: 1,
          type: 'google',
          name: 'Google',
          config: { clientId: 'invalid-id', clientSecret: 'secret' },
          isEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);

        const response = await request(app)
          .post('/api/sso/providers/google/test')
          .send();

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('Client ID');
      });

      it('should return success when credentials format valid', async () => {
        vi.mocked(prisma.ssoProvider.findUnique).mockResolvedValue({
          id: 1,
          type: 'google',
          name: 'Google',
          config: { clientId: 'test.apps.googleusercontent.com', clientSecret: 'secret123' },
          isEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);

        const response = await request(app)
          .post('/api/sso/providers/google/test')
          .send();

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain('valid');
      });
    });
```

**Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/unit/routes/sso-test.test.ts -v`
Expected: FAIL - returns placeholder message

---

### Task 5: Implement Google Test

**Files:**
- Modify: `apps/api/src/routes/sso.ts`

**Step 1: Add Google test logic**

Replace the placeholder section with:
```typescript
    const config = provider.config as Record<string, string>;

    // Provider-specific tests
    switch (type) {
      case 'google': {
        const clientId = config.clientId || '';
        const clientSecret = config.clientSecret || '';
        
        if (!clientId.endsWith('.apps.googleusercontent.com')) {
          res.json({ success: false, message: 'Client ID must end with .apps.googleusercontent.com' });
          return;
        }
        if (!clientSecret || clientSecret.length < 10) {
          res.json({ success: false, message: 'Client Secret appears invalid (too short)' });
          return;
        }
        res.json({ success: true, message: 'Credentials format valid. Full OAuth test requires browser redirect.' });
        return;
      }
      default:
        res.json({ success: true, message: `${type} connection test not yet implemented` });
    }
```

**Step 2: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run tests/unit/routes/sso-test.test.ts -v`
Expected: PASS (Google tests)

**Step 3: Commit**

```bash
git add apps/api/src/routes/sso.ts apps/api/tests/unit/routes/sso-test.test.ts
git commit -m "feat(sso): implement Google credentials validation test"
```

---

### Task 6: Write Failing Test for Plex

**Files:**
- Modify: `apps/api/tests/unit/routes/sso-test.test.ts`

**Step 1: Add Plex test**

```typescript
    describe('Plex provider', () => {
      it('should return info message about PIN auth', async () => {
        vi.mocked(prisma.ssoProvider.findUnique).mockResolvedValue({
          id: 1,
          type: 'plex',
          name: 'Plex',
          config: {},
          isEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);

        const response = await request(app)
          .post('/api/sso/providers/plex/test')
          .send();

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain('PIN');
      });
    });
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/unit/routes/sso-test.test.ts -v`
Expected: FAIL - returns generic placeholder

---

### Task 7: Implement Plex Test

**Files:**
- Modify: `apps/api/src/routes/sso.ts`

**Step 1: Add Plex case to switch**

```typescript
      case 'plex': {
        res.json({ success: true, message: 'Plex uses PIN-based authentication. No connection test needed.' });
        return;
      }
```

**Step 2: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run tests/unit/routes/sso-test.test.ts -v`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/api/src/routes/sso.ts apps/api/tests/unit/routes/sso-test.test.ts
git commit -m "feat(sso): implement Plex test message"
```

---

### Task 8: Write Failing Tests for SAML

**Files:**
- Modify: `apps/api/tests/unit/routes/sso-test.test.ts`

**Step 1: Add SAML test cases**

```typescript
    describe('SAML provider', () => {
      it('should return success when metadata URL returns valid XML', async () => {
        vi.mocked(prisma.ssoProvider.findUnique).mockResolvedValue({
          id: 1,
          type: 'saml',
          name: 'SAML',
          config: { idpMetadataUrl: 'https://example.com/metadata' },
          isEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);

        // Mock fetch
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          text: () => Promise.resolve('<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata"></EntityDescriptor>'),
        });

        const response = await request(app)
          .post('/api/sso/providers/saml/test')
          .send();

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain('metadata');
      });

      it('should return error when metadata URL unreachable', async () => {
        vi.mocked(prisma.ssoProvider.findUnique).mockResolvedValue({
          id: 1,
          type: 'saml',
          name: 'SAML',
          config: { idpMetadataUrl: 'https://unreachable.example.com/metadata' },
          isEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);

        global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

        const response = await request(app)
          .post('/api/sso/providers/saml/test')
          .send();

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('fetch');
      });

      it('should validate manual config when no metadata URL', async () => {
        vi.mocked(prisma.ssoProvider.findUnique).mockResolvedValue({
          id: 1,
          type: 'saml',
          name: 'SAML',
          config: { idpSsoUrl: 'https://idp.example.com/sso', idpCertificate: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----' },
          isEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);

        const response = await request(app)
          .post('/api/sso/providers/saml/test')
          .send();

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain('configured');
      });
    });
```

**Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/unit/routes/sso-test.test.ts -v`
Expected: FAIL

---

### Task 9: Implement SAML Test

**Files:**
- Modify: `apps/api/src/routes/sso.ts`

**Step 1: Add SAML case to switch**

```typescript
      case 'saml': {
        const metadataUrl = config.idpMetadataUrl;
        const ssoUrl = config.idpSsoUrl;
        const certificate = config.idpCertificate;

        if (metadataUrl) {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(metadataUrl, { signal: controller.signal });
            clearTimeout(timeout);
            
            if (!response.ok) {
              res.json({ success: false, message: `Failed to fetch metadata: HTTP ${response.status}` });
              return;
            }
            
            const text = await response.text();
            if (!text.includes('EntityDescriptor') && !text.includes('IDPSSODescriptor')) {
              res.json({ success: false, message: 'Response does not appear to be valid SAML metadata' });
              return;
            }
            
            res.json({ success: true, message: 'IdP metadata fetched and validated successfully' });
            return;
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            res.json({ success: false, message: `Failed to fetch metadata: ${message}` });
            return;
          }
        }

        // Manual configuration
        if (!ssoUrl) {
          res.json({ success: false, message: 'Either IdP Metadata URL or IdP SSO URL is required' });
          return;
        }
        if (!certificate) {
          res.json({ success: false, message: 'IdP Certificate is required when not using metadata URL' });
          return;
        }
        
        res.json({ success: true, message: 'Manual SAML configuration looks valid' });
        return;
      }
```

**Step 2: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run tests/unit/routes/sso-test.test.ts -v`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/api/src/routes/sso.ts apps/api/tests/unit/routes/sso-test.test.ts
git commit -m "feat(sso): implement SAML metadata fetch test"
```

---

### Task 10: Write Failing Tests for LDAP

**Files:**
- Modify: `apps/api/tests/unit/routes/sso-test.test.ts`

**Step 1: Add LDAP test cases**

```typescript
// Add at top of file
vi.mock('ldapjs', () => ({
  createClient: vi.fn(),
}));

import ldap from 'ldapjs';
```

```typescript
    describe('LDAP provider', () => {
      it('should return success when LDAP bind succeeds', async () => {
        vi.mocked(prisma.ssoProvider.findUnique).mockResolvedValue({
          id: 1,
          type: 'ldap',
          name: 'LDAP',
          config: {
            serverUrl: 'ldap://localhost:389',
            bindDn: 'cn=admin,dc=example,dc=com',
            bindPassword: 'password',
            searchBaseDn: 'ou=users,dc=example,dc=com',
          },
          isEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);

        const mockClient = {
          bind: vi.fn((dn, pw, cb) => cb(null)),
          unbind: vi.fn((cb) => cb && cb()),
          destroy: vi.fn(),
        };
        vi.mocked(ldap.createClient).mockReturnValue(mockClient as any);

        const response = await request(app)
          .post('/api/sso/providers/ldap/test')
          .send();

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain('successful');
      });

      it('should return error when LDAP bind fails', async () => {
        vi.mocked(prisma.ssoProvider.findUnique).mockResolvedValue({
          id: 1,
          type: 'ldap',
          name: 'LDAP',
          config: {
            serverUrl: 'ldap://localhost:389',
            bindDn: 'cn=admin,dc=example,dc=com',
            bindPassword: 'wrongpassword',
            searchBaseDn: 'ou=users,dc=example,dc=com',
          },
          isEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);

        const mockClient = {
          bind: vi.fn((dn, pw, cb) => cb(new Error('Invalid credentials'))),
          unbind: vi.fn((cb) => cb && cb()),
          destroy: vi.fn(),
        };
        vi.mocked(ldap.createClient).mockReturnValue(mockClient as any);

        const response = await request(app)
          .post('/api/sso/providers/ldap/test')
          .send();

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('Invalid credentials');
      });

      it('should return error when LDAP server unreachable', async () => {
        vi.mocked(prisma.ssoProvider.findUnique).mockResolvedValue({
          id: 1,
          type: 'ldap',
          name: 'LDAP',
          config: {
            serverUrl: 'ldap://unreachable:389',
            bindDn: 'cn=admin,dc=example,dc=com',
            bindPassword: 'password',
            searchBaseDn: 'ou=users,dc=example,dc=com',
          },
          isEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);

        vi.mocked(ldap.createClient).mockImplementation(() => {
          throw new Error('ECONNREFUSED');
        });

        const response = await request(app)
          .post('/api/sso/providers/ldap/test')
          .send();

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('connect');
      });
    });
```

**Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/unit/routes/sso-test.test.ts -v`
Expected: FAIL

---

### Task 11: Implement LDAP Test

**Files:**
- Modify: `apps/api/src/routes/sso.ts`

**Step 1: Add ldapjs import at top**

```typescript
import ldap from 'ldapjs';
```

**Step 2: Add LDAP case to switch**

```typescript
      case 'ldap': {
        const serverUrl = config.serverUrl;
        const bindDn = config.bindDn;
        const bindPassword = config.bindPassword;

        if (!serverUrl || !bindDn || !bindPassword) {
          res.json({ success: false, message: 'Server URL, Bind DN, and Bind Password are required' });
          return;
        }

        try {
          const client = ldap.createClient({
            url: serverUrl,
            connectTimeout: 10000,
            timeout: 10000,
          });

          await new Promise<void>((resolve, reject) => {
            client.bind(bindDn, bindPassword, (err) => {
              if (err) {
                client.destroy();
                reject(err);
              } else {
                client.unbind(() => {});
                resolve();
              }
            });
          });

          res.json({ success: true, message: 'LDAP bind successful' });
          return;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          if (message.includes('ECONNREFUSED') || message.includes('ETIMEDOUT')) {
            res.json({ success: false, message: `Failed to connect to LDAP server: ${message}` });
          } else {
            res.json({ success: false, message: `LDAP bind failed: ${message}` });
          }
          return;
        }
      }
```

**Step 3: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run tests/unit/routes/sso-test.test.ts -v`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/api/src/routes/sso.ts apps/api/tests/unit/routes/sso-test.test.ts
git commit -m "feat(sso): implement LDAP bind test"
```

---

### Task 12: Run Full Test Suite

**Step 1: Run all API tests**

Run: `cd apps/api && npm test`
Expected: All tests pass

**Step 2: Run TypeScript check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: No errors

**Step 3: Rebuild and test containers**

Run: `cd /home/chris/Github/mixarr && sudo docker compose -f docker-compose.dev.yml up -d --build api web`
Expected: Containers start successfully

**Step 4: Final commit if needed**

```bash
git add -A
git commit -m "feat(sso): complete test connection implementation"
```
