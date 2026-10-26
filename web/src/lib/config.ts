export interface AppConfig {
  apiUrl: string;
  region: string;
  userPoolId: string;
  userPoolClientId: string;
  stage: string;
  /** Set by the local dev server (npm run local): sign in with any seeded email, no Cognito. */
  localAuth?: boolean;
}

let config: AppConfig | undefined;

/** config.json is written by the CDK deployment next to index.html (and by deploy.sh for local dev). */
export async function loadConfig(): Promise<AppConfig> {
  if (config) return config;
  const res = await fetch('/config.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('config.json not found. Deploy the stack first (./deploy.sh).');
  config = (await res.json()) as AppConfig;
  return config;
}

export function getConfig(): AppConfig {
  if (!config) throw new Error('Config not loaded');
  return config;
}
