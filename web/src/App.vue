<script setup>
import { onMounted, ref, shallowRef } from 'vue';
import { getInfo } from './api.js';
import { needRefresh, updateServiceWorker } from './pwa.js';
import ConnectCard from './components/ConnectCard.vue';
import TerminalWindow from './components/TerminalWindow.vue';

const info = ref({ host: '', defaultUsername: '' });
// Credentials live only in memory for the lifetime of this tab.
const credentials = shallowRef(null);
const error = ref('');

function onConnect(creds) {
  error.value = '';
  credentials.value = creds;
}

function onAuthFailed(message) {
  error.value = message;
  // Back to the connect screen with the username and key pre-filled; the passphrase is dropped.
  const { username, privateKey, keyName } = credentials.value;
  credentials.value = { username, privateKey, keyName, failed: true };
}

function dismissUpdate() {
  needRefresh.value = false;
}

function onDisconnect() {
  error.value = '';
  credentials.value = null;
}

onMounted(async () => {
  info.value = await getInfo().catch(() => info.value);
});
</script>

<template>
  <div class="wallpaper" aria-hidden="true"><span /><span /><span /></div>

  <main class="stage">
    <Transition name="fade-scale" mode="out-in">
      <TerminalWindow
        v-if="credentials && !credentials.failed"
        key="terminal"
        :host="info.host"
        :credentials="credentials"
        @disconnect="onDisconnect"
        @auth-failed="onAuthFailed"
      />
      <ConnectCard
        v-else
        key="connect"
        :host="info.host"
        :default-username="info.defaultUsername"
        :initial="credentials || {}"
        :error="error"
        @connect="onConnect"
      />
    </Transition>
  </main>

  <Transition name="fade-scale">
    <div v-if="needRefresh" class="toast glass" role="status">
      <span>A new version is available.</span>
      <button class="glass-button" @click="updateServiceWorker(true)">Update</button>
      <button class="glass-button" @click="dismissUpdate">Later</button>
    </div>
  </Transition>
</template>

<style scoped>
.stage {
  height: 100%;
  display: grid;
  place-items: center;
  padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
    max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
}

.toast {
  position: fixed;
  left: 50%;
  bottom: max(20px, env(safe-area-inset-bottom));
  translate: -50% 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px 8px 16px;
  border-radius: 999px;
  font-size: 13px;
  white-space: nowrap;
  z-index: 10;
}

@media (max-width: 640px) {
  .stage {
    padding: env(safe-area-inset-top) 0 0 0;
  }
}
</style>
