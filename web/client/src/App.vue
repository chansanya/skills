<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Boxes, Download, FolderSync, Loader2, RefreshCw, Search } from 'lucide-vue-next'
import { api, type SkillDetail as Detail, type SkillSummary } from './api'
import SkillDetail from './components/SkillDetail.vue'
import ImportModal from './components/ImportModal.vue'
import SyncAgentsModal from './components/SyncAgentsModal.vue'

const skills = ref<SkillSummary[]>([])
const query = ref('')
const loading = ref(false)
const error = ref('')
const selected = ref<string | null>(null)
const detail = ref<Detail | null>(null)
const detailLoading = ref(false)
const showImport = ref(false)
const showSyncAgents = ref(false)
const skillDetailRef = ref<InstanceType<typeof SkillDetail> | null>(null)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return skills.value
  return skills.value.filter((s) => `${s.name} ${s.dir} ${s.description}`.toLowerCase().includes(q))
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    skills.value = await api.listSkills()
    if (selected.value && !skills.value.some((s) => s.dir === selected.value)) selected.value = null
    if (!selected.value && skills.value.length) await select(skills.value[0].dir)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function select(dir: string) {
  if (dir === selected.value && detail.value?.dir === dir) return
  if (dir !== selected.value && skillDetailRef.value && !skillDetailRef.value.confirmDiscard()) return
  selected.value = dir
  detailLoading.value = true
  try {
    detail.value = await api.getSkill(dir)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    detail.value = null
  } finally {
    detailLoading.value = false
  }
}

async function onFileSaved() {
  const dir = selected.value
  if (!dir) return
  try {
    const [updated, summaries] = await Promise.all([api.getSkill(dir), api.listSkills()])
    skills.value = summaries
    if (selected.value === dir) detail.value = updated
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function onInstalled(name: string) {
  await load()
  if (name === selected.value) await onFileSaved()
  else await select(name)
}

onMounted(load)
</script>

<template>
  <div class="layout">
    <header class="topbar">
      <div class="brand"><Boxes :size="20" />Skills 管理台</div>
      <div class="top-actions">
        <button class="btn" :disabled="!skills.length" @click="showSyncAgents = true"><FolderSync :size="15" />同步到 Agent</button>
        <button class="btn btn-primary" @click="showImport = true"><Download :size="15" />导入 Skill</button>
      </div>
    </header>

    <div class="main">
      <aside class="sidebar">
        <div class="search">
          <Search :size="15" class="muted" />
          <input v-model="query" placeholder="搜索名称或描述" />
          <button class="btn btn-icon" :disabled="loading" aria-label="刷新" @click="load">
            <RefreshCw :size="14" :class="{ spin: loading }" />
          </button>
        </div>
        <p v-if="error" class="error pad">{{ error }}</p>
        <ul class="list">
          <li v-for="s in filtered" :key="s.dir">
            <button class="item" :class="{ active: s.dir === selected }" @click="select(s.dir)">
              <span class="name">{{ s.name }}</span>
              <span class="desc muted">{{ s.description || '暂无描述' }}</span>
              <span class="count muted">{{ s.files.length }} 个资源文件</span>
            </button>
          </li>
        </ul>
        <p v-if="!loading && !filtered.length" class="muted pad">{{ skills.length ? '没有匹配的 Skill' : '暂无 Skill' }}</p>
      </aside>

      <main class="content">
        <div v-if="detailLoading" class="placeholder muted"><Loader2 :size="18" class="spin" />加载中…</div>
        <SkillDetail v-else-if="detail" ref="skillDetailRef" :skill="detail" @saved="onFileSaved" />
        <div v-else class="placeholder muted">选择左侧的 Skill 查看详情</div>
      </main>
    </div>

    <ImportModal v-if="showImport" @close="showImport = false" @installed="onInstalled" />
    <SyncAgentsModal v-if="showSyncAgents" :skills="skills" :initial-selected="selected" @close="showSyncAgents = false" />
  </div>
</template>

<style scoped>
.layout { height: 100%; display: flex; flex-direction: column; }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--border); background: var(--panel); }
.brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px; }
.top-actions { display: flex; gap: 8px; }
.main { flex: 1; min-height: 0; display: grid; grid-template-columns: 300px minmax(0, 1fr); }
.sidebar { border-right: 1px solid var(--border); display: flex; flex-direction: column; min-height: 0; }
.search { display: flex; align-items: center; gap: 8px; padding: 12px; border-bottom: 1px solid var(--border); }
.list { list-style: none; margin: 0; padding: 8px; overflow: auto; flex: 1; }
.item { width: 100%; text-align: left; display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 8px; border: 1px solid transparent; background: transparent; }
.item:hover { background: var(--panel-2); }
.item.active { background: var(--panel-2); border-color: var(--accent); }
.name { font-weight: 600; }
.desc { font-size: 12px; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.count { font-size: 11px; }
.pad { padding: 0 16px; }
.content { overflow: auto; padding: 20px 24px; }
.placeholder { height: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 760px) {
  .main { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .sidebar { border-right: none; border-bottom: 1px solid var(--border); max-height: 40vh; }
  .content { padding: 16px; }
  .topbar { padding: 10px 12px; }
}
</style>
