<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { getSession } from '../api.js';
import KeyBar from './KeyBar.vue';

const props = defineProps({ host: String, user: String });
const emit = defineEmits(['logout', 'unauthorized']);

const FONT_KEY = 'swi:font-size';
const container = ref(null);
const status = ref('connecting'); // connecting | connected | closed | error
const message = ref('');
const ctrlArmed = ref(false);

const statusLabel = computed(
  () =>
    ({
      connecting: 'Connecting…',
      connected: 'Connected',
      closed: 'Disconnected',
      error: 'Error',
    })[status.value],
);

let term;
let fit;
let ws;
let resizeObserver;

function readFontSize() {
  try {
    return Number(localStorage.getItem(FONT_KEY)) || (window.innerWidth < 640 ? 12 : 14);
  } catch {
    return 14;
  }
}

function send(payload) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function sendInput(data) {
  if (ctrlArmed.value && data.length === 1) {
    ctrlArmed.value = false;
    const code = data.toUpperCase().charCodeAt(0);
    if (code >= 64 && code <= 95) data = String.fromCharCode(code - 64);
  }
  send({ type: 'input', data });
}

function fitAndResize() {
  if (!term || !container.value?.offsetParent) return;
  fit.fit();
  send({ type: 'resize', cols: term.cols, rows: term.rows });
}

function connect() {
  ws?.close();
  status.value = 'connecting';
  message.value = '';
  term.reset();

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?cols=${term.cols}&rows=${term.rows}`);
  ws.binaryType = 'arraybuffer';

  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') {
      term.write(new Uint8Array(event.data));
      return;
    }
    const msg = JSON.parse(event.data);
    if (msg.type === 'status') {
      status.value = msg.state;
      if (msg.state === 'connected') fitAndResize();
    } else if (msg.type === 'error') {
      status.value = 'error';
      message.value = msg.message;
    }
  };

  ws.onclose = async () => {
    if (status.value !== 'error') status.value = 'closed';
    // The upgrade is rejected with 401 when the session expired; check and bounce to login.
    const session = await getSession().catch(() => null);
    if (session && !session.authenticated) emit('unauthorized');
  };

  term.focus();
}

function changeFont(delta) {
  const size = Math.min(24, Math.max(9, term.options.fontSize + delta));
  term.options.fontSize = size;
  try {
    localStorage.setItem(FONT_KEY, String(size));
  } catch {}
  fitAndResize();
}

onMounted(() => {
  term = new Terminal({
    allowTransparency: true,
    cursorBlink: true,
    cursorStyle: 'bar',
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono'),
    fontSize: readFontSize(),
    lineHeight: 1.2,
    scrollback: 5000,
    theme: {
      background: 'rgba(0,0,0,0)',
      foreground: '#e8e8f0',
      cursor: '#0a84ff',
      cursorAccent: '#000',
      selectionBackground: 'rgba(10,132,255,0.35)',
      black: '#1c1c24',
      red: '#ff6b6b',
      green: '#5af78e',
      yellow: '#f3f99d',
      blue: '#57c7ff',
      magenta: '#ff6ac1',
      cyan: '#9aedfe',
      white: '#f1f1f0',
      brightBlack: '#686868',
      brightRed: '#ff8a8a',
      brightGreen: '#7dffa6',
      brightYellow: '#f8fcbf',
      brightBlue: '#82d6ff',
      brightMagenta: '#ff8fd2',
      brightCyan: '#b8f3ff',
      brightWhite: '#ffffff',
    },
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());
  term.open(container.value);
  fit.fit();
  term.onData(sendInput);

  resizeObserver = new ResizeObserver(() => requestAnimationFrame(fitAndResize));
  resizeObserver.observe(container.value);

  connect();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  ws?.close();
  term?.dispose();
});
</script>

<template>
  <section class="window glass">
    <header class="titlebar">
      <div class="lights" aria-hidden="true">
        <span class="red" /><span class="yellow" /><span class="green" />
      </div>

      <div class="title">
        <span class="dot" :class="status" />
        <span class="name">{{ user }}@{{ host }}</span>
        <span class="state">{{ statusLabel }}</span>
      </div>

      <div class="actions">
        <button class="glass-button icon" title="Smaller text" @click="changeFont(-1)">A−</button>
        <button class="glass-button icon" title="Larger text" @click="changeFont(1)">A+</button>
        <button class="glass-button" title="Log out" @click="emit('logout')">Log out</button>
      </div>
    </header>

    <div class="body">
      <div ref="container" class="term" />

      <Transition name="fade-scale">
        <div v-if="status === 'closed' || status === 'error'" class="overlay">
          <div class="sheet glass">
            <p class="sheet-title">{{ status === 'error' ? 'Connection error' : 'Session ended' }}</p>
            <p v-if="message" class="sheet-msg">{{ message }}</p>
            <button class="glass-button primary" @click="connect">Reconnect</button>
          </div>
        </div>
      </Transition>
    </div>

    <KeyBar v-model:ctrl="ctrlArmed" @key="(seq) => { send({ type: 'input', data: seq }); term.focus(); }" />
  </section>
</template>

<style scoped>
.window {
  width: min(1200px, 100%);
  height: min(780px, 100%);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--glass-strong);
}

.titlebar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
}

.lights {
  display: flex;
  gap: 8px;
}

.lights span {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, 0.25);
}

.red { background: #ff5f57; }
.yellow { background: #febc2e; }
.green { background: #28c840; }

.title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
}

.name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}

.state {
  color: var(--text-dim);
}

.dot {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
  background: var(--warning);
  box-shadow: 0 0 10px currentColor;
}

.dot.connecting { color: var(--warning); background: var(--warning); animation: pulse 1.2s ease-in-out infinite; }
.dot.connected { color: var(--success); background: var(--success); }
.dot.closed { color: var(--text-dim); background: var(--text-dim); }
.dot.error { color: var(--danger); background: var(--danger); }

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.glass-button.icon {
  padding: 7px 10px;
  font-variant-numeric: tabular-nums;
}

.body {
  position: relative;
  flex: 1;
  min-height: 0;
}

.term {
  position: absolute;
  inset: 10px 4px 6px 14px;
}

.overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.25);
}

.sheet {
  padding: 22px 26px;
  border-radius: var(--radius-md);
  text-align: center;
  max-width: 340px;
}

.sheet-title {
  margin: 0 0 6px;
  font-weight: 600;
}

.sheet-msg {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--text-dim);
}

.glass-button.primary {
  margin-top: 8px;
  background: var(--accent);
  border-color: transparent;
}

@keyframes pulse {
  50% { opacity: 0.35; }
}

@media (max-width: 640px) {
  .window {
    height: 100%;
    border-radius: 0;
    border-left: 0;
    border-right: 0;
    border-bottom: 0;
  }

  .titlebar {
    grid-template-columns: 1fr auto;
    padding: 8px 10px;
  }

  .lights,
  .state {
    display: none;
  }

  .term {
    inset: 6px 2px 4px 8px;
  }
}
</style>
