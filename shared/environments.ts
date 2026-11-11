export type AppEnvironment = 'dev' | 'prod';

/** Public deployment identities. Secrets never belong in this contract. */
export const environments = {
  dev: {
    projectId: 'roteiva-web-dev',
    frontendOrigin: 'https://roteiva-web-dev.web.app',
    apiOrigin: 'https://roteiva-api-dev.roteiva-dev.workers.dev',
    workerName: 'roteiva-api-dev',
    databaseName: 'roteiva-drive-dev',
  },
  prod: {
    projectId: 'roteiva-web-prod',
    frontendOrigin: 'https://roteiva-web-prod.web.app',
    apiOrigin: 'https://roteiva-api-prod.roteiva-prod.workers.dev',
    workerName: 'roteiva-api-prod',
    databaseName: 'roteiva-drive-prod',
  },
} as const;

export function environment(value: unknown) {
  if (value !== 'dev' && value !== 'prod') throw new Error('Invalid Roteiva environment');
  return environments[value];
}

export function isFrontendOrigin(value: string): boolean {
  return Object.values(environments).some(item => item.frontendOrigin === value);
}
