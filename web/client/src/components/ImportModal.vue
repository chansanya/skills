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
  Github,
  Globe,
  HelpCircle,
  Loader2,
  Search,
  X,
} from 'lucide-vue-next'
import {
  api,
  type InspectResult,
  type RepositoryAnalysisResult,
  type RepositoryInstallResult,
  type SkillSearchResult,
} from '../api'

type Tab = 'remote' | 'folder' | 'archive'
type RemoteSource = 'skills' | 'github'

const emit = defineEmits<{ close: []; installed: [name: string] }>()

const tab = ref<Tab>('remote')
const remoteSource = ref<RemoteSource>('skills')
const source = ref('')
const skill = ref('')
const searchQuery = ref('')
const searchResults = ref<SkillSearchResult[]>([])
const selectedSearchResult = ref<SkillSearchResult | null>(null)
const searchCompleted = ref(false)
const repositoryAnalysis = ref<RepositoryAnalysisResult | null>(null)
const selectedRepositorySkills = ref<string[]>([])
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
const repositoryValidSkills = computed(() => repositoryAnalysis.value?.skills.filter((item) => item.valid) ?? [])
const repositoryInvalidSkills = computed(() => repositoryAnalysis.value?.skills.filter((item) => !item.valid) ?? [])
const selectedRepositoryCandidates = computed(() =>
  repositoryValidSkills.value.filter((item) => selectedRepositorySkills.value.includes(item.id)),
)
const selectedRepositoryConflicts = computed(() =>
  selectedRepositoryCandidates.value.filter((item) => item.existsLocally),
)
const canAnalyzeRepository = computed(() => !busy.value && !!source.value.trim())
const canInstallRepository = computed(() =>
  !busy.value &&
  !!repositoryAnalysis.value &&
  selectedRepositorySkills.value.length > 0 &&
  (!selectedRepositoryConflicts.value.length || repositoryOverwrite.value),
)
const canInspect = computed(() => {
  if (busy.value) return false
  return remoteSource.value === 'skills' && !!selectedSearchResult.value
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
  skill.value = ''
  resetInspect()
}

function resetRepositoryAnalysis() {
  repositoryAnalysis.value = null
  selectedRepositorySkills.value = []
  repositoryOverwrite.value = false
  repositoryInstallResults.value = []
  resetInspect()
}

function switchTab(next: Tab) {
  if (busy.value) return
  tab.value = next
  resetInspect()
}

function switchRemoteSource(next: RemoteSource) {
  if (busy.value || remoteSource.value === next) return
  remoteSource.value = next
  source.value = ''
  skill.value = ''
  searchQuery.value = ''
  searchResults.value = []
  selectedSearchResult.value = null
  searchCompleted.value = false
  repositoryAnalysis.value = null
  selectedRepositorySkills.value = []
  repositoryOverwrite.value = false
  repositoryInstallResults.value = []
  resetInspect()
}

function selectSearchResult(result: SkillSearchResult) {
  selectedSearchResult.value = result
  source.value = result.source
  skill.value = result.name
  resetInspect()
}

function formatInstalls(count: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(count)
}

function toggleRepositorySkill(id: string) {
  selectedRepositorySkills.value = selectedRepositorySkills.value.includes(id)
    ? selectedRepositorySkills.value.filter((item) => item !== id)
    : [...selectedRepositorySkills.value, id]
  if (!selectedRepositoryConflicts.value.length) repositoryOverwrite.value = false
  clearMessages()
}

function toggleAllRepositorySkills() {
  const validIds = repositoryValidSkills.value.map((item) => item.id)
  selectedRepositorySkills.value = selectedRepositorySkills.value.length === validIds.length ? [] : validIds
  if (!selectedRepositoryConflicts.value.length) repositoryOverwrite.value = false
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
    const payload = remoteSource.value === 'skills' && selectedSearchResult.value
      ? { source: selectedSearchResult.value.source, skill: selectedSearchResult.value.name }
      : { source: source.value.trim(), skill: skill.value.trim() || undefined }
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
                <input
                  v-model="searchQuery"
                  placeholder="例如：find-skills"
                  :disabled="busy"
                  autofocus
                  @input="resetSearchResults"
                />
                <span class="hint muted">搜索 Skills 目录，选择匹配项后再预检导入内容。</span>
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
                      {{ repositoryValidSkills.length }} 个可导入
                      <template v-if="repositoryInvalidSkills.length">，{{ repositoryInvalidSkills.length }} 个不符合规范</template>
                    </span>
                  </div>
                  <button type="button" class="btn btn-sm" :disabled="busy || !repositoryValidSkills.length" @click="toggleAllRepositorySkills">
                    {{ selectedRepositorySkills.length === repositoryValidSkills.length ? '取消全选' : '全选可导入' }}
                  </button>
                </div>

                <div v-if="repositoryValidSkills.length" class="repository-list" aria-label="可导入的 Skill">
                  <label
                    v-for="item in repositoryValidSkills"
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
                        <strong class="mono">{{ item.name }}</strong>
                        <span v-if="item.existsLocally" class="conflict-tag">本地已存在</span>
                      </span>
                      <span class="mono muted repository-path">{{ item.path }}/SKILL.md</span>
                      <span class="repository-description">{{ item.description }}</span>
                    </span>
                    <span class="repository-file-count">{{ item.files.length }} 个文件</span>
                  </label>
                </div>

                <div v-if="repositoryInvalidSkills.length" class="invalid-skills">
                  <div class="invalid-heading">以下 Skill 暂不可导入</div>
                  <div v-for="item in repositoryInvalidSkills" :key="item.id" class="invalid-skill">
                    <div>
                      <strong class="mono">{{ item.name }}</strong>
                      <span class="mono muted">{{ item.path }}/SKILL.md</span>
                    </div>
                    <span>{{ item.errors.join('；') }}</span>
                  </div>
                </div>
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel-2);
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
.repository-file-count { color: var(--muted); white-space: nowrap; }
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

.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 560px) {
  .repository-item { grid-template-columns: auto minmax(0, 1fr); }
  .repository-file-count { grid-column: 2; }
  .invalid-skill { flex-direction: column; gap: 3px; }
  .invalid-skill > span { max-width: none; text-align: left; }
}
</style>
