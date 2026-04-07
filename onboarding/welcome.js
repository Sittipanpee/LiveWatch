(function () {
  'use strict';

  const checkbox = document.getElementById('consentCheck');
  const btn = document.getElementById('continueBtn');

  checkbox.addEventListener('change', () => {
    btn.disabled = !checkbox.checked;
  });

  btn.addEventListener('click', () => {
    if (!checkbox.checked) return;
    const payload = {
      onboardingCompleted: true,
      onboardingCompletedAt: Date.now(),
    };
    try {
      chrome.storage.local.set(payload, () => {
        window.close();
      });
    } catch (e) {
      window.close();
    }
  });
})();
