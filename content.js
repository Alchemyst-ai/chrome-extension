let alchemystInjectionInProgress = false;
let alchemystPort = null;
let nextMessageId = 1;

// Ensure React-controlled inputs update correctly
function setNativeValue(element, value) {
  const valueSetter = Object.getOwnPropertyDescriptor(element.__proto__, 'value')?.set;
  const prototype = element.__proto__;
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

function getPromptText(el) {
  if (!el) return "";
  if (el.tagName === 'TEXTAREA' || typeof el.value === 'string') {
    return (el.value || '').trim();
  }
  const text = (el.value ?? el.textContent ?? el.innerText ?? '');
  return String(text).trim();
}

function setPromptText(el, value) {
  if (!el) return;
  if (el.tagName === 'TEXTAREA' || typeof el.value === 'string') {
    setNativeValue(el, value);
    return;
  }
  // contenteditable or other elements
  el.textContent = value;
  try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) { }
}

function getPort() {
  if (!alchemystPort) {
    try {
      alchemystPort = chrome.runtime.connect({ name: "alchemyst" });
      alchemystPort.onDisconnect.addListener(() => {
        alchemystPort = null;
      });
    } catch (_) {
      alchemystPort = null;
    }
  }
  return alchemystPort;
}

function fetchContextViaPort(query) {
  return new Promise((resolve, reject) => {
    const port = getPort();
    if (!port) {
      reject(new Error("no-port"));
      return;
    }
    const id = nextMessageId++;
    const onMsg = (msg) => {
      if (msg?.id !== id) return;
      port.onMessage.removeListener(onMsg);
      resolve(msg);
    };
    port.onMessage.addListener(onMsg);
    port.postMessage({ type: "fetchContext", id, query });
    setTimeout(() => {
      try { port.onMessage.removeListener(onMsg); } catch (_) { }
      resolve({ error: "timeout" });
    }, 8000);
  });
}

document.addEventListener("keydown", async (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    const inputEl = document.querySelector('#prompt-textarea') || 
                    document.querySelector('textarea') || 
                    document.querySelector('[contenteditable="true"]') ||
                    document.querySelector('.tiptap.ProseMirror') ||
                    document.querySelector('[data-editor="true"]');
    if (!inputEl) return;

    const query = getPromptText(inputEl);
    if (!query) return;

    try {
      const memoryEnabled = localStorage.getItem('alchemyst_memory_enabled') === 'true';
      if (!memoryEnabled) return;
    } catch (_) { /* ignore */ }

  // For Gemini, let the inpage script handle request interception
  // Don't interfere with the Enter key for Gemini
  if (window.location.hostname.includes('gemini.google.com')) {
    return; // Let the natural flow continue
  }
  // ChatGPT.
  if (window.location.hostname.includes('chatgpt.com')) {
    return;
  }
  // For Perplexity, let the inpage script handle request interception
  // Don't interfere with the Enter key for Perplexity
  if (window.location.hostname.includes('perplexity.ai')) {
    return; // Let the natural flow continue
  }
  // For DeepSeek, let the inpage script handle request interception
  // Don't interfere with the Enter key for DeepSeek
  if (window.location.hostname.includes('chat.deepseek.com')) {
    return; // Let the natural flow continue
  }
  // For i10x.ai, let the inpage script handle request interception
  if (window.location.hostname.includes('i10x.ai')) {
    return; // Let the natural flow continue
  }
  // For Emergent AI, let the inpage script handle request interception
  if (window.location.hostname.includes('app.emergent.sh')) {
    return; // Let the natural flow continue
  }
  // For Compas AI (agt.compasai.com), let inpage handle interception
  if (window.location.hostname.includes('agt.compasai.com')) {
    return; // Let the natural flow continue
  }

    if (alchemystInjectionInProgress) {
      // Allow the natural submit after we've injected once
      alchemystInjectionInProgress = false;
      return;
    }

    e.preventDefault(); // Stop immediate send

    let response = null;
    try {
      // Try long-lived port first
      response = await fetchContextViaPort(query);
      if (response?.error) {
        // Fallback to runtime messaging
        await chrome.runtime.sendMessage({ type: "ping" }).catch(() => { });
        response = await chrome.runtime.sendMessage({ type: "fetchContext", query });
      }
    } catch (err) {
      // Messaging failed → fallback to sending original query
      setPromptText(inputEl, query);
      alchemystInjectionInProgress = true;
      const enterEvent = new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true
      });
      inputEl.dispatchEvent(enterEvent);
      return;
    }

    const submit = () => {
      const btn = document.getElementById('composer-submit-button') || 
                  document.querySelector('#composer-submit-button') ||
                  document.querySelector('[data-testid="prompt-form-send-button"]') ||
                  document.querySelector('button[type="submit"]');
      alchemystInjectionInProgress = true;
      if (btn) { btn.click(); return; }
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
      inputEl.dispatchEvent(enterEvent);
    };

    if (response?.context) {
      const processed = response.context || "";
      const enriched = `\n\nThe context of the conversation is:\n\n\`\`\`\n${processed}\n\`\`\`\n\nThe user query is:\n\`\`\`\n${query}\n\`\`\``;
      setPromptText(inputEl, enriched);
      submit();
    } else {
      // fallback - send original query if no context
      setPromptText(inputEl, query);
      submit();
    }
  }
});

// Periodic ping to keep SW active
setInterval(() => {
  try { chrome.runtime.sendMessage({ type: 'keepAlive' }).catch(() => { }); } catch (_) { }
}, 30000);

// Inject logo button next to the voice icon
(function injectLogoButton() {
  const BTN_ID = 'alchemyst-logo-button';
  const VOICE_CONTAINER_SELECTOR = '[data-testid="composer-speech-button-container"]';
  const DICTATE_BUTTON_SELECTOR = 'button[aria-label="Dictate button"]';
  const CLAUDE_BUTTONS_CONTAINER = '.relative.flex-1.flex.items-center.gap-2.shrink.min-w-0';
  const GEMINI_TOOLBOX_CONTAINER = '.leading-actions-wrapper, .input-area, .input-container, [data-testid="input-area"]';
  const MEMORY_STATE_KEY = 'alchemyst_memory_enabled';

  function ensureButton() {
    try {
      // Check which platform we're on
      const windowUrl = window.location.hostname;
      let target, parentFlex;
      let referenceNode = null; 
      let parentContainer = null;
      
      if (windowUrl.includes('gemini.google.com')) {
        // Gemini: Insert in the leading-actions-wrapper container
        const toolboxContainer = document.querySelector('.leading-actions-wrapper');
        if (toolboxContainer) {
          target = toolboxContainer;
          parentFlex = toolboxContainer;
        } else {
          // Try alternative selectors for Gemini
          const alternatives = [
            '.input-area',
            '.input-container', 
            '[data-testid="input-area"]',
            '.composer-input',
            '.chat-input',
            'textarea[placeholder*="Enter a prompt"]',
            'textarea[aria-label*="Enter a prompt"]'
          ];
          
          for (const selector of alternatives) {
            const altContainer = document.querySelector(selector);
            if (altContainer) {
              target = altContainer;
              parentFlex = altContainer.parentElement || altContainer;
              break;
            }
          }
          
          if (!target) {
            return;
          }
        }
      } if (windowUrl.includes('claude.ai')) {
        const editor = document.querySelector('[contenteditable="true"]');
        
        if (editor) {
          let container = editor.parentElement; 
          while (container && container.tagName !== 'FIELDSET' && !container.querySelector('button')) {
             container = container.parentElement;
             if (!container || container === document.body) break; // Safety break
          }

          if (container) {
            const existingButton = container.querySelector('button');
            if (existingButton) {
               parentFlex = existingButton.parentElement;
               target = parentFlex.firstElementChild; 
            }
          }
        }
      } else if (windowUrl.includes('v0.app')) {
        // v0: Insert in the right toolbar (ml-auto flex items-center gap-0.5 sm:gap-1)
        const rightToolbar = document.querySelector('.ml-auto.flex.items-center.gap-0\\.5') ||
                            document.querySelector('[class*="ml-auto"][class*="flex"][class*="items-center"]') ||
                            document.querySelector('div[class*="ml-auto"]');
        
        if (rightToolbar) {
          // Insert in the right toolbar as the first button
          parentFlex = rightToolbar;
          target = rightToolbar.firstElementChild; // Insert before the first button
        } else {
          // Fallback: try to find any container with the send button
          const sendButton = document.querySelector('[data-testid="prompt-form-send-button"]');
          if (sendButton) {
            parentFlex = sendButton.parentElement;
            target = sendButton;
          } else {
            return;
          }
        }
      } else if (windowUrl.includes('lovable.dev')) {
        // Lovable: Insert into the form toolbar on the right (ml-auto flex items-center gap-1)
        const form = document.querySelector('form#chat-input');
        let toolbar = null;
        if (form) {
          toolbar = form.querySelector('.ml-auto.flex.items-center.gap-1') || form.querySelector('.ml-auto');
        }
        if (toolbar) {
          parentFlex = toolbar;
          target = toolbar.firstElementChild || toolbar;
        } else {
          // Fallback: try send button parent
          const sendBtn = document.getElementById('chatinput-send-message-button') || form?.querySelector('#chatinput-send-message-button');
          if (sendBtn && sendBtn.parentElement) {
            parentFlex = sendBtn.parentElement;
            target = sendBtn;
          } else {
            return;
          }
        }
      } else if (windowUrl.includes('chatgpt.com') || windowUrl.includes('chat.openai.com')) {
        // ChatGPT: Prefer to insert before the Dictate button; fallback to the voice container
        const dictateBtn = document.querySelector(DICTATE_BUTTON_SELECTOR);
        const voiceContainer = document.querySelector(VOICE_CONTAINER_SELECTOR);
        const dictateWrapper = dictateBtn ? (dictateBtn.closest('span') || dictateBtn) : null;
        parentFlex = (voiceContainer && voiceContainer.parentElement) || (dictateWrapper && dictateWrapper.parentElement);
        target = dictateWrapper || voiceContainer;
      } else if (windowUrl.includes('bolt.new')) {
        // Bolt: Insert in the composer toolbar row
        const row = document.querySelector('.flex.justify-between.text-sm') || document.querySelector('[class*="justify-between"][class*="text-sm"]');
        if (!row) return;
        // Prefer the left group within the row
        const leftGroup = row.querySelector('.flex.gap-1.items-center.w-full') || row.querySelector('.flex.gap-1');
        parentFlex = leftGroup || row;
        target = (leftGroup && leftGroup.firstElementChild) || row.firstElementChild;
      } else if (windowUrl.includes('perplexity.ai')) {
        const textarea = document.querySelector('textarea');
        if (textarea) {
           const wrapper = textarea.closest('div.relative');
           if (wrapper) {
              let toolbar = wrapper.nextElementSibling;
              
              if (!toolbar) {
                 toolbar = wrapper.querySelector('div.flex.justify-between');
              }

              if (toolbar) {
                 const leftGroup = toolbar.firstElementChild;
                 if (leftGroup) {
                    parentContainer = leftGroup;
                    referenceNode = leftGroup.firstElementChild;
                 }
              }
           }
        }
      } else if (windowUrl.includes('manus.im')) {
        // Manus: Insert in the left button section (flex gap-2 items-center flex-shrink-0)
        // Try multiple selectors to handle potential class name variations
        const leftButtonSection = document.querySelector('.flex.gap-2.items-center.flex-shrink-0') ||
                                   document.querySelector('[class*="flex"][class*="gap-2"][class*="items-center"][class*="flex-shrink-0"]');
        if (leftButtonSection) {
          parentFlex = leftButtonSection;
          target = leftButtonSection.lastElementChild; // Insert after the last button (cable icon)
        } else {
          return;
        }
      } else if (windowUrl.includes('chat.deepseek.com')) {
        // DeepSeek: Insert in the button container (.ec4f5d61) alongside DeepThink and Search buttons
        const buttonContainer = document.querySelector('.ec4f5d61') ||
                                document.querySelector('[class*="ec4f5d61"]');
        if (buttonContainer) {
          parentFlex = buttonContainer;
          target = buttonContainer.firstElementChild; // Insert before first button (DeepThink)
        } else {
          return;
        }
      } else if (windowUrl.includes('i10x.ai')) {
        // i10x.ai: Insert beside the Send button within the composer block (not header)
        // Find the composer container via the textarea[name="input"]
        const textarea = document.querySelector('textarea[name="input"]');
        const composer = textarea ? textarea.parentElement : null; // the rounded-lg border p-3 container
        if (!composer) return;
        const toolbarRow = composer.querySelector('.flex.justify-between') ||
                           composer.querySelector('[class*="flex"][class*="justify-between"]');
        if (!toolbarRow) return;

        // Find the actual Send button and insert our icon as its sibling
        const sendIcon = toolbarRow.querySelector('.lucide-send-horizontal');
        const sendButton = sendIcon ? sendIcon.closest('button') : null;
        if (!sendButton || !sendButton.parentElement) return;
        parentFlex = sendButton.parentElement;
        target = sendButton; // place our wrapper before the send button
      } else if (windowUrl.includes('app.emergent.sh')) {
        // Emergent: Insert in the button toolbar, in the left group with other action buttons
        // Strategy: Find textarea -> form -> buttons container -> left group
        // Works for all Emergent pages (chat, running agent, main task page, etc.)
        
        // Try both textarea variants (chat page and main task page)
        let textarea = document.querySelector('[data-testid="chat-input-textarea"]') ||
                      document.querySelector('[data-testid="main-task-input"]') ||
                      document.querySelector('#mainTaskInput');
        
        if (!textarea) return;
        
        // Find the form or parent container
        let form = textarea.closest('form');
        // If no form, find the parent container that has the buttons
        if (!form) {
          const textareaContainer = textarea.closest('div');
          if (textareaContainer) {
            form = textareaContainer.parentElement;
          }
        }
        if (!form) return;
        
        // Find the buttons container (div with flex items-center justify-between)
        // Try multiple strategies to find it
        let buttonsContainer = Array.from(form.querySelectorAll('div')).find(div => {
          return div.classList.contains('flex') && 
                 div.classList.contains('items-center') && 
                 div.classList.contains('justify-between') &&
                 (div.querySelector('[data-testid="chat-input-submit"]') || 
                  div.querySelector('[data-testid="main-task-submit"]') ||
                  div.querySelector('button[type="submit"]') ||
                  div.querySelector('img[src*="send.svg"]') ||
                  div.querySelector('img[src*="pause.svg"]') ||
                  div.querySelector('img[src*="submit-arrow.svg"]'));
        });
        
        // Fallback: find by class structure even without submit button
        if (!buttonsContainer) {
          buttonsContainer = Array.from(form.querySelectorAll('div')).find(div => {
            return div.classList.contains('flex') && 
                   div.classList.contains('items-center') && 
                   div.classList.contains('justify-between') &&
                   (div.classList.contains('p-2.5') || div.classList.contains('p-2'));
          });
        }
        
        if (!buttonsContainer) return;
        
        // Find the left group (div with relative flex items-center gap-2 OR flex flex-row items-center gap-2)
        // This contains attach, GitHub, Fork, Ultra buttons (or attach, GitHub, model selector for main task page)
        let leftGroup = Array.from(buttonsContainer.querySelectorAll('div')).find(div => {
          const hasFlex = div.classList.contains('flex');
          const hasItemsCenter = div.classList.contains('items-center');
          const hasGap2 = div.classList.contains('gap-2');
          const hasRelative = div.classList.contains('relative');
          const hasFlexRow = div.classList.contains('flex-row');
          
          // Check for common button indicators
          const hasAttach = div.querySelector('img[src*="attach.svg"]') || 
                           div.querySelector('img[src*="copy-paperclip.svg"]') ||
                           div.querySelector('img[src*="paperclip"]');
          const hasGitHub = div.querySelector('img[src*="white-github.svg"]') ||
                           div.querySelector('img[src*="github-icon.svg"]') ||
                           div.querySelector('img[src*="github"]');
          const hasFork = div.querySelector('img[src*="fork.svg"]');
          const hasModelSelector = div.querySelector('[data-testid="model-selector"]');
          
          return hasFlex && hasItemsCenter && hasGap2 && 
                 (hasRelative || hasFlexRow) &&
                 (hasAttach || hasGitHub || hasFork || hasModelSelector);
        });
        
        if (leftGroup) {
          parentFlex = leftGroup;
          target = null;
        } else {
          return;
        }
      } else if (windowUrl.includes('agt.compasai.com')) {
        // Compas AI (AGT): Insert in the bottom toolbar row beside controls
        const toolbarRow = document.querySelector('.flex.flex-wrap.items-center.border-t') ||
                           document.querySelector('[class*="flex-wrap"][class*="items-center"][class*="border-t"]');
        if (toolbarRow) {
          parentFlex = toolbarRow;
          target = toolbarRow.firstElementChild;
        } else {
          const altRow = document.querySelector('.flex.flex-row.items-center.justify-between') ||
                         document.querySelector('[class*="items-center"][class*="justify-between"]');
          if (!altRow) return;
          parentFlex = altRow;
          target = altRow.firstElementChild;
        }
      }

      if (!parentFlex) return;

      // If already present, exit
      if (document.getElementById(BTN_ID)) return;

      const parent = parentFlex; // row container where the controls live

      const imgSrc = chrome.runtime.getURL('images/logo.png');
      const wrapper = document.createElement('div');
      wrapper.id = BTN_ID;
      wrapper.style.display = 'inline-flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.justifyContent = 'center';
      wrapper.style.width = '36px';
      wrapper.style.height = '36px';
      wrapper.style.cursor = 'pointer';
      wrapper.style.borderRadius = '50%';
      wrapper.style.transition = 'opacity 0.2s';
      wrapper.style.opacity = '1';
      
      // Gemini-specific styling to match Material Design
      if (windowUrl.includes('gemini.google.com')) {
        wrapper.style.border = 'none';
        wrapper.style.background = 'transparent';
        wrapper.style.boxShadow = 'none';
      }
      // v0-specific styling to match the platform design
      if (windowUrl.includes('v0.app')) {
        wrapper.style.border = 'none';
        wrapper.style.background = 'transparent';
        wrapper.style.boxShadow = 'none';
        wrapper.style.marginRight = '8px';
      }
      // Bolt-specific styling
      if (windowUrl.includes('bolt.new')) {
        wrapper.style.border = 'none';
        wrapper.style.background = 'transparent';
        wrapper.style.boxShadow = 'none';
        wrapper.style.marginRight = '6px';
      }
      // Perplexity-specific styling
      if (windowUrl.includes('perplexity.ai')) {
        wrapper.style.border = 'none';
        wrapper.style.background = 'transparent';
        wrapper.style.boxShadow = 'none';
        wrapper.style.marginRight = '4px';
      }
      // Manus-specific styling
      if (windowUrl.includes('manus.im')) {
        wrapper.style.border = 'none';
        wrapper.style.background = 'transparent';
        wrapper.style.boxShadow = 'none';
        wrapper.style.marginRight = '0';
      }
      // DeepSeek-specific styling
      if (windowUrl.includes('chat.deepseek.com')) {
        wrapper.style.border = 'none';
        wrapper.style.background = 'transparent';
        wrapper.style.boxShadow = 'none';
        wrapper.style.marginRight = '8px';
      }
      // i10x-specific styling (blend with toolbar, sits next to Send)
      if (windowUrl.includes('i10x.ai')) {
        wrapper.style.border = 'none';
        wrapper.style.background = 'transparent';
        wrapper.style.boxShadow = 'none';
        wrapper.style.marginRight = '6px';
      }
      // Emergent-specific styling (match button style: bg-[#FFFFFF14], rounded-full)
      if (windowUrl.includes('app.emergent.sh')) {
        wrapper.style.border = 'none';
        wrapper.style.background = 'rgba(255, 255, 255, 0.08)';
        wrapper.style.boxShadow = 'none';
        wrapper.style.borderRadius = '30px';
        wrapper.style.width = '36px';
        wrapper.style.height = '36px';
        wrapper.style.padding = '8px';
        wrapper.style.marginRight = '0';
        wrapper.style.marginLeft = '0';
        wrapper.style.transition = 'background-color 0.2s';
        wrapper.style.flexShrink = '0';
        wrapper.style.flexGrow = '0';
        // Add hover effect to match other buttons
        wrapper.addEventListener('mouseenter', () => {
          wrapper.style.background = 'rgba(255, 255, 255, 0.1)';
        });
        wrapper.addEventListener('mouseleave', () => {
          const isEnabled = wrapper.getAttribute('data-memory-enabled') === 'true';
          wrapper.style.background = 'rgba(255, 255, 255, 0.08)';
        });
      }
      // Compas AI styling
      if (windowUrl.includes('agt.compasai.com')) {
        wrapper.style.border = 'none';
        wrapper.style.background = 'transparent';
        wrapper.style.boxShadow = 'none';
        wrapper.style.marginRight = '8px';
      }
      // Load initial state
      const isEnabled = localStorage.getItem(MEMORY_STATE_KEY) === 'true';
      wrapper.title = isEnabled ? 'Memory ON - Click to disable' : 'Memory OFF - Click to enable';
      wrapper.setAttribute('aria-label', 'Alchemyst Memory');
      wrapper.setAttribute('role', 'button');
      wrapper.setAttribute('tabindex', '0');
      wrapper.setAttribute('data-memory-enabled', isEnabled.toString());

      const img = document.createElement('img');
      img.src = imgSrc;
      img.alt = 'Alchemyst';
      img.width = 20;
      img.height = 20;
      img.style.borderRadius = '50%';
      img.title = 'Alchemyst Memory';
      img.style.display = 'block';
      img.style.maxWidth = '100%';
      img.style.height = 'auto';

      wrapper.appendChild(img);

      // Robust tooltip rendered in document.body to avoid overflow clipping
      function getGlobalTooltip() {
        let tip = document.getElementById('alchemyst-global-tooltip');
        if (!tip) {
          tip = document.createElement('div');
          tip.id = 'alchemyst-global-tooltip';
          tip.style.position = 'fixed';
          tip.style.whiteSpace = 'nowrap';
          tip.style.fontSize = '12px';
          tip.style.lineHeight = '14px';
          tip.style.padding = '6px 8px';
          tip.style.borderRadius = '6px';
          tip.style.background = 'rgba(0,0,0,0.85)';
          tip.style.color = '#fff';
          tip.style.pointerEvents = 'none';
          tip.style.opacity = '0';
          tip.style.transition = 'opacity 120ms ease';
          tip.style.zIndex = '2147483647';
          tip.style.visibility = 'hidden';
          document.body.appendChild(tip);
        }
        return tip;
      }

      function showGlobalTooltip(anchorEl, text) {
        const tip = getGlobalTooltip();
        tip.textContent = text;
        const rect = anchorEl.getBoundingClientRect();
        const gap = 8;
        const top = Math.max(0, rect.top - gap - 28); // place above
        const left = Math.min(window.innerWidth - 8, Math.max(8, rect.left + rect.width / 2));
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
        tip.style.transform = 'translateX(-50%)';
        tip.style.visibility = 'visible';
        tip.style.opacity = '1';
      }

      function hideGlobalTooltip() {
        const tip = document.getElementById('alchemyst-global-tooltip');
        if (tip) { tip.style.opacity = '0'; tip.style.visibility = 'hidden'; }
      }

      // Update visual state
      function updateButtonState(enabled) {
        wrapper.setAttribute('data-memory-enabled', enabled.toString());
        wrapper.title = enabled ? 'Memory ON - Click to disable' : 'Memory OFF - Click to enable';
        wrapper.style.opacity = enabled ? '1' : '0.6';
        wrapper.style.filter = enabled ? 'none' : 'grayscale(0.3)';
      }

      const showTip = () => {
        const enabled = wrapper.getAttribute('data-memory-enabled') === 'true';
        const tooltipText = enabled ? 'Alchemyst Memory ON' : 'Alchemyst Memory OFF';
        showGlobalTooltip(wrapper, tooltipText);
      };
      const hideTip = () => hideGlobalTooltip();
      wrapper.addEventListener('mouseenter', showTip);
      wrapper.addEventListener('mouseleave', hideTip);
      wrapper.addEventListener('focusin', showTip);
      wrapper.addEventListener('focusout', hideTip);

      // Toggle functionality
      wrapper.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const currentState = wrapper.getAttribute('data-memory-enabled') === 'true';
        const newState = !currentState;
        localStorage.setItem(MEMORY_STATE_KEY, newState.toString());
        updateButtonState(newState);
        // Emit custom event for other scripts to listen
        window.postMessage({ type: 'ALCHEMYST_MEMORY_TOGGLE', enabled: newState }, '*');
        console.log('Alchemyst Memory:', newState ? 'ENABLED' : 'DISABLED');
      });

      // Initialize with current state
      updateButtonState(isEnabled);

      // Insert based on platform
      if (windowUrl.includes('gemini.google.com')) {
        // Gemini: Insert in the leading-actions-wrapper
        try {
          // Find the leading-actions-wrapper specifically
          const leadingActionsWrapper = document.querySelector('.leading-actions-wrapper');
          if (leadingActionsWrapper) {
            leadingActionsWrapper.appendChild(wrapper);
          } else {
            // Fallback to parentFlex if leading-actions-wrapper not found
            parentFlex.appendChild(wrapper);
          }
        } catch (e) {
          // Silent fail
        }
      } else if (windowUrl.includes('claude.ai')) {
        // Claude: Insert in the buttons container (with plus and tools buttons)
        try {
          parentFlex.appendChild(wrapper);
        } catch (e) {
          // Silent fail
        }
      } else if (windowUrl.includes('v0.app')) {
        // v0: Insert in the toolbar left section as the first button
        try {
          if (target && target !== parentFlex) {
            // Insert before the first button in the toolbar
            parentFlex.insertBefore(wrapper, target);
          } else {
            // Insert at the beginning of the toolbar
            parentFlex.insertBefore(wrapper, parentFlex.firstChild);
          }
        } catch (e) {
          // Silent fail
        }
      } else if (windowUrl.includes('lovable.dev')) {
        // Lovable: Insert in the right toolbar
        try {
          if (target && target !== parentFlex) {
            parentFlex.insertBefore(wrapper, target);
          } else {
            parentFlex.insertBefore(wrapper, parentFlex.firstChild);
          }
        } catch (e) {
          // Silent fail
        }
      } else if (windowUrl.includes('chatgpt.com') || windowUrl.includes('chat.openai.com')) {
        // ChatGPT: Insert before the target control (Dictate button wrapper preferred)
        parent.insertBefore(wrapper, target);
      } else if (windowUrl.includes('bolt.new')) {
        // Bolt: Insert at beginning of left group
        try {
          if (target && target !== parentFlex) {
            parentFlex.insertBefore(wrapper, target);
          } else {
            parentFlex.insertBefore(wrapper, parentFlex.firstChild);
          }
        } catch (e) { }
      } else if (windowUrl.includes('perplexity.ai')) {
        // Look for the Attach button
        const attachButton = document.querySelector('button[aria-label="Attach"]') || 
                             document.querySelector('button[data-testid="attach-button"]');
        
        if (attachButton) {
          // Perplexity wraps buttons in spans or divs. We want the main flex row.
          // We go up to the flex container, then find the element that contains our button
          const flexRow = attachButton.closest('div.flex.items-center');
          if (flexRow) {
             parentContainer = flexRow;
             // We want to be the VERY FIRST item in this row
             referenceNode = flexRow.firstElementChild;
          } else {
             // Fallback: Just insert directly before the button if we can't find the row
             parentContainer = attachButton.parentElement;
             referenceNode = attachButton;
          }
        } 
      } else if (windowUrl.includes('manus.im')) {
        // Manus: Append to the left button section
        try {
          if (parentFlex) {
            parentFlex.appendChild(wrapper);
          }
        } catch (e) { }
      } else if (windowUrl.includes('chat.deepseek.com')) {
        // DeepSeek: Insert in button container before first button
        try {
          if (target && target !== parentFlex) {
            parentFlex.insertBefore(wrapper, target);
          } else {
            parentFlex.insertBefore(wrapper, parentFlex.firstChild);
          }
        } catch (e) { }
      } else if (windowUrl.includes('i10x.ai')) {
        // i10x.ai: Insert in right group immediately before the send button
        try {
          if (target && target !== parentFlex) {
            parentFlex.insertBefore(wrapper, target);
          } else {
            parentFlex.insertBefore(wrapper, parentFlex.firstChild);
          }
        } catch (e) { }
      } else if (windowUrl.includes('app.emergent.sh')) {
        // Emergent: Insert as the last element in the left button group
        try {
          if (parentFlex) {
            // Append to the end of the left group to make it the last element
            parentFlex.appendChild(wrapper);
          }
        } catch (e) { }
      } else if (windowUrl.includes('agt.compasai.com')) {
        // Compas AI: Insert at start of toolbar row
        try {
          if (target && target !== parentFlex) {
            parentFlex.insertBefore(wrapper, target);
          } else {
            parentFlex.insertBefore(wrapper, parentFlex.firstChild);
          }
        } catch (e) { }
      }

      // Click handler – emit a custom event the inpage script could listen to if needed
      wrapper.addEventListener('click', () => {
        window.postMessage({ type: 'ALCHEMYST_LOGO_CLICK' }, '*');
      });
    } catch (_) { }
  }

  // Initial attempt
  const start = Date.now();
  const tryInject = () => {
    ensureButton();
    if (!document.getElementById(BTN_ID) && Date.now() - start < 10000) {
      requestAnimationFrame(tryInject);
    }
  };
  tryInject();

  // Observe DOM changes to re-inject if ChatGPT re-renders the toolbar
  const obs = new MutationObserver(() => {
    ensureButton();
  });
  try {
    obs.observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) { }
})();

// Store API key globally for inpage script access
let globalApiKey = null;

// Request deduplication
const pendingRequests = new Map();

// Load API key synchronously
(async () => {
  try {
    const { alchemystApiKey } = await chrome.storage.local.get("alchemystApiKey");
    globalApiKey = alchemystApiKey;
    // Also store in localStorage for inpage script access
    if (alchemystApiKey) {
      localStorage.setItem('alchemystApiKey', alchemystApiKey);
    }
    // API key loaded
  } catch (err) {
    console.log('Alchemyst: failed to load API key:', err);
  }
})();

// Inject in-page hook and bridge messages for context fetch
(function injectInpage() {
  try {
    const url = chrome.runtime.getURL('inpage.js');
    const s = document.createElement('script');
    s.src = url;
    s.async = false;
    s.crossOrigin = 'anonymous';
    (document.head || document.documentElement).appendChild(s);
    s.onload = () => { s.remove(); };
  } catch (_) { }

  // Bridge messages between page and extension for context fetch
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== 'ALCHEMYST_CONTEXT_REQUEST') return;
    console.log('Alchemyst: content script received context request:', data.query);

    try {
      const raw = String(data.query || '');
      const query = raw.trim();
      console.log('Alchemyst: content script making API call for query:', query);

      // Check if memory is enabled
      const memoryEnabled = localStorage.getItem('alchemyst_memory_enabled') === 'true';
      if (!memoryEnabled) {
        console.log('Alchemyst: Memory is disabled, skipping context fetch');
        window.postMessage({ type: 'ALCHEMYST_CONTEXT_REPLY', payload: '' }, '*');
        return;
      }

      // Ignore empty queries (common for /prepare calls)
      if (!query) {
        window.postMessage({ type: 'ALCHEMYST_CONTEXT_REPLY', payload: '' }, '*');
        return;
      }

      // Check if we already have a pending request for this query
      if (pendingRequests.has(query)) {
        console.log('Alchemyst: request already pending for query:', query);
        // Wait for the existing request to complete
        try {
          const result = await pendingRequests.get(query);
          window.postMessage({ type: 'ALCHEMYST_CONTEXT_REPLY', payload: result }, '*');
        } catch (err) {
          window.postMessage({ type: 'ALCHEMYST_CONTEXT_REPLY', payload: '' }, '*');
        }
        return;
      }

      // Use cached API key
      if (!globalApiKey) {
        console.log('Alchemyst: no cached API key found, trying to load from storage...');
        try {
          const { alchemystApiKey } = await chrome.storage.local.get("alchemystApiKey");
          if (alchemystApiKey) {
            globalApiKey = alchemystApiKey;
            localStorage.setItem('alchemystApiKey', alchemystApiKey);
            console.log('Alchemyst: API key loaded from storage');
          } else {
            console.log('Alchemyst: no API key in storage');
            window.postMessage({ type: 'ALCHEMYST_CONTEXT_REPLY', payload: '' }, '*');
            return;
          }
        } catch (err) {
          console.log('Alchemyst: failed to load API key from storage:', err);
          window.postMessage({ type: 'ALCHEMYST_CONTEXT_REPLY', payload: '' }, '*');
          return;
        }
      }

      // Create a promise for this request and store it
      const requestPromise = (async () => {
        try {
          console.log('Alchemyst: requesting context from background script');

          if (!chrome || !chrome.runtime || !chrome.runtime.connect) {
            console.error('Alchemyst: chrome.runtime not available - extension context may be invalidated');
            return '';
          }

          // Use persistent port connection instead of sendMessage
          return new Promise((resolve, reject) => {
            let port;
            let timeoutId;
            let resolved = false;

            try {
              port = chrome.runtime.connect({ name: 'alchemyst' });
            } catch (err) {
              console.error('Alchemyst: Failed to connect to background script:', err);
              resolve('');
              return;
            }

            // Generate unique ID for this request
            const requestId = Date.now() + Math.random();

            const cleanup = () => {
              if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
              }
              if (port) {
                try {
                  port.disconnect();
                } catch (e) {
                  // Port might already be disconnected
                }
              }
            };

            // Set up response handler
            port.onMessage.addListener((response) => {
              if (resolved) return;
              console.log('Alchemyst: received response from background script via port:', response);

              // Check if this response is for our request
              if (response.id === requestId) {
                resolved = true;
                cleanup();

                if (response && response.context !== undefined) {
                  console.log('Alchemyst: API call successful, context length:', response.context?.length || 0);
                  resolve(response.context || '');
                } else if (response && response.error) {
                  console.log('Alchemyst: API call failed:', response.error);
                  resolve('');
                } else {
                  console.log('Alchemyst: unexpected response format:', response);
                  resolve('');
                }
              } else {
                console.log('Alchemyst: received response for different request ID:', response.id, 'expected:', requestId);
              }
            });

            // Set up error handler
            port.onDisconnect.addListener(() => {
              if (resolved) return;
              const error = chrome.runtime.lastError;
              if (error) {
                console.error('Alchemyst: port disconnected with error:', error.message);
              } else {
                console.log('Alchemyst: port disconnected');
              }
              resolved = true;
              cleanup();
              resolve('');
            });

            // Send the request
            try {
              console.log('Alchemyst: sending fetchContext message via port with ID:', requestId);
              port.postMessage({
                type: 'fetchContext',
                query: query,
                id: requestId
              });
            } catch (err) {
              console.error('Alchemyst: Failed to send message via port:', err);
              resolved = true;
              cleanup();
              resolve('');
              return;
            }

            // Timeout after 60 seconds
            timeoutId = setTimeout(() => {
              if (resolved) return;
              console.log('Alchemyst: port request timeout');
              resolved = true;
              cleanup();
              resolve('');
            }, 60_000);
          });
        } catch (err) {
          console.error('Alchemyst: background script call failed:', err);
          if (err && err.message && err.message.includes('Extension context invalidated')) {
            console.error('Alchemyst: Extension context invalidated - extension may need to be reloaded');
          }
          return '';
        }
      })();

      // Store the promise for deduplication
      pendingRequests.set(query, requestPromise);

      try {
        const result = await requestPromise;
        window.postMessage({ type: 'ALCHEMYST_CONTEXT_REPLY', payload: result }, '*');
      } finally {
        // Clean up the pending request
        pendingRequests.delete(query);
      }
      return;
    } catch (err) {
      console.log('Alchemyst: content script context fetch failed:', err);
      window.postMessage({ type: 'ALCHEMYST_CONTEXT_REPLY', payload: '' }, '*');
    }
  });
})();

