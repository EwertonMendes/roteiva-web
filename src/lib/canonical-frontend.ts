import {environment,legacyProdFrontendOrigin} from '../../shared/environments.ts';

/** A deployment setting selects the environment. Hostnames only select whether
 * an explicitly supported old PROD URL needs to move to its canonical origin. */
export function canonicalFrontendUrl(href:string,appEnv:unknown):string|null {
  if(appEnv!=='prod')return null;
  const contract=environment('prod'),current=new URL(href);
  if(current.origin!==legacyProdFrontendOrigin&&!(contract.frontendAliases as readonly string[]).includes(current.origin))return null;
  if(current.pathname.startsWith('/__/'))return null;
  const target=new URL(contract.frontendOrigin);
  target.pathname=current.pathname;target.search=current.search;target.hash=current.hash;
  return target.href;
}
