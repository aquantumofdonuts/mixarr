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
  if (!c.bindPassword || typeof c.bindPassword !== 'string') {
    throw new Error('bindPassword is required');
  }
  if (!c.searchBaseDn || typeof c.searchBaseDn !== 'string') {
    throw new Error('searchBaseDn is required');
  }
  if (!c.searchFilter || typeof c.searchFilter !== 'string') {
    throw new Error('searchFilter is required');
  }
  if (!c.emailAttribute || typeof c.emailAttribute !== 'string') {
    throw new Error('emailAttribute is required');
  }
  if (!c.displayNameAttribute || typeof c.displayNameAttribute !== 'string') {
    throw new Error('displayNameAttribute is required');
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
