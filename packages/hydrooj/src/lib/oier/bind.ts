export type BindReject = 'missing' | 'already' | 'mismatch' | 'taken';

export function checkBind(
    oier: { name: string, uid?: number } | null,
    realName: string,
    userOierId?: number | null,
): BindReject | null {
    if (!oier) return 'missing';
    if (userOierId) return 'already';
    if (oier.name !== realName) return 'mismatch';
    if (oier.uid) return 'taken';
    return null;
}
