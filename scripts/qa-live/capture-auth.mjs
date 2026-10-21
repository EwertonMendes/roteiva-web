/**
 * ONE-TIME local setup only. Captures a session from a dedicated Google QA account.
 * Playwright storageState contains Firebase refresh tokens: treat the file as a password.
 * Never use a personal account or add this output to Git.
 */
import {chromium} from '@playwright/test';
import {createInterface} from 'node:readline/promises';
import {stdin as input,stdout as output} from 'node:process';
import {mkdtemp,chmod,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const expected=process.env.QA_EXPECTED_EMAIL?.trim();
if(!expected||!expected.includes('@'))throw new Error('Set QA_EXPECTED_EMAIL to the dedicated Google QA address.');
const work=await mkdtemp(join(tmpdir(),'roteiva-qa-session-'));
const filename=join(work,'storage-state.json');
const browser=await chromium.launch({headless:false});
const page=await browser.newPage();
const prompt=createInterface({input,output});
try{
  await page.goto('https://roteiva-web-dev.web.app/',{waitUntil:'domcontentloaded'});
  console.log('Faça login somente com a conta Google QA e complete o cadastro/acesso do Roteiva.');
  await prompt.question('Depois de entrar no estúdio QA, pressione Enter para verificar e guardar a sessão.');
  await page.locator('.app-shell').waitFor({state:'visible',timeout:20000});
  await page.locator('.sidebar-profile small').getByText(expected,{exact:true}).waitFor({state:'visible',timeout:20000});
  await page.context().storageState({path:filename,indexedDB:true});
  await chmod(filename,0o600);
  console.log('Sessão privada criada fora do repositório: '+filename);
  console.log('No GitHub, configure o segredo do ambiente firebase-development com o base64 desse arquivo, SEM colar neste chat.');
  console.log('Linux/macOS: base64 -w0 "'+filename+'" | gh secret set QA_STORAGE_STATE_B64 --env firebase-development --repo EwertonMendes/roteiva-web');
  console.log('Windows PowerShell: [Convert]::ToBase64String([IO.File]::ReadAllBytes("'+filename+'")) | gh secret set QA_STORAGE_STATE_B64 --env firebase-development --repo EwertonMendes/roteiva-web');
  console.log('Apague o arquivo de sessão local após configurar o segredo.');
}finally{
  prompt.close();
  await browser.close();
}
