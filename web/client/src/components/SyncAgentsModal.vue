<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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
const mode = ref<SyncMode>('copy')
const syncing = ref(false)
const error = ref('')
const results = ref<TargetSyncResult[] | null>(null)

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
    selectedTargets.value = targets.value.filter((t) => t.parentExists || t.exists).map((t) => t.id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loadingTargets.value = false
  }
}

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
          <label>选择目标 Agent 目录</label>
          <p v-if="loadingTargets" class="muted">正在检测本机 Agent 目录…</p>
          <div v-else class="target-list">
            <label v-for="t in targets" :key="t.id" class="target-row">
              <input v-model="selectedTargets" type="checkbox" :value="t.id" :disabled="syncing" />
              <span class="target-name">{{ t.label }}</span>
              <code class="mono muted">{{ t.displayPath }}</code>
              <span class="badge" :class="t.parentExists || t.exists ? 'badge-ok' : 'badge-dim'">
                {{ t.exists ? '已有目录' : t.parentExists ? '已检测到 Agent' : '未检测到' }}
              </span>
            </label>
          </div>

          <div class="custom-row">
            <input
              v-model="customInput"
              class="mono"
              placeholder="自定义目标目录，例如 ~/.my-agent/skills"
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
          <div class="mode-group">
            <span class="muted">方式：</span>
            <label class="check"><input v-model="mode" type="radio" value="copy" :disabled="syncing" />复制文件</label>
            <label class="check"><input v-model="mode" type="radio" value="symlink" :disabled="syncing" />软链接</label>
          </div>
        </div>

        <p v-if="error" class="error">{{ error }}</p>

        <div v-if="results" class="results">
          <div v-for="r in results" :key="r.id" class="result-block">
            <div class="result-head">
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
.modal-wide { width: min(680px, 94vw); }
.section { display: flex; flex-direction: column; gap: 8px; }
.section-head { display: flex; align-items: center; justify-content: space-between; }
.link-btn { background: none; border: 0; color: var(--accent, #58a6ff); cursor: pointer; font-size: 12px; padding: 0; }
.chip-grid { display: flex; flex-wrap: wrap; gap: 8px; max-height: 120px; overflow-y: auto; padding: 2px; }
.check-card {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 12px; border-radius: 8px; border: 1px solid var(--border);
  background: var(--panel-2); font-size: 13px; cursor: pointer;
  white-space: nowrap; transition: all .15s;
}
.check-card:hover { border-color: rgba(88, 166, 255, 0.4); }
.check-card.active { border-color: var(--accent, #58a6ff); background: rgba(88, 166, 255, 0.1); color: var(--accent, #58a6ff); font-weight: 500; }
.target-list { display: flex; flex-direction: column; gap: 6px; }
.target-row {
  display: flex; align-items: center; gap: 12px; padding: 10px 14px;
  border: 1px solid var(--border); border-radius: 8px; background: rgba(255, 255, 255, 0.02);
  font-size: 13px; cursor: pointer; transition: background .15s, border-color .15s;
}
.target-row:hover { background: var(--panel-2); border-color: rgba(255, 255, 255, 0.12); }
.target-name { font-weight: 600; min-width: 140px; flex-shrink: 0; }
.target-row code {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; font-size: 12px; color: var(--muted);
}
.badge { flex-shrink: 0; white-space: nowrap; font-size: 11px; padding: 3px 8px; border-radius: 4px; line-height: 1.3; }
.badge-ok { background: rgba(63, 185, 80, 0.15); color: #3fb950; font-weight: 500; }
.badge-dim { background: rgba(139, 148, 158, 0.15); color: var(--muted); }
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
.results { display: flex; flex-direction: column; gap: 8px; max-height: 190px; overflow: auto; padding-top: 4px; }
.result-block { border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; font-size: 12px; }
.result-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.result-skills { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.result-item { display: flex; align-items: center; gap: 6px; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
