export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type PintiaAnswerValue = JsonValue;
export type AiApiType = 'chat-completions' | 'responses';

export interface VerifierConfig {
  apiType: AiApiType;
  endpoint: string;
  model: string;
  apiKey: string;
}

export interface AiConfig {
  apiType: AiApiType;
  endpoint: string;
  model: string;
  apiKey: string;
  prompt: string;
  autoApplyAnswers: boolean;
  requestTimeoutSeconds: number;
  secondaryCheckEnabled: boolean;
  secondaryPrompt: string;
  useSeparateVerifierConfig: boolean;
  verifierConfig?: VerifierConfig;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
}

export interface LastDetection {
  source: string;
  questionCount: number;
  questionTypes: string[];
  detectedAt: string;
}

export interface PintiaImage {
  url: string;
  markdownPath: string;
  location: string;
  index: number;
  optionIndex?: number;
}

export interface PintiaQuestion {
  id?: string | null;
  problemId?: string;
  questionNumber?: number | null;
  number?: number | null;
  type: string;
  title?: string;
  prompt?: string;
  content?: string;
  options?: string[];
  images?: PintiaImage[];
  fillBlankCount?: number;
  optionLabels?: string[];
  apiData?: PintiaApiData;
  problemConfig?: PintiaProblemConfig;
  submission?: {
    answer?: unknown;
    evaluation?: string;
  };
  [key: string]: unknown;
}

export interface PintiaProblemConfig extends Record<string, unknown> {
  fillInTheBlankProblemConfig?: PintiaFillBlankConfig;
  fillInTheBlankForProgrammingProblemConfig?: PintiaFillBlankConfig;
  multipleChoiceProblemConfig?: PintiaChoiceConfig;
  multipleChoiceMoreThanOneAnswerProblemConfig?: PintiaChoiceConfig;
  programmingProblemConfig?: PintiaProgrammingConfig;
  codeProblemConfig?: PintiaProgrammingConfig;
}

export interface PintiaFillBlankConfig extends Record<string, unknown> {
  blanks?: Array<Record<string, unknown> & { index?: number }>;
}

export interface PintiaChoiceConfig extends Record<string, unknown> {
  choices?: unknown[];
}

export interface PintiaProgrammingConfig extends Record<string, unknown> {
  timeLimit?: unknown;
  memoryLimit?: unknown;
  codeSizeLimit?: unknown;
  exampleTestDatas?: unknown;
  testdataDescriptionCode?: unknown;
}

export interface PintiaApiData extends Record<string, unknown> {
  problemConfig?: PintiaProblemConfig;
}

export interface PintiaAnswerItem {
  problemId: string;
  questionNumber: number | null;
  type: string;
  answer: PintiaAnswerValue;
}

export interface PintiaAnswerPayload {
  problemSetId: string | null;
  answers: PintiaAnswerItem[];
}

export interface PintiaQuestionBankResult {
  title?: string;
  source?: string;
  extraction?: string;
  problemSetId?: string | null;
  problemSetName?: string | null;
  examId?: string | null;
  summaries?: Record<string, unknown>;
  reason?: string | null;
  exportedAt?: string;
  questions: PintiaQuestion[];
}

export interface PintiaProblemSet {
  id: string | number;
  name: string;
  examId?: string | null;
  isCurrentOnly?: boolean;
  [key: string]: unknown;
}

export interface PintiaExtractorCommonApi {
  cleanText(value: unknown): string;
  normalizeRichText(value: unknown): string;
  fillBlankMarkdownContent(
    question: PintiaQuestion,
    blankLabel?: (index: number) => string
  ): string;
  markdownImages(value: unknown, location: string, optionIndex?: number): PintiaImage[];
  normalizeType(value: unknown, options?: string[]): string;
  normalizeApiQuestion(item: Record<string, unknown>, index: number): PintiaQuestion | null;
  uniqueQuestions(questions: Array<PintiaQuestion | null>): PintiaQuestion[];
  findApiQuestionArrays(value: unknown, found?: PintiaQuestion[][]): PintiaQuestion[][];
  problemSetProblems(data: unknown): PintiaQuestion[];
}

export interface PintiaExtractorApi extends PintiaExtractorCommonApi {
  currentProblemSetPage(): { id: string; path: string } | null;
  listProblemSets(): Promise<PintiaProblemSet[]>;
  extractProblemSetForReview(
    problemSet: PintiaProblemSet,
    detailRequestDelayMs?: number
  ): Promise<PintiaQuestionBankResult>;
  extractFromApi(options?: PintiaExtractOptions): Promise<PintiaQuestionBankResult>;
}

export interface PintiaExtractOptions {
  detailRequestDelayMs?: number;
  onProgress?: (progress: Record<string, unknown>) => void;
}

export interface PintiaPromptApi {
  systemPrompt: string;
  buildInput(
    title: string,
    questions: PintiaQuestion[],
    problemSetId?: string | null,
    programmingLanguage?: string
  ): string;
  build(
    title: string,
    questions: PintiaQuestion[],
    problemSetId?: string | null,
    prompt?: string,
    programmingLanguage?: string
  ): string;
}

export interface PintiaAnswerContractApi {
  validate(
    payload: unknown,
    expectedProblemSetId?: string | null,
    expectedQuestions?: PintiaQuestion[]
  ): PintiaAnswerPayload;
  parse(
    text: string,
    expectedProblemSetId?: string | null,
    expectedQuestions?: PintiaQuestion[]
  ): PintiaAnswerPayload;
}

export interface PintiaAssistantApi {
  open(
    extractedQuestions?: PintiaQuestionBankResult,
    automatic?: boolean
  ): Promise<HTMLElement | null>;
  showExtractionProgress(progress?: Record<string, unknown>): void;
  canAutoOpen(): boolean;
  hide(): void;
  clearCurrentProblemSet(): void;
  isVisible(): boolean;
  refreshQuestions(result: PintiaQuestionBankResult): Promise<void>;
}

export interface PintiaAnswerRunnerApi {
  parse(text: string, expectedProblemSetId?: string | null): PintiaAnswerPayload;
  requiresBatchSave(payload: PintiaAnswerPayload, allowedTypes: string[]): boolean;
  run(
    payload: PintiaAnswerPayload,
    allowedTypes: string[],
    options?: { save?: boolean }
  ): Promise<AnswerRunReport>;
}

export interface AnswerRunResult {
  questionNumber?: number | null;
  problemId?: string;
  type?: string;
  success: boolean;
  skipped?: boolean;
  reason?: string;
  action?: string;
  optionActions?: Array<{ option: string; action: string }>;
  blankActions?: Array<{ index: number; action: string }>;
  [key: string]: unknown;
}

export interface AnswerRunReport {
  success: boolean;
  problemSetId: string | null;
  saveRequested: boolean;
  saved: boolean;
  summary: {
    total: number;
    success: number;
    failed: number;
    skipped: number;
  };
  results: AnswerRunResult[];
}

export interface PintiaQuestionTypesApi {
  labels: Record<string, string>;
  isProgramming(question: PintiaQuestion): boolean;
}

export interface PintiaReviewMarkdownApi {
  render(result: PintiaQuestionBankResult, includeAnswers?: boolean): string;
  filename(result: PintiaQuestionBankResult): string;
}
