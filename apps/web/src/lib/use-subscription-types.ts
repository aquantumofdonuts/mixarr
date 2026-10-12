/**
 * Subscription Types Hook
 * 
 * Fetches subscription type metadata from the API.
 * Maps icon names from API to Lucide React components.
 */

import { useState, useEffect } from 'react';
import Brain from 'lucide-react/dist/esm/icons/brain';
import Compass from 'lucide-react/dist/esm/icons/compass';
import Disc from 'lucide-react/dist/esm/icons/disc';
import GitFork from 'lucide-react/dist/esm/icons/git-fork';
import Globe from 'lucide-react/dist/esm/icons/globe';
import Headphones from 'lucide-react/dist/esm/icons/headphones';
import Music2 from 'lucide-react/dist/esm/icons/music-2';
import Radio from 'lucide-react/dist/esm/icons/radio';
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag';
import Shuffle from 'lucide-react/dist/esm/icons/shuffle';
import Tag from 'lucide-react/dist/esm/icons/tag';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up';
import type { LucideIcon } from 'lucide-react';
import { api } from './api';

/**
 * API response type for subscription type metadata
 */
export interface SubscriptionTypeApiResponse {
  value: string;
  label: string;
  icon: string;
  description: string;
  warning?: string;
  requiredFields?: Array<{
    field: string;
    label: string;
  }>;
}

/**
 * Subscription type with resolved icon component
 */
export interface SubscriptionTypeConfig {
  value: string;
  label: string;
  icon: LucideIcon;
  description: string;
  warning?: string;
  requiredFields?: Array<{
    field: string;
    label: string;
  }>;
}

/**
 * Map icon names from API to Lucide React components
 */
const ICON_MAP: Record<string, LucideIcon> = {
  Brain,
  Compass,
  Disc,
  GitFork,
  Globe,
  Headphones,
  Music2,
  Radio,
  ShoppingBag,
  Shuffle,
  Tag,
  TrendingUp,
};

/**
 * Convert API response to component-ready format
 */
function mapApiTypeToConfig(apiType: SubscriptionTypeApiResponse): SubscriptionTypeConfig {
  return {
    ...apiType,
    icon: ICON_MAP[apiType.icon] || Music2, // Fallback to Music2 if icon not found
  };
}

/**
 * Hook to fetch subscription types from API
 * Returns loading state, error, and type data
 */
export function useSubscriptionTypes() {
  const [types, setTypes] = useState<SubscriptionTypeConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTypes() {
      setLoading(true);
      const { data, error: apiError } = await api.get<SubscriptionTypeApiResponse[]>('/api/subscriptions/types');
      
      if (apiError) {
        setError(apiError);
        setLoading(false);
        return;
      }
      
      if (data) {
        setTypes(data.map(mapApiTypeToConfig));
      }
      setLoading(false);
    }
    
    fetchTypes();
  }, []);

  return { types, loading, error };
}

/**
 * Get a specific type by value from a list of types
 */
export function getSubscriptionType(types: SubscriptionTypeConfig[], value: string): SubscriptionTypeConfig | undefined {
  return types.find(t => t.value === value);
}

/**
 * Get required fields for a subscription type
 */
export function getRequiredFieldsForType(types: SubscriptionTypeConfig[], value: string): Array<{ field: string; label: string }> {
  return getSubscriptionType(types, value)?.requiredFields ?? [];
}
