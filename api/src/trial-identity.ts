import {ApiError,type Env} from './types.ts';

export type TrialPrincipal={uid:string;verifiedEmail:string;googleSubject:string};

function canonicalEmail(email:string):string {
  const trimmed=email.trim().normalize('NFC');
  const at=trimmed.lastIndexOf('@');
  if(at<1||at===trimmed.length-1||trimmed.length>254||/[\r\n\t\s]/.test(trimmed))
    throw new ApiError(401,'invalid_identity');
  const local=trimmed.slice(0,at).toLowerCase();
  const domain=trimmed.slice(at+1).toLowerCase();
  // Dots and +tags are aliases ONLY on personal Gmail / Googlemail domains.
  // Workspace and other domains do not share these canonicalization rules.
  if(domain==='gmail.com'||domain==='googlemail.com'){
    const base=local.split('+',1)[0].replace(/\./g,'');
    if(!base)throw new ApiError(401,'invalid_identity');
    return base+'@gmail.com';
  }
  return local+'@'+domain;
}
async function hmacKey(env:Env):Promise<CryptoKey>{
  const secret=env.TRIAL_IDENTITY_HMAC_KEY||'';
  if(!/^[A-Za-z0-9_-]{43}$/.test(secret))throw new ApiError(503,'trial_identity_unavailable');
  let key:Uint8Array;
  try{key=Uint8Array.from(atob(secret.replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0));}
  catch{throw new ApiError(503,'trial_identity_unavailable');}
  if(key.length!==32)throw new ApiError(503,'trial_identity_unavailable');
  try{return await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);}
  catch{throw new ApiError(503,'trial_identity_unavailable');}
}
async function fingerprint(key:CryptoKey,input:string):Promise<string>{
  const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(input)));
  return 'v1_'+Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
}
/**
 * First owner wins. The claims persist when Firestore, Auth and access_accounts
 * are erased; no raw email, Google subject, or UID is retained in this ledger.
 * Returning the same verified UID is idempotent; a new UID gets NO fresh trial.
 * Authenticated endpoints never accept browser-provided email or provider IDs.
 */
export async function retainTrialIdentity(env:Env,principal:TrialPrincipal):Promise<boolean>{
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(principal.uid)||
     !principal.googleSubject||principal.googleSubject.length>300)
    throw new ApiError(401,'invalid_identity');
  const key=await hmacKey(env);
  const owner=await fingerprint(key,'uid:'+principal.uid);
  const identifiers=[
    await fingerprint(key,'email:'+canonicalEmail(principal.verifiedEmail)),
    await fingerprint(key,'google:'+principal.googleSubject),
    owner
  ];
  const verifier=await fingerprint(key,'roteiva:trial-key-verifier:v1');
  // D1 batch is one transaction. A rejected UID is permanently linked to a
  // prior owner too: failure/retry with a changed email cannot become eligible.
  // Unclaimed aliases inherit the conflicting owner, never the rejected UID.
  const now=Date.now();
  const results=await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO trial_identity_key(id,verifier) VALUES(1,?)').bind(verifier),
    ...identifiers.map(id=>env.DB.prepare(`INSERT OR IGNORE INTO trial_identity_claims(fingerprint,first_owner_tag,claimed_at)
      SELECT ?,COALESCE((SELECT first_owner_tag FROM trial_identity_claims
        WHERE fingerprint IN (?,?,?) AND first_owner_tag<>? ORDER BY fingerprint LIMIT 1),?),?
      WHERE EXISTS(SELECT 1 FROM trial_identity_key WHERE id=1 AND verifier=?)`)
      .bind(id,...identifiers,owner,owner,now,verifier)),
    env.DB.prepare('SELECT verifier FROM trial_identity_key WHERE id=1'),
    env.DB.prepare('SELECT first_owner_tag FROM trial_identity_claims WHERE fingerprint IN (?,?,?)').bind(...identifiers)
  ]);
  const saved=results[4].results as {verifier:string}[];
  if(saved[0]?.verifier!==verifier)throw new ApiError(503,'trial_identity_key_mismatch');
  const claims=results[5].results as {first_owner_tag:string}[];
  if(claims.length!==3)throw new ApiError(503,'trial_identity_unavailable');
  return claims.every(claim=>claim.first_owner_tag===owner);
}

/** Legacy in-flight deletions must pause until a signed identity is retained. */
export async function assertTrialIdentityRetained(env:Env,uid:string):Promise<void>{
  const key=await hmacKey(env);
  const owner=await fingerprint(key,'uid:'+uid);
  const verifier=await fingerprint(key,'roteiva:trial-key-verifier:v1');
  const row=await env.DB.prepare(`SELECT 1 FROM trial_identity_claims
    WHERE fingerprint=? AND EXISTS(SELECT 1 FROM trial_identity_key WHERE id=1 AND verifier=?)`)
    .bind(owner,verifier).first();
  if(!row)throw new ApiError(503,'trial_identity_retention_required');
}
