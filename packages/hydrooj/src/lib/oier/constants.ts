export const PROVINCES = [
    '安徽', '北京', '福建', '甘肃', '广东', '广西', '贵州', '海南', '河北', '河南',
    '黑龙江', '湖北', '湖南', '吉林', '江苏', '江西', '辽宁', '内蒙古', '山东', '山西',
    '陕西', '上海', '四川', '天津', '新疆', '浙江', '重庆', '宁夏', '云南', '澳门',
    '香港', '青海', '西藏', '台湾',
] as const;

export const AWARD_LEVELS = [
    '金牌', '银牌', '铜牌', '一等奖', '二等奖', '三等奖',
    '国际金牌', '国际银牌', '国际铜牌', '前5%', '前15%', '前25%',
] as const;

export const CONTEST_TYPES = [
    'NOI', 'NOIP提高', 'CTSC', 'APIO', 'NOID类', 'IOI', 'NOIP普及',
    'WC', 'CSP提高', 'CSP入门', 'NOIP', 'NGOI', 'NOIST', 'WC-AI',
] as const;

export const GENDER_MAP: Record<string, number> = { 男: 1, 女: -1 };

export const CONTEST_TYPE_FAMILY: Record<string, string> = {
    CSP入门: 'CSP',
    CSP提高: 'CSP',
    NOIP普及: 'NOIP',
    NOIP提高: 'NOIP',
    NOI: 'NOI',
    NOID类: 'NOI',
};

export const SCHOOL_PENALTY: Record<number, number> = {
    0: 0,
    1: -40,
    2: 60,
    3: 120,
    4: 180,
    5: 300,
};

export const MERGE_THRESHOLD = 240;
export const PRIMARY_OR_NONE_GRADES = 4290837504n;

export const NOI_CCF_LEVEL: Record<string, number> = { 金牌: 10, 银牌: 9, 铜牌: 8 };
export const OTHER_CCF_BASE: Record<string, number> = {
    APIO: 500, CTS: 800, CTSC: 800, WC: 600,
};
export const CCF_SCORE_LEVELS: [number, number][] = [[1000, 10], [500, 9], [250, 8]];

export const SCORE_WITH_RANK = /^(\d+\.?\d+)\(rk(\d+)\)$/;

export const DEFAULT_GRADES = {
    initial: 9,
    element: {
        新: -1, 学: 0, 小: 0, 年级: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5,
        中: 6, 六: 6, 初: 6, 七: 7, 八: 8, 九: 9, 高: 9,
    },
    special: {
        '': 4294966272,
        4: 524288,
        5: 1048576,
        6: 2097152,
        小学: 64512,
        '小学/无': 4290837504,
        预初: 32768,
        初中: 458752,
        初四: 262144,
        高中: 3670016,
    },
};

export const DEFAULT_SCORING: Record<string, string> = {
    APIO: '0.4',
    CSP入门: '0.06',
    CSP提高: '0.1',
    CTSC: '0.2',
    IOI: '0.6',
    NGOI: '0.2',
    NOI: '1',
    NOID类: '0.75',
    NOIP: '0.15',
    NOIP提高: '0.1',
    NOIP普及: '0.06',
    NOIST: '0.2',
    WC: '0.5',
    'WC-AI': '0.05',
};
