import Clipboard from 'clipboard';
import $ from 'jquery';
import Notification from 'vj/components/notification';
import { NamedPage } from 'vj/misc/Page';
import { delay, i18n, request } from 'vj/utils';

const POLL_INTERVAL_MS = 2000;

interface OcrJob {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: { done: number, total: number };
  markdown?: string;
  pages?: number;
  error?: string;
}

export default new NamedPage('markdown_ocr', () => {
  const $file = $('[name="file"]');
  const $submit = $('[name="ocr_submit"]');
  const $status = $('[name="ocr_status"]');
  const $resultSection = $('[name="ocr_result_section"]');
  const $result = $('[name="ocr_result"]');
  if (!$file.length || !$submit.length) return;

  const copyButton = $('[name="ocr_copy"]')[0];
  if (copyButton) {
    const clip = new Clipboard(copyButton, { text: () => String($result.val() || '') });
    clip.on('success', () => Notification.success(i18n('Content copied to clipboard!'), 1000));
    clip.on('error', () => Notification.error(i18n('Copy failed :(')));
  }

  const setStatus = (text: string) => {
    $status.text(text).prop('hidden', !text);
  };

  async function poll(jobId: string): Promise<OcrJob> {
    for (;;) {
      await delay(POLL_INTERVAL_MS);

      const job: OcrJob = await request.get(`${window.location.pathname}/${jobId}`);
      if (job.status === 'completed') return job;
      if (job.status === 'failed') throw new Error(job.error || i18n('Markdown OCR failed.'));
      setStatus(job.progress?.total
        ? i18n('Processing page {0} / {1}...', String(job.progress.done), String(job.progress.total))
        : i18n('Processing...'));
    }
  }

  $submit.on('click', async () => {
    const file = ($file[0] as HTMLInputElement).files?.[0];
    if (!file) {
      Notification.error(i18n('Please select a file first.'));
      return;
    }
    const data = new FormData();
    data.append('file', file);
    const profileId = String($('[name="profileId"]').val() || '');
    if (profileId) data.append('profileId', profileId);
    $submit.prop('disabled', true);
    try {
      setStatus(i18n('Uploading...'));
      const res = await request.postFile('', data);
      const job = await poll(res.jobId);
      $result.val(job.markdown || '');
      $resultSection.prop('hidden', false);
      setStatus('');
      Notification.success(i18n('Conversion finished.'));
    } catch (e) {
      setStatus('');
      Notification.error((e as Error).message);
    } finally {
      $submit.prop('disabled', false);
    }
  });
});
