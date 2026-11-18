<script setup lang="ts">
import { useQuestionLibrary } from './useQuestionLibrary'

const props = defineProps<{
  model: ReturnType<typeof useQuestionLibrary>
}>()
const emit = defineEmits<{
  'import-banks': [files: File[]]
  'start-practice': [key: string]
}>()

const {
  bankEntries,
  activeBankKey,
  isPlatformBankLoading,
  mergeSelection,
  handleAnswerChange,
  mergeSelectedBanks,
  toggleAllBanksSelection
} = props.model

function handleBankChange(event: Event): void {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  const files = Array.from(input.files ?? [])
  if (files.length === 0) return
  input.value = ''
  emit('import-banks', files)
}
</script>

<template>
  <section class="intro library-intro">
    <div class="intro-copy">
      <p class="eyebrow"><span class="eyebrow-line" />01 / YOUR LIBRARY</p>
      <h1>把题库，<em>收好。</em></h1>
      <p class="intro-text">分别整理题库与对应答案，也可以勾选多份合并成一套，再进入独立的练习空间。</p>
    </div>
    <div class="intro-index" aria-hidden="true">
      <span>QUESTION BANKS</span>
      <strong>{{ String(bankEntries.length).padStart(2, '0') }}<span> / </span>∞</strong>
      <small>一份题库，一份对应答案。</small>
    </div>
  </section>

  <section class="library-workspace" aria-label="题库管理">
    <div class="library-toolbar">
      <div>
        <p class="section-kicker">01 / IMPORT</p>
        <h2>我的题库 <span>{{ String(bankEntries.length).padStart(2, '0') }}</span></h2>
      </div>
      <div class="library-actions">
        <button
          v-if="bankEntries.length > 1"
          class="select-all-banks"
          type="button"
          @click="toggleAllBanksSelection"
        >{{ mergeSelection.length === bankEntries.length ? '取消全选' : '全选题库' }}</button>
        <button
          v-if="mergeSelection.length > 1"
          class="button button-accent merge-banks-button"
          type="button"
          @click="mergeSelectedBanks"
        >合并 {{ mergeSelection.length }} 个题库 <span aria-hidden="true">＋</span></button>
        <label class="button button-dark import-banks-button">
          <span>＋ 导入题库与答案</span><span aria-hidden="true">多选 JSON ↗</span>
          <input class="visually-hidden" type="file" accept=".json,application/json" multiple @change="handleBankChange">
        </label>
      </div>
    </div>

    <p v-if="bankEntries.length === 0" class="library-empty">
      <span class="empty-mark" aria-hidden="true">＋</span>
      <strong>{{ isPlatformBankLoading ? '正在载入本平台题库' : '从第一份题库开始' }}</strong>
      <span>{{ isPlatformBankLoading ? '正在读取题库目录与配套答案。' : '平台题库会自动载入；也可以导入自己的题库和答案，或合并多份题库。' }}</span>
    </p>

    <div v-else class="bank-grid">
      <article
        v-for="(entry, index) in bankEntries"
        :key="entry.key"
        class="bank-card"
        :class="{ 'bank-card-active': entry.key === activeBankKey }"
      >
        <div class="bank-card-top">
          <span class="bank-index">{{ String(index + 1).padStart(2, '0') }}</span>
          <span class="bank-identity">{{ entry.isPlatformBank ? 'PLATFORM BANK' : entry.bank.problemSetId ? `ID ${entry.bank.problemSetId}` : 'LOCAL BANK' }}</span>
          <span v-if="entry.key === activeBankKey" class="active-bank-tag">最近练习</span>
          <label class="bank-select">
            <input v-model="mergeSelection" type="checkbox" :value="entry.key">
            <span>合并</span>
          </label>
        </div>
        <h3>{{ entry.bank.title }}</h3>
        <p class="bank-card-summary">
          {{ entry.bank.questions.length }} 道题
          <span aria-hidden="true">·</span>
          总分 {{ entry.bank.totalScore === null ? '未提供' : `${entry.bank.totalScore} 分` }}
        </p>
        <p class="file-name">{{ entry.bankFileName }}</p>
        <div class="bank-answer-row">
          <label v-if="!entry.isMerged" class="file-picker file-picker-compact">
            <span class="picker-icon picker-icon-small" aria-hidden="true">↥</span>
            <span>
              <strong>{{ entry.answerFileName ? '更换对应答案' : '导入对应答案' }}</strong>
              <small>{{ entry.answerFileName ? `${entry.answers.size} 条答案` : '按题目 ID 自动匹配' }}</small>
            </span>
            <input class="visually-hidden" type="file" accept=".json,application/json" @change="handleAnswerChange(entry.key, $event)">
          </label>
          <span v-if="entry.isMerged" class="merged-answer-note">{{ entry.answers.size }} 条答案随题库合并</span>
          <span v-else-if="entry.answerFileName" class="answer-imported" aria-label="已导入答案">已配对</span>
        </div>
        <div class="bank-card-actions">
          <button class="button button-dark start-practice" type="button" @click="emit('start-practice', entry.key)">
            开始刷题 <span aria-hidden="true">↗</span>
          </button>
        </div>
      </article>
    </div>

    <footer class="library-footer">
      <span class="privacy-seal" aria-hidden="true">本地<br>处理</span>
      <p>题库、答案与作答只在当前标签页内处理；刷新页面后需重新导入。</p>
    </footer>
  </section>
</template>
