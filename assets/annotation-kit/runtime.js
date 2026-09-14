const VPA_PENDING_ISSUES_STORAGE_KEY = 'prototype-annotation-pending-issues';

function loadPendingIssues() {
  try {
    const stored = JSON.parse(localStorage.getItem(VPA_PENDING_ISSUES_STORAGE_KEY) || '[]');
    if (!Array.isArray(stored)) return [];
    return stored
      .filter((issue) => issue && issue.id && issue.blockKey && issue.description)
      .map((issue) => ({
        id: String(issue.id),
        blockKey: String(issue.blockKey),
        description: String(issue.description),
        status: issue.status === 'resolved' ? 'resolved' : 'open',
        resolution: String(issue.resolution || ''),
      }));
  } catch (error) {
    return [];
  }
}

const VPA_STATE = {
  config: null,
  configBaseUrl: location.href,
  mode: 'preview',
  badges: new Map(),
  openPopups: new Map(),
  markdownFiles: new Map(),
  panelOpen: false,
  panelType: 'all',
  expandedCards: new Set(),
  detailTabByCard: new Map(),
  pendingIssues: loadPendingIssues(),
  pendingFilter: 'all',
  highlightTimer: null,
  mermaidPromise: null,
  toolbarPos: { x: window.innerWidth - 220, y: window.innerHeight - 54 },
  measureScheduled: false,
};

const ALL_POPUP_KEY = '__vpa_all__';

function stop(event) {
  event.preventDefault();
  event.stopPropagation();
}

function savePendingIssues() {
  try {
    localStorage.setItem(VPA_PENDING_ISSUES_STORAGE_KEY, JSON.stringify(VPA_STATE.pendingIssues));
  } catch (error) {
    showToast('待确认问题保存失败');
  }
}

function pendingIssuesForBlock(blockKey) {
  return VPA_STATE.pendingIssues.filter((issue) => issue.blockKey === blockKey);
}

function annotationForKey(blockKey) {
  return (VPA_STATE.config?.annotations || []).find((annotation) => annotationKey(annotation) === blockKey);
}

function pendingIssueSource(blockKey) {
  return annotationForKey(blockKey)?.moduleName || blockKey || '未指定标注块';
}

function pendingIssueGroupHeading(blockKey) {
  const annotation = annotationForKey(blockKey);
  const number = annotation?.id ?? annotation?.order ?? blockKey ?? '未指定';
  const title = annotation?.moduleName || annotation?.title || blockKey || '未指定标注块';
  return `### 序号 ${String(number).replace(/[\r\n]/g, ' ')}（${String(title).replace(/[\r\n]/g, ' ')}）`;
}

function sortedPendingIssueGroups(issues) {
  const groups = new Map();
  issues.forEach((issue) => {
    if (!groups.has(issue.blockKey)) groups.set(issue.blockKey, []);
    groups.get(issue.blockKey).push(issue);
  });
  return [...groups.entries()].sort((left, right) => {
    const leftOrder = Number(annotationForKey(left[0])?.order ?? 999999);
    const rightOrder = Number(annotationForKey(right[0])?.order ?? 999999);
    return leftOrder - rightOrder || left[0].localeCompare(right[0]);
  });
}

function createPendingIssue(blockKey, description) {
  const uniqueId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const issue = {
    id: `${blockKey}-${uniqueId}`,
    blockKey,
    description: description.trim(),
    status: 'open',
    resolution: '',
  };
  VPA_STATE.pendingIssues.push(issue);
  savePendingIssues();
  return issue;
}

function updatePendingIssue(issueId, patch) {
  const issue = VPA_STATE.pendingIssues.find((item) => item.id === issueId);
  if (!issue) return null;
  Object.assign(issue, patch);
  savePendingIssues();
  return issue;
}

function annotationKey(annotation) {
  return String(annotation.key || annotation.id);
}

function annotationExportId(annotation) {
  return annotation.scope ? annotationKey(annotation) : String(annotation.id);
}

const VPA_TYPE_META = {
  all: { label: '全部' },
  page: { label: '页面' },
  interaction: { label: '交互' },
  rule: { label: '规则' },
  field: { label: '字段' },
  pending: { label: '待确认' },
};

const VPA_DETAIL_TABS = [
  { key: 'all', label: '全部' },
  { key: 'page', label: '页面内容' },
  { key: 'interaction', label: '交互说明' },
  { key: 'rule', label: '业务规则' },
  { key: 'field', label: '字段说明' },
  { key: 'pending', label: '待确认' },
];

const VPA_FLOATING_POSITION_KEY = 'vpa-floating-entries-position';

function annotationType(annotation) {
  return VPA_TYPE_META[annotation.type] ? annotation.type : 'page';
}

function annotationTypeLabel(annotation) {
  return VPA_TYPE_META[annotationType(annotation)].label;
}

function currentPageAnnotations() {
  return sortedAnnotations().filter((annotation) => currentPageMatches(annotation));
}

function annotationPlainText(markdown) {
  return String(markdown || '')
    .replace(/<!--[^>]*-->/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s*/gm, '')
    .replace(/^\s*[-+*]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function annotationSummary(annotation) {
  const markdown = getAnnotationMarkdown(annotation);
  const candidates = String(markdown || '').split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('<!--') && !line.startsWith('#') && !line.startsWith('>') && !line.startsWith('|') && !line.startsWith('---') && !/^来源[:：]/.test(line));
  return annotationPlainText(candidates[0] || markdown).slice(0, 96) || '暂无摘要';
}

function annotationDetailCount(annotation) {
  const markdown = getAnnotationMarkdown(annotation);
  const listCount = (String(markdown).match(/^\s*(?:[-+*]|\d+\.)\s+/gm) || []).length;
  return Math.max(1, listCount);
}

function parseAnnotationTabs(markdown) {
  const sections = { page: [], interaction: [], rule: [], field: [], pending: [] };
  const headingMap = new Map(VPA_DETAIL_TABS.filter((tab) => tab.key !== 'all').map((tab) => [tab.label, tab.key]));
  let current = null;
  for (const line of String(markdown || '').split('\n')) {
    const heading = line.trim().match(/^###\s+(.+)$/);
    const key = heading ? headingMap.get(heading[1].trim()) : null;
    if (key) {
      current = key;
      continue;
    }
    if (current) sections[current].push(line);
  }
  return sections;
}

function countMarkdownItems(markdown) {
  const source = String(markdown || '');
  const lines = source.split('\n');
  const isSep = (line) => /^\s*\|(?:[ \t]*:?-{3,}:?[ \t]*\|)+\s*$/.test(line);
  const isBar = (line) => /^\s*\|/.test(line) && !isSep(line);
  let listItems = 0, tableRows = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(?:[-+*]|\d+\.)\s+/.test(line)) listItems++;
    else if (isBar(line) && !isSep(lines[i + 1] || '')) tableRows++;
  }
  return listItems + tableRows;
}

function detailTabMarkdown(sections, key) {
  if (key !== 'all') return sections[key].join('\n').replace(/^\s+|\s+$/g, '');
  const chunks = [];
  VPA_DETAIL_TABS.filter((tab) => tab.key !== 'all').forEach((tab) => {
    if (countMarkdownItems(sections[tab.key].join('\n'))) {
      chunks.push('### ' + tab.label);
      chunks.push(sections[tab.key].join('\n').replace(/^\s+|\s+$/g, ''));
    }
  });
  return chunks.join('\n\n');
}

function setTabbedMarkdownContent(container, markdown, initialTab = 'all') {
  const sections = parseAnnotationTabs(markdown);
  const cardKey = container.closest('[data-annotation-key]')?.dataset.annotationKey;
  const counts = {
    all: Object.values(sections).reduce((total, section) => total + countMarkdownItems(section.join('\n')), 0),
    page: countMarkdownItems(sections.page.join('\n')),
    interaction: countMarkdownItems(sections.interaction.join('\n')),
    rule: countMarkdownItems(sections.rule.join('\n')),
    field: countMarkdownItems(sections.field.join('\n')),
    pending: cardKey ? pendingIssuesForBlock(cardKey).length : countMarkdownItems(sections.pending.join('\n')),
  };
  const availableTabs = new Set(VPA_DETAIL_TABS.map((tab) => tab.key));
  const savedTab = cardKey ? VPA_STATE.detailTabByCard.get(cardKey) : null;
  const requestedTab = savedTab || container.dataset.detailTab || initialTab;
  let currentTab = availableTabs.has(requestedTab) ? requestedTab : 'all';
  container.innerHTML = '<div class="vpa-detail-tabs" role="tablist" aria-label="标注详情分类"></div><div class="vpa-detail-tab-panel"></div>';
  const tabBar = container.querySelector('.vpa-detail-tabs');
  const panel = container.querySelector('.vpa-detail-tab-panel');
  if (!tabBar || !panel) return;

  const syncPendingTabCount = () => {
    const count = tabBar.querySelector('[data-vpa-detail-tab="pending"] span');
    if (count) count.textContent = String(cardKey ? pendingIssuesForBlock(cardKey).length : 0);
  };
  const renderPendingTab = () => {
    renderPendingIssueTracker(panel, {
      blockKey: cardKey,
      onChange: () => {
        syncPendingTabCount();
        renderPendingTab();
      },
    });
  };

  const renderTab = (key) => {
    currentTab = availableTabs.has(key) ? key : 'all';
    container.dataset.detailTab = currentTab;
    if (cardKey) VPA_STATE.detailTabByCard.set(cardKey, currentTab);
    tabBar.querySelectorAll('[data-vpa-detail-tab]').forEach((button) => {
      const active = button.dataset.vpaDetailTab === key;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (currentTab === 'pending') {
      renderPendingTab();
      return;
    }
    const count = counts[key];
    const content = detailTabMarkdown(sections, key);
    if (!count || !content) {
      panel.innerHTML = '<div class="vpa-detail-empty">该分组暂无内容（0项）</div>';
      return;
    }
    setMarkdownContent(panel, content);
    if (currentTab === 'all' && cardKey) renderPendingSummary(panel, cardKey);
  };

  tabBar.innerHTML = VPA_DETAIL_TABS.map((tab) => (
    '<button type="button" role="tab" class="vpa-detail-tab' + (tab.key === currentTab ? ' is-active' : '') +
    '" data-vpa-detail-tab="' + tab.key + '" aria-selected="' + (tab.key === currentTab ? 'true' : 'false') + '">' +
    tab.label + '<span>' + counts[tab.key] + '</span></button>'
  )).join('');
  tabBar.querySelectorAll('[data-vpa-detail-tab]').forEach((button) => {
    button.addEventListener('click', (event) => {
      stop(event);
      renderTab(button.dataset.vpaDetailTab || 'all');
    });
  });
  renderTab(currentTab);
}

function renderPendingSummary(container, blockKey) {
  const issues = pendingIssuesForBlock(blockKey);
  if (!issues.length) return;
  const summary = document.createElement('section');
  summary.className = 'vpa-pending-inline-summary';
  summary.innerHTML = '<h3>待确认</h3><ul>' + issues.map((issue) => (
    `<li><span class="vpa-pending-inline-status">${issue.status === 'resolved' ? '已解决' : '未解决'}</span>${escapeHtml(issue.description)}</li>`
  )).join('') + '</ul>';
  container.appendChild(summary);
}

function pendingIssueMarkup(issue, showSource = false) {
  const resolved = issue.status === 'resolved';
  return `<article class="vpa-pending-issue${resolved ? ' is-resolved' : ''}" data-vpa-issue-id="${escapeHtml(issue.id)}">
    <label class="vpa-pending-check" title="${resolved ? '标记为未解决' : '标记为已解决'}">
      <input type="checkbox" data-vpa-issue-status ${resolved ? 'checked' : ''}>
    </label>
    <div class="vpa-pending-issue-body">
      <div class="vpa-pending-issue-meta"><span data-vpa-issue-status-label>${resolved ? '已解决' : '未解决'}</span>${showSource ? `<span class="vpa-pending-source">来源：${escapeHtml(pendingIssueSource(issue.blockKey))}</span>` : ''}</div>
      <div class="vpa-pending-description">${escapeHtml(issue.description)}</div>
      <label class="vpa-pending-resolution-label">解决方法
        <input type="text" class="vpa-pending-resolution" data-vpa-issue-resolution value="${escapeHtml(issue.resolution)}" placeholder="${resolved ? '填写解决方法' : '解决后填写'}">
      </label>
    </div>
  </article>`;
}

function renderPendingIssueTracker(container, options = {}) {
  const blockKey = options.blockKey || null;
  const isGlobal = options.global === true;
  const scopedIssues = blockKey ? pendingIssuesForBlock(blockKey) : VPA_STATE.pendingIssues;
  const filteredIssues = isGlobal && VPA_STATE.pendingFilter !== 'all'
    ? scopedIssues.filter((issue) => issue.status === VPA_STATE.pendingFilter)
    : scopedIssues;
  let content = '';

  if (isGlobal) {
    content = sortedPendingIssueGroups(filteredIssues).map(([sourceKey, issues]) => `<section class="vpa-pending-group">
      <h3 class="vpa-pending-group-title"><span class="vpa-pending-group-heading">${escapeHtml(pendingIssueGroupHeading(sourceKey).replace(/^###\s+/, ''))}</span><span>${issues.length}</span></h3>
      ${issues.map((issue) => pendingIssueMarkup(issue, true)).join('')}
    </section>`).join('');
  } else {
    content = filteredIssues.map((issue) => pendingIssueMarkup(issue)).join('');
  }

  const emptyText = isGlobal
    ? (VPA_STATE.pendingFilter === 'all' ? '暂无待确认问题' : '当前筛选暂无问题')
    : '暂无待确认问题，输入后点击“添加问题”。';
  container.innerHTML = `<div class="vpa-pending-tracker">
    ${blockKey ? '<div class="vpa-pending-block-toolbar"><div class="vpa-pending-compose"><input type="text" class="vpa-pending-new-input" placeholder="输入待确认问题"><button type="button" class="vpa-pending-add" data-vpa-add-issue>添加问题</button></div><button type="button" class="vpa-export-pending vpa-pending-block-export" data-vpa-export-pending-block>导出待办</button></div>' : ''}
    ${isGlobal ? `<div class="vpa-pending-filter" role="tablist" aria-label="待确认问题筛选">${[['all', '全部'], ['open', '未解决'], ['resolved', '已解决']].map(([key, label]) => `<button type="button" role="tab" class="vpa-pending-filter-button${VPA_STATE.pendingFilter === key ? ' is-active' : ''}" data-vpa-pending-filter="${key}" aria-selected="${VPA_STATE.pendingFilter === key ? 'true' : 'false'}">${label}<span>${key === 'all' ? VPA_STATE.pendingIssues.length : VPA_STATE.pendingIssues.filter((issue) => issue.status === key).length}</span></button>`).join('')}</div>` : ''}
    <div class="vpa-pending-count">${isGlobal ? `共 ${filteredIssues.length} 条问题` : `本标注块 ${filteredIssues.length} 条问题`}</div>
    <div class="vpa-pending-issue-list">${content || `<div class="vpa-pending-empty">${emptyText}</div>`}</div>
  </div>`;

  const newInput = container.querySelector('.vpa-pending-new-input');
  const addIssue = () => {
    const description = newInput?.value.trim() || '';
    if (!blockKey || !description) {
      newInput?.focus();
      return;
    }
    createPendingIssue(blockKey, description);
    if (newInput) newInput.value = '';
    options.onChange?.();
  };
  container.querySelector('[data-vpa-add-issue]')?.addEventListener('click', (event) => {
    stop(event);
    addIssue();
  });
  container.querySelector('[data-vpa-export-pending-block]')?.addEventListener('click', (event) => {
    stop(event);
    exportPendingIssues(pendingIssuesForBlock(blockKey), blockKey).catch(() => showToast('待办导出失败'));
  });
  newInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    stop(event);
    addIssue();
  });
  container.querySelectorAll('[data-vpa-pending-filter]').forEach((button) => {
    button.addEventListener('click', (event) => {
      stop(event);
      VPA_STATE.pendingFilter = button.dataset.vpaPendingFilter || 'all';
      options.onFilterChange?.();
    });
  });
  container.querySelectorAll('[data-vpa-issue-status]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const issueId = checkbox.closest('[data-vpa-issue-id]')?.dataset.vpaIssueId;
      const issue = updatePendingIssue(issueId, { status: checkbox.checked ? 'resolved' : 'open' });
      if (!issue) return;
      const item = checkbox.closest('.vpa-pending-issue');
      item?.classList.toggle('is-resolved', issue.status === 'resolved');
      const statusLabel = item?.querySelector('[data-vpa-issue-status-label]');
      if (statusLabel) statusLabel.textContent = issue.status === 'resolved' ? '已解决' : '未解决';
      if (isGlobal && VPA_STATE.pendingFilter !== 'all') options.onFilterChange?.();
    });
  });
  container.querySelectorAll('[data-vpa-issue-resolution]').forEach((input) => {
    input.addEventListener('input', () => {
      const issueId = input.closest('[data-vpa-issue-id]')?.dataset.vpaIssueId;
      updatePendingIssue(issueId, { resolution: input.value });
    });
  });
}

function pendingIssuesMarkdown(issues = VPA_STATE.pendingIssues, blockKey = null) {
  const lines = ['## 待办项'];
  const selectedIssues = Array.isArray(issues) ? issues : [];
  if (!selectedIssues.length) {
    if (blockKey) {
      lines.push(pendingIssueGroupHeading(blockKey));
      lines.push('- 暂无待确认问题');
    } else {
      lines.push('- 暂无待确认问题');
    }
    return lines.join('\n');
  }
  const groups = blockKey ? [[blockKey, selectedIssues]] : sortedPendingIssueGroups(selectedIssues);
  groups.forEach(([sourceKey, groupIssues]) => {
    lines.push(pendingIssueGroupHeading(sourceKey));
    groupIssues.forEach((issue) => {
      const checked = issue.status === 'resolved' ? 'x' : ' ';
      const resolution = issue.resolution.trim() || '（待补充）';
      lines.push(`- [${checked}] ${issue.description}`);
      lines.push(`  - 解决方法：${resolution}`);
    });
  });
  return lines.join('\n');
}

async function exportPendingIssues(issues = VPA_STATE.pendingIssues, blockKey = null) {
  const markdown = pendingIssuesMarkdown(issues, blockKey);
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(markdown);
      copied = true;
    }
  } catch (error) {
    // Download remains available when clipboard permissions are unavailable.
  }
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'prototype-annotation-pending-todos.md';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  showToast(copied ? '待办 Markdown 已复制并下载' : '待办 Markdown 已下载');
}

function initialAnnotationMode(config) {
  return config?.runtime?.initialMode === 'annotate' ? 'annotate' : 'preview';
}

function currentRouteCandidates() {
  const routes = new Set();
  const addVariants = (pathname) => {
    routes.add(pathname);
    routes.add(`${pathname}${location.hash}`);
    routes.add(`${pathname}${location.search}${location.hash}`);
  };
  addVariants(location.pathname);
  try {
    addVariants(decodeURIComponent(location.pathname));
  } catch (error) {
    // Keep the raw pathname variants when decoding fails.
  }
  return [...routes];
}

function applyRuntimeStyle(element) {
  const zIndexBase = Number(VPA_STATE.config?.runtime?.zIndexBase);
  if (Number.isFinite(zIndexBase)) element.style.setProperty('--vpa-z-base', String(zIndexBase));
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function isTableSeparator(line) {
  const cells = splitTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderInline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/|#)[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function renderList(items) {
  const root = [];
  const stack = [{ depth: -1, children: root }];
  for (const item of items) {
    while (stack.length > 1 && stack[stack.length - 1].depth >= item.depth) stack.pop();
    const node = { ...item, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push({ depth: item.depth, children: node.children });
  }

  function renderChildren(children) {
    let html = '';
    for (let index = 0; index < children.length;) {
      const type = children[index].type;
      const group = [];
      while (index < children.length && children[index].type === type) {
        group.push(children[index]);
        index += 1;
      }
      html += `<${type}>${group.map((item) => {
        const task = item.text.match(/^\[([ xX])\]\s+(.+)$/);
        const renderListItemText = (text) => {
          const labelMatch = String(text).match(/^(.+?)([：:])\s*(.*)$/);
          if (!labelMatch) return renderInline(text);
          return '<strong class="vpa-list-label">' + renderInline(labelMatch[1]) + labelMatch[2] + '</strong>' + renderInline(labelMatch[3]);
        };
        const content = task
          ? `<input type="checkbox" disabled${task[1].toLowerCase() === 'x' ? ' checked' : ''}> ${renderInline(task[2])}`
          : renderListItemText(item.text);
        return `<li>${content}${item.children.length ? renderChildren(item.children) : ''}</li>`;
      }).join('')}</${type}>`;
    }
    return html;
  }
  return renderChildren(root);
}

function renderMarkdown(markdown) {
  const lines = String(markdown || '').split('\n');
  const html = [];
  let list = [];

  function flushList() {
    if (!list.length) return;
    html.push(renderList(list));
    list = [];
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('<!--')) {
      flushList();
      continue;
    }
    if (trimmed.startsWith('```')) {
      flushList();
      const language = trimmed.slice(3).trim().toLowerCase();
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      const code = codeLines.join('\n');
      if (language === 'mermaid') {
        html.push(`<div class="vpa-mermaid" data-mermaid-source="${escapeHtml(code)}">${escapeHtml(code)}</div>`);
      } else {
        html.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
      }
      continue;
    }
    if (trimmed.includes('|') && lines[index + 1] && isTableSeparator(lines[index + 1])) {
      flushList();
      const headers = splitTableRow(trimmed);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|')) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      html.push(`<div class="vpa-table-wrap"><table><thead><tr>${headers.map((cell) => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td>${renderInline(row[cellIndex] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (trimmed.startsWith('# ')) {
      flushList();
      html.push(`<h1>${renderInline(trimmed.slice(2))}</h1>`);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      flushList();
      html.push(`<h2>${renderInline(trimmed.slice(3))}</h2>`);
      continue;
    }
    if (trimmed.startsWith('### ')) {
      flushList();
      html.push(`<h3>${renderInline(trimmed.slice(4))}</h3>`);
      continue;
    }
    if (trimmed.startsWith('#### ')) {
      flushList();
      html.push(`<h4>${renderInline(trimmed.slice(5))}</h4>`);
      continue;
    }
    if (trimmed.startsWith('> ')) {
      flushList();
      html.push(`<blockquote>${renderInline(trimmed.slice(2))}</blockquote>`);
      continue;
    }
    const listMatch = line.match(/^(\s*)([-+*]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const indent = listMatch[1].replaceAll('\t', '  ').length;
      list.push({ depth: Math.floor(indent / 2), type: /\d+\./.test(listMatch[2]) ? 'ol' : 'ul', text: listMatch[3] });
      continue;
    }
    flushList();
    html.push(`<p>${renderInline(trimmed)}</p>`);
  }
  flushList();
  return html.join('');
}

async function ensureMermaid() {
  const mermaidConfig = VPA_STATE.config?.mermaid || {};
  if (mermaidConfig.enabled === false) return null;
  if (window.mermaid) return window.mermaid;
  if (!mermaidConfig.src) return null;
  if (!VPA_STATE.mermaidPromise) {
    VPA_STATE.mermaidPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = resolveAnnotationUrl(mermaidConfig.src);
      script.onload = () => resolve(window.mermaid || null);
      script.onerror = () => reject(new Error(`Failed to load Mermaid: ${script.src}`));
      document.head.appendChild(script);
    });
  }
  return VPA_STATE.mermaidPromise;
}

async function renderMermaidIn(root) {
  const nodes = Array.from(root.querySelectorAll('.vpa-mermaid:not([data-rendered])'));
  if (!nodes.length) return;
  const mermaid = await ensureMermaid();
  if (!mermaid) {
    nodes.forEach((node) => {
      node.classList.add('vpa-mermaid-source');
      node.dataset.rendered = 'source';
    });
    return;
  }
  mermaid.initialize({ ...(VPA_STATE.config?.mermaid?.options || {}), startOnLoad: false, securityLevel: 'strict' });
  await Promise.all(nodes.map(async (node, index) => {
    const source = node.getAttribute('data-mermaid-source') || node.textContent || '';
    try {
      const id = `vpa-mermaid-${Date.now()}-${index}`;
      const result = await mermaid.render(id, source);
      node.innerHTML = result.svg;
      node.dataset.rendered = 'svg';
    } catch (error) {
      node.classList.add('vpa-mermaid-error');
      node.textContent = source;
      node.dataset.rendered = 'error';
    }
  }));
}

function annotationSourceMarkdown(markdown) {
  return String(markdown || '').split('\n').find((line) => /^\s*>\s*来源[:：]/.test(line)) || '';
}

function annotationDetailMarkdown(markdown) {
  let titleRemoved = false;
  return String(markdown || '').split('\n').filter((line) => {
    const trimmed = line.trim();
    if (!titleRemoved && /^##\s+需求描述[:：]/.test(trimmed)) {
      titleRemoved = true;
      return false;
    }
    return !/^>\s*来源[:：]/.test(trimmed);
  }).join('\n').replace(/^\s+|\s+$/g, '');
}

function setPopupContent(container, annotation) {
  const wasOpen = Boolean(container.querySelector('.vpa-popup-details.is-open'));
  const previousTab = container.querySelector('.vpa-popup-details')?.dataset.detailTab || 'all';
  const markdown = getAnnotationMarkdown(annotation);
  const source = annotationSourceMarkdown(markdown);
  container.innerHTML = '';

  if (source) {
    const sourceContainer = document.createElement('div');
    sourceContainer.className = 'vpa-popup-source';
    setMarkdownContent(sourceContainer, source);
    container.appendChild(sourceContainer);
  }

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'vpa-popup-expand';
  toggle.setAttribute('aria-expanded', wasOpen ? 'true' : 'false');
  container.appendChild(toggle);

  const details = document.createElement('div');
  details.className = 'vpa-popup-details' + (wasOpen ? ' is-open' : '');
  container.appendChild(details);

  const syncDetails = (open) => {
    details.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.innerHTML = (open ? '收起详细说明' : '展开详细说明 (' + annotationDetailCount(annotation) + '项)') + ' <span aria-hidden="true">' + (open ? '⌃' : '⌄') + '</span>';
    if (open) setTabbedMarkdownContent(details, markdown, previousTab);
    else details.innerHTML = '';
  };
  toggle.addEventListener('click', (event) => {
    stop(event);
    syncDetails(!details.classList.contains('is-open'));
  });
  syncDetails(wasOpen);
}

function setMarkdownContent(container, markdown) {
  container.innerHTML = `<div class="vpa-markdown">${renderMarkdown(markdown)}</div>`;
  renderMermaidIn(container).catch((error) => console.error('[vitamin-prototype-annotation]', error));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractMarkdownBlock(markdown, blockId) {
  const id = escapeRegExp(blockId);
  const startEndPattern = new RegExp(`<!--\\s*anno:start\\s+id=["']?${id}["']?[^>]*-->([\\s\\S]*?)<!--\\s*anno:end\\s+id=["']?${id}["']?\\s*-->`, 'i');
  const startEndMatch = markdown.match(startEndPattern);
  if (startEndMatch) return startEndMatch[1].trim();

  const lines = String(markdown || '').split('\n');
  const output = [];
  let collecting = false;
  for (const line of lines) {
    const isAnyMarker = /<!--\s*anno:(id|start)\s*=/i.test(line) || /<!--\s*anno:(id|start)\s+/i.test(line);
    const isTargetMarker = new RegExp(`<!--\\s*anno:(id|start)(\\s+|=)[^>]*${id}`, 'i').test(line);
    if (isTargetMarker) {
      collecting = true;
      continue;
    }
    if (collecting && isAnyMarker) break;
    if (collecting && !/<!--\s*anno:end/i.test(line)) output.push(line);
  }
  return output.join('\n').trim();
}

function resolveAnnotationUrl(path) {
  return new URL(path, VPA_STATE.configBaseUrl).href;
}

async function hydrateMarkdownAnnotations() {
  VPA_STATE.markdownFiles.clear();
  const annotations = VPA_STATE.config.annotations || [];
  const files = [...new Set(annotations.map((item) => item.markdownFile).filter(Boolean))];

  await Promise.all(files.map(async (file) => {
    const url = resolveAnnotationUrl(file);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Failed to load annotation markdown: ${url}`);
    VPA_STATE.markdownFiles.set(file, await response.text());
  }));

  for (const annotation of annotations) {
    if (!annotation.markdownFile) continue;
    const markdown = VPA_STATE.markdownFiles.get(annotation.markdownFile) || '';
    annotation.markdown = extractMarkdownBlock(markdown, annotation.blockId || annotation.id) || annotation.markdown || '';
  }
}

function getAnnotationMarkdown(annotation) {
  return annotation.markdown || '';
}

function sortedAnnotations() {
  return [...(VPA_STATE.config.annotations || [])].sort((left, right) => {
    const pageCompare = String(left.page || '').localeCompare(String(right.page || ''));
    if (pageCompare) return pageCompare;
    const orderCompare = Number(left.order ?? 999999) - Number(right.order ?? 999999);
    if (orderCompare) return orderCompare;
    return String(left.id).localeCompare(String(right.id), undefined, { numeric: true });
  });
}

function currentPageMatches(annotation) {
  if (!annotation.page || annotation.page === '*') return true;
  const routes = currentRouteCandidates();
  if (annotation.routeMatcher) {
    try {
      const matcher = new RegExp(annotation.routeMatcher);
      if (routes.some((route) => matcher.test(route))) return true;
    } catch (error) {
      console.warn(`[vitamin-prototype-annotation] Invalid routeMatcher for ${annotation.id}`);
    }
  }
  if (annotation.page.startsWith('#')) {
    const rawHash = location.hash || '#/';
    const currentHash = rawHash.split('?')[0].replace(/\/$/, '') || '#/';
    const targetHash = annotation.page.split('?')[0].replace(/\/$/, '') || '#/';
    if (currentHash === targetHash) return true;
    if (rawHash === annotation.page) return true;
  }
  return routes.some((route) => route === annotation.page);
}

function findTarget(annotation) {
  const selectors = [
    annotation.target?.selector,
    ...(annotation.target?.fallbackSelectors || []),
  ].filter(Boolean);
  for (const selector of selectors) {
    try {
      const element = document.querySelector(selector);
      if (element) return element;
    } catch (error) {
      console.warn(`[vitamin-prototype-annotation] Invalid selector for ${annotation.id}: ${selector}`);
    }
  }
  return null;
}

function isVisibleTarget(target, rect) {
  if (!target.isConnected || !rect.width || !rect.height) return false;
  if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight) return false;
  const style = window.getComputedStyle(target);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function ensureRoot() {
  let root = document.querySelector('.vpa-root');
  if (!root) {
    root = document.createElement('div');
    root.className = 'vpa-root';
    document.body.appendChild(root);
  }
  applyRuntimeStyle(root);
  return root;
}

function showToast(message) {
  let toast = document.querySelector('.vpa-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'vpa-toast';
    document.body.appendChild(toast);
  }
  applyRuntimeStyle(toast);
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(toast._timer);
  toast._timer = window.setTimeout(() => toast.classList.remove('show'), 1800);
}

function measureBadges() {
  const root = ensureRoot();
  const visibleIds = new Set();
  if (VPA_STATE.mode === 'preview') {
    VPA_STATE.badges.forEach((badge) => badge.remove());
    VPA_STATE.badges.clear();
    return;
  }

  const placedPositions = [];

  for (const annotation of sortedAnnotations()) {
    if (!currentPageMatches(annotation)) continue;
    const isPageGlobal = annotation.type === 'page-global' || (!annotation.target?.selector && !annotation.target?.fallbackSelectors?.length);
    let target = null;
    let rect = null;

    if (isPageGlobal) {
      // 页面级块：徽章定位到页面顶部，不挂筛选区
      const headerTarget = document.querySelector('[data-anno="page-header"]') ||
                           document.querySelector('header') ||
                           document.querySelector('main') ||
                           document.body;
      const hRect = headerTarget ? headerTarget.getBoundingClientRect() : { top: 16, left: 16, right: 300, width: 24, height: 24 };
      rect = {
        top: Math.max(16, hRect.top),
        right: Math.max(64, hRect.left + 24),
        left: hRect.left,
        bottom: hRect.top + 24,
        width: 24,
        height: 24,
      };
    } else {
      target = findTarget(annotation);
      if (!target) continue;
      rect = target.getBoundingClientRect();
      if (!isVisibleTarget(target, rect)) continue;
    }

    const key = annotationKey(annotation);
    visibleIds.add(key);
    let badge = VPA_STATE.badges.get(key);
    if (!badge) {
      badge = document.createElement('button');
      badge.className = 'vpa-badge';
      badge.type = 'button';
      badge.addEventListener('click', (event) => {
        stop(event);
        locateAnnotation(badge._annotation);
        openPopup(badge._annotation);
      });
      root.appendChild(badge);
      VPA_STATE.badges.set(key, badge);
    }
    badge._annotation = annotation;
    badge.textContent = annotation.id;

    let left = Math.min(window.innerWidth - 28, Math.max(4, rect.right + 4));
    let top = Math.min(window.innerHeight - 20, Math.max(4, rect.top - 8));

    for (const pos of placedPositions) {
      if (Math.abs(pos.left - left) < 22 && Math.abs(pos.top - top) < 22) {
        left = Math.max(4, left - 26);
      }
    }
    placedPositions.push({ left, top });

    badge.style.left = `${left}px`;
    badge.style.top = `${top}px`;
  }

  VPA_STATE.badges.forEach((badge, id) => {
    if (!visibleIds.has(id)) {
      badge.remove();
      VPA_STATE.badges.delete(id);
    }
  });
}

function scheduleMeasure() {
  if (VPA_STATE.measureScheduled) return;
  VPA_STATE.measureScheduled = true;
  window.requestAnimationFrame(() => {
    VPA_STATE.measureScheduled = false;
    measureBadges();
    // Scrolling the annotation panel must not rebuild its scroll containers.
    // Replacing .vpa-panel-list/.vpa-detail-tabs here resets scrollTop/scrollLeft.
  });
}

function makeDraggable(element, handle) {
  handle.addEventListener('mousedown', (event) => {
    stop(event);
    const rect = element.getBoundingClientRect();
    element.style.right = 'auto';
    element.style.bottom = 'auto';
    element.style.left = `${rect.left}px`;
    element.style.top = `${rect.top}px`;
    const start = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    function move(moveEvent) {
      element.style.left = `${Math.max(8, Math.min(window.innerWidth - rect.width - 8, start.left + moveEvent.clientX - start.x))}px`;
      element.style.top = `${Math.max(8, Math.min(window.innerHeight - rect.height - 8, start.top + moveEvent.clientY - start.y))}px`;
    }
    function up() {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

function makeResizable(element) {
  ['left', 'right', 'bottom', 'bottom-left', 'bottom-right'].forEach((direction) => {
    const handle = document.createElement('span');
    handle.className = `vpa-resize vpa-resize-${direction}`;
    handle.addEventListener('mousedown', (event) => {
      stop(event);
      const rect = element.getBoundingClientRect();
      const start = { x: event.clientX, y: event.clientY, left: rect.left, width: rect.width, height: rect.height };
      function move(moveEvent) {
        const dx = moveEvent.clientX - start.x;
        const dy = moveEvent.clientY - start.y;
        let left = start.left;
        let width = start.width;
        let height = start.height;
        if (direction.includes('right')) width = start.width + dx;
        if (direction.includes('left')) {
          width = start.width - dx;
          left = start.left + dx;
        }
        if (direction.includes('bottom')) height = start.height + dy;
        element.style.left = `${Math.max(8, left)}px`;
        element.style.width = `${Math.max(360, Math.min(window.innerWidth - 16, width))}px`;
        element.style.height = `${Math.max(260, Math.min(window.innerHeight - 16, height))}px`;
      }
      function up() {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      }
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    element.appendChild(handle);
  });
}

async function openPopup(annotation) {
  const key = annotationKey(annotation);
  if (VPA_STATE.openPopups.has(key)) return;
  if (annotation.markdownFile) {
    await hydrateMarkdownAnnotations();
  }
  const popup = document.createElement('section');
  popup.className = 'vpa-popup';
  popup.dataset.annotationKey = key;
  const badgeRect = VPA_STATE.badges.get(key)?.getBoundingClientRect();
  const preferredLeft = badgeRect ? badgeRect.left - 450 - 8 : window.innerWidth - 500;
  const preferredTop = badgeRect ? badgeRect.bottom + 8 : 72;
  popup.style.left = `${Math.max(8, Math.min(window.innerWidth - 458, preferredLeft))}px`;
  popup.style.top = `${Math.max(8, Math.min(window.innerHeight - 568, preferredTop))}px`;
  popup.style.width = '450px';
  popup.style.height = '560px';
  applyRuntimeStyle(popup);
  popup.addEventListener('click', (event) => event.stopPropagation());
  popup.addEventListener('mousedown', (event) => event.stopPropagation());

  const header = document.createElement('header');
  header.className = 'vpa-popup-header';
  header.innerHTML = `<span class="vpa-badge-static">${escapeHtml(annotation.id)}</span><strong>需求描述：【${escapeHtml(annotation.moduleName || annotation.title || annotation.id)}】</strong><button type="button" class="vpa-close">X</button>`;
  popup.appendChild(header);

  const body = document.createElement('div');
  body.className = 'vpa-popup-body';
  setPopupContent(body, annotation);
  popup.appendChild(body);

  header.querySelector('.vpa-close').addEventListener('click', (event) => {
    stop(event);
    popup.remove();
    VPA_STATE.openPopups.delete(key);
  });
  makeDraggable(popup, header);
  makeResizable(popup);
  document.body.appendChild(popup);
  VPA_STATE.openPopups.set(key, popup);
}

function exportAll() {
  const chunks = [`# ${VPA_STATE.config.title || 'Prototype Annotations'}`];
  for (const annotation of sortedAnnotations()) {
    chunks.push(`\n\n## [${annotationExportId(annotation)}] ${annotation.moduleName || annotation.title || ''}\n\n${getAnnotationMarkdown(annotation)}`);
  }
  const blob = new Blob([chunks.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'prototype-annotations.md';
  link.click();
  URL.revokeObjectURL(url);
}

function allAnnotationsMarkdown() {
  return sortedAnnotations().map((annotation) => `## [${annotationExportId(annotation)}] ${annotation.moduleName || annotation.title || ''}\n\n${getAnnotationMarkdown(annotation)}`).join('\n\n');
}

function openAllAnnotations() {
  if (VPA_STATE.openPopups.has(ALL_POPUP_KEY)) return;
  const popup = document.createElement('section');
  popup.className = 'vpa-popup vpa-all-popup';
  popup.style.left = `${Math.max(8, window.innerWidth - 730)}px`;
  popup.style.top = '56px';
  popup.style.width = '700px';
  popup.style.height = `${Math.min(720, window.innerHeight - 72)}px`;
  applyRuntimeStyle(popup);
  popup.addEventListener('click', (event) => event.stopPropagation());
  popup.addEventListener('mousedown', (event) => event.stopPropagation());

  const header = document.createElement('header');
  header.className = 'vpa-popup-header';
  header.innerHTML = '<strong>查看所有标注</strong><button type="button" class="vpa-download">下载 Markdown</button><button type="button" class="vpa-close">X</button>';
  popup.appendChild(header);

  const body = document.createElement('div');
  body.className = 'vpa-popup-body';
  setMarkdownContent(body, allAnnotationsMarkdown());
  popup.appendChild(body);

  header.querySelector('.vpa-download').addEventListener('click', (event) => {
    stop(event);
    exportAll();
  });
  header.querySelector('.vpa-close').addEventListener('click', (event) => {
    stop(event);
    popup.remove();
    VPA_STATE.openPopups.delete(ALL_POPUP_KEY);
  });
  makeDraggable(popup, header);
  makeResizable(popup);
  document.body.appendChild(popup);
  VPA_STATE.openPopups.set(ALL_POPUP_KEY, popup);
}

function refreshOpenPopups() {
  const annotationsByKey = new Map((VPA_STATE.config.annotations || []).map((annotation) => [annotationKey(annotation), annotation]));
  for (const [key, popup] of VPA_STATE.openPopups.entries()) {
    if (key === ALL_POPUP_KEY) {
      const allBody = popup.querySelector('.vpa-popup-body');
      if (allBody) setMarkdownContent(allBody, allAnnotationsMarkdown());
      continue;
    }
    const annotation = annotationsByKey.get(key);
    if (!annotation) {
      popup.remove();
      VPA_STATE.openPopups.delete(key);
      continue;
    }
    const title = popup.querySelector('.vpa-popup-header strong');
    const badge = popup.querySelector('.vpa-badge-static');
    const body = popup.querySelector('.vpa-popup-body');
    if (title) title.textContent = `需求描述：【${annotation.moduleName || annotation.title || annotation.id}】`;
    if (badge) badge.textContent = annotation.id;
    if (body) setPopupContent(body, annotation);
  }
}

function closeAnnotationPanel() {
  VPA_STATE.panelOpen = false;
  const panel = document.querySelector('.vpa-panel');
  if (panel) panel.remove();
  syncAnnotationControls();
}

function closeAnnotationPopups() {
  VPA_STATE.openPopups.forEach((popup) => popup.remove());
  VPA_STATE.openPopups.clear();
  document.querySelectorAll('.vpa-target-highlight').forEach((element) => element.classList.remove('vpa-target-highlight'));
}

function highlightTarget(target) {
  if (!target) return;
  document.querySelectorAll('.vpa-target-highlight').forEach((element) => element.classList.remove('vpa-target-highlight'));
  target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  target.classList.add('vpa-target-highlight');
  window.clearTimeout(VPA_STATE.highlightTimer);
  VPA_STATE.highlightTimer = window.setTimeout(() => target.classList.remove('vpa-target-highlight'), 1800);
}

function locateAnnotation(annotation) {
  if (annotation.type === 'page-global' || (!annotation.target?.selector && !annotation.target?.fallbackSelectors?.length)) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const target = findTarget(annotation);
  if (!target) {
    showToast('当前页面未找到对应区域');
    return;
  }
  highlightTarget(target);
}

function renderPanelCards(panel) {
  const list = panel.querySelector('.vpa-panel-list');
  if (!list) return;
  const annotations = currentPageAnnotations();
  const filtered = annotations.filter((annotation) => VPA_STATE.panelType === 'all' || annotationType(annotation) === VPA_STATE.panelType);
  if (!filtered.length) {
    list.innerHTML = '<div class="vpa-panel-empty">当前分类暂无标注</div>';
    return;
  }
  list.innerHTML = filtered.map((annotation, index) => {
    const key = annotationKey(annotation);
    const expanded = VPA_STATE.expandedCards.has(key);
    return `<article class="vpa-card${expanded ? ' is-expanded' : ''}" data-annotation-key="${escapeHtml(key)}">
      <button type="button" class="vpa-card-main" data-vpa-locate aria-label="定位到${escapeHtml(annotation.moduleName || annotation.id)}">
        <span class="vpa-card-number">${escapeHtml(annotation.id || index + 1)}</span>
        <span class="vpa-card-copy">
          <span class="vpa-card-heading"><strong>${escapeHtml(annotation.moduleName || annotation.title || annotation.id)}</strong><span class="vpa-type-tag vpa-type-${escapeHtml(annotationType(annotation))}">${escapeHtml(annotationTypeLabel(annotation))}</span></span>
          <span class="vpa-card-summary">${escapeHtml(annotationSummary(annotation))}</span>
        </span>
        <span class="vpa-card-chevron" aria-hidden="true">›</span>
      </button>
      <button type="button" class="vpa-card-expand" data-vpa-expand aria-expanded="${expanded ? 'true' : 'false'}">${expanded ? '收起详细说明' : `展开详细说明 (${annotationDetailCount(annotation)} 项)`}</button>
      <div class="vpa-card-details${expanded ? ' is-open' : ''}"></div>
    </article>`;
  }).join('');

  filtered.forEach((annotation) => {
    const card = list.querySelector(`[data-annotation-key="${CSS.escape(annotationKey(annotation))}"]`);
    if (!card || !VPA_STATE.expandedCards.has(annotationKey(annotation))) return;
    setTabbedMarkdownContent(card.querySelector('.vpa-card-details'), getAnnotationMarkdown(annotation));
  });
}

function renderAnnotationPanel() {
  let panel = document.querySelector('.vpa-panel');
  if (!VPA_STATE.panelOpen) {
    if (panel) panel.remove();
    return;
  }
  if (!panel) {
    panel = document.createElement('aside');
    panel.className = 'vpa-panel';
    panel.addEventListener('click', (event) => event.stopPropagation());
    panel.addEventListener('mousedown', (event) => event.stopPropagation());
    document.body.appendChild(panel);
  }
  applyRuntimeStyle(panel);
  const annotations = currentPageAnnotations();
  const panelCount = VPA_STATE.panelType === 'pending' ? VPA_STATE.pendingIssues.length : annotations.length;
  panel.innerHTML = `<div class="vpa-panel-header">
    <div class="vpa-panel-title-row"><div><div class="vpa-panel-title">原型标注 <span class="vpa-panel-count">${panelCount}</span></div><div class="vpa-panel-subtitle">${VPA_STATE.panelType === 'pending' ? '记录并跟进评审中发现的问题' : '点击条目定位页面中的对应区域'}</div></div><div class="vpa-panel-actions">${VPA_STATE.panelType === 'pending' ? '<button type="button" class="vpa-export-pending" data-vpa-export-pending>导出待办</button>' : ''}<button type="button" class="vpa-panel-close" data-vpa-close aria-label="关闭原型标注">×</button></div></div>
    <div class="vpa-panel-tabs" role="tablist" aria-label="标注分类">${Object.entries(VPA_TYPE_META).map(([type, meta]) => {
      const count = type === 'all' ? annotations.length : type === 'pending' ? VPA_STATE.pendingIssues.length : annotations.filter((annotation) => annotationType(annotation) === type).length;
      return `<button type="button" role="tab" class="vpa-panel-tab${VPA_STATE.panelType === type ? ' is-active' : ''}" data-vpa-type="${type}" aria-selected="${VPA_STATE.panelType === type ? 'true' : 'false'}">${meta.label}<span>${count}</span></button>`;
    }).join('')}</div>
  </div><div class="vpa-panel-list"></div>`;
  if (VPA_STATE.panelType === 'pending') {
    renderPendingIssueTracker(panel.querySelector('.vpa-panel-list'), {
      global: true,
      onFilterChange: () => renderAnnotationPanel(),
    });
  } else {
    renderPanelCards(panel);
  }
  panel.querySelector('[data-vpa-close]').addEventListener('click', (event) => {
    stop(event);
    closeAnnotationPanel();
  });
  panel.querySelector('[data-vpa-export-pending]')?.addEventListener('click', (event) => {
    stop(event);
    exportPendingIssues().catch(() => showToast('待办导出失败'));
  });
  panel.querySelectorAll('[data-vpa-type]').forEach((tab) => {
    tab.addEventListener('click', (event) => {
      stop(event);
      VPA_STATE.panelType = tab.dataset.vpaType || 'all';
      renderAnnotationPanel();
    });
  });
  panel.querySelectorAll('[data-vpa-locate]').forEach((button) => {
    button.addEventListener('click', (event) => {
      stop(event);
      const card = button.closest('[data-annotation-key]');
      const annotation = annotations.find((item) => annotationKey(item) === card?.dataset.annotationKey);
      if (annotation) locateAnnotation(annotation);
    });
  });
  panel.querySelectorAll('[data-vpa-expand]').forEach((button) => {
    button.addEventListener('click', (event) => {
      stop(event);
      const card = button.closest('[data-annotation-key]');
      const key = card?.dataset.annotationKey;
      const annotation = annotations.find((item) => annotationKey(item) === key);
      if (!card || !annotation) return;
      if (VPA_STATE.expandedCards.has(key)) VPA_STATE.expandedCards.delete(key);
      else VPA_STATE.expandedCards.add(key);
      renderAnnotationPanel();
    });
  });
}

function openAnnotationPanel() {
  VPA_STATE.panelOpen = true;
  renderAnnotationPanel();
  syncAnnotationControls();
}

async function reloadBundle() {
  VPA_STATE.config = await loadConfig();
  await hydrateMarkdownAnnotations();
  ensureRoot();
  refreshOpenPopups();
  measureBadges();
  renderAnnotationPanel();
  syncAnnotationControls();
}

function syncAnnotationControls() {
  const entry = document.querySelector('.vpa-entry');
  const panelToggle = document.querySelector('.vpa-panel-toggle');
  const isAnnotate = VPA_STATE.mode === 'annotate';
  const isPanelOpen = VPA_STATE.panelOpen;
  document.body.classList.toggle('vpa-mode-annotate', isAnnotate);
  if (entry) {
    entry.classList.toggle('is-active', isAnnotate);
    entry.setAttribute('aria-label', isAnnotate ? '关闭原型标注' : '打开原型标注');
    entry.setAttribute('aria-pressed', isAnnotate ? 'true' : 'false');
  }
  if (panelToggle) {
    panelToggle.classList.toggle('is-active', isPanelOpen);
    panelToggle.classList.add('is-visible');
    panelToggle.setAttribute('aria-label', isPanelOpen ? '关闭标注清单' : '打开标注清单');
    panelToggle.setAttribute('aria-hidden', 'false');
    panelToggle.setAttribute('aria-pressed', isPanelOpen ? 'true' : 'false');
  }
}

function makeFloatingEntriesDraggable(container) {
  let drag = null;
  try {
    const stored = JSON.parse(sessionStorage.getItem(VPA_FLOATING_POSITION_KEY) || 'null');
    if (stored && Number.isFinite(stored.left) && Number.isFinite(stored.top)) {
      container.style.left = stored.left + 'px';
      container.style.top = stored.top + 'px';
      container.style.right = 'auto';
      container.style.bottom = 'auto';
    }
  } catch (error) {
    // sessionStorage is optional; the buttons remain draggable for this page session.
  }

  const clampPosition = (left, top) => ({
    left: Math.max(8, Math.min(window.innerWidth - container.offsetWidth - 8, left)),
    top: Math.max(8, Math.min(window.innerHeight - container.offsetHeight - 8, top)),
  });

  const finishDrag = () => {
    if (!drag) return;
    container.classList.remove('is-dragging');
    if (drag.moved) {
      container.dataset.suppressClick = 'true';
      try {
        sessionStorage.setItem(VPA_FLOATING_POSITION_KEY, JSON.stringify({
          left: parseFloat(container.style.left),
          top: parseFloat(container.style.top),
        }));
      } catch (error) {
        // Keep the current position when sessionStorage is unavailable.
      }
    }
    drag = null;
  };

  const beginDrag = (event, kind) => {
    if (event.button !== undefined && event.button !== 0) return;
    // Keep the native click target; window-level move/up listeners still let the
    // whole control move without pointer capture stealing button clicks.
    const rect = container.getBoundingClientRect();
    drag = {
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      moved: false,
    };
    container.classList.add('is-dragging');
  };
  const moveDrag = (event, kind) => {
    if (!drag || drag.kind !== kind || (kind === 'pointer' && event.pointerId !== drag.pointerId)) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    event.preventDefault();
    const position = clampPosition(drag.startLeft + dx, drag.startTop + dy);
    container.style.left = position.left + 'px';
    container.style.top = position.top + 'px';
    container.style.right = 'auto';
    container.style.bottom = 'auto';
  };
  container.addEventListener('pointerdown', (event) => beginDrag(event, 'pointer'));
  container.addEventListener('mousedown', (event) => {
    if (!drag) beginDrag(event, 'mouse');
  });
  window.addEventListener('pointermove', (event) => moveDrag(event, 'pointer'), { passive: false });
  window.addEventListener('pointerup', finishDrag);
  window.addEventListener('pointercancel', finishDrag);
  window.addEventListener('mousemove', (event) => moveDrag(event, 'mouse'), { passive: false });
  window.addEventListener('mouseup', finishDrag);
}

function renderToolbar() {
  const existingFloating = document.querySelector('.vpa-floating-entries');
  if (existingFloating) existingFloating.remove();
  const existing = document.querySelector('.vpa-entry');
  if (existing) existing.remove();
  const existingPanelToggle = document.querySelector('.vpa-panel-toggle');
  if (existingPanelToggle) existingPanelToggle.remove();
  const entry = document.createElement('button');
  entry.type = 'button';
  entry.className = 'vpa-entry';
  entry.setAttribute('aria-label', '打开原型标注');
  entry.setAttribute('aria-pressed', 'false');
  entry.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 3.75h8.5L19 8.25v12H6z"/><path d="M14.5 3.75v4.5H19M9 12h6M9 15.5h6"/></svg><span>原型标注</span>';
  entry.addEventListener('click', (event) => {
    if (entry.parentElement?.dataset.suppressClick === 'true') {
      delete entry.parentElement.dataset.suppressClick;
      stop(event);
      return;
    }
    stop(event);
    VPA_STATE.mode = VPA_STATE.mode === 'annotate' ? 'preview' : 'annotate';
    if (VPA_STATE.mode === 'preview') {
      closeAnnotationPanel();
      closeAnnotationPopups();
    }
    syncAnnotationControls();
    measureBadges();
    showToast(VPA_STATE.mode === 'annotate' ? '已显示标注区域序号' : '已隐藏标注区域序号');
  });
  const panelToggle = document.createElement('button');
  panelToggle.type = 'button';
  panelToggle.className = 'vpa-panel-toggle';
  panelToggle.setAttribute('aria-label', '打开标注清单');
  panelToggle.setAttribute('aria-hidden', 'true');
  panelToggle.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 5.5h14v13H5z"/><path d="M8.5 9h7M8.5 12h7M8.5 15h4"/></svg><span>标注清单</span>';
  panelToggle.addEventListener('click', (event) => {
    if (panelToggle.parentElement?.dataset.suppressClick === 'true') {
      delete panelToggle.parentElement.dataset.suppressClick;
      stop(event);
      return;
    }
    stop(event);
    if (VPA_STATE.panelOpen) closeAnnotationPanel();
    else openAnnotationPanel();
  });
  const floating = document.createElement('div');
  floating.className = 'vpa-floating-entries';
  floating.appendChild(panelToggle);
  floating.appendChild(entry);
  applyRuntimeStyle(floating);
  document.body.appendChild(floating);
  makeFloatingEntriesDraggable(floating);
  syncAnnotationControls();
}

async function loadConfig() {
  if (window.__VITAMIN_ANNOTATION_CONFIG__) {
    VPA_STATE.configBaseUrl = location.href;
    return window.__VITAMIN_ANNOTATION_CONFIG__;
  }
  const scriptUrl = import.meta.url;
  const bundleUrl = new URL('./annotation.bundle.json', scriptUrl).href;
  const bundleResponse = await fetch(bundleUrl, { cache: 'no-store' });
  if (bundleResponse.ok) {
    VPA_STATE.configBaseUrl = bundleUrl;
    return bundleResponse.json();
  }
  const configUrl = new URL('./annotation.config.json', scriptUrl).href;
  VPA_STATE.configBaseUrl = configUrl;
  const response = await fetch(configUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to load annotation config: ${configUrl}`);
  return response.json();
}

async function boot() {
  try {
    VPA_STATE.config = await loadConfig();
    VPA_STATE.mode = initialAnnotationMode(VPA_STATE.config);
    await hydrateMarkdownAnnotations();
    ensureRoot();
    renderToolbar();
    measureBadges();
    window.addEventListener('resize', scheduleMeasure);
    window.addEventListener('scroll', scheduleMeasure, true);
    window.addEventListener('hashchange', scheduleMeasure);
    window.addEventListener('popstate', scheduleMeasure);
    new MutationObserver((mutations) => {
      const hasBusinessMutation = mutations.some((mutation) => {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        return target && !target.closest('.vpa-root, .vpa-popup, .vpa-toolbar, .vpa-panel, .vpa-floating-entries, .vpa-entry, .vpa-toast');
      });
      if (hasBusinessMutation) scheduleMeasure();
    }).observe(document.body, { childList: true, subtree: true, attributes: true });
  } catch (error) {
    console.error('[vitamin-prototype-annotation]', error);
  }
}

boot();
