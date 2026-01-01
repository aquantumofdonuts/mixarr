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

    // Provider-specific tests will be added next
    res.json({ success: true, message: `${type} connection test not yet implemented` });
  } catch (error) {
    console.error('Failed to test SSO provider:', error);
    res.status(500).json({ success: false, message: 'Connection test failed' });
  }
});
