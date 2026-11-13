<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileCode,
  FolderOpen,
  Globe,
  HelpCircle,
  Loader2,
  Search,
  Sparkles,
  X,
} from 'lucide-vue-next'
import { api, type InspectResult } from '../api'

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
const inspecting = ref(false)
const inspected = ref<InspectResult | null>(null)
const showFilesList = ref(false)
const error = ref('')
const success = ref('')

const canSubmit = computed(() => {
  if (running.value || inspecting.value) return false
  if (tab.value === 'remote') {
    return inspected.value ? true : !!source.value.trim()
  }
  if (tab.value === 'folder') return folderFiles.value.length > 0
  return !!archiveFile.value
})

function switchTab(next: Tab) {
  if (running.value || inspecting.value) return
  tab.value = next
  inspected.value = null
  showFilesList.value = false
  error.value = ''
  success.value = ''
}

function fillExample(type: 1 | 2 | 3) {
  inspected.value = null
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

function resetInspect() {
  inspected.value = null
  showFilesList.value = false
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

async function handleInspect() {
  if (!source.value.trim() || inspecting.value) return
  inspecting.value = true
  error.value = ''
  success.value = ''
  try {
    const res = await api.inspectSkill({
      source: source.value.trim(),
      skill: skill.value.trim() || undefined,
    })
    inspected.value = res
    if (res.existsLocally) {
      overwrite.value = true
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    inspecting.value = false
  }
}

async function submit() {
  if (!canSubmit.value) return

  // 在线导入未预检时，先触发预检
  if (tab.value === 'remote' && !inspected.value) {
    await handleInspect()
    return
  }

  running.value = true
  error.value = ''
  success.value = ''
  try {
    if (tab.value === 'remote' && inspected.value) {
      const r = await api.installInspected({
        inspectId: inspected.value.inspectId,
        overwrite: overwrite.value,
      })
      success.value = `已成功导入 Skill：${r.name}`
      emit('installed', r.name)
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
  if (!running.value && !inspecting.value) emit('close')
}
</script>

<template>
  <div class="modal-mask" @click.self="close">
    <div class="modal modal-wide" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h2><Download :size="16" />导入 Skill</h2>
        <button class="btn btn-icon" :disabled="running || inspecting" aria-label="关闭" @click="close"><X :size="16" /></button>
      </div>

      <div class="tabs">
        <button type="button" class="tab" :class="{ active: tab === 'remote' }" :disabled="running || inspecting" @click="switchTab('remote')">
          <Globe :size="14" />在线导入
        </button>
        <button type="button" class="tab" :class="{ active: tab === 'folder' }" :disabled="running || inspecting" @click="switchTab('folder')">
          <FolderOpen :size="14" />本地文件夹
        </button>
        <button type="button" class="tab" :class="{ active: tab === 'archive' }" :disabled="running || inspecting" @click="switchTab('archive')">
          <Archive :size="14" />压缩包
        </button>
      </div>

      <form class="modal-body" @submit.prevent="submit">
        <!-- 标签页 1：在线导入 -->
        <template v-if="tab === 'remote'">
          <!-- 第一阶段：未预检，输入来源并点击检测 -->
          <template v-if="!inspected">
            <div class="help-box">
              <div class="help-title"><HelpCircle :size="14" /><strong>填写说明（支持以下 3 种格式）：</strong></div>
              <ul class="help-list">
                <li><strong>写法 A（网页链接）：</strong>直接贴 <code>https://skills.sh/作者/仓库/skill名</code>（下方 Skill 名称留空）</li>
                <li><strong>写法 B（完整命令）：</strong>直接贴 <code>npx skills add 作者/仓库 --skill skill名</code></li>
                <li><strong>写法 C（仓库名）：</strong>来源填 <code>作者/仓库</code>，下方填具体技能目录名</li>
              </ul>
              <div class="example-bar">
                <span class="muted">点击快捷试用示例：</span>
                <button type="button" class="pill-btn" :disabled="inspecting" @click="fillExample(1)"><Sparkles :size="12" />示例 1 (链接)</button>
                <button type="button" class="pill-btn" :disabled="inspecting" @click="fillExample(2)"><Sparkles :size="12" />示例 2 (命令)</button>
                <button type="button" class="pill-btn" :disabled="inspecting" @click="fillExample(3)"><Sparkles :size="12" />示例 3 (仓库)</button>
              </div>
            </div>

            <div class="field">
              <label>来源（Source）<span class="required">*</span></label>
              <input v-model="source" class="mono" placeholder="例如：https://skills.sh/vercel-labs/agent-skills/web-design-guidelines" :disabled="inspecting" autofocus />
            </div>
            <div class="field">
              <label>Skill 名称（可选）</label>
              <input v-model="skill" class="mono" placeholder="来源链接或命令中未指定技能名称时才需填写，例如：web-design-guidelines" :disabled="inspecting" />
              <span class="hint muted">如果上方来源已经写了 <code>--skill ...</code> 或末尾带了技能名，这里留空即可。</span>
            </div>
          </template>

          <!-- 第二阶段：已预检，展示详情信息卡片，等待用户二次确认 -->
          <template v-else>
            <div class="preview-card">
              <div class="preview-header">
                <div class="preview-title">
                  <span class="badge-tag">预检成功</span>
                  <h3 class="mono skill-heading">{{ inspected.name }}</h3>
                </div>
                <button type="button" class="btn btn-sm btn-ghost" :disabled="running" @click="resetInspect">
                  <ArrowLeft :size="13" />返回修改
                </button>
              </div>

              <div class="preview-meta">
                <span class="muted">来自仓库：</span>
                <code class="mono">{{ inspected.repo }}</code>
              </div>

              <div class="preview-desc-box">
                <div class="desc-label muted">简介说明（Description）：</div>
                <div class="desc-content">{{ inspected.description || '（该技能未填写描述说明）' }}</div>
              </div>

              <div class="preview-files">
                <button type="button" class="files-toggle" @click="showFilesList = !showFilesList">
                  <FileCode :size="14" />
                  <span>包含 {{ inspected.files.length }} 个文件</span>
                  <component :is="showFilesList ? ChevronUp : ChevronDown" :size="14" />
                </button>
                <ul v-if="showFilesList" class="files-list mono">
                  <li v-for="f in inspected.files" :key="f">{{ f }}</li>
                </ul>
              </div>

              <div class="preview-status" :class="inspected.existsLocally ? 'status-warn' : 'status-ok'">
                <AlertTriangle v-if="inspected.existsLocally" :size="15" class="warn" />
                <CheckCircle2 v-else :size="15" class="ok" />
                <span>
                  {{
                    inspected.existsLocally
                      ? '本地仓库已存在同名 Skill，确认导入后将覆盖更新原有文件。'
                      : '本地检测通过，尚未存在该技能，可直接安全导入。'
                  }}
                </span>
              </div>
            </div>

            <label v-if="inspected.existsLocally" class="check">
              <input v-model="overwrite" type="checkbox" :disabled="running" />
              <span>确认覆盖已存在的同名 Skill 目录</span>
            </label>
          </template>
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

          <label class="check">
            <input v-model="overwrite" type="checkbox" :disabled="running" />
            <span>若仓库已存在同名 Skill，允许直接覆盖替换</span>
          </label>
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

          <label class="check">
            <input v-model="overwrite" type="checkbox" :disabled="running" />
            <span>若仓库已存在同名 Skill，允许直接覆盖替换</span>
          </label>
        </template>

        <p v-if="error" class="error">{{ error }}</p>
        <p v-if="success" class="ok">{{ success }}</p>
      </form>

      <div class="modal-footer">
        <template v-if="tab === 'remote' && !inspected">
          <button class="btn btn-primary" :disabled="!canSubmit || inspecting" @click="handleInspect">
            <Loader2 v-if="inspecting" :size="15" class="spin" />
            <Search v-else :size="15" />
            {{ inspecting ? '正在探测远程 Skill…' : '预检测 Skill 信息' }}
          </button>
          <button class="btn" :disabled="inspecting" @click="close">取消</button>
        </template>

        <template v-else-if="tab === 'remote' && inspected">
          <button class="btn btn-primary" :disabled="running || (inspected.existsLocally && !overwrite)" @click="submit">
            <Loader2 v-if="running" :size="15" class="spin" />
            <Download v-else :size="15" />
            {{ running ? '正在入库…' : '确认下载入库' }}
          </button>
          <button class="btn" :disabled="running" @click="resetInspect">返回修改</button>
          <button class="btn" :disabled="running" @click="close">取消</button>
        </template>

        <template v-else>
          <button class="btn btn-primary" :disabled="!canSubmit || running" @click="submit">
            <Loader2 v-if="running" :size="15" class="spin" />
            <Download v-else :size="15" />
            {{ running ? '正在导入…' : '确定导入' }}
          </button>
          <button class="btn" :disabled="running" @click="close">取消</button>
        </template>
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

/* 预检信息卡片 */
.preview-card {
  border: 1px solid var(--border);
  background: var(--panel-2);
  border-radius: 10px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.preview-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.skill-heading {
  margin: 0;
  font-size: 16px;
  color: var(--text);
}
.badge-tag {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(88, 166, 255, 0.15);
  color: var(--accent, #58a6ff);
  font-weight: 600;
}
.btn-sm { padding: 4px 10px; font-size: 12px; }
.btn-ghost { background: transparent; border-color: var(--border); }
.btn-ghost:hover { background: rgba(255, 255, 255, 0.05); }

.preview-meta {
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.preview-desc-box {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.desc-label { font-size: 11px; font-weight: 500; }
.desc-content {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text);
  white-space: pre-wrap;
}

.preview-files {
  font-size: 12px;
}
.files-toggle {
  background: none;
  border: 0;
  color: var(--accent, #58a6ff);
  padding: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 12px;
}
.files-toggle:hover { text-decoration: underline; }
.files-list {
  margin: 6px 0 0;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 4px;
  list-style: none;
  max-height: 120px;
  overflow-y: auto;
  font-size: 11px;
  color: var(--muted);
}
.files-list li { margin: 2px 0; }

.preview-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 8px 10px;
  border-radius: 6px;
}
.status-ok { background: rgba(63, 185, 80, 0.1); color: #3fb950; }
.status-warn { background: rgba(240, 180, 41, 0.12); color: #f0b429; }

.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
