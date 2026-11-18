// Shared, self-contained HTML + plain text. No external assets, tracking pixels or CSS imports.
export type FeedbackEmailContent={
  id:string;
  email:string;
  kindLabel:string;
  title:string;
  description:string;
  attachmentCount:number;
};
export type FeedbackEmailBody={
  subject:string;
  text:string;
  html:string;
  replyTo?:string;
};
const escapeHtml=(value:string):string=>value.replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[char]||char);
const verifiedReplyTo=(email:string):string|undefined=>
  /^[^\s<>@\r\n]{1,64}@[^\s<>@\r\n]{1,253}$/.test(email)?email:undefined;
function infoRow(label:string,value:string):string{
  return '<tr><td style="padding:11px 0 2px;color:#777f73;font-family:Arial,sans-serif;font-size:12px;line-height:18px;">'+
    escapeHtml(label)+'</td></tr>'+
    '<tr><td style="padding:0 0 12px;color:#1c221a;font-family:Arial,sans-serif;font-size:15px;font-weight:600;line-height:22px;overflow-wrap:anywhere;">'+
    escapeHtml(value)+'</td></tr>';
}
export function composeFeedbackEmail(environment:string,mail:FeedbackEmailContent):FeedbackEmailBody{
  const env=environment==='prod'?'PROD':'DEV';
  const id=mail.id;
  const title=mail.title;
  const description=mail.description;
  const kind=mail.kindLabel;
  const count=mail.attachmentCount;
  const attachmentLabel=count===0?'Nenhuma imagem':count===1?'1 imagem':' '+count+' imagens';
  const replyTo=verifiedReplyTo(mail.email);
  const subject='[Roteiva '+env+'] '+kind+' #'+id.slice(0,8);
  const text=[
    'ROTEIVA | NOVO FEEDBACK ('+env+')',
    'Protocolo: '+id,
    'Categoria: '+kind,
    'Assunto: '+title,
    'E-mail do usuário: '+mail.email,
    'Imagens anexadas: '+(count===0?'Nenhuma':String(count)),
    '',
    'Descrição:',
    description,
    '',
    'Mensagem enviada pelo formulário de feedback do Roteiva.'
  ].join('\n');
  const safeDescription=escapeHtml(description).replace(/\r\n?|\n/g,'<br>');
  const html=[
    '<!doctype html><html lang="pt-BR"><head>',
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Novo feedback do Roteiva</title></head>',
    '<body style="margin:0;padding:0;background:#eff1ed;color:#20251e;font-family:Arial,Helvetica,sans-serif;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eff1ed;border-collapse:collapse;">',
    '<tr><td align="center" style="padding:32px 12px;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;border-collapse:separate;border-spacing:0;background:#ffffff;border:1px solid #e1e5dc;border-radius:16px;">',
    '<tr><td style="background:#141813;border-radius:15px 15px 0 0;padding:28px 32px 27px;border-top:4px solid #bcf345;">',
    '<div style="font-size:27px;line-height:32px;color:#ffffff;font-weight:800;letter-spacing:-1px;">Roteiva<span style="color:#c6fb57;">.</span></div>',
    '<div style="padding-top:18px;color:#b8c0b3;font-size:12px;font-weight:700;letter-spacing:1.4px;">CENTRAL DE FEEDBACK</div>',
    '<div style="padding-top:6px;font-size:25px;font-weight:700;line-height:31px;color:#ffffff;">Novo feedback recebido</div>',
    '<div style="padding-top:15px;">',
    '<span style="display:inline-block;border-radius:6px;padding:6px 10px;background:#31441c;color:#d8ffa0;font-size:12px;font-weight:700;">'+escapeHtml(kind)+'</span>',
    '<span style="display:inline-block;padding:6px 10px;color:#c8d0c2;font-size:12px;font-weight:700;">'+env+'</span>',
    '</div></td></tr>',
    '<tr><td style="padding:26px 32px 12px;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">',
    infoRow('Assunto',title),
    infoRow('E-mail do usuário',mail.email),
    infoRow('Imagens anexadas',attachmentLabel.trim()),
    '</table>',
    '<div style="margin:10px 0 12px;font-size:12px;font-weight:700;letter-spacing:1px;color:#69735f;">DESCRIÇÃO</div>',
    '<div style="background:#f6f8f2;border:1px solid #e7ebdf;border-left:4px solid #acd947;border-radius:8px;padding:18px 20px;',
    'color:#242b21;font-size:15px;line-height:25px;overflow-wrap:anywhere;word-wrap:break-word;">',
    safeDescription,'</div>',
    '</td></tr>',
    '<tr><td style="padding:18px 32px 28px;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid #e7ebdf;">',
    '<tr><td style="padding-top:17px;color:#778172;font-size:12px;line-height:19px;">Protocolo</td></tr>',
    '<tr><td style="color:#3c4538;font-size:13px;font-weight:700;line-height:19px;overflow-wrap:anywhere;">'+escapeHtml(id)+'</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
    '<div style="max-width:600px;margin:16px auto 0;color:#7b8577;font-size:12px;line-height:18px;text-align:center;">',
    'Enviado pelo formulário interno do Roteiva. Responda ao e-mail do usuário para entrar em contato.</div>',
    '</td></tr></table></body></html>'
  ].join('');
  return {subject,text,html,replyTo};
}
