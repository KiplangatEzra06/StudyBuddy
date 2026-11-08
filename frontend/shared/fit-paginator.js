import { state } from './state.js';

let renderCalendar = () => {};

export function init(deps = {}) {
  renderCalendar = deps.renderCalendar || renderCalendar;
  window.addEventListener('resize', () => {
    refreshFitPaginators();
    if (!$('panel-calendar').classList.contains('hidden')) renderCalendar();
  });
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey
      || event.target.matches('input, textarea, select, [contenteditable="true"]')) return;
    const active = document.activeElement;
    const activeContainer = active?.closest('[data-fit-paginate]')
      || (active?.classList.contains('fit-page-controls') ? active.previousElementSibling : null);
    const paginator = activeContainer?.nextElementSibling;
    if (!paginator?.classList.contains('fit-page-controls')) return;
    const next = ['ArrowRight', 'PageDown'].includes(event.key);
    const previous = ['ArrowLeft', 'PageUp'].includes(event.key);
    if (!next && !previous) return;
    const button = paginator.querySelector(next ? '[data-fit-next]' : '[data-fit-prev]');
    if (!button.disabled) {
      event.preventDefault();
      button.click();
    }
  });
}

const $ = id => document.getElementById(id);

export function paginateToFit(container, options = {}) {
  if (!container) return;
  const key = container.id || container;
  const pageState = state.fitPaginations.get(key) || { page: 0 };
  state.fitPaginations.set(key, pageState);
  let controls = container.nextElementSibling;
  if (!controls?.classList.contains('fit-page-controls')) {
    controls = document.createElement('nav');
    controls.className = 'fit-page-controls';
    controls.setAttribute('aria-label', options.label || 'List pages');
    controls.innerHTML = '<button type="button" class="btn btn-sm" data-fit-prev aria-label="Previous page">Previous</button><span data-fit-status aria-live="polite"></span><button type="button" class="btn btn-sm" data-fit-next aria-label="Next page">Next</button>';
    container.after(controls);
    controls.querySelector('[data-fit-prev]').addEventListener('click', () => {
      pageState.page = Math.max(0, pageState.page - 1);
      paginateToFit(container, options);
    });
    controls.querySelector('[data-fit-next]').addEventListener('click', () => {
      pageState.page++;
      paginateToFit(container, options);
    });
  }
  const items = [...container.children].filter(item => !item.classList.contains('fit-page-controls'));
  const gap = parseFloat(getComputedStyle(container).rowGap) || 8;
  const columns = options.columns || Math.max(1, getComputedStyle(container).gridTemplateColumns.split(/\s+/).filter(Boolean).length);
  const previousVisibility = items.map(item => item.hidden);
  items.forEach(item => { item.hidden = false; });
  const measuredItemHeight = items.reduce((height, item) => Math.max(height, item.getBoundingClientRect().height), 0);
  items.forEach((item, index) => { item.hidden = previousVisibility[index]; });
  const firstItemHeight = Math.max(measuredItemHeight, options.itemHeight || 88);
  const pageHeight = Math.max(0, container.clientHeight - (options.bottomReserve || 0));
  const rowsPerPage = Math.max(1, Math.floor((pageHeight + gap) / (firstItemHeight + gap)));
  const pageSize = Math.max(1, rowsPerPage * columns);
  pageState.pageSize = pageSize;
  pageState.itemHeight = options.itemHeight || 88;
  pageState.label = options.label || 'List pages';
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  pageState.page = Math.min(pageState.page, pageCount - 1);
  const start = pageState.page * pageSize;
  items.forEach((item, index) => {
    const visible = index >= start && index < start + pageSize;
    item.hidden = !visible;
    item.setAttribute('aria-hidden', String(!visible));
  });
  controls.querySelector('[data-fit-status]').textContent = `Page ${pageState.page + 1} of ${pageCount} · ${items.length} items`;
  controls.querySelector('[data-fit-prev]').disabled = pageState.page === 0;
  controls.querySelector('[data-fit-next]').disabled = pageState.page >= pageCount - 1;
  controls.classList.toggle('hidden', items.length <= pageSize);
  if (!state.fitPaginationObservers.has(key) && typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => requestAnimationFrame(() => paginateToFit(container, options)));
    observer.observe(container);
    state.fitPaginationObservers.set(key, observer);
  }
}

export function refreshFitPaginators() {
  document.querySelectorAll('[data-fit-paginate]').forEach(container => paginateToFit(container, {
    label: container.dataset.fitLabel || `${container.getAttribute('aria-label') || 'List'} pages`,
    itemHeight: Number(container.dataset.fitItemHeight) || 88,
    columns: container.dataset.fitColumns ? Number(container.dataset.fitColumns) : undefined
  }));
}

export function showFitItem(container, itemSelector) {
  if (!container) return;
  const key = container.id || container;
  const pageState = state.fitPaginations.get(key) || { page: 0 };
  state.fitPaginations.set(key, pageState);
  const items = [...container.children].filter(item => !item.classList.contains('fit-page-controls'));
  const index = items.findIndex(item => item.matches(itemSelector) || item.querySelector(itemSelector));
  if (index < 0) return;
  pageState.page = Math.floor(index / (pageState.pageSize || 1));
  paginateToFit(container, {
    label: container.dataset.fitLabel || pageState.label || `${container.getAttribute('aria-label') || 'List'} pages`,
    itemHeight: Number(container.dataset.fitItemHeight) || pageState.itemHeight || 88,
    columns: container.dataset.fitColumns ? Number(container.dataset.fitColumns) : undefined
  });
  const target = items[index].matches('button, a, [tabindex]') ? items[index] : items[index].querySelector('button, a, [tabindex]');
  target?.focus({ preventScroll: true });
}

export function releaseFitPaginator(container) {
  if (!container) return;
  const key = container.id || container;
  state.fitPaginationObservers.get(key)?.disconnect();
  state.fitPaginationObservers.delete(key);
  state.fitPaginations.delete(key);
}
