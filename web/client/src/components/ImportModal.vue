<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Archive, Download, FolderOpen, Globe, HelpCircle, Loader2, Sparkles, X } from 'lucide-vue-next'
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

function fillExample(type: 1 | 2 | 3) {
  if (type === 1) {
    source.value = 'https://skills.sh/vercel-labs/agent-skills/web-design-guidelines'
    skill.value = ''
  } else if (type === 2) {
    source.value = 'npx skills add vercel-labs/agent-skills --skill web-design-guidelines'
    skill.value = ''
  } else if (type === 3) {
    source.value = 'vercel-labs/agent-skills'
    skill.value = 'web-design-guidelines'
  }
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
    <div class="modal modal-wide" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h2><Download :size="16" />导入 Skill</h2>
        <button class="btn btn-icon" :disabled="running" aria-label="关闭" @click="close"><X :size="16" /></button>
      </div>

      <div class="tabs">
        <button type="button" class="tab" :class="{ active: tab === 'remote' }" :disabled="running" @click="switchTab('remote')">
          <Globe :size="14" />在线导入
        </button>
        <button type="button" class="tab" :class="{ active: tab === 'folder' }" :disabled="running" @click="switchTab('folder')">
          <FolderOpen :size="14" />本地文件夹
        </button>
        <button type="button" class="tab" :class="{ active: tab === 'archive' }" :disabled="running" @click="switchTab('archive')">
          <Archive :size="14" />压缩包
        </button>
      </div>

      <form class="modal-body" @submit.prevent="submit">
        <!-- 标签页 1：在线导入 -->
        <template v-if="tab === 'remote'">
          <div class="help-box">
            <div class="help-title"><HelpCircle :size="14" /><strong>填写说明（支持以下 3 种格式）：</strong></div>
            <ul class="help-list">
              <li><strong>写法 A（网页链接）：</strong>直接贴 <code>https://skills.sh/作者/仓库/skill名</code>（下方 Skill 名称可留空）</li>
              <li><strong>写法 B（完整命令）：</strong>直接贴 <code>npx skills add 作者/仓库 --skill skill名</code></li>
              <li><strong>写法 C（仓库名）：</strong>来源填 <code>作者/仓库</code>，下方 Skill 名称填具体要下载的技能目录名</li>
            </ul>
            <div class="example-bar">
              <span class="muted">点击快捷试用示例：</span>
              <button type="button" class="pill-btn" :disabled="running" @click="fillExample(1)"><Sparkles :size="12" />示例 1 (链接)</button>
              <button type="button" class="pill-btn" :disabled="running" @click="fillExample(2)"><Sparkles :size="12" />示例 2 (命令)</button>
              <button type="button" class="pill-btn" :disabled="running" @click="fillExample(3)"><Sparkles :size="12" />示例 3 (仓库)</button>
            </div>
          </div>

          <div class="field">
            <label>来源（Source）<span class="required">*</span></label>
            <input v-model="source" class="mono" placeholder="例如：https://skills.sh/vercel-labs/agent-skills/web-design-guidelines" :disabled="running" autofocus />
          </div>
          <div class="field">
            <label>Skill 名称（可选）</label>
            <input v-model="skill" class="mono" placeholder="来源链接或命令中未指定技能名称时才需填写，例如：web-design-guidelines" :disabled="running" />
            <span class="hint muted">如果上方来源已经写了 <code>--skill ...</code> 或末尾带了技能名，这里留空即可。</span>
          </div>
        </template>

        <!-- 标签页 2：本地文件夹 -->
        <template v-else-if="tab === 'folder'">
          <div class="help-box">
            <div class="help-title"><HelpCircle :size="14" /><strong>文件夹结构要求：</strong></div>
            <p class="help-desc">选择的文件夹内<strong>必须包含 <code>SKILL.md</code></strong>（顶部需带有 <code>name</code> 与 <code>description</code> 的 YAML Frontmatter）。文件夹内的附属目录（如 <code>resources/</code>、<code>scripts/</code>）会一并完整导入。</p>
          </div>

          <div class="field">
            <label>选择 Skill 文件夹 <span class="required">*</span></label>
            <input type="file" webkitdirectory directory multiple :disabled="running" @change="onFolderPick" />
            <span v-if="folderFiles.length" class="ok hint">已选定文件夹，包含 {{ folderFiles.length }} 个文件</span>
          </div>
          <div class="field">
            <label>存入仓库的目录名（可选）</label>
            <input v-model="customName" class="mono" placeholder="留空则自动读取 SKILL.md 里的 name，例如：my-tool" :disabled="running" />
          </div>
        </template>

        <!-- 标签页 3：压缩包 -->
        <template v-else>
          <div class="help-box">
            <div class="help-title"><HelpCircle :size="14" /><strong>压缩包格式说明：</strong></div>
            <p class="help-desc">支持 <code>.zip</code>、<code>.tar.gz</code>、<code>.tgz</code> 格式，最大 20MB。压缩包根目录或一层子目录中必须包含 <code>SKILL.md</code>，导入时会自动解压并做路径防穿越检查。</p>
          </div>

          <div class="field">
            <label>选择压缩包文件 <span class="required">*</span></label>
            <input type="file" accept=".zip,.tar.gz,.tgz" :disabled="running" @change="onArchivePick" />
            <span v-if="archiveFile" class="ok hint">已选中：{{ archiveFile.name }}（{{ (archiveFile.size / 1024).toFixed(1) }} KB）</span>
          </div>
          <div class="field">
            <label>存入仓库的目录名（可选）</label>
            <input v-model="customName" class="mono" placeholder="留空则自动读取 SKILL.md 里的 name，例如：my-tool" :disabled="running" />
          </div>
        </template>

        <label class="check">
          <input v-model="overwrite" type="checkbox" :disabled="running" />
          <span>若仓库已存在同名 Skill，允许直接覆盖替换</span>
        </label>

        <pre v-if="logs.length" ref="logEl" class="log">{{ logs.join('\n') }}</pre>
        <p v-if="error" class="error">{{ error }}</p>
        <p v-if="success" class="ok">{{ success }}</p>
      </form>

      <div class="modal-footer">
        <button class="btn btn-primary" :disabled="!canSubmit" @click="submit">
          <Loader2 v-if="running" :size="15" class="spin" />
          <Download v-else :size="15" />
          {{ running ? '正在安装导入…' : '确定导入' }}
        </button>
        <button class="btn" :disabled="running" @click="close">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-wide { width: min(650px, 94vw); }
.tabs { display: flex; gap: 4px; padding: 10px 18px 0; border-bottom: 1px solid var(--border); overflow-x: auto; }
.tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 12px; font-size: 13px; background: transparent;
  border: 0; border-bottom: 2px solid transparent; color: var(--muted); cursor: pointer; white-space: nowrap;
}
.tab.active { color: inherit; border-bottom-color: var(--accent, #58a6ff); font-weight: 600; }
.help-box {
  background: var(--panel-2, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 12px;
  line-height: 1.6;
}
.help-title { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.help-list { margin: 0; padding-left: 18px; }
.help-list li { margin: 3px 0; }
.help-desc { margin: 0; }
.example-bar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border);
}
.pill-btn {
  display: inline-flex; align-items: center; gap: 4px;
  background: rgba(88, 166, 255, 0.12);
  color: var(--accent, #58a6ff);
  border: 1px solid rgba(88, 166, 255, 0.3);
  border-radius: 12px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
}
.pill-btn:hover { background: rgba(88, 166, 255, 0.22); }
.required { color: var(--danger, #f85149); margin-left: 2px; }
.hint { font-size: 12px; margin-top: 4px; display: block; }
.hint code { font-size: 11px; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
