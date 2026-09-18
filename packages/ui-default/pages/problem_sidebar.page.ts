import $ from 'jquery';
import { confirm, prompt } from 'vj/components/dialog';
import Notification from 'vj/components/notification';
import { NamedPage } from 'vj/misc/Page';
import { i18n, request } from 'vj/utils';

const page = new NamedPage([
  'problem_create', 'problem_edit', 'problem_solution', 'problem_submit',
  'problem_config', 'problem_statistics', 'problem_files', 'problem_detail',
  'discussion_node', 'discussion_detail',
], () => {
  $(document).on('click', '[name="problem-sidebar__show-category"]', (ev) => {
    $(ev.currentTarget).hide();
    $('[name="problem-sidebar__categories"]').show();
  });
  $(document).on('click', '[name="problem-sidebar__rejudge"]', (ev) => {
    ev.preventDefault();
    confirm(i18n('Confirm rejudge this problem?')).then((yes) => {
      if (yes) $(ev.currentTarget).closest('form').trigger('submit');
    });
  });
  $(document).on('click', '[name="problem-sidebar__copy"]', async () => {
    const res = await prompt(i18n('Copy Problem'), {
      target: {
        type: 'domain',
        label: i18n('Target'),
        required: true,
        autofocus: true,
      },
    });
    if (!res?.target) return;
    try {
      const { url } = await request.post('.', {
        operation: 'copy',
        pids: [UiContext.problemNumId],
        target: res.target,
        redirect: true,
      });
      window.location.href = url;
    } catch (error) {
      Notification.error(error.message);
    }
  });
  $(document).on('click', '[name="problem-sidebar__feedback"]', async () => {
    const res = await prompt(i18n('Report Problem Issue'), {
      content: {
        type: 'textarea',
        label: i18n('Briefly describe the problem'),
        required: true,
        autofocus: true,
      },
    });
    const content = res?.content?.trim();
    if (!content) return;
    if (content.length > 1000) {
      Notification.error(i18n('Feedback must be 1000 characters or fewer.'));
      return;
    }
    try {
      await request.post(`./${UiContext.problemNumId}/feedback`, {
        content,
        tid: UiContext.tdoc?._id,
      });
      Notification.success(i18n('Problem feedback submitted.'));
    } catch (error) {
      Notification.error(error.message);
    }
  });
});

export default page;
