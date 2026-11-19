<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  ArrowRight,
  Check,
  CheckCircle2,
  FolderSync,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  X,
  XCircle,
} from 'lucide-vue-next'
import {
  api,
  type AgentTarget,
  type MagpieStatus,
  type MigratableSkill,
  type SkillSummary,
  type SyncMode,
  type TargetSyncResult,
} from '../api'

const props = defineProps<{
  skills: SkillSummary[]
  initialSelected?: string | null
}>()

const emit = defineEmits<{ close: [] }>()

type ActiveTab = 'sync' | 'migrate'

const activeTab = ref<ActiveTab>('sync')
const magpie = ref<MagpieStatus | null>(null)
const loadingMagpie = ref(false)
const syncingMagpieManual = ref(false)

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
const envTab = ref<'wsl' | 'host'>('host')

// 迁移相关状态
const migratableSkills = ref<MigratableSkill[]>([])
const loadingMigratable = ref(false)
const migratingSkillName = ref<string | null>(null)
const migrateMessage = ref('')
const migrateOverwrite = ref(false)
const hideExisting = ref(false)

const unmanagedCount = computed(() => migratableSkills.value.filter((s) => !s.existsInMagpieLibrary).length)

const displayMigratableSkills = computed(() => {
  if (!hideExisting.value) return migratableSkills.value
  return migratableSkills.value.filter((s) => !s.existsInMagpieLibrary)
})

const wslTargets = computed(() => targets.value.filter((t) => t.env === 'wsl'))
const hostTargets = computed(() => targets.value.filter((t) => t.env === 'host'))
const hasWSL = computed(() => wslTargets.value.length > 0)
const hasHost = computed(() => hostTargets.value.length > 0)
const currentTargets = computed(() => (envTab.value === 'wsl' ? wslTargets.value : hostTargets.value))
const isCrossEnv = computed(() => currentTargets.value.some((t) => t.isCrossEnv))

const allSkillsSelected = computed(
  () => props.skills.length > 0 && selectedSkills.value.length === props.skills.length,
)

function toggleAllSkills() {
  selectedSkills.value = allSkillsSelected.value ? [] : props.skills.map((s) => s.dir)
}

function switchEnvTab(tab: 'wsl' | 'host') {
  if (envTab.value === tab) return
  envTab.value = tab
  customTargets.value = []
  const list = tab === 'wsl' ? wslTargets.value : hostTargets.value
  selectedTargets.value = list.filter((t) => t.parentExists || t.exists).map((t) => t.id)
  mode.value = isCrossEnv.value ? 'copy' : 'symlink'
}

function selectAllDetected() {
  const ids = currentTargets.value.filter((t) => t.parentExists || t.exists).map((t) => t.id)
  selectedTargets.value = Array.from(new Set([...selectedTargets.value, ...ids]))
}

function selectAllTargets() {
  selectedTargets.value = currentTargets.value.map((t) => t.id)
}

function clearAllTargets() {
  selectedTargets.value = []
  customTargets.value = []
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

async function loadMagpieStatus(refresh = false) {
  loadingMagpie.value = true
  try {
    magpie.value = refresh ? await api.refreshMagpie() : await api.getMagpieStatus()
  } catch {
    magpie.value = null
  } finally {
    loadingMagpie.value = false
  }
}

async function handleManualMagpieSync() {
  if (syncingMagpieManual.value) return
  syncingMagpieManual.value = true
  try {
    const res = await api.syncMagpie()
    await loadMagpieStatus(true)
    alert(res.message)
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e))
  } finally {
    syncingMagpieManual.value = false
  }
}

async function loadMigratableSkills() {
  loadingMigratable.value = true
  migrateMessage.value = ''
  try {
    migratableSkills.value = await api.listMigratableSkills()
  } catch (e) {
    migrateMessage.value = e instanceof Error ? e.message : String(e)
  } finally {
    loadingMigratable.value = false
  }
}

async function handleMigrate(item: MigratableSkill) {
  const key = `${item.agentKey}:${item.skillName}`
  migratingSkillName.value = key
  migrateMessage.value = ''
  try {
    const res = await api.migrateSkillToMagpie({
      agentKey: item.agentKey,
      skillName: item.skillName,
      overwrite: migrateOverwrite.value,
    })
    migrateMessage.value = res.message
    await loadMigratableSkills()
    await loadMagpieStatus(true)
    await loadTargets()
  } catch (e) {
    migrateMessage.value = e instanceof Error ? e.message : String(e)
  } finally {
    migratingSkillName.value = null
  }
}

async function handleMigrateAll() {
  const itemsToMigrate = displayMigratableSkills.value
  if (!itemsToMigrate.length) return

  const promptText = hideExisting.value
    ? `确定将未入库的 ${itemsToMigrate.length} 个 Skill 接入 Magpie 统一库吗？`
    : `确定将显示的全部 ${itemsToMigrate.length} 个 Skill 接入 Magpie 统一库并建立链接吗？${migrateOverwrite.value ? '（已开启同名覆盖）' : '（同名将保留统一库现有版本）'}`

  if (!confirm(promptText)) return

  for (const item of itemsToMigrate) {
    await handleMigrate(item)
  }
}

async function loadTargets() {
  loadingTargets.value = true
  error.value = ''
  try {
    await loadMagpieStatus()
    targets.value = await api.listAgentTargets()

    // 若检测到 Magpie 统一库，默认切换到包含 Magpie 目标的环境，并优先选中 Magpie 统一库
    const magpieTarget = targets.value.find((t) => t.isMagpieLibrary)
    if (magpieTarget) {
      envTab.value = magpieTarget.env
      selectedTargets.value = [magpieTarget.id]
      mode.value = 'copy'
    } else {
      const nativeTarget = targets.value.find((t) => !t.isCrossEnv)
      const defaultEnv = nativeTarget ? nativeTarget.env : (wslTargets.value.length > 0 ? 'wsl' : 'host')
      envTab.value = defaultEnv
      const activeTargets = defaultEnv === 'wsl' ? wslTargets.value : hostTargets.value
      selectedTargets.value = activeTargets.filter((t) => t.parentExists || t.exists).map((t) => t.id)
      mode.value = isCrossEnv.value ? 'copy' : 'symlink'
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loadingTargets.value = false
  }
}

watch([selectedSkills, selectedTargets, overwrite, mode], () => {
  if (results.value) results.value = null
})

watch(activeTab, (tab) => {
  if (tab === 'migrate') {
    loadMigratableSkills()
  }
})

async function submit() {
  if (syncing.value) return
  const allTargets = [...selectedTargets.value, ...customTargets.value]
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
      mode: isCrossEnv.value ? 'copy' : mode.value,
    })
    try {
      targets.value = await api.listAgentTargets()
      await loadMagpieStatus(true)
    } catch {
      // ignore
    }
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
        <div class="title-with-tabs">
          <h2><FolderSync :size="16" />Skill 下发与 Magpie 管理</h2>
          <div v-if="magpie?.detected" class="tab-pills">
            <button
              type="button"
              class="tab-pill"
              :class="{ active: activeTab === 'sync' }"
              @click="activeTab = 'sync'"
            >
              同步下发
            </button>
            <button
              type="button"
              class="tab-pill"
              :class="{ active: activeTab === 'migrate' }"
              @click="activeTab = 'migrate'"
            >
              迁移到统一库
            </button>
          </div>
        </div>
        <button class="btn btn-icon" :disabled="syncing" aria-label="关闭" @click="close"><X :size="16" /></button>
      </div>

      <div class="modal-body">
        <!-- Magpie 状态横幅 -->
        <div v-if="magpie?.detected" class="magpie-banner">
          <div class="magpie-brand">
            <span class="magpie-logo">🐦</span>
            <div>
              <div class="magpie-title">
                <strong>Magpie 统一库就绪</strong>
                <span v-if="magpie.version" class="badge badge-version">v{{ magpie.version }}</span>
                <span v-if="magpie.gatewayOnline" class="badge badge-ok">Gateway 在线</span>
                <span class="badge" :class="magpie.cliAvailable ? 'badge-ok' : 'badge-dim'">
                  {{ magpie.cliAvailable ? 'CLI 自动分发支持' : '手动分发' }}
                </span>
              </div>
              <p class="magpie-desc">
                已管理 {{ magpie.managedSkills.length }} 个技能。写入统一库后将自动通过 NTFS Junction 分发至各个 Agent。
              </p>
            </div>
          </div>
          <div class="magpie-actions">
            <button
              type="button"
              class="btn btn-sm"
              :disabled="loadingMagpie"
              title="重新检测 Magpie 状态"
              @click="loadMagpieStatus(true)"
            >
              <RefreshCw :size="12" :class="{ spin: loadingMagpie }" />
            </button>
            <button
              v-if="magpie.cliAvailable"
              type="button"
              class="btn btn-sm btn-ghost"
              :disabled="syncingMagpieManual"
              @click="handleManualMagpieSync"
            >
              <Loader2 v-if="syncingMagpieManual" :size="12" class="spin" />
              <Layers v-else :size="12" />
              触发分发
            </button>
          </div>
        </div>

        <!-- 标签页 1: 常规同步下发 -->
        <template v-if="activeTab === 'sync'">
          <!-- 1. 选择 Skill -->
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

          <!-- 2. 选择目标 Agent 目录 (WSL vs 主机) -->
          <div class="section">
            <div class="section-head">
              <div class="head-left">
                <label>选择目标 Agent 目录（已选 {{ selectedTargets.length + customTargets.length }} / {{ currentTargets.length }}）</label>
                <div v-if="hasWSL && hasHost" class="env-filter-tabs">
                  <button
                    type="button"
                    class="env-tab-btn"
                    :class="{ active: envTab === 'host' }"
                    @click="switchEnvTab('host')"
                  >
                    💻 主机
                  </button>
                  <button
                    type="button"
                    class="env-tab-btn"
                    :class="{ active: envTab === 'wsl' }"
                    @click="switchEnvTab('wsl')"
                  >
                    🐧 WSL
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

            <p v-if="loadingTargets" class="muted">正在检测 Agent 目录…</p>

            <div v-else class="target-list">
              <label
                v-for="t in currentTargets"
                :key="t.id"
                class="target-row"
                :class="{ 'target-magpie-lib': t.isMagpieLibrary }"
              >
                <input v-model="selectedTargets" type="checkbox" :value="t.id" :disabled="syncing" />
                <span class="target-name">
                  {{ t.label }}
                  <span v-if="t.isMagpieLibrary" class="badge badge-magpie-rec">首选推荐</span>
                </span>
                <code class="mono target-path" :title="t.path">{{ t.displayPath }}</code>
                <span v-if="t.magpieManaged" class="badge badge-warn" title="此 Agent 目录中已有 Magpie 管理的 Junction 条目">
                  ⚠ Magpie 管理中
                </span>
                <span v-if="t.isCrossEnv" class="badge badge-cross" title="跨环境同步：Windows 原生兼容">跨主机复制</span>
                <span class="badge" :class="t.exists ? 'badge-ok' : (t.parentExists ? 'badge-info' : 'badge-dim')">
                  {{ t.isMagpieLibrary ? '统一库' : (t.exists ? '已有目录' : (t.parentExists ? '已检测到 Agent' : '未检测到')) }}
                </span>
              </label>
            </div>

            <!-- 自定义目录 -->
            <div class="custom-row">
              <input
                v-model="customInput"
                class="mono"
                :placeholder="envTab === 'wsl' ? '自定义 WSL 目标目录，例如 ~/.my-agent/skills' : '自定义主机目标目录，例如 ~/my-agent/skills 或 C:/...'"
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

          <!-- 3. 同步选项 -->
          <div class="options-row">
            <label class="check"><input v-model="overwrite" type="checkbox" :disabled="syncing" />覆盖目标目录同名 Skill</label>
            <div v-if="isCrossEnv || selectedTargets.includes('magpie:library')" class="mode-group">
              <span class="muted">方式：</span>
              <span class="mode-fixed">实体复制</span>
              <span class="badge badge-cross" title="统一库与跨环境同步采用实体文件以确保 Junction 解析">实体文件</span>
            </div>
            <div v-else class="mode-group">
              <span class="muted">方式：</span>
              <label class="check"><input v-model="mode" type="radio" value="symlink" :disabled="syncing" />软链接</label>
              <label class="check"><input v-model="mode" type="radio" value="copy" :disabled="syncing" />复制文件</label>
            </div>
          </div>

          <p v-if="error" class="error">{{ error }}</p>

          <!-- 4. 同步结果展示 -->
          <div v-if="results" class="results">
            <div v-for="r in results" :key="r.id" class="result-block">
              <div class="result-head">
                <span class="env-pill" :class="r.env === 'host' ? 'pill-host' : 'pill-wsl'">
                  {{ r.id === 'magpie:library' ? '🐦 Magpie' : (r.env === 'host' ? '💻 主机' : '🐧 WSL') }}
                </span>
                <strong>{{ r.label }}</strong>
                <code class="mono muted">{{ r.displayPath }}</code>
              </div>
              <p v-if="r.magpieDistribution" class="magpie-dist-note">{{ r.magpieDistribution }}</p>
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
        </template>

        <!-- 标签页 2: 迁移到 Magpie 统一库 -->
        <template v-else-if="activeTab === 'migrate'">
          <div class="section">
            <div class="section-head">
              <label>检测各 Agent 目录中的孤岛 Skill（非 Junction 管理）</label>
              <div class="quick-actions">
                <label class="check migrate-chk" title="若统一库已存在同名 Skill 则强制用本地目录覆盖更新统一库">
                  <input v-model="migrateOverwrite" type="checkbox" />
                  覆盖统一库同名
                </label>
                <label class="check migrate-chk" title="仅查看尚未录入统一库的技能">
                  <input v-model="hideExisting" type="checkbox" />
                  仅看未入库 ({{ unmanagedCount }})
                </label>
                <button
                  v-if="migratableSkills.length > 0"
                  type="button"
                  class="btn btn-sm btn-primary"
                  :disabled="loadingMigratable || migratingSkillName !== null || displayMigratableSkills.length === 0"
                  @click="handleMigrateAll"
                >
                  一键全部迁移 ({{ displayMigratableSkills.length }})
                </button>
              </div>
            </div>

            <p v-if="loadingMigratable" class="muted">正在扫描各 Agent 目录中的独立技能…</p>

            <div v-else-if="!displayMigratableSkills.length" class="empty-box">
              <CheckCircle2 :size="24" class="ok" />
              <p v-if="migratableSkills.length > 0 && hideExisting">已隐藏全部 {{ migratableSkills.length }} 个统一库已存在的重复项。</p>
              <p v-else>太棒了！所有检测到的 Agent 技能均已接入 Magpie Junction 统一管理，无孤岛技能。</p>
            </div>

            <div v-else class="migrate-list">
              <div v-for="item in displayMigratableSkills" :key="`${item.agentKey}:${item.skillName}`" class="migrate-item">
                <div class="migrate-item-info">
                  <div class="migrate-title">
                    <span class="badge badge-info">{{ item.agentLabel }}</span>
                    <strong class="mono">{{ item.skillName }}</strong>
                    <span v-if="item.existsInMagpieLibrary" class="badge badge-warn">统一库中已存在</span>
                  </div>
                  <code class="mono muted migrate-path">{{ item.displayPath }}</code>
                </div>
                <button
                  type="button"
                  class="btn btn-sm btn-primary"
                  :disabled="migratingSkillName !== null"
                  @click="handleMigrate(item)"
                >
                  <Loader2 v-if="migratingSkillName === `${item.agentKey}:${item.skillName}`" :size="13" class="spin" />
                  <ArrowRight v-else :size="13" />
                  {{ item.existsInMagpieLibrary ? '入库更新' : '迁移入库' }}
                </button>
              </div>
            </div>

            <p v-if="migrateMessage" class="info-note">{{ migrateMessage }}</p>
          </div>
        </template>
      </div>

      <div class="modal-footer">
        <template v-if="activeTab === 'sync'">
          <template v-if="results">
            <button class="btn btn-primary" @click="close">
              <Check :size="15" />完成
            </button>
            <button class="btn" :disabled="syncing" @click="submit">
              <FolderSync :size="14" />重新同步
            </button>
          </template>
          <template v-else>
            <button class="btn btn-primary" :disabled="syncing || !selectedSkills.length" @click="submit">
              <Loader2 v-if="syncing" :size="15" class="spin" />
              <FolderSync v-else :size="15" />
              {{ syncing ? '同步中…' : '确认同步' }}
            </button>
            <button class="btn" :disabled="syncing" @click="close">关闭</button>
          </template>
        </template>
        <template v-else>
          <button class="btn" @click="close">关闭</button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-wide { width: min(760px, 94vw); }
.title-with-tabs { display: flex; align-items: center; gap: 16px; }
.tab-pills { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; padding: 2px; background: rgba(0,0,0,0.2); }
.tab-pill {
  background: transparent; border: 0; padding: 3px 12px; font-size: 12px;
  color: var(--muted); border-radius: 4px; cursor: pointer; transition: all .15s;
}
.tab-pill:hover { color: var(--fg); }
.tab-pill.active { background: rgba(88, 166, 255, 0.2); color: var(--accent, #58a6ff); font-weight: 600; }

.magpie-banner {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 14px; border-radius: 8px; border: 1px solid rgba(138, 92, 246, 0.35);
  background: linear-gradient(135deg, rgba(138, 92, 246, 0.1), rgba(59, 130, 246, 0.05));
  margin-bottom: 12px;
}
.magpie-brand { display: flex; align-items: center; gap: 10px; }
.magpie-logo { font-size: 22px; line-height: 1; }
.magpie-title { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.magpie-desc { margin: 2px 0 0; font-size: 12px; color: var(--muted); }
.magpie-actions { display: flex; align-items: center; gap: 6px; }
.badge-version { background: rgba(138, 92, 246, 0.2); color: #c084fc; font-size: 10px; }
.badge-magpie-rec { background: rgba(138, 92, 246, 0.25); color: #d8b4fe; border: 1px solid rgba(138, 92, 246, 0.4); font-weight: 600; }
.target-magpie-lib { border-color: rgba(138, 92, 246, 0.4); background: rgba(138, 92, 246, 0.05); }

.section { display: flex; flex-direction: column; gap: 8px; }
.section-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.head-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.env-filter-tabs { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: rgba(0,0,0,0.15); }
.env-tab-btn {
  background: transparent; border: 0; padding: 3px 10px; font-size: 12px;
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

.target-list { display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow-y: auto; padding-right: 2px; }
.target-row {
  display: flex; align-items: center; gap: 10px; padding: 8px 12px;
  border: 1px solid var(--border); border-radius: 6px; background: rgba(255, 255, 255, 0.02);
  font-size: 13px; cursor: pointer; transition: background .15s, border-color .15s;
}
.target-row:hover { background: var(--panel-2); border-color: rgba(255, 255, 255, 0.12); }
.target-name { font-weight: 600; min-width: 140px; flex-shrink: 0; display: flex; align-items: center; gap: 6px; }
.target-path {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; font-size: 12px; color: var(--muted);
}
.badge { flex-shrink: 0; white-space: nowrap; font-size: 11px; padding: 2px 7px; border-radius: 4px; line-height: 1.3; }
.badge-ok { background: rgba(63, 185, 80, 0.15); color: #3fb950; font-weight: 500; }
.badge-info { background: rgba(88, 166, 255, 0.15); color: var(--accent, #58a6ff); font-weight: 500; }
.badge-dim { background: rgba(139, 148, 158, 0.15); color: var(--muted); }
.badge-warn { background: rgba(210, 153, 34, 0.15); color: #d29922; }
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
.magpie-dist-note { color: #3fb950; font-size: 12px; margin: 4px 0 6px; font-weight: 500; }
.result-skills { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.result-item { display: flex; align-items: center; gap: 6px; }

/* 迁移界面样式 */
.migrate-list { display: flex; flex-direction: column; gap: 8px; max-height: 320px; overflow-y: auto; padding-right: 2px; }
.migrate-item {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 14px; border: 1px solid var(--border); border-radius: 6px; background: rgba(255, 255, 255, 0.02);
}
.migrate-item:hover { background: var(--panel-2); }
.migrate-item-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
.migrate-title { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.migrate-path { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.migrate-chk { font-size: 12px; }
.empty-box {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 36px 16px; text-align: center; color: var(--muted); font-size: 13px;
  border: 1px dashed var(--border); border-radius: 8px;
}
.info-note { font-size: 12px; color: var(--accent, #58a6ff); margin-top: 6px; }

.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>