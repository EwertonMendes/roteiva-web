type FeedbackEmailAttachment={content:Uint8Array;filename:string;type:string;disposition:'attachment'};

export interface Env {
  DB: D1Database;
  API_RATE_LIMIT: RateLimit;
  API_THUMB_LIMIT: RateLimit;
  API_UPLOAD_LIMIT: RateLimit;
  RESEND_API_KEY?: string;
  /** Optional billing integration: absent means no checkout and no financial effect. */
  BILLING_ENABLED?: string;
  BILLING_CHECKOUT_ENABLED?: string;
  /** A separate opt-in flag, independent of existing recurring card billing. */
  BILLING_PIX_ENABLED?: string;
  BILLING_CHECKOUT_TEST_UID?: string;
  BILLING_CHECKOUT_TEST_UIDS?: string;
  ASAAS_API_KEY?: string;
  ASAAS_WEBHOOK_TOKEN?: string;
  FEEDBACK_EMAIL?: {send(message:{to:string;from:string;subject:string;text:string;html?:string;replyTo?:string;
    attachments:FeedbackEmailAttachment[]}):Promise<{messageId:string}>;};
  RESEND_FROM_EMAIL?: string;
  ENVIRONMENT: string;
  FIREBASE_PROJECT_ID: string;
  FRONTEND_ORIGIN: string;
  LEGACY_FRONTEND_UNTIL?: string;
  OAUTH_REDIRECT_URI: string;
  OAUTH_ENABLED: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_PICKER_API_KEY?: string;
  DROPBOX_ENABLED?: string;
  VIRTUAL_LIBRARY_ENABLED?: string;
  STREAM_PREVIEW_ENABLED?: string;
  STREAM?: {
    upload(input:string,params?:{requireSignedURLs?:boolean;allowedOrigins?:string[];meta?:Record<string,string>}):Promise<{id:string;readyToStream:boolean;status?:{state:string};preview?:string;hlsPlaybackUrl?:string}>;
    video(id:string):{
      details():Promise<{id:string;readyToStream:boolean;status?:{state:string};preview?:string;hlsPlaybackUrl?:string}>;
      generateToken():Promise<string>;
      delete():Promise<void>;
    };
  };
  DROPBOX_APP_KEY?: string;
  DROPBOX_APP_SECRET?: string;
  DROPBOX_OAUTH_REDIRECT_URI?: string;
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
