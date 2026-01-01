/**
 * SSO Provider Management Routes (Admin only)
 * 
 * Provides endpoints for managing SSO provider configurations.
 * All routes require admin authentication.
 */

import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { SsoProviderService } from '../services/sso-provider.js';
import prisma from '../lib/db.js';
import type { SsoProviderType } from '@prisma/client';

export const ssoRouter = Router();
const ssoService = new SsoProviderService(prisma);

// Valid SSO provider types
const VALID_PROVIDER_TYPES: SsoProviderType[] = ['ldap', 'saml', 'google', 'plex'];

function isValidProviderType(type: string): type is SsoProviderType {
  return VALID_PROVIDER_TYPES.includes(type as SsoProviderType);
}

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
    if (!isValidProviderType(req.params.type)) {
      res.status(400).json({ error: 'Invalid provider type' });
      return;
    }
    const type = req.params.type;
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
    if (!isValidProviderType(req.params.type)) {
      res.status(400).json({ error: 'Invalid provider type' });
      return;
    }
    const type = req.params.type;
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
    if (!isValidProviderType(req.params.type)) {
      res.status(400).json({ error: 'Invalid provider type' });
      return;
    }
    const type = req.params.type;
    const provider = await ssoService.getByType(type);
    if (!provider) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }
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
    if (!isValidProviderType(req.params.type)) {
      res.status(400).json({ error: 'Invalid provider type' });
      return;
    }
    const type = req.params.type;
    const { isEnabled } = req.body;
    
    if (typeof isEnabled !== 'boolean') {
      res.status(400).json({ error: 'isEnabled must be a boolean' });
      return;
    }
    
    const existingProvider = await ssoService.getByType(type);
    if (!existingProvider) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }
    
    const provider = await ssoService.toggle(type, isEnabled);
    res.json({ provider });
  } catch (error) {
    console.error('Failed to toggle SSO provider:', error);
    res.status(500).json({ error: 'Failed to toggle provider' });
  }
});

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
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            const response = await fetch(metadataUrl, { signal: controller.signal });
            clearTimeout(timeoutId);
            
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
          } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
              res.json({ success: false, message: 'Timeout: Failed to fetch metadata within 10 seconds' });
              return;
            }
            res.json({ success: false, message: `Failed to fetch metadata: ${err instanceof Error ? err.message : 'Unknown error'}` });
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
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          res.json({ success: false, message: `Invalid credentials: ${message}` });
          return;
        }
      }
      default:
        res.json({ success: true, message: `${type} connection test not yet implemented` });
    }
  } catch (error) {
    console.error('Failed to test SSO provider:', error);
    res.status(500).json({ success: false, message: 'Connection test failed' });
  }
});
