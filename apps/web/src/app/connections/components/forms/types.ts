export interface ConnectionFormProps {
  /** Pre-filled config values when editing an existing connection */
  initialConfig?: Record<string, any>;
  /** Set when editing — used for redirect URI display in OAuth forms */
  connectionId?: number;
  /** Base URL for OAuth redirect URI display */
  baseUrl: string;
  /** Called whenever the form is valid with the current config */
  onConfigReady: (config: Record<string, any>) => void;
  /** Called when required fields are empty / form becomes invalid */
  onConfigInvalid: () => void;
}
