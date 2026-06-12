import { z } from 'zod';

// Valid SSO provider types
export const SSO_PROVIDER_TYPES = ['ldap', 'saml', 'google', 'plex', 'oidc'] as const;

export type SsoProviderTypeEnum = (typeof SSO_PROVIDER_TYPES)[number];

// Params schema for routes with :type parameter
export const ssoProviderTypeParamsSchema = z.object({
  type: z.enum(SSO_PROVIDER_TYPES),
});

// Body schema for PUT /providers/:type (create/update)
export const upsertSsoProviderBodySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  config: z.record(z.string(), z.unknown()).refine(
    (obj) => obj !== null && typeof obj === 'object',
    { message: 'Config must be an object' }
  ),
  isEnabled: z.boolean().optional(),
});

// Body schema for PATCH /providers/:type/toggle
export const toggleSsoProviderBodySchema = z.object({
  isEnabled: z.boolean({
    required_error: 'isEnabled is required',
    invalid_type_error: 'isEnabled must be a boolean',
  }),
});

// Per-provider config schemas (for reference and potential future discriminated validation)
export const googleConfigSchema = z.object({
  clientId: z.string().min(1, 'clientId is required'),
  clientSecret: z.string().min(1, 'clientSecret is required'),
  allowedDomains: z.array(z.string()).optional(),
});

export const ldapConfigSchema = z.object({
  serverUrl: z.string().min(1, 'serverUrl is required'),
  bindDn: z.string().min(1, 'bindDn is required'),
  bindPassword: z.string().min(1, 'bindPassword is required'),
  searchBaseDn: z.string().min(1, 'searchBaseDn is required'),
  searchFilter: z.string().min(1, 'searchFilter is required'),
  emailAttribute: z.string().min(1, 'emailAttribute is required'),
  displayNameAttribute: z.string().min(1, 'displayNameAttribute is required'),
  usernameAttribute: z.string().optional(),
  useTls: z.boolean().optional(),
});

export const samlConfigSchema = z
  .object({
    idpMetadataUrl: z.string().optional(),
    idpSsoUrl: z.string().optional(),
    idpCertificate: z.string().optional(),
    emailAttribute: z.string().optional(),
    displayNameAttribute: z.string().optional(),
  })
  .refine((data) => data.idpMetadataUrl || data.idpSsoUrl, {
    message: 'Either idpMetadataUrl or idpSsoUrl is required',
  });

export const plexConfigSchema = z.object({
  restrictToServerId: z.string().optional(),
});

export const oidcConfigSchema = z.object({
  issuerUrl: z.string().min(1, 'issuerUrl is required').url('issuerUrl must be a valid URL').startsWith('https://', 'issuerUrl must use HTTPS'),
  clientId: z.string().min(1, 'clientId is required'),
  clientSecret: z.string().min(1, 'clientSecret is required'),
  scopes: z.string().optional(),
  allowedDomains: z.string().optional(), // comma-separated; stored and submitted as a plain string
  emailAttribute: z.string().optional(),
  displayNameAttribute: z.string().optional(),
  usernameAttribute: z.string().optional(),
});

// Exported inferred types
export type SsoProviderTypeParams = z.infer<typeof ssoProviderTypeParamsSchema>;
export type UpsertSsoProviderBody = z.infer<typeof upsertSsoProviderBodySchema>;
export type ToggleSsoProviderBody = z.infer<typeof toggleSsoProviderBodySchema>;
