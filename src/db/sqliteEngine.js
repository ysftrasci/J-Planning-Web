// J-Planning — Turso SQLite Motoru (Web)
//
// Eski sql.js + IndexedDB motorunun yerini alan, doğrudan Turso bulut
// veritabanı ile HTTP/Web fetch protokolü üzerinden haberleşen asenkron motor.
//
// Özellikler:
// 1. Asenkron Sorgu İcrası: @libsql/client/web üzerinden executeMultiple ve execute.
// 2. Proaktif Token Kontrolü: Token süresi bitmeden önce otomatik yenileme.
// 3. Reaktif 401 Yeniden Deneme: 401 Unauthorized durumunda anında token tazeleyip sorguyu tekrarlama.

import { createClient } from '@libsql/client/web';

export class TursoConnection {
  constructor(dbUrl, token, tokenManager = null) {
    this._dbUrl = dbUrl;
    this._token = token;
    this._tokenManager = tokenManager;
    this._client = createClient({
      url: this._dbUrl,
      authToken: this._token,
    });
    this._closed = false;
  }

  // Token yöneticisi üzerinden token'ı güncelle ve yeni istemci oluştur
  updateToken(newToken) {
    this._token = newToken;
    this._client = createClient({
      url: this._dbUrl,
      authToken: this._token,
    });
  }

  _isAuthError(err) {
    if (!err) return false;
    const msg = String(err.message || err).toLowerCase();
    return (
      msg.includes('unauthorized') ||
      msg.includes('401') ||
      msg.includes('expired') ||
      msg.includes('jwt') ||
      msg.includes('token')
    );
  }

  async _ensureValidToken() {
    if (this._tokenManager?.ensureFreshToken) {
      const freshToken = await this._tokenManager.ensureFreshToken();
      if (freshToken && freshToken !== this._token) {
        this.updateToken(freshToken);
      }
    }
  }

  async _refreshToken() {
    if (this._tokenManager?.forceRefreshToken) {
      const newToken = await this._tokenManager.forceRefreshToken();
      if (newToken) {
        this.updateToken(newToken);
      }
    }
  }

  // Birden fazla SQL ifadesini ; ile ayrılmış şekilde çalıştırır.
  async execAsync(sql) {
    if (this._closed) throw new Error('Veritabanı bağlantısı kapalı.');
    await this._ensureValidToken();
    try {
      return await this._client.executeMultiple(sql);
    } catch (err) {
      if (this._isAuthError(err)) {
        await this._refreshToken();
        return await this._client.executeMultiple(sql);
      }
      throw err;
    }
  }

  // Parametreli tek bir INSERT/UPDATE/DELETE/SELECT çalıştırır.
  async runAsync(sql, params = []) {
    if (this._closed) throw new Error('Veritabanı bağlantısı kapalı.');
    await this._ensureValidToken();
    try {
      return await this._client.execute({ sql, args: params });
    } catch (err) {
      if (this._isAuthError(err)) {
        await this._refreshToken();
        return await this._client.execute({ sql, args: params });
      }
      throw err;
    }
  }

  // Parametreli bir SELECT çalıştırıp İLK satırı (obje olarak) döndürür, yoksa null.
  async getFirstAsync(sql, params = []) {
    const result = await this.runAsync(sql, params);
    return result.rows && result.rows.length > 0 ? result.rows[0] : null;
  }

  // Parametreli bir SELECT çalıştırıp TÜM satırları (obje dizisi) döndürür.
  async getAllAsync(sql, params = []) {
    const result = await this.runAsync(sql, params);
    return result.rows ? Array.from(result.rows) : [];
  }

  // Kısa isimlendirme aliasları
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

  // Eski senkron metodları çağıran yerler için uyarıcı hata
  execSync() {
    throw new Error('Turso bağlantısı asenkrondur. Lütfen await execAsync(...) kullanın.');
  }
  runSync() {
    throw new Error('Turso bağlantısı asenkrondur. Lütfen await runAsync(...) kullanın.');
  }
  getFirstSync() {
    throw new Error('Turso bağlantısı asenkrondur. Lütfen await getFirstAsync(...) kullanın.');
  }
  getAllSync() {
    throw new Error('Turso bağlantısı asenkrondur. Lütfen await getAllAsync(...) kullanın.');
  }

  close() {
    this._closed = true;
  }

  closeSync() {
    this.close();
  }
}

export function openTursoConnection(dbUrl, token, tokenManager = null) {
  return new TursoConnection(dbUrl, token, tokenManager);
}
