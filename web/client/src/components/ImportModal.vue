<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Archive, Download, FolderOpen, Globe, Loader2, X } from 'lucide-vue-next'
import { api } from '../api'

type Tab = 'remote' | 'folder' | 'archive'

const emit = defineEmits<{ close: []; installed: [name: string] }>()

const tab = ref<Tab>('remote')
const source = ref('')
const skill = ref('')
const folderFiles = ref<File[]>([])
const archiveFile = ref<File | null>(null)
const customName = ref('')
const overwrite = ref(false)
const running = ref(false)
const logs = ref<string[]>([])
const error = ref('')
const success = ref('')
const logEl = ref<HTMLPreElement>()

const canSubmit = computed(() => {
  if (running.value) return false
  if (tab.value === 'remote') return !!source.value.trim()
  if (tab.value === 'folder') return folderFiles.value.length > 0
  return !!archiveFile.value
})

function switchTab(next: Tab) {
  if (running.value) return
  tab.value = next
  error.value = ''
  success.value = ''
}

function onFolderPick(e: Event) {
  const input = e.target as HTMLInputElement
  folderFiles.value = Array.from(input.files ?? [])
  error.value = ''
  success.value = ''
}

function onArchivePick(e: Event) {
  const input = e.target as HTMLInputElement
  archiveFile.value = input.files?.[0] ?? null
  error.value = ''
  success.value = ''
}

async function append(line: string) {
  logs.value.push(line)
  await nextTick()
  logEl.value?.scrollTo({ top: logEl.value.scrollHeight })
}

async function submit() {
  if (!canSubmit.value) return
  running.value = true
  logs.value = []
  error.value = ''
  success.value = ''
  try {
    if (tab.value === 'remote') {
      await api.install(
        { source: source.value.trim(), skill: skill.value.trim() || undefined, overwrite: overwrite.value },
        {
          onLog: append,
          onDone: (r) => {
            success.value = `已安装 ${r.name}`
            emit('installed', r.name)
          },
          onError: (m) => (error.value = m),
        },
      )
    } else if (tab.value === 'folder') {
      const r = await api.importFolder(folderFiles.value, customName.value.trim() || undefined, overwrite.value)
      success.value = `${r.replaced ? '已覆盖并导入' : '已导入'} ${r.name}`
      emit('installed', r.name)
    } else if (archiveFile.value) {
      const r = await api.importArchive(archiveFile.value, customName.value.trim() || undefined, overwrite.value)
      success.value = `${r.replaced ? '已覆盖并导入' : '已导入'} ${r.name}`
      emit('installed', r.name)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    running.value = false
  }
}

function close() {
  if (!running.value) emit('close')
}
</script>

<template>
  <div class="modal-mask" @click.self="close">
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h2><Download :size="16" />导入 Skill</h2>
        <button class="btn btn-icon" :disabled="running" aria-label="关闭" @click="close"><X :size="16" /></button>
      </div>

      <div class="tabs">
        <button type="button" class="tab" :class="{ active: tab === 'remote' }" :disabled="running" @click="switchTab('remote')">
          <Globe :size="14" />skills.sh / GitHub
        </button>
        <button type="button" class="tab" :class="{ active: tab === 'folder' }" :disabled="running" @click="switchTab('folder')">
          <FolderOpen :size="14" />本地文件夹
        </button>
        <button type="button" class="tab" :class="{ active: tab === 'archive' }" :disabled="running" @click="switchTab('archive')">
          <Archive :size="14" />压缩包
        </button>
      </div>

      <form class="modal-body" @submit.prevent="submit">
        <template v-if="tab === 'remote'">
          <div class="field">
            <label>来源</label>
            <input v-model="source" class="mono" placeholder="owner/repo、GitHub / skills.sh 链接或 npx skills add ... 命令" :disabled="running" autofocus />
          </div>
          <div class="field">
            <label>Skill 名称（来源中已包含 --skill 或 skills.sh 链接带名称时可留空）</label>
            <input v-model="skill" class="mono" placeholder="web-design-guidelines" :disabled="running" />
          </div>
        </template>

        <template v-else-if="tab === 'folder'">
          <div class="field">
            <label>选择 Skill 文件夹（需包含 SKILL.md）</label>
            <input type="file" webkitdirectory directory multiple :disabled="running" @change="onFolderPick" />
            <span v-if="folderFiles.length" class="muted hint">已选择 {{ folderFiles.length }} 个文件</span>
          </div>
          <div class="field">
            <label>自定义 Skill 目录名（留空则使用 SKILL.md 中的 name）</label>
            <input v-model="customName" class="mono" placeholder="my-skill" :disabled="running" />
          </div>
        </template>

        <template v-else>
          <div class="field">
            <label>选择压缩包（支持 .zip / .tar.gz / .tgz，最大 20MB）</label>
            <input type="file" accept=".zip,.tar.gz,.tgz" :disabled="running" @change="onArchivePick" />
            <span v-if="archiveFile" class="muted hint">{{ archiveFile.name }}（{{ (archiveFile.size / 1024).toFixed(1) }} KB）</span>
          </div>
          <div class="field">
            <label>自定义 Skill 目录名（留空则使用 SKILL.md 中的 name）</label>
            <input v-model="customName" class="mono" placeholder="my-skill" :disabled="running" />
          </div>
        </template>

        <label class="check"><input v-model="overwrite" type="checkbox" :disabled="running" />覆盖同名 Skill</label>
        <pre v-if="logs.length" ref="logEl" class="log">{{ logs.join('\n') }}</pre>
        <p v-if="error" class="error">{{ error }}</p>
        <p v-if="success" class="ok">{{ success }}</p>
      </form>

      <div class="modal-footer">
        <button class="btn btn-primary" :disabled="!canSubmit" @click="submit">
          <Loader2 v-if="running" :size="15" class="spin" />
          <Download v-else :size="15" />
          {{ running ? '导入中…' : '确定导入' }}
        </button>
        <button class="btn" :disabled="running" @click="close">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tabs { display: flex; gap: 4px; padding: 10px 18px 0; border-bottom: 1px solid var(--border); }
.tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 12px; font-size: 13px; background: transparent;
  border: 0; border-bottom: 2px solid transparent; color: var(--muted); cursor: pointer;
}
.tab.active { color: inherit; border-bottom-color: var(--accent, #58a6ff); font-weight: 600; }
.hint { font-size: 12px; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
