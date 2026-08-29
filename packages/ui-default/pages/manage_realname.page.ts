import $ from 'jquery';
import { confirm, prompt } from 'vj/components/dialog';
import Notification from 'vj/components/notification';
import { NamedPage } from 'vj/misc/Page';
import { i18n, request } from 'vj/utils';

export default new NamedPage('manage_realname', () => {
  async function postAction(operation: string, id: string, extra: Record<string, string> = {}) {
    try {
      await request.post('', { operation, id, ...extra });
      window.location.reload();
    } catch (error) {
      Notification.error(error.message);
    }
  }

  $(document).on('click', '[name="approve"]', async (ev) => {
    const id = $(ev.currentTarget).closest('tr').attr('data-id');
    if (!(await confirm(i18n('Confirm approving this application?')))) return;
    await postAction('approve', id);
  });

  $(document).on('click', '[name="reject"]', async (ev) => {
    const id = $(ev.currentTarget).closest('tr').attr('data-id');
    if (!(await confirm(i18n('Confirm rejecting this application?')))) return;
    const res = await prompt(i18n('Rejection Reason'), {
      reason: {
        type: 'text',
        label: i18n('Optional rejection reason'),
        required: false,
      },
    });
    if (res === null) return;
    await postAction('reject', id, { reason: res.reason || '' });
  });

  $(document).on('click', '[name="revoke"]', async (ev) => {
    const id = $(ev.currentTarget).closest('tr').attr('data-id');
    if (!(await confirm(i18n('Confirm revoking this approved application? The user will lose access until they pass review again.')))) return;
    const res = await prompt(i18n('Rejection Reason'), {
      reason: {
        type: 'text',
        label: i18n('Optional rejection reason'),
        required: false,
      },
    });
    if (res === null) return;
    await postAction('revoke', id, { reason: res.reason || '' });
  });
});
