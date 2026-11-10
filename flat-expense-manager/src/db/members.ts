import { AppError, type Db } from './client';

export interface Member {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
  /** Login username (shared mode only). */
  username: string | null;
  isAdmin: boolean;
  createdAt: string;
}

export interface MemberInput {
  name: string;
  /** Login username; required in shared mode, ignored in local mode. */
  username?: string;
  /** Login password; only used in shared mode when the admin creates a new member. */
  password?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

interface MemberRow {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  is_active: number;
  username: string | null;
  is_admin: number;
  created_at: string;
}

const toMember = (r: MemberRow): Member => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  email: r.email,
  notes: r.notes,
  isActive: r.is_active === 1,
  username: r.username,
  isAdmin: r.is_admin === 1,
  createdAt: r.created_at,
});

const blankToNull = (v?: string) => {
  const t = v?.trim();
  return t ? t : null;
};

export type MemberFieldErrors = Partial<Record<keyof MemberInput, string>>;

export const USERNAME_PATTERN = /^[a-z0-9_.]{3,30}$/;

export function validateMember(input: MemberInput, opts: { requireUsername?: boolean; requirePassword?: boolean } = {}): MemberFieldErrors {
  const errors: MemberFieldErrors = {};
  const name = input.name.trim();
  if (name.length < 2) errors.name = 'Enter a name of at least 2 characters.';
  else if (name.length > 50) errors.name = 'Name must be 50 characters or fewer.';
  const phone = input.phone?.trim();
  if (phone && !/^\+?[\d\s-]{7,20}$/.test(phone)) errors.phone = 'Enter a valid phone number, e.g. 0300-1234567.';
  const email = input.email?.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address.';
  if ((input.notes?.length ?? 0) > 200) errors.notes = 'Notes must be 200 characters or fewer.';
  if (opts.requireUsername) {
    const username = (input.username ?? '').trim().toLowerCase();
    if (!USERNAME_PATTERN.test(username)) errors.username = 'Use 3–30 lowercase letters, numbers, _ or . (e.g. ali).';
    if (opts.requirePassword && (input.password ?? '').length < 6) errors.password = 'Password must be at least 6 characters.';
  }
  return errors;
}

function assertValid(input: MemberInput) {
  const errors = validateMember(input);
  const first = Object.values(errors)[0];
  if (first) throw new AppError('VALIDATION', first);
}

async function assertNameUnique(db: Db, name: string, excludeId?: number) {
  const clash = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM members WHERE is_active = 1 AND lower(trim(name)) = lower(?) AND id != ?',
    [name.trim(), excludeId ?? -1],
  );
  if (clash) throw new AppError('DUPLICATE', `A member named "${name.trim()}" already exists.`);
}

export async function listMembers(db: Db, opts: { includeInactive?: boolean } = {}): Promise<Member[]> {
  const rows = await db.getAllAsync<MemberRow>(
    `SELECT * FROM members ${opts.includeInactive ? '' : 'WHERE is_active = 1'}
     ORDER BY is_active DESC, name COLLATE NOCASE`,
    [],
  );
  return rows.map(toMember);
}

export async function getMember(db: Db, id: number): Promise<Member | null> {
  const row = await db.getFirstAsync<MemberRow>('SELECT * FROM members WHERE id = ?', [id]);
  return row ? toMember(row) : null;
}

export async function createMember(db: Db, input: MemberInput): Promise<number> {
  assertValid(input);
  await assertNameUnique(db, input.name);
  const res = await db.runAsync(
    'INSERT INTO members (name, phone, email, notes) VALUES (?, ?, ?, ?)',
    [input.name.trim(), blankToNull(input.phone), blankToNull(input.email), blankToNull(input.notes)],
  );
  return res.lastInsertRowId;
}

export async function updateMember(db: Db, id: number, input: MemberInput): Promise<void> {
  assertValid(input);
  if (!(await getMember(db, id))) throw new AppError('NOT_FOUND', 'Member not found.');
  await assertNameUnique(db, input.name, id);
  await db.runAsync(
    `UPDATE members SET name = ?, phone = ?, email = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
    [input.name.trim(), blankToNull(input.phone), blankToNull(input.email), blankToNull(input.notes), id],
  );
}

export async function memberHasHistory(db: Db, id: number): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM expenses WHERE paid_by = ?)
          + (SELECT COUNT(*) FROM expense_splits WHERE member_id = ?)
          + (SELECT COUNT(*) FROM settlements WHERE from_member_id = ? OR to_member_id = ?)
          + (SELECT COUNT(*) FROM distribution_shares WHERE member_id = ?)
          + (SELECT COUNT(*) FROM payments WHERE member_id = ?) AS n`,
    [id, id, id, id, id, id],
  );
  return (row?.n ?? 0) > 0;
}

/**
 * Removes a member. Members with any financial history are archived (hidden but kept),
 * so past distributions and payments remain intact. Members without history are deleted.
 */
export async function removeMember(db: Db, id: number): Promise<'deleted' | 'archived'> {
  if (!(await getMember(db, id))) throw new AppError('NOT_FOUND', 'Member not found.');
  if (await memberHasHistory(db, id)) {
    await db.runAsync(`UPDATE members SET is_active = 0, updated_at = datetime('now') WHERE id = ?`, [id]);
    return 'archived';
  }
  await db.runAsync('DELETE FROM members WHERE id = ?', [id]);
  return 'deleted';
}

export async function restoreMember(db: Db, id: number): Promise<void> {
  const member = await getMember(db, id);
  if (!member) throw new AppError('NOT_FOUND', 'Member not found.');
  await assertNameUnique(db, member.name, id);
  await db.runAsync(`UPDATE members SET is_active = 1, updated_at = datetime('now') WHERE id = ?`, [id]);
}
