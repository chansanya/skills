<script setup lang="ts">
import { File, Folder } from 'lucide-vue-next'
import type { FileNode } from '../api'

defineOptions({ name: 'FileTree' })
defineProps<{
  nodes: FileNode[]
  selectedPath?: string
}>()

const emit = defineEmits<{
  select: [path: string]
}>()

const formatSize = (n = 0) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
</script>

<template>
  <ul class="tree">
    <li v-for="node in nodes" :key="node.path">
      <button
        v-if="node.type === 'file'"
        type="button"
        class="row file-btn"
        :class="{ active: selectedPath === node.path }"
        @click="emit('select', node.path)"
      >
        <File :size="14" class="muted" />
        <span class="mono name">{{ node.name }}</span>
        <span class="size muted">{{ formatSize(node.size) }}</span>
      </button>
      <div v-else class="row">
        <Folder :size="14" class="dir" />
        <span class="mono name">{{ node.name }}</span>
      </div>
      <FileTree
        v-if="node.children?.length"
        :nodes="node.children"
        :selected-path="selectedPath"
        @select="emit('select', $event)"
      />
    </li>
  </ul>
</template>

<style scoped>
.tree { list-style: none; margin: 0; padding-left: 14px; }
.tree:first-child { padding-left: 0; }
.row { display: flex; align-items: center; gap: 6px; padding: 4px 6px; font-size: 13px; border-radius: 6px; }
.file-btn {
  width: 100%;
  background: transparent;
  border: 0;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.file-btn:hover { background: rgba(255, 255, 255, 0.05); }
.file-btn.active { background: rgba(88, 166, 255, 0.14); color: var(--accent, #58a6ff); }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dir { color: var(--warn); flex-shrink: 0; }
.size { margin-left: auto; font-size: 11px; flex-shrink: 0; }
</style>
