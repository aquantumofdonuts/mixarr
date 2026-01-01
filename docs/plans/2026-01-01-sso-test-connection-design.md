# SSO Test Connection Fix - Design

**Date:** 2026-01-01  
**Status:** Approved

## Problem

The SSO "Test Connection" feature has three issues:

1. **Always returns success** - The backend is a placeholder that never actually tests anything
2. **Button disabled incorrectly** - Can only test after enabling (going live), not before
3. **No provider validation** - Returns success even for unconfigured providers

## Solution

### Frontend Changes

**File:** `apps/web/src/components/settings/sso-settings.tsx`

Change the Test Connection button's disabled condition from:
```tsx
disabled={testingProvider === config.type || !isEnabled}
```
to:
```tsx
disabled={testingProvider === config.type || !isSaved}
```

This enables the correct workflow: Configure → Save → Test → Enable.

### Backend Test Implementations

**File:** `apps/api/src/routes/sso.ts`

Replace the placeholder with provider-specific tests:

| Provider | Test Logic | Timeout |
|----------|------------|---------|
| **LDAP** | Bind to server with configured credentials | 10s |
| **SAML** | Fetch and parse IdP metadata URL | 10s |
| **Google** | Validate client ID/secret format | N/A |
| **Plex** | Return info message (PIN-based, no test) | N/A |

### Provider-Specific Logic

**LDAP:**
- Create LDAP client with `serverUrl`
- Attempt bind with `bindDn` and `bindPassword`
- Return success/failure with descriptive message

**SAML:**
- If `idpMetadataUrl` configured: fetch with 10s timeout, validate XML
- Otherwise: validate `idpSsoUrl` and `idpCertificate` present

**Google:**
- Validate `clientId` ends with `.apps.googleusercontent.com`
- Validate `clientSecret` is non-empty
- Return info that full test requires browser redirect

**Plex:**
- Return info message explaining PIN-based auth has no connection to test

### API Response Format

All tests return:
```typescript
{ success: boolean, message: string }
```

404 returned if provider not configured.

## Testing Strategy

```typescript
describe('SSO Test Connection', () => {
  // LDAP
  it('should return error when LDAP server unreachable');
  it('should return error when LDAP bind fails');
  it('should return success when LDAP bind succeeds');
  it('should timeout after 10 seconds');

  // SAML  
  it('should return success when metadata URL returns valid XML');
  it('should return error when metadata URL unreachable');
  it('should return error when metadata is not valid SAML');
  it('should validate manual config when no metadata URL');

  // Google
  it('should return error when clientId format invalid');
  it('should return success when credentials format valid');

  // Plex
  it('should return info message about PIN auth');

  // General
  it('should return 404 when provider not configured');
});
```

Tests mock LDAP and HTTP calls.

## Files to Modify

1. `apps/web/src/components/settings/sso-settings.tsx` - Button disabled logic
2. `apps/api/src/routes/sso.ts` - Test endpoint implementation
3. `apps/api/tests/unit/routes/sso.test.ts` - Unit tests (new file)
