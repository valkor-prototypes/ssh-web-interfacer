<script setup>
// Extra keys that phone keyboards don't have. Only shown on touch devices.
const ctrl = defineModel('ctrl', { type: Boolean, default: false });
const emit = defineEmits(['key']);

const keys = [
  { label: 'esc', seq: '\x1b' },
  { label: 'tab', seq: '\t' },
  { label: 'ctrl', toggle: true },
  { label: '↑', seq: '\x1b[A' },
  { label: '↓', seq: '\x1b[B' },
  { label: '←', seq: '\x1b[D' },
  { label: '→', seq: '\x1b[C' },
  { label: '|', seq: '|' },
  { label: '~', seq: '~' },
  { label: '/', seq: '/' },
  { label: '-', seq: '-' },
  { label: '^C', seq: '\x03' },
];

function press(key) {
  if (key.toggle) {
    ctrl.value = !ctrl.value;
  } else {
    emit('key', key.seq);
  }
}
</script>

<template>
  <nav class="keybar" aria-label="Extra keys">
    <button
      v-for="key in keys"
      :key="key.label"
      type="button"
      class="key"
      :class="{ active: key.toggle && ctrl }"
      @pointerdown.prevent="press(key)"
    >
      {{ key.label }}
    </button>
  </nav>
</template>

<style scoped>
.keybar {
  display: none;
  gap: 6px;
  padding: 8px 8px calc(8px + env(safe-area-inset-bottom));
  overflow-x: auto;
  scrollbar-width: none;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
}

.keybar::-webkit-scrollbar {
  display: none;
}

@media (pointer: coarse) {
  .keybar {
    display: flex;
  }
}

.key {
  flex: none;
  min-width: 42px;
  height: 36px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.09);
  font-family: var(--font-mono);
  font-size: 14px;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}

.key:active,
.key.active {
  background: var(--accent);
  border-color: transparent;
}
</style>
