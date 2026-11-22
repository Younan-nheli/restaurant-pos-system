import test from 'node:test';
import assert from 'node:assert/strict';
import { TRANSLATIONS, translate } from '../src/i18n.js';

test('Arabic and English dictionaries expose the same UI keys', () => {
  assert.deepEqual(Object.keys(TRANSLATIONS.ar).sort(), Object.keys(TRANSLATIONS.en).sort());
  assert.equal(translate('ar', 'login'), 'تسجيل الدخول');
  assert.equal(translate('en', 'login'), 'Sign in');
  assert.equal(translate('en', 'language'), 'العربية');
});

test('unknown language keys safely fall back to Arabic or the key name', () => {
  assert.equal(translate('xx', 'cart'), 'السلة');
  assert.equal(translate('en', 'missing_key'), 'missing_key');
});
