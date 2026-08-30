import $ from 'jquery';
import _ from 'lodash';
import { ActionDialog, confirm } from 'vj/components/dialog';
import Notification from 'vj/components/notification';
import { NamedPage } from 'vj/misc/Page';
import { i18n, request } from 'vj/utils';

const page = new NamedPage('manage_user_expiration', () => {
  const setDialog = new ActionDialog({ $body: $('.dialog__body--set-expiration > div') });
  const adjustDialog = new ActionDialog({ $body: $('.dialog__body--adjust-expiration > div') });

  function selectedUsers() {
    const users = _.map(
      $('.account-expiration-users tbody [type="checkbox"]:checked'),
      (checkbox) => +$(checkbox).closest('tr').attr('data-uid'),
    );
    if (!users.length) Notification.error(i18n('Please select at least one user to perform this operation.'));
    return users;
  }

  async function submit(payload) {
    try {
      await request.post('', payload);
      Notification.success(i18n('Account expiration has been updated.'));
      window.location.reload();
    } catch (error) {
      Notification.error(error.message);
    }
  }

  async function openSetDialog(uids, value = '') {
    setDialog.clear();
    const input = setDialog.$dom.find('[name="expireDate"]').get(0);
    if (input._flatpickr) {
      input._flatpickr.clear();
      if (value) input._flatpickr.setDate(value, false);
    } else $(input).val(value);
    if (await setDialog.open() !== 'ok') return;
    const expireDate = setDialog.$dom.find('[name="expireDate"]').val();
    if (!expireDate) {
      Notification.error(i18n('Expiration date is required.'));
      return;
    }
    await submit({ operation: 'set', uids, expireDate });
  }

  $('[name="set_expiration"]').click(async () => {
    const uids = selectedUsers();
    if (uids.length) await openSetDialog(uids);
  });

  $('[name="edit_expiration"]').click(async (event) => {
    const row = $(event.currentTarget).closest('tr');
    await openSetDialog([+row.attr('data-uid')], row.attr('data-expire-date'));
  });

  $('[name="adjust_expiration"]').click(async () => {
    const uids = selectedUsers();
    if (!uids.length) return;
    const missingExpireDate = $('.account-expiration-users tbody [type="checkbox"]:checked').closest('tr').toArray()
      .some((row) => !$(row).attr('data-expire-date'));
    if (missingExpireDate) {
      Notification.error(i18n('Every selected account must already have a finite expiration.'));
      return;
    }
    adjustDialog.clear();
    if (await adjustDialog.open() !== 'ok') return;
    const days = adjustDialog.$dom.find('[name="days"]').val();
    if (!days || +days === 0) {
      Notification.error(i18n('Days to adjust must be a non-zero integer.'));
      return;
    }
    await submit({ operation: 'adjust', uids, days });
  });

  $('[name="clear_expiration"]').click(async () => {
    const uids = selectedUsers();
    if (!uids.length) return;
    if (await confirm(i18n('Set the selected accounts to never expire?'))) {
      await submit({ operation: 'clear', uids });
    }
  });
});

export default page;
