import { initializeDatabase } from './database';

export async function getSetting(key: string): Promise<string | null> {
  const database = await initializeDatabase();
  const row = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ? LIMIT 1',
    key,
  );
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  const database = await initializeDatabase();
  await database.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value,
  );
}

export async function deleteSetting(key: string) {
  const database = await initializeDatabase();
  await database.runAsync('DELETE FROM settings WHERE key = ?', key);
}
