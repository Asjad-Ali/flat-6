import { useMemo, useState, type ReactNode } from 'react';

import { createExpense, deleteExpense, updateExpense } from '../db/expenses';
import { createMember, removeMember, restoreMember, updateMember } from '../db/members';
import { createSettlement, deleteSettlement } from '../db/settlements';
import { useDb } from '../hooks/data';
import { DataVersionContext, StoreContext, type Store } from './context';

/** Local-only mode: everything is stored on this phone, no login, no restrictions. */
export function LocalStoreProvider({ children }: { children: ReactNode }) {
  const db = useDb();
  const [version, setVersion] = useState(0);

  const store = useMemo<Store>(() => {
    const changed = <T,>(p: Promise<T>) =>
      p.then((r) => {
        setVersion((v) => v + 1);
        return r;
      });
    return {
      mode: 'local',
      me: null,
      sync: { status: 'idle', lastSyncedAt: null },
      canEdit: () => true,
      canManageMembers: true,
      saveExpense: (id, input, opts) =>
        changed(id ? updateExpense(db, id, input, opts).then(() => id) : createExpense(db, input, opts)),
      deleteExpense: (id) => changed(deleteExpense(db, id)),
      createSettlement: (input, opts) => changed(createSettlement(db, input, opts)),
      deleteSettlement: (id) => changed(deleteSettlement(db, id)),
      saveMember: (id, input) => changed(id ? updateMember(db, id, input).then(() => id) : createMember(db, input)),
      removeMember: (id) => changed(removeMember(db, id)),
      restoreMember: (id) => changed(restoreMember(db, id)),
      refresh: async () => setVersion((v) => v + 1),
      signOut: async () => {},
    };
  }, [db]);

  return (
    <StoreContext.Provider value={store}>
      <DataVersionContext.Provider value={version}>{children}</DataVersionContext.Provider>
    </StoreContext.Provider>
  );
}
