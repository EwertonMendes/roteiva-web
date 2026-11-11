import { parseEnvironment } from './environment-config.ts';

export const appEnvironment = parseEnvironment(import.meta.env, import.meta.env.MODE);
export const API_BASE_URL = appEnvironment.apiBaseUrl;
