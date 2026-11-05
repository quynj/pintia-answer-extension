import type {
  JsonValue,
  PintiaAnswerContractApi,
  PintiaAnswerItem,
  PintiaQuestion
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

export const answerContract: PintiaAnswerContractApi = {
  validate(input, expectedProblemSetId, expectedQuestions) {
    if (!isRecord(input)) throw new Error('答案必须是 JSON 对象。');
    const problemSetId = input.problemSetId;
    if (problemSetId !== null && typeof problemSetId !== 'string') {
      throw new Error('problemSetId 必须是字符串或 null。');
    }
    if (expectedProblemSetId && problemSetId && problemSetId !== expectedProblemSetId) {
      throw new Error('答案中的 problemSetId 与当前题集不匹配。');
    }
    if (!Array.isArray(input.answers)) throw new Error('answers 必须是数组。');

    const seenProblemIds = new Set<string>();
    const answers: PintiaAnswerItem[] = input.answers.map((value, index) => {
      if (!isRecord(value)) throw new Error(`answers[${index}] 必须是对象。`);
      const { problemId, questionNumber, type, answer } = value;
      if (typeof problemId !== 'string' || !problemId.trim()) {
        throw new Error(`answers[${index}].problemId 必须是非空字符串。`);
      }
      if (seenProblemIds.has(problemId)) throw new Error(`problemId 重复：${problemId}`);
      seenProblemIds.add(problemId);
      if (typeof type !== 'string' || !type) {
        throw new Error(`answers[${index}].type 必须是非空字符串。`);
      }
      if (questionNumber !== null && typeof questionNumber !== 'number') {
        throw new Error(`answers[${index}].questionNumber 必须是数字或 null。`);
      }
      if (!Object.prototype.hasOwnProperty.call(value, 'answer')) {
        throw new Error(`answers[${index}] 缺少 answer。`);
      }
      if (!isJsonValue(answer)) throw new Error(`answers[${index}].answer 必须是合法 JSON 值。`);

      const questionLabel = questionNumber ?? index + 1;
      if (type === 'MULTIPLE_CHOICE' && (typeof answer !== 'string' || !answer)) {
        throw new Error(`题目 ${questionLabel} 的单选答案必须是非空字符串。`);
      }
      if (type === 'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER'
        && (!isStringArray(answer) || new Set(answer).size !== answer.length)) {
        throw new Error(`题目 ${questionLabel} 的多选答案必须是无重复字符串数组。`);
      }
      if (type === 'TRUE_OR_FALSE' && typeof answer !== 'boolean') {
        throw new Error(`题目 ${questionLabel} 的判断答案必须是布尔值。`);
      }
      if ((type === 'FILL_IN_THE_BLANK' || type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING')
        && !isStringArray(answer)) {
        throw new Error(`题目 ${questionLabel} 的填空答案必须是字符串数组。`);
      }
      if (type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING' && Array.isArray(answer)) {
        const expectedQuestion = expectedQuestions?.find((question) => question.problemId === problemId);
        if (expectedQuestion && Number.isInteger(expectedQuestion.fillBlankCount)
          && answer.length !== expectedQuestion.fillBlankCount) {
          throw new Error(`题目 ${questionLabel} 的程序填空答案必须包含 ${expectedQuestion.fillBlankCount} 个字符串。`);
        }
      }
      if ((type === 'PROGRAMMING' || type === 'SQL_PROGRAMMING')
        && (typeof answer !== 'string' || !answer.trim())) {
        throw new Error(`题目 ${questionLabel} 的编程答案必须是非空字符串。`);
      }
      if (type === 'SUBJECTIVE' && typeof answer !== 'string') {
        throw new Error(`题目 ${questionLabel} 的主观题答案必须是字符串。`);
      }

      return { problemId, questionNumber, type, answer };
    });

    if (expectedQuestions) {
      if (answers.length !== expectedQuestions.length) {
        throw new Error('复核结果的题目数量与输入不一致。');
      }
      const answersById = new Map(answers.map((answer) => [answer.problemId, answer]));
      expectedQuestions.forEach((question, index) => {
        if (typeof question.problemId !== 'string' || !question.problemId) {
          throw new Error('输入题目缺少可校验的题目 ID。');
        }
        const answer = answersById.get(question.problemId);
        if (!answer) throw new Error(`复核结果遗漏题目 ${question.questionNumber ?? question.problemId}。`);
        if (answers[index]?.problemId !== question.problemId) {
          throw new Error('复核结果的题目顺序与输入不一致。');
        }
        if (answer.questionNumber !== question.questionNumber || answer.type !== question.type) {
          throw new Error(`复核结果中的题目 ${question.questionNumber ?? question.problemId} 信息与输入不一致。`);
        }
        if (question.optionLabels?.length) {
          const validLabels = new Set(question.optionLabels);
          const choices = answer.type === 'MULTIPLE_CHOICE'
            ? [answer.answer]
            : answer.type === 'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER' && Array.isArray(answer.answer)
              ? answer.answer
              : [];
          if (choices.some((choice) => typeof choice !== 'string' || !validLabels.has(choice))) {
            throw new Error(`题目 ${question.questionNumber ?? question.problemId} 的选择题答案必须使用有效选项标识：${question.optionLabels.join('、')}。`);
          }
        }
      });
    }
    return { problemSetId, answers };
  },
  parse(text, expectedProblemSetId, expectedQuestions) {
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error('JSON 格式无效，请检查答案文本。');
    }
    return answerContract.validate(payload, expectedProblemSetId, expectedQuestions);
  }
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
