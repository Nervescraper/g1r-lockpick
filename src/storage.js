const LOCKS_KEY = 'g1r.locks';
const SESSION_KEY = 'g1r.session';

export function loadLocks(store) {
  const raw = store.getItem(LOCKS_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function saveLock(store, lock) {
  const locks = loadLocks(store);
  const i = locks.findIndex((l) => l.id === lock.id);
  if (i >= 0) locks[i] = lock;
  else locks.push(lock);
  store.setItem(LOCKS_KEY, JSON.stringify(locks));
  return locks;
}

export function getLock(store, id) {
  return loadLocks(store).find((l) => l.id === id) || null;
}

export function deleteLock(store, id) {
  const locks = loadLocks(store).filter((l) => l.id !== id);
  store.setItem(LOCKS_KEY, JSON.stringify(locks));
  return locks;
}

export function saveSession(store, session) {
  store.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadSession(store) {
  const raw = store.getItem(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

export { LOCKS_KEY, SESSION_KEY };
