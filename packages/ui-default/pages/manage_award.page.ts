import $ from 'jquery';
import { confirm } from 'vj/components/dialog';
import Notification from 'vj/components/notification';
import { NamedPage } from 'vj/misc/Page';
import { i18n, request } from 'vj/utils';

export default new NamedPage('manage_award', () => {
  $(document).on('click', '[name="unbind"]', async (ev) => {
    const uid = $(ev.currentTarget).closest('tr').attr('data-uid');
    if (!(await confirm(i18n('Confirm removing this award certification?')))) return;
    try {
      await request.post('', { operation: 'unbind', uid });
      window.location.reload();
    } catch (error) {
      Notification.error(error.message);
    }
  });
});
