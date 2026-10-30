import type {Env} from './types.ts';

// These thresholds match the account-deletion runbook. This routine is read-only
// and must never resolve ambiguous OAuth grants or advance a deletion.
const STALLED_AFTER_MS=2*60*60*1000;
const OAUTH_RECONCILIATION_AFTER_MS=15*60*1000;

export async function monitorDeletionBacklog(env:Env,now=Date.now()):Promise<void>{
  // Single aggregate query, without UIDs, email addresses, tokens or other PII.
  // Parameterized cutoffs avoid clock assumptions inside D1.
  const counts=await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM account_deletions WHERE phase='manual_review') AS manual_review,
      (SELECT COUNT(*) FROM account_deletions
        WHERE phase NOT IN ('completed','manual_review') AND updated_at<?1) AS stalled,
      (SELECT COUNT(*) FROM oauth_exchange_guards
        WHERE started_at<?2 AND encrypted_token IS NULL) AS oauth_without_token,
      (SELECT COUNT(*) FROM oauth_exchange_guards
        WHERE started_at<?2 AND encrypted_token IS NOT NULL) AS oauth_with_token
  `).bind(now-STALLED_AFTER_MS,now-OAUTH_RECONCILIATION_AFTER_MS)
    .first<{manual_review:number;stalled:number;oauth_without_token:number;oauth_with_token:number}>();
  if(!counts)throw new Error('security_backlog_query_empty');
  const manualReview=Number(counts.manual_review);
  const stalled=Number(counts.stalled);
  const withoutToken=Number(counts.oauth_without_token);
  const withToken=Number(counts.oauth_with_token);
  if([manualReview,stalled,withoutToken,withToken].some(n=>!Number.isSafeInteger(n)||n<0))
    throw new Error('security_backlog_invalid_counts');
  if(manualReview>0)
    console.error(JSON.stringify({event:'account_deletion_manual_review_pending',count:manualReview}));
  if(stalled>0)
    console.error(JSON.stringify({event:'account_deletion_stalled',count:stalled}));
  if(withoutToken+withToken>0)
    console.error(JSON.stringify({event:'oauth_exchange_reconciliation_required',
      count:withoutToken+withToken,withoutToken,withToken}));
}
