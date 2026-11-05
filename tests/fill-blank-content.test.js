import assert from 'node:assert/strict';
import test from 'node:test';
import { fillBlankMarkdownContent } from '../src/shared/fill-blank-content.ts';

test('inserts ordered labels at the configured character offsets', () => {
  const question = {
    content: 'x=+;',
    apiData: {
      description: 'x=+;',
      problemConfig: {
        fillInTheBlankProblemConfig: {
          blanks: [{ index: 2 }, { index: 3 }]
        }
      }
    }
  };

  assert.equal(
    fillBlankMarkdownContent(question, (index) => `【空${index + 1}】`),
    'x=【空1】+【空2】;'
  );
});

test('uses a visible fallback when a blank offset cannot be placed safely', () => {
  const question = {
    content: '[link](https://example.test)',
    apiData: {
      description: '[link](https://example.test)',
      problemConfig: {
        fillInTheBlankProblemConfig: {
          blanks: [{ index: 2 }]
        }
      }
    }
  };

  assert.match(fillBlankMarkdownContent(question), /填空位置：/);
});
