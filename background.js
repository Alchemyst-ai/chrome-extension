// Keep service worker alive - only handle keepAlive messages
chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  console.log("[Message Received]:", msg.type, "from:", sender.tab?.url || "unknown");
  
  // Keep service worker alive by responding to pings
  if (msg.type === "keepAlive") {
    console.log("[Keep Alive] Ping received from:", sender.tab?.url || "unknown");
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "ping") {
    console.debug("Ping received");
    sendResponse({ ok: true });
    return true;
  }
  
  // All fetchContext requests now go through port connections
  return false;
});

// Long-lived connection to reduce "extension context invalidated" issues
chrome.runtime.onConnect.addListener((port) => {
  console.log("[Port Connected]:", port.name);

  if (port.name !== "alchemyst") return;
  
  port.onDisconnect.addListener(() => {
    console.log("[Port Disconnected]:", port.name);
  });
  
  port.onMessage.addListener(async (msg) => {
    console.log("[Port Message Received]:", msg?.type, "query:", msg?.query, "id:", msg?.id);

    if (msg?.type === "fetchContext") {
      try {
        const { alchemystApiKey } = await chrome.storage.local.get(
          "alchemystApiKey"
        );
        if (!alchemystApiKey) {
          console.warn("No API key found for port connection");
          port.postMessage({
            id: msg.id,
            error: "No API key found. Please add it in the extension popup.",
          });
          return;
        }

        console.log("[Port] Making API request...");
        const res = await fetch(
          "https://platform-backend.getalchemystai.com/api/v1/context/search",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${alchemystApiKey}`,
            },
            body: JSON.stringify({
              query: msg.query,
              similarity_threshold: 0.8,
              minimum_similarity_threshold: 0.5,
              scope: "internal",
              metadata: null,
            }),
          }
        );

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.error("[Port] API request failed:", {
            status: res.status,
            details: text,
          });
          port.postMessage({
            id: msg.id,
            error: `HTTP ${res.status}`,
            details: text,
          });
          return;
        }

        const data = await res.json();
        console.log("[Port] API Response received:", {
          contextCount: data?.contexts?.length,
        });

        const contexts = Array.isArray(data?.contexts) ? data.contexts : [];
        const topContents = contexts
          .sort((a, b) => (b?.score || 0) - (a?.score || 0))
          .slice(0, 5)
          .map((c) => `- ${c?.content || ""}`)
          .filter(Boolean)
          .join("\n");

        console.log("[Port] Processed contexts:", {
          totalContexts: contexts.length,
          topContentsLength: topContents.length,
          topContents: topContents
        });
        console.log("[Port] Sending response for message:", msg.id);
        port.postMessage({ id: msg.id, context: topContents });
        console.log("[Port] Response sent successfully");
      } catch (err) {
        console.error("[Port] Context fetch failed:", err);
        port.postMessage({ id: msg.id, error: "Failed to fetch context" });
      }
    }
  });
});

// Offscreen keep-alive
async function ensureOffscreenDocument() {
  console.log("[Offscreen] Checking document status...");
  const offscreenUrl = chrome.runtime.getURL("offscreen.html");
  const hasOffscreen = await chrome.offscreen.hasDocument?.();
  if (hasOffscreen) {
    console.log("[Offscreen] Document already exists");
    return;
  }
  try {
    console.log("[Offscreen] Creating new document...");
    await chrome.offscreen.createDocument({
      url: offscreenUrl,
      reasons: [chrome.offscreen.Reason.DOM_SCRAPING],
      justification:
        "Keep service worker warm for prompt interception and API fetch.",
    });
    console.log("[Offscreen] Document created successfully");
  } catch (e) {
    console.warn("[Offscreen] Creation failed (might already exist):", e);
  }
}

// Create offscreen when SW starts and on first connection
ensureOffscreenDocument().catch((err) => {
  console.error("[Offscreen] Initial setup failed:", err);
});

chrome.runtime.onConnect.addListener(() => {
  console.log(
    "[Connection] New connection detected, ensuring offscreen document..."
  );
  ensureOffscreenDocument().catch((err) => {
    console.error("[Connection] Offscreen setup failed:", err);
  });
});

// Respond to pings from offscreen/content to keep SW active
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "keepAlive") {
    console.debug("[KeepAlive] Ping received");
    sendResponse({ ok: true, ts: Date.now() });
    return true;
  }
});
