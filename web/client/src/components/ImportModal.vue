<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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
  Github,
  Globe,
  HelpCircle,
  Loader2,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-vue-next'
import {
  api,
  type FavoriteSkill,
  type InspectResult,
  type RecommendedSkill,
  type RepositoryAnalysisResult,
  type RepositoryInstallResult,
  type SkillSummary,
  type SkillSearchResult,
} from '../api'

type Tab = 'remote' | 'favorites' | 'folder' | 'archive'
type RemoteSource = 'skills' | 'github'

const emit = defineEmits<{ close: []; installed: [name: string] }>()

const tab = ref<Tab>('remote')
const remoteSource = ref<RemoteSource>('skills')
const source = ref('')
const searchQuery = ref('')
const searchResults = ref<SkillSearchResult[]>([])
const selectedSearchResult = ref<SkillSearchResult | null>(null)
const searchCompleted = ref(false)
const recommendedSkills = ref<RecommendedSkill[]>([])
const localSkillNames = ref<Set<string>>(new Set())
const favorites = ref<FavoriteSkill[]>([])
const favoriteFilter = ref('')
const repositoryAnalysis = ref<RepositoryAnalysisResult | null>(null)
const selectedRepositorySkills = ref<string[]>([])
const repositoryMetadataMode = ref<'normalize' | 'preserve'>('normalize')
const repositoryOverwrite = ref(false)
const repositoryInstallResults = ref<RepositoryInstallResult[]>([])
const folderFiles = ref<File[]>([])
const archiveFile = ref<File | null>(null)
const customName = ref('')
const overwrite = ref(false)
const running = ref(false)
const inspecting = ref(false)
const searching = ref(false)
const analyzingRepository = ref(false)
const inspected = ref<InspectResult | null>(null)
const showFilesList = ref(false)
const error = ref('')
const success = ref('')

const busy = computed(() => running.value || inspecting.value || searching.value || analyzingRepository.value)
const canSearch = computed(() => !busy.value && !!searchQuery.value.trim())
const uninstalledRecommendedSkills = computed(() =>
  recommendedSkills.value.filter((rec) => !localSkillNames.value.has(rec.name)),
)
const filteredFavorites = computed(() => {
  const q = favoriteFilter.value.trim().toLowerCase()
  if (!q) return favorites.value
  return favorites.value.filter(
    (f) =>
      f.name.toLowerCase().includes(q) ||
      f.source.toLowerCase().includes(q) ||
      (f.description && f.description.toLowerCase().includes(q)),
  )
})
const repositoryImportableSkills = computed(() =>
  repositoryAnalysis.value?.skills.filter((item) => item.status !== 'invalid') ?? [],
)
const repositoryCompatibleSkills = computed(() =>
  repositoryAnalysis.value?.skills.filter((item) => item.status === 'compatible') ?? [],
)
const repositoryInvalidSkills = computed(() =>
  repositoryAnalysis.value?.skills.filter((item) => item.status === 'invalid') ?? [],
)
const selectedRepositoryCandidates = computed(() =>
  repositoryImportableSkills.value.filter((item) => selectedRepositorySkills.value.includes(item.id)),
)
const selectedRepositoryConflicts = computed(() =>
  selectedRepositoryCandidates.value.filter((item) =>
    repositoryMetadataMode.value === 'preserve' ? item.preserveExistsLocally : item.existsLocally,
  ),
)
const selectedCompatibleSkills = computed(() =>
  selectedRepositoryCandidates.value.filter((item) => item.status === 'compatible'),
)
const canPreserveSelected = computed(() => selectedRepositoryCandidates.value.every((item) => item.canPreserve))
const canAnalyzeRepository = computed(() => !busy.value && !!source.value.trim())
const canInstallRepository = computed(() =>
  !busy.value &&
  !!repositoryAnalysis.value &&
  selectedRepositorySkills.value.length > 0 &&
  (repositoryMetadataMode.value !== 'preserve' || canPreserveSelected.value) &&
  (!selectedRepositoryConflicts.value.length || repositoryOverwrite.value),
)
const canInspect = computed(() => {
  if (busy.value) return false
  if (remoteSource.value === 'skills') return !!selectedSearchResult.value
  return false
})
const canSubmit = computed(() => {
  if (busy.value) return false
  if (tab.value === 'remote') {
    if (remoteSource.value === 'github') return repositoryAnalysis.value ? canInstallRepository.value : canAnalyzeRepository.value
    return inspected.value ? true : canInspect.value
  }
  if (tab.value === 'folder') return folderFiles.value.length > 0
  return !!archiveFile.value
})

function clearMessages() {
  error.value = ''
  success.value = ''
}

function resetInspect() {
  inspected.value = null
  showFilesList.value = false
  clearMessages()
}

function resetSearchResults() {
  searchResults.value = []
  selectedSearchResult.value = null
  searchCompleted.value = false
  source.value = ''
  resetInspect()
}

function resetRepositoryAnalysis() {
  repositoryAnalysis.value = null
  selectedRepositorySkills.value = []
  repositoryMetadataMode.value = 'normalize'
  repositoryOverwrite.value = false
  repositoryInstallResults.value = []
  resetInspect()
}

function switchTab(next: Tab) {
  if (busy.value) return
  tab.value = next
  resetInspect()
  if (next === 'favorites') {
    api.getFavorites().then((favs) => {
      favorites.value = favs
    }).catch(() => {})
  }
}

function switchRemoteSource(next: RemoteSource) {
  if (busy.value || remoteSource.value === next) return
  remoteSource.value = next
  source.value = ''
  searchQuery.value = ''
  searchResults.value = []
  selectedSearchResult.value = null
  searchCompleted.value = false
  repositoryAnalysis.value = null
  selectedRepositorySkills.value = []
  repositoryMetadataMode.value = 'normalize'
  repositoryOverwrite.value = false
  repositoryInstallResults.value = []
  resetInspect()
}

function selectSearchResult(result: SkillSearchResult) {
  selectedSearchResult.value = result
  source.value = result.source
  resetInspect()
}

function formatInstalls(count: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(count)
}

function toggleRepositorySkill(id: string) {
  selectedRepositorySkills.value = selectedRepositorySkills.value.includes(id)
    ? selectedRepositorySkills.value.filter((item) => item !== id)
    : [...selectedRepositorySkills.value, id]
  if (repositoryMetadataMode.value === 'preserve' && !canPreserveSelected.value) repositoryMetadataMode.value = 'normalize'
  if (!selectedRepositoryConflicts.value.length) repositoryOverwrite.value = false
  clearMessages()
}

function toggleAllRepositorySkills() {
  const importableIds = repositoryImportableSkills.value.map((item) => item.id)
  selectedRepositorySkills.value = selectedRepositorySkills.value.length === importableIds.length ? [] : importableIds
  if (repositoryMetadataMode.value === 'preserve' && !canPreserveSelected.value) repositoryMetadataMode.value = 'normalize'
  if (!selectedRepositoryConflicts.value.length) repositoryOverwrite.value = false
  clearMessages()
}

function setRepositoryMetadataMode(mode: 'normalize' | 'preserve') {
  if (mode === 'preserve' && !canPreserveSelected.value) return
  repositoryMetadataMode.value = mode
  repositoryOverwrite.value = false
  clearMessages()
}

function onFolderPick(e: Event) {
  const input = e.target as HTMLInputElement
  folderFiles.value = Array.from(input.files ?? [])
  clearMessages()
}

function onArchivePick(e: Event) {
  const input = e.target as HTMLInputElement
  archiveFile.value = input.files?.[0] ?? null
  clearMessages()
}

onMounted(async () => {
  try {
    const [skills, recommended, favs] = await Promise.all([
      api.listSkills(),
      api.getRecommendedSkills(),
      api.getFavorites(),
    ])
    localSkillNames.value = new Set((skills as SkillSummary[]).map((s) => s.name))
    recommendedSkills.value = recommended
    favorites.value = favs
  } catch {
    recommendedSkills.value = []
    favorites.value = []
  }
})

function isFavorite(name: string): boolean {
  return favorites.value.some((f) => f.name.toLowerCase() === name.toLowerCase())
}

async function toggleFavorite(result: SkillSearchResult) {
  if (busy.value) return
  const exists = isFavorite(result.name)
  clearMessages()
  try {
    if (exists) {
      favorites.value = await api.removeFavorite(result.name)
    } else {
      favorites.value = await api.addFavorite({
        name: result.name,
        source: result.source,
        slug: result.slug,
        installs: result.installs,
      })
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function handleRemoveFavorite(name: string) {
  if (busy.value) return
  clearMessages()
  try {
    favorites.value = await api.removeFavorite(name)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function installFromFavorite(fav: FavoriteSkill) {
  if (busy.value) return
  inspecting.value = true
  clearMessages()
  try {
    const res = await api.inspectSkill({
      source: fav.source,
      skill: fav.name,
    })
    inspected.value = res
    overwrite.value = res.existsLocally
    tab.value = 'remote'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    inspecting.value = false
  }
}

async function selectRecommended(rec: RecommendedSkill) {
  if (busy.value) return
  searchQuery.value = rec.query || rec.name
  resetSearchResults()
  await handleSearch()
}

async function handleSearch() {
  const query = searchQuery.value.trim()
  if (!query || searching.value) return
  searching.value = true
  searchResults.value = []
  selectedSearchResult.value = null
  searchCompleted.value = false
  clearMessages()
  try {
    searchResults.value = await api.searchSkills(query)
    searchCompleted.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    searching.value = false
  }
}

async function handleAnalyzeRepository() {
  const repository = source.value.trim()
  if (!repository || analyzingRepository.value) return
  analyzingRepository.value = true
  resetRepositoryAnalysis()
  clearMessages()
  try {
    repositoryAnalysis.value = await api.analyzeRepository(repository)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    analyzingRepository.value = false
  }
}

async function handleRepositoryInstall() {
  if (!repositoryAnalysis.value || !canInstallRepository.value) return
  running.value = true
  repositoryInstallResults.value = []
  clearMessages()
  try {
    const results = await api.installRepositorySkills({
      inspectId: repositoryAnalysis.value.inspectId,
      skills: selectedRepositorySkills.value,
      overwrite: repositoryOverwrite.value,
      metadataMode: repositoryMetadataMode.value,
    })
    repositoryInstallResults.value = results
    const completed = results.filter((item) => item.status !== 'error')
    const failed = results.filter((item) => item.status === 'error')
    if (completed.length) {
      success.value = `已导入 ${completed.length} 个 Skill${failed.length ? `，${failed.length} 个失败` : ''}`
      emit('installed', completed[0].name)
    }
    if (failed.length) error.value = failed.map((item) => `${item.name}：${item.message ?? '导入失败'}`).join('；')
    repositoryAnalysis.value = null
    selectedRepositorySkills.value = []
    repositoryMetadataMode.value = 'normalize'
    repositoryOverwrite.value = false
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    running.value = false
  }
}

async function handleInspect() {
  if (!canInspect.value) return
  inspecting.value = true
  clearMessages()
  try {
    const payload = selectedSearchResult.value
      ? { source: selectedSearchResult.value.source, skill: selectedSearchResult.value.name }
      : { source: source.value.trim() }
    const res = await api.inspectSkill(payload)
    inspected.value = res
    overwrite.value = res.existsLocally
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    inspecting.value = false
  }
}

async function submit() {
  if (tab.value === 'remote' && !inspected.value) {
    if (remoteSource.value === 'github') {
      if (repositoryAnalysis.value) await handleRepositoryInstall()
      else await handleAnalyzeRepository()
    } else if (remoteSource.value === 'skills' && !selectedSearchResult.value) await handleSearch()
    else await handleInspect()
    return
  }
  if (!canSubmit.value) return

  running.value = true
  clearMessages()
  try {
    if (tab.value === 'remote' && inspected.value) {
      const r = await api.installInspected({
        inspectId: inspected.value.inspectId,
        overwrite: overwrite.value,
      })
      success.value = `已成功导入 Skill：${r.name}`
      localSkillNames.value.add(r.name)
      emit('installed', r.name)
    } else if (tab.value === 'folder') {
      const r = await api.importFolder(folderFiles.value, customName.value.trim() || undefined, overwrite.value)
      success.value = `${r.replaced ? '已覆盖并导入' : '已导入'} ${r.name}`
      localSkillNames.value.add(r.name)
      emit('installed', r.name)
    } else if (archiveFile.value) {
      const r = await api.importArchive(archiveFile.value, customName.value.trim() || undefined, overwrite.value)
      success.value = `${r.replaced ? '已覆盖并导入' : '已导入'} ${r.name}`
      localSkillNames.value.add(r.name)
      emit('installed', r.name)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    running.value = false
  }
}

function close() {
  if (!busy.value) emit('close')
}
</script>

<template>
  <div class="modal-mask" @click.self="close">
    <div class="modal modal-wide" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h2><Download :size="16" />导入 Skill</h2>
        <button class="btn btn-icon" :disabled="busy" aria-label="关闭" @click="close"><X :size="16" /></button>
      </div>

      <div class="tabs">
        <button type="button" class="tab" :class="{ active: tab === 'remote' }" :disabled="busy" @click="switchTab('remote')">
          <Globe :size="14" />在线导入
        </button>
        <button type="button" class="tab" :class="{ active: tab === 'favorites' }" :disabled="busy" @click="switchTab('favorites')">
          <Star :size="14" />技能收藏
          <span v-if="favorites.length" class="tab-badge">{{ favorites.length }}</span>
        </button>
        <button type="button" class="tab" :class="{ active: tab === 'folder' }" :disabled="busy" @click="switchTab('folder')">
          <FolderOpen :size="14" />本地文件夹
        </button>
        <button type="button" class="tab" :class="{ active: tab === 'archive' }" :disabled="busy" @click="switchTab('archive')">
          <Archive :size="14" />压缩包
        </button>
      </div>

      <form class="modal-body" @submit.prevent="submit">
        <!-- 标签页 1：在线导入 -->
        <template v-if="tab === 'remote'">
          <template v-if="!inspected">
            <div class="source-tabs" role="tablist" aria-label="在线导入来源">
              <button
                type="button"
                class="source-tab"
                :class="{ active: remoteSource === 'skills' }"
                :disabled="busy"
                role="tab"
                :aria-selected="remoteSource === 'skills'"
                @click="switchRemoteSource('skills')"
              >
                <Search :size="15" />Skills 搜索
              </button>
              <button
                type="button"
                class="source-tab"
                :class="{ active: remoteSource === 'github' }"
                :disabled="busy"
                role="tab"
                :aria-selected="remoteSource === 'github'"
                @click="switchRemoteSource('github')"
              >
                <Github :size="15" />GitHub 仓库
              </button>
            </div>

            <template v-if="remoteSource === 'skills'">
              <div class="field">
                <label>Skill 名称或关键词 <span class="required">*</span></label>
                <div class="search-input-wrap">
                  <input
                    v-model="searchQuery"
                    placeholder="例如：find-skills 或点击下方推荐技能"
                    :disabled="busy"
                    autofocus
                    @input="resetSearchResults"
                    @keydown.enter.prevent="handleSearch"
                  />
                  <button
                    type="button"
                    class="btn btn-sm btn-search-inline"
                    :disabled="!canSearch"
                    @click="handleSearch"
                  >
                    <Loader2 v-if="searching" :size="13" class="spin" />
                    <Search v-else :size="13" />
                    搜索
                  </button>
                </div>
                <span class="hint muted">在 skills.sh 目录中检索，选择匹配项后预检导入。</span>
              </div>

              <div v-if="uninstalledRecommendedSkills.length" class="recommended-panel">
                <div class="recommended-header">
                  <span class="recommended-title">推荐技能 (点击直搜)：</span>
                  <span class="recommended-hint">根目录 recommended-skills.json 可编辑</span>
                </div>
                <div class="recommended-chips">
                  <button
                    v-for="rec in uninstalledRecommendedSkills"
                    :key="rec.name"
                    type="button"
                    class="recommended-chip"
                    :class="{ active: searchQuery === (rec.query || rec.name) }"
                    :disabled="busy"
                    :title="rec.description ? `${rec.name} — ${rec.description}` : rec.name"
                    @click="selectRecommended(rec)"
                  >
                    {{ rec.name }}
                  </button>
                </div>
              </div>

              <div v-if="searchCompleted" class="search-panel">
                <div class="search-summary">
                  <strong>{{ searchResults.length ? `找到 ${searchResults.length} 个匹配结果` : '没有找到匹配结果' }}</strong>
                  <span v-if="searchResults.length" class="muted">选择一个 Skill 继续</span>
                  <span v-else class="muted">换个名称或缩短关键词后重试</span>
                </div>
                <div v-if="searchResults.length" class="search-results" role="listbox" aria-label="Skill 搜索结果">
                  <button
                    v-for="result in searchResults"
                    :key="result.slug"
                    type="button"
                    class="search-result"
                    :class="{ selected: selectedSearchResult?.slug === result.slug }"
                    :aria-selected="selectedSearchResult?.slug === result.slug"
                    role="option"
                    @click="selectSearchResult(result)"
                  >
                    <span class="result-main">
                      <strong class="mono">{{ result.name }}</strong>
                      <span class="mono muted">{{ result.source }}</span>
                    </span>
                    <span class="result-side">
                      <span class="install-count">{{ formatInstalls(result.installs) }} 次安装</span>
                      <button
                        type="button"
                        class="btn-fav"
                        :class="{ 'is-fav': isFavorite(result.name) }"
                        :title="isFavorite(result.name) ? '取消收藏' : '收藏此 Skill'"
                        @click.stop="toggleFavorite(result)"
                      >
                        <Star :size="14" :fill="isFavorite(result.name) ? 'currentColor' : 'none'" />
                      </button>
                      <CheckCircle2 v-if="selectedSearchResult?.slug === result.slug" :size="17" />
                    </span>
                  </button>
                </div>
              </div>
            </template>

            <template v-else>
              <div class="field">
                <label>GitHub 仓库 <span class="required">*</span></label>
                <input
                  v-model="source"
                  class="mono"
                  placeholder="owner/repo 或完整 GitHub 地址"
                  :disabled="busy"
                  autofocus
                  @input="resetRepositoryAnalysis"
                />
                <span class="hint muted">分析仓库中的全部 SKILL.md，再多选需要导入的 Skill。</span>
              </div>

              <div v-if="repositoryAnalysis" class="repository-panel">
                <div class="repository-summary">
                  <div>
                    <strong class="mono">{{ repositoryAnalysis.repo }}</strong>
                    <span class="muted">
                      {{ repositoryImportableSkills.length }} 个可导入
                      <template v-if="repositoryCompatibleSkills.length">，其中 {{ repositoryCompatibleSkills.length }} 个需补全元数据</template>
                      <template v-if="repositoryInvalidSkills.length">，{{ repositoryInvalidSkills.length }} 个不可导入</template>
                    </span>
                  </div>
                  <button type="button" class="btn btn-sm" :disabled="busy || !repositoryImportableSkills.length" @click="toggleAllRepositorySkills">
                    {{ selectedRepositorySkills.length === repositoryImportableSkills.length ? '取消全选' : '全选可导入' }}
                  </button>
                </div>

                <div v-if="repositoryImportableSkills.length" class="repository-list" aria-label="可导入的 Skill">
                  <label
                    v-for="item in repositoryImportableSkills"
                    :key="item.id"
                    class="repository-item"
                    :class="{ selected: selectedRepositorySkills.includes(item.id) }"
                  >
                    <input
                      type="checkbox"
                      :checked="selectedRepositorySkills.includes(item.id)"
                      :disabled="busy"
                      @change="toggleRepositorySkill(item.id)"
                    />
                    <span class="repository-item-main">
                      <span class="repository-item-title">
                        <strong class="mono">{{ item.originalName }}</strong>
                        <span v-if="item.status === 'compatible'" class="compatibility-tag">需补全元数据</span>
                        <span
                          v-if="repositoryMetadataMode === 'preserve' ? item.preserveExistsLocally : item.existsLocally"
                          class="conflict-tag"
                        >本地已存在</span>
                      </span>
                      <span class="mono muted repository-path">{{ item.path }}/SKILL.md</span>
                      <span class="repository-description">{{ item.description }}</span>
                      <span v-if="item.status === 'compatible'" class="repository-issues">
                        {{ item.issues.join('；') }}
                        <template v-if="repositoryMetadataMode === 'normalize' && item.name !== item.originalName">；导入名称：{{ item.name }}</template>
                      </span>
                    </span>
                    <span class="repository-file-count">{{ item.files.length }} 个文件</span>
                  </label>
                </div>

                <div v-if="repositoryInvalidSkills.length" class="invalid-skills">
                  <div class="invalid-heading">以下 Skill 存在安全或结构问题，暂不可导入</div>
                  <div v-for="item in repositoryInvalidSkills" :key="item.id" class="invalid-skill">
                    <div>
                      <strong class="mono">{{ item.name }}</strong>
                      <span class="mono muted">{{ item.path }}/SKILL.md</span>
                    </div>
                    <span>{{ item.issues.join('；') }}</span>
                  </div>
                </div>
              </div>

              <div v-if="selectedCompatibleSkills.length" class="metadata-modes">
                <button
                  type="button"
                  class="metadata-mode"
                  :class="{ active: repositoryMetadataMode === 'normalize' }"
                  :disabled="busy"
                  @click="setRepositoryMetadataMode('normalize')"
                >
                  <CheckCircle2 :size="16" />
                  <span>
                    <strong>自动补全元数据（推荐）</strong>
                    <small>只修改本地副本，自动补充 name 和 description，兼容更多 Agent。</small>
                  </span>
                </button>
                <button
                  type="button"
                  class="metadata-mode"
                  :class="{ active: repositoryMetadataMode === 'preserve' }"
                  :disabled="busy || !canPreserveSelected"
                  @click="setRepositoryMetadataMode('preserve')"
                >
                  <FileCode :size="16" />
                  <span>
                    <strong>保持原文件直接导入</strong>
                    <small>{{ canPreserveSelected ? '不改写 SKILL.md，可能无法被部分 Agent 自动发现。' : '部分目录名不安全，无法原样导入。' }}</small>
                  </span>
                </button>
              </div>

              <label v-if="selectedRepositoryConflicts.length" class="check conflict-confirm">
                <input v-model="repositoryOverwrite" type="checkbox" :disabled="busy" />
                <span>确认覆盖已选择的 {{ selectedRepositoryConflicts.length }} 个同名本地 Skill</span>
              </label>

              <div v-if="repositoryInstallResults.length" class="batch-results">
                <div
                  v-for="result in repositoryInstallResults"
                  :key="result.name"
                  class="batch-result"
                  :class="result.status === 'error' ? 'batch-error' : 'batch-ok'"
                >
                  <CheckCircle2 v-if="result.status !== 'error'" :size="14" />
                  <AlertTriangle v-else :size="14" />
                  <span class="mono">{{ result.name }}</span>
                  <span>{{ result.status === 'installed' ? '已导入' : result.status === 'replaced' ? '已覆盖' : result.message }}</span>
                </div>
              </div>
            </template>
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

        <!-- 标签页 2：技能收藏 -->
        <template v-else-if="tab === 'favorites'">
          <div class="favorites-wrap">
            <div class="field">
              <label>筛选我的收藏</label>
              <input
                v-model="favoriteFilter"
                placeholder="搜索技能名称、来源仓库或描述..."
                :disabled="busy"
              />
              <span class="hint muted">
                共 {{ favorites.length }} 个收藏，其中 {{ favorites.filter(f => localSkillNames.has(f.name)).length }} 个已安装本地。
                （收藏内容保存在根目录 favorites.json，已被 Git 忽略，不会提交到远程）
              </span>
            </div>

            <div v-if="!favorites.length" class="empty-fav-box">
              <Star :size="36" class="empty-fav-icon" />
              <p>暂无收藏的技能</p>
              <span class="hint muted">在「在线导入」搜索技能时，点击右侧的 ⭐ 即可收藏到此处，便于日后随时一键同步到本地。</span>
            </div>

            <div v-else-if="!filteredFavorites.length" class="empty-fav-box">
              <p>未找到符合「{{ favoriteFilter }}」的收藏技能</p>
            </div>

            <div v-else class="favorites-cards">
              <div
                v-for="fav in filteredFavorites"
                :key="fav.name"
                class="favorite-card"
              >
                <div class="favorite-main">
                  <div class="fav-header-line">
                    <strong class="mono fav-title">{{ fav.name }}</strong>
                    <span
                      class="fav-status-badge"
                      :class="localSkillNames.has(fav.name) ? 'status-installed' : 'status-uninstalled'"
                    >
                      {{ localSkillNames.has(fav.name) ? '已安装' : '未安装' }}
                    </span>
                  </div>
                  <div class="fav-sub-line mono muted">
                    <span>{{ fav.source }}</span>
                    <span v-if="fav.installs">· {{ formatInstalls(fav.installs) }} 次安装</span>
                  </div>
                  <div v-if="fav.description" class="fav-desc muted">{{ fav.description }}</div>
                </div>

                <div class="favorite-actions">
                  <button
                    type="button"
                    class="btn btn-sm btn-primary"
                    :disabled="busy"
                    @click="installFromFavorite(fav)"
                  >
                    <Download :size="13" />
                    {{ localSkillNames.has(fav.name) ? '重新安装' : '安装到本地' }}
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-icon btn-ghost-danger"
                    :disabled="busy"
                    title="移除此收藏"
                    @click="handleRemoveFavorite(fav.name)"
                  >
                    <Trash2 :size="14" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- 标签页 3：本地文件夹 -->
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
        <template v-if="tab === 'remote' && !inspected && remoteSource === 'github' && !repositoryAnalysis">
          <button class="btn btn-primary" :disabled="!canAnalyzeRepository" @click="handleAnalyzeRepository">
            <Loader2 v-if="analyzingRepository" :size="15" class="spin" />
            <Search v-else :size="15" />
            {{ analyzingRepository ? '正在分析仓库…' : '分析仓库' }}
          </button>
          <button class="btn" :disabled="busy" @click="close">取消</button>
        </template>

        <template v-else-if="tab === 'remote' && !inspected && remoteSource === 'github' && repositoryAnalysis">
          <button class="btn btn-primary" :disabled="!canInstallRepository" @click="handleRepositoryInstall">
            <Loader2 v-if="running" :size="15" class="spin" />
            <Download v-else :size="15" />
            {{ running ? '正在批量导入…' : `导入已选 ${selectedRepositorySkills.length} 项` }}
          </button>
          <button class="btn" :disabled="busy" @click="close">取消</button>
        </template>

        <template v-else-if="tab === 'remote' && !inspected && remoteSource === 'skills' && !selectedSearchResult">
          <button class="btn btn-primary" :disabled="!canSearch" @click="handleSearch">
            <Loader2 v-if="searching" :size="15" class="spin" />
            <Search v-else :size="15" />
            {{ searching ? '正在搜索…' : '搜索匹配结果' }}
          </button>
          <button class="btn" :disabled="busy" @click="close">取消</button>
        </template>

        <template v-else-if="tab === 'remote' && !inspected">
          <button class="btn btn-primary" :disabled="!canInspect" @click="handleInspect">
            <Loader2 v-if="inspecting" :size="15" class="spin" />
            <Search v-else :size="15" />
            {{ inspecting ? '正在探测远程 Skill…' : '预检测 Skill 信息' }}
          </button>
          <button class="btn" :disabled="busy" @click="close">取消</button>
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

        <template v-else-if="tab === 'favorites'">
          <button class="btn" :disabled="busy" @click="close">关闭</button>
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
.modal-wide { width: min(720px, 94vw); }
.tabs { display: flex; gap: 4px; padding: 10px 18px 0; border-bottom: 1px solid var(--border); overflow-x: auto; }
.tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 12px; font-size: 13px; background: transparent;
  border: 0; border-bottom: 2px solid transparent; color: var(--muted); cursor: pointer; white-space: nowrap;
}
.tab.active { color: inherit; border-bottom-color: var(--accent, #58a6ff); font-weight: 600; }
.tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  font-size: 10px;
  height: 16px;
  min-width: 16px;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  font-weight: 600;
  line-height: 1;
}
.help-box {
  background: var(--panel-2, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 12px;
  line-height: 1.6;
}
.help-title { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.help-desc { margin: 0; }
.source-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel-2);
}
.search-input-wrap {
  display: flex;
  gap: 8px;
  align-items: center;
}
.search-input-wrap input {
  flex: 1;
}
.btn-search-inline {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 14px;
  border-radius: 6px;
  background: var(--accent);
  color: #fff;
  font-weight: 500;
  font-size: 13px;
  border: none;
  cursor: pointer;
}
.btn-search-inline:hover:not(:disabled) {
  opacity: 0.9;
}
.btn-search-inline:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.recommended-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.recommended-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
}
.recommended-title {
  font-weight: 600;
  color: var(--text);
}
.recommended-hint {
  font-size: 11px;
  color: var(--muted);
}
.recommended-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 120px;
  overflow-y: auto;
  padding-right: 4px;
}
.recommended-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 12px;
  font-family: var(--font-mono, monospace);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border);
  color: var(--text);
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}
.recommended-chip:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(79, 140, 255, 0.08);
}
.recommended-chip.active {
  background: rgba(79, 140, 255, 0.2);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}
.recommended-chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.source-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
}
.source-tab:hover:not(:disabled) { color: var(--text); background: rgba(255, 255, 255, 0.04); }
.source-tab.active {
  color: var(--text);
  border-color: rgba(79, 140, 255, 0.45);
  background: rgba(79, 140, 255, 0.14);
  font-weight: 600;
}
.source-tab:focus-visible, .search-result:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.source-tab:disabled { opacity: .55; cursor: not-allowed; }
.search-panel {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--panel-2);
}
.search-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.search-results { max-height: 270px; overflow-y: auto; padding: 5px; }
.search-result {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 11px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.search-result:hover { background: rgba(255, 255, 255, 0.04); }
.search-result.selected { border-color: var(--accent); background: rgba(79, 140, 255, 0.12); }
.result-main { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.result-main strong, .result-main span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result-main span { font-size: 11px; }
.result-side { display: flex; align-items: center; gap: 8px; flex-shrink: 0; color: var(--accent); }
.btn-fav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: all 0.15s ease;
  padding: 0;
}
.btn-fav:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #f59e0b;
}
.btn-fav.is-fav {
  color: #f59e0b;
}
.install-count { color: var(--muted); font-size: 11px; white-space: nowrap; }
.repository-panel {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--panel-2);
}
.repository-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 12px;
  border-bottom: 1px solid var(--border);
}
.repository-summary > div { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.repository-summary strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.repository-summary span { font-size: 11px; }
.repository-list { max-height: 310px; overflow-y: auto; padding: 5px; }
.repository-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px 11px;
  border: 1px solid transparent;
  border-radius: 7px;
  cursor: pointer;
}
.repository-item:hover { background: rgba(255, 255, 255, 0.04); }
.repository-item.selected { border-color: rgba(79, 140, 255, 0.55); background: rgba(79, 140, 255, 0.11); }
.repository-item-main { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.repository-item-title { display: flex; align-items: center; gap: 7px; min-width: 0; }
.repository-item-title strong, .repository-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.repository-path, .repository-file-count { font-size: 11px; }
.repository-description {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.repository-issues { color: var(--warn); font-size: 11px; line-height: 1.4; }
.repository-file-count { color: var(--muted); white-space: nowrap; }
.compatibility-tag {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(240, 180, 41, 0.13);
  color: var(--warn);
  font-size: 10px;
}
.conflict-tag {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(240, 180, 41, 0.13);
  color: var(--warn);
  font-size: 10px;
}
.invalid-skills { border-top: 1px solid var(--border); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.invalid-heading { color: var(--warn); font-size: 12px; font-weight: 600; }
.invalid-skill { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; font-size: 11px; }
.invalid-skill > div { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.invalid-skill > div span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.invalid-skill > span { max-width: 55%; color: var(--muted); text-align: right; }
.metadata-modes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.metadata-mode {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 10px 11px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--panel-2);
  color: var(--muted);
  text-align: left;
  cursor: pointer;
}
.metadata-mode > svg { flex-shrink: 0; margin-top: 2px; }
.metadata-mode > span { display: flex; flex-direction: column; gap: 3px; }
.metadata-mode strong { color: var(--text); font-size: 12px; }
.metadata-mode small { font-size: 11px; line-height: 1.45; }
.metadata-mode:hover:not(:disabled) { border-color: #3a4250; }
.metadata-mode.active { border-color: var(--accent); background: rgba(79, 140, 255, 0.11); color: var(--accent); }
.metadata-mode:disabled { opacity: .5; cursor: not-allowed; }
.conflict-confirm {
  padding: 9px 11px;
  border: 1px solid rgba(240, 180, 41, 0.35);
  border-radius: 8px;
  background: rgba(240, 180, 41, 0.08);
}
.batch-results { display: flex; flex-direction: column; gap: 6px; }
.batch-result { display: flex; align-items: center; gap: 7px; padding: 7px 9px; border-radius: 7px; font-size: 12px; }
.batch-result span:last-child { margin-left: auto; }
.batch-ok { color: var(--ok); background: rgba(62, 207, 142, 0.08); }
.batch-error { color: var(--danger); background: rgba(255, 93, 93, 0.08); }
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

.favorites-wrap {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.empty-fav-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 36px 20px;
  background: var(--panel-2);
  border: 1px dashed var(--border);
  border-radius: 10px;
  color: var(--muted);
  gap: 8px;
}
.empty-fav-icon {
  color: var(--muted);
  opacity: 0.5;
  margin-bottom: 4px;
}
.favorites-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 400px;
  overflow-y: auto;
  padding-right: 2px;
}
.favorite-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 9px;
  transition: border-color 0.15s;
}
.favorite-card:hover {
  border-color: rgba(79, 140, 255, 0.4);
}
.favorite-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}
.fav-header-line {
  display: flex;
  align-items: center;
  gap: 8px;
}
.fav-title {
  font-size: 14px;
  color: var(--text);
}
.fav-status-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 500;
}
.status-installed {
  background: rgba(46, 160, 67, 0.15);
  color: #3fb950;
  border: 1px solid rgba(46, 160, 67, 0.3);
}
.status-uninstalled {
  background: rgba(255, 255, 255, 0.06);
  color: var(--muted);
  border: 1px solid var(--border);
}
.fav-sub-line {
  font-size: 11px;
}
.fav-desc {
  font-size: 12px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.favorite-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.btn-ghost-danger {
  color: var(--muted);
  background: transparent;
  border: 1px solid transparent;
}
.btn-ghost-danger:hover {
  color: #f85149;
  background: rgba(248, 81, 73, 0.1);
  border-color: rgba(248, 81, 73, 0.3);
}

.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 560px) {
  .repository-item { grid-template-columns: auto minmax(0, 1fr); }
  .repository-file-count { grid-column: 2; }
  .invalid-skill { flex-direction: column; gap: 3px; }
  .invalid-skill > span { max-width: none; text-align: left; }
  .metadata-modes { grid-template-columns: 1fr; }
}
</style>
