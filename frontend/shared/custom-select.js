import { state } from './state.js';
import { $, selectAccessibleName } from './dom.js';
import { uid } from './format.js';

export function syncCustomSelect(select) {
  const selectState = state.customSelects.get(select);
  if (!selectState) return;
  const selected = select.selectedOptions[0];
  selectState.value.textContent = selected?.label || selected?.textContent || 'Select';
  selectState.trigger.disabled = select.disabled;
  selectState.trigger.setAttribute('aria-label', selectAccessibleName(select, selectState.trigger));
  selectState.trigger.setAttribute('aria-expanded', String(selectState.popover.classList.contains('open')));
  selectState.trigger.setAttribute('aria-controls', selectState.list.id);
  selectState.trigger.setAttribute('aria-haspopup', 'listbox');
  selectState.trigger.setAttribute('role', 'combobox');
  renderCustomSelectOptions(select);
}

export function renderCustomSelectOptions(select) {
  const selectState = state.customSelects.get(select);
  if (!selectState) return;
  const options = [...select.options];
  selectState.list.replaceChildren();
  selectState.searchWrap.hidden = options.length <= 8;
  const fragment = document.createDocumentFragment();
  options.forEach((option, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.id = `${selectState.list.id}-option-${index}`;
    item.className = 'custom-select-option';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(option.selected));
    item.setAttribute('aria-disabled', String(option.disabled));
    item.tabIndex = -1;
    item.disabled = option.disabled;
    item.dataset.optionIndex = String(index);
    item.textContent = option.label || option.textContent;
    item.addEventListener('click', () => {
      if (option.disabled) return;
      select.selectedIndex = index;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      syncCustomSelect(select);
      closeCustomSelect(selectState, true);
    });
    fragment.append(item);
  });
  selectState.list.append(fragment);
  selectState.empty.hidden = options.length > 0;
  const query = selectState.search.value.trim().toLocaleLowerCase();
  if (query) filterCustomSelectOptions(selectState);
}

export function filterCustomSelectOptions(selectState) {
  const query = selectState.search.value.trim().toLocaleLowerCase();
  let visibleCount = 0;
  selectState.list.querySelectorAll('[role="option"]').forEach(option => {
    const visible = option.textContent.toLocaleLowerCase().includes(query);
    option.hidden = !visible;
    if (visible) visibleCount++;
  });
  selectState.empty.hidden = visibleCount > 0;
}

export function positionCustomSelect(selectState) {
  const bounds = selectState.trigger.getBoundingClientRect();
  const margin = 8;
  const below = window.innerHeight - bounds.bottom;
  const above = bounds.top;
  const maxHeight = Math.min(360, window.innerHeight - margin * 2);
  const openAbove = below < Math.min(240, maxHeight) && above > below;
  selectState.popover.style.maxHeight = `${maxHeight}px`;
  selectState.popover.style.width = `${Math.max(180, bounds.width)}px`;
  selectState.popover.style.left = `${Math.min(Math.max(margin, bounds.left), window.innerWidth - Math.max(180, bounds.width) - margin)}px`;
  selectState.popover.style.top = openAbove
    ? `${Math.max(margin, bounds.top - Math.min(selectState.popover.offsetHeight, above - margin))}px`
    : `${Math.min(window.innerHeight - margin - selectState.popover.offsetHeight, bounds.bottom)}px`;
}

export function closeCustomSelect(selectState, restoreFocus = false) {
  selectState.popover.classList.remove('open');
  selectState.popover.setAttribute('aria-hidden', 'true');
  selectState.trigger.setAttribute('aria-expanded', 'false');
  if (state.activeCustomSelect === selectState) state.activeCustomSelect = null;
  if (restoreFocus) selectState.trigger.focus();
}

export function openCustomSelect(selectState) {
  if (state.activeCustomSelect && state.activeCustomSelect !== selectState) closeCustomSelect(state.activeCustomSelect);
  state.activeCustomSelect = selectState;
  syncCustomSelect(selectState.select);
  selectState.search.value = '';
  filterCustomSelectOptions(selectState);
  selectState.popover.classList.add('open');
  selectState.popover.setAttribute('aria-hidden', 'false');
  selectState.trigger.setAttribute('aria-expanded', 'true');
  positionCustomSelect(selectState);
  const selectedIndex = selectState.select.selectedIndex;
  const selectedOption = selectState.list.querySelector(`[data-option-index="${selectedIndex}"]`);
  const firstOption = selectState.list.querySelector('[role="option"]:not([hidden]):not(:disabled)');
  const active = selectedOption && !selectedOption.hidden && !selectedOption.disabled ? selectedOption : firstOption;
  active?.classList.add('active');
  if (selectState.searchWrap.hidden) active?.focus();
  else selectState.search.focus();
}

export function moveCustomSelectFocus(selectState, direction) {
  const options = [...selectState.list.querySelectorAll('[role="option"]:not([hidden]):not(:disabled)')];
  if (!options.length) return;
  const current = options.indexOf(document.activeElement);
  const next = current < 0
    ? Math.max(0, options.findIndex(option => option.getAttribute('aria-selected') === 'true'))
    : (current + direction + options.length) % options.length;
  options.forEach(option => option.classList.toggle('active', options[next] === option));
  options[next].focus();
  options[next].scrollIntoView({ block: 'nearest' });
}

export function handleCustomSelectKeydown(selectState, event) {
  const { key } = event;
  if (key === 'Escape') {
    event.preventDefault();
    closeCustomSelect(selectState, true);
    return;
  }
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    event.preventDefault();
    if (!selectState.popover.classList.contains('open')) {
      openCustomSelect(selectState);
      return;
    }
    moveCustomSelectFocus(selectState, key === 'ArrowDown' ? 1 : -1);
    return;
  }
  if (key === 'Home' || key === 'End') {
    if (!selectState.popover.classList.contains('open')) return;
    event.preventDefault();
    const options = [...selectState.list.querySelectorAll('[role="option"]:not([hidden]):not(:disabled)')];
    const target = key === 'Home' ? options[0] : options.at(-1);
    target?.focus();
    target?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (key === 'Enter' || key === ' ') {
    if (!selectState.popover.classList.contains('open')) {
      event.preventDefault();
      openCustomSelect(selectState);
    } else if (event.target.matches('[role="option"]')) {
      event.preventDefault();
      event.target.click();
    } else if (key === 'Enter') {
      const active = selectState.list.querySelector('.active:not([hidden]):not(:disabled)');
      if (active) {
        event.preventDefault();
        active.click();
      }
    }
    return;
  }
  if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (!selectState.popover.classList.contains('open')) openCustomSelect(selectState);
    if (!selectState.searchWrap.hidden) {
      if (event.target !== selectState.search) {
        event.preventDefault();
        selectState.search.value = key;
        filterCustomSelectOptions(selectState);
        selectState.search.focus();
      }
      return;
    }
    state.selectTypeahead += key.toLocaleLowerCase();
    clearTimeout(state.selectTypeaheadTimer);
    state.selectTypeaheadTimer = setTimeout(() => { state.selectTypeahead = ''; }, 700);
    const options = [...selectState.list.querySelectorAll('[role="option"]:not(:disabled)')];
    const activeIndex = options.indexOf(document.activeElement);
    const start = activeIndex < 0 ? 0 : activeIndex + 1;
    const ordered = [...options.slice(start), ...options.slice(0, start)];
    const match = ordered.find(option => option.textContent.trim().toLocaleLowerCase().startsWith(state.selectTypeahead));
    if (match) {
      selectState.list.querySelectorAll('.active').forEach(option => option.classList.remove('active'));
      match.classList.add('active');
      match.focus();
      match.scrollIntoView({ block: 'nearest' });
    }
  }
}

export function enhanceSelect(select) {
  if (state.customSelects.has(select)) return;
  const wrap = document.createElement('span');
  wrap.className = `custom-select-wrap ${[...select.classList].join(' ')}`.trim();
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-select-trigger';
  const value = document.createElement('span');
  value.className = 'custom-select-value';
  const chevron = document.createElement('span');
  chevron.className = 'custom-select-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '⌄';
  trigger.append(value, chevron);
  const popover = document.createElement('div');
  popover.className = 'custom-select-popover';
  popover.setAttribute('aria-hidden', 'true');
  const searchWrap = document.createElement('div');
  searchWrap.className = 'custom-select-search-wrap';
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'custom-select-search';
  search.placeholder = 'Search options';
  search.setAttribute('aria-label', 'Search dropdown options');
  const list = document.createElement('div');
  list.className = 'custom-select-list';
  list.id = `custom-select-list-${uid()}`;
  list.setAttribute('role', 'listbox');
  const empty = document.createElement('p');
  empty.className = 'custom-select-empty';
  empty.textContent = 'No matching options';
  empty.hidden = true;
  searchWrap.append(search);
  popover.append(searchWrap, list, empty);
  const selectState = { select, wrap, trigger, value, popover, searchWrap, search, list, empty };
  state.customSelects.set(select, selectState);
  select.parentNode.insertBefore(wrap, select.nextSibling);
  wrap.append(trigger);
  (select.closest('dialog') || document.body).append(popover);
  select.classList.add('custom-select-native');
  select.setAttribute('aria-hidden', 'true');
  select.tabIndex = -1;
  trigger.addEventListener('click', () => {
    if (popover.classList.contains('open')) closeCustomSelect(selectState);
    else openCustomSelect(selectState);
  });
  trigger.addEventListener('keydown', event => handleCustomSelectKeydown(selectState, event));
  list.addEventListener('keydown', event => handleCustomSelectKeydown(selectState, event));
  search.addEventListener('input', () => {
    filterCustomSelectOptions(selectState);
    const first = list.querySelector('[role="option"]:not([hidden]):not(:disabled)');
    list.querySelectorAll('.active').forEach(option => option.classList.remove('active'));
    first?.classList.add('active');
  });
  search.addEventListener('keydown', event => handleCustomSelectKeydown(selectState, event));
  const observer = new MutationObserver(() => syncCustomSelect(select));
  observer.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'label', 'value'] });
  selectState.observer = observer;
  syncCustomSelect(select);
}

export function initializeCustomControls() {
  document.querySelectorAll('select').forEach(enhanceSelect);
  const switchIds = ['calendar-reminders-enabled', 'tutor-use-material', 'settings-tutor-material', 'timer-sound-enabled', 'timer-notification-enabled'];
  switchIds.forEach(id => {
    const input = $(id);
    if (!input) return;
    const label = input.closest('label');
    if (!label || input.classList.contains('app-switch-input')) return;
    input.classList.add('app-switch-input');
    input.setAttribute('role', 'switch');
    const track = document.createElement('span');
    track.className = 'app-switch-track';
    track.setAttribute('aria-hidden', 'true');
    input.after(track);
    label.classList.add('app-switch-label');
    const sync = () => input.setAttribute('aria-checked', String(input.checked));
    input.addEventListener('change', sync);
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      input.checked = !input.checked;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    sync();
  });
  document.addEventListener('pointerdown', event => {
    if (state.activeCustomSelect && !state.activeCustomSelect.popover.contains(event.target) && !state.activeCustomSelect.wrap.contains(event.target)) {
      closeCustomSelect(state.activeCustomSelect);
    }
  });
  window.addEventListener('resize', () => {
    if (state.activeCustomSelect) positionCustomSelect(state.activeCustomSelect);
  });
  window.addEventListener('scroll', () => {
    if (state.activeCustomSelect) positionCustomSelect(state.activeCustomSelect);
  }, true);
}
