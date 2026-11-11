export type AppEnvironment = 'dev' | 'prod';

/** Public deployment identities. Secrets never belong in this contract. */
export const environments = {
  dev: {
    projectId: 'roteiva-web-dev',
    authDomain: 'roteiva-web-dev.firebaseapp.com',
    frontendOrigin: 'https://roteiva-web-dev.web.app',
    frontendAliases: [],
    apiOrigin: 'https://roteiva-api-dev.roteiva-dev.workers.dev',
    workerName: 'roteiva-api-dev',
    databaseName: 'roteiva-drive-dev',
  },
  prod: {
    projectId: 'roteiva-web-prod',
    authDomain: 'roteiva.com',
    frontendOrigin: 'https://roteiva.com',
    frontendAliases: ['https://roteiva-web-prod.web.app', 'https://roteiva-web-prod.firebaseapp.com'],
    apiOrigin: 'https://api.roteiva.com',
    workerName: 'roteiva-api-prod',
    databaseName: 'roteiva-drive-prod',
  },
} as const;

export function environment(value: unknown) {
  if (value !== 'dev' && value !== 'prod') throw new Error('Invalid Roteiva environment');
  return environments[value];
}

export function isFrontendOrigin(value: string): boolean {
  return Object.values(environments).some(item => item.frontendOrigin === value ||
    (item.frontendAliases as readonly string[]).includes(value));
}

/** Exact origins within one environment; aliases never permit DEV/PROD mixing. */
export function isEnvironmentFrontend(value:string,appEnv:unknown):boolean {
  const contract=environment(appEnv);
  return value===contract.frontendOrigin||(contract.frontendAliases as readonly string[]).includes(value);
}
