import { computed, ref } from 'vue';
import { useRegisterSW } from 'virtual:pwa-register/vue';

// ─── Service worker / updates ────────────────────────────────────────────

const { needRefresh, updateServiceWorker } = useRegisterSW({ immediate: true });
export { needRefresh, updateServiceWorker };

// ─── Install prompt ──────────────────────────────────────────────────────

const deferredPrompt = ref(null);
const installed = ref(
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true,
);

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt.value = event;
});

window.addEventListener('appinstalled', () => {
  installed.value = true;
  deferredPrompt.value = null;
});

// iOS Safari has no install prompt API; the user has to use Share → Add to Home Screen.
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const installMode = computed(() => {
  if (installed.value) return null;
  if (deferredPrompt.value) return 'prompt';
  if (isIos) return 'ios';
  return null;
});

export async function promptInstall() {
  const event = deferredPrompt.value;
  if (!event) return;
  deferredPrompt.value = null;
  event.prompt();
  await event.userChoice;
}
