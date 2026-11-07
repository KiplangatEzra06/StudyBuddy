import { state } from '../shared/state.js';
import { $, escapeHtml, setStatus } from '../shared/dom.js';
import { uid, truncateText, normalizeAnswer } from '../shared/format.js';
import { emit } from '../shared/bus.js';
import { idbSet } from '../services/storage.js';
import { paginateToFit } from '../shared/fit-paginator.js';

let callAI = async () => ({});
let aiDocumentPayload = doc => ({
  id: doc.id,
  title: doc.title,
  course: doc.course,
  unit: doc.unit,
  text: truncateText(doc.extractedText, 14000)
});
let activatePage = () => {};
let renderProgress = () => {};

export async function quizFromNote(id) {
  const note = state.notes.find(item => item.id === id);
  if (!note?.body.trim()) return;
  setStatus('notes-ai-status', 'Preparing a quiz from note...');
  try {
    const data = await callAI('/api/generate-quiz', { document: {
      id: note.id, title: note.title || 'Study note', course: note.tag || 'General',
      unit: note.unit || 'General', text: truncateText(note.body, 14000)
    } });
    const questions = normalizeGeneratedQuestions(data.questions);
    if (!questions.length) throw new Error('No complete quiz questions could be made from this note.');
    renderQuiz({ id: note.id, title: note.title || 'Study note', course: note.tag, unit: note.unit }, questions);
    activatePage('quiz');
  } catch (error) {
    setStatus('notes-ai-status', error.message || 'Could not create a quiz from this note.');
  }
}

export async function generateQuiz() {
  const doc = state.documents.find(d => d.id === $('quiz-doc-select').value);
  if (!doc) return setStatus('quiz-status', 'Upload a document first. (No document selected)');

  setStatus('quiz-status', 'Generating quiz...');
  $('generate-quiz-btn').disabled = true;
  try {
    const data = await callAI('/api/generate-quiz', { document: aiDocumentPayload(doc) });
    const questions = normalizeGeneratedQuestions(data.questions);
    renderQuiz(doc, questions);
    setStatus('quiz-status', questions.length
      ? `Ready: ${questions.length} questions from ${doc.title}.`
      : 'The AI returned no complete, auto-gradable questions. Try again with a document that has more study content.');
  } catch (err) {
    setStatus('quiz-status', err.message || 'Could not generate quiz.');
  } finally {
    $('generate-quiz-btn').disabled = false;
  }
}

export function normalizeGeneratedQuestions(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items.reduce((questions, item) => {
    if (!item || typeof item !== 'object') return questions;
    const question = typeof item.question === 'string' ? item.question.trim() : '';
    const correctAnswer = typeof (item.correctAnswer || item.answer) === 'string'
      ? String(item.correctAnswer || item.answer).trim()
      : '';
    const type = ['multiple_choice', 'true_false', 'fill_blank', 'short_answer'].includes(item.type)
      ? item.type
      : 'short_answer';
    const rawOptions = Array.isArray(item.options)
      ? [...new Set(item.options.filter(option => typeof option === 'string').map(option => option.trim()).filter(Boolean))]
      : [];
    if (!question || !correctAnswer) return questions;
    if (type === 'multiple_choice' && (rawOptions.length < 2 || !rawOptions.some(option => normalizeAnswer(option) === normalizeAnswer(correctAnswer)))) return questions;
    if (type === 'true_false' && !['true', 'false'].includes(normalizeAnswer(correctAnswer))) return questions;
    const key = normalizeAnswer(question);
    if (seen.has(key)) return questions;
    seen.add(key);
    const options = type === 'multiple_choice' ? rawOptions : (type === 'true_false' ? ['True', 'False'] : []);
    questions.push({
      ...item,
      type,
      question,
      options,
      correctAnswer: type === 'multiple_choice'
        ? options.find(option => normalizeAnswer(option) === normalizeAnswer(correctAnswer))
        : correctAnswer
    });
    return questions;
  }, []);
}

export function renderQuiz(doc, questions) {
  if (!questions.length) {
    state.currentQuiz = null;
    $('quiz-view-toolbar').classList.add('hidden');
    $('quiz-area').replaceChildren();
    $('quiz-empty').textContent = 'The AI returned no complete, auto-gradable questions. Try again with a document that has more study content.';
    $('quiz-empty').classList.remove('hidden');
    return;
  }
  $('quiz-empty').textContent = 'Choose a document and generate a quiz.';
  $('quiz-empty').classList.add('hidden');
  state.currentQuiz = {
    doc,
    questions,
    answers: Array(questions.length).fill(''),
    index: 0,
    mode: 'one',
    graded: false,
    results: []
  };
  $('quiz-view-toolbar').classList.remove('hidden');
  renderQuizView();
}

export function quizQuestionMarkup(question, index) {
  const type = question.type || 'multiple_choice';
  const options = Array.isArray(question.options) ? question.options : (type === 'true_false' ? ['True', 'False'] : []);
  const currentAnswer = state.currentQuiz.answers[index];
  const input = options.length ? options.map(option => `
    <label class="quiz-option ${state.currentQuiz.graded && normalizeAnswer(option) === normalizeAnswer(question.correctAnswer || question.answer) ? 'correct' : ''} ${state.currentQuiz.graded && currentAnswer === option && normalizeAnswer(option) !== normalizeAnswer(question.correctAnswer || question.answer) ? 'wrong' : ''}">
      <input type="radio" name="quiz-${index}" value="${escapeHtml(option)}" ${currentAnswer === option ? 'checked' : ''} ${state.currentQuiz.graded ? 'disabled' : ''}>
      <span>${escapeHtml(option)}</span>
    </label>
  `).join('') : `<input type="text" data-free-answer="${index}" value="${escapeHtml(currentAnswer)}" placeholder="Your answer" ${state.currentQuiz.graded ? 'disabled' : ''}>`;
  const result = state.currentQuiz.graded ? state.currentQuiz.results[index] : null;
  return `
    <article class="quiz-question" data-q-index="${index}">
      <div class="meta-line"><span class="pill">${escapeHtml(type.replace(/_/g, ' '))}</span><span class="question-count">Question ${index + 1}</span></div>
      <strong>${escapeHtml(question.question)}</strong>
      <div class="quiz-answer-options">${input}</div>
      ${result ? `<div class="quiz-feedback ${result.correct ? 'is-correct' : 'is-wrong'}" role="status"><strong>${result.correct ? 'Correct' : 'Not quite'}</strong>${result.correct ? '' : `<span>Answer: ${escapeHtml(question.correctAnswer || question.answer || 'Not provided')}</span>`}${question.explanation ? `<span>${escapeHtml(question.explanation)}</span>` : ''}</div>` : ''}
    </article>
  `;
}

export function collectQuizAnswers() {
  state.currentQuiz.questions.forEach((question, index) => {
    const checked = document.querySelector(`input[name="quiz-${index}"]:checked`);
    const free = document.querySelector(`[data-free-answer="${index}"]`);
    if (checked) state.currentQuiz.answers[index] = checked.value;
    else if (free) state.currentQuiz.answers[index] = free.value.trim();
  });
}

export function renderQuizView() {
  if (!state.currentQuiz) return;
  const { questions, index, mode } = state.currentQuiz;
  const area = $('quiz-area');
  $('quiz-mode-one').classList.toggle('active', mode === 'one');
  $('quiz-mode-one').setAttribute('aria-pressed', String(mode === 'one'));
  $('quiz-mode-all').classList.toggle('active', mode === 'all');
  $('quiz-mode-all').setAttribute('aria-pressed', String(mode === 'all'));
  if (state.currentQuiz.graded) {
    renderQuizResults();
    return;
  }
  const content = mode === 'all'
    ? questions.map((question, questionIndex) => quizQuestionMarkup(question, questionIndex)).join('')
    : quizQuestionMarkup(questions[index], index);
  const percent = Math.round(((index + 1) / questions.length) * 100);
  area.innerHTML = `
    <div class="quiz-progress-wrap">
      <div class="quiz-progress-label"><span>${mode === 'all' ? `${questions.length} questions` : `Question ${index + 1} of ${questions.length}`}</span><strong>${percent}%</strong></div>
      <div class="quiz-progress-track"><span style="width:${percent}%"></span></div>
    </div>
    <div class="quiz-question-list">${content}</div>
    <div class="quiz-navigation">
      ${mode === 'one' ? `<button class="btn" id="quiz-previous-btn" ${index === 0 ? 'disabled' : ''}>Previous</button>` : ''}
      <span class="hint">${mode === 'all' ? 'Answer each question, then submit.' : 'Take your time. You can move back and change an answer.'}</span>
      ${mode === 'one' && index < questions.length - 1
        ? '<button class="btn btn-primary" id="quiz-next-btn">Next question</button>'
        : '<button class="btn btn-primary" id="grade-quiz-btn">Submit quiz</button>'}
    </div>
  `;
  area.querySelectorAll('input').forEach(input => input.addEventListener('change', collectQuizAnswers));
  area.querySelectorAll('input[type="text"]').forEach(input => input.addEventListener('input', collectQuizAnswers));
  $('quiz-previous-btn')?.addEventListener('click', () => { collectQuizAnswers(); state.currentQuiz.index--; renderQuizView(); });
  $('quiz-next-btn')?.addEventListener('click', () => { collectQuizAnswers(); state.currentQuiz.index++; renderQuizView(); });
  $('grade-quiz-btn')?.addEventListener('click', () => { collectQuizAnswers(); gradeQuiz(); });
}

export function gradeQuiz() {
  const { doc, questions, answers } = state.currentQuiz;
  state.currentQuiz.results = questions.map((question, index) => {
    const answer = answers[index];
    return {
      question: question.question,
      answer,
      correct: normalizeAnswer(answer) === normalizeAnswer(question.correctAnswer || question.answer),
      topic: question.topic || question.question,
      correctAnswer: question.correctAnswer || question.answer || '',
      explanation: question.explanation || ''
    };
  });
  const correct = state.currentQuiz.results.filter(result => result.correct).length;
  const score = questions.length ? Math.round((correct / questions.length) * 100) : 0;
  state.currentQuiz.graded = true;
  state.quizResults.push({
    id: uid(),
    documentId: doc.id,
    documentTitle: doc.title,
    course: doc.course,
    unit: doc.unit,
    score,
    correct,
    total: questions.length,
    mistakes: state.currentQuiz.results.filter(result => !result.correct).map(result => ({
      question: result.question,
      answer: result.answer,
      correctAnswer: result.correctAnswer,
      explanation: result.explanation
    })),
    takenAt: Date.now()
  });
  idbSet('quizResults', state.quizResults);
  setStatus('quiz-status', `Score: ${correct}/${questions.length} (${score}%).`);
  renderProgress();
  renderQuizView();
}

export function renderQuizResults() {
  const correct = state.currentQuiz.results.filter(result => result.correct).length;
  const weakTopics = state.currentQuiz.results.filter(result => !result.correct);
  $('quiz-area').innerHTML = `
    <section class="quiz-results">
      <span class="results-kicker">QUIZ COMPLETE</span>
      <div class="results-score">${correct}<span>/${state.currentQuiz.questions.length}</span></div>
      <h2>${Math.round((correct / state.currentQuiz.questions.length) * 100)}% correct</h2>
      <p>${weakTopics.length ? 'Here are a few topics worth another look.' : 'Excellent work. You got every question right.'}</p>
      ${weakTopics.length ? `<div class="weak-topics"><strong>Topics to review</strong><ul>${weakTopics.map(result => `<li>${escapeHtml(result.topic)}</li>`).join('')}</ul></div>` : ''}
      <div class="row quiz-result-actions">
        ${weakTopics.length ? '<button class="btn btn-primary" id="mistakes-to-cards-btn">Make flashcards from mistakes</button>' : ''}
        ${weakTopics.length ? '<button class="btn" id="quiz-mistakes-open">Review mistakes</button>' : ''}
        <button class="btn" id="retake-quiz-btn">Retake quiz</button>
        </div>
    </section>
  `;
  $('mistakes-to-cards-btn')?.addEventListener('click', makeFlashcardsFromMistakes);
  $('quiz-mistakes-open')?.addEventListener('click', () => {
    const list = $('quiz-mistake-list');
    list.innerHTML = weakTopics.map(result => `<li><strong>${escapeHtml(result.question)}</strong><span>Your answer: ${escapeHtml(result.answer || 'No answer')}</span><span>Correct answer: ${escapeHtml(result.correctAnswer || 'Not recorded')}</span>${result.explanation ? `<p>${escapeHtml(result.explanation)}</p>` : ''}</li>`).join('');
    paginateToFit(list, { label: 'Quiz mistake pages', itemHeight: 72 });
    $('quiz-mistakes-dialog').showModal();
    requestAnimationFrame(() => paginateToFit(list, { label: 'Quiz mistake pages', itemHeight: 72 }));
  });
  $('retake-quiz-btn').addEventListener('click', () => {
    state.currentQuiz.answers = Array(state.currentQuiz.questions.length).fill('');
    state.currentQuiz.index = 0;
    state.currentQuiz.graded = false;
    state.currentQuiz.results = [];
    renderQuizView();
  });
}

export async function makeFlashcardsFromMistakes() {
  if (state.currentQuiz.madeFlashcards) return;
  const mistakes = state.currentQuiz.results.filter(result => !result.correct);
  const records = mistakes.map(result => ({
    front: result.question,
    back: result.answer ? `Your answer: ${result.answer}\nCorrect answer: ${state.currentQuiz.questions.find(question => question.question === result.question)?.correctAnswer || ''}` : `Correct answer: ${state.currentQuiz.questions.find(question => question.question === result.question)?.correctAnswer || 'Review this topic.'}`,
    subject: state.currentQuiz.doc.course || 'General',
    unit: state.currentQuiz.doc.unit || '',
    format: 'basic',
    aiGenerated: false,
    mastered: false
  }));
  emit('flashcards:create-from-mistakes', {
    records,
    onComplete(added) {
      state.currentQuiz.madeFlashcards = true;
      setStatus('quiz-status', `Added ${added} flashcards from your mistakes.`);
      $('mistakes-to-cards-btn').disabled = true;
      $('mistakes-to-cards-btn').textContent = 'Flashcards added';
    },
    onError(error) {
      setStatus('quiz-status', error?.message || 'Could not create flashcards from mistakes.');
    }
  });
}

export function init(deps = {}) {
  callAI = deps.callAI || callAI;
  aiDocumentPayload = deps.aiDocumentPayload || aiDocumentPayload;
  activatePage = deps.activatePage || activatePage;
  renderProgress = deps.renderProgress || renderProgress;

  $('generate-quiz-btn')?.addEventListener('click', generateQuiz);
  $('quiz-mode-one')?.addEventListener('click', () => {
    if (!state.currentQuiz || state.currentQuiz.graded) return;
    collectQuizAnswers();
    state.currentQuiz.mode = 'one';
    renderQuizView();
  });
  $('quiz-mode-all')?.addEventListener('click', () => {
    if (!state.currentQuiz || state.currentQuiz.graded) return;
    collectQuizAnswers();
    state.currentQuiz.mode = 'all';
    renderQuizView();
  });
  $('quiz-mistakes-close')?.addEventListener('click', () => $('quiz-mistakes-dialog').close());
}
