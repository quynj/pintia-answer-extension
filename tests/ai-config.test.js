import assert from 'node:assert/strict';
import test from 'node:test';
import { aiConfig } from '../src/shared/ai-config.ts';

test('default AI config includes an empty API key for unconfigured installs', () => {
  assert.equal(aiConfig.defaults.apiKey, '');
  assert.equal(aiConfig.defaults.autoApplyAnswers, true);
});
