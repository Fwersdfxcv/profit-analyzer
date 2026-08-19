/* ============================================================
 * store.js — 本地存储（IndexedDB，带内存兜底）
 * 三个 store：
 *   files    : 上传的文件元数据 + 原始数据(ArrayBuffer) + 分析结果
 *   settings : 项目名、保存路径句柄等
 *   mapping  : 银行/支行 → { province, city, bank } 省/市映射表
 *
 * 兜底策略：若浏览器不支持 / 禁用了 IndexedDB（例如沙箱预览 WebView），
 * 自动切换到内存 Map，保证「上传→清洗→利润→下载」核心流程仍可运行。
 * 此时跨刷新不持久，但本会话内功能完整。
 * ============================================================ */
(function (global) {
  'use strict';

  let db = null;
  let useMem = false;
  const mem = { files: new Map(), settings: new Map(), mapping: new Map() };
  const DB_NAME = 'ProfitAnalyzerDB';
  const DB_VERSION = 2;

  function initDB() {
    return new Promise((res) => {
      try {
        if (typeof indexedDB === 'undefined') { useMem = true; return res(null); }
        const r = indexedDB.open(DB_NAME, DB_VERSION);
        r.onupgradeneeded = () => {
          const d = r.result;
          if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
          if (!d.objectStoreNames.contains('mapping')) d.createObjectStore('mapping', { keyPath: 'bank' });
        };
        r.onsuccess = () => { db = r.result; res(db); };
        r.onerror = () => { useMem = true; res(null); }; // 兜底，不抛错阻断 UI
      } catch (e) { useMem = true; res(null); }
    });
  }

  function tx(store, mode) {
    return db.transaction(store, mode).objectStore(store);
  }
  function reqP(request) {
    return new Promise((res, rej) => {
      request.onsuccess = () => res(request.result);
      request.onerror = () => rej(request.error);
    });
  }
  function memKey(store, obj) { return obj.key != null ? obj.key : obj.id; }

  function put(store, obj) {
    if (useMem || !db) { mem[store].set(memKey(store, obj), obj); return Promise.resolve(); }
    return reqP(tx(store, 'readwrite').put(obj));
  }
  function get(store, key) {
    if (useMem || !db) { return Promise.resolve(mem[store].get(key) || null); }
    return reqP(tx(store, 'readonly').get(key));
  }
  function getAll(store) {
    if (useMem || !db) { return Promise.resolve([...mem[store].values()]); }
    return reqP(tx(store, 'readonly').getAll());
  }
  function del(store, key) {
    if (useMem || !db) { mem[store].delete(key); return Promise.resolve(); }
    return reqP(tx(store, 'readwrite').delete(key));
  }

  // ---- settings ----
  function getSetting(k) { return get('settings', k); }
  function putSetting(k, v) { return put('settings', { key: k, value: v }); }

  // ---- mapping ----
  function getMapping(bank) { return get('mapping', bank); }
  function putMapping(rec) { return put('mapping', rec); }
  function getAllMapping() { return getAll('mapping'); }
  async function seedMapping() {
    const all = await getAllMapping();
    if (!all.length) {
      await putMapping({ bank: '苏州中行', province: '江苏', city: '苏州' });
    }
  }

  // ---- files ----
  function putFile(f) { return put('files', f); }
  function getFile(id) { return get('files', id); }
  function getAllFiles() { return getAll('files'); }
  function deleteFile(id) { return del('files', id); }

  const API = {
    initDB, put, get, getAll, del,
    getSetting, putSetting,
    getMapping, putMapping, getAllMapping, seedMapping,
    putFile, getFile, getAllFiles, deleteFile,
    isMemoryFallback: () => useMem
  };
  global.Store = API;
})(window);
