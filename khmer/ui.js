// ui.js
// Complete file - handles all DOM manipulation, UI state, lazy loading of search results,
// tab/dictionary switching, rendering, expand functionality, diagnostics display

import {
    initializeWasm,
    loadDictionary,
    startBackgroundLoading,
    switchDictionary,
    getCurrentDictionaryIndex,
    isDictionaryLoaded,
    ensureDictionaryLoaded,
    startSearch,
    getNextBatch,
    getLoadDiagnostics,
} from './peakslab.js';

import { dictionaryGroups } from './config.js';

// ── DOM Elements ─────────────────────────────────────────────
const els = {
    searchInput: document.getElementById('searchInput'),
    results: document.getElementById('results'),
    loading: document.getElementById('loading'),
    tabsContainer: document.getElementById('tabs'),
    diagnostics: document.getElementById('diagnostics'),
    loader: document.getElementById('loader'),
    popupOverlay: document.getElementById('popupOverlay'),
    popupQuery: document.getElementById('popupQuery'),
    popupResults: document.getElementById('popupResults'),
    reverseCheckbox: document.getElementById('reverse'),
};

let BATCH_SIZE = 4;

// ── UI State ─────────────────────────────────────────────────
let currentSearchQuery = '';
let resultContainer = null;
let searchHeader = null;
let searchStartTime = 0;
let lastDictIndex = null;
let lastLevel = -1;
let hasMoreResults = true;
const DEBOUNCE_TIME = 150;

// ── Initialization ───────────────────────────────────────────
async function init() {
    els.loading.textContent = 'Initializing WASM...';
    els.loading.style.display = 'block';

    try {
        await initializeWasm();
        createTabs();
        startBackgroundLoading();
        await switchToDictionary(window.currentDictIndex || 0);
        els.searchInput.focus();
    } catch (err) {
        console.error('Initialization failed:', err);
        els.loading.textContent = 'Failed to initialize. Check console.';
    } finally {
        els.loading.style.display = 'none';
    }
}

// ── Tabs & Dictionary Switching ──────────────────────────────
function createTabs() {
    els.tabsContainer.innerHTML = '';

    // "All" tab
    const allBtn = document.createElement('button');
    allBtn.className = 'tab ready active';
    allBtn.dataset.index = '0';
    allBtn.textContent = 'All';
    allBtn.addEventListener('click', () => switchToDictionary(0));
    els.tabsContainer.appendChild(allBtn);

    // Grouped dropdown tabs
    dictionaryGroups.slice(1).forEach(group => {
        const dropdown = document.createElement('div');
        dropdown.className = 'tab-dropdown';

        const mainBtn = document.createElement('button');
        mainBtn.className = 'tab';
        mainBtn.textContent = group.groupName;
        dropdown.appendChild(mainBtn);

        const menu = document.createElement('div');
        menu.className = 'dropdown-menu';

        group.subDicts.forEach(dict => {
            const item = document.createElement('button');
            item.className = 'dropdown-item loading';
            item.dataset.index = dict.index.toString();
            item.textContent = dict.displayName;

            item.addEventListener('click', e => {
                e.stopPropagation();
                switchToDictionary(dict.index);
                dropdown.classList.remove('open');
            });

            menu.appendChild(item);
        });

        dropdown.appendChild(menu);

        mainBtn.addEventListener('click', e => {
            e.stopPropagation();
            document.querySelectorAll('.tab-dropdown.open').forEach(d => d.classList.remove('open'));
            dropdown.classList.toggle('open');
        });

        els.tabsContainer.appendChild(dropdown);
    });
}

async function switchToDictionary(index) {
    if (getCurrentDictionaryIndex() === index) return;

    els.loading.textContent = 'Switching dictionary...';
    els.loading.style.display = 'block';

    try {
        await switchDictionary(index);
        updateActiveTabState(index);
        resetSearchUI();
        showEmptyState();
				startNewSearch(currentSearchQuery);
    } catch (err) {
        console.error('Dictionary switch failed:', err);
    } finally {
        els.loading.style.display = 'none';
    }
}

function updateActiveTabState(index) {
    document.querySelectorAll('.tab.active, .dropdown-item.active')
        .forEach(el => el.classList.remove('active'));

    if (index === 0) {
        document.querySelector('.tab[data-index="0"]')?.classList.add('active');
    } else {
        const item = document.querySelector(`.dropdown-item[data-index="${index}"]`);
        if (item) {
            item.classList.add('active');
            item.closest('.tab-dropdown')?.querySelector('.tab')?.classList.add('active');
        }
    }
}

// ── Search Input Handling ────────────────────────────────────
els.searchInput.addEventListener('input', debounce(handleSearchInput, 140));

els.reverseCheckbox?.addEventListener('change', () => {
    if (currentSearchQuery) {
        startNewSearch(currentSearchQuery);
    }
});

function handleSearchInput() {
    const query = els.searchInput.value.trim();
    if (!query) {
        currentSearchQuery = '';
        resetSearchUI();
        showEmptyState();
        return;
    }

    if (currentSearchQuery !== query) {
        startNewSearch(query);
    }
}

function startNewSearch(query) {
    currentSearchQuery = query;
    resetSearchUI();

    const reverse = els.reverseCheckbox?.checked ?? false;

    // Prepare UI
    els.results.innerHTML = '';

    searchHeader = document.createElement('h3');
    searchHeader.style.cssText = 'color:#007bff; border-bottom:2px solid #007bff; padding-bottom:8px; margin:20px 0 10px;';
    searchHeader.textContent = `Searching "${query}"...`;
    els.results.appendChild(searchHeader);

    resultContainer = document.createElement('div');
    els.results.appendChild(resultContainer);

    hasMoreResults = true;

    const { searchStartedAt } = startSearch(query, reverse);
    searchStartTime = searchStartedAt;

    // Start loading first batch immediately
    loadNextBatch();
}

async function loadNextBatch() {
    if (!hasMoreResults || !currentSearchQuery) return;
    els.loader.style.display = 'block';
    try {
        const result = getNextBatch(BATCH_SIZE);

        if (result.length > 0) {
            if (resultContainer.children.length === 0) {
                const timeMs = (performance.now() - searchStartTime).toFixed(1);
                updateSearchHeaderWithTime(timeMs);
            }

            renderBatch(result);
        }

        hasMoreResults = result.length > 0;

        if (!hasMoreResults && resultContainer.children.length === 0) {
            showNoResults();
        }
    } catch (err) {
        console.error('Error loading batch:', err);
    } finally {
        els.loader.style.display = hasMoreResults ? 'block' : 'none';
    }
		if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) {
				loadNextBatch();
		}
}

function updateSearchHeaderWithTime(timeMs) {
    if (!searchHeader) return;

    const idx = getCurrentDictionaryIndex();
    const isAllMode = idx === 0;
    const loadedCount = dictionaryGroups.flatMap(g => g.subDicts)
        .filter(d => isDictionaryLoaded(d.index)).length;
    const totalCount = dictionaryGroups.flatMap(g => g.subDicts).length;

    searchHeader.textContent = isAllMode
        ? `Results for "${currentSearchQuery}" • ${loadedCount}/${totalCount} dictionaries • First results in ${timeMs}ms`
        : `Results for "${currentSearchQuery}" • First results in ${timeMs}ms`;
}

window.addEventListener('scroll', debounce(() => {
	if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) {
			loadNextBatch();
	}
}, 130));

// ── Result Rendering ─────────────────────────────────────────
function renderBatch(batch) {
    const fragment = document.createDocumentFragment();

    batch.forEach((entry, i) => {
        // Show dictionary/level marker when changed
        if (i === 0 || entry.dictIndex !== lastDictIndex || entry.level !== lastLevel) {
            const marker = document.createElement('p-h');
            const dictName = entry.dictName || findDictName(entry.dictIndex);
            marker.innerHTML = `${dictName}${entry.level > 0 ? ` • Level ${entry.level}` : ''}`;
            fragment.appendChild(marker);
        }

        const entryEl = createEntryElement(entry.text, entry.dictIndex, currentSearchQuery);
        const expandBtn = entryEl.querySelector('.expand-btn');
        if (expandBtn) {
            expandBtn.addEventListener('click', () => expandToOtherDicts(entryEl, entry.text, entry.dictIndex));
        }

        fragment.appendChild(entryEl);

        // Update tracking
        lastDictIndex = entry.dictIndex;
        lastLevel = entry.level;
    });

    resultContainer.appendChild(fragment);
}

function createEntryElement(text, dictIndex, query) {
    const div = document.createElement('p-d');

    const dict = findDictByIndex(dictIndex);
    const parts = text.split('\t');

    let content = '';
    if (dict?.templates?.length === parts.length) {
        content = dict.templates
            .map((tmpl, i) => tmpl.replace('###', highlightText(parts[i], query)))
            .join('');
    } else {
        content = `<h2>${highlightText(parts[0], query)}</h2>` +
                 parts.slice(1).map(p => `<p>${highlightText(p, query)}</p>`).join('');
    }

    div.innerHTML = `${content} <button class="expand-btn" title="Show in other dictionaries">➕</button>`;
    return div;
}

function highlightText(text, query) {
    if (!query) return text;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
}

// ── Expand to Other Dictionaries ─────────────────────────────
async function expandToOtherDicts(entryDiv, text, sourceIndex) {
    let expandContent = entryDiv.querySelector('.expand-content');
    if (expandContent) {
        expandContent.remove();
        return;
    }

    expandContent = document.createElement('div');
    expandContent.className = 'expand-content';
    expandContent.style.cssText = `
        margin-top: 12px;
        padding: 16px;
        background: #f8f9fa;
        border: 1px solid #e0e0e0;
        border-radius: 6px;
    `;
    expandContent.innerHTML = '<p style="text-align:center;color:#666;">Loading other dictionaries...</p>';
    entryDiv.appendChild(expandContent);

    const headword = text.split('\t')[0].trim().toLowerCase();
    const allDicts = dictionaryGroups.slice(1).flatMap(g => g.subDicts);

    // Load any missing dictionaries
    const unloaded = allDicts.filter(d => d.index !== sourceIndex && !isDictionaryLoaded(d.index));
    await Promise.all(unloaded.map(d => loadDictionary(d.index)));

    let resultsHtml = '';
    const seen = new Set();

    allDicts
        .filter(d => d.index !== sourceIndex)
        .forEach(dict => {
            const decoder = cache.decoders[dict.index]; // assuming peakslab exposes cache or provides access
            if (!decoder) return;

            decoder.search(headword, false);

            if (decoder.has_more_results_in_level(0)) {
                const raw = decoder.get_results_from_level(0, 50);
                const texts = raw.map(v => new TextDecoder().decode(new Uint8Array(v)));

                texts.filter(t => t.split('\t')[0].trim().toLowerCase() === headword)
                    .forEach(match => {
                        if (!seen.has(match)) {
                            seen.add(match);
                            const rendered = createEntryElement(match, dict.index, headword).innerHTML;
                            resultsHtml += `<div style="margin:1em 0;"><strong>${dict.displayName}</strong>${rendered}</div><hr>`;
                        }
                    });
            }
        });

    expandContent.innerHTML = resultsHtml || '<p style="text-align:center;color:#666;">No matches found in other dictionaries.</p>';
}

// ── UI Reset & Empty States ──────────────────────────────────
function resetSearchUI() {
		window.scrollTo(0, 0);
    els.results.innerHTML = '';
    resultContainer = null;
    searchHeader = null;
    hasMoreResults = true;
    els.loader.style.display = 'none';
    lastDictIndex = null;
    lastLevel = -1;
}

function showEmptyState() {
    const idx = getCurrentDictionaryIndex();
    const name = idx === 0 ? 'All Dictionaries' : findDictName(idx);
    const loaded = dictionaryGroups.flatMap(g => g.subDicts).filter(d => isDictionaryLoaded(d.index)).length;
    const total = dictionaryGroups.flatMap(g => g.subDicts).length;

    let html = `<p style="text-align:center; color:#555; margin:3em 1em;">
        Type to search in <strong>${name}</strong>
    </p>`;

    if (idx === 0) {
        html += `<p style="text-align:center; color:#888; font-size:0.9em;">
            (${loaded}/${total} dictionaries loaded — more loading in background)
        </p>`;
    }

    els.results.innerHTML = html;
}

function showNoResults() {
    const p = document.createElement('p');
    p.style.cssText = 'text-align:center; color:#666; margin:4em 1em; font-style:italic;';
    p.textContent = `No results found for "${currentSearchQuery}"`;
    resultContainer?.appendChild(p);
}

// ── Helpers ──────────────────────────────────────────────────
function findDictName(index) {
    return dictionaryGroups.flatMap(g => g.subDicts).find(d => d.index === index)?.displayName || `Dictionary ${index}`;
}

function findDictByIndex(index) {
    return dictionaryGroups.flatMap(g => g.subDicts).find(d => d.index === index);
}

function debounce(fn, delay) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

// ── Diagnostics ──────────────────────────────────────────────
function renderDiagnostics() {
    const diags = getLoadDiagnostics();
    let html = '';

    dictionaryGroups.flatMap(g => g.subDicts).forEach(dict => {
        const info = diags[dict.index];
        if (!info) return;

        if (info.error) {
            html += `<div style="color:#c0392b;">${dict.displayName}: ${info.error}</div>`;
        } else {
            html += `<div>${dict.displayName}: ${info.loadTimeMs}ms • ${info.sizeMB}MB</div>`;
        }
    });

    els.diagnostics.innerHTML = html || '<p style="color:#888; text-align:center; padding:12px;">No load statistics yet</p>';
}

// ── Auto-initialization ──────────────────────────────────────
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Global exports for external access (if needed)
window.renderDiagnostics = renderDiagnostics;
window.startNewSearch = startNewSearch;
