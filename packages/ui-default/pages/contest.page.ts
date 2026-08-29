import { formatSeconds } from '@hydrooj/utils/lib/common';
import NProgress from 'nprogress';
import { confirm } from 'vj/components/dialog';
import { NamedPage } from 'vj/misc/Page';
import { addSpeculationRules, i18n, request, tpl } from 'vj/utils';

const contestTimer = $(tpl`<pre class="contest-timer" style="display:none"></pre>`);
contestTimer.appendTo(document.body);

export default new NamedPage([
  'contest_detail', 'contest_problemlist', 'contest_detail_problem', 'contest_scoreboard',
  'contest_solution_detail', 'contest_solution_create', 'contest_solution_edit',
], (pagename) => {
  const beginAt = new Date((UiContext.tdoc.duration && UiContext.tsdoc?.startAt) || UiContext.tdoc.beginAt).getTime();
  const endAt = new Date(UiContext.tsdoc?.endAt || UiContext.tdoc.endAt).getTime();
  NProgress.configure({ trickle: false, showSpinner: false, minimum: 0 });
  function updateProgress() {
    const now = Date.now();
    if (beginAt <= now && now <= endAt) {
      NProgress.set((now - beginAt) / (endAt - beginAt));
      contestTimer.show();
      contestTimer.text(formatSeconds(Math.floor((endAt - now) / 1000)));
    } else contestTimer.hide();
  }
  NProgress.start();
  updateProgress();
  setInterval(updateProgress, 1000);

  addSpeculationRules({
    prerender: [{
      where: {
        or: [
          { href_matches: '/p/*' },
          { href_matches: '/d/*/p/*' },
        ],
      },
    }],
  });

  if (pagename === 'contest_solution_edit') {
    let confirmed = false;
    $(document).on('click', '[name="operation"][value="delete"]', (ev) => {
      ev.preventDefault();
      if (confirmed) {
        return request.post('', { operation: 'delete' }).then((res) => {
          window.location.href = res.url;
        });
      }
      return confirm(i18n('Confirm deleting this solution?')).then((yes) => {
        if (yes) {
          confirmed = true;
          ev.target.click();
        }
      });
    });
  }
});
