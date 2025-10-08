// Simple periodic ping to the service worker to keep it active
setInterval(() => {
  try { chrome.runtime.sendMessage({ type: 'keepAlive' }).catch(() => {}); } catch (_) {}
}, 25000);


