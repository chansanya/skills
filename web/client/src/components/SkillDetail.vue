<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { Code, Eye, FileText, FolderTree } from 'lucide-vue-next'
import { api, type SkillDetail, type SkillFileContent } from '../api'
import FileTree from './FileTree.vue'

const props = defineProps<{ skill: SkillDetail }>()

const selectedPath = ref('SKILL.md')
const rawMode = ref(false)
const fileLoading = ref(false)
const fileError = ref('')
const loadedFile = ref<SkillFileContent | null>(null)
let requestSeq = 0

watch(
  () => props.skill.dir,
  () => {
    selectedPath.value = 'SKILL.md'
    rawMode.value = false
    loadedFile.value = null
    fileError.value = ''
    fileLoading.value = false
    requestSeq++
  },
)

const isMarkdown = computed(() => selectedPath.value.toLowerCase().endsWith('.md'))

const activeText = computed(() => {
  if (selectedPath.value === 'SKILL.md') {
    return rawMode.value ? props.skill.content : props.skill.body
  }
  return loadedFile.value?.content ?? ''
})

const renderedHtml = computed(() => {
  if (!isMarkdown.value || rawMode.value) return ''
  return DOMPurify.sanitize(marked.parse(activeText.value, { async: false }) as string)
})

async function selectFile(filePath: string) {
  selectedPath.value = filePath
  rawMode.value = false
  fileError.value = ''

  if (filePath === 'SKILL.md') {
    loadedFile.value = null
    fileLoading.value = false
    return
  }

  const seq = ++requestSeq
  fileLoading.value = true
  loadedFile.value = null
  try {
    const res = await api.getSkillFile(props.skill.dir, filePath)
    if (seq !== requestSeq) return
    loadedFile.value = res
  } catch (err) {
    if (seq !== requestSeq) return
    fileError.value = err instanceof Error ? err.message : String(err)
  } finally {
    if (seq === requestSeq) fileLoading.value = false
  }
}
</script>

<template>
  <article class="detail">
    <header class="head">
      <h1>{{ skill.name }}</h1>
      <p class="muted">{{ skill.description || '暂无描述' }}</p>
      <code class="mono muted">{{ skill.dir }}/{{ selectedPath }}</code>
    </header>
    <div class="grid">
      <section class="card markdown-card">
        <div class="card-head">
          <h3><FileText :size="15" />{{ selectedPath }}</h3>
          <button
            v-if="isMarkdown && !fileLoading && !fileError && (selectedPath === 'SKILL.md' || loadedFile?.content !== null)"
            type="button"
            class="toggle-btn"
            @click="rawMode = !rawMode"
          >
            <Code v-if="!rawMode" :size="13" />
            <Eye v-else :size="13" />
            <span>{{ rawMode ? '预览' : '源码' }}</span>
          </button>
        </div>

        <p v-if="fileLoading" class="muted state-msg">正在加载文件内容…</p>
        <p v-else-if="fileError" class="err state-msg">{{ fileError }}</p>
        <p v-else-if="loadedFile?.tooLarge" class="muted state-msg">文件过大（超过 512 KB），暂不支持在线预览。</p>
        <p v-else-if="loadedFile?.binary" class="muted state-msg">二进制文件暂不支持文本预览。</p>
        <div v-else-if="isMarkdown && !rawMode" class="markdown" v-html="renderedHtml" />
        <pre v-else class="code-viewer"><code class="mono">{{ activeText }}</code></pre>
      </section>
      <aside class="card tree-card">
        <h3><FolderTree :size="15" />文件结构</h3>
        <FileTree :nodes="skill.tree" :selected-path="selectedPath" @select="selectFile" />
      </aside>
    </div>
  </article>
</template>

<style scoped>
.detail { display: flex; flex-direction: column; gap: 16px; }
.head h1 { margin: 0 0 6px; font-size: 22px; }
.head p { margin: 0 0 8px; line-height: 1.6; }
.head code { font-size: 12px; }
.grid { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 16px; align-items: start; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 18px; }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
.card-head h3 { margin: 0; }
.card h3 { margin: 0 0 12px; font-size: 13px; color: var(--muted); display: flex; align-items: center; gap: 6px; font-weight: 600; }
.card-head h3 { margin: 0; }
.toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.toggle-btn:hover { color: inherit; border-color: var(--muted); }
.state-msg { margin: 12px 0; font-size: 13px; }
.err { color: var(--danger, #f85149); }
.code-viewer {
  margin: 0;
  padding: 14px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border);
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.55;
  white-space: pre;
}
.tree-card { position: sticky; top: 0; }
@media (max-width: 960px) {
  .grid { grid-template-columns: 1fr; }
  .tree-card { position: static; order: -1; }
}
</style>
