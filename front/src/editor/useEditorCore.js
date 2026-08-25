// useEditorCore.js — 审稿编辑部两端共用的数据与后端交互。
//
// 网页版与 iOS 版共用同一套字段、词表、接口与状态机；仅屏幕形态不同。
// 本 hook 负责：复用内部后台 Supabase 会话、拉取待审稿件、
// 审核通过、真实配图上传，以及后端 <-> 原型内部数据结构的双向归一化。
//
// 严格对齐已实现后端，不改动任何后端代码：
//   GET  /api/editor/submissions
//   POST /api/editor/articles/{book_id}/approve
//   POST /api/uploads/cover        （multipart，字段名 file）
// 正式鉴权：Authorization: Bearer <Supabase access_token>。统一请求由 apiClient
// 完成，401 / 403 / 503 与内部后台使用相同语义。旧 admin-token 分支已移除。

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient';

// 配图上传前端校验（与后端 upload_service 一致）
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_COVER_BYTES = 5 * 1024 * 1024; // 5MB

// ── 后端稿件 → 原型内部结构 ──────────────────────────────
function normalize(book) {
  const bt = book.tags || {};
  const url = book.cover_image_url || '';
  return {
    book_id: book.book_id,
    title: book.title || '',
    author: book.author || '',
    intro: book.intro || '',
    sample: book.sample || '',
    full_content: book.full_content || '',
    status: book.status || 'pending_review',
    revision_no: book.revision_no || 1,
    claimed_by_me: Boolean(book.claimed_by_me),
    claim_expires_at: book.review_claim_expires_at || null,
    tag_source: bt.tag_source || 'ai',
    cover: url
      ? {
          photographer: book.cover_photographer || '',
          caption: book.cover_caption || '',
          url,
        }
      : null,
    tags: {
      setting: bt.setting_tags || [],
      story_tone: bt.story_tone_tags || [],
      relationship: bt.relationship_core_tags || [],
      aesthetic: (bt.aesthetic_tags || []).join(', '),
      risk: (bt.risk_tags || []).join(', '),
      reason: bt.recommend_reason || '',
    },
  };
}

// ── 原型内部结构 → approve 请求体 ────────────────────────
function toApprovePayload(sub) {
  const t = sub.tags;
  const splitCsv = (s) =>
    (s || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  return {
    setting_tags: t.setting,
    story_tone_tags: t.story_tone,
    relationship_core_tags: t.relationship,
    aesthetic_tags: splitCsv(t.aesthetic),
    risk_tags: splitCsv(t.risk),
    recommend_reason: t.reason || '',
    cover_image_url: (sub.cover?.url || '').trim(),
    cover_photographer: (sub.cover?.photographer || '').trim(),
    cover_caption: (sub.cover?.caption || '').trim(),
  };
}

export function useEditorCore({ displayName = '编辑' } = {}) {
  const token = 'supabase-bearer-session';
  const user = displayName || '编辑';
  const [subs, setSubs] = useState([]);
  const [msg, setMsg] = useState(null); // { kind:'ok'|'err', text }

  const okMsg = (text) => setMsg({ kind: 'ok', text });
  const errMsg = (text) => setMsg({ kind: 'err', text });

  const fetchSubmissions = useCallback(async () => {
    const data = await apiFetch('/api/editor/submissions');
    return (data || []).map(normalize);
  }, []);

  const postDecision = useCallback(async (path, body) => {
    return apiFetch(path, { method: 'POST', body });
  }, []);

  const ensureClaim = useCallback(async (sub) => {
    if (sub.claimed_by_me) return sub;
    const result = await postDecision(`/api/editor/submissions/${sub.book_id}/claim`, {});
    const claimed = { ...sub, claimed_by_me: true, claim_expires_at: result.expires_at };
    setSubs((current) => current.map((item) => item.book_id === sub.book_id ? claimed : item));
    return claimed;
  }, [postDecision]);

  // 登录由 Studio 的 Supabase Auth 外壳统一处理；保留同形接口供既有视图调用。
  const login = useCallback(async () => false, []);

  const reload = useCallback(async () => {
    try {
      const list = await fetchSubmissions();
      setSubs(list);
      okMsg('已刷新待审列表。');
    } catch (e) {
      errMsg(`刷新失败：${e.message}`);
    }
  }, [fetchSubmissions]);

  const logout = useCallback(() => {
    setSubs([]);
    setMsg(null);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(reload, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  // 就地更新一篇稿件（勾选标签、编辑配图字段等）
  const change = useCallback((next) => {
    setSubs((cur) => cur.map((s) => (s.book_id === next.book_id ? next : s)));
  }, []);

  // 确认发布，入推荐池。配图非强制（收稿后可跳过配图直接发布）。成功返回 true。
  const approve = useCallback(async (sub) => {
    try {
      const claimed = await ensureClaim(sub);
      await postDecision(
        `/api/editor/articles/${claimed.book_id}/approve`,
        toApprovePayload(claimed),
      );
      setSubs((cur) => cur.filter((s) => s.book_id !== sub.book_id));
      okMsg(`✓ 稿件 ID ${sub.book_id} 已发布，入推荐池！`);
      return true;
    } catch (e) {
      errMsg(`审核失败：${e.message}`);
      return false;
    }
  }, [ensureClaim, postDecision]);

  // ── 初审阶段的两个决定 ────────────────────────────────
  // 拒稿：写明理由 → 回复作者，稿件移出待审列表。
  const reject = useCallback(async (sub, reason) => {
    const text = (reason || '').trim();
    if (!text) return false;
    try {
      const claimed = await ensureClaim(sub);
      await postDecision(
        `/api/editor/articles/${claimed.book_id}/reject`,
        { reason: text },
      );
      setSubs((cur) => cur.filter((s) => s.book_id !== sub.book_id));
      okMsg(`已拒稿 · 稿件 ID ${sub.book_id} 的意见已回复作者。`);
      return true;
    } catch (e) {
      errMsg(`拒稿失败：${e.message}`);
      return false;
    }
  }, [ensureClaim, postDecision]);

  // 提交修改意见：退回作者，稿件保留待其再次提交。
  const revise = useCallback(async (sub, note) => {
    const text = (note || '').trim();
    if (!text) return false;
    try {
      const claimed = await ensureClaim(sub);
      await postDecision(
        `/api/editor/articles/${claimed.book_id}/revise`,
        { note: text },
      );
      setSubs((cur) => cur.filter((s) => s.book_id !== sub.book_id));
      okMsg(`已退回修改 · 稿件 ID ${sub.book_id} 待作者再次提交。`);
      return true;
    } catch (e) {
      errMsg(`提交修改意见失败：${e.message}`);
      return false;
    }
  }, [ensureClaim, postDecision]);

  // 真实配图上传。校验类型/大小 → POST /api/uploads/cover → 写回该稿 cover.url。
  // 返回公开 URL；失败抛错（调用方展示）。
  const uploadCover = useCallback(async (sub, file) => {
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      throw new Error('仅支持 JPEG / PNG / WebP');
    }
    if (file.size > MAX_COVER_BYTES) {
      throw new Error('图片体积过大，上限 5MB');
    }
    const fd = new FormData();
    fd.append('file', file);
    const data = await apiFetch('/api/uploads/cover', { method: 'POST', body: fd });
    const url = data.cover_image_url;
    // 保留已填的摄影/说明，只替换 url；原本无 cover 则新建。
    const prevCover = sub.cover || { photographer: '', caption: '' };
    change({ ...sub, cover: { ...prevCover, url } });
    return url;
  }, [change]);

  return {
    token,
    user,
    subs,
    msg,
    setMsg,
    login,
    reload,
    logout,
    change,
    approve,
    reject,
    revise,
    uploadCover,
  };
}
