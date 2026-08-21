const VPA_STATE = {
  config: null,
  configBaseUrl: location.href,
  mode: 'preview',
  badges: new Map(),
  openPopups: new Map(),
  markdownFiles: new Map(),
  mermaidPromise: null,
  toolbarPos: { x: window.innerWidth - 220, y: window.innerHeight - 54 },
  measureScheduled: false,
};

const ALL_POPUP_KEY = '__vpa_all__';

function stop(event) {
  event.preventDefault();
  event.stopPropagation();
}

function annotationKey(annotation) {
  return String(annotation.key || annotation.id);
}

function annotationExportId(annotation) {
  return annotation.scope ? annotationKey(annotation) : String(annotation.id);
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
        const content = task
          ? `<input type="checkbox" disabled${task[1].toLowerCase() === 'x' ? ' checked' : ''}> ${renderInline(task[2])}`
          : renderInline(item.text);
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
      return routes.some((route) => matcher.test(route));
    } catch (error) {
      console.warn(`[vitamin-prototype-annotation] Invalid routeMatcher for ${annotation.id}`);
    }
  }
  if (annotation.page.startsWith('#')) return location.hash === annotation.page;
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

  for (const annotation of sortedAnnotations()) {
    if (!currentPageMatches(annotation)) continue;
    const target = findTarget(annotation);
    if (!target) continue;
    const rect = target.getBoundingClientRect();
    if (!isVisibleTarget(target, rect)) continue;
    const key = annotationKey(annotation);
    visibleIds.add(key);
    let badge = VPA_STATE.badges.get(key);
    if (!badge) {
      badge = document.createElement('button');
      badge.className = 'vpa-badge';
      badge.type = 'button';
      badge.addEventListener('click', (event) => {
        stop(event);
        openPopup(badge._annotation);
      });
      root.appendChild(badge);
      VPA_STATE.badges.set(key, badge);
    }
    badge._annotation = annotation;
    badge.textContent = annotation.id;
    badge.style.left = `${Math.min(window.innerWidth - 28, Math.max(4, rect.right - 4))}px`;
    badge.style.top = `${Math.min(window.innerHeight - 20, Math.max(4, rect.top - 8))}px`;
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
  setMarkdownContent(body, getAnnotationMarkdown(annotation));
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
    if (body) setMarkdownContent(body, getAnnotationMarkdown(annotation));
  }
}

async function reloadBundle() {
  VPA_STATE.config = await loadConfig();
  await hydrateMarkdownAnnotations();
  ensureRoot();
  refreshOpenPopups();
  measureBadges();
}

function renderToolbar() {
  let toolbar = document.querySelector('.vpa-toolbar');
  if (toolbar) toolbar.remove();
  toolbar = document.createElement('div');
  toolbar.className = 'vpa-toolbar';
  toolbar.style.left = `${VPA_STATE.toolbarPos.x}px`;
  toolbar.style.top = `${VPA_STATE.toolbarPos.y}px`;
  toolbar.innerHTML = '<button type="button" class="vpa-drag">⋮⋮</button><button type="button" data-mode="preview">预览</button><button type="button" data-mode="annotate">标注</button><button type="button" data-refresh>刷新</button><button type="button" data-view-all>查看全部</button>';
  toolbar.addEventListener('click', (event) => event.stopPropagation());
  applyRuntimeStyle(toolbar);
  toolbar.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', (event) => {
      stop(event);
      VPA_STATE.mode = button.dataset.mode;
      toolbar.querySelectorAll('[data-mode]').forEach((item) => item.classList.toggle('active', item.dataset.mode === VPA_STATE.mode));
      measureBadges();
      showToast(VPA_STATE.mode === 'preview' ? '已切换到预览模式' : '已切换到查看标注模式');
    });
  });
  toolbar.querySelector('[data-view-all]').addEventListener('click', (event) => {
    stop(event);
    openAllAnnotations();
  });
  toolbar.querySelector('[data-refresh]').addEventListener('click', async (event) => {
    stop(event);
    try {
      await reloadBundle();
      showToast('已重新读取标注 Bundle');
    } catch (error) {
      showToast('标注 Bundle 读取失败');
      console.error('[vitamin-prototype-annotation]', error);
    }
  });
  makeDraggable(toolbar, toolbar.querySelector('.vpa-drag'));
  document.body.appendChild(toolbar);
  toolbar.style.left = 'auto';
  toolbar.style.top = 'auto';
  toolbar.style.right = '8px';
  toolbar.style.bottom = '8px';
  toolbar.querySelectorAll('[data-mode]').forEach((button) => button.classList.toggle('active', button.dataset.mode === VPA_STATE.mode));
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
        return target && !target.closest('.vpa-root, .vpa-popup, .vpa-toolbar, .vpa-toast');
      });
      if (hasBusinessMutation) scheduleMeasure();
    }).observe(document.body, { childList: true, subtree: true, attributes: true });
  } catch (error) {
    console.error('[vitamin-prototype-annotation]', error);
  }
}

boot();
