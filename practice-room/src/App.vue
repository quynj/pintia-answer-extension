<script setup lang="ts">
import { onMounted, ref } from 'vue'
import LibraryView from './features/library/LibraryView.vue'
import { useQuestionLibrary } from './features/library/useQuestionLibrary'
import PracticeView from './features/practice/PracticeView.vue'
import { usePracticeSession } from './features/practice/usePracticeSession'

const screen = ref<'library' | 'practice'>('library')
const noticeText = ref('')
const noticeIsError = ref(false)

function setNotice(message: string, isError = false): void {
  noticeText.value = message
  noticeIsError.value = isError
}

const library = useQuestionLibrary(setNotice)
const practice = usePracticeSession(library.bank, library.answerMap, setNotice)

onMounted(() => {
  const catalogUrl = new URL(
    `${import.meta.env.BASE_URL}question-banks/catalog.json`,
    window.location.href
  ).href
  void library.loadPlatformBanks(catalogUrl)
})

function selectBank(key: string): void {
  if (library.activeBankKey.value === key) return

  const previousEntry = library.activeBankEntry.value
  if (previousEntry) {
    library.updateSession(previousEntry.key, practice.captureSession())
  }

  library.selectBank(key)
  const selectedEntry = library.activeBankEntry.value
  if (selectedEntry) practice.restoreSession(selectedEntry.session, selectedEntry.bank)
}

async function importBanks(files: File[]): Promise<void> {
  const selectedKey = await library.importFiles(files)
  if (selectedKey) selectBank(selectedKey)
}

function openPractice(key: string): void {
  selectBank(key)
  if (!library.bank.value) return
  screen.value = 'practice'
  setNotice(`正在练习「${library.bank.value.title}」。`)
}

function returnToLibrary(): void {
  screen.value = 'library'
  setNotice('')
}
</script>

<template>
  <div class="page-frame">
    <header class="masthead">
      <button class="wordmark wordmark-button" type="button" aria-label="题间题库" @click="returnToLibrary">
        <span class="wordmark-mark" aria-hidden="true">间</span>
        <span>题间<span class="wordmark-dot">.</span></span>
      </button>
      <div class="masthead-note">{{ screen === 'library' ? 'YOUR QUESTION LIBRARY' : 'PERSONAL STUDY ROOM' }} <span>·</span> 01</div>
      <button v-if="screen === 'practice'" class="header-button" type="button" @click="returnToLibrary">题库首页 <span aria-hidden="true">↗</span></button>
      <a
        v-else
        class="github-link"
        href="https://github.com/quynj/pintia-answer-extension/tree/main/practice-room"
        target="_blank"
        rel="noopener noreferrer"
      >项目仓库 <span aria-hidden="true">↗</span></a>
    </header>

    <main>
      <div v-if="noticeText" class="notice" :class="{ 'notice-error': noticeIsError }" role="status" aria-live="polite">
        {{ noticeText }}
      </div>
      <LibraryView
        v-if="screen === 'library'"
        :model="library"
        @import-banks="importBanks"
        @start-practice="openPractice"
      />
      <PracticeView
        v-else
        :model="practice"
        @return-to-library="returnToLibrary"
      />
    </main>

    <footer class="page-footer">
      <span>题间 / A QUIET PLACE TO PRACTICE</span>
      <span>作答留在你的设备 <i aria-hidden="true">✳</i></span>
    </footer>
  </div>
</template>
