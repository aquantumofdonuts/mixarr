/**
 * SSO Provider Service
 * 
 * Manages SSO provider configurations with secret masking for API responses.
 */

import type { PrismaClient, SsoProvider, SsoProviderType, Prisma } from '@prisma/client';
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
    
    return providers.map((p: SsoProvider) => this.maskSecrets(p));
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
    const encryptedConfig = input.config as Prisma.InputJsonValue;
    
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
    // Handle null, undefined, or non-object config
    if (!provider.config || typeof provider.config !== 'object' || Array.isArray(provider.config)) {
      return provider;
    }
    
    const config = provider.config as Record<string, unknown>;
    const masked: Record<string, string | unknown> = {};
    
    for (const [key, value] of Object.entries(config)) {
      if (SECRET_FIELDS.includes(key) && typeof value === 'string') {
        masked[key] = '********';
      } else {
        masked[key] = value;
      }
    }
    
    return { ...provider, config: masked as Prisma.JsonValue };
  }
}
