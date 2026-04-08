(function () {
  'use strict';

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
})();
