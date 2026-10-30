export interface ConnectorConfig { relayOrigin: string; localRpcUrl: string; localCardUrl: string; displayName: string; allowHttp?: boolean }
export interface PublicationStatus { state: string; desiredEnabled: boolean; cloudSyncPending: boolean; relayOrigin?: string; error?: string; publicRpcUrl?: string; publicCardUrl?: string; publicationId?: string; instanceId?: string; localRpcUrl?: string; localCardUrl?: string }
export function assertPrivateDirectory(dir: string, roots: string[]): Promise<void>;
export function configure(dir: string, config: ConnectorConfig): Promise<PublicationStatus>;
export function ensureDaemon(dir: string): Promise<PublicationStatus>;
export function setEnabled(dir: string, enabled: boolean): Promise<PublicationStatus>;
export function status(dir: string): Promise<PublicationStatus>;
export function command(dir: string, action: string, data?: object): Promise<PublicationStatus>;
