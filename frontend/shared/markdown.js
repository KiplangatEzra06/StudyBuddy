import { state } from './state.js';
import { $, escapeHtml } from './dom.js';
import { slugify } from './format.js';

export function cleanNoteBody(value) {
  let body = String(value || '')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\t/g, '\t')
    .replace(/\r\n?/g, '\n');
  const fenced = body.trim().match(/^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (fenced) body = fenced[1];
  return body.trim();
}

export function renderMarkdown(markdown) {
  const lines = cleanNoteBody(markdown).split('\n');
  const blocks = [];
  let paragraph = [];
  let list = [];
  let listType = '';
  let codeLines = [];
  let codeLanguage = '';
  let inCode = false;
  let tableRows = [];
  let quoteLines = [];
  let headingCounts = new Map();
  const inline = value => {
    const code = [];
    let output = escapeHtml(value).replace(/`([^`]+)`/g, (_, content) => {
      code.push(`<code>${content}</code>`);
      return `\u0000${code.length - 1}\u0000`;
    });
    output = output
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>')
      .replace(/~~(.+?)~~/g, '<del>$1</del>');
    return output.replace(/\u0000(\d+)\u0000/g, (_, index) => code[Number(index)] || '');
  };
  const flushParagraph = () => {
    if (paragraph.length) {
      const words = paragraph.join(' ').split(/\s+/);
      const chunks = [];
      let chunk = '';
      words.forEach(word => {
        if (chunk && chunk.length + word.length + 1 > 520) {
          chunks.push(chunk);
          chunk = '';
        }
        chunk += `${chunk ? ' ' : ''}${word}`;
      });
      if (chunk) chunks.push(chunk);
      chunks.forEach(text => blocks.push(`<p>${inline(text)}</p>`));
    }
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) {
      const tag = listType === 'ol' ? 'ol' : 'ul';
      blocks.push(`<${tag}>${list.map(item => `<li>${inline(item)}</li>`).join('')}</${tag}>`);
    }
    list = [];
    listType = '';
  };
  const flushQuote = () => {
    if (quoteLines.length) blocks.push(`<blockquote>${quoteLines.map(line => `<p>${inline(line)}</p>`).join('')}</blockquote>`);
    quoteLines = [];
  };
  const flushTable = () => {
    if (tableRows.length < 2) {
      tableRows.forEach(row => blocks.push(`<p>${inline(row)}</p>`));
      tableRows = [];
      return;
    }
    const cells = row => row.replace(/^\s*\|?|\|?\s*$/g, '').split('|').map(cell => cell.trim());
    const header = cells(tableRows[0]);
    const bodyRows = tableRows.slice(1).filter(row => !/^\s*\|?\s*:?-{3,}/.test(row)).map(cells);
    blocks.push(`<div class="markdown-table-wrap"><table><thead><tr>${header.map(cell => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${bodyRows.map(row => `<tr>${header.map((_, index) => `<td>${inline(row[index] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    tableRows = [];
  };
  const flushAll = () => { flushParagraph(); flushList(); flushQuote(); flushTable(); };
  lines.forEach(line => {
    const fence = line.trim().match(/^```([a-z0-9_+-]*)\s*$/i);
    if (fence) {
      flushAll();
      if (inCode) {
        const index = blocks.length;
        blocks.push(`<section class="markdown-code-block"><header class="markdown-code-header"><span>${escapeHtml(codeLanguage || 'Code')}</span><button type="button" data-copy-code="${index}">Copy code</button></header><pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre></section>`);
        codeLines = [];
        codeLanguage = '';
      } else {
        codeLanguage = fence[1];
      }
      inCode = !inCode;
      return;
    }
    if (inCode) {
      codeLines.push(line);
      return;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (line.includes('|') && /^\s*\|?.+\|.+/.test(line)) {
      flushParagraph(); flushList(); flushQuote();
      tableRows.push(line);
    } else {
      flushTable();
      if (!line.trim()) {
        flushParagraph(); flushList(); flushQuote();
      } else if (heading) {
        flushAll();
        const level = heading[1].length;
        const title = heading[2].trim();
        const slug = slugify(title);
        const count = headingCounts.get(slug) || 0;
        headingCounts.set(slug, count + 1);
        blocks.push(`<h${level} id="${escapeHtml(count ? `${slug}-${count + 1}` : slug)}">${inline(title)}</h${level}>`);
      } else if (/^\s*>\s?/.test(line)) {
        flushParagraph(); flushList();
        quoteLines.push(line.replace(/^\s*>\s?/, '').trim());
      } else if (bullet || ordered) {
        flushParagraph(); flushQuote();
        const nextType = ordered ? 'ol' : 'ul';
        if (listType && listType !== nextType) flushList();
        listType = nextType;
        list.push((bullet || ordered)[1]);
      } else {
        flushList(); flushQuote();
        paragraph.push(line.trim());
      }
    }
  });
  if (inCode) {
    const index = blocks.length;
    blocks.push(`<section class="markdown-code-block"><header class="markdown-code-header"><span>${escapeHtml(codeLanguage || 'Code')}</span><button type="button" data-copy-code="${index}">Copy code</button></header><pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre></section>`);
  }
  flushAll();
  return blocks.join('');
}

export function normalizeTutorReply(value) {
  return String(value || '')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\t/g, '\t')
    .replace(/\r\n?/g, '\n')
    .trim();
}

export function renderMathInElementSafe(container) {
  if (typeof window.renderMathInElement !== 'function') return;
  window.renderMathInElement(container, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false },
      { left: '$', right: '$', display: false }
    ],
    throwOnError: false,
    ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
  });
}

export function bindMarkdownCodeButtons(container, { truncateLongCode = true } = {}) {
  container.querySelectorAll('[data-copy-code]').forEach(button => button.addEventListener('click', async () => {
    const codeElement = button.closest('.markdown-code-block').querySelector('code');
    const code = codeElement.dataset.fullCode ?? codeElement.textContent;
    try {
      await navigator.clipboard.writeText(code);
      button.textContent = 'Copied';
      button.setAttribute('aria-label', 'Code copied to clipboard');
    } catch {
      button.textContent = 'Copy unavailable';
      button.setAttribute('aria-label', 'Copy unavailable');
    }
    clearTimeout(button.copyFeedbackTimeout);
    button.copyFeedbackTimeout = setTimeout(() => {
      const block = button.closest('.markdown-code-block');
      if (!block) return;
      button.textContent = 'Copy code';
      const language = block.querySelector('.markdown-code-header span').textContent;
      button.setAttribute('aria-label', language && language !== 'Code' ? `Copy ${language} code` : 'Copy code');
    }, 1800);
  }));
  container.querySelectorAll('.markdown-code-block').forEach(block => {
    const code = block.querySelector('code');
    const fullCode = code.textContent;
    code.dataset.fullCode = fullCode;
    const lines = fullCode.split('\n');
    if (!truncateLongCode || lines.length <= 20 || block.querySelector('[data-expand-code]')) return;
    code.textContent = lines.slice(0, 20).join('\n');
    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'text-btn';
    expand.dataset.expandCode = '';
    expand.textContent = `Show more (${lines.length - 20} lines)`;
    expand.addEventListener('click', () => openCodeDialog(fullCode));
    block.appendChild(expand);
  });
}


export function openCodeDialog(code) {
  const dialog = $('code-dialog');
  dialog.showModal();
  const maxCharacters = Math.max(12, Math.floor((dialog.clientWidth - 48) / 8));
  const visualLines = String(code).split('\n').flatMap(line => {
    if (!line) return [''];
    const pieces = [];
    for (let index = 0; index < line.length; index += maxCharacters) {
      pieces.push(line.slice(index, index + maxCharacters));
    }
    return pieces;
  });
  const linesPerPage = Math.max(4, Math.floor((dialog.clientHeight - 130) / 20));
  state.codeDialogPages = [];
  for (let index = 0; index < visualLines.length; index += linesPerPage) {
    state.codeDialogPages.push(visualLines.slice(index, index + linesPerPage).join('\n'));
  }
  state.codeDialogPageIndex = 0;
  renderCodeDialogPage();
}

export function renderCodeDialogPage() {
  $('code-dialog-content').textContent = state.codeDialogPages[state.codeDialogPageIndex] || '';
  const controls = $('code-dialog-controls');
  const pageCount = Math.max(1, state.codeDialogPages.length);
  controls.innerHTML = `<button type="button" class="btn btn-sm" data-code-prev ${state.codeDialogPageIndex === 0 ? 'disabled' : ''}>Previous</button><span aria-live="polite">Part ${state.codeDialogPageIndex + 1} of ${pageCount}</span><button type="button" class="btn btn-sm" data-code-next ${state.codeDialogPageIndex >= pageCount - 1 ? 'disabled' : ''}>Next</button>`;
  controls.querySelector('[data-code-prev]').addEventListener('click', () => {
    state.codeDialogPageIndex--;
    renderCodeDialogPage();
  });
  controls.querySelector('[data-code-next]').addEventListener('click', () => {
    state.codeDialogPageIndex++;
    renderCodeDialogPage();
  });
}

export function init() {
  $('code-dialog-close').addEventListener('click', () => $('code-dialog').close());
}
