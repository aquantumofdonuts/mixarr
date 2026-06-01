/**
 * SSO Provider Management Routes (Admin only)
 * 
 * Provides endpoints for managing SSO provider configurations.
 * All routes require admin authentication.
 */

import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { fetchWithTimeout } from '../lib/fetch-with-timeout.js';
import { SsoProviderService } from '../services/sso-provider.js';
import prisma from '../lib/db.js';
import type { SsoProviderType } from '@prisma/client';
import { createLogger } from '../lib/logger.js';
import {
  ssoProviderTypeParamsSchema,
  upsertSsoProviderBodySchema,
  toggleSsoProviderBodySchema,
} from '../schemas/sso.js';

const logger = createLogger('SSORoute');

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
    logger.error('Failed to fetch SSO providers', { error });
    res.status(500).json({ error: 'Failed to fetch providers' });
  }
});

// Get single provider
ssoRouter.get('/providers/:type', validateParams(ssoProviderTypeParamsSchema), async (req, res) => {
  try {
    const type = req.params.type as SsoProviderType;
    const provider = await ssoService.getByType(type);
    
    if (!provider) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }
    
    res.json({ provider });
  } catch (error) {
    logger.error('Failed to fetch SSO provider', { error });
    res.status(500).json({ error: 'Failed to fetch provider' });
  }
});

// Create/update provider
ssoRouter.put('/providers/:type', validateParams(ssoProviderTypeParamsSchema), validateBody(upsertSsoProviderBodySchema), async (req, res) => {
  try {
    const type = req.params.type as SsoProviderType;
    const { name, config, isEnabled } = req.body;
    
    const provider = await ssoService.upsert(type, { name, config, isEnabled });
    res.json({ provider });
  } catch (error) {
    logger.error('Failed to save SSO provider', { error });
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to save provider' });
    }
  }
});

// Delete provider
ssoRouter.delete('/providers/:type', validateParams(ssoProviderTypeParamsSchema), async (req, res) => {
  try {
    const type = req.params.type as SsoProviderType;
    const provider = await ssoService.getByType(type);
    if (!provider) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }
    await ssoService.delete(type);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete SSO provider', { error });
    res.status(500).json({ error: 'Failed to delete provider' });
  }
});

// Toggle provider enabled/disabled
ssoRouter.patch('/providers/:type/toggle', validateParams(ssoProviderTypeParamsSchema), validateBody(toggleSsoProviderBodySchema), async (req, res) => {
  try {
    const type = req.params.type as SsoProviderType;
    const { isEnabled } = req.body;
    
    const existingProvider = await ssoService.getByType(type);
    if (!existingProvider) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }
    
    const provider = await ssoService.toggle(type, isEnabled);
    res.json({ provider });
  } catch (error) {
    logger.error('Failed to toggle SSO provider', { error });
    res.status(500).json({ error: 'Failed to toggle provider' });
  }
});

// Test connection
ssoRouter.post('/providers/:type/test', validateParams(ssoProviderTypeParamsSchema), async (req, res) => {
  try {
    const type = req.params.type as SsoProviderType;
    
    // Use prisma directly to get unmasked secrets for testing
    const provider = await prisma.ssoProvider.findUnique({
      where: { type },
    });
    if (!provider) {
      res.status(404).json({ success: false, message: 'Provider not configured. Save configuration first.' });
      return;
    }

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
      case 'plex': {
        res.json({ success: true, message: 'Plex uses PIN-based authentication. No connection test needed.' });
        return;
      }
      case 'saml': {
        const metadataUrl = config.idpMetadataUrl || '';
        const ssoUrl = config.idpSsoUrl || '';
        const certificate = config.idpCertificate || '';

        if (metadataUrl) {
          // Test metadata URL fetch
          try {
            const response = await fetchWithTimeout(metadataUrl, { timeout: 10_000 });
            
            if (!response.ok) {
              res.json({ success: false, message: `Failed to fetch metadata: HTTP ${response.status}` });
              return;
            }
            const text = await response.text();
            if (!text.includes('EntityDescriptor')) {
              res.json({ success: false, message: 'Response does not appear to be valid SAML metadata' });
              return;
            }
            res.json({ success: true, message: 'Successfully fetched SAML metadata' });
            return;
          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
              res.json({ success: false, message: 'Timeout: Failed to fetch metadata within 10 seconds' });
              return;
            }
            res.json({ success: false, message: `Failed to fetch metadata: ${error instanceof Error ? error.message : 'Unknown error'}` });
            return;
          }
        } else {
          // Validate manual config
          if (!ssoUrl || !certificate) {
            res.json({ success: false, message: 'Manual configuration requires IdP SSO URL and certificate' });
            return;
          }
          res.json({ success: true, message: 'SAML configuration valid (manual entry)' });
          return;
        }
      }
      case 'oidc': {
        const issuerUrl = config.issuerUrl || '';
        const clientId = config.clientId || '';
        const clientSecret = config.clientSecret || '';

        if (!issuerUrl || !clientId || !clientSecret) {
          res.json({ success: false, message: 'OIDC requires issuerUrl, clientId, and clientSecret' });
          return;
        }

        const discoveryUrl = issuerUrl.endsWith('/')
          ? `${issuerUrl}.well-known/openid-configuration`
          : `${issuerUrl}/.well-known/openid-configuration`;

        try {
          const response = await fetchWithTimeout(discoveryUrl, { timeout: 10_000 });
          if (!response.ok) {
            res.json({ success: false, message: `Failed to fetch discovery document: HTTP ${response.status}` });
            return;
          }
          const doc = await response.json() as { issuer?: string; authorization_endpoint?: string; token_endpoint?: string };
          if (!doc.issuer || !doc.authorization_endpoint || !doc.token_endpoint) {
            res.json({ success: false, message: 'Discovery document missing required fields (issuer, authorization_endpoint, token_endpoint)' });
            return;
          }
          res.json({ success: true, message: `OIDC discovery successful (issuer: ${doc.issuer})` });
          return;
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            res.json({ success: false, message: 'Timeout: Failed to fetch discovery document within 10 seconds' });
            return;
          }
          res.json({ success: false, message: `Failed to fetch discovery document: ${error instanceof Error ? error.message : 'Unknown error'}` });
          return;
        }
      }
      case 'ldap': {
        const ldap = await import('ldapjs');
        const url = config.serverUrl || '';
        const bindDN = config.bindDn || '';
        const bindPassword = config.bindPassword || '';

        if (!url || !bindDN || !bindPassword) {
          res.json({ success: false, message: 'LDAP requires serverUrl, bindDn, and bindPassword' });
          return;
        }

        try {
          const client = ldap.createClient({ url, timeout: 10000 });
          
          await new Promise<void>((resolve, reject) => {
            client.bind(bindDN, bindPassword, (err: Error | null) => {
              client.unbind();
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            });
          });

          res.json({ success: true, message: 'LDAP bind successful' });
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          res.json({ success: false, message: `Invalid credentials: ${message}` });
          return;
        }
      }
      default:
        res.json({ success: true, message: `${type} connection test not yet implemented` });
    }
  } catch (error) {
    logger.error('Failed to test SSO provider', { error });
    res.status(500).json({ success: false, message: 'Connection test failed' });
  }
});
