/* =========================================================================
 * core/sessions.js —— 方法优先的测量会话、图像角色与多帧存储
 * 依赖：无
 * 说明：元数据存 localStorage；图片 Blob 优先存 IndexedDB。
 * ========================================================================= */
(function (global) {
  'use strict';

  var K = {
    sessions: 'bp.sessions.v2',
    active: 'bp.activeSession.v2'
  };
  var SESSION_SCHEMA = 'bp.session/2';
  var FRAME_SCHEMA = 'bp.frame/1';
  var RECORD_SCHEMA = 'bp.record/2';
  var DB_NAME = 'bp-media-v2';
  var STORE = 'frames';
  var memory = { sessions: [], active: null, blobs: new Map() };

  var ROLE_LABEL = {
    sodium: '钠光条纹',
    reference: '激光参考条纹',
    no_lens: '无透镜条纹',
    with_lens: '加透镜条纹',
    calibration: '标定图'
  };
  var METHOD_ROLES = {
    basic: ['sodium'],
    ratio: ['sodium', 'reference'],
    magnification: ['no_lens', 'with_lens'],
    trace: ['sodium']
  };
  var TRACE_PRESET = {
    schema: 'bp.trace/1',
    source: 'matlab-strict',
    label: 'MATLAB 严格追迹（报告基准）',
    d_mm: 0.90213,
    dParaxial_mm: 0.90199,
    D_mm: 1000,
    u_d_mm: null,
    inputs: {
      a_mm: 50,
      A_deg: 1.0,
      n: 1.5168,
      t_mm: 0.17,
      lambda_nm: 589.3
    },
    traceVersion: 'report-table-5.1'
  };

  function LS() {
    try { return global.localStorage || null; } catch (e) { return null; }
  }
  function read(key, dflt) {
    var ls = LS();
    if (!ls) return key === K.sessions ? memory.sessions : memory.active;
    try {
      var value = ls.getItem(key);
      return value == null ? dflt : JSON.parse(value);
    } catch (e) { return dflt; }
  }
  function write(key, value) {
    var ls = LS();
    if (!ls) {
      if (key === K.sessions) memory.sessions = value;
      if (key === K.active) memory.active = value;
      return true;
    }
    try { ls.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function uid(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }
  function now() { return new Date().toISOString(); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function numericOrNull(value) {
    return value !== null && value !== '' && isFinite(value) ? Number(value) : null;
  }

  function openDB() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { resolve(null); return; }
      var req = global.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB 打开失败')); };
    });
  }

  function putBlob(id, blob) {
    if (!global.indexedDB) {
      memory.blobs.set(id, blob);
      return Promise.resolve();
    }
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(blob, id);
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }

  function getBlob(id) {
    if (!global.indexedDB) return Promise.resolve(memory.blobs.get(id) || null);
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get(id);
        req.onsuccess = function () { db.close(); resolve(req.result || null); };
        req.onerror = function () { db.close(); reject(req.error); };
      });
    });
  }

  function deleteBlob(id) {
    if (!global.indexedDB) {
      memory.blobs.delete(id);
      return Promise.resolve();
    }
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }

  function listSessions() {
    var list = read(K.sessions, []);
    return Array.isArray(list) ? list : [];
  }

  function saveSessions(list) {
    return write(K.sessions, (list || []).slice(0, 50));
  }

  function getSession(id) {
    var found = listSessions().filter(function (s) { return s && s.id === id; });
    return found.length ? found[0] : null;
  }

  function getActiveSession() {
    var id = read(K.active, null);
    return id ? getSession(id) : null;
  }

  function setActiveSession(id) {
    return write(K.active, id || null);
  }

  function createSession(options) {
    options = options || {};
    var method = options.method || 'basic';
    if (!METHOD_ROLES[method]) throw new Error('未知测量方法：' + method);
    var session = {
      schema: SESSION_SCHEMA,
      id: uid('session'),
      method: method,
      title: options.title || (method + ' ' + new Date().toLocaleString()),
      created: now(),
      calibration: options.calibration || null,
      params: options.params || {},
      paramsSources: options.paramsSources || {},
      trace: method === 'trace' ? clone(TRACE_PRESET) : null,
      frames: []
    };
    var list = listSessions();
    list.unshift(session);
    saveSessions(list);
    setActiveSession(session.id);
    return session;
  }

  function updateSession(id, patch) {
    var list = listSessions();
    var index = -1;
    for (var i = 0; i < list.length; i += 1) if (list[i].id === id) { index = i; break; }
    if (index < 0) throw new Error('会话不存在');
    list[index] = Object.assign({}, list[index], patch || {});
    saveSessions(list);
    return list[index];
  }

  function addFrame(sessionId, frame) {
    var session = getSession(sessionId);
    if (!session) return Promise.reject(new Error('会话不存在'));
    if (!ROLE_LABEL[frame.role]) return Promise.reject(new Error('未知图像角色：' + frame.role));
    var id = uid('frame');
    var imageKey = 'blob-' + id;
    var item = {
      schema: FRAME_SCHEMA,
      id: id,
      sessionId: sessionId,
      role: frame.role,
      imageKey: imageKey,
      created: now(),
      name: frame.name || '',
      size: frame.size || 0,
      deltaXPx: numericOrNull(frame.deltaXPx),
      deltaXmm: numericOrNull(frame.deltaXmm),
      quality: numericOrNull(frame.quality),
      source: frame.source || '',
      sourceName: frame.sourceName || '',
      capturedAt: numericOrNull(frame.capturedAt),
      qualityScore: numericOrNull(frame.qualityScore),
      selection: frame.selection || null,
      excluded: false,
      analysis: frame.analysis || null,
      analysisError: frame.analysisError || null
    };
    var storeBlob = frame.blob ? putBlob(imageKey, frame.blob) : Promise.resolve();
    return storeBlob.then(function () {
      session.frames = session.frames || [];
      session.frames.unshift(item);
      updateSession(sessionId, { frames: session.frames });
      return item;
    });
  }

  function listFrames(sessionId, role) {
    var session = getSession(sessionId);
    var frames = session && session.frames ? session.frames : [];
    return frames.filter(function (f) { return f && (!role || f.role === role); });
  }

  function setFrameExcluded(sessionId, frameId, excluded) {
    var session = getSession(sessionId);
    if (!session) throw new Error('会话不存在');
    (session.frames || []).forEach(function (f) {
      if (f.id === frameId) f.excluded = !!excluded;
    });
    updateSession(sessionId, { frames: session.frames });
  }

  function removeFrame(sessionId, frameId) {
    var session = getSession(sessionId);
    if (!session) return Promise.reject(new Error('会话不存在'));
    var target = null;
    session.frames = (session.frames || []).filter(function (f) {
      if (f.id === frameId) { target = f; return false; }
      return true;
    });
    updateSession(sessionId, { frames: session.frames });
    return target && target.imageKey ? deleteBlob(target.imageKey) : Promise.resolve();
  }

  function roleStats(sessionId, role) {
    var frames = listFrames(sessionId, role).filter(function (f) {
      return !f.excluded && f.deltaXPx !== null && isFinite(f.deltaXPx);
    });
    var values = frames.map(function (f) { return Number(f.deltaXPx); });
    var mean = values.reduce(function (a, b) { return a + b; }, 0) / (values.length || 1);
    var sd = 0;
    if (values.length > 1) {
      sd = Math.sqrt(values.reduce(function (a, b) {
        return a + (b - mean) * (b - mean);
      }, 0) / (values.length - 1));
    }
    return {
      role: role,
      label: ROLE_LABEL[role],
      n: values.length,
      meanPx: values.length ? mean : NaN,
      sdPx: values.length > 1 ? sd : NaN
    };
  }

  function requiredRoles(method) { return (METHOD_ROLES[method] || []).slice(); }

  function missingRoles(sessionId) {
    var session = getSession(sessionId);
    if (!session) return requiredRoles('basic');
    return requiredRoles(session.method).filter(function (role) {
      return roleStats(sessionId, role).n === 0;
    });
  }

  function exportRecord() {
    return {
      schema: RECORD_SCHEMA,
      exportedAt: now(),
      activeSessionId: read(K.active, null),
      sessions: clone(listSessions()),
      tracePreset: clone(TRACE_PRESET)
    };
  }

  function importRecord(record) {
    if (!record || record.schema !== RECORD_SCHEMA) throw new Error('需要 bp.record/2');
    var incoming = Array.isArray(record.sessions) ? record.sessions : [];
    var existing = listSessions();
    var existingIds = new Set(existing.map(function (s) { return s.id; }));
    var incomingById = new Map();
    incoming.forEach(function (s) {
      if (s && s.schema === SESSION_SCHEMA) incomingById.set(s.id, s);
    });
    existing = existing.map(function (s) {
      return incomingById.has(s.id) ? incomingById.get(s.id) : s;
    });
    incoming.forEach(function (s) {
      if (s && s.schema === SESSION_SCHEMA && !existingIds.has(s.id)) existing.unshift(s);
    });
    saveSessions(existing);
    if (record.activeSessionId && getSession(record.activeSessionId)) {
      setActiveSession(record.activeSessionId);
    }
  }

  var API = {
    K: K,
    SESSION_SCHEMA: SESSION_SCHEMA,
    FRAME_SCHEMA: FRAME_SCHEMA,
    RECORD_SCHEMA: RECORD_SCHEMA,
    ROLE_LABEL: ROLE_LABEL,
    METHOD_ROLES: METHOD_ROLES,
    TRACE_PRESET: TRACE_PRESET,
    listSessions: listSessions,
    getSession: getSession,
    getActiveSession: getActiveSession,
    setActiveSession: setActiveSession,
    createSession: createSession,
    updateSession: updateSession,
    addFrame: addFrame,
    listFrames: listFrames,
    setFrameExcluded: setFrameExcluded,
    removeFrame: removeFrame,
    getFrameBlob: getBlob,
    roleStats: roleStats,
    requiredRoles: requiredRoles,
    missingRoles: missingRoles,
    exportRecord: exportRecord,
    importRecord: importRecord
  };
  global.BP = global.BP || {};
  global.BP.sessions = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
