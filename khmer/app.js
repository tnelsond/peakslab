import init, { PeakDecoder } from './wasm/peakdec.js';

const dictionaryGroups = [
    { groupName: 'All', index: 0, subDicts: [] },
    {
        groupName: 'Dictionaries',
        subDicts: [
            { filename: 'db/sonv.peak.zst', displayName: 'En>Km', index: 1, templates: ['<h1>###</h1>', '<p-des>###</p-des>'] },
            { filename: 'db/kh.peak.zst', displayName: 'Km>En', index: 2 },
            { filename: 'db/nath2022.peak.zst', displayName: 'Km>Km', index: 3 },
            { filename: 'db/ant.peak.zst', displayName: 'ANT', index: 4 },
            { filename: 'db/baby.peak.zst', displayName: 'Baby', index: 5 },
            { filename: 'db/sea_count.peak.zst', displayName: 'SeaC', index: 6 },
        ]
    },
    {
        groupName: 'Bible',
        subDicts: [
            { filename: 'db/km_ulb.peak.zst', displayName: 'Bible', index: 7 },
            { filename: 'db/strongs.peak.zst', displayName: 'Strongs', index: 8 },
            { filename: 'db/bible.peak.zst', displayName: 'bible', index: 9 },
            { filename: 'db/bibletrans.peak.zst', displayName: 'bibletran', index: 10 },
        ]
    },
    {
        groupName: 'Other',
        subDicts: [
            { filename: 'db/hymns.peak.zst', displayName: 'Hymns', index: 11 },
        ]
    }
];

const BATCH_SIZE = 10;
const DEBOUNCE_DELAY = 100;

const cache = {
    decoders: new Array(12).fill(null),
    diagnostics: new Array(12).fill(null),
};

let currentIndex = 0;
let currentDecoder = null;
let displayQuery = '';
let rendered = 0;
let container = null;
let isLoading = false;
let totalLoadTime = null;
let lastSearchTime = 0;

// Cascading state
let current_level = 0;
let current_decoder_idx = 0;

const searchInput = document.getElementById('searchInput');
const resultsDiv = document.getElementById('results');
const loadingDiv = document.getElementById('loading');
const tabsContainer = document.getElementById('tabs');
const diagnosticsDiv = document.getElementById('diagnostics');
const loader = document.getElementById('loader');

let fontSize = parseInt(localStorage.getItem('fontSize')) || 16;
document.documentElement.style.setProperty('--font-size', fontSize + 'px');

document.addEventListener('click', (e) => {
    if (!e.target.closest('.tab-dropdown')) {
        document.querySelectorAll('.tab-dropdown.open').forEach(d => d.classList.remove('open'));
    }
});

function createTabs() {
    tabsContainer.innerHTML = '';
    const allBtn = document.createElement('button');
    allBtn.className = 'tab active ready';
    allBtn.textContent = 'All';
    allBtn.dataset.index = '0';
    allBtn.addEventListener('click', () => switchTab(0));
    tabsContainer.appendChild(allBtn);

    const savedIndex = window.currentDictIndex || 0;

    dictionaryGroups.slice(1).forEach(group => {
        const dropdown = document.createElement('div');
        dropdown.className = 'tab-dropdown';

        const mainBtn = document.createElement('button');
        mainBtn.className = 'tab';
        mainBtn.textContent = group.groupName;
        if (group.subDicts.some(d => d.index === savedIndex)) mainBtn.classList.add('active');
        dropdown.appendChild(mainBtn);

        const menu = document.createElement('div');
        menu.className = 'dropdown-menu';

        group.subDicts.forEach(dict => {
            const item = document.createElement('button');
            item.className = 'dropdown-item loading';
            item.textContent = dict.displayName;
            item.dataset.index = dict.index;
            if (dict.index === savedIndex) item.classList.add('active');
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                switchTab(dict.index);
                dropdown.classList.remove('open');
            });
            menu.appendChild(item);
        });

        dropdown.appendChild(menu);

        mainBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.tab-dropdown').forEach(d => d.classList.remove('open'));
            dropdown.classList.toggle('open');
        });

        tabsContainer.appendChild(dropdown);
    });
}

async function initWasm() {
    loadingDiv.textContent = 'Initializing WASM...';
    await init();
    loadingDiv.style.display = 'none';
}

async function loadDictionary(dict) {
    const btn = document.querySelector(`.dropdown-item[data-index="${dict.index}"]`);
    const startTime = performance.now();
    try {
        const fetchStart = performance.now();
        const res = await fetch(dict.filename);
        const fetchTime = performance.now() - fetchStart;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = new Uint8Array(await res.arrayBuffer());
        const decompressTime = performance.now() - fetchStart - fetchTime;
        const initStart = performance.now();
        const decoder = new PeakDecoder(buffer, true);
        const initTime = performance.now() - initStart;
        cache.decoders[dict.index] = decoder;
        cache.diagnostics[dict.index] = {
            fetch: fetchTime.toFixed(0),
            decompress: decompressTime.toFixed(0),
            init: initTime.toFixed(0),
            total: (performance.now() - startTime).toFixed(0),
            size: (buffer.byteLength / 1024 / 1024).toFixed(2)
        };
        if (btn) btn.classList.replace('loading', 'ready');
    } catch (err) {
        console.error(err);
        cache.diagnostics[dict.index] = { error: err.message };
        if (btn) btn.classList.replace('loading', 'error');
    }
}

function startBackgroundLoading() {
    const allDicts = [].concat(...dictionaryGroups.slice(1).map(g => g.subDicts));
    allDicts.forEach(dict => {
        if (!cache.decoders[dict.index]) {
            loadDictionary(dict);
        }
    });
}

async function ensureDictionaryLoaded(index) {
    if (index === 0) return;
    const dict = dictionaryGroups.flatMap(g => g.subDicts).find(d => d.index === index);
    if (dict && !cache.decoders[dict.index]) {
        loadingDiv.textContent = `Loading ${dict.displayName}...`;
        loadingDiv.style.display = 'block';
        await loadDictionary(dict);
        loadingDiv.style.display = 'none';
    }
}

function switchTab(index) {
    if (currentIndex === index) return;
    currentIndex = index;
    window.currentDictIndex = index;
    currentDecoder = index === 0 ? null : cache.decoders[index];

    document.querySelectorAll('.tab.active, .dropdown-item.active').forEach(el => el.classList.remove('active'));
    if (index === 0) {
        document.querySelector('.tab[data-index="0"]').classList.add('active');
    } else {
        const item = document.querySelector(`.dropdown-item[data-index="${index}"]`);
        if (item) {
            item.classList.add('active');
            item.closest('.tab-dropdown')?.querySelector('.tab')?.classList.add('active');
        }
    }

    ensureDictionaryLoaded(index).then(() => {
        resetSearchState();
        renderDiagnostics();
        if (displayQuery) performSearch(displayQuery);
        else showEmptyMessage();
    });
}

function resetSearchState() {
    resultsDiv.innerHTML = '';
    rendered = 0;
    container = null;
    loader.style.display = 'none';
    isLoading = false;
    lastSearchTime = 0;
    current_level = 0;
    current_decoder_idx = 0;
}

function showEmptyMessage() {
    const totalDicts = dictionaryGroups.flatMap(g => g.subDicts).length;
    const loaded = dictionaryGroups.flatMap(g => g.subDicts).filter(d => cache.decoders[d.index]).length;
    const name = currentIndex === 0 ? 'All Dictionaries' :
        dictionaryGroups.flatMap(g => g.subDicts).find(d => d.index === currentIndex)?.displayName || 'Unknown';
    let msg = `<p style="text-align:center; color:#666; margin:40px;">Type to search in <strong>${name}</strong></p>`;
    if (currentIndex === 0 && loaded < totalDicts) {
        msg += `<p style="text-align:center; color:#888; font-size:0.9em;">(${loaded}/${totalDicts} dictionaries loaded — more loading in background)</p>`;
    }
    resultsDiv.innerHTML = msg;
}

function renderDiagnostics() {
    let html = '';
    const allDicts = dictionaryGroups.flatMap(g => g.subDicts);
    allDicts.forEach(dict => {
        const d = cache.diagnostics[dict.index];
        if (d) {
            if (d.error) {
                html += `<div class="diag-entry"><span class="diag-label">${dict.displayName}:</span> <span style="color:red;">${d.error}</span></div>`;
            } else {
                html += `
                    <div class="diag-entry"><span class="diag-label">${dict.displayName}:</span>
                        Fetch ${d.fetch}ms | Decompress ${d.decompress}ms | Init ${d.init}ms | Total ${d.total}ms | Size ${d.size}MB
                    </div>`;
            }
        }
    });
    if (lastSearchTime > 0) {
        html += `<div class="diag-entry"><span class="diag-label">Last Search Time:</span> ${lastSearchTime.toFixed(1)} ms</div>`;
    }
    diagnosticsDiv.innerHTML = html || '<p style="color:#888;text-align:center;padding:20px;">No load data yet.</p>';
}

searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    clearTimeout(window.searchTimer);
    if (!q) {
        displayQuery = '';
        resetSearchState();
        showEmptyMessage();
        renderDiagnostics();
        return;
    }
    window.searchTimer = setTimeout(() => performSearch(q), DEBOUNCE_DELAY);
});

document.getElementById('reverse').addEventListener('change', () => {
    if (displayQuery) performSearch(displayQuery);
});

function performSearch(query) {
    displayQuery = query;

    const reverse = document.getElementById('reverse').checked;
    const start = performance.now();

    const decoderObjs = currentIndex === 0 
        ? cache.decoders.slice(1).map((dec, i) => ({ dec, index: i + 1 })).filter(obj => obj.dec !== null)
        : [{ dec: currentDecoder, index: currentIndex }];

    for (const obj of decoderObjs) {
        if (obj.dec) obj.dec.search(query, reverse);
    }

    lastSearchTime = performance.now() - start;

    resetSearchState();
    const numLoaded = decoderObjs.length;
    const totalDicts = dictionaryGroups.flatMap(g => g.subDicts).length;
    const headerText = currentIndex === 0 
        ? `Results for “${query}” in ${numLoaded} of ${totalDicts} dictionaries • ${lastSearchTime.toFixed(1)}ms`
        : `Results for “${query}” • ${lastSearchTime.toFixed(1)}ms`;
    const header = document.createElement('h3');
    header.innerHTML = headerText;
    header.style.cssText = 'color:#007bff;border-bottom:2px solid #007bff;padding-bottom:8px;margin:20px 0 10px;';
    resultsDiv.appendChild(header);

    if (currentIndex === 0 && numLoaded < totalDicts) {
        const note = document.createElement('p');
        note.innerHTML = 'More dictionaries loading in background...';
        note.style.cssText = 'text-align:center; color:#666; margin:10px;';
        resultsDiv.appendChild(note);
    }

    container = document.createElement('div');
    resultsDiv.appendChild(container);
    loader.style.display = 'block';
    loadMore();

    renderDiagnostics();
}

function loadMore() {
    if (isLoading) return;
    isLoading = true;

    setTimeout(() => {
        const decoderObjs = currentIndex === 0 
            ? cache.decoders.slice(1).map((dec, i) => ({ dec, index: i + 1 })).filter(obj => obj.dec !== null)
            : [{ dec: currentDecoder, index: currentIndex }];
        const num_decoders = decoderObjs.length;
        const max_levels = decoderObjs[0]?.dec?.get_num_levels() || 0;

        let batch = [];

        outer: while (batch.length < BATCH_SIZE && current_level < max_levels) {
            const obj = decoderObjs[current_decoder_idx];
            const dec = obj?.dec;
            if (!dec) {
                advance();
                continue;
            }

            if (dec.has_more_results_in_level(current_level)) {
                const remaining = BATCH_SIZE - batch.length;
                const jsBatch = dec.get_results_from_level(current_level, remaining);
                const texts = jsBatch.map(jsVal => new TextDecoder().decode(new Uint8Array(jsVal)));

                if (currentIndex === 0) {
                    const dictName = dictionaryGroups.flatMap(g => g.subDicts)
                        .find(d => d.index === obj.index)?.displayName || 'Unknown';
                    texts.forEach(text => batch.push({ dictName, text, dictIndex: obj.index }));
                } else {
                    texts.forEach(text => batch.push({ text, dictIndex: obj.index }));
                }

                if (jsBatch.length < remaining) {
                    advance();
                }
            } else {
                advance();
            }

            if (batch.length >= BATCH_SIZE) break;
        }

        function advance() {
            current_decoder_idx++;
            if (current_decoder_idx >= num_decoders) {
                current_decoder_idx = 0;
                current_level++;
            }
        }

        const fragment = document.createDocumentFragment();
        batch.forEach(item => {
            const div = document.createElement('p-d');
            const contentHtml = currentIndex === 0 
                ? `<p-h>${item.dictName}</p-h> ${renderEntry(item.text, item.dictName)}`
                : renderEntry(item.text);
            div.innerHTML = `${contentHtml} <button class="expand-btn" title="Expand to other dictionaries">➕</button>`;
            const expandBtn = div.querySelector('.expand-btn');
            expandBtn.addEventListener('click', () => expandEntry(div, item.text, item.dictIndex));
            fragment.appendChild(div);
        });
        container.appendChild(fragment);

        rendered += batch.length;
        loader.style.display = (current_level < max_levels || current_decoder_idx < num_decoders) ? 'block' : 'none';
        isLoading = false;
    }, 10);
}

function renderEntry(text, dictName = null) {
    let dict;
    if (dictName) {
        dict = dictionaryGroups.flatMap(g => g.subDicts).find(d => d.displayName === dictName);
    } else {
        dict = dictionaryGroups.flatMap(g => g.subDicts).find(d => d.index === currentIndex);
    }

    const parts = text.split('\t');

    if (dict && dict.templates && dict.templates.length === parts.length) {
        return dict.templates.map((tmpl, i) => tmpl.replace('###', highlightText(parts[i], displayQuery))).join('');
    }

    // Default template: <h2> for first field, <p-des> for the rest
    const head = `<h2>${highlightText(parts[0], displayQuery)}</h2>`;
    const body = parts.slice(1).map(p => `<p>${highlightText(p, displayQuery)}</p>`).join('');
    return head + body;
}

async function expandEntry(entryDiv, text, sourceIndex) {
    let expandDiv = entryDiv.querySelector('.expand-content');
    if (expandDiv) {
        expandDiv.remove();
        return;
    }
    expandDiv = document.createElement('div');
    expandDiv.className = 'expand-content';
    expandDiv.innerHTML = '<p style="text-align:center;padding:10px;">Loading other dictionaries...</p>';
    entryDiv.appendChild(expandDiv);

    const headword = text.split('\t')[0].trim().toLowerCase();
    const allDicts = [].concat(...dictionaryGroups.slice(1).map(g => g.subDicts));
    const otherDecoders = allDicts.filter(d => d.index !== sourceIndex).map(d => ({ ...d, decoder: cache.decoders[d.index] }));

    const unloaded = otherDecoders.filter(d => !d.decoder);
    if (unloaded.length > 0) {
        await Promise.all(unloaded.map(d => loadDictionary(d)));
    }

    const results = [];
    const seen = new Set();
    for (const { displayName, decoder } of otherDecoders) {
        if (!decoder) continue;
        decoder.search(headword, false);
        const level = 0;
        if (decoder.has_more_results_in_level(level)) {
            const jsBatch = decoder.get_results_from_level(level, 100);
            const texts = jsBatch.map(jsVal => new TextDecoder().decode(new Uint8Array(jsVal)));
            const matches = texts.filter(t => t.split('\t')[0].trim().toLowerCase() === headword);
            matches.forEach(m => {
                if (!seen.has(m)) {
                    seen.add(m);
                    results.push(`<p-h>${displayName}</p-h> ${renderEntry(m, displayName)}`);
                }
            });
        }
    }

    expandDiv.innerHTML = results.length > 0 ? results.join('<hr>') : '<p style="text-align:center;color:#666;padding:10px;">No matches in other dictionaries.</p>';
}

function highlightText(text, query) {
    if (!query) return text;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
}

window.addEventListener('scroll', () => {
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) {
        loadMore();
    }
});

// Font size, dark mode, settings, etc.
document.getElementById('fontIncrease').addEventListener('click', () => {
    fontSize = Math.min(fontSize + 2, 32);
    updateFontSize();
});

document.getElementById('fontDecrease').addEventListener('click', () => {
    fontSize = Math.max(fontSize - 2, 12);
    updateFontSize();
});

function updateFontSize() {
    document.documentElement.style.setProperty('--font-size', fontSize + 'px');
    localStorage.setItem('fontSize', fontSize);
}

document.getElementById('settingsBtn').addEventListener('click', () => {
    document.getElementById('settingsModal').style.display = 'flex';
    renderDiagnostics();
});

document.querySelector('#settingsModal .close-btn').addEventListener('click', () => {
    document.getElementById('settingsModal').style.display = 'none';
});

document.getElementById('settingsModal').addEventListener('click', e => {
    if (e.target === document.getElementById('settingsModal')) {
        document.getElementById('settingsModal').style.display = 'none';
    }
});

document.getElementById('darkModeToggle').addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
});

if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark-mode');
}

const contextMenu = document.createElement('div');
contextMenu.className = 'context-menu';
contextMenu.style.display = 'none';
document.body.appendChild(contextMenu);

document.addEventListener('contextmenu', e => {
    const sel = window.getSelection();
    const text = sel.toString().trim();
    if (text) {
        e.preventDefault();
        contextMenu.innerHTML = `
            <button data-action="speak-khmer">🔊 Khmer</button>
            <button data-action="speak-english">🔊 English</button>
            <button data-action="search-current">🔍 Search</button>
            <button data-action="search-popup">🔍 Search (popup)</button>
        `;

        contextMenu.style.left = `${e.pageX + 5}px`;
        contextMenu.style.top = `${e.pageY + 5}px`;
        contextMenu.style.display = 'block';

        contextMenu.onclick = ev => {
            if (ev.target.tagName === 'BUTTON') {
                const action = ev.target.dataset.action;
                if (action.startsWith('speak')) {
                    const lang = action === 'speak-khmer' ? 'km-KH' : 'en-US';
                    const utterance = new SpeechSynthesisUtterance(text);
                    utterance.lang = lang;
                    speechSynthesis.speak(utterance);
                } else if (action === 'search-current') {
                    searchInput.value = text;
                    performSearch(text);
                } else if (action === 'search-popup') {
                    openPopupSearch(text);
                }
                contextMenu.style.display = 'none';
            }
        };
    }
});

document.addEventListener('click', () => {
    contextMenu.style.display = 'none';
});

function openPopupSearch(query) {
    // Clear current text selection
    window.getSelection().removeAllRanges();

    document.getElementById('popupQuery').textContent = query;
    const container = document.getElementById('popupResults');
    container.innerHTML = '<p style="text-align:center;padding:30px;">Searching...</p>';
    document.getElementById('popupOverlay').style.display = 'flex';

    const decoderObjs = cache.decoders.slice(1)
        .map((dec, i) => ({ dec, index: i + 1, displayName: dictionaryGroups.flatMap(g => g.subDicts).find(d => d.index === i + 1)?.displayName || 'Unknown' }))
        .filter(obj => obj.dec !== null);

    const headword = query.trim().toLowerCase();
    const reverse = false;

    for (const obj of decoderObjs) {
        if (obj.dec) obj.dec.search(headword, reverse);
    }

    let results = [];
    const seen = new Set();
    decoderObjs.forEach(obj => {
        const dec = obj.dec;
        if (!dec) return;
        const level = 0;
        if (dec.has_more_results_in_level(level)) {
            const jsBatch = dec.get_results_from_level(level, 20);
            const texts = jsBatch.map(jsVal => new TextDecoder().decode(new Uint8Array(jsVal)));
            const matches = texts.filter(t => t.split('\t')[0].trim().toLowerCase() === headword);
            matches.forEach(m => {
                if (!seen.has(m)) {
                    seen.add(m);
                    results.push(`<p-h>${obj.displayName}</p-h> ${renderEntry(m, obj.displayName)}`);
                }
            });
        }
    });

    container.innerHTML = results.length > 0 ? results.join('<hr>') : '<p style="text-align:center;color:#666;">No exact matches found.</p>';
}

document.getElementById('popupClose').addEventListener('click', () => {
    document.getElementById('popupOverlay').style.display = 'none';
});

document.getElementById('popupOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('popupOverlay')) {
        document.getElementById('popupOverlay').style.display = 'none';
    }
});

// Initial setup
initWasm().then(() => {
    createTabs();
    startBackgroundLoading();
    switchTab(window.currentDictIndex || 0);

    // Focus search bar immediately
    searchInput.focus();
});

const registerServiceWorker = async () => {
	if ("serviceWorker" in navigator) {
		try {
			const registration = await navigator.serviceWorker.register("sw.js", {scope: '/khmer/'});
			if (registration.installing) {
				console.log("Service worker installing");
			} else if (registration.waiting) {
				console.log("Service worker installed");
			} else if (registration.active) {
				console.log("Service worker active");
			}
		} catch (error) {
			console.error(`Registration failed with ${error}`);
		}
	}
};
registerServiceWorker();

    document.getElementById('uninstall').addEventListener('click', () => function() {
	console.log("Trying to uninstall Service Worker");
	if (window.navigator && navigator.serviceWorker) {
		navigator.serviceWorker.getRegistrations().then(function(registrations) {
			for (let registration of registrations) {
				registration.unregister();
				console.log("Uninstalled Service Worker");
			}
		});
	}
});

