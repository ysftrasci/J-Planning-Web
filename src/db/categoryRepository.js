import { getDb } from './database';
import { uuid } from './taskRepository';

export function createCategory(name, color) {
  const db = getDb();
  const id = uuid();
  db.runSync('INSERT INTO categories (id, name, color, createdAt) VALUES (?, ?, ?, ?)', [
    id,
    name,
    color ?? '#C98A2C',
    Date.now(),
  ]);
  return id;
}

export function getCategories() {
  const db = getDb();
  return db.getAllSync('SELECT * FROM categories ORDER BY createdAt ASC');
}

export function deleteCategory(id) {
  const db = getDb();
  db.runSync('UPDATE tasks SET categoryId = NULL WHERE categoryId = ?', [id]);
  db.runSync('DELETE FROM categories WHERE id = ?', [id]);
}

export function ensureDefaultCategories() {
  const existing = getCategories();
  if (existing.length > 0) return;
  const defaults = [
    { name: 'Kişisel', color: '#C98A2C' },
    { name: 'İş', color: '#5B8A6B' },
    { name: 'Sağlık', color: '#C4512E' },
  ];
  defaults.forEach((c) => createCategory(c.name, c.color));
}
