<script setup>
import { onMounted, ref, shallowRef } from 'vue';
import { getSession, logout } from './api.js';
import { needRefresh, updateServiceWorker } from './pwa.js';
import LoginCard from './components/LoginCard.vue';
import ConnectCard from './components/ConnectCard.vue';
import TerminalWindow from './components/TerminalWindow.vue';

const state = ref('loading'); // loading | login | ready
const session = ref({});
// SSH credentials live only in memory for the lifetime of this tab.
const credentials = shallowRef(null);
const error = ref('');

async function refresh() {
  try {
    session.value = await getSession();
    state.value = session.value.authenticated ? 'ready' : 'login';
  } catch {
    state.value = 'login';
  }
}

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

function onDisconnect() {
  error.value = '';
  credentials.value = null;
}

function onUnauthorized() {
  credentials.value = null;
  state.value = 'login';
}

async function onLogout() {
  await logout().catch(() => {});
  onDisconnect();
  state.value = 'login';
}

function dismissUpdate() {
  needRefresh.value = false;
}

onMounted(refresh);
</script>

<template>
  <div class="wallpaper" aria-hidden="true"><span /><span /><span /></div>

  <main class="stage">
    <Transition name="fade-scale" mode="out-in">
      <LoginCard v-if="state === 'login'" key="login" @authenticated="refresh" />
      <TerminalWindow
        v-else-if="state === 'ready' && credentials && !credentials.failed"
        key="terminal"
        :host="session.host"
        :credentials="credentials"
        @disconnect="onDisconnect"
        @auth-failed="onAuthFailed"
        @unauthorized="onUnauthorized"
      />
      <ConnectCard
        v-else-if="state === 'ready'"
        key="connect"
        :host="session.host"
        :default-username="session.defaultUsername"
        :initial="credentials || {}"
        :error="error"
        @connect="onConnect"
        @logout="onLogout"
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
