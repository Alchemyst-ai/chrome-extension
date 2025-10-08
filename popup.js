document.getElementById("saveKey").addEventListener("click", async () => {
  const apiKey = document.getElementById("apiKey").value.trim();
  if (!apiKey) {
    alert("Please enter an API key!");
    return;
  }

  await chrome.storage.local.set({ alchemystApiKey: apiKey });
  alert("✅ API key saved successfully!");
});

document
  .getElementById("testConnectivity")
  .addEventListener("click", async () => {
    const { alchemystApiKey } = await chrome.storage.local.get(
      "alchemystApiKey"
    );
    if (!alchemystApiKey) {
      alert("No API key saved. Please enter and save it first.");
      return;
    }

    try {
      const res = await fetch(
        "https://platform-backend.getalchemystai.com/api/v1/context/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${alchemystApiKey}`,
          },
          body: JSON.stringify({
            query: "sriram",
            similarity_threshold: 0.8,
            minimum_similarity_threshold: 0.5,
            scope: "internal",
            metadata: null,
          }),
        }
      );

      if (!res.ok) {
        const text = await res.text();
        alert(`❌ Request failed: HTTP ${res.status}\n${text}`);
        return;
      }

      const data = await res.json();
      const first =
        Array.isArray(data?.contexts) && data.contexts[0]?.content
          ? data.contexts[0].content.slice(0, 200)
          : "No contexts";
      alert(`✅ Success. Sample:\n${first}`);
    } catch (e) {
      alert(`❌ Error: ${e?.message || e}`);
    }
  });
