# SSO Authentication Design

## Overview

Add Single Sign-On (SSO) support to Mixarr with four providers: LDAP, SAML 2.0, Google OAuth, and Plex OAuth. SSO configuration is managed by admins via a new "SSO" tab in the Settings page.

## Key Decisions

| Decision | Choice |
|----------|--------|
| LDAP compatibility | Both Active Directory and OpenLDAP with configurable attribute mapping |
| Role assignment | All users created as standard; admins manually promote users |
| Account linking | Pre-provisioned only—admin must create account with email before SSO login works |
| Auth methods per user | Multiple allowed—user can have password AND linked SSO identities |
| Settings UI | SSO tab in Settings page with collapsible accordion per provider |
| Plex flow | OAuth redirect (like Overseerr/Tautulli) |
| Test connection | Optional but available for each provider |

---

## Architecture

### Authentication Flow

```
User clicks SSO button → Redirect to provider → Provider authenticates
→ Callback to Mixarr → Lookup user by email → Session created
```

**Security constraint:** SSO login only succeeds if an admin has pre-created an account with that email address. No auto-provisioning.

### Database Changes

#### New `AuthIdentity` Table

Links SSO identities to users. One user can have multiple identities.

```prisma
model AuthIdentity {
  id             Int       @id @default(autoincrement())
  userId         Int       @map("user_id")
  provider       SsoProviderType
  providerUserId String    @map("provider_user_id") @db.VarChar(255)
  email          String    @db.VarChar(255)
  metadata       Json?     // Provider-specific data (display name, etc.)
  createdAt      DateTime  @default(now()) @map("created_at")
  lastUsedAt     DateTime? @map("last_used_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerUserId])
  @@index([userId])
  @@index([provider, email])
  @@map("auth_identities")
}

enum SsoProviderType {
  ldap
  saml
  google
  plex
}
```

#### New `SsoProvider` Table

Admin-configured SSO providers.

```prisma
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

#### User Model Changes

```prisma
model User {
  // ... existing fields ...
  email        String?   @unique @db.VarChar(255)  // NEW: Required for SSO matching
  passwordHash String?   @map("password_hash")     // CHANGED: Now nullable for SSO-only users
  
  // NEW relation
  authIdentities AuthIdentity[]
}
```

---

## Provider Implementations

### LDAP (Active Directory & OpenLDAP)

**Configuration fields:**
- `serverUrl` — e.g., `ldap://ldap.example.com:389` or `ldaps://...`
- `bindDn` — Service account DN for searching
- `bindPassword` — Encrypted
- `searchBaseDn` — e.g., `ou=users,dc=example,dc=com`
- `searchFilter` — Default: `(uid={{username}})` (OpenLDAP) or `(sAMAccountName={{username}})` (AD)
- `usernameAttribute` — Field to match username
- `emailAttribute` — Field to extract email
- `displayNameAttribute` — Field to extract display name
- `useTls` — Enable StartTLS
- `tlsOptions` — Certificate validation settings

**Auth flow:**
1. User enters username/password on Mixarr login page
2. Mixarr binds to LDAP with service account
3. Search for user by username
4. Attempt bind with user's credentials
5. On success, extract email and lookup in Mixarr
6. Create session if user exists

**Passport strategy:** `passport-ldapauth`

### SAML 2.0

**Configuration fields:**
- `idpMetadataUrl` — Auto-fetches IdP config (preferred)
- OR manual entry:
  - `idpSsoUrl` — IdP login URL
  - `idpCertificate` — For signature validation
- `spEntityId` — Auto-generated, shown to admin for IdP registration
- `spAcsUrl` — Auto-generated callback URL
- `emailAttribute` — SAML attribute containing email
- `displayNameAttribute` — SAML attribute containing display name

**Auth flow:**
1. User clicks "Login with SAML"
2. Redirect to IdP with SAML AuthnRequest
3. User authenticates at IdP
4. IdP POSTs SAML assertion to ACS URL
5. Validate signature, extract email
6. Lookup user by email, create session

**Passport strategy:** `passport-saml`

### Google OAuth

**Configuration fields:**
- `clientId` — From Google Cloud Console
- `clientSecret` — Encrypted
- `allowedDomains` — Optional array, e.g., `["example.com"]` to restrict to Google Workspace

**Auth flow:**
1. User clicks "Login with Google"
2. Redirect to Google OAuth consent
3. User authorizes
4. Callback with auth code
5. Exchange for tokens, fetch user profile
6. Lookup by email, create session

**Passport strategy:** `passport-google-oauth20`

### Plex OAuth

**Configuration fields:**
- `restrictToServerId` — Optional, only allow users with access to specific Plex server

**Auth flow:**
1. User clicks "Login with Plex"
2. Redirect to Plex.tv OAuth
3. User authorizes Mixarr
4. Callback with Plex auth token
5. Fetch Plex user email from API
6. Lookup by email, create session

**Passport strategy:** Custom implementation or `passport-plex`

---

## Admin UI

### Settings Page Structure

New "SSO" tab added to `/settings` page (admin-only).

```
Settings
├── General
├── Notifications  
├── AI
└── SSO ← NEW
```

### SSO Tab Layout

```
┌─────────────────────────────────────────────────────────┐
│ SSO Authentication                                       │
│ Configure external authentication providers              │
├─────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ▼ LDAP                              [Disabled] [○─] │ │
│ │   ┌───────────────────────────────────────────────┐ │ │
│ │   │ Server URL: [ldap://____________]             │ │ │
│ │   │ Bind DN:    [cn=admin,dc=_______]             │ │ │
│ │   │ Bind Password: [••••••••]                     │ │ │
│ │   │ Search Base: [ou=users,dc=______]             │ │ │
│ │   │ Search Filter: [(uid={{username}})]           │ │ │
│ │   │ ... (attribute mappings)                      │ │ │
│ │   │ [Test Connection]              [Save]         │ │ │
│ │   └───────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ▶ SAML 2.0                          [Disabled] [○─] │ │
│ └─────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ▶ Google                            [Disabled] [○─] │ │
│ └─────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ▶ Plex                              [Enabled]  [─●] │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**Card behavior:**
- Collapsed: Shows provider name, status badge, toggle switch
- Expanded: Full configuration form
- Toggle switch: Quick enable/disable without expanding
- Test Connection: Validates config before enabling
- Save: Persists config, shows success/error toast

### Login Page Changes

When SSO providers are enabled, login page shows additional buttons:

```
┌────────────────────────────────┐
│        Welcome to Mixarr       │
├────────────────────────────────┤
│ Username: [________________]   │
│ Password: [________________]   │
│          [    Log In    ]      │
│                                │
│ ─────────── or ───────────     │
│                                │
│ [🔑 Login with LDAP      ]     │
│ [🔐 Login with SAML      ]     │
│ [G  Login with Google    ]     │
│ [▶  Login with Plex      ]     │
└────────────────────────────────┘
```

Only enabled providers show buttons.

---

## API Endpoints

### SSO Provider Management (Admin only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sso/providers` | List all providers (secrets masked) |
| GET | `/api/sso/providers/:type` | Get single provider config |
| PUT | `/api/sso/providers/:type` | Create/update provider config |
| DELETE | `/api/sso/providers/:type` | Remove provider config |
| POST | `/api/sso/providers/:type/test` | Test connection |
| PATCH | `/api/sso/providers/:type/toggle` | Enable/disable provider |

### SSO Authentication (Public)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/auth/sso/enabled` | List enabled providers (for login page) |
| POST | `/api/auth/sso/ldap` | LDAP login (username/password in body) |
| GET | `/api/auth/sso/google` | Initiate Google OAuth |
| GET | `/api/auth/sso/google/callback` | Google OAuth callback |
| GET | `/api/auth/sso/plex` | Initiate Plex OAuth |
| GET | `/api/auth/sso/plex/callback` | Plex OAuth callback |
| POST | `/api/auth/sso/saml` | SAML ACS endpoint |
| GET | `/api/auth/sso/saml/metadata` | SP metadata XML |

### User Identity Management (Admin only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users/:id/identities` | List linked SSO identities |
| DELETE | `/api/users/:id/identities/:identityId` | Unlink SSO identity |

---

## Error Handling

| Scenario | HTTP Status | Error Message |
|----------|-------------|---------------|
| SSO email not found | 403 | "No account found for this email. Contact your administrator." |
| Provider disabled | 400 | "This authentication method is not available." |
| Provider misconfigured | 500 | "Authentication service error. Contact your administrator." |
| LDAP bind failed | 401 | "Invalid username or password." |
| SAML assertion invalid | 401 | "Authentication failed. Please try again." |
| User account disabled | 403 | "Your account has been disabled." |

**Note:** Error messages never reveal whether an email exists (prevents enumeration).

---

## Testing Strategy

### Unit Tests
- SSO config encryption/decryption
- Email matching logic (case-insensitive, domain validation)
- Provider config validation (required fields, URL formats)

### Integration Tests
- **LDAP:** Mock LDAP server using `ldapjs`
- **SAML:** Mock IdP responses with test certificates
- **Google/Plex:** Mock OAuth responses with MSW
- **Full flow:** SSO callback → user lookup → session creation

### Security Tests
- SSO endpoints only accessible when provider is enabled
- Admin-only routes reject non-admin users
- Config secrets never returned in API responses
- SAML signature validation rejects tampered assertions
- CSRF protection on all SSO callbacks

---

## Security Considerations

1. **Secrets encryption:** All provider credentials encrypted at rest using existing encryption pattern
2. **HTTPS required:** SSO callbacks require HTTPS in production (OAuth providers mandate it)
3. **Session binding:** After SSO callback, session is bound to user with standard session security
4. **Rate limiting:** Existing rate limiter applied to SSO login endpoints
5. **No credential leakage:** Error messages generic to prevent email enumeration
6. **Audit logging:** All SSO events logged (success, failure, config changes)

---

## Dependencies

```json
{
  "passport-ldapauth": "^3.0.1",
  "passport-saml": "^3.2.4",
  "passport-google-oauth20": "^2.0.0"
}
```

Plex OAuth may use custom implementation or community package.

---

## Implementation Order

1. Database migrations (AuthIdentity, SsoProvider, User.email)
2. SSO provider management API (admin CRUD)
3. SSO settings UI (SSO tab with provider cards)
4. Google OAuth (simplest OAuth flow)
5. Plex OAuth
6. LDAP authentication
7. SAML authentication (most complex)
8. Login page SSO buttons
9. User identity management UI

---

## Out of Scope

- 2FA/MFA (separate feature)
- JIT (Just-In-Time) provisioning (explicitly rejected for security)
- Group-based role mapping (manual admin promotion only)
- Multiple LDAP/SAML providers (one per type)
