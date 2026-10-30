import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMoneyDigits,formatMoneyDigits,moneyDigitsFromValue,
  moneyValueFromDigits,moneyDigitsFromPaste,MAX_MONEY_CENTS,
} from '../src/lib/money-input.ts';

test('BRL cent-based typing, thousands and deletion are deterministic',()=>{
  let digits='';
  const seen=[];
  for(const char of '1234567'){
    digits=normalizeMoneyDigits(digits+char);
    seen.push(formatMoneyDigits(digits));
  }
  assert.deepEqual(seen,['0,01','0,12','1,23','12,34','123,45','1.234,56','12.345,67']);
  assert.equal(formatMoneyDigits(digits.slice(0,-1)),'1.234,56');
  assert.equal(formatMoneyDigits('0'),'0,00');
  assert.equal(formatMoneyDigits(''),'');
  assert.equal(normalizeMoneyDigits('0000012'),'12');
  assert.equal(normalizeMoneyDigits('9'.repeat(20)),null);
  assert.equal(normalizeMoneyDigits(String(MAX_MONEY_CENTS)),String(MAX_MONEY_CENTS));
});

test('initial model values remain numeric reais and never round intermediate floats',()=>{
  assert.equal(formatMoneyDigits(moneyDigitsFromValue(1234.56)),'1.234,56');
  assert.equal(formatMoneyDigits(moneyDigitsFromValue(0.1+0.2)),'0,30');
  assert.equal(moneyDigitsFromValue(undefined),'');
  assert.equal(moneyDigitsFromValue(null),'');
  assert.equal(moneyDigitsFromValue(-1),'');
  assert.equal(moneyValueFromDigits('123456'),1234.56);
  assert.equal(moneyValueFromDigits(''),null);
});

test('clipboard values in pt-BR, decimal-dot and digits-only styles',()=>{
  for(const [pasted,expected] of [
    ['R$ 1.234,56','1.234,56'],['1234,56','1.234,56'],
    ['1234.56','1.234,56'],['1.234','1.234,00'],
    ['12,3','12,30'],['1234','12,34'],
    ['0,01','0,01'],
  ]){
    const digits=moneyDigitsFromPaste(pasted);
    assert.notEqual(digits,null,pasted);
    assert.equal(formatMoneyDigits(digits),expected,pasted);
  }
  assert.equal(moneyDigitsFromPaste('-1,00'),null);
  assert.equal(moneyDigitsFromPaste('um milhão'),null);
  assert.equal(moneyDigitsFromPaste('12,3456'),null);
});
