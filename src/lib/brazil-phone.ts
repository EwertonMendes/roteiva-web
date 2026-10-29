/** Brazilian national telephone numbers. Pure, safe for legacy stored values. */
export function phoneDigits(value:string):string {
 const digits=value.replace(/\D/g,'');
 // Permit pasted +55 with an area code; do not confuse an ordinary DDD 55.
 const national=digits.startsWith('55')&&digits.length>=12&&digits.length<=13?digits.slice(2):digits;
 return national.slice(0,11);
}
export function formatPhoneInput(value:string):string {
 const digits=phoneDigits(value);
 if(!digits)return '';
 if(digits.length<3)return '('+digits+(digits.length===2?')':'');
 const ddd=digits.slice(0,2);
 const local=digits.slice(2);
 const prefixLength=digits.length>10?5:4;
 return '('+ddd+') '+local.slice(0,prefixLength)+(local.length>prefixLength?'-'+local.slice(prefixLength):'');
}
/** Only format complete national numbers. Preserve unknown legacy formats. */
export function formatPhoneDisplay(value:string):string {
 const digits=phoneDigits(value);
 return digits.length===10||digits.length===11?formatPhoneInput(digits):value.trim();
}
export function validBrazilPhone(value:string):boolean {
 const digits=phoneDigits(value);
 return digits.length===10||digits.length===11;
}
