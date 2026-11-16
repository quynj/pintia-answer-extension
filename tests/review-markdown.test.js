import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewMarkdown } from '../src/content/extraction/review-markdown.ts';

function renderQuestion(question) {
  return reviewMarkdown.render({
    title: '题集',
    questions: [{ type: 'SUBJECTIVE', number: 1, ...question }]
  }, false);
}

test('falls back from a platform sample to the real API description and removes SQL template prompts', () => {
  const markdown = renderQuestion({
    type: 'SQL_PROGRAMMING',
    content: '这是一个SQL编程题模板。',
    apiData: {
      description: [
        '这是一个SQL编程题模板。',
        '请在这里写定义表结构的SQL语句。',
        '查询每个学生的平均成绩。',
        '请在这里给出输出样例。'
      ].join('\n')
    }
  });

  assert.match(markdown, /查询每个学生的平均成绩。/);
  assert.doesNotMatch(markdown, /SQL编程题模板|请在这里/);
});

test('uses the original content for blank offsets and replaces existing blank labels only once', () => {
  const indexed = renderQuestion({
    type: 'FILL_IN_THE_BLANK',
    content: 'sum=+;',
    apiData: {
      content: 'sum=+;',
      problemConfig: { fillInTheBlankProblemConfig: { blanks: [{ index: 4 }] } }
    }
  });
  assert.match(indexed, /sum= ________ \+;/);

  const marked = renderQuestion({
    type: 'FILL_IN_THE_BLANK',
    content: 'sum=[填空1]+;',
    apiData: {
      content: 'sum=[填空1]+;',
      problemConfig: { fillInTheBlankProblemConfig: { blanks: [{ index: 4 }] } }
    }
  });
  assert.match(marked, /sum= ________ \+;/);
  assert.equal((marked.match(/________/g) || []).length, 1);
});

test('does not apply content offsets after falling back to the API description', () => {
  const markdown = renderQuestion({
    type: 'FILL_IN_THE_BLANK',
    content: '这是一道填空题模板。',
    apiData: {
      content: '这是一道填空题模板。',
      description: 'x=+;',
      problemConfig: { fillInTheBlankProblemConfig: { blanks: [{ index: 2 }] } }
    }
  });

  assert.match(markdown, /x=\+;\n\n填空位置暂无法还原：________/);
  assert.match(markdown, /空位原位置无法可靠还原/);
  assert.doesNotMatch(markdown, /x= ________ \+;/);
});

test('normalizes HTML line breaks, nonbreaking spaces, and escaped underline sequences', () => {
  const markdown = renderQuestion({
    type: 'SUBJECTIVE',
    content: 'first<br>second&nbsp;line \\____\\_'
  });

  assert.match(markdown, /first\nsecond line ____/);
});

test('reports mismatches between existing blank markers and the configured blank count', () => {
  const markdown = renderQuestion({
    type: 'FILL_IN_THE_BLANK',
    content: 'x=[填空1]',
    apiData: {
      content: 'x=[填空1]',
      problemConfig: { fillInTheBlankProblemConfig: { blanks: [{ index: 2 }, { index: 3 }] } }
    }
  });

  assert.match(markdown, /题干填空标记数量与配置不一致，请复核。/);
  assert.equal((markdown.match(/________/g) || []).length, 1);
});

test('does not repeat structured options already present as a complete labeled list', () => {
  const markdown = renderQuestion({
    type: 'MULTIPLE_CHOICE',
    content: '选择正确答案：\nA. first\nB. second',
    options: ['first', 'second']
  });

  assert.equal((markdown.match(/A\. first/g) || []).length, 1);
  assert.equal((markdown.match(/B\. second/g) || []).length, 1);
});

test('preserves metadata images for options already embedded in the question text', () => {
  const markdown = renderQuestion({
    type: 'MULTIPLE_CHOICE',
    content: '选择正确答案：\nA. first\nB. second',
    options: ['first', 'second'],
    images: [{
      url: 'https://images.ptausercontent.com/choice.png',
      markdownPath: '~/choice.png',
      location: 'option',
      index: 0,
      optionIndex: 1
    }]
  });

  assert.equal((markdown.match(/B\. second/g) || []).length, 1);
  assert.equal((markdown.match(/choice\.png/g) || []).length, 1);
});

test('keeps structured options and option images associated when content options differ', () => {
  const markdown = renderQuestion({
    type: 'MULTIPLE_CHOICE',
    content: '选择正确答案：\nA. first',
    options: ['first', 'second'],
    images: [{
      url: 'https://images.ptausercontent.com/choice.png',
      markdownPath: '~/choice.png',
      location: 'option',
      index: 0,
      optionIndex: 1
    }]
  });

  assert.match(markdown, /A\. first/);
  assert.match(markdown, /B\. second !\[选项图片\]\(<https:\/\/images\.ptausercontent\.com\/choice\.png>\)/);
});

test('does not append a question image already embedded using its Pintia path', () => {
  const markdown = renderQuestion({
    type: 'SUBJECTIVE',
    content: '查看图片：![图](<https://images.ptausercontent.com/question.png>)',
    images: [{
      url: 'https://images.ptausercontent.com/question.png',
      markdownPath: '~/question.png',
      location: 'content',
      index: 0
    }]
  });

  assert.equal((markdown.match(/question\.png/g) || []).length, 1);
});
