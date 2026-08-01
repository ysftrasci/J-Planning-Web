// J-Planning — sql.js + IndexedDB Motoru (Web)
//
// Mobildeki expo-sqlite'ın senkron API'sini (execSync / runSync / getFirstSync /
// getAllSync / closeSync) taklit eden ince bir sarmalayıcı. Böylece database.js
// ve repository dosyaları mobil koddan neredeyse değişmeden taşınabiliyor.
//
// ÇALIŞMA MANTIĞI:
// - sql.js tarayıcıda WebAssembly ile çalışan, bellek-içi bir SQLite motorudur.
//   Kendi başına diske/IndexedDB'ye yazmaz — veritabanının tamamı bir
//   Uint8Array (byte dizisi) olarak bellekte tutulur.
// - Uygulama açılışında (initSqliteDatabase) bu byte dizisi IndexedDB'den
//   okunur (varsa) ve sql.js'e yüklenir; yoksa boş bir veritabanı oluşturulur.
// - Her yazma işleminden (INSERT/UPDATE/DELETE) sonra, güncel byte dizisi
//   IndexedDB'ye geri yazılır (persistNow / persistDebounced). Bu sayede
//   tarayıcı kapansa bile veri kalıcı olur.
// - sql.js'in kendi API'si senkron (db.run/db.exec) olduğu için, IndexedDB'ye
//   yazma dışındaki tüm işlemler (execSync/runSync/getFirstSync/getAllSync)
//   gerçekten senkrondur — mobildeki kodla birebir aynı şekilde çağrılabilir.
//   Sadece motorun İLK YÜKLENMESİ (initSqliteDatabase) asenkrondur.

import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { openDB } from 'idb';

const IDB_NAME = 'jplanning-sqlite-store';
const IDB_VERSION = 1;
const IDB_STORE = 'databases';

let SQL = null; // sql.js modülü (initSqlJs sonucu), bir kez yüklenir ve paylaşılır
let idbPromise = null;

function getIdb() {
  if (!idbPromise) {
    idbPromise = openDB(IDB_NAME, IDB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(IDB_STORE)) {
          database.createObjectStore(IDB_STORE);
        }
      },
    });
  }
  return idbPromise;
}

async function loadDatabaseBytes(dbName) {
  const idb = await getIdb();
  const bytes = await idb.get(IDB_STORE, dbName);
  return bytes || null;
}

async function saveDatabaseBytes(dbName, bytes) {
  const idb = await getIdb();
  await idb.put(IDB_STORE, bytes, dbName);
}

// SqliteConnection: expo-sqlite'ın openDatabaseSync sonucuna benzer bir arayüz sunar.
class SqliteConnection {
  constructor(sqlJsDb, dbName) {
    this._db = sqlJsDb;
    this._dbName = dbName;
    this._pendingPersist = null;
    this._closed = false;
  }

  // Birden fazla ifadeyi (statement) ; ile ayrılmış şekilde çalıştırır.
  // Dönüş değeri yoktur (mobildeki execSync ile aynı davranış).
  execSync(sql) {
    this._db.run(sql);
    this._schedulePersist();
  }

  // Parametreli TEK bir INSERT/UPDATE/DELETE çalıştırır.
  runSync(sql, params = []) {
    const stmt = this._db.prepare(sql);
    try {
      stmt.bind(params);
      stmt.step();
    } finally {
      stmt.free();
    }
    this._schedulePersist();
  }

  // Parametreli bir SELECT çalıştırıp İLK satırı (obje olarak) döndürür, yoksa null.
  getFirstSync(sql, params = []) {
    const stmt = this._db.prepare(sql);
    try {
      stmt.bind(params);
      if (stmt.step()) {
        return stmt.getAsObject();
      }
      return null;
    } finally {
      stmt.free();
    }
  }

  // Parametreli bir SELECT çalıştırıp TÜM satırları (obje dizisi) döndürür.
  getAllSync(sql, params = []) {
    const stmt = this._db.prepare(sql);
    const rows = [];
    try {
      stmt.bind(params);
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
    } finally {
      stmt.free();
    }
    return rows;
  }

  // Bağlantıyı kapatır. Kapatmadan önce bekleyen bir persist varsa hemen uygulanır.
  closeSync() {
    if (this._closed) return;
    this._persistNow();
    this._db.close();
    this._closed = true;
  }

  // Yazma işleminden hemen sonra IndexedDB'ye kaydetmeyi tetikler.
  // Art arda gelen çok sayıda yazmada (ör. toplu görev tamamlama) her seferinde
  // diske yazmak yerine, kısa bir gecikmeyle (debounce) tek seferde kaydedilir.
  _schedulePersist() {
    if (this._pendingPersist) {
      clearTimeout(this._pendingPersist);
    }
    this._pendingPersist = setTimeout(() => {
      this._pendingPersist = null;
      this._persistNow();
    }, 150);
  }

  // Şu ana kadarki tüm değişiklikleri senkron olarak dışa aktarıp IndexedDB'ye
  // yazar. Ağ/IO beklemeden dönmesi gerekmediği için "fire and forget" şeklinde
  // çağrılabilir; hata olursa konsola loglanır (kullanıcı akışını bozmasın diye).
  _persistNow() {
    if (this._pendingPersist) {
      clearTimeout(this._pendingPersist);
      this._pendingPersist = null;
    }
    try {
      const bytes = this._db.export();
      // saveDatabaseBytes asenkron ama burada beklemiyoruz (fire-and-forget);
      // repository fonksiyonları senkron kalmaya devam ediyor.
      saveDatabaseBytes(this._dbName, bytes).catch((err) => {
        console.error('Veritabanı IndexedDB\'ye kaydedilemedi:', err);
      });
    } catch (err) {
      console.error('Veritabanı dışa aktarılamadı (export):', err);
    }
  }
}

// sql.js modülünü bir kez yükler (wasm dosyasını indirir/derler) ve paylaşır.
async function ensureSqlJsLoaded() {
  if (!SQL) {
    SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
  }
  return SQL;
}

// Verilen isimdeki veritabanını IndexedDB'den yükler (varsa) ya da yeni
// oluşturur, ardından SqliteConnection olarak döndürür.
// NOT: Bu fonksiyon ASENKRON'dur (sql.js'in ilk yüklenmesi ve IndexedDB
// okuması nedeniyle) — mobildeki switchToUserDatabase senkrondu, bu farkı
// database.js katmanında (initDatabase artık async) karşılıyoruz.
export async function openSqliteConnection(dbName) {
  const sqlJs = await ensureSqlJsLoaded();
  const existingBytes = await loadDatabaseBytes(dbName);
  const sqlJsDb = existingBytes ? new sqlJs.Database(existingBytes) : new sqlJs.Database();
  return new SqliteConnection(sqlJsDb, dbName);
}

// Verilen isimdeki veritabanı kaydını IndexedDB'den tamamen kaldırır.
// Hesap silme akışında (services/deleteAccountService.js) kullanılır.
export async function deleteDatabaseBytes(dbName) {
  const idb = await getIdb();
  await idb.delete(IDB_STORE, dbName);
}
