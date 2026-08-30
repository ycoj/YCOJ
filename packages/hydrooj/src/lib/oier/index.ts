export { checkBind, schoolsMatchCanonical } from './bind';
export type { BindOier, BindReject } from './bind';
export {
    AWARD_LEVELS, CONTEST_TYPES, MERGE_THRESHOLD, PROVINCES,
} from './constants';
export { getGrades, parseGradesConfig } from './grades';
export { ccfHookSrc, ccfHookTier } from './hook';
export { attemptMerge, recordFingerprint } from './merge';
export { loadOierDataDir, parseOierData } from './parse';
export {
    buildSchoolAliasIndex, canonicalSchoolName, normalizeSchoolName, schoolsMatch,
} from './schoolMatch';
export type { SchoolAliasIndex } from './schoolMatch';
export type {
    CcfHookTier, OierDataFiles, ParsedOier, ParsedOierRecord, ParseResult, ParseWarning,
} from './types';
