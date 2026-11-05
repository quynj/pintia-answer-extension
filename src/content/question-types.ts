import type { PintiaQuestion, PintiaQuestionTypesApi } from '../shared/types';

const labels: Record<string, string> = {
    MULTIPLE_CHOICE: '单选题',
    MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER: '多选题',
    TRUE_OR_FALSE: '判断题',
    FILL_IN_THE_BLANK: '填空题',
    FILL_IN_THE_BLANK_FOR_PROGRAMMING: '程序填空题',
    PROGRAMMING: '编程题',
    SQL_PROGRAMMING: 'SQL编程题',
    SUBJECTIVE: '主观题'
  };

export const questionTypes: PintiaQuestionTypesApi = {
  labels,
  isProgramming(question) {
    return question.type === 'PROGRAMMING' || question.type === 'SQL_PROGRAMMING';
  }
};
