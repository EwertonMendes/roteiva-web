export interface Env {
  DB: D1Database;
  API_RATE_LIMIT: RateLimit;
  API_THUMB_LIMIT: RateLimit;
  ENVIRONMENT: string;
  FIREBASE_PROJECT_ID: string;
  FRONTEND_ORIGIN: string;
  OAUTH_REDIRECT_URI: string;
  OAUTH_ENABLED: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_PICKER_API_KEY?: string;
  TOKEN_KEYS?: string;
  TOKEN_KEY_VERSION: string;
  ACCOUNT_DELETION_ENABLED?: string;
  TRIAL_IDENTITY_HMAC_KEY?: string;
  ACCESS_PROVISION_ON_DRIVE?: string;
  FIREBASE_ADMIN_CREDENTIALS_JSON?: string;
}
export class ApiError extends Error {
  status: number;
  code: string;
  // Safe, owner-scoped diagnostic added only after a selected review asset fails.
  asset?: { fileId: string; fileName?: string };
  constructor(status: number, code: string, asset?: { fileId: string; fileName?: string }) {
    super(code); this.status=status; this.code=code; this.asset=asset;
  }
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
