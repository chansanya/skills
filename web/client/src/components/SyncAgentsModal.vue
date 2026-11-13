<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { CheckCircle2, FolderSync, Loader2, Plus, X, XCircle } from 'lucide-vue-next'
import { api, type AgentTarget, type SkillSummary, type SyncMode, type TargetSyncResult } from '../api'

const props = defineProps<{
  skills: SkillSummary[]
  initialSelected?: string | null
}>()

const emit = defineEmits<{ close: [] }>()

const targets = ref<AgentTarget[]>([])
const loadingTargets = ref(false)
const selectedSkills = ref<string[]>(props.skills.map((s) => s.dir))
const selectedTargets = ref<string[]>([])
const customInput = ref('')
const customTargets = ref<string[]>([])
const overwrite = ref(true)
const mode = ref<SyncMode>('symlink')
const syncing = ref(false)
const error = ref('')
const results = ref<TargetSyncResult[] | null>(null)
const envTab = ref<'all' | 'wsl' | 'host'>('all')

const wslTargets = computed(() => targets.value.filter((t) => t.env === 'wsl'))
const hostTargets = computed(() => targets.value.filter((t) => t.env === 'host'))
const hasHost = computed(() => hostTargets.value.length > 0)

const currentTabSelectedCount = computed(() => {
  if (envTab.value === 'wsl') {
    return wslTargets.value.filter((t) => selectedTargets.value.includes(t.id)).length
  }
  if (envTab.value === 'host') {
    return hostTargets.value.filter((t) => selectedTargets.value.includes(t.id)).length
  }
  return selectedTargets.value.length + customTargets.value.length
})

const effectiveTargets = computed(() => {
  let list = targets.value.filter((t) => selectedTargets.value.includes(t.id))
  if (envTab.value === 'wsl') {
    list = list.filter((t) => t.env === 'wsl')
    return list.map((t) => t.id)
  }
  if (envTab.value === 'host') {
    list = list.filter((t) => t.env === 'host')
    const winCustom = customTargets.value.filter((c) => /^[a-zA-Z]:[/\\]/.test(c.trim()))
    return [...list.map((t) => t.id), ...winCustom]
  }
  return [...list.map((t) => t.id), ...customTargets.value]
})

const hasCrossEnvSelected = computed(() => {
  if (envTab.value === 'wsl') return false
  if (envTab.value === 'host') return true
  const customCross = customTargets.value.some((c) => /^[a-zA-Z]:[/\\]/.test(c.trim()))
  const hostCross = hostTargets.value.some((t) => selectedTargets.value.includes(t.id))
  return customCross || hostCross
})

watch(
  hasCrossEnvSelected,
  (cross) => {
    if (cross) {
      mode.value = 'copy'
    } else {
      mode.value = 'symlink'
    }
  },
  { immediate: true },
)

function switchEnvTab(tab: 'all' | 'wsl' | 'host') {
  envTab.value = tab
  if (tab === 'wsl') {
    const wslOnly = selectedTargets.value.filter((id) =>
      wslTargets.value.some((t) => t.id === id),
    )
    selectedTargets.value = wslOnly.length
      ? wslOnly
      : wslTargets.value.filter((t) => t.parentExists || t.exists).map((t) => t.id)
  } else if (tab === 'host') {
    const hostOnly = selectedTargets.value.filter((id) =>
      hostTargets.value.some((t) => t.id === id),
    )
    selectedTargets.value = hostOnly.length
      ? hostOnly
      : hostTargets.value.filter((t) => t.parentExists || t.exists).map((t) => t.id)
  }
}

const displayedGroups = computed(() => {
  const groups: {
    key: 'wsl' | 'host'
    title: string
    icon: string
    items: AgentTarget[]
  }[] = []

  if (envTab.value === 'all' || envTab.value === 'wsl') {
    if (wslTargets.value.length) {
      groups.push({ key: 'wsl', title: 'WSL 环境 (Linux)', icon: '🐧', items: wslTargets.value })
    }
  }
  if (envTab.value === 'all' || envTab.value === 'host') {
    if (hostTargets.value.length) {
      groups.push({ key: 'host', title: 'Windows 主机环境 (Host)', icon: '🪟', items: hostTargets.value })
    }
  }
  return groups
})

function selectAllDetected() {
  if (envTab.value === 'wsl') {
    const ids = wslTargets.value.filter((t) => t.parentExists || t.exists).map((t) => t.id)
    selectedTargets.value = Array.from(new Set([...selectedTargets.value, ...ids]))
  } else if (envTab.value === 'host') {
    const ids = hostTargets.value.filter((t) => t.parentExists || t.exists).map((t) => t.id)
    selectedTargets.value = Array.from(new Set([...selectedTargets.value, ...ids]))
  } else {
    const ids = targets.value.filter((t) => t.parentExists || t.exists).map((t) => t.id)
    selectedTargets.value = Array.from(new Set([...selectedTargets.value, ...ids]))
  }
}

function selectAllTargets() {
  if (envTab.value === 'wsl') {
    const ids = wslTargets.value.map((t) => t.id)
    selectedTargets.value = Array.from(new Set([...selectedTargets.value, ...ids]))
  } else if (envTab.value === 'host') {
    const ids = hostTargets.value.map((t) => t.id)
    selectedTargets.value = Array.from(new Set([...selectedTargets.value, ...ids]))
  } else {
    selectedTargets.value = targets.value.map((t) => t.id)
  }
}

function clearAllTargets() {
  if (envTab.value === 'wsl') {
    const wslIds = wslTargets.value.map((t) => t.id)
    selectedTargets.value = selectedTargets.value.filter((id) => !wslIds.includes(id))
  } else if (envTab.value === 'host') {
    const hostIds = hostTargets.value.map((t) => t.id)
    selectedTargets.value = selectedTargets.value.filter((id) => !hostIds.includes(id))
  } else {
    selectedTargets.value = []
    customTargets.value = []
  }
}

function isGroupAllSelected(groupKey: 'wsl' | 'host'): boolean {
  const group = groupKey === 'wsl' ? wslTargets.value : hostTargets.value
  return group.length > 0 && group.every((t) => selectedTargets.value.includes(t.id))
}

function groupSelectedCount(groupKey: 'wsl' | 'host'): number {
  const group = groupKey === 'wsl' ? wslTargets.value : hostTargets.value
  return group.filter((t) => selectedTargets.value.includes(t.id)).length
}

function toggleGroup(groupKey: 'wsl' | 'host') {
  const group = groupKey === 'wsl' ? wslTargets.value : hostTargets.value
  const allInGroup = group.map((t) => t.id)
  if (isGroupAllSelected(groupKey)) {
    selectedTargets.value = selectedTargets.value.filter((id) => !allInGroup.includes(id))
  } else {
    selectedTargets.value = Array.from(new Set([...selectedTargets.value, ...allInGroup]))
  }
}

const allSkillsSelected = computed(
  () => props.skills.length > 0 && selectedSkills.value.length === props.skills.length,
)

function toggleAllSkills() {
  selectedSkills.value = allSkillsSelected.value ? [] : props.skills.map((s) => s.dir)
}

function addCustomTarget() {
  const val = customInput.value.trim()
  if (!val) return
  if (!customTargets.value.includes(val)) customTargets.value.push(val)
  customInput.value = ''
}

function removeCustomTarget(path: string) {
  customTargets.value = customTargets.value.filter((t) => t !== path)
}

async function loadTargets() {
  loadingTargets.value = true
  error.value = ''
  try {
    targets.value = await api.listAgentTargets()
    // 默认仅勾选当前平台（WSL）已检测到的 Agent 目录，保持默认轻量软链接体验
    const localDetected = targets.value
      .filter((t) => t.env === 'wsl' && (t.parentExists || t.exists))
      .map((t) => t.id)
    selectedTargets.value = localDetected.length
      ? localDetected
      : targets.value.filter((t) => t.parentExists || t.exists).map((t) => t.id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loadingTargets.value = false
  }
}

async function submit() {
  if (syncing.value) return
  const allTargets = effectiveTargets.value
  if (!selectedSkills.value.length) {
    error.value = '请至少选择一个 Skill'
    return
  }
  if (!allTargets.length) {
    error.value = '请至少选择一个目标 Agent 目录'
    return
  }

  syncing.value = true
  error.value = ''
  results.value = null
  try {
    results.value = await api.syncToAgents({
      skills: selectedSkills.value,
      targets: allTargets,
      overwrite: overwrite.value,
      mode: mode.value,
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    syncing.value = false
  }
}

function close() {
  if (!syncing.value) emit('close')
}

onMounted(loadTargets)
</script>

<template>
  <div class="modal-mask" @click.self="close">
    <div class="modal modal-wide" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h2><FolderSync :size="16" />同步 Skill 到 Agent 目录</h2>
        <button class="btn btn-icon" :disabled="syncing" aria-label="关闭" @click="close"><X :size="16" /></button>
      </div>

      <div class="modal-body">
        <div class="section">
          <div class="section-head">
            <label>选择要下发的 Skill（{{ selectedSkills.length }} / {{ skills.length }}）</label>
            <button type="button" class="link-btn" :disabled="syncing" @click="toggleAllSkills">
              {{ allSkillsSelected ? '取消全选' : '全选' }}
            </button>
          </div>
          <div class="chip-grid">
            <label
              v-for="s in skills"
              :key="s.dir"
              class="check-card"
              :class="{ active: selectedSkills.includes(s.dir) }"
            >
              <input v-model="selectedSkills" type="checkbox" :value="s.dir" :disabled="syncing" />
              <span class="mono">{{ s.dir }}</span>
            </label>
          </div>
        </div>

        <div class="section">
          <div class="section-head">
            <div class="head-left">
              <label>选择目标 Agent 目录（已选 {{ currentTabSelectedCount }}）</label>
              <div v-if="hasHost" class="env-filter-tabs">
                <button
                  type="button"
                  class="env-tab-btn"
                  :class="{ active: envTab === 'all' }"
                  @click="switchEnvTab('all')"
                >
                  全部 ({{ targets.length }})
                </button>
                <button
                  type="button"
                  class="env-tab-btn"
                  :class="{ active: envTab === 'wsl' }"
                  @click="switchEnvTab('wsl')"
                >
                  🐧 WSL ({{ wslTargets.length }})
                </button>
                <button
                  type="button"
                  class="env-tab-btn"
                  :class="{ active: envTab === 'host' }"
                  @click="switchEnvTab('host')"
                >
                  🪟 Windows 主机 ({{ hostTargets.length }})
                </button>
              </div>
            </div>
            <div class="quick-actions">
              <button type="button" class="link-btn" :disabled="syncing" @click="selectAllDetected">全选已检测</button>
              <span class="sep">|</span>
              <button type="button" class="link-btn" :disabled="syncing" @click="selectAllTargets">全选</button>
              <span class="sep">|</span>
              <button type="button" class="link-btn" :disabled="syncing" @click="clearAllTargets">清空</button>
            </div>
          </div>

          <p v-if="loadingTargets" class="muted">正在检测环境（WSL / Windows 主机）及 Agent 目录…</p>

          <div v-else class="groups-container">
            <div v-for="grp in displayedGroups" :key="grp.key" class="env-group-card">
              <div class="group-header">
                <div class="group-title">
                  <span class="grp-icon">{{ grp.icon }}</span>
                  <strong>{{ grp.title }}</strong>
                  <span class="count-badge">{{ groupSelectedCount(grp.key) }} / {{ grp.items.length }}</span>
                </div>
                <button
                  type="button"
                  class="link-btn"
                  :disabled="syncing"
                  @click="toggleGroup(grp.key)"
                >
                  {{ isGroupAllSelected(grp.key) ? '取消全选本组' : '全选本组' }}
                </button>
              </div>

              <div class="target-list">
                <label v-for="t in grp.items" :key="t.id" class="target-row">
                  <input v-model="selectedTargets" type="checkbox" :value="t.id" :disabled="syncing" />
                  <span class="target-name">{{ t.label }}</span>
                  <code class="mono target-path" :title="t.path">{{ t.displayPath }}</code>
                  <span v-if="t.isCrossEnv" class="badge badge-cross" title="跨环境同步：Windows 原生兼容">跨主机复制</span>
                  <span class="badge" :class="t.exists ? 'badge-ok' : (t.parentExists ? 'badge-info' : 'badge-dim')">
                    {{ t.exists ? '已有目录' : (t.parentExists ? '已检测到 Agent' : '未检测到') }}
                  </span>
                </label>
              </div>
            </div>
          </div>

          <div class="custom-row">
            <input
              v-model="customInput"
              class="mono"
              placeholder="自定义目标目录，例如 ~/.my-agent/skills 或 C:/Users/..."
              :disabled="syncing"
              @keydown.enter.prevent="addCustomTarget"
            />
            <button type="button" class="btn" :disabled="syncing || !customInput.trim()" @click="addCustomTarget">
              <Plus :size="14" />添加
            </button>
          </div>
          <div v-if="customTargets.length" class="custom-tags">
            <span v-for="c in customTargets" :key="c" class="tag mono">
              {{ c }}
              <button type="button" class="tag-x" :disabled="syncing" @click="removeCustomTarget(c)">×</button>
            </span>
          </div>
        </div>

        <div class="options-row">
          <label class="check"><input v-model="overwrite" type="checkbox" :disabled="syncing" />覆盖目标目录同名 Skill</label>
          <div v-if="hasCrossEnvSelected" class="mode-group">
            <span class="muted">方式：</span>
            <span class="mode-fixed">复制文件</span>
            <span class="badge badge-cross" title="目标包含 Windows 主机跨环境目录，不支持符号链接">跨环境仅支持文件复制</span>
          </div>
          <div v-else class="mode-group">
            <span class="muted">方式：</span>
            <label class="check"><input v-model="mode" type="radio" value="symlink" :disabled="syncing" />软链接</label>
            <label class="check"><input v-model="mode" type="radio" value="copy" :disabled="syncing" />复制文件</label>
          </div>
        </div>

        <p v-if="error" class="error">{{ error }}</p>

        <div v-if="results" class="results">
          <div v-for="r in results" :key="r.id" class="result-block">
            <div class="result-head">
              <span class="env-pill" :class="r.env === 'host' ? 'pill-host' : 'pill-wsl'">
                {{ r.env === 'host' ? '🪟 Windows' : '🐧 WSL' }}
              </span>
              <strong>{{ r.label }}</strong>
              <code class="mono muted">{{ r.displayPath }}</code>
            </div>
            <p v-if="r.error" class="error">{{ r.error }}</p>
            <ul v-else class="result-skills">
              <li v-for="sk in r.skills" :key="sk.skill" class="result-item">
                <CheckCircle2 v-if="sk.status === 'synced'" :size="14" class="ok" />
                <XCircle v-else-if="sk.status === 'error'" :size="14" class="error" />
                <span v-else class="muted">•</span>
                <span class="mono">{{ sk.skill }}</span>
                <span class="muted">{{ sk.message }}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-primary" :disabled="syncing || !selectedSkills.length" @click="submit">
          <Loader2 v-if="syncing" :size="15" class="spin" />
          <FolderSync v-else :size="15" />
          {{ syncing ? '同步中…' : '确认同步' }}
        </button>
        <button class="btn" :disabled="syncing" @click="close">关闭</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-wide { width: min(720px, 94vw); }
.section { display: flex; flex-direction: column; gap: 8px; }
.section-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.head-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.env-filter-tabs { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: rgba(0,0,0,0.15); }
.env-tab-btn {
  background: transparent; border: 0; padding: 2px 8px; font-size: 11px;
  color: var(--muted); cursor: pointer; transition: all .15s;
}
.env-tab-btn:hover { color: var(--fg); background: rgba(255, 255, 255, 0.04); }
.env-tab-btn.active { background: rgba(88, 166, 255, 0.15); color: var(--accent, #58a6ff); font-weight: 500; }

.quick-actions { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.sep { color: var(--border); font-size: 10px; }
.link-btn { background: none; border: 0; color: var(--accent, #58a6ff); cursor: pointer; font-size: 12px; padding: 0; }
.link-btn:hover { text-decoration: underline; }

.chip-grid { display: flex; flex-wrap: wrap; gap: 8px; max-height: 100px; overflow-y: auto; padding: 2px; }
.check-card {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 12px; border-radius: 8px; border: 1px solid var(--border);
  background: var(--panel-2); font-size: 13px; cursor: pointer;
  white-space: nowrap; transition: all .15s;
}
.check-card:hover { border-color: rgba(88, 166, 255, 0.4); }
.check-card.active { border-color: var(--accent, #58a6ff); background: rgba(88, 166, 255, 0.1); color: var(--accent, #58a6ff); font-weight: 500; }

.groups-container {
  display: flex; flex-direction: column; gap: 12px;
  max-height: 300px; overflow-y: auto; padding-right: 4px;
}
.env-group-card {
  border: 1px solid var(--border); border-radius: 8px; background: rgba(255, 255, 255, 0.015);
  padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;
}
.group-header {
  display: flex; align-items: center; justify-content: space-between;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.08); padding-bottom: 6px;
}
.group-title { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.grp-icon { font-size: 14px; }
.count-badge { font-size: 11px; color: var(--muted); background: var(--panel-2); padding: 1px 6px; border-radius: 10px; }

.target-list { display: flex; flex-direction: column; gap: 5px; }
.target-row {
  display: flex; align-items: center; gap: 10px; padding: 7px 10px;
  border: 1px solid var(--border); border-radius: 6px; background: rgba(255, 255, 255, 0.02);
  font-size: 13px; cursor: pointer; transition: background .15s, border-color .15s;
}
.target-row:hover { background: var(--panel-2); border-color: rgba(255, 255, 255, 0.12); }
.target-name { font-weight: 600; min-width: 130px; flex-shrink: 0; }
.target-path {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; font-size: 12px; color: var(--muted);
}
.badge { flex-shrink: 0; white-space: nowrap; font-size: 11px; padding: 2px 7px; border-radius: 4px; line-height: 1.3; }
.badge-ok { background: rgba(63, 185, 80, 0.15); color: #3fb950; font-weight: 500; }
.badge-info { background: rgba(88, 166, 255, 0.15); color: var(--accent, #58a6ff); font-weight: 500; }
.badge-dim { background: rgba(139, 148, 158, 0.15); color: var(--muted); }
.badge-cross { background: rgba(210, 153, 34, 0.15); color: #d29922; font-size: 10px; }

.custom-row { display: flex; gap: 8px; margin-top: 4px; }
.custom-row input { flex: 1; }
.custom-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.tag { display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: 4px; background: var(--panel-2); font-size: 12px; }
.tag-x { background: none; border: 0; color: var(--muted); cursor: pointer; font-size: 14px; line-height: 1; }

.options-row {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;
  padding: 8px 0 0; border-top: 1px dashed var(--border);
}
.mode-group { display: flex; align-items: center; gap: 12px; font-size: 13px; }
.mode-fixed { font-weight: 500; font-size: 13px; color: var(--fg); }

.results { display: flex; flex-direction: column; gap: 8px; max-height: 190px; overflow: auto; padding-top: 4px; }
.result-block { border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; font-size: 12px; }
.result-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.env-pill { font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 600; }
.pill-wsl { background: rgba(88, 166, 255, 0.15); color: var(--accent, #58a6ff); }
.pill-host { background: rgba(210, 153, 34, 0.15); color: #d29922; }
.result-skills { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.result-item { display: flex; align-items: center; gap: 6px; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
