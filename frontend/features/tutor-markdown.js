function normalizeTutorMarkdown(value) {
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  let proseLines = [];
  let codeLines = [];
  let fence = null;

  const normalizeProse = text => {
    const inlineCode = [];
    const protectedText = text.replace(/(`+)([\s\S]*?)\1/g, match => {
      inlineCode.push(match);
      return `\u0000INLINE_CODE_${inlineCode.length - 1}\u0000`;
    });
    return protectedText
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\t/g, '\t')
      .replace(/\u0000INLINE_CODE_(\d+)\u0000/g, (_, index) => inlineCode[Number(index)] || '');
  };
  const flushProse = () => {
    if (proseLines.length) output.push(normalizeProse(proseLines.join('\n')));
    proseLines = [];
  };
  const flushCode = () => {
    if (codeLines.length) output.push(codeLines.join('\n'));
    codeLines = [];
  };

  lines.forEach(line => {
    if (fence) {
      codeLines.push(line);
      const closing = line.match(/^ {0,3}(`+|~+)\s*$/);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) {
        fence = null;
        flushCode();
      }
      return;
    }

    const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (opening && !(opening[1][0] === '`' && opening[2].includes('`'))) {
      flushProse();
      codeLines = [line];
      fence = { character: opening[1][0], length: opening[1].length };
      return;
    }
    proseLines.push(line);
  });

  flushProse();
  flushCode();
  return output.join('\n');
}

function sourceTypeForCitation(type) {
  const normalized = type.toLowerCase();
  return normalized === 'doc' ? 'document' : normalized;
}

function matchingSource(sources, type, title) {
  const normalizedType = sourceTypeForCitation(type);
  return sources.find(source => sourceTypeForCitation(source.type || '') === normalizedType
    && (!title || String(source.title || '').trim().toLocaleLowerCase() === title.trim().toLocaleLowerCase()));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

function renderCitationMarkers(root, sources) {
  const pattern = /\[(Card|Note|Doc|Document|Assignment|Class|Session|Quiz|Progress)(?:\s*:\s*([^\]\n]+))?\]/gi;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.parentElement?.closest('code, pre, a, button, script, style')) textNodes.push(node);
  }

  textNodes.forEach(node => {
    const text = node.nodeValue || '';
    pattern.lastIndex = 0;
    if (!pattern.test(text)) return;
    pattern.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text))) {
      fragment.append(document.createTextNode(text.slice(cursor, match.index)));
      const marker = match[0];
      const source = matchingSource(sources, match[1], match[2] || '');
      const sourceType = source && sourceTypeForCitation(source.type || '');
      const canOpen = source && (source.sourceId || sourceType === 'progress');
      const chip = document.createElement(canOpen ? 'button' : 'span');
      chip.className = canOpen ? 'citation-chip source-open' : 'citation-chip';
      chip.textContent = marker;
      if (canOpen) {
        chip.type = 'button';
        chip.dataset.sourceType = sourceType;
        chip.dataset.sourceId = source.sourceId || '';
        chip.setAttribute('aria-label', `Open source ${marker}`);
      }
      fragment.append(chip);
      cursor = match.index + marker.length;
    }
    fragment.append(document.createTextNode(text.slice(cursor)));
    node.replaceWith(fragment);
  });
}

export function renderTutorMarkdown(markdown, sources = []) {
  const source = normalizeTutorMarkdown(markdown);
  if (!window.marked?.parse || !window.DOMPurify?.sanitize) {
    console.error('Tutor Markdown libraries are unavailable; rendering the reply as safe plain text.');
    const paragraph = document.createElement('p');
    paragraph.textContent = source;
    paragraph.style.whiteSpace = 'pre-wrap';
    const fallback = document.createElement('div');
    fallback.append(paragraph);
    renderCitationMarkers(fallback, sources);
    return fallback.innerHTML;
  }

  const renderer = new window.marked.Renderer();
  renderer.html = token => escapeHtml(typeof token === 'string' ? token : token.text);
  const html = window.marked.parse(source, { gfm: true, breaks: false, renderer });
  const template = document.createElement('template');
  template.innerHTML = window.DOMPurify.sanitize(html);

  template.content.querySelectorAll('pre').forEach(pre => {
    const code = pre.querySelector('code');
    const languageClass = [...(code?.classList || [])].find(className => className.startsWith('language-'));
    const language = languageClass ? languageClass.slice('language-'.length) : '';
    const block = document.createElement('section');
    block.className = 'markdown-code-block';
    const header = document.createElement('header');
    header.className = 'markdown-code-header';
    const label = document.createElement('span');
    label.textContent = language || 'Code';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.dataset.copyCode = '';
    copy.textContent = 'Copy code';
    copy.setAttribute('aria-live', 'polite');
    copy.setAttribute('aria-label', language ? `Copy ${language} code` : 'Copy code');
    header.append(label, copy);
    pre.setAttribute('tabindex', '0');
    pre.replaceWith(block);
    block.append(header, pre);
  });

  template.content.querySelectorAll('table').forEach(table => {
    table.querySelectorAll('thead th').forEach(header => header.setAttribute('scope', 'col'));
    const wrapper = document.createElement('div');
    wrapper.className = 'markdown-table-wrap';
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', table.querySelector('caption')?.textContent.trim() || 'Scrollable response table');
    wrapper.setAttribute('tabindex', '0');
    table.replaceWith(wrapper);
    wrapper.append(table);
  });

  renderCitationMarkers(template.content, sources);
  const result = document.createElement('div');
  result.append(template.content.cloneNode(true));
  return result.innerHTML;
}
