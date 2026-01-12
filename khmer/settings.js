// settings.js

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
            document.getElementById('searchInput').value = text;
            window.startNewSearch?.(text);
        } else if (action === 'search-popup') {
            window.openPopupSearch?.(text);
        }

        contextMenu.style.display = 'none';
    };
});

document.addEventListener('click', () => {
    contextMenu.style.display = 'none';
});

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
