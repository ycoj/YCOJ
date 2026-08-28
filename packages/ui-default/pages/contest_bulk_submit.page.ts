import $ from 'jquery';
import Notification from 'vj/components/notification';
import { NamedPage } from 'vj/misc/Page';
import { i18n, request, tpl } from 'vj/utils';

function userResultLabel(item: {
  kind?: 'vuser' | 'user';
  created: boolean;
  realUid?: number;
}) {
  if (item.kind === 'user') return i18n('Existing registered user');
  if (item.created) {
    return item.realUid
      ? i18n('Created virtual user (a registered user also exists)')
      : i18n('Created virtual user');
  }
  return item.realUid
    ? i18n('Existing virtual user (a registered user also exists)')
    : i18n('Existing virtual user');
}

function fileInput() {
  return $('[name="file"]').get(0) as HTMLInputElement;
}

function isZipFile(file: File) {
  return file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip';
}

function setZipFile(file: File) {
  const input = fileInput();
  if (!input) return;
  if (!isZipFile(file)) {
    Notification.error(i18n('Only zip files are allowed'));
    return;
  }
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
}

function renderResults(res: {
  dryrun?: boolean;
  users?: { uname: string, uid: number, created: boolean, kind?: 'vuser' | 'user', realUid?: number }[];
  submitted?: { uname: string, uid: number, pid: number, rid?: string }[];
  skipped?: { uname: string, problem: string, reason: string }[];
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
        <td class="col--type">${userResultLabel(item)}</td>
        <td class="col--user">${item.uname}${item.uid ? ` (${item.uid})` : ''}</td>
        <td class="col--problem"></td>
        <td class="col--detail"></td>
      </tr>
    `);
  }
  for (const item of res.submitted || []) {
    $rows.append(tpl`
      <tr>
        <td class="col--type">${i18n('Submitted')}</td>
        <td class="col--user">${item.uname}</td>
        <td class="col--problem">${item.pid}</td>
        <td class="col--detail">${item.rid || (res.dryrun ? i18n('Dry run') : '')}</td>
      </tr>
    `);
  }
  for (const item of res.skipped || []) {
    $rows.append(tpl`
      <tr>
        <td class="col--type">${i18n('Skipped')}</td>
        <td class="col--user">${item.uname || ''}</td>
        <td class="col--problem">${item.problem || ''}</td>
        <td class="col--detail">${i18n(item.reason)}</td>
      </tr>
    `);
  }
  $result.removeAttr('hidden');
  $result[0]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function syncZipModeExample() {
  const mode = String($('[name="zipMode"]:checked').val() || 'auto');
  $('[name="zip_mode_example"]').each((_, el) => {
    el.hidden = el.getAttribute('data-zip-mode') !== mode;
  });
}

const page = new NamedPage('contest_bulk_submit', () => {
  let submitting = false;
  const $submit = $('[name="bulk_submit"]');
  $(document).on('change', '[name="zipMode"]', syncZipModeExample);
  syncZipModeExample();

  $(document).on('change', '[name="file"]', () => {
    const input = fileInput();
    const file = input?.files?.[0];
    if (file && !isZipFile(file)) {
      Notification.error(i18n('Only zip files are allowed'));
      if (input) input.value = '';
    }
  });
  $(document).on('dragover', '[name="zip_dropzone"]', (ev) => {
    ev.preventDefault();
  });
  $(document).on('drop', '[name="zip_dropzone"]', (ev) => {
    ev.preventDefault();
    const file = ev.originalEvent?.dataTransfer?.files?.[0];
    if (file) setZipFile(file);
  });

  $(document).on('submit', '[name="bulk_submit_form"]', async (ev) => {
    ev.preventDefault();
    if (submitting) return;
    const file = fileInput()?.files?.[0];
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
    data.append('existingUser', String($('[name="existingUser"]:checked').val() || 'existing'));
    data.append('zipMode', String($('[name="zipMode"]:checked').val() || 'auto'));
    submitting = true;
    $submit.prop('disabled', true);
    try {
      Notification.info(i18n('Uploading files...'));
      const res = await request.postFile('', data);
      renderResults(res);
      Notification.success(res.dryrun ? i18n('Dry run finished.') : i18n('Bulk submit finished.'));
    } catch (e) {
      Notification.error(e.message);
    } finally {
      submitting = false;
      $submit.prop('disabled', false);
    }
  });
});

export default page;
