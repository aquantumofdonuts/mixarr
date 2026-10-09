'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { api } from '@/lib/api';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import Eye from 'lucide-react/dist/esm/icons/eye';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Save from 'lucide-react/dist/esm/icons/save';
import Shield from 'lucide-react/dist/esm/icons/shield';
import Zap from 'lucide-react/dist/esm/icons/zap';

type SSOProviderType = 'ldap' | 'saml' | 'google' | 'plex' | 'oidc';

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
  advanced?: boolean;
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
    type: 'oidc',
    name: 'OIDC',
    description: 'Generic OpenID Connect',
    fields: [
      { key: 'issuerUrl', label: 'Issuer URL', type: 'text', required: true, placeholder: 'https://idp.example.com/realms/myrealm', helpText: 'Base URL of the OIDC provider (the .well-known/openid-configuration is appended automatically)' },
      { key: 'clientId', label: 'Client ID', type: 'text', required: true, placeholder: 'mixarr' },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
      { key: 'scopes', label: 'Scopes', type: 'text', placeholder: 'openid email profile', helpText: 'Space-separated list. Defaults to "openid email profile".' },
      { key: 'allowedDomains', label: 'Allowed Domains', type: 'text', placeholder: 'example.com, company.org', helpText: 'Comma-separated list. Leave empty for all.' },
      { key: 'emailAttribute', label: 'Email Claim', type: 'text', placeholder: 'email', helpText: 'Override only if your provider returns email under a non-standard claim name.', advanced: true },
      { key: 'displayNameAttribute', label: 'Display Name Claim', type: 'text', placeholder: 'name', helpText: 'Override only if your provider uses a non-standard claim for the user\'s full name.', advanced: true },
      { key: 'usernameAttribute', label: 'Username Claim', type: 'text', placeholder: 'preferred_username', helpText: 'Fallback claim used when the display name claim is missing.', advanced: true },
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
    oidc: {},
  });
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [savingProviders, setSavingProviders] = useState<Partial<Record<SSOProviderType, boolean>>>({});
  const [testingProvider, setTestingProvider] = useState<SSOProviderType | null>(null);
  const [baseUrl, setBaseUrl] = useState<string>('');
  const { addToast } = useToast();

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState(formData);
  const [enabled, setEnabled] = useState<Partial<Record<SSOProviderType, boolean>>>({});
  const [enabledBaseline, setEnabledBaseline] = useState(enabled);
  const [errors, setErrors] = useState<Partial<Record<SSOProviderType, string>>>({});
  const active = useRef(false);
  const dirtyProvider = (type: SSOProviderType) => JSON.stringify(formData[type]) !== JSON.stringify(baseline[type]) || !!enabled[type] !== !!enabledBaseline[type];
  useUnsavedChanges(providerConfigs.some(config => dirtyProvider(config.type)));
  useEffect(() => {
    active.current = true;
    let current = true;
    void Promise.all([api.get<{ providers: SSOProvider[] }>('/api/sso/providers'), api.get<{ baseUrl: string }>('/api/settings/base-url')]).then(([result, baseUrlResult]) => {
      if (!current) return;
      setLoadError(result.error);
      if (result.data) {
        setLoaded(true); setProviders(result.data.providers);
        const initial = { ldap: {}, saml: {}, google: {}, plex: {}, oidc: {} } as typeof formData;
        const initialEnabled: typeof enabled = {};
        result.data.providers.forEach(provider => { initial[provider.type] = { ...provider.config }; initialEnabled[provider.type] = provider.isEnabled; });
        setFormData(initial); setBaseline(initial); setEnabled(initialEnabled); setEnabledBaseline(initialEnabled);
      }
      if (baseUrlResult.data) setBaseUrl(baseUrlResult.data.baseUrl);
      setIsLoading(false);
    });
    return () => { current = false; active.current = false; };
  }, []);

  const getProvider = (type: SSOProviderType): SSOProvider | undefined => {
    return providers.find((p) => p.type === type);
  };

  const handleToggle = (type: SSOProviderType) => setEnabled(current => ({ ...current, [type]: !current[type] }));

  const handleSave = async (type: SSOProviderType) => {
    if (savingProviders[type] || !loaded) return;
    const config = providerConfigs.find(item => item.type === type);
    if (!config) return;
    const missing = config.fields.find(field => field.required && !formData[type][field.key]);
    if (missing) {
      setErrors(current => ({ ...current, [type]: `${missing.label} is required.` }));
      document.getElementById(`sso-${type}-${missing.key}`)?.focus(); return;
    }
    const submitted = { ...formData[type] };
    const submittedEnabled = !!enabled[type];
    setSavingProviders(current => ({ ...current, [type]: true })); setErrors(current => ({ ...current, [type]: '' }));
    const { data, error } = await api.put<{ provider?: SSOProvider }>(`/api/sso/providers/${type}`, { name: config.name, config: submitted, isEnabled: submittedEnabled });
    if (!active.current) return;
    if (error) setErrors(current => ({ ...current, [type]: error }));
    else {
      setBaseline(current => ({ ...current, [type]: submitted }));
      setEnabledBaseline(current => ({ ...current, [type]: submittedEnabled }));
      setProviders(current => [...current.filter(provider => provider.type !== type), data?.provider || { id: type, type, name: config.name, config: submitted, isEnabled: submittedEnabled }]);
      addToast({ type: 'success', title: `${config.name} settings saved` });
    }
    setSavingProviders(current => ({ ...current, [type]: false }));
  };

  const handleTest = async (type: SSOProviderType) => {
    const config = providerConfigs.find((c) => c.type === type);
    if (!config) return;

    setTestingProvider(type);
    try {
      const { data, error } = await api.post<{ success: boolean; message?: string }>(`/api/sso/providers/${type}/test`);

      if (!active.current) return;
      if (error) {
        addToast({ type: 'error', title: `${config.name} connection test failed`, message: error });
      } else if (data?.success) {
        addToast({ type: 'success', title: `${config.name} connection successful`, message: data.message });
      } else {
        addToast({ type: 'error', title: `${config.name} connection test failed`, message: data?.message || 'Unknown error' });
      }
    } catch {
      if (!active.current) return;
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
            <div className="rounded-container bg-primary/10 p-2 text-primary">
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
          <div className="rounded-container bg-primary/10 p-2 text-primary">
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
        {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
        <fieldset disabled={!loaded} className="space-y-4">
        {providerConfigs.map((config) => {
          const provider = getProvider(config.type);
          const isExpanded = expandedProvider === config.type;
          const isEnabled = !!enabled[config.type];
          const isSaved = !!provider;
          const mainFields = config.fields.filter((f) => !f.advanced);
          const advancedFields = config.fields.filter((f) => f.advanced);

          const renderField = (field: FieldConfig) => (
            <div key={field.key} className="space-y-2">
              <label htmlFor={`sso-${config.type}-${field.key}`} className="text-sm font-medium">
                {field.label}
                {field.required && <span aria-hidden="true" className="text-destructive ml-1">*</span>}
              </label>
              {field.type === 'textarea' ? (
                <textarea id={`sso-${config.type}-${field.key}`} aria-required={field.required}
                  value={formData[config.type][field.key] || ''}
                  onChange={(e) => handleFieldChange(config.type, field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full min-h-[100px] px-3 py-2 text-sm rounded-md border border-input bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                />
              ) : field.type === 'password' ? (
                <div className="relative">
                  <Input id={`sso-${config.type}-${field.key}`} aria-required={field.required}
                    type={showPasswords[`${config.type}-${field.key}`] ? 'text' : 'password'}
                    value={formData[config.type][field.key] || ''}
                    onChange={(e) => handleFieldChange(config.type, field.key, e.target.value)}
                    placeholder={field.placeholder || '••••••••'}
                    className="pr-10"
                  />
                  <button
                    type="button" aria-label={`Toggle ${field.label} visibility`}
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
                <Input id={`sso-${config.type}-${field.key}`} aria-required={field.required}
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
          );

          return (
            <section key={config.type} aria-label={`${config.name} settings`} className="rounded-container border">
              {/* Accordion Header */}
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => toggleExpanded(config.type)}
              >
                <div className="flex items-center gap-3">
                  <button type="button" aria-label={`Configure ${config.name}`} aria-expanded={isExpanded} className="flex h-11 w-11 items-center justify-center">
                    <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform duration-[140ms] ${isExpanded ? 'rotate-90' : ''}`} />
                  </button>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{config.name}</h3>
                      <Badge variant={provider?.isEnabled ? 'success' : 'secondary'}>
                        {provider?.isEnabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                      {dirtyProvider(config.type) && <span className="font-mono text-xs text-muted-foreground">Unsaved</span>}
                    </div>
                    <p className="text-sm text-muted-foreground">{config.description}</p>
                  </div>
                </div>
                <div
                  className="relative"
                  title={!isSaved ? 'Save configuration first to enable' : undefined}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Switch
                    checked={isEnabled}
                    onChange={() => handleToggle(config.type)}
                    label={`Enable ${config.name}`}
                  />
                </div>
              </div>

              {/* Accordion Content */}
              {isExpanded && (
                <div className="border-t p-4 space-y-4">
                  <p role={errors[config.type] ? "alert" : "status"} className="text-sm text-muted-foreground">{errors[config.type] || (savingProviders[config.type] ? "Saving provider settings…" : dirtyProvider(config.type) ? "Unsaved provider settings changes" : "Provider settings saved")}</p>
                  {mainFields.map(renderField)}

                  {advancedFields.length > 0 && (
                    <details className="group rounded-container border border-dashed">
                      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
                        <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
                        Advanced (Claim mappings)
                      </summary>
                      <div className="space-y-4 border-t border-dashed px-3 py-3">
                        {advancedFields.map(renderField)}
                      </div>
                    </details>
                  )}

                  {/* Google OAuth Callback URL Info */}
                  {config.type === 'google' && (
                    <div className="rounded-container bg-amber-50 dark:bg-amber-950/50 p-3 text-sm">
                      <p className="font-medium text-amber-900 dark:text-amber-100">OAuth Redirect URI</p>
                      <p className="mt-1 text-amber-800 dark:text-amber-200">
                        Add this redirect URI in your{' '}
                        <a
                          href="https://console.cloud.google.com/apis/credentials"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:no-underline"
                        >
                          Google Cloud Console
                        </a>:
                      </p>
                      <code className="mt-2 block rounded bg-amber-100 dark:bg-amber-900/50 px-2 py-1 font-mono text-xs text-amber-900 dark:text-amber-100 break-all">
                        {baseUrl ? `${baseUrl}/api/auth/sso/google/callback` : 'Configure Base URL in Global Settings first'}
                      </code>
                    </div>
                  )}

                  {/* SAML Callback URL Info */}
                  {config.type === 'saml' && (
                    <div className="rounded-container bg-amber-50 dark:bg-amber-950/50 p-3 text-sm">
                      <p className="font-medium text-amber-900 dark:text-amber-100">SAML Assertion Consumer Service URL</p>
                      <p className="mt-1 text-amber-800 dark:text-amber-200">
                        Configure this ACS URL in your Identity Provider:
                      </p>
                      <code className="mt-2 block rounded bg-amber-100 dark:bg-amber-900/50 px-2 py-1 font-mono text-xs text-amber-900 dark:text-amber-100 break-all">
                        {baseUrl ? `${baseUrl}/api/auth/sso/saml/callback` : 'Configure Base URL in Global Settings first'}
                      </code>
                    </div>
                  )}

                  {/* OIDC Callback URL Info */}
                  {config.type === 'oidc' && (
                    <div className="rounded-container bg-amber-50 dark:bg-amber-950/50 p-3 text-sm">
                      <p className="font-medium text-amber-900 dark:text-amber-100">OIDC Redirect URI</p>
                      <p className="mt-1 text-amber-800 dark:text-amber-200">
                        Register this redirect URI with your OpenID Connect provider:
                      </p>
                      <code className="mt-2 block rounded bg-amber-100 dark:bg-amber-900/50 px-2 py-1 font-mono text-xs text-amber-900 dark:text-amber-100 break-all">
                        {baseUrl ? `${baseUrl}/api/auth/sso/oidc/callback` : 'Configure Base URL in Global Settings first'}
                      </code>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-2 pt-2">
                    <Button
                      onClick={() => handleSave(config.type)}
                      disabled={savingProviders[config.type] || !dirtyProvider(config.type)}
                      size="sm"
                    >
                      {savingProviders[config.type] ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      {savingProviders[config.type] ? 'Saving...' : `Save ${config.name} settings`}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleTest(config.type)}
                      disabled={testingProvider === config.type || !isSaved}
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
            </section>
          );
        })}

        {/* Info Box */}
        <div className="rounded-container bg-status-info/10 p-4 text-sm">
          <p className="font-medium text-status-info">About Single Sign-On</p>
          <p className="mt-1 text-status-info">
            SSO allows users to authenticate using external identity providers. Enable a provider and configure its settings to allow users to sign in with their existing credentials.
          </p>
        </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}
