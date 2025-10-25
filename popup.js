(async () => {
  const { alchemystApiKey } = await chrome.storage.local.get(['alchemystApiKey']);
  console.log({ alchemystApiKey });

  document.getElementById('apiKey').value = alchemystApiKey || '';
  // document.getElementById('useApi').checked = useAlchemystApi || false;
})();

// UI helpers for feedback
function getEl(id) { return document.getElementById(id); }

function ensureStatusElement() {
  let el = document.getElementById('save-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'save-status';
    el.setAttribute('aria-live', 'polite');
    el.style.marginTop = '8px';
    el.style.fontSize = '12px';
    el.style.fontWeight = '600';
    el.style.borderRadius = '6px';
    el.style.padding = '8px';
    el.style.display = 'none';
    const card = document.querySelector('.card .actions')?.parentElement || document.body;
    card.appendChild(el);
  }
  return el;
}

function showStatus(message, type, duration = 3000) {
  const el = ensureStatusElement();
  
  el.textContent = message;
  
  if (type === 'success') {
    el.style.background = 'rgba(255, 255, 255, 0.1)';
    el.style.color = '#ffffff';
    el.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    el.style.borderLeft = '3px solid #ffffff';
  } else if (type === 'error') {
    el.style.background = 'rgba(255, 255, 255, 0.1)';
    el.style.color = '#ffffff';
    el.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    el.style.borderLeft = '3px solid #ffffff';
  } else {
    el.style.background = 'rgba(255, 255, 255, 0.1)';
    el.style.color = '#ffffff';
    el.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    el.style.borderLeft = '3px solid #ffffff';
  }
  
  el.style.display = 'block';
  el.style.borderRadius = '10px';
  el.style.padding = '12px';
  el.style.fontWeight = '600';
  el.style.animation = 'slideIn 0.3s ease-out';
  
  clearTimeout(showStatus._t);
  showStatus._t = setTimeout(() => { 
    el.style.display = 'none';
    el.innerHTML = '';
  }, duration);
}

function setSavingState(isSaving) {
  const btn = getEl('saveContext');
  if (!btn) return;
  if (isSaving) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
    btn.style.opacity = '0.7';
  } else {
    btn.disabled = false;
    btn.textContent = 'Save Context';
    btn.style.opacity = '1';
  }
}

async function flashBadge(text, color) {
  try {
    if (chrome?.action?.setBadgeText) {
      await chrome.action.setBadgeBackgroundColor({ color: color || '#10b981' });
      await chrome.action.setBadgeText({ text: text || '✓' });
      setTimeout(() => {
        chrome.action.setBadgeText({ text: '' });
      }, 3000);
    }
  } catch (_) {}
}

document.getElementById("saveKey").addEventListener("click", async () => {
  const apiKey = document.getElementById("apiKey").value.trim();
  if (!apiKey) {
    showStatus('Please enter an API key!', 'error');
    return;
  }

  const saveBtn = document.getElementById("saveKey");
  const originalText = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  saveBtn.style.opacity = '0.7';

  try {
    await chrome.storage.local.set({ alchemystApiKey: apiKey });
    showStatus('API key saved successfully!', 'success');
  } catch (error) {
    showStatus('Failed to save API key!', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = originalText;
    saveBtn.style.opacity = '1';
  }
});

document.getElementById("saveContext").addEventListener("click", async () => {
  console.log('[Save Context] Clicked');
  console.time('[Save Context] total');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.log('[Save Context] Active tab:', { id: tab?.id, url: tab?.url });
  setSavingState(true);
  showStatus('Saving context...', 'info');
  
  if (!tab?.url || (!tab.url.includes('chatgpt.com') && !tab.url.includes('chat.openai.com') && !tab.url.includes('claude.ai') && !tab.url.includes('gemini.google.com'))) {
    console.warn('[Save Context] Invalid tab URL:', tab?.url);
    showStatus('Please open a ChatGPT, Claude, or Gemini conversation first!', 'error');
    setSavingState(false);
    console.timeEnd('[Save Context] total');
    return;
  }

  const { alchemystApiKey } = await chrome.storage.local.get(['alchemystApiKey']);
  console.log('[Save Context] API key present:', !!alchemystApiKey);
  if (!alchemystApiKey) {
    showStatus('Please save your API key first!', 'error');
    setSavingState(false);
    console.timeEnd('[Save Context] total');
    return;
  }

  try {
    console.log('[Save Context] Executing scrape in tab...');
    console.time('[Save Context] executeScript');
    
    // Show saving indicator on the website
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: showSavingIndicator,
    });
    
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
        showStatus('No conversation found to save!', 'error');
        setSavingState(false);
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
            console.log('[Save Context] Success response received');
            showStatus('Context saved successfully!', 'success');
            setSavingState(false);
            
            // Show success indicator on website
            console.log('[Save Context] Showing success indicator on website');
            chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: showSuccessIndicator,
            }).catch(err => {
              console.error('[Save Context] Failed to show success indicator:', err);
            });
            
            // Also show success indicator in popup as fallback
            setTimeout(() => {
              console.log('[Save Context] Showing success indicator in popup');
              showSuccessIndicator();
            }, 100);
          } else {
            showStatus(`Failed to save context: ${response.error || 'Unknown error'}`, 'error');
            setSavingState(false);
            
            // Show error indicator on website
            chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: showErrorIndicator,
              args: [response.error || 'Unknown error']
            });
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
      showStatus('Failed to scrape conversation!', 'error');
      setSavingState(false);
      
      // Show error indicator on website
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: showErrorIndicator,
        args: ['Failed to scrape conversation']
      });
      
      console.timeEnd('[Save Context] total');
    }
  } catch (err) {
    console.error("[Save Context] Error:", err);
    showStatus('Error: ' + err.message, 'error');
    setSavingState(false);
    
    // Show error indicator on website
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: showErrorIndicator,
      args: [err.message]
    });
    
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
    const geminiMatch = url.match(/\/app\/([a-f0-9]+)/);
    console.log('[Scraper] Matches:', { chatgpt: !!chatgptMatch, claude: !!claudeMatch, gemini: !!geminiMatch });
    
    if (chatgptMatch) {
      memoryId = chatgptMatch[1];
    } else if (claudeMatch) {
      memoryId = claudeMatch[1];
    } else if (geminiMatch) {
      memoryId = geminiMatch[1];
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

    // Gemini branch: different DOM structure
    if (window.location.hostname.includes('gemini.google.com')) {
      console.log('[Scraper] Using Gemini selectors');
      
      // Find all conversation containers
      const conversationContainers = document.querySelectorAll('.conversation-container');
      console.log('[Scraper] Found Gemini conversation containers:', conversationContainers.length);
      
      conversationContainers.forEach((container, containerIdx) => {
        const containerId = container.id || `gemini-${containerIdx}-${Date.now()}`;
        
        // Extract user queries
        const userQueries = container.querySelectorAll('user-query');
        userQueries.forEach((query, queryIdx) => {
          const textLines = query.querySelectorAll('.query-text-line');
          let contentText = '';
          
          textLines.forEach((line) => {
            const text = (line.textContent || '').trim();
            if (text && text !== '') {
              if (contentText) contentText += '\n';
              contentText += text;
            }
          });
          
          if (contentText) {
            const messageId = `gemini-user-${containerId}-${queryIdx}-${Date.now()}`;
            const prefixed = `[user] ${contentText}`;
            contents.push({
              content: prefixed,
              metadata: { source: memoryId, messageId }
            });
            if (queryIdx < 2) console.log('[Scraper] Gemini user query added', { length: contentText.length });
          }
        });
        
        // Extract model responses
        const modelResponses = container.querySelectorAll('model-response');
        modelResponses.forEach((response, responseIdx) => {
          const markdownContent = response.querySelector('.markdown');
          if (markdownContent) {
            const textElements = markdownContent.querySelectorAll('p, li, code, pre');
            let contentText = '';
            
            textElements.forEach((el) => {
              const text = (el.textContent || '').trim();
              if (text) {
                if (contentText) contentText += '\n';
                contentText += text;
              }
            });
            
            // Fallback: get all text from markdown if no specific elements found
            if (!contentText) {
              const fallback = (markdownContent.textContent || '').trim();
              if (fallback) contentText = fallback;
            }
            
            if (contentText) {
              const messageId = `gemini-assistant-${containerId}-${responseIdx}-${Date.now()}`;
              const prefixed = `[assistant] ${contentText}`;
              contents.push({
                content: prefixed,
                metadata: { source: memoryId, messageId }
              });
              if (responseIdx < 2) console.log('[Scraper] Gemini assistant response added', { length: contentText.length });
            }
          }
        });
      });
      
      console.log('[Scraper] Gemini done', { count: contents.length });
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

// Website indicator functions
function showSavingIndicator() {
  const existing = document.getElementById('alchemyst-overlay');
  if (existing) existing.remove();
  
  const overlay = document.createElement('div');
  overlay.id = 'alchemyst-overlay';
  overlay.innerHTML = `
    <div style="
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.5);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <div style="
        background: #000000;
        border: 1px solid #333333;
        border-radius: 12px;
        padding: 30px;
        text-align: center;
        max-width: 300px;
        margin: 20px;
      ">
        <div style="
          width: 40px;
          height: 40px;
          border: 3px solid #333333;
          border-radius: 50%;
          border-top-color: #ffffff;
          animation: spin 1s linear infinite;
          margin: 0 auto 15px;
        "></div>
        
        <div style="
          color: #ffffff;
          font-size: 16px;
          font-weight: 600;
        ">Saving to Alchemyst AI...</div>
      </div>
    </div>
    
    <style>
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    </style>
  `;
  
  document.body.appendChild(overlay);
  
  // Auto-remove after 30 seconds as fallback
  setTimeout(() => {
    const fallbackOverlay = document.getElementById('alchemyst-overlay');
    if (fallbackOverlay && fallbackOverlay.parentNode) {
      fallbackOverlay.remove();
    }
  }, 30000);
}

function showSuccessIndicator() {
  console.log('[Success Indicator] Function called');
  // Remove any existing overlay
  const existing = document.getElementById('alchemyst-overlay');
  if (existing) {
    console.log('[Success Indicator] Removing existing overlay');
    existing.remove();
  }
  
  const overlay = document.createElement('div');
  overlay.id = 'alchemyst-overlay';
  overlay.innerHTML = `
    <div style="
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.5);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <div style="
        background: #000000;
        border: 2px solid #ffffff;
        border-radius: 12px;
        padding: 30px;
        text-align: center;
        max-width: 300px;
        margin: 20px;
        box-shadow: 0 0 20px rgba(255, 255, 255, 0.3);
      ">
        <div style="
          width: 50px;
          height: 50px;
          background: #ffffff;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 15px;
          font-size: 24px;
          color: #000000;
          font-weight: bold;
          animation: successPulse 0.6s ease-out;
        ">✓</div>
        
        <div style="
          color: #ffffff;
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 15px;
        ">Successfully Saved!</div>
        
        <button onclick="this.closest('#alchemyst-overlay').remove()" style="
          background: #ffffff;
          color: #000000;
          border: none;
          border-radius: 8px;
          padding: 8px 16px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
        ">Close</button>
      </div>
    </div>
    
    <style>
      @keyframes successPulse {
        0% { transform: scale(0.8); }
        50% { transform: scale(1.1); }
        100% { transform: scale(1); }
      }
    </style>
  `;
  
  document.body.appendChild(overlay);
  console.log('[Success Indicator] Overlay added to document');
  
  // Auto-remove after 5 seconds (increased from 3)
  setTimeout(() => {
    console.log('[Success Indicator] Auto-removing overlay');
    if (overlay && overlay.parentNode) {
      overlay.remove();
    }
  }, 5000);
}

function showErrorIndicator(errorMessage) {
  // Remove any existing overlay
  const existing = document.getElementById('alchemyst-overlay');
  if (existing) existing.remove();
  
  const overlay = document.createElement('div');
  overlay.id = 'alchemyst-overlay';
  overlay.innerHTML = `
    <div style="
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.5);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <div style="
        background: #000000;
        border: 1px solid #333333;
        border-radius: 12px;
        padding: 30px;
        text-align: center;
        max-width: 300px;
        margin: 20px;
      ">
        <div style="
          width: 40px;
          height: 40px;
          background: #ffffff;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 15px;
          font-size: 20px;
          color: #000000;
          font-weight: bold;
        ">!</div>
        
        <div style="
          color: #ffffff;
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 10px;
        ">Save Failed</div>
        
        <div style="
          color: #cccccc;
          font-size: 14px;
          margin-bottom: 15px;
        ">${errorMessage || 'Unknown error occurred'}</div>
        
        <button onclick="
          this.closest('#alchemyst-overlay').remove();
          document.getElementById('saveContext').click();
        " style="
          background: #ffffff;
          color: #000000;
          border: none;
          border-radius: 8px;
          padding: 8px 16px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
        ">Try Again</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (overlay && overlay.parentNode) {
      overlay.remove();
    }
  }, 5000);
}
