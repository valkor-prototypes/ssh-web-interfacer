<script setup>
import { ref } from 'vue';
import { installMode, promptInstall } from '../pwa.js';

const showIosHint = ref(false);

async function install() {
  if (installMode.value === 'ios') showIosHint.value = !showIosHint.value;
  else await promptInstall();
}
</script>

<template>
  <div v-if="installMode" class="install">
    <button type="button" class="glass-button" @click="install">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
      Install app
    </button>
    <p v-if="showIosHint" class="ios-hint">
      In Safari tap <strong>Share</strong>
      <svg viewBox="0 0 24 24" aria-hidden="true" class="inline"><path d="M12 15V3M8 7l4-4 4 4M6 11H5v10h14V11h-1" /></svg>
      then <strong>Add to Home Screen</strong>.
    </p>
  </div>
</template>

<style scoped>
.install {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.glass-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.glass-button svg {
  width: 15px;
  height: 15px;
}

.ios-hint {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--text-dim);
}

.ios-hint .inline {
  width: 15px;
  height: 15px;
  vertical-align: -2px;
}
</style>
