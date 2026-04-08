'use strict';

import { getLocale, setLocale, applyI18n } from '../src/i18n.js';

function initLangToggle(currentLocale) {
  const wrap = document.getElementById('langToggle');
  if (!wrap) return;
  const btns = wrap.querySelectorAll('button[data-lang]');
  const updateActive = (loc) => {
    btns.forEach((b) => b.classList.toggle('active', b.dataset.lang === loc));
  };
  updateActive(currentLocale);
  btns.forEach((b) => {
    b.addEventListener('click', async () => {
      const loc = b.dataset.lang === 'en' ? 'en' : 'th';
      await setLocale(loc);
      applyI18n(document, loc);
      updateActive(loc);
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const locale = await getLocale();
  applyI18n(document, locale);
  initLangToggle(locale);

  const checkbox = document.getElementById('consentCheck');
  const btn = document.getElementById('continueBtn');

  checkbox.addEventListener('change', () => {
    btn.disabled = !checkbox.checked;
  });

  btn.addEventListener('click', async () => {
    if (!checkbox.checked) return;
    try {
      await chrome.storage.local.set({
        onboardingCompleted: true,
        onboardingCompletedAt: Date.now(),
      });
    } catch (_) {}
    try {
      const extId = chrome.runtime.id;
      await chrome.tabs.create({ url: `https://livewatch-psi.vercel.app/login?extId=${extId}` });
    } catch (e) {
      console.warn('[LiveWatch] failed to open signup after onboarding:', e);
    }
    window.close();
  });
});
