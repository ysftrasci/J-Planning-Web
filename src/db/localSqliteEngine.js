// J-Planning — Yerel Misafir (Guest) SQLite Motoru
//
// WebAssembly sql.js + IndexedDB kalıcılığı ile çalışır.
// TursoConnection sınıfı ile birebir aynı asenkron arayüze (execAsync, runAsync, getFirstAsync, getAllAsync vb.) sahiptir.
// Repository dosyaları hangi motorla konuştuğunu bilmeden şeffaf biçimde çalışır.

import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { openDB } from 'idb';
import schemaSql from '../../schema.sql?raw';

const IDB_NAME = 'jplanning-sqlite-store';
const IDB_VERSION = 1;
const IDB_STORE = 'databases';
export const GUEST_DB_KEY = 'jplanning_guest.db';
export const GUEST_BACKUP_KEY = 'jplanning_guest_backup.db';

let sqlJsModule = null;
let activeGuestConnection = null;

async function getSqlJs() {
  if (!sqlJsModule) {
    sqlJsModule = await initSqlJs({ locateFile: () => sqlWasmUrl });
  }
  return sqlJsModule;
}

async function getIdb() {
  return openDB(IDB_NAME, IDB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(IDB_STORE)) {
        database.createObjectStore(IDB_STORE);
      }
    },
  });
}

export class LocalSqliteConnection {
  constructor(sqlDbInstance) {
    this._db = sqlDbInstance;
    this._closed = false;
    this._saveTimer = null;
    this._isSaving = false;
    this._hasPendingSave = false;
    activeGuestConnection = this;

    this._boundBeforeUnload = () => {
      this.flushSync();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this._boundBeforeUnload);
    }
  }

  // Değişiklikleri IndexedDB'ye 300ms debounce ile yazar
  _scheduleSave() {
    if (this._closed) return;
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
    }
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.flush();
    }, 300);
  }

  async flush() {
    if (this._closed || !this._db) return;
    if (this._isSaving) {
      this._hasPendingSave = true;
      return;
    }
    this._isSaving = true;
    try {
      const binaryData = this._db.export();
      const idb = await getIdb();
      await idb.put(IDB_STORE, binaryData, GUEST_DB_KEY);
    } catch (err) {
      console.warn('[LocalSqlite] IndexedDB kaydetme hatası:', err);
    } finally {
      this._isSaving = false;
      if (this._hasPendingSave) {
        this._hasPendingSave = false;
        this.flush();
      }
    }
  }

  flushSync() {
    if (this._closed || !this._db) return;
    try {
      const binaryData = this._db.export();
      // beforeunload sırasında idb asenkron olduğundan acil kayıt denemesi
      getIdb().then((idb) => {
        idb.put(IDB_STORE, binaryData, GUEST_DB_KEY).catch(() => {});
      }).catch(() => {});
    } catch (_) {}
  }

  async execAsync(sql) {
    if (this._closed) throw new Error('Veritabanı bağlantısı kapalı.');
    this._db.exec(sql);
    this._scheduleSave();
    return [];
  }

  async runAsync(sql, params = []) {
    if (this._closed) throw new Error('Veritabanı bağlantısı kapalı.');
    this._db.run(sql, params);
    this._scheduleSave();
    return { rows: [] };
  }

  async getFirstAsync(sql, params = []) {
    if (this._closed) throw new Error('Veritabanı bağlantısı kapalı.');
    const stmt = this._db.prepare(sql);
    stmt.bind(params);
    let row = null;
    if (stmt.step()) {
      row = stmt.getAsObject();
    }
    stmt.free();
    return row;
  }

  async getAllAsync(sql, params = []) {
    if (this._closed) throw new Error('Veritabanı bağlantısı kapalı.');
    const stmt = this._db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  async exec(sql) {
    return this.execAsync(sql);
  }
  async run(sql, params) {
    return this.runAsync(sql, params);
  }
  async getFirst(sql, params) {
    return this.getFirstAsync(sql, params);
  }
  async getAll(sql, params) {
    return this.getAllAsync(sql, params);
  }

  close() {
    if (this._closed) return;
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this._boundBeforeUnload);
    }
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    try {
      this.flushSync();
      this._db.close();
    } catch (_) {}
    this._closed = true;
  }
}

/**
 * Yerel misafir veritabanını başlatır.
 * Varsa IndexedDB'deki 'jplanning_guest.db'yi yükler, yoksa boş veritabanı açıp şemayı kurar.
 */
export async function openGuestLocalDatabase() {
  const SQL = await getSqlJs();
  const idb = await getIdb();
  const existingBytes = await idb.get(IDB_STORE, GUEST_DB_KEY);

  let sqlDbInstance;
  let isNew = false;

  if (existingBytes && existingBytes instanceof Uint8Array && existingBytes.length > 0) {
    try {
      sqlDbInstance = new SQL.Database(existingBytes);
    } catch (corruptErr) {
      console.warn('[LocalSqlite] Bozuk yerel veritabanı, sıfırdan oluşturuluyor:', corruptErr);
      sqlDbInstance = new SQL.Database();
      isNew = true;
    }
  } else {
    sqlDbInstance = new SQL.Database();
    isNew = true;
  }

  const conn = new LocalSqliteConnection(sqlDbInstance);

  if (isNew) {
    // Şemayı yükle
    await conn.execAsync(schemaSql);
  }

  return conn;
}

/**
 * Kayıt olma anında çağrılır:
 * IndexedDB'deki jplanning_guest.db'yi doğrudan okur, yeni kullanıcının UID anahtarına kopyalar.
 * Güvenlik için bir kopyasını jplanning_guest_backup.db olarak saklar.
 */
export async function bridgeGuestDataToNewUser(newUid) {
  if (!newUid) return false;
  try {
    if (activeGuestConnection) {
      await activeGuestConnection.flush().catch(() => {});
    }
    const idb = await getIdb();
    const guestBytes = await idb.get(IDB_STORE, GUEST_DB_KEY);
    if (!guestBytes || !(guestBytes instanceof Uint8Array) || guestBytes.length === 0) {
      return false; // Taşınacak misafir verisi yok
    }

    const safeUid = String(newUid).replace(/[^a-zA-Z0-9_-]/g, '');

    // 1. Güvenlik yedeği oluştur
    await idb.put(IDB_STORE, guestBytes, GUEST_BACKUP_KEY);

    // 2. Yeni kullanıcının beklenen anahtarlarına yaz (migrationService doğrudan bulsun)
    await idb.put(IDB_STORE, guestBytes, `jplanning_${safeUid}.db`);
    await idb.put(IDB_STORE, guestBytes, `jplanning_${safeUid}`);

    return true;
  } catch (err) {
    console.error('[LocalSqlite] Misafir verisi kullanıcıya kopyalanırken hata:', err);
    return false;
  }
}

/**
 * Turso aktarımı başarıyla doğrulandıktan sonra çağrılır:
 * jplanning_guest.db ve yedekleri temizler.
 */
export async function finalizeGuestMigration() {
  try {
    const idb = await getIdb();
    await idb.delete(IDB_STORE, GUEST_DB_KEY).catch(() => {});
    await idb.delete(IDB_STORE, GUEST_BACKUP_KEY).catch(() => {});
  } catch (_) {}
}

/**
 * Turso aktarımı başarısız olursa çağrılır:
 * Yedekten jplanning_guest.db'yi geri yükler, hiçbir veri kaybolmaz.
 */
export async function rollbackGuestMigration() {
  try {
    const idb = await getIdb();
    const backupBytes = await idb.get(IDB_STORE, GUEST_BACKUP_KEY);
    if (backupBytes && backupBytes instanceof Uint8Array) {
      await idb.put(IDB_STORE, backupBytes, GUEST_DB_KEY);
    }
  } catch (_) {}
}
