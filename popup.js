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

document.getElementById("saveContext").addEventListener("click", async () => {
  console.log('[Save Context] Clicked');
  console.time('[Save Context] total');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.log('[Save Context] Active tab:', { id: tab?.id, url: tab?.url });
  
  if (!tab?.url || (!tab.url.includes('chatgpt.com') && !tab.url.includes('chat.openai.com') && !tab.url.includes('claude.ai'))) {
    console.warn('[Save Context] Invalid tab URL:', tab?.url);
    alert("❌ Please open a ChatGPT or Claude conversation first!");
    console.timeEnd('[Save Context] total');
    return;
  }

  const { alchemystApiKey } = await chrome.storage.local.get(['alchemystApiKey']);
  console.log('[Save Context] API key present:', !!alchemystApiKey);
  if (!alchemystApiKey) {
    alert("❌ Please save your API key first!");
    console.timeEnd('[Save Context] total');
    return;
  }

  try {
    console.log('[Save Context] Executing scrape in tab...');
    console.time('[Save Context] executeScript');
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeConversation,
    });
    console.timeEnd('[Save Context] executeScript');
    console.log('[Save Context] Raw results:', results);

    if (results && results[0] && results[0].result) {
      const { memoryId, contents } = results[0].result;
      console.log('[Save Context] Extracted memoryId:', memoryId);
      console.log('[Save Context] Contents count:', Array.isArray(contents) ? contents.length : 'not-array');
      if (Array.isArray(contents)) console.log('[Save Context] First item sample:', contents[0]);
      
      if (!contents || contents.length === 0) {
        console.warn('[Save Context] No contents extracted');
        alert("❌ No conversation found to save!");
        console.timeEnd('[Save Context] total');
        return;
      }

      const port = chrome.runtime.connect({ name: "alchemyst" });
      const messageId = Date.now() + Math.random();
      console.log('[Save Context] Posting addMemory via port', { messageId, memoryId, count: contents.length });
      
      port.onMessage.addListener((response) => {
        if (response.id === messageId) {
          console.log('[Save Context] Port response:', response);
          try { port.disconnect(); } catch (_) {}
          if (response.ok) {
            alert("✅ Context saved successfully!");
          } else {
            alert(`❌ Failed to save context: ${response.error || 'Unknown error'}`);
          }
          console.timeEnd('[Save Context] total');
        }
      });

      port.postMessage({
        type: "addMemory",
        id: messageId,
        memoryId: memoryId,
        contents: contents
      });
      console.log('[Save Context] addMemory posted');
    } else {
      console.error('[Save Context] Unexpected results format');
      alert("❌ Failed to scrape conversation!");
      console.timeEnd('[Save Context] total');
    }
  } catch (err) {
    console.error("[Save Context] Error:", err);
    alert("❌ Error: " + err.message);
    console.timeEnd('[Save Context] total');
  }
});

function scrapeConversation() {
  try {
    console.log('[Scraper] Starting');
    console.time('[Scraper] total');
    const url = window.location.href;
    console.log('[Scraper] URL:', url);
    let memoryId = '';
    
    const chatgptMatch = url.match(/\/c\/([a-f0-9-]+)/);
    const claudeMatch = url.match(/\/chat\/([a-f0-9-]+)/);
    console.log('[Scraper] Matches:', { chatgpt: !!chatgptMatch, claude: !!claudeMatch });
    
    if (chatgptMatch) {
      memoryId = chatgptMatch[1];
    } else if (claudeMatch) {
      memoryId = claudeMatch[1];
    } else {
      memoryId = 'unknown-' + Date.now();
    }

    const contents = [];

    // Claude.ai branch: different DOM
    if (window.location.hostname.includes('claude.ai')) {
      console.log('[Scraper] Using Claude selectors');
      const nodes = Array.from(document.querySelectorAll('[data-testid="user-message"], .standard-markdown'));
      console.log('[Scraper] Found Claude nodes:', nodes.length);
      nodes.forEach((node, idx) => {
        const isUser = node.matches('[data-testid="user-message"]');
        const role = isUser ? 'user' : 'assistant';
        const textElements = node.querySelectorAll('p, li, code, pre code');
        let contentText = '';
        textElements.forEach((el) => {
          const text = (el.textContent || '').trim();
          if (text) {
            if (contentText) contentText += '\n';
            contentText += text;
          }
        });
        if (!contentText) {
          const fallback = (node.textContent || '').trim();
          if (fallback) contentText = fallback;
        }
        if (contentText) {
          const messageId = `claude-${role}-${idx}-${Date.now()}`;
          const prefixed = `[${role}] ${contentText}`;
          contents.push({
            content: prefixed,
            metadata: { source: memoryId, messageId }
          });
          if (idx < 2) console.log('[Scraper] Claude added', { role, length: contentText.length });
        }
      });
      console.log('[Scraper] Claude done', { count: contents.length });
      console.timeEnd('[Scraper] total');
      return { memoryId, contents };
    }

    // ChatGPT branch
    const articles = document.querySelectorAll('article[data-testid^="conversation-turn"]');
    console.log('[Scraper] Found articles:', articles.length);
    
    articles.forEach((article, idx) => {
      const turnId = article.getAttribute('data-testid') || article.getAttribute('data-turn-id') || '';
      const messageId = turnId.replace('conversation-turn-', '') || `msg-${Date.now()}-${Math.random()}`;
      const role = article.getAttribute('data-turn') || (article.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role')) || 'unknown';
      
      const bubble = article.querySelector('[data-message-author-role]') || article;
      const textElements = bubble.querySelectorAll('p, pre code, li, div.whitespace-pre-wrap');
      let contentText = '';
      
      textElements.forEach((el) => {
        const text = (el.textContent || '').trim();
        if (text) {
          if (contentText) contentText += '\n';
          contentText += text;
        }
      });
      
      // Fallback: take the bubble's full text if granular elements didn't yield content
      if (!contentText) {
        const fallback = (bubble.textContent || '').trim();
        if (fallback) contentText = fallback;
      }
      
      if (contentText) {
        const prefixed = `[${role}] ${contentText}`;
        contents.push({
          content: prefixed,
          metadata: {
            source: memoryId,
            messageId: messageId
          }
        });
        if (idx < 2) console.log('[Scraper] Added message', { messageId, role, length: contentText.length });
      } else {
        if (idx < 2) console.log('[Scraper] Skipped empty article', { turnId, role });
      }
    });

    console.log('[Scraper] Done', { memoryId, count: contents.length });
    console.timeEnd('[Scraper] total');
    return { memoryId, contents };
  } catch (e) {
    console.error('[Scraper] Failed:', e);
    return { memoryId: 'error-' + Date.now(), contents: [] };
  }
}
