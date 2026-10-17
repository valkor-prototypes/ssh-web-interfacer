<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import InstallButton from './InstallButton.vue';

const props = defineProps({
  host: { type: String, default: '' },
  defaultUsername: { type: String, default: '' },
  initial: { type: Object, default: () => ({}) },
  error: { type: String, default: '' },
});
const emit = defineEmits(['connect', 'logout']);

const USER_KEY = 'swi:username';

function storedUsername() {
  try {
    return localStorage.getItem(USER_KEY) || '';
  } catch {
    return '';
  }
}

const username = ref(props.initial.username || storedUsername() || props.defaultUsername);
const privateKey = ref(props.initial.privateKey || '');
const passphrase = ref('');
const keyName = ref(props.initial.keyName || '');
const showPaste = ref(!props.initial.keyName && Boolean(props.initial.privateKey));
const dragging = ref(false);
const localError = ref('');
const shake = ref(false);
const fileInput = ref(null);
const userInput = ref(null);

const message = computed(() => localError.value || props.error);
const keyLooksValid = computed(() => /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(privateKey.value));
const canSubmit = computed(() => username.value.trim() && keyLooksValid.value);

watch(
  () => props.defaultUsername,
  (name) => {
    if (!username.value) username.value = name;
  },
);

onMounted(async () => {
  if (props.error) bump();
  await nextTick();
  userInput.value?.focus();
});

async function bump() {
  shake.value = false;
  await nextTick();
  shake.value = true;
}

async function loadFile(file) {
  if (!file) return;
  if (file.size > 32 * 1024) {
    localError.value = 'That file is too large to be a private key.';
    return bump();
  }
  const text = await file.text();
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) {
    localError.value = `${file.name} is not a private key (did you pick the .pub file?).`;
    return bump();
  }
  privateKey.value = text;
  keyName.value = file.name;
  showPaste.value = false;
  localError.value = '';
}

function onDrop(event) {
  dragging.value = false;
  loadFile(event.dataTransfer?.files?.[0]);
}

function clearKey() {
  privateKey.value = '';
  keyName.value = '';
  if (fileInput.value) fileInput.value.value = '';
}

function submit() {
  if (!canSubmit.value) {
    localError.value = !username.value.trim() ? 'Enter a username.' : 'Add a private key (OpenSSH or PEM format).';
    return bump();
  }
  localError.value = '';
  try {
    localStorage.setItem(USER_KEY, username.value.trim());
  } catch {}
  emit('connect', {
    username: username.value.trim(),
    privateKey: privateKey.value.trim() + '\n',
    passphrase: passphrase.value,
    keyName: keyName.value,
  });
}
</script>

<template>
  <form
    class="card glass"
    :class="{ shake, dragging }"
    @submit.prevent="submit"
    @animationend="shake = false"
    @dragover.prevent="dragging = true"
    @dragleave.self="dragging = false"
    @drop.prevent="onDrop"
  >
    <div class="icon">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 7l5 5-5 5" />
        <path d="M12 18h7" />
      </svg>
    </div>
    <h1>Homelab</h1>
    <p class="subtitle">Connect to <strong>{{ host || 'your server' }}</strong> with your SSH key.</p>

    <label class="field">
      <span class="label">User</span>
      <input
        ref="userInput"
        v-model="username"
        autocomplete="username"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        placeholder="username"
      />
    </label>

    <div class="key">
      <template v-if="privateKey && !showPaste">
        <div class="key-chip">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3M14 9l2 2" />
          </svg>
          <span class="key-name">{{ keyName || 'Pasted key' }}</span>
          <button type="button" class="link" @click="clearKey">Remove</button>
        </div>
      </template>
      <template v-else-if="showPaste">
        <textarea
          v-model="privateKey"
          class="paste"
          rows="5"
          spellcheck="false"
          autocapitalize="off"
          autocorrect="off"
          autocomplete="off"
          placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;…&#10;-----END OPENSSH PRIVATE KEY-----"
        />
        <button type="button" class="link" @click="showPaste = false; privateKey = keyLooksValid ? privateKey : ''">
          Choose a file instead
        </button>
      </template>
      <template v-else>
        <button type="button" class="drop" @click="fileInput.click()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>
          <span>Choose private key file</span>
          <small>or drop it here · e.g. ~/.ssh/id_ed25519</small>
        </button>
        <button type="button" class="link" @click="showPaste = true">Paste key text instead</button>
      </template>
      <input ref="fileInput" type="file" hidden @change="loadFile($event.target.files[0])" />
    </div>

    <label class="field">
      <span class="label">Passphrase</span>
      <input v-model="passphrase" type="password" autocomplete="off" placeholder="optional" />
    </label>

    <button type="submit" class="connect" :disabled="!canSubmit">Connect</button>

    <p class="error" role="alert">{{ message }}</p>

    <p class="note">Your key stays in this tab's memory and is used only for this session. It is never saved.</p>

    <button type="button" class="link logout" @click="emit('logout')">Log out</button>

    <InstallButton />
  </form>
</template>

<style scoped>
.card {
  width: min(400px, calc(100vw - 32px));
  max-height: 100%;
  overflow-y: auto;
  padding: 36px 28px 22px;
  border-radius: 28px;
  text-align: center;
  transition: box-shadow 0.2s, border-color 0.2s;
}

.card.dragging {
  border-color: rgba(10, 132, 255, 0.8);
  box-shadow: 0 0 0 4px rgba(10, 132, 255, 0.25), 0 30px 80px rgba(0, 0, 0, 0.45);
}

.icon {
  width: 68px;
  height: 68px;
  margin: 0 auto 16px;
  border-radius: 19px;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #7c5cff, #2ec5ff);
  box-shadow: 0 12px 30px rgba(94, 59, 255, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.icon svg {
  width: 34px;
  height: 34px;
  color: #fff;
  stroke-width: 2.4;
}

h1 {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.subtitle {
  margin: 6px 0 22px;
  color: var(--text-dim);
  font-size: 14px;
}

.subtitle strong {
  color: var(--text);
  font-weight: 600;
}

.field {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  margin-bottom: 10px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid var(--glass-border);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.field:focus-within,
.paste:focus {
  border-color: rgba(10, 132, 255, 0.7);
  box-shadow: 0 0 0 4px rgba(10, 132, 255, 0.18);
}

.label {
  width: 84px;
  flex: none;
  text-align: left;
  font-size: 13px;
  color: var(--text-dim);
}

input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: 16px; /* prevents iOS zoom-on-focus */
  padding: 12px 0;
}

input::placeholder,
textarea::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.key {
  margin-bottom: 10px;
}

.drop {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 18px 12px;
  border-radius: var(--radius-md);
  border: 1.5px dashed rgba(255, 255, 255, 0.22);
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}

.drop:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.35);
}

.drop svg {
  width: 22px;
  height: 22px;
  color: var(--accent);
}

.drop span {
  font-size: 14px;
  font-weight: 500;
}

.drop small {
  font-size: 12px;
  color: var(--text-dim);
}

.paste {
  width: 100%;
  resize: vertical;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border);
  background: rgba(0, 0, 0, 0.25);
  outline: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.4;
  color: var(--text);
}

.key-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background: rgba(48, 209, 88, 0.12);
  border: 1px solid rgba(48, 209, 88, 0.35);
  text-align: left;
}

.key-chip svg {
  width: 18px;
  height: 18px;
  flex: none;
  color: var(--success);
}

.key-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 13px;
}

.link {
  border: 0;
  background: none;
  padding: 6px 2px 0;
  color: var(--accent);
  font-size: 13px;
  cursor: pointer;
}

.key-chip .link {
  padding: 0;
}

.connect {
  width: 100%;
  margin-top: 6px;
  padding: 13px;
  border: 0;
  border-radius: var(--radius-md);
  background: var(--accent);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;
}

.connect:disabled {
  opacity: 0.4;
  cursor: default;
}

.connect:not(:disabled):active {
  transform: scale(0.98);
}

.error {
  min-height: 18px;
  margin: 12px 0 0;
  color: var(--danger);
  font-size: 13px;
}

.note {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-dim);
}

.logout {
  margin-top: 6px;
}

.shake {
  animation: shake 0.45s cubic-bezier(0.36, 0.07, 0.19, 0.97);
}

@keyframes shake {
  20%, 60% { transform: translateX(-8px); }
  40%, 80% { transform: translateX(8px); }
}
</style>
