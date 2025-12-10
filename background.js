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
  
  let isDisconnected = false;
  port.onDisconnect.addListener(() => {
    isDisconnected = true;
    console.log("[Port Disconnected]:", port.name);
  });

  port.onMessage.addListener(async (msg) => {
    console.log("[Port Message Received]:", msg?.type, "query:", msg?.query, "id:", msg?.id);

    if (msg?.type === "addMemory") {
      console.log('[addMemory] Received', { id: msg?.id, memoryId: msg?.memoryId, count: Array.isArray(msg?.contents) ? msg.contents.length : 'not-array' });
      try {
        const { alchemystApiKey } = await chrome.storage.local.get("alchemystApiKey");
        if (!alchemystApiKey) {
          if (!isDisconnected) {
            try { 
              port.postMessage({ id: msg.id, error: "No API key found." }); 
            } catch (_) {}
          }
          return;
        }

        const payload = {
          memoryId: msg.memoryId,
          contents: Array.isArray(msg.contents) ? msg.contents : [],
        };
        console.log('[addMemory] Payload preview', { memoryId: payload.memoryId, count: payload.contents.length, first: payload.contents[0] });

        const attempt = async (triesLeft, delayMs) => {
          console.log(`[addMemory] Attempt ${4 - triesLeft}/3, delayMs=${delayMs}`);
          const res = await fetch(
            "https://platform-backend.getalchemystai.com/api/v1/context/memory/add",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${alchemystApiKey}`,
              },
              body: JSON.stringify(payload),
            }
          );
          const text = await res.text().catch(() => "");
          if (res.ok) {
            console.log('[addMemory] Success response length:', text?.length || 0);
            if (!isDisconnected) { 
              try { 
                port.postMessage({ id: msg.id, ok: true, body: text }); 
              } catch (_) {} 
            }
            return true;
          }
          const status = res.status || 0;
          console.error('[addMemory] HTTP failure', { status, body: text?.slice(0, 500) });
          if (status >= 500 && status < 600 && triesLeft > 0) {
            await new Promise((r) => setTimeout(r, delayMs));
            return attempt(triesLeft - 1, delayMs * 2);
          }
          console.error("[Port] addMemory failed", status, text?.slice(0, 400));
          if (!isDisconnected) { 
            try { 
              port.postMessage({ id: msg.id, error: `HTTP ${status}`, body: text }); 
            } catch (_) {} 
          }
          return false;
        };

        await attempt(3, 1000);
      } catch (err) {
        console.error("[Port] addMemory error:", err);
        if (!isDisconnected) {
          try {
            port.postMessage({ id: msg.id, error: "Failed to save memory" });
          } catch (_) {}
        }
      }
      return;
    }

    if (msg?.type === "fetchContext") {
      // Guard: avoid network call for empty/whitespace-only queries
      const trimmedQuery = String(msg?.query || "").trim();
      if (!trimmedQuery) {
        console.log("[Port] Empty query received, returning empty context immediately", { id: msg?.id });
        if (!isDisconnected) {
          try {
            port.postMessage({ id: msg?.id, context: "" });
          } catch (e) {
            console.warn("[Port] Failed to post empty context (disconnected?)", e);
          }
        } else {
          console.log("[Port] Skipping response because port is disconnected", { id: msg?.id });
        }
        return;
      }
      try {
        const { alchemystApiKey } = await chrome.storage.local.get(
          "alchemystApiKey"
        );
        if (!alchemystApiKey) {
          console.warn("No API key found for port connection");
          if (!isDisconnected) {
            try {
              port.postMessage({
                id: msg.id,
                error: "No API key found. Please add it in the extension popup.",
              });
            } catch (e) {
              console.warn("[Port] Failed to post API key error (disconnected?)", e);
            }
          }
          return;
        }

        console.log("[Port] Making API request...");
        const res = await fetch(
          "https://platform-backend.getalchemystai.com/api/v1/context/search?mode=fast",
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
          if (!isDisconnected) {
            try {
              port.postMessage({
                id: msg.id,
                error: `HTTP ${res.status}`,
                details: text,
              });
            } catch (e) {
              console.warn("[Port] Failed to post HTTP error (disconnected?)", e);
            }
          } else {
            console.log("[Port] Skipping error response because port is disconnected", { id: msg?.id });
          }
          return;
        }

        const data = await res.json();
        console.log("[Port] API Response received:", {
          statusText: data?.statusText,
          contextCount: data?.contexts?.length,
          hasContexts: Array.isArray(data?.contexts) && data.contexts.length > 0,
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
          topContentsPreview: topContents.substring(0, 100),
          isEmpty: topContents.length === 0
        });
        console.log("[Port] Sending response for message:", msg.id);
        if (!isDisconnected) {
          try {
            port.postMessage({ id: msg.id, context: topContents });
            console.log("[Port] Response sent successfully");
          } catch (e) {
            console.warn("[Port] Failed to send response (disconnected?)", e);
          }
        } else {
          console.log("[Port] Skipping response because port is disconnected", { id: msg?.id });
        }
      } catch (err) {
        console.error("[Port] Context fetch failed:", err);
        if (!isDisconnected) {
          try {
            port.postMessage({ id: msg.id, error: "Failed to fetch context" });
          } catch (e) {
            console.warn("[Port] Failed to post generic error (disconnected?)", e);
          }
        } else {
          console.log("[Port] Skipping error response because port is disconnected", { id: msg?.id });
        }
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

// Set uninstall URL when extension is installed or updated
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("[Install] Extension installed/updated:", details.reason);
  
  // Set the PostHog survey as the uninstall URL
  try {
    await chrome.runtime.setUninstallURL("https://us.posthog.com/external_surveys/019a1b80-4e96-0000-fe73-12e14a6b6cac");
    console.log("[Install] Uninstall URL set to PostHog survey");
  } catch (error) {
    console.error("[Install] Failed to set uninstall URL:", error);
  }
});
