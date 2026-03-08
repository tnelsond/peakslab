// settings.js

document.addEventListener('touchend', function(e) {
  const active = document.activeElement;

  // Only proceed if something is focused AND it's an input-like element
  if (!active || !['INPUT','TEXTAREA'].includes(active.tagName)) {
    return;
  }

  // Check if the touch landed inside the currently focused element
  let touchedInside = false;
  let el = e.target;

  while (el && el !== document.body) {
    if (el === active) {
      touchedInside = true;
      break;
    }
    el = el.parentElement;
  }

  // If touch was NOT inside the active input → blur it (hides keyboard)
  if (!touchedInside) {
    active.blur();
  }
}, false);   // use capture=false so it runs after other handlers

// Optional: make sure keyboard re-appears nicely when tapping the field again
/*document.getElementById('queryInput')?.addEventListener('focus', function() {
  // You can add extra behavior here if needed (scroll, etc.)
  this.scrollIntoView({ behavior: 'smooth', block: 'center' });
});*/

let fontSize = parseInt(localStorage.getItem('fontSize')) || 16;
document.documentElement.style.setProperty('--font-size', fontSize + 'px');

function updateFontSize() {
    document.documentElement.style.setProperty('--font-size', fontSize + 'px');
    localStorage.setItem('fontSize', fontSize);
}

document.getElementById('fontIncrease')?.addEventListener('click', () => {
    fontSize = Math.min(fontSize + 2, 32);
    updateFontSize();
});

document.getElementById('fontDecrease')?.addEventListener('click', () => {
    fontSize = Math.max(fontSize - 2, 12);
    updateFontSize();
});

// Dark mode
document.getElementById('darkModeToggle')?.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
});
if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark-mode');
}

document.getElementById('showtabs')?.addEventListener('click', () => {
		console.log("hide");
    document.getElementById('tabs').classList.toggle('hide');
    localStorage.setItem('hidetabs', tabs?.classList.contains('hide'));
});
if (localStorage.getItem('hidetabs') === 'false') {
    document.getElementById('tabs').classList.remove('hide');
}

// Settings modal
document.getElementById('settingsBtn')?.addEventListener('click', () => {
    document.getElementById('settingsModal').style.display = 'flex';
});

document.querySelector('#settingsModal .close-btn')?.addEventListener('click', () => {
    document.getElementById('settingsModal').style.display = 'none';
});

document.getElementById('settingsModal')?.addEventListener('click', e => {
    if (e.target.id === 'settingsModal') {
        e.target.style.display = 'none';
    }
});

// Context menu (right-click)
const contextMenu = document.createElement('div');
contextMenu.className = 'context-menu';
contextMenu.style.display = 'none';
document.body.appendChild(contextMenu);

document.addEventListener('contextmenu', e => {
    const text = window.getSelection().toString().trim();
    if (!text) return;

    e.preventDefault();

    contextMenu.innerHTML = `
        <button data-action="speak-khmer">🔊 Khmer</button>
        <button data-action="speak-english">🔊 English</button>
        <button data-action="search-current">🔍 Search</button>
        <button data-action="search-popup">🔍 Popup</button>
    `;

    contextMenu.style.left = `${e.pageX + 5}px`;
    contextMenu.style.top = `${e.pageY + 5}px`;
    contextMenu.style.display = 'block';

    contextMenu.onclick = ev => {
        if (ev.target.tagName !== 'BUTTON') return;
        const action = ev.target.dataset.action;

        if (action.startsWith('speak')) {
            const lang = action === 'speak-khmer' ? 'km-KH' : 'en-US';
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = lang;
            speechSynthesis.speak(utterance);
        } else if (action === 'search-current') {
            document.getElementById('queryInput').value = text;
            window.startSearch?.();
        } else if (action === 'search-popup') {
            window.openPopupSearch?.(text);
        }

        contextMenu.style.display = 'none';
    };
});

document.addEventListener('click', () => {
    contextMenu.style.display = 'none';
});

/*
// Service Worker
async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
        const reg = await navigator.serviceWorker.register("./sw.js", { scope: '/khmer/' });
        console.log("Service Worker:", reg.active ? "active" : reg.installing ? "installing" : "waiting");
    } catch (err) {
        console.error("Service Worker failed:", err);
    }
}

document.getElementById('uninstall')?.addEventListener('click', async () => {
    const registrations = await navigator.serviceWorker?.getRegistrations() ?? [];
    for (const reg of registrations) {
        await reg.unregister();
        console.log("Service Worker unregistered");
    }
});

registerServiceWorker();
*/
