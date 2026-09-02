import $ from 'jquery';
import { confirm } from 'vj/components/dialog';
import Notification from 'vj/components/notification';
import { NamedPage } from 'vj/misc/Page';
import { i18n, request } from 'vj/utils';
import { openDB } from 'vj/utils/db';

export default new NamedPage('preliminary_detail', async () => {
  const form = document.getElementById('preliminary-answer-form') as HTMLFormElement | null;
  if (!form) return;
  const context = UiContext.preliminary;
  const canSubmit = form.dataset.canSubmit === 'true';
  const cacheKey = `${UserContext._id}/${UiContext.domainId}/${context.paperId}@${context.revision}#preliminary`;
  const answers: Record<string, string> = {};
  const db = await openDB;

  const updateState = () => {
    const answered = Object.keys(answers).length;
    $('[data-answered-count]').text(answered);
    $('[data-question-link]').each((_, element) => {
      const link = element as HTMLElement;
      link.classList.toggle('is-answered', !!answers[link.dataset.questionLink]);
    });
  };
  const save = () => db.put('solutions', { id: cacheKey, value: JSON.stringify(answers) });
  const saved = await db.get('solutions', cacheKey);
  if (typeof saved?.value === 'string') {
    try {
      Object.assign(answers, JSON.parse(saved.value));
      for (const [questionId, value] of Object.entries(answers)) {
        const input = form.querySelector<HTMLInputElement>(`input[name="${CSS.escape(questionId)}"][value="${CSS.escape(value)}"]`);
        if (input) input.checked = true;
        else delete answers[questionId];
      }
    } catch {
      await db.delete('solutions', cacheKey);
    }
  }
  updateState();

  if (canSubmit) {
    form.addEventListener('change', async (event) => {
      const input = event.target as HTMLInputElement;
      if (input.type !== 'radio' || !input.checked) return;
      answers[input.name] = input.value;
      updateState();
      await save();
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      button?.setAttribute('disabled', 'disabled');
      try {
        const response = await request.post('', {
          operation: 'submit',
          revision: context.revision,
          answers,
        });
        await db.delete('solutions', cacheKey);
        window.location.href = response.url;
      } catch (error) {
        Notification.error(error.message);
        button?.removeAttribute('disabled');
      }
    });
    $('[name="clear_answers"]').on('click', async () => {
      if (!(await confirm(i18n('All changes will be lost. Are you sure to clear all answers?')))) return;
      for (const key of Object.keys(answers)) delete answers[key];
      form.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((input) => { input.checked = false; });
      await db.delete('solutions', cacheKey);
      updateState();
    });
  }

  $('[name="delete_paper"]').on('click', async () => {
    if (!(await confirm(i18n('Confirm deleting this paper? All attempts and score history will be deleted.')))) return;
    try {
      const response = await request.post('', { operation: 'delete' });
      window.location.href = response.url;
    } catch (error) {
      Notification.error(error.message);
    }
  });
});
