import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('billing customer-facing components never display the provider brand',()=>{
 const components=[
   'src/features/access/BillingPanel.tsx',
   'src/features/access/BillingPlans.tsx',
   'src/features/access/BillingHistory.tsx',
   'src/features/access/billing-data.ts',
 ];
 for(const path of components){
   const source=readFileSync(new URL('../'+path,import.meta.url),'utf8')
     .replace(/\/\/[^\n]*/g,'');
   assert.doesNotMatch(source,/\bAsaas\b/,path+' should refer to the payment, not the provider');
 }
 const consent=readFileSync(new URL('../src/features/access/BillingPlans.tsx',import.meta.url),'utf8');
 assert.match(consent,/Continuar para o pagamento/);
 assert.match(consent,/Pagamento seguro no ambiente de teste/);
 const panel=readFileSync(new URL('../src/features/access/BillingPanel.tsx',import.meta.url),'utf8');
 assert.match(panel,/Trocar plano ou pagamento/);
 assert.match(panel,/Conclua o pagamento na página segura/);
});
