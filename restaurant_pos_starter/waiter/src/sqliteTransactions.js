// Serialize transactions per SQLite connection so the outbox and catalog cache
// cannot accidentally overlap Expo SQLite transaction scopes.
const tails = new WeakMap();

export function withSerializedTransaction(db, callback) {
  if (!db || typeof db.withTransactionAsync !== 'function') {
    throw new TypeError('SQLite database must implement withTransactionAsync()');
  }
  if (typeof callback !== 'function') throw new TypeError('transaction callback is required');

  const previous = tails.get(db) ?? Promise.resolve();
  const operation = previous.then(() => db.withTransactionAsync(callback));
  tails.set(db, operation.catch(() => {}));
  return operation;
}
