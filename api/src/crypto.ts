import { ApiError, type Env } from './types.ts';
const encoder = new TextEncoder();
export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
export function random(): string { return base64url(crypto.getRandomValues(new Uint8Array(32))); }
export async function hash(value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}
async function key(env: Env, version: string): Promise<CryptoKey> {
  const keys: Record<string, string> = JSON.parse(env.TOKEN_KEYS || '{}');
  if (!keys[version]) throw new ApiError(503, 'key_unavailable');
  const bytes = decode(keys[version]);
  if (bytes.byteLength !== 32) throw new ApiError(503, 'invalid_key');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export function context(env: Env, owner: string, account: string, kind = 'refresh'): string {
  return JSON.stringify(['roteiva', env.ENVIRONMENT, kind, owner, account]);
}
export async function encrypt(env: Env, plaintext: string, aad: string): Promise<string> {
  const version = env.TOKEN_KEY_VERSION;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:encoder.encode(aad)}, await key(env, version), encoder.encode(plaintext));
  return JSON.stringify({v:version, iv:base64url(iv), data:base64url(new Uint8Array(ciphertext))});
}
export async function decrypt(env: Env, envelope: string, aad: string): Promise<string> {
  const value = JSON.parse(envelope) as {v:string; iv:string; data:string};
  const plaintext = await crypto.subtle.decrypt({name:'AES-GCM', iv:decode(value.iv), additionalData:encoder.encode(aad)}, await key(env, value.v), decode(value.data));
  return new TextDecoder().decode(plaintext);
}
