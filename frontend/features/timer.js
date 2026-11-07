import { state } from '../shared/state.js';
import { $, setStatus } from '../shared/dom.js';
import { uid } from '../shared/format.js';
import { emit } from '../shared/bus.js';
import { idbSet } from '../services/storage.js';

const RING_CIRC = 2 * Math.PI * 98;

function getDurations() {
  return {
    work: Math.max(1, parseInt($('work-min').value) || 25) * 60,
    brk: Math.max(1, parseInt($('break-min').value) || 5) * 60,
    long: Math.max(1, parseInt($('long-min').value) || 15) * 60
  };
}

export function renderTimer() {
  const m = Math.floor(state.timer.remaining / 60).toString().padStart(2, '0');
  const s = Math.floor(state.timer.remaining % 60).toString().padStart(2, '0');
  $('ring-time').textContent = `${m}:${s}`;
  $('ring-mode').textContent = state.timer.mode === 'work' ? 'Work session' : (state.timer.mode === 'long' ? 'Long break' : 'Short break');
  $('ring-progress').setAttribute('stroke-dashoffset', (RING_CIRC * (1 - state.timer.remaining / state.timer.total)).toFixed(2));
  $('ring-progress').style.stroke = state.timer.mode === 'work' ? 'var(--pen-green)' : 'var(--pen-blue)';
  $('timer-start-btn').textContent = state.timer.running ? 'Pause' : 'Start';
  const today = new Date();
  $('timer-session-count').textContent = state.timerSessions.filter(session => {
    const completed = new Date(session.completedAt);
    return completed.getFullYear() === today.getFullYear()
      && completed.getMonth() === today.getMonth()
      && completed.getDate() === today.getDate();
  }).length;
}

function logWorkSession(seconds) {
  state.timerSessions.push({
    id: uid(),
    course: $('timer-course').value,
    unit: $('timer-unit').value,
    seconds,
    completedAt: Date.now()
  });
  idbSet('timerSessions', state.timerSessions);
  renderTimer();
  emit('timer:session-logged');
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 660;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) { }
}

function timerTick() {
  state.timer.remaining--;
  if (state.timer.remaining <= 0) {
    if ($('timer-sound-enabled').checked) beep();
    if ($('timer-notification-enabled').checked && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('StudyBuddy timer', { body: state.timer.mode === 'work' ? 'Focus session complete. Take a short break.' : 'Break complete. Ready to focus again?' });
    }
    const d = getDurations();
    if (state.timer.mode === 'work') {
      logWorkSession(state.timer.total);
      state.timer.cyclesDone++;
      const isLong = state.timer.cyclesDone % 4 === 0;
      state.timer.mode = isLong ? 'long' : 'break';
      state.timer.total = isLong ? d.long : d.brk;
    } else {
      state.timer.mode = 'work';
      state.timer.total = d.work;
    }
    state.timer.remaining = state.timer.total;
  }
  renderTimer();
}

export function init(deps = {}) {
  void deps;
  $('ring-progress').setAttribute('stroke-dasharray', RING_CIRC.toFixed(2));

  $('timer-start-btn').addEventListener('click', () => {
    state.timer.running = !state.timer.running;
    if (state.timer.running) state.timer.intervalId = setInterval(timerTick, 1000);
    else clearInterval(state.timer.intervalId);
    renderTimer();
  });
  $('timer-sound-enabled').checked = localStorage.getItem('studybuddy-timer-sound') !== 'false';
  $('timer-notification-enabled').checked = localStorage.getItem('studybuddy-timer-notification') === 'true'
    && 'Notification' in window && Notification.permission === 'granted';
  $('timer-sound-enabled').addEventListener('change', event => {
    localStorage.setItem('studybuddy-timer-sound', String(event.target.checked));
  });
  $('timer-notification-enabled').addEventListener('change', async event => {
    if (!event.target.checked) {
      localStorage.setItem('studybuddy-timer-notification', 'false');
      setStatus('timer-alert-status', 'Browser notifications are off.');
      return;
    }
    if (!('Notification' in window)) {
      event.target.checked = false;
      setStatus('timer-alert-status', 'This browser does not support notifications.');
      return;
    }
    const permission = Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission;
    if (permission !== 'granted') {
      event.target.checked = false;
      localStorage.setItem('studybuddy-timer-notification', 'false');
      setStatus('timer-alert-status', 'Notification permission was not granted. The timer will still play its sound if enabled.');
      return;
    }
    localStorage.setItem('studybuddy-timer-notification', 'true');
    setStatus('timer-alert-status', 'Browser notifications are enabled for timer alerts.');
  });
  $('timer-reset-btn').addEventListener('click', () => {
    clearInterval(state.timer.intervalId);
    const d = getDurations();
    state.timer = { mode: 'work', remaining: d.work, total: d.work, running: false, cyclesDone: 0, intervalId: null };
    renderTimer();
  });
  ['work-min', 'break-min', 'long-min'].forEach(id => $(id).addEventListener('change', () => {
    if (!state.timer.running) {
      const d = getDurations();
      state.timer.total = state.timer.mode === 'work' ? d.work : (state.timer.mode === 'long' ? d.long : d.brk);
      state.timer.remaining = state.timer.total;
      renderTimer();
    }
  }));
}
