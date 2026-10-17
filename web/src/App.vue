<script setup>
import { onMounted, ref } from 'vue';
import { getSession, logout } from './api.js';
import LoginCard from './components/LoginCard.vue';
import TerminalWindow from './components/TerminalWindow.vue';

const state = ref('loading'); // loading | login | terminal
const session = ref({});

async function refresh() {
  try {
    session.value = await getSession();
    state.value = session.value.authenticated ? 'terminal' : 'login';
  } catch {
    state.value = 'login';
  }
}

async function onLogout() {
  await logout().catch(() => {});
  state.value = 'login';
}

onMounted(refresh);
</script>

<template>
  <div class="wallpaper" aria-hidden="true"><span /><span /><span /></div>

  <main class="stage">
    <Transition name="fade-scale" mode="out-in">
      <LoginCard v-if="state === 'login'" key="login" @authenticated="refresh" />
      <TerminalWindow
        v-else-if="state === 'terminal'"
        key="terminal"
        :host="session.host"
        :user="session.user"
        @logout="onLogout"
        @unauthorized="state = 'login'"
      />
    </Transition>
  </main>
</template>

<style scoped>
.stage {
  height: 100%;
  display: grid;
  place-items: center;
  padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
    max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
}

@media (max-width: 640px) {
  .stage {
    padding: env(safe-area-inset-top) 0 0 0;
  }
}
</style>
