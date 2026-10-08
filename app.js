(() => {
    'use strict';

    const COLORS = ['#a61b1b', '#2674a7', '#d97706'];
    const CATEGORY_NAMES = ['核心概念', '具体要素', '翻译难点'];
    const MODULES = {
        politics: { label: '政治与治理', prefixes: ['A', 'B', 'C', 'E', 'O'] },
        economy: { label: '经济与科技', prefixes: ['G', 'I', 'P'] },
        culture: { label: '文化与传播', prefixes: ['J', 'L', 'Q'] },
        education: { label: '教育发展', prefixes: ['F', 'H'] },
        public: { label: '公共服务', prefixes: ['M'] },
        ecology: { label: '生态文明', prefixes: ['N'] }
    };

    const state = {
        nodes: [],
        links: [],
        nodeById: new Map(),
        adjacency: new Map(),
        degree: new Map(),
        chart: null,
        module: 'all',
        category: 'all',
        focusId: null,
        activeSearchIndex: 0,
        searchMatches: [],
        zoom: 0.82,
        toastTimer: null
    };

    const els = {};

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        cacheElements();
        initIcons();
        bindControls();

        if (!window.echarts) {
            showError('图谱组件未能加载，请检查网络连接后刷新。');
            return;
        }

        state.chart = window.echarts.init(els.chart, null, { renderer: 'canvas' });
        state.chart.on('click', handleChartClick);

        try {
            const response = await fetch('data.json');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (!Array.isArray(data.nodes) || !data.nodes.length) throw new Error('词条数据为空');
            prepareData(data);
            els.loadingState.hidden = true;
            renderGraph();
        } catch (error) {
            console.error('Data loading failed:', error);
            showError('无法读取 data.json，请通过网页服务器打开项目后重试。');
        }
    }

    function cacheElements() {
        [
            'chart', 'loadingState', 'errorState', 'errorMessage', 'searchInput', 'clearSearch',
            'searchResults', 'moduleFilter', 'resultSummary', 'resetView', 'aboutButton',
            'aboutModal', 'closeAbout', 'modalBackdrop', 'zoomIn', 'zoomOut', 'fitView',
            'mobileFilters', 'detailPanel', 'closeDetail', 'detailType', 'detailId',
            'detailName', 'detailEnglish', 'detailDescription', 'relationList',
            'copyTranslation', 'toast'
        ].forEach(id => { els[id] = document.getElementById(id); });
        els.toolbar = document.querySelector('.toolbar');
        els.workspace = document.querySelector('.workspace');
        els.categoryButtons = [...document.querySelectorAll('.category-button')];
    }

    function initIcons() {
        if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': 1.8 } });
    }

    function bindControls() {
        els.searchInput.addEventListener('input', onSearchInput);
        els.searchInput.addEventListener('keydown', onSearchKeydown);
        els.searchInput.addEventListener('focus', () => {
            if (els.searchInput.value.trim()) updateSearchResults();
        });
        els.clearSearch.addEventListener('click', clearSearch);
        document.addEventListener('click', event => {
            if (!event.target.closest('.search-area')) hideSearchResults();
        });

        els.moduleFilter.addEventListener('change', () => {
            state.module = els.moduleFilter.value;
            state.focusId = null;
            closeDetail();
            renderGraph();
            closeMobileFilters();
        });

        els.categoryButtons.forEach(button => {
            button.addEventListener('click', () => {
                state.category = button.dataset.category;
                state.focusId = null;
                els.categoryButtons.forEach(item => {
                    const active = item === button;
                    item.classList.toggle('active', active);
                    item.setAttribute('aria-pressed', String(active));
                });
                closeDetail();
                renderGraph();
                closeMobileFilters();
            });
        });

        els.resetView.addEventListener('click', resetView);
        els.zoomIn.addEventListener('click', () => setZoom(state.zoom * 1.22));
        els.zoomOut.addEventListener('click', () => setZoom(state.zoom / 1.22));
        els.fitView.addEventListener('click', fitView);
        els.closeDetail.addEventListener('click', closeDetail);
        els.copyTranslation.addEventListener('click', copyTranslation);
        els.mobileFilters.addEventListener('click', toggleMobileFilters);

        els.aboutButton.addEventListener('click', openAbout);
        els.closeAbout.addEventListener('click', closeAbout);
        els.modalBackdrop.addEventListener('click', closeAbout);

        window.addEventListener('resize', debounce(() => {
            state.chart?.resize();
            if (state.nodes.length) renderGraph();
        }, 180));

        document.addEventListener('keydown', event => {
            if (event.key !== 'Escape') return;
            hideSearchResults();
            closeAbout();
            closeDetail();
            closeMobileFilters();
        });
    }

    function prepareData(data) {
        state.nodes = data.nodes.map(node => ({
            ...node,
            id: String(node.id),
            name: String(node.name || node.id),
            eng: String(node.eng || '').trim(),
            desc: String(node.desc || '').trim(),
            category: normalizeCategory(node.category)
        }));
        state.nodeById = new Map(state.nodes.map(node => [node.id, node]));
        state.links = (data.links || [])
            .map(link => ({ ...link, source: String(link.source), target: String(link.target) }))
            .filter(link => state.nodeById.has(link.source) && state.nodeById.has(link.target));

        state.nodes.forEach(node => {
            state.adjacency.set(node.id, []);
            state.degree.set(node.id, 0);
        });
        state.links.forEach(link => {
            state.adjacency.get(link.source).push({ id: link.target, relation: link.relation || '关联', direction: 'out' });
            state.adjacency.get(link.target).push({ id: link.source, relation: link.relation || '关联', direction: 'in' });
            state.degree.set(link.source, state.degree.get(link.source) + 1);
            state.degree.set(link.target, state.degree.get(link.target) + 1);
        });
    }

    function handleChartClick(params) {
        const nodeId = params?.data?.id != null ? String(params.data.id) : '';
        const isGraphNode = params?.componentType === 'series'
            && params?.seriesType === 'graph'
            && params?.dataType !== 'edge'
            && state.nodeById.has(nodeId);

        if (isGraphNode) openNode(nodeId, false);
    }

    function normalizeCategory(value) {
        const number = Number(value);
        return number >= 0 && number <= 2 ? number : 1;
    }

    function renderGraph() {
        if (!state.chart || !state.nodes.length) return;
        const mobile = window.innerWidth <= 680;
        const maxNodes = mobile ? 60 : (window.innerWidth <= 960 ? 95 : 140);
        let candidates = state.nodes.filter(node => matchesModule(node, state.module) && matchesCategory(node, state.category));
        let visibleNodes;

        if (state.focusId) {
            visibleNodes = buildNeighborhood(state.focusId, candidates, mobile ? 75 : 125);
        } else {
            visibleNodes = candidates
                .slice()
                .sort((a, b) => nodePriority(b) - nodePriority(a) || a.id.localeCompare(b.id, 'zh-CN'))
                .slice(0, maxNodes);
        }

        const visibleIds = new Set(visibleNodes.map(node => node.id));
        const visibleLinks = state.links.filter(link => visibleIds.has(link.source) && visibleIds.has(link.target));
        const categoryCounts = [0, 0, 0];

        const chartNodes = visibleNodes.map(node => {
            categoryCounts[node.category] += 1;
            const selected = node.id === state.focusId;
            return {
                ...node,
                value: state.degree.get(node.id) || 0,
                symbol: ['circle', 'roundRect', 'diamond'][node.category],
                symbolSize: selected ? Math.max(Number(node.symbolSize) || 24, 42) : clamp(Number(node.symbolSize) || 24, 17, 35),
                itemStyle: selected ? { borderColor: '#202124', borderWidth: 4, shadowBlur: 18, shadowColor: 'rgba(32,33,36,0.28)' } : undefined
            };
        });

        state.zoom = mobile ? 0.62 : 0.78;
        const option = {
            animationDuration: 500,
            animationDurationUpdate: 350,
            tooltip: {
                trigger: 'item',
                confine: true,
                enterable: false,
                backgroundColor: '#ffffff',
                borderColor: '#d7d8dc',
                borderWidth: 1,
                padding: 11,
                textStyle: { color: '#202124', fontSize: 12 },
                extraCssText: 'max-width:300px;box-shadow:0 10px 26px rgba(20,25,31,.14);border-radius:6px;',
                formatter: tooltipFormatter
            },
            aria: {
                enabled: true,
                description: `理解当代中国术语知识图谱，当前展示${chartNodes.length}个节点和${visibleLinks.length}条关系。`
            },
            series: [{
                id: 'knowledgeGraph',
                type: 'graph',
                layout: 'force',
                left: mobile ? 12 : 56,
                top: mobile ? 70 : 84,
                right: mobile ? 24 : 42,
                bottom: mobile ? 62 : 42,
                data: chartNodes,
                links: visibleLinks,
                categories: CATEGORY_NAMES.map((name, index) => ({ name, itemStyle: { color: COLORS[index] } })),
                roam: true,
                zoom: state.zoom,
                draggable: true,
                cursor: 'pointer',
                selectedMode: 'single',
                force: {
                    repulsion: mobile ? 175 : 250,
                    edgeLength: mobile ? [48, 92] : [62, 118],
                    gravity: 0.18,
                    friction: 0.3,
                    layoutAnimation: !window.matchMedia('(prefers-reduced-motion: reduce)').matches
                },
                emphasis: {
                    focus: 'adjacency',
                    scale: 1.25,
                    lineStyle: { width: 2.4, opacity: 0.95 },
                    label: { show: true, color: '#161719', fontWeight: 600 }
                },
                blur: { itemStyle: { opacity: 0.16 }, lineStyle: { opacity: 0.08 }, label: { opacity: 0.12 } },
                itemStyle: { borderColor: '#ffffff', borderWidth: 1.5, shadowBlur: 5, shadowColor: 'rgba(20,25,31,0.16)' },
                lineStyle: { color: '#8e9298', width: 1, opacity: 0.36, curveness: 0.12 },
                label: {
                    show: true,
                    position: 'right',
                    distance: 7,
                    color: '#34363a',
                    fontSize: mobile ? 10 : 11,
                    formatter: params => truncate(params.data.name, mobile ? 8 : 12)
                },
                labelLayout: { hideOverlap: true, moveOverlap: 'shiftY' },
                edgeLabel: { show: false }
            }]
        };

        state.chart.setOption(option, true);
        updateSummary(candidates.length, chartNodes.length, visibleLinks.length, categoryCounts);
    }

    function nodePriority(node) {
        const categoryBonus = node.category === 0 ? 90 : node.category === 2 ? 22 : 0;
        return categoryBonus + (state.degree.get(node.id) || 0) * 12 + Math.min(Number(node.symbolSize) || 0, 50);
    }

    function buildNeighborhood(focusId, candidates, limit) {
        const allowed = new Set(candidates.map(node => node.id));
        allowed.add(focusId);
        const selectedIds = [focusId];
        const seen = new Set(selectedIds);
        const direct = (state.adjacency.get(focusId) || [])
            .map(item => item.id)
            .filter(id => allowed.has(id) && !seen.has(id));

        direct.sort((a, b) => nodePriority(state.nodeById.get(b)) - nodePriority(state.nodeById.get(a)));
        direct.forEach(id => { if (selectedIds.length < limit) { seen.add(id); selectedIds.push(id); } });

        for (const parentId of [...selectedIds]) {
            if (selectedIds.length >= limit) break;
            const neighbors = (state.adjacency.get(parentId) || [])
                .map(item => item.id)
                .filter(id => allowed.has(id) && !seen.has(id))
                .sort((a, b) => nodePriority(state.nodeById.get(b)) - nodePriority(state.nodeById.get(a)));
            for (const id of neighbors) {
                if (selectedIds.length >= limit) break;
                seen.add(id);
                selectedIds.push(id);
            }
        }
        return selectedIds.map(id => state.nodeById.get(id)).filter(Boolean);
    }

    function matchesModule(node, moduleKey) {
        if (moduleKey === 'all') return true;
        const prefix = getPrefix(node.id);
        return MODULES[moduleKey]?.prefixes.includes(prefix) || false;
    }

    function matchesCategory(node, category) {
        return category === 'all' || node.category === Number(category);
    }

    function getPrefix(id) {
        return (String(id).match(/^[A-Za-z]+/) || [''])[0].toUpperCase();
    }

    function getModuleForNode(node) {
        const prefix = getPrefix(node.id);
        return Object.entries(MODULES).find(([, config]) => config.prefixes.includes(prefix))?.[0] || 'all';
    }

    function tooltipFormatter(params) {
        if (params.dataType === 'edge') {
            const source = state.nodeById.get(String(params.data.source));
            const target = state.nodeById.get(String(params.data.target));
            return `<div class="chart-tooltip"><b>${escapeHTML(params.data.relation || '关联')}</b><br>${escapeHTML(source?.name || params.data.source)} → ${escapeHTML(target?.name || params.data.target)}</div>`;
        }
        const node = params.data;
        const english = node.eng || '暂无英文译名';
        return `<div class="chart-tooltip"><b>${escapeHTML(node.name)}</b><br><span style="color:#777">${escapeHTML(node.id)} · ${CATEGORY_NAMES[node.category]}</span><br><span style="color:#7f1414">${escapeHTML(truncate(english, 72))}</span><br><small style="color:#888">点击查看完整词条信息</small></div>`;
    }

    function updateSummary(totalMatches, shownNodes, shownLinks) {
        const scope = state.focusId ? '局部关系' : (state.module === 'all' ? '全部主题概览' : MODULES[state.module].label);
        const limited = shownNodes < totalMatches ? `（共匹配 ${totalMatches} 个词条）` : '';
        els.resultSummary.textContent = `${scope} · 展示 ${shownNodes} 个节点 / ${shownLinks} 条关系${limited}`;
    }

    function onSearchInput() {
        els.clearSearch.hidden = !els.searchInput.value;
        updateSearchResults();
    }

    function updateSearchResults() {
        const query = normalizeText(els.searchInput.value);
        if (!query) {
            hideSearchResults();
            return;
        }

        state.searchMatches = state.nodes
            .map(node => ({ node, score: searchScore(node, query) }))
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score || nodePriority(b.node) - nodePriority(a.node))
            .slice(0, 8)
            .map(item => item.node);
        state.activeSearchIndex = 0;
        drawSearchResults(els.searchInput.value.trim());
    }

    function searchScore(node, query) {
        const id = normalizeText(node.id);
        const name = normalizeText(node.name);
        const english = normalizeText(node.eng);
        if (id === query || name === query || english === query) return 1000;
        if (name.startsWith(query)) return 800;
        if (english.startsWith(query)) return 700;
        if (id.startsWith(query)) return 650;
        if (name.includes(query)) return 520;
        if (english.includes(query)) return 420;
        if (id.includes(query)) return 350;
        return 0;
    }

    function drawSearchResults(rawQuery) {
        els.searchResults.replaceChildren();
        if (!state.searchMatches.length) {
            const message = document.createElement('p');
            message.className = 'no-results';
            message.textContent = '未找到匹配词条，请尝试其他关键词';
            els.searchResults.appendChild(message);
        } else {
            state.searchMatches.forEach((node, index) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = `search-result${index === state.activeSearchIndex ? ' active' : ''}`;
                button.setAttribute('role', 'option');
                button.setAttribute('aria-selected', String(index === state.activeSearchIndex));

                const name = document.createElement('strong');
                appendHighlightedText(name, node.name, rawQuery);
                const english = document.createElement('small');
                appendHighlightedText(english, node.eng || '暂无英文译名', rawQuery);
                const meta = document.createElement('em');
                meta.textContent = `${node.id} · ${CATEGORY_NAMES[node.category]}`;
                button.append(name, english, meta);
                button.addEventListener('mousedown', event => event.preventDefault());
                button.addEventListener('click', () => selectSearchResult(node.id));
                els.searchResults.appendChild(button);
            });
        }
        els.searchResults.hidden = false;
        els.searchInput.setAttribute('aria-expanded', 'true');
    }

    function appendHighlightedText(container, text, query) {
        const value = String(text || '');
        const lowerValue = value.toLocaleLowerCase();
        const lowerQuery = String(query || '').toLocaleLowerCase();
        const index = lowerValue.indexOf(lowerQuery);
        if (index < 0 || !lowerQuery) {
            container.textContent = value;
            return;
        }
        container.append(document.createTextNode(value.slice(0, index)));
        const mark = document.createElement('mark');
        mark.textContent = value.slice(index, index + query.length);
        container.append(mark, document.createTextNode(value.slice(index + query.length)));
    }

    function onSearchKeydown(event) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (!state.searchMatches.length) return;
            event.preventDefault();
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            state.activeSearchIndex = (state.activeSearchIndex + direction + state.searchMatches.length) % state.searchMatches.length;
            drawSearchResults(els.searchInput.value.trim());
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const match = state.searchMatches[state.activeSearchIndex];
            if (match) selectSearchResult(match.id);
        } else if (event.key === 'Escape') {
            hideSearchResults();
        }
    }

    function selectSearchResult(id) {
        const node = state.nodeById.get(id);
        if (!node) return;
        els.searchInput.value = node.name;
        els.clearSearch.hidden = false;
        hideSearchResults();
        const moduleKey = getModuleForNode(node);
        state.module = moduleKey;
        els.moduleFilter.value = moduleKey;
        setCategory('all');
        openNode(id, true);
    }

    function openNode(id, rerender = true) {
        const node = state.nodeById.get(id);
        if (!node) return;
        state.focusId = id;
        if (rerender) renderGraph();
        showDetail(node);
        closeMobileFilters();
    }

    function showDetail(node) {
        els.detailType.textContent = CATEGORY_NAMES[node.category];
        els.detailType.dataset.category = String(node.category);
        els.detailId.textContent = node.id;
        els.detailName.textContent = node.name;
        els.detailEnglish.textContent = node.eng || '暂无英文译名';
        els.detailDescription.textContent = formatDescription(node.desc) || '暂无语料与翻译说明。';
        drawRelations(node.id);
        els.detailPanel.classList.add('open');
        els.detailPanel.setAttribute('aria-hidden', 'false');
        els.workspace.classList.add('detail-open');
        window.setTimeout(() => state.chart?.resize(), 30);
    }

    function drawRelations(id) {
        const relations = (state.adjacency.get(id) || [])
            .slice()
            .sort((a, b) => (a.relation || '').localeCompare(b.relation || '', 'zh-CN'));
        els.relationList.replaceChildren();

        if (!relations.length) {
            const empty = document.createElement('p');
            empty.className = 'relation-empty';
            empty.textContent = '当前词条暂无关联数据。';
            els.relationList.appendChild(empty);
            return;
        }

        relations.forEach(relation => {
            const relatedNode = state.nodeById.get(relation.id);
            if (!relatedNode) return;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'relation-item';
            button.innerHTML = `<span class="relation-direction" aria-hidden="true">${relation.direction === 'out' ? '→' : '←'}</span><span class="relation-copy"><span class="relation-name"></span><span class="relation-kind"></span></span><i data-lucide="chevron-right" aria-hidden="true"></i>`;
            button.querySelector('.relation-name').textContent = relatedNode.name;
            button.querySelector('.relation-kind').textContent = relation.relation;
            button.setAttribute('aria-label', `${relation.relation}：${relatedNode.name}`);
            button.addEventListener('click', () => {
                els.searchInput.value = relatedNode.name;
                els.clearSearch.hidden = false;
                openNode(relatedNode.id, true);
            });
            els.relationList.appendChild(button);
        });
        initIcons();
    }

    function formatDescription(description) {
        return String(description || '')
            .replace(/\s*[;；]\s*(?=(?:翻译过程|常用语料|来源|语料来源)[:：])/g, '\n\n')
            .replace(/\s+(?=(?:翻译过程|常用语料)[:：])/g, '\n\n')
            .trim();
    }

    async function copyTranslation() {
        const text = els.detailEnglish.textContent;
        if (!text || text === '暂无英文译名') return;
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
        }
        showToast('英文译名已复制');
    }

    function closeDetail() {
        els.detailPanel.classList.remove('open');
        els.detailPanel.setAttribute('aria-hidden', 'true');
        els.workspace.classList.remove('detail-open');
        window.setTimeout(() => state.chart?.resize(), 30);
    }

    function clearSearch() {
        els.searchInput.value = '';
        els.clearSearch.hidden = true;
        state.searchMatches = [];
        hideSearchResults();
        state.focusId = null;
        closeDetail();
        renderGraph();
        els.searchInput.focus();
    }

    function hideSearchResults() {
        els.searchResults.hidden = true;
        els.searchInput.setAttribute('aria-expanded', 'false');
    }

    function resetView() {
        state.module = 'all';
        els.moduleFilter.value = 'all';
        setCategory('all');
        els.searchInput.value = '';
        els.clearSearch.hidden = true;
        state.focusId = null;
        closeDetail();
        hideSearchResults();
        renderGraph();
        showToast('已回到全部主题概览');
    }

    function setCategory(category) {
        state.category = category;
        els.categoryButtons.forEach(button => {
            const active = button.dataset.category === category;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        });
    }

    function setZoom(zoom) {
        state.zoom = clamp(zoom, 0.25, 3);
        state.chart?.setOption({ series: [{ id: 'knowledgeGraph', zoom: state.zoom }] });
    }

    function fitView() {
        state.zoom = window.innerWidth <= 680 ? 0.62 : 0.78;
        state.chart?.setOption({ series: [{ id: 'knowledgeGraph', zoom: state.zoom, center: null }] });
    }

    function toggleMobileFilters() {
        const open = els.toolbar.classList.toggle('mobile-open');
        els.mobileFilters.setAttribute('aria-expanded', String(open));
    }

    function closeMobileFilters() {
        els.toolbar.classList.remove('mobile-open');
        els.mobileFilters.setAttribute('aria-expanded', 'false');
    }

    function openAbout() {
        els.aboutModal.hidden = false;
        els.modalBackdrop.hidden = false;
        document.body.style.overflow = 'hidden';
        els.closeAbout.focus();
    }

    function closeAbout() {
        if (els.aboutModal.hidden) return;
        els.aboutModal.hidden = true;
        els.modalBackdrop.hidden = true;
        document.body.style.overflow = '';
        els.aboutButton.focus();
    }

    function showError(message) {
        els.loadingState.hidden = true;
        els.errorMessage.textContent = message;
        els.errorState.hidden = false;
    }

    function showToast(message) {
        clearTimeout(state.toastTimer);
        els.toast.textContent = message;
        els.toast.hidden = false;
        state.toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2200);
    }

    function normalizeText(value) {
        return String(value || '').trim().toLocaleLowerCase();
    }

    function truncate(value, maxLength) {
        const text = String(value || '');
        return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
    }

    function escapeHTML(value) {
        return String(value || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function debounce(callback, wait) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => callback(...args), wait);
        };
    }
})();
