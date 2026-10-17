export interface Env {
  DB: D1Database;
  API_RATE_LIMIT: RateLimit;
  ENVIRONMENT: string;
  FIREBASE_PROJECT_ID: string;
  FRONTEND_ORIGIN: string;
  OAUTH_REDIRECT_URI: string;
  OAUTH_ENABLED: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  TOKEN_KEYS?: string;
  TOKEN_KEY_VERSION: string;
}
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) { super(code); this.status=status; this.code=code; }
}
export interface Connection {
  id: string;
  owner_uid: string;
  google_account_id: string;
  google_email: string;
  encrypted_refresh_token: string | null;
  status: 'connected' | 'reconnect_required' | 'revocation_pending';
  scopes: string;
  revision: number;
}
