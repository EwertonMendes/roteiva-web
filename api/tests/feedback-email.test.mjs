import test from 'node:test';
import assert from 'node:assert/strict';
import {composeFeedbackEmail} from '../src/feedback-email.ts';

const example={
  id:'f6ec384b-5a9d-4521-8a20-6dbbfa4d02c1',
  email:'user@example.com',
  kindLabel:'Problema',
  title:'Falha <script>alert("x")</script> no projeto',
  description:'Linha 1 & caracteres especiais\n<img src=x onerror=alert(1)>\nLinha 3',
  attachmentCount:3
};

test('one branded HTML and plain-text email for DEV and PROD; no screen or tracking',()=>{
  for(const env of ['dev','prod']){
    const message=composeFeedbackEmail(env,example);
    assert.match(message.subject,new RegExp('\\[Roteiva '+env.toUpperCase()+'\\]'));
    assert.match(message.html,/Roteiva/);
    assert.match(message.html,/CENTRAL DE FEEDBACK/);
    assert.match(message.html,/DESCRIÇÃO/);
    assert.match(message.html,/3 imagens/);
    assert.match(message.html,/Protocolo/);
    assert.match(message.html,/background:#141813/);
    assert.match(message.text,/Descrição:\nLinha 1/);
    assert.match(message.text,/Assunto:/);
    assert.match(message.text,/E-mail do usuário:/);
    assert.equal(message.replyTo,'user@example.com');
    assert.ok(!message.html.includes('Tela:'));
    assert.ok(!message.text.includes('Tela:'));
    assert.ok(!message.html.includes('<script>'));
    assert.ok(!message.html.includes('<img src=x onerror=alert(1)>'));
    assert.ok(message.html.includes('&lt;script&gt;'));
    assert.ok(message.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(message.html.includes('Linha 1 &amp;'));
    assert.ok(message.html.includes('Linha 3'));
    assert.ok(!message.html.includes('https://'));
    assert.ok(!message.html.includes('<img '));
  }
});

test('plain text email labels user description and supports zero or one image',()=>{
  const empty=composeFeedbackEmail('prod',{...example,attachmentCount:0,description:'Texto simples'});
  assert.match(empty.html,/Nenhuma imagem/);
  assert.match(empty.text,/Imagens anexadas: Nenhuma/);
  const one=composeFeedbackEmail('dev',{...example,attachmentCount:1});
  assert.match(one.html,/1 imagem/);
});
test('untrusted reply-to never becomes a message header',()=>{
  const bad=composeFeedbackEmail('dev',{...example,email:'bad@example.com\r\nBcc:attacker@example.com'});
  assert.equal(bad.replyTo,undefined);
  assert.match(bad.html,/&#13;|Bcc:attacker@example.com/);
});
