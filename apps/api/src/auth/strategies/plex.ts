/**
 * Plex Authentication
 * 
 * Implements Plex's PIN-based OAuth flow.
 * Users must be pre-provisioned with matching email addresses.
 */

import type { PrismaClient } from '@prisma/client';

export interface PlexConfig {
  restrictToServerId?: string;
  callbackUrl: string;
}

interface PlexPin {
  id: number;
  code: string;
}

interface PlexUser {
  id: number;
  uuid: string;
  email: string;
  username: string;
  title: string;
  thumb: string;
}

const PLEX_APP_NAME = 'Mixarr';
const PLEX_CLIENT_ID = 'mixarr-music-discovery';

export class PlexAuthService {
  constructor(
    private config: PlexConfig,
    private prisma: PrismaClient
  ) {}

  /**
   * Create a Plex PIN and return the auth URL
   */
  async createAuthUrl(): Promise<{ pinId: number; authUrl: string }> {
    const response = await fetch('https://plex.tv/api/v2/pins', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Plex-Product': PLEX_APP_NAME,
        'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
      },
      body: JSON.stringify({ strong: true }),
    });

    if (!response.ok) {
      throw new Error('Failed to create Plex PIN');
    }

    const pin = await response.json() as PlexPin;
    
    const authUrl = `https://app.plex.tv/auth#?` +
      `clientID=${PLEX_CLIENT_ID}&` +
      `code=${pin.code}&` +
      `forwardUrl=${encodeURIComponent(this.config.callbackUrl)}&` +
      `context%5Bdevice%5D%5Bproduct%5D=${PLEX_APP_NAME}`;

    return { pinId: pin.id, authUrl };
  }

  /**
   * Exchange a PIN for an auth token and user info
   */
  async handleCallback(pinId: number): Promise<{ user: PlexUser; authToken: string } | null> {
    // Poll for the auth token
    const response = await fetch(`https://plex.tv/api/v2/pins/${pinId}`, {
      headers: {
        'Accept': 'application/json',
        'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
      },
    });

    if (!response.ok) {
      return null;
    }

    const pin = await response.json() as { authToken?: string };
    
    if (!pin.authToken) {
      return null;
    }

    // Get user info
    const userResponse = await fetch('https://plex.tv/api/v2/user', {
      headers: {
        'Accept': 'application/json',
        'X-Plex-Token': pin.authToken,
        'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
      },
    });

    if (!userResponse.ok) {
      return null;
    }

    const plexUser = await userResponse.json() as PlexUser;
    return { user: plexUser, authToken: pin.authToken };
  }

  /**
   * Authenticate user after Plex callback
   */
  async authenticateUser(plexUser: PlexUser): Promise<{
    success: boolean;
    user?: { id: number; username: string; displayName: string; role: string };
    error?: string;
  }> {
    // Find user by email (MySQL is case-insensitive by default for VARCHAR)
    const user = await this.prisma.user.findFirst({
      where: { email: plexUser.email.toLowerCase() },
    });

    if (!user) {
      return { success: false, error: `No account found for email: ${plexUser.email}. Contact your administrator.` };
    }

    if (!user.isActive) {
      return { success: false, error: 'Your account has been disabled.' };
    }

    // Link or update identity
    await this.prisma.authIdentity.upsert({
      where: {
        provider_providerUserId: {
          provider: 'plex',
          providerUserId: String(plexUser.id),
        },
      },
      create: {
        userId: user.id,
        provider: 'plex',
        providerUserId: String(plexUser.id),
        email: plexUser.email,
        metadata: {
          username: plexUser.username,
          title: plexUser.title,
          thumb: plexUser.thumb,
          uuid: plexUser.uuid,
        },
      },
      update: {
        lastUsedAt: new Date(),
        metadata: {
          username: plexUser.username,
          title: plexUser.title,
          thumb: plexUser.thumb,
          uuid: plexUser.uuid,
        },
      },
    });

    // Update user's last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      },
    };
  }
}
