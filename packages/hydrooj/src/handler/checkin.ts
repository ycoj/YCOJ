import { Context } from '../context';
import { toCheckinRecord } from '../lib/checkin';
import { PRIV } from '../model/builtin';
import * as checkin from '../model/checkin';
import { Handler } from '../service/server';

class CheckinHandler extends Handler {
    async post() {
        const today = await checkin.getToday(this.user._id);
        if (today.record) {
            this.response.body = {
                created: false,
                record: toCheckinRecord(today.record),
            };
            return;
        }

        await this.limitRate('checkin', 60, 5, '{{user}}');
        const result = await checkin.add(this.user._id);
        this.response.body = {
            created: result.created,
            record: toCheckinRecord(result.data),
        };
    }
}

export function apply(ctx: Context) {
    ctx.Route('checkin', '/checkin', CheckinHandler, PRIV.PRIV_USER_PROFILE);
    ctx.i18n.load('zh', {
        'External Hitokoto service unavailable. Please try again later.': '外部一言服务不可用，请稍后重试。',
    });
    ctx.i18n.load('zh_TW', {
        'External Hitokoto service unavailable. Please try again later.': '外部一言服務不可用，請稍後重試。',
    });
}
