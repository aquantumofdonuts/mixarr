'use client';

import { useState, useEffect } from 'react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Badge, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { Shield, ChevronDown, ChevronRight, Loader2, Eye, EyeOff, Save, Zap } from 'lucide-react';

type SSOProviderType = 'ldap' | 'saml' | 'google' | 'plex';

interface SSOProvider {
  id: string;
  type: SSOProviderType;
  name: string;
  isEnabled: boolean;
  config: Record<string, string>;
}

interface ProviderConfig {
  type: SSOProviderType;
  name: string;
  description: string;
  fields: FieldConfig[];
}

interface FieldConfig {
  key: string;
  label: string;
  type: 'text' | 'password' | 'textarea';
  required?: boolean;
  helpText?: string;
  placeholder?: string;
}

const providerConfigs: ProviderConfig[] = [
  {
    type: 'ldap',
    name: 'LDAP',
    description: 'Connect to LDAP/Active Directory for user authentication',
    fields: [
      { key: 'serverUrl', label: 'Server URL', type: 'text', required: true, placeholder: 'ldap://ldap.example.com:389' },
      { key: 'bindDn', label: 'Bind DN', type: 'text', required: true, placeholder: 'cn=admin,dc=example,dc=com' },
      { key: 'bindPassword', label: 'Bind Password', type: 'password', required: true },
      { key: 'searchBaseDn', label: 'Search Base DN', type: 'text', required: true, placeholder: 'ou=users,dc=example,dc=com' },
      { key: 'searchFilter', label: 'Search Filter', type: 'text', placeholder: '(uid={{username}})' },
      { key: 'emailAttribute', label: 'Email Attribute', type: 'text', required: true, placeholder: 'mail' },
      { key: 'displayNameAttribute', label: 'Display Name Attribute', type: 'text', placeholder: 'cn' },
    ],
  },
  {
    type: 'saml',
    name: 'SAML',
    description: 'Single Sign-On using SAML 2.0 identity providers',
    fields: [
      { key: 'idpMetadataUrl', label: 'IdP Metadata URL', type: 'text', placeholder: 'https://idp.example.com/metadata', helpText: 'OR enter IdP SSO URL and certificate manually' },
      { key: 'idpSsoUrl', label: 'IdP SSO URL', type: 'text', placeholder: 'https://idp.example.com/sso' },
      { key: 'idpCertificate', label: 'IdP Certificate', type: 'textarea', placeholder: '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----' },
      { key: 'emailAttribute', label: 'Email Attribute', type: 'text', placeholder: 'email' },
      { key: 'displayNameAttribute', label: 'Display Name Attribute', type: 'text', placeholder: 'displayName' },
    ],
  },
  {
    type: 'google',
    name: 'Google',
    description: 'Allow users to sign in with their Google accounts',
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text', required: true, placeholder: 'your-client-id.apps.googleusercontent.com' },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
      { key: 'allowedDomains', label: 'Allowed Domains', type: 'text', placeholder: 'example.com, company.org', helpText: 'Comma-separated list. Leave empty for all.' },
    ],
  },
  {
    type: 'plex',
    name: 'Plex',
    description: 'Allow users to sign in with their Plex accounts',
    fields: [
      { key: 'restrictToServerId', label: 'Restrict to Server ID', type: 'text', placeholder: 'abc123...', helpText: 'Only allow users with access to this Plex server' },
    ],
  },
];

export function SSOSettings() {
  const [providers, setProviders] = useState<SSOProvider[]>([]);
  const [expandedProvider, setExpandedProvider] = useState<SSOProviderType | null>(null);
  const [formData, setFormData] = useState<Record<SSOProviderType, Record<string, string>>>({
    ldap: {},
    saml: {},
    google: {},
    plex: {},
  });
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [savingProvider, setSavingProvider] = useState<SSOProviderType | null>(null);
  const [testingProvider, setTestingProvider] = useState<SSOProviderType | null>(null);
  const { addToast } = useToast();

  const fetchProviders = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await api.get<{ providers: SSOProvider[] }>('/api/sso/providers');
      if (error) {
        addToast({ type: 'error', title: 'Failed to load SSO providers', message: error });
      } else if (data) {
        setProviders(data.providers);
        // Initialize form data from fetched providers
        const newFormData = { ...formData };
        data.providers.forEach((provider) => {
          newFormData[provider.type] = { ...provider.config };
        });
        setFormData(newFormData);
      }
    } catch {
      addToast({ type: 'error', title: 'Failed to load SSO providers' });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchProviders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getProvider = (type: SSOProviderType): SSOProvider | undefined => {
    return providers.find((p) => p.type === type);
  };

  const handleToggle = async (type: SSOProviderType) => {
    const provider = getProvider(type);
    const newEnabled = !provider?.isEnabled;

    try {
      const { error } = await api.patch(`/api/sso/providers/${type}/toggle`, { isEnabled: newEnabled });
      if (error) {
        addToast({ type: 'error', title: `Failed to ${newEnabled ? 'enable' : 'disable'} ${type.toUpperCase()}`, message: error });
      } else {
        addToast({ type: 'success', title: `${type.toUpperCase()} ${newEnabled ? 'enabled' : 'disabled'}` });
        fetchProviders();
      }
    } catch {
      addToast({ type: 'error', title: `Failed to toggle ${type.toUpperCase()}` });
    }
  };

  const handleSave = async (type: SSOProviderType) => {
    const config = providerConfigs.find((c) => c.type === type);
    if (!config) return;

    // Validate required fields
    const missingFields = config.fields
      .filter((f) => f.required && !formData[type][f.key])
      .map((f) => f.label);

    if (missingFields.length > 0) {
      addToast({
        type: 'error',
        title: 'Missing required fields',
        message: missingFields.join(', '),
      });
      return;
    }

    setSavingProvider(type);
    try {
      const { error } = await api.put(`/api/sso/providers/${type}`, {
        name: config.name,
        config: formData[type],
      });

      if (error) {
        addToast({ type: 'error', title: `Failed to save ${config.name} settings`, message: error });
      } else {
        addToast({ type: 'success', title: `${config.name} settings saved` });
        fetchProviders();
      }
    } catch {
      addToast({ type: 'error', title: `Failed to save ${config.name} settings` });
    }
    setSavingProvider(null);
  };

  const handleTest = async (type: SSOProviderType) => {
    const config = providerConfigs.find((c) => c.type === type);
    if (!config) return;

    setTestingProvider(type);
    try {
      const { data, error } = await api.post<{ success: boolean; message?: string }>(`/api/sso/providers/${type}/test`);

      if (error) {
        addToast({ type: 'error', title: `${config.name} connection test failed`, message: error });
      } else if (data?.success) {
        addToast({ type: 'success', title: `${config.name} connection successful`, message: data.message });
      } else {
        addToast({ type: 'error', title: `${config.name} connection test failed`, message: data?.message || 'Unknown error' });
      }
    } catch {
      addToast({ type: 'error', title: `Failed to test ${config.name} connection` });
    }
    setTestingProvider(null);
  };

  const handleFieldChange = (type: SSOProviderType, key: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [type]: {
        ...prev[type],
        [key]: value,
      },
    }));
  };

  const togglePasswordVisibility = (fieldKey: string) => {
    setShowPasswords((prev) => ({
      ...prev,
      [fieldKey]: !prev[fieldKey],
    }));
  };

  const toggleExpanded = (type: SSOProviderType) => {
    setExpandedProvider((prev) => (prev === type ? null : type));
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-lg">Single Sign-On (SSO)</CardTitle>
              <CardDescription>Loading...</CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-lg">Single Sign-On (SSO)</CardTitle>
            <CardDescription>
              Configure external identity providers for user authentication
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {providerConfigs.map((config) => {
          const provider = getProvider(config.type);
          const isExpanded = expandedProvider === config.type;
          const isEnabled = provider?.isEnabled ?? false;

          return (
            <div key={config.type} className="rounded-lg border">
              {/* Accordion Header */}
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => toggleExpanded(config.type)}
              >
                <div className="flex items-center gap-3">
                  <button className="p-0.5">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{config.name}</h3>
                      <Badge variant={isEnabled ? 'success' : 'secondary'}>
                        {isEnabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{config.description}</p>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggle(config.type);
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    isEnabled ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      isEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Accordion Content */}
              {isExpanded && (
                <div className="border-t p-4 space-y-4">
                  {config.fields.map((field) => (
                    <div key={field.key} className="space-y-2">
                      <label className="text-sm font-medium">
                        {field.label}
                        {field.required && <span className="text-destructive ml-1">*</span>}
                      </label>
                      {field.type === 'textarea' ? (
                        <textarea
                          value={formData[config.type][field.key] || ''}
                          onChange={(e) => handleFieldChange(config.type, field.key, e.target.value)}
                          placeholder={field.placeholder}
                          className="w-full min-h-[100px] px-3 py-2 text-sm rounded-md border border-input bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                        />
                      ) : field.type === 'password' ? (
                        <div className="relative">
                          <Input
                            type={showPasswords[`${config.type}-${field.key}`] ? 'text' : 'password'}
                            value={formData[config.type][field.key] || ''}
                            onChange={(e) => handleFieldChange(config.type, field.key, e.target.value)}
                            placeholder={field.placeholder || '••••••••'}
                            className="pr-10"
                          />
                          <button
                            type="button"
                            onClick={() => togglePasswordVisibility(`${config.type}-${field.key}`)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          >
                            {showPasswords[`${config.type}-${field.key}`] ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      ) : (
                        <Input
                          type="text"
                          value={formData[config.type][field.key] || ''}
                          onChange={(e) => handleFieldChange(config.type, field.key, e.target.value)}
                          placeholder={field.placeholder}
                        />
                      )}
                      {field.helpText && (
                        <p className="text-xs text-muted-foreground">{field.helpText}</p>
                      )}
                    </div>
                  ))}

                  {/* Action Buttons */}
                  <div className="flex gap-2 pt-2">
                    <Button
                      onClick={() => handleSave(config.type)}
                      disabled={savingProvider === config.type}
                      size="sm"
                    >
                      {savingProvider === config.type ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      {savingProvider === config.type ? 'Saving...' : 'Save'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleTest(config.type)}
                      disabled={testingProvider === config.type || !isEnabled}
                      size="sm"
                    >
                      {testingProvider === config.type ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Zap className="h-4 w-4 mr-2" />
                      )}
                      {testingProvider === config.type ? 'Testing...' : 'Test Connection'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Info Box */}
        <div className="rounded-lg bg-blue-50 dark:bg-blue-950/50 p-4 text-sm">
          <p className="font-medium text-blue-900 dark:text-blue-100">About Single Sign-On</p>
          <p className="mt-1 text-blue-800 dark:text-blue-200">
            SSO allows users to authenticate using external identity providers. Enable a provider and configure its settings to allow users to sign in with their existing credentials.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
