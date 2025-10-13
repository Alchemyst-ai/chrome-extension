(async () => {
  const { alchemystApiKey } = await chrome.storage.local.get(['alchemystApiKey']);
  console.log({ alchemystApiKey });

  document.getElementById('apiKey').value = alchemystApiKey || '';
  // document.getElementById('useApi').checked = useAlchemystApi || false;
})();

document.getElementById("saveKey").addEventListener("click", async () => {
  const apiKey = document.getElementById("apiKey").value.trim();
  if (!apiKey) {
    alert("Please enter an API key!");
    return;
  }

  await chrome.storage.local.set({ alchemystApiKey: apiKey });
  alert("✅ API key saved successfully!");
});
