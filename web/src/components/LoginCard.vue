<script setup>
import { nextTick, onMounted, ref } from 'vue';
import { login } from '../api.js';

const emit = defineEmits(['authenticated']);

const password = ref('');
const error = ref('');
const busy = ref(false);
const shake = ref(false);
const input = ref(null);

onMounted(() => input.value?.focus());

async function submit() {
  if (!password.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await login(password.value);
    emit('authenticated');
  } catch (err) {
    error.value = err.message;
    password.value = '';
    shake.value = false;
    await nextTick();
    shake.value = true;
    input.value?.focus();
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="card glass" :class="{ shake }" @submit.prevent="submit" @animationend="shake = false">
    <div class="icon">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 7l5 5-5 5" />
        <path d="M12 18h7" />
      </svg>
    </div>
    <h1>Homelab</h1>
    <p class="subtitle">Enter your password to open a terminal.</p>

    <div class="field">
      <input
        ref="input"
        v-model="password"
        type="password"
        autocomplete="current-password"
        placeholder="Password"
        aria-label="Password"
        :disabled="busy"
      />
      <button type="submit" class="go" :disabled="!password || busy" aria-label="Unlock">
        <span v-if="busy" class="spinner" />
        <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </button>
    </div>

    <p class="error" role="alert">{{ error }}</p>
  </form>
</template>

<style scoped>
.card {
  width: min(380px, calc(100vw - 32px));
  padding: 40px 32px 24px;
  border-radius: 28px;
  text-align: center;
}

.icon {
  width: 72px;
  height: 72px;
  margin: 0 auto 18px;
  border-radius: 20px;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #7c5cff, #2ec5ff);
  box-shadow: 0 12px 30px rgba(94, 59, 255, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

.icon svg {
  width: 36px;
  height: 36px;
  fill: none;
  stroke: #fff;
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

h1 {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.subtitle {
  margin: 6px 0 26px;
  color: var(--text-dim);
  font-size: 14px;
}

.field {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 5px 5px 16px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid var(--glass-border);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.field:focus-within {
  border-color: rgba(10, 132, 255, 0.7);
  box-shadow: 0 0 0 4px rgba(10, 132, 255, 0.18);
}

input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: 16px; /* prevents iOS zoom-on-focus */
  padding: 8px 0;
}

input::placeholder {
  color: var(--text-dim);
}

.go {
  width: 38px;
  height: 38px;
  flex: none;
  border: 0;
  border-radius: 50%;
  background: var(--accent);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;
}

.go:disabled {
  opacity: 0.35;
  cursor: default;
}

.go:not(:disabled):active {
  transform: scale(0.92);
}

.go svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: #fff;
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.spinner {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  animation: spin 0.8s linear infinite;
}

.error {
  min-height: 20px;
  margin: 14px 0 0;
  color: var(--danger);
  font-size: 13px;
}

.shake {
  animation: shake 0.45s cubic-bezier(0.36, 0.07, 0.19, 0.97);
}

@keyframes shake {
  20%, 60% { transform: translateX(-8px); }
  40%, 80% { transform: translateX(8px); }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
