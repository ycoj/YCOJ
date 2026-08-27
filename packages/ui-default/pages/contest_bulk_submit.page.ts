import $ from 'jquery';
import Notification from 'vj/components/notification';
import { NamedPage } from 'vj/misc/Page';
import { i18n, request, tpl } from 'vj/utils';

function renderResults(res: {
  dryrun?: boolean;
  users?: { uname: string; uid: number; created: boolean }[];
  submitted?: { uname: string; uid: number; pid: number; rid?: string }[];
  skipped?: { uname: string; problem: string; reason: string }[];
}) {
  const $result = $('[name="bulk_submit_result"]');
  const $rows = $('[name="bulk_submit_rows"]');
  $rows.empty();
  const created = (res.users || []).filter((u) => u.created).length;
  $('[name="bulk_submit_summary"]').text(i18n(
    'Submitted {0}, skipped {1}, virtual users {2} ({3} new).',
    res.submitted?.length || 0,
    res.skipped?.length || 0,
    res.users?.length || 0,
    created,
  ));
  for (const item of res.users || []) {
    $rows.append(tpl`
      <tr>
        <td>${i18n(item.created ? 'Created virtual user' : 'Existing virtual user')}</td>
        <td>${item.uname}${item.uid ? ` (${item.uid})` : ''}</td>
        <td></td>
        <td></td>
      </tr>
    `);
  }
  for (const item of res.submitted || []) {
    $rows.append(tpl`
      <tr>
        <td>${i18n('Submitted')}</td>
        <td>${item.uname}</td>
        <td>${item.pid}</td>
        <td>${item.rid || (res.dryrun ? i18n('Dry run') : '')}</td>
      </tr>
    `);
  }
  for (const item of res.skipped || []) {
    $rows.append(tpl`
      <tr>
        <td>${i18n('Skipped')}</td>
        <td>${item.uname || ''}</td>
        <td>${item.problem || ''}</td>
        <td>${i18n(item.reason)}</td>
      </tr>
    `);
  }
  $result.removeAttr('hidden');
}

const page = new NamedPage('contest_bulk_submit', () => {
  let submitting = false;
  $(document).on('submit', '[name="bulk_submit_form"]', async (ev) => {
    ev.preventDefault();
    if (submitting) return;
    const input = $('[name="file"]').get(0) as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) {
      Notification.error(i18n('Please select a zip file.'));
      return;
    }
    const mapping: Record<string, string> = {};
    $('[name^="mapping_"]').each((_, el) => {
      const pid = $(el).data('pid');
      mapping[pid] = String($(el).val() || '').trim();
    });
    const data = new FormData();
    data.append('file', file);
    data.append('filename', file.name);
    data.append('mapping', JSON.stringify(mapping));
    data.append('lang', String($('[name="lang"]').val() || ''));
    if ($('[name="dryrun"]').prop('checked')) data.append('dryrun', 'on');
    submitting = true;
    try {
      Notification.info(i18n('Uploading files...'));
      const res = await request.postFile('', data);
      renderResults(res);
      Notification.success(res.dryrun ? i18n('Dry run finished.') : i18n('Bulk submit finished.'));
    } catch (e) {
      Notification.error(e.message);
    } finally {
      submitting = false;
    }
  });
});

export default page;
