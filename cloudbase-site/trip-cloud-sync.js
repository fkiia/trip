(function () {
  'use strict';

  const config = window.TRIP_CLOUD_CONFIG || {};
  const contentName = 'trip_content';
  const visitorName = 'trip_visitors';
  const changeName = 'trip_changes';
  const nicknameKey = 'yunnan-collab-nickname-v1';
  const imageUrls = new Map();

  function loadSdk() {
    if (window.cloudbase) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = config.sdkUrl;
      script.onload = () => window.cloudbase ? resolve() : reject(new Error('CloudBase SDK unavailable'));
      script.onerror = () => reject(new Error('CloudBase SDK could not load'));
      document.head.appendChild(script);
    });
  }

  function name() {
    try { return (localStorage.getItem(nicknameKey) || '').trim().slice(0, 30); }
    catch (_) { return ''; }
  }

  function hashKey(value) {
    let hash = 2166136261;
    for (const byte of new TextEncoder().encode(value)) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function compactImage(file) {
    if (!file.type.startsWith('image/')) throw new Error('请选择图片');
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, 1800 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('图片处理失败')); return; }
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片处理失败')), 'image/jpeg', 0.86);
      };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法读取图片')); };
      image.src = url;
    });
  }

  window.createTripCloudSync = function createTripCloudSync(callbacks) {
    if (!config.envId) return null;
    let app;
    let db;
    let bucket;
    let uid = '';
    let ready = false;
    let saving = 0;
    let refreshTimer;
    let pollTimer;

    const status = value => callbacks.onStatus?.(value);

    function requireResult(result) {
      if (result?.error) throw result.error;
      return result?.data;
    }

    async function listContent() {
      const result = await db.from(contentName).select('*');
      const rows = requireResult(result);
      return Array.isArray(rows) ? rows : [];
    }

    async function refresh(initial = false) {
      if (!ready || saving) return;
      const docs = await listContent();
      const days = {};
      const places = [];
      const picks = [];
      for (const row of docs) {
        const doc = { kind: row.kind, ...(row.payload || {}) };
        if (doc.kind === 'day' && doc.date) days[doc.date] = {
          distance: doc.distance || '', time: doc.time || '', screenshots: doc.screenshots || []
        };
        if (doc.kind === 'place' && !doc.deleted && doc.place) places.push(doc.place);
        if (doc.kind === 'pick' && doc.selected && doc.key) picks.push(doc.key);
      }
      callbacks.onSnapshot?.({ days, places, picks, hasContent: docs.some(doc => ['day', 'place', 'pick'].includes(doc.kind)), initial });
      status('已同步');
    }

    async function recordVisit() {
      requireResult(await db.from(visitorName).insert({
        id: crypto.randomUUID(), visitor_id: uid,
        nickname: name() || '访客',
        visited_at: new Date().toISOString()
      }));
    }

    async function logChange(action, target) {
      try {
        requireResult(await db.from(changeName).insert({
          id: crypto.randomUUID(), action, target: String(target).slice(0, 120),
          nickname: name() || '访客', visitor_id: uid,
          changed_at: new Date().toISOString()
        }));
      } catch (error) {
        console.warn('修改已保存，但操作记录写入失败', error);
      }
    }

    async function write(id, body, action, target) {
      if (!ready) throw new Error('云端尚未连接');
      saving += 1;
      status('同步中…');
      try {
        requireResult(await db.from(contentName).upsert({
          id, kind: body.kind, payload: body,
          actor_id: uid, updated_at: new Date().toISOString()
        }));
        await logChange(action, target);
        status('已同步');
      } catch (error) {
        status('同步失败，请重试');
        throw error;
      } finally {
        saving -= 1;
      }
      await refresh();
    }

    function scheduleRefresh() {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => refresh().catch(error => {
        console.warn('云端刷新失败', error);
        status('连接中断，稍后重试');
      }), 300);
    }

    async function initialize() {
      status('连接中…');
      await loadSdk();
      app = window.cloudbase.init({ env: config.envId });
      let session;
      try { session = await app.auth.getSession(); } catch (_) { session = null; }
      if (!session?.data?.user?.id) {
        const signed = await app.auth.signInAnonymously();
        if (signed.error) throw signed.error;
        session = signed;
      }
      uid = String(session.data?.user?.id || session.data?.session?.sub || '');
      if (!uid) throw new Error('未取得访客标识');
      db = app.rdb();
      bucket = app.storage.from('trip-uploads');
      await recordVisit();
      ready = true;
      await refresh(true);
      pollTimer = setInterval(() => {
        if (!document.hidden) scheduleRefresh();
      }, 10000);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) scheduleRefresh();
      });
      return uid;
    }

    return {
      get ready() { return ready; },
      get uid() { return uid; },
      get nickname() { return name(); },
      initialize,
      refresh: () => refresh(),
      async setNickname(value) {
        localStorage.setItem(nicknameKey, String(value || '').trim().slice(0, 30));
        if (ready) await recordVisit();
      },
      saveDay(date, value) {
        return write(`day_${date}`, {
          kind: 'day', date,
          distance: String(value.distance || '').slice(0, 32),
          time: String(value.time || '').slice(0, 32),
          screenshots: (value.screenshots || []).map(item => ({
            id: item.id, name: item.name || '', fileID: item.fileID || ''
          }))
        }, '修改行程', date);
      },
      savePlace(place) {
        const clean = {
          id: place.id, city: place.city, category: place.category,
          name: String(place.name || '').slice(0, 80),
          type: String(place.type || '').slice(0, 40),
          duration: String(place.duration || '').slice(0, 32),
          address: String(place.address || '').slice(0, 240),
          summary: String(place.summary || '').slice(0, 240),
          guide: String(place.guide || '').slice(0, 5000),
          images: (place.images || []).map(item => ({ id: item.id, name: item.name || '', fileID: item.fileID || '' }))
        };
        return write(`place_${place.id}`, { kind: 'place', deleted: false, place: clean }, '编辑地点', clean.name);
      },
      deletePlace(place) {
        return write(`place_${place.id}`, { kind: 'place', deleted: true }, '删除地点', place.name);
      },
      savePick(key, selected) {
        return write(`pick_${hashKey(key)}`, { kind: 'pick', key, selected: !!selected }, '更新备选', key);
      },
      async uploadImage(file) {
        if (!ready) throw new Error('云端尚未连接');
        const blob = await compactImage(file);
        if (blob.size > 4 * 1024 * 1024) throw new Error('图片过大，请换一张');
        const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
        requireResult(await bucket.upload(path, blob, { contentType: 'image/jpeg' }));
        return path;
      },
      async fileUrl(fileID) {
        if (!fileID || !ready) return '';
        const cached = imageUrls.get(fileID);
        if (cached && cached.expires > Date.now()) return cached.url;
        const signed = requireResult(await bucket.createSignedUrl(fileID, 600));
        const url = signed?.fullSignedURL || '';
        if (url) imageUrls.set(fileID, { url, expires: Date.now() + 5 * 60 * 1000 });
        return url;
      },
      close() {
        clearInterval(pollTimer);
        clearTimeout(refreshTimer);
      }
    };
  };
})();
