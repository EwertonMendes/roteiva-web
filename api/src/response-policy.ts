import {isFrontendOrigin} from '../../shared/environments.ts';
/** Final response policy: JSON/errors stay unembeddable; only successful PDF
 * streams from the two ticket-authorized media routes may be framed by the app. */
export function applyResponsePolicy(response:Response,path:string,frontendOrigin:string):Response{
  const result=new Response(response.body,response);
  const pdf=response.ok&&response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()==='application/pdf';
  const media=path==='/reviews/media'||path==='/integrations/dropbox/media';
  const permittedOrigin=isFrontendOrigin(frontendOrigin);
  const ancestors=pdf&&media&&permittedOrigin?frontendOrigin:"'none'";
  result.headers.set('Cache-Control','no-store');
  result.headers.set('Referrer-Policy','no-referrer');
  result.headers.set('X-Content-Type-Options','nosniff');
  // Preserve route restrictions (e.g. SVG sandbox), replacing only ancestors.
  const directives=(response.headers.get('Content-Security-Policy')||"default-src 'none'")
    .split(';').map(value=>value.trim()).filter(value=>value&&!/^frame-ancestors(?:\s|$)/i.test(value));
  directives.push('frame-ancestors '+ancestors);
  result.headers.set('Content-Security-Policy',directives.join('; '));
  return result;
}
