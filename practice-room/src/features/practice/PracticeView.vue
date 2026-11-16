<script setup lang="ts">
import { ref } from 'vue'
import MarkdownContent from '../../components/MarkdownContent.vue'
import { usePracticeSession } from './usePracticeSession'

const props = defineProps<{
  model: ReturnType<typeof usePracticeSession>
}>()
const emit = defineEmits<{
  'return-to-library': []
}>()

const {
  bank,
  activeQuestions,
  submittedQuestions,
  position,
  previewMode,
  selectedTypes,
  requestedCount,
  statusNames,
  questionTypes,
  questionTypeCounts,
  currentQuestion,
  currentAnswer,
  currentPracticeResponse,
  currentPracticeAnswers,
  currentBlankCount,
  currentAnswerSubmitted,
  currentAnswerRequiresSubmit,
  canSubmitAnswer,
  answeredQuestionCount,
  questionProgressStatuses,
  questionProgressStatusNames,
  questionProgressStatusSymbols,
  questionProgressStatusCounts,
  activeTotalScore,
  hasQuestions,
  isShuffled,
  visiblePosition,
  typeLabel,
  responseFor,
  responseLines,
  blankCountFor,
  answerRequiresSubmit,
  canSubmitQuestion,
  isCodeQuestion,
  hasCompletedQuestion,
  questionProgressStatus,
  questionAnswer,
  questionKey,
  toggleQuestionType,
  generateSet,
  toggleShuffle,
  resetSet,
  moveQuestion,
  reviewQuestion,
  showAllQuestions,
  setPracticeResponse,
  isOptionSelected,
  toggleOption,
  setBlankResponse,
  setTextResponse,
  submitPracticeAnswer,
  redoActiveSet,
  answerLines
} = props.model

const progressDialog = ref<HTMLDialogElement | null>(null)

function openProgressDialog(): void {
  if (progressDialog.value && !progressDialog.value.open) progressDialog.value.showModal()
}

function closeProgressDialog(): void {
  progressDialog.value?.close()
}

function reviewFromProgress(index: number): void {
  closeProgressDialog()
  reviewQuestion(index)
}
</script>

<template>
  <section class="session-heading">
    <div>
      <p class="eyebrow"><span class="eyebrow-line" />02 / STUDY SESSION</p>
      <h1>{{ bank?.title ?? '专注练习' }}<em>。</em></h1>
      <p class="intro-text">一题一题作答，也可以切换到全题总览，完成后直接挑题二刷。</p>
    </div>
    <div class="session-index">
      <span>SESSION</span>
      <strong>{{ String(activeQuestions.length).padStart(2, '0') }}</strong>
      <small>题目 · {{ answeredQuestionCount }} 已完成</small>
    </div>
  </section>

  <section class="practice-workspace" aria-label="刷题区域">
    <aside class="practice-rail" aria-label="练习设置">
      <section class="rail-section">
        <p class="section-kicker">01 / SESSION</p>
        <h2>本轮练习</h2>
        <p class="active-bank-name">{{ bank?.title }}</p>
        <p class="bank-summary">{{ bank?.questions.length }} 道题 · 已完成 {{ answeredQuestionCount }} 道</p>
      </section>
      <section class="rail-section build-section">
        <p class="section-kicker">02 / BUILD A SET</p>
        <h2>随机组题</h2>
        <span class="field-label">题目类型</span>
        <div class="type-filter-list">
          <label v-for="type in questionTypes" :key="type" class="type-filter-option">
          <input type="checkbox" :checked="selectedTypes.includes(type)" :disabled="!bank" @change="toggleQuestionType(type)">
            <span>{{ typeLabel(type) }}</span>
            <small class="type-filter-count">{{ questionTypeCounts.get(type) ?? 0 }}</small>
          </label>
        </div>
        <label class="field-label" for="question-count">抽取题数</label>
        <div class="count-field">
          <input id="question-count" v-model.number="requestedCount" type="number" min="1" :max="bank?.questions.length ?? 1" inputmode="numeric" :disabled="!bank">
          <span>道</span>
        </div>
        <button class="button button-dark" type="button" :disabled="!bank" @click="() => generateSet()">生成随机题组 <span aria-hidden="true">↗</span></button>
        <button class="button button-outline wrong-set-button" type="button" :disabled="!bank" @click="() => generateSet(true)">生成错题题组 <span aria-hidden="true">↗</span></button>
        <button class="text-button" type="button" :disabled="!bank" @click="resetSet">返回完整题库</button>
      </section>
      <button class="library-back" type="button" @click="emit('return-to-library')"><span aria-hidden="true">←</span> 切换题库</button>
    </aside>

    <section class="practice-area">
      <div class="practice-toolbar">
        <div>
          <p class="section-kicker">{{ previewMode === 'single' ? 'SINGLE QUESTION' : 'QUESTION OVERVIEW' }}</p>
          <span class="question-position">{{ previewMode === 'single' ? visiblePosition : `全部 ${activeQuestions.length} 道题` }}</span>
        </div>
        <div class="toolbar-actions">
          <div class="total-score">
            <span>当前题组分</span>
            <strong>{{ activeTotalScore === null ? '未提供' : `${activeTotalScore} 分` }}</strong>
          </div>
          <button
            class="total-score completion-score completion-score-button"
            type="button"
            :disabled="!hasQuestions"
            :aria-label="`查看全部题目做题进度：已完成 ${answeredQuestionCount} 道，共 ${activeQuestions.length} 道`"
            @click="openProgressDialog"
          >
            <span>完成进度 <i aria-hidden="true">↗</i></span>
            <strong>{{ answeredQuestionCount }} / {{ activeQuestions.length }}</strong>
          </button>
          <button class="icon-button preview-switch" type="button" :disabled="!hasQuestions" @click="previewMode === 'single' ? showAllQuestions() : (previewMode = 'single')">
            <span aria-hidden="true">{{ previewMode === 'single' ? '▤' : '▣' }}</span> {{ previewMode === 'single' ? '全部预览' : '单题练习' }}
          </button>
          <button class="icon-button shuffle-button" type="button" :disabled="!hasQuestions" @click="toggleShuffle">
            <span aria-hidden="true">⤨</span> {{ isShuffled ? '恢复顺序' : '打乱顺序' }}
          </button>
          <button class="icon-button redo-set-control" type="button" :disabled="!hasQuestions" @click="redoActiveSet">
            重做本题集 <span aria-hidden="true">↻</span>
          </button>
        </div>
      </div>

      <section v-if="previewMode === 'all'" class="question-overview" aria-label="全部题目总览">
        <div class="overview-heading">
          <div>
            <p class="section-kicker">ROUND OVERVIEW</p>
            <h2>全部题目，<em>逐题预览。</em></h2>
          </div>
        </div>
        <div class="overview-progress">
          <span>已完成 <strong>{{ answeredQuestionCount }}</strong> / {{ activeQuestions.length }}</span>
          <span>可在完成进度中查看本轮题目状态</span>
        </div>
        <article v-for="(question, index) in activeQuestions" :key="questionKey(question)" class="overview-card">
          <div class="question-meta">
            <span>本轮第 {{ index + 1 }} 题</span>
            <span class="meta-divider" aria-hidden="true" />
            <span>题库编号 {{ question.number }}</span>
            <span class="meta-divider" aria-hidden="true" />
            <span>{{ typeLabel(question.type) }}</span>
            <a
              v-if="question.pintiaUrl"
              class="pintia-link"
              :href="question.pintiaUrl"
              target="_blank"
              rel="noopener noreferrer"
            >Pintia 查看 <span aria-hidden="true">↗</span></a>
            <span class="score-pill">分值 <strong>{{ question.score === null ? '未提供' : `${question.score} 分` }}</strong></span>
          </div>
          <div class="question-text"><MarkdownContent :content="question.text" /></div>
          <div v-if="question.imageUrls.length" class="question-images">
            <img
              v-for="(url, imageIndex) in question.imageUrls"
              :key="url"
              :src="url"
              :alt="`第 ${question.number} 题图片 ${imageIndex + 1}`"
              loading="lazy"
              decoding="async"
              referrerpolicy="no-referrer"
            >
          </div>
          <section class="answer-workbench overview-workbench" :aria-label="`第 ${question.number} 题作答`">
            <div v-if="question.options.length" class="option-list">
              <label
                v-for="(option, optionIndex) in question.options"
                :key="`${optionIndex}-${option}`"
                class="option-choice"
                :class="{ 'option-selected': isOptionSelected(question, String.fromCharCode(65 + optionIndex)) }"
              >
                <input
                  v-if="question.type === 'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER'"
                  type="checkbox"
                  :checked="isOptionSelected(question, String.fromCharCode(65 + optionIndex))"
                  @change="toggleOption(question, String.fromCharCode(65 + optionIndex), $event)"
                >
                <input
                  v-else
                  type="radio"
                  :name="`overview-choice-${questionKey(question)}`"
                  :checked="responseFor(question) === String.fromCharCode(65 + optionIndex)"
                  @change="setPracticeResponse(question, String.fromCharCode(65 + optionIndex))"
                >
                <span class="option-letter">{{ String.fromCharCode(65 + optionIndex) }}</span>
                <MarkdownContent :content="option" />
              </label>
            </div>
            <div v-else-if="question.type === 'TRUE_OR_FALSE' || question.type === 'TRUE_FALSE'" class="boolean-options">
              <label
                v-for="option in [{ value: 'true', label: '正确' }, { value: 'false', label: '错误' }]"
                :key="option.value"
                class="boolean-choice"
                :class="{ 'option-selected': responseFor(question) === option.value }"
              >
                <input
                  type="radio"
                  :name="`overview-boolean-${questionKey(question)}`"
                  :value="option.value"
                  :checked="responseFor(question) === option.value"
                  @change="setPracticeResponse(question, option.value)"
                >
                {{ option.label }}
              </label>
            </div>
            <div
              v-else-if="question.type === 'FILL_IN_THE_BLANK' || question.type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING'"
              class="blank-fields"
            >
              <label v-for="blankIndex in blankCountFor(question)" :key="blankIndex" class="response-field">
                <span>填空 {{ blankIndex }}</span>
                <input
                  type="text"
                  :value="responseLines(responseFor(question))[blankIndex - 1] ?? ''"
                  :aria-label="`第 ${question.number} 题填空 ${blankIndex}`"
                  autocomplete="off"
                  @input="setBlankResponse(question, blankIndex - 1, $event)"
                >
              </label>
            </div>
            <label v-else class="response-field long-response">
              <span>{{ isCodeQuestion(question) ? '编写代码' : '写下你的答案' }}</span>
              <textarea
                :value="typeof responseFor(question) === 'string' ? responseFor(question) : ''"
                :aria-label="isCodeQuestion(question) ? `第 ${question.number} 题代码答案` : `第 ${question.number} 题文字答案`"
                :class="{ 'code-response': isCodeQuestion(question) }"
                :spellcheck="!isCodeQuestion(question)"
                rows="5"
                @input="setTextResponse(question, $event)"
              />
            </label>

            <div v-if="answerRequiresSubmit(question)" class="response-actions">
              <button
                class="button button-dark submit-answer"
                type="button"
                :disabled="!canSubmitQuestion(question)"
                @click="submitPracticeAnswer(question)"
              >{{ submittedQuestions.has(questionKey(question)) ? '更新本题作答' : '提交本题作答' }} <span aria-hidden="true">↗</span></button>
            </div>

          </section>
          <div v-if="hasCompletedQuestion(question)" class="answer-panel overview-answer">
            <div class="answer-heading"><span>REFERENCE ANSWER</span><span>{{ questionAnswer(question)?.problemStatus ? statusNames[questionAnswer(question)?.problemStatus ?? ''] ?? questionAnswer(question)?.problemStatus : '' }}</span></div>
            <div class="answer-text">
              <template v-if="questionAnswer(question)">
                <MarkdownContent v-for="(line, answerIndex) in answerLines(questionAnswer(question))" :key="answerIndex" :content="line" />
              </template>
              <span v-else>尚未导入这道题的答案。</span>
            </div>
          </div>
          <button class="review-question-button" type="button" @click="reviewQuestion(index)">单题专注 <span aria-hidden="true">↗</span></button>
        </article>
      </section>

      <template v-else>
      <article class="question-card">
        <div class="question-meta">
          <span>{{ currentQuestion ? `第 ${currentQuestion.number} 题` : '—' }}</span>
          <span class="meta-divider" aria-hidden="true" />
          <span>{{ currentQuestion ? typeLabel(currentQuestion.type) : '—' }}</span>
          <span
            v-if="currentQuestion"
            class="progress-status-tag"
            :class="`progress-${questionProgressStatus(currentQuestion)}`"
          >{{ questionProgressStatusNames[questionProgressStatus(currentQuestion)] }}</span>
          <a
            v-if="currentQuestion?.pintiaUrl"
            class="pintia-link"
            :href="currentQuestion.pintiaUrl"
            target="_blank"
            rel="noopener noreferrer"
          >Pintia 查看 <span aria-hidden="true">↗</span></a>
          <span class="score-pill">
            分值 <strong>{{ currentQuestion?.score === null || !currentQuestion ? '未提供' : `${currentQuestion.score} 分` }}</strong>
          </span>
        </div>

        <div class="question-text">
          <MarkdownContent
            v-if="currentQuestion"
            :content="currentQuestion.text"
          />
          <span v-else>从左侧导入题库 JSON，开始一轮专注练习。</span>
        </div>

        <section v-if="currentQuestion" class="answer-workbench" aria-label="本题作答">
          <div v-if="currentQuestion.options.length" class="option-list">
            <label
              v-for="(option, index) in currentQuestion.options"
              :key="`${index}-${option}`"
              class="option-choice"
              :class="{ 'option-selected': isOptionSelected(currentQuestion, String.fromCharCode(65 + index)) }"
            >
              <input
                v-if="currentQuestion.type === 'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER'"
                type="checkbox"
                :checked="isOptionSelected(currentQuestion, String.fromCharCode(65 + index))"
                @change="toggleOption(currentQuestion, String.fromCharCode(65 + index), $event)"
              >
              <input
                v-else
                type="radio"
                name="practice-choice"
                :checked="currentPracticeResponse === String.fromCharCode(65 + index)"
                @change="setPracticeResponse(currentQuestion, String.fromCharCode(65 + index))"
              >
              <span class="option-letter">{{ String.fromCharCode(65 + index) }}</span>
              <MarkdownContent :content="option" />
            </label>
          </div>

          <div v-else-if="currentQuestion.type === 'TRUE_OR_FALSE' || currentQuestion.type === 'TRUE_FALSE'" class="boolean-options">
            <label
              v-for="option in [{ value: 'true', label: '正确' }, { value: 'false', label: '错误' }]"
              :key="option.value"
              class="boolean-choice"
              :class="{ 'option-selected': currentPracticeResponse === option.value }"
            >
              <input
                type="radio"
                name="practice-boolean"
                :value="option.value"
                :checked="currentPracticeResponse === option.value"
                @change="setPracticeResponse(currentQuestion, option.value)"
              >
              {{ option.label }}
            </label>
          </div>

          <div
            v-else-if="currentQuestion.type === 'FILL_IN_THE_BLANK' || currentQuestion.type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING'"
            class="blank-fields"
          >
            <label v-for="index in currentBlankCount" :key="index" class="response-field">
              <span>填空 {{ index }}</span>
              <input
                type="text"
                :value="currentPracticeAnswers[index - 1] ?? ''"
                :aria-label="`填空 ${index}`"
                autocomplete="off"
                @input="setBlankResponse(currentQuestion, index - 1, $event)"
              >
            </label>
          </div>

          <label v-else class="response-field long-response">
            <span>{{ currentQuestion.type === 'PROGRAMMING' || currentQuestion.type === 'SQL_PROGRAMMING' ? '编写代码' : '写下你的答案' }}</span>
            <textarea
              :value="typeof currentPracticeResponse === 'string' ? currentPracticeResponse : ''"
              :aria-label="currentQuestion.type === 'PROGRAMMING' || currentQuestion.type === 'SQL_PROGRAMMING' ? '代码答案' : '文字答案'"
              :class="{ 'code-response': currentQuestion.type === 'PROGRAMMING' || currentQuestion.type === 'SQL_PROGRAMMING' }"
              :spellcheck="currentQuestion.type !== 'PROGRAMMING' && currentQuestion.type !== 'SQL_PROGRAMMING'"
              rows="7"
              @input="setTextResponse(currentQuestion, $event)"
            />
          </label>

          <div v-if="currentQuestion.imageUrls.length" class="question-images">
            <img
              v-for="(url, index) in currentQuestion.imageUrls"
              :key="url"
              :src="url"
              :alt="`题目图片 ${index + 1}`"
              loading="lazy"
              decoding="async"
              referrerpolicy="no-referrer"
            >
          </div>

          <div v-if="currentAnswerRequiresSubmit" class="response-actions">
            <button
              class="button button-dark submit-answer"
              type="button"
              :disabled="!canSubmitAnswer"
              @click="submitPracticeAnswer(currentQuestion)"
            >
              {{ currentAnswerSubmitted ? '更新本题作答' : '提交本题作答' }} <span aria-hidden="true">↗</span>
            </button>
          </div>

        </section>

        <section v-if="currentQuestion && hasCompletedQuestion(currentQuestion)" class="answer-panel" aria-label="参考答案">
          <div class="answer-heading">
            <span>REFERENCE ANSWER</span>
            <span>{{ currentAnswer?.problemStatus ? statusNames[currentAnswer.problemStatus] ?? currentAnswer.problemStatus : '' }}</span>
          </div>
          <div class="answer-text">
            <template v-if="currentAnswer">
              <MarkdownContent v-for="(line, index) in answerLines(currentAnswer)" :key="index" :content="line" />
            </template>
            <span v-else>尚未导入这道题的答案。</span>
          </div>
        </section>

      </article>

      <nav class="question-navigation" aria-label="题目导航">
        <button class="nav-button" type="button" :disabled="position === 0 || !hasQuestions" @click="moveQuestion(-1)">
          <span aria-hidden="true">←</span> 上一题
        </button>
        <div class="nav-center" aria-hidden="true"><span /><i /><span /></div>
        <button
          class="nav-button nav-next"
          type="button"
          :disabled="position >= activeQuestions.length - 1 || !hasQuestions"
          @click="moveQuestion(1)"
        >下一题 <span aria-hidden="true">→</span></button>
      </nav>
      </template>
    </section>
  </section>

  <dialog
    ref="progressDialog"
    class="progress-dialog"
    aria-labelledby="progress-dialog-title"
    @click.self="closeProgressDialog"
  >
    <div class="progress-dialog-content">
      <header class="progress-dialog-heading">
        <div>
          <p class="section-kicker">ROUND PROGRESS</p>
          <h2 id="progress-dialog-title">本轮做题进度</h2>
        </div>
        <button class="progress-dialog-close" type="button" aria-label="关闭进度窗口" @click="closeProgressDialog">×</button>
      </header>
      <div class="overview-progress">
        <span>已完成 <strong>{{ answeredQuestionCount }}</strong> / {{ activeQuestions.length }}</span>
        <span>{{ answeredQuestionCount === activeQuestions.length ? '本轮已完成 · 可开始二刷' : '点击题号可进入对应题目' }}</span>
      </div>
      <div class="progress-status-summary" aria-label="本轮判定统计">
        <span
          v-for="status in questionProgressStatuses"
          :key="status"
          class="progress-summary-item"
          :class="`progress-${status}`"
        >
          <span class="progress-status-symbol" aria-hidden="true">{{ questionProgressStatusSymbols[status] }}</span>
          {{ questionProgressStatusNames[status] }}
          <strong>{{ questionProgressStatusCounts.get(status) ?? 0 }}</strong>
        </span>
      </div>
      <nav class="question-number-grid" aria-label="题目状态导航">
        <button
          v-for="(question, index) in activeQuestions"
          :key="questionKey(question)"
          class="question-number-button"
          :class="`progress-${questionProgressStatus(question)}`"
          type="button"
          :aria-label="`本轮第 ${index + 1} 题（题库编号 ${question.number}，${typeLabel(question.type)}）：${questionProgressStatusNames[questionProgressStatus(question)]}`"
          @click="reviewFromProgress(index)"
        >{{ index + 1 }}</button>
      </nav>
      <p class="progress-dialog-note">题号使用本轮顺序；题目状态仅基于当前作答和已导入的评测记录。</p>
    </div>
  </dialog>
</template>
