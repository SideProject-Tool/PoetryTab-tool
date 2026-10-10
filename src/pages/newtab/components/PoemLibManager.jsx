import { useState, useEffect, useMemo } from "react";
import CATEGORIES from "sentences-bundle/categories.json";
import { contentEngine } from "../services/contentEngine";

const PAGE_SIZE = 50;

/**
 * 词库管理（设置 → 词库管理）：按分类以表格（内容/作者/出处）管理诗词库。
 * 自定义词条：增/改/删（删除走 6 秒撤销）；内置词条：编辑=覆盖显示、删除=隐藏（可恢复）。
 * 全部改动走 col 的词库动作 → poemLib（rev+1）→ 云同步 + 诗词引擎重洗。
 */
export default function PoemLibManager({ col }) {
  const [cat, setCat] = useState("i");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [builtin, setBuiltin] = useState(null); // 该分类内置语料（null = 加载中）
  const [form, setForm] = useState({ content: "", author: "", source: "" });
  const [editing, setEditing] = useState(null); // {uuid, content, author, source}
  const [tip, setTip] = useState("");

  const poemLib = col.data?.poemLib || { custom: [], hidden: [], edits: {}, rev: 0 };
  const hiddenSet = useMemo(() => new Set(poemLib.hidden), [poemLib]);

  useEffect(() => {
    let alive = true;
    setBuiltin(null);
    contentEngine.getContentByCategories([cat]).then((list) => {
      if (alive) setBuiltin(list);
    });
    return () => {
      alive = false;
    };
  }, [cat]);

  useEffect(() => {
    setPage(0);
    setTip("");
  }, [cat, query]);

  /* 表格行 = 自定义词条（前）+ 内置词条（套用覆盖编辑、标记隐藏），按关键字过滤 */
  const rows = useMemo(() => {
    if (!builtin) return [];
    const q = query.trim().toLowerCase();
    const hit = (r) => !q || [r.content, r.author, r.source].some((v) => (v || "").toLowerCase().includes(q));
    const customRows = poemLib.custom
      .filter((c) => c.cat === cat)
      .map((c) => ({ uuid: c.uuid, content: c.content, author: c.author, source: c.source, custom: true, hidden: false }));
    const builtinRows = builtin.map((b) => {
      const e = poemLib.edits[b.uuid];
      return {
        uuid: b.uuid,
        content: e ? e.content : b.hitokoto,
        author: e ? e.author : b.from_who,
        source: e ? e.source : b.from,
        custom: false,
        hidden: hiddenSet.has(b.uuid),
      };
    });
    return [...customRows, ...builtinRows].filter(hit);
  }, [builtin, poemLib, cat, query, hiddenSet]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages - 1);
  const pageRows = rows.slice(curPage * PAGE_SIZE, curPage * PAGE_SIZE + PAGE_SIZE);
  const customCount = poemLib.custom.filter((c) => c.cat === cat).length;
  const hiddenCount = builtin ? builtin.filter((b) => hiddenSet.has(b.uuid)).length : 0;

  const submitAdd = () => {
    if (!form.content.trim()) {
      setTip("✗ 内容不能为空");
      return;
    }
    col.addPoem({ cat, content: form.content, author: form.author, source: form.source });
    setForm({ content: "", author: "", source: "" });
    setTip("✓ 已添加，词条进入该分类轮播");
  };
  const saveEdit = () => {
    if (!editing.content.trim()) {
      setTip("✗ 内容不能为空");
      return;
    }
    col.updatePoem(editing.uuid, { content: editing.content, author: editing.author, source: editing.source });
    setEditing(null);
    setTip("✓ 已保存");
  };

  return (
    <div className="plm">
      <div className="settings-chips">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`settings-pill${cat === c.key ? " on" : ""}`}
            onClick={() => setCat(c.key)}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="plm-form">
        <input
          className="widget-h-input inline plm-in-content"
          type="text"
          placeholder="内容（必填）"
          value={form.content}
          onChange={(e) => setForm({ ...form, content: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitAdd();
          }}
          spellCheck="false"
        />
        <input
          className="widget-h-input inline plm-in"
          type="text"
          placeholder="作者"
          value={form.author}
          onChange={(e) => setForm({ ...form, author: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitAdd();
          }}
          spellCheck="false"
        />
        <input
          className="widget-h-input inline plm-in"
          type="text"
          placeholder="出处"
          value={form.source}
          onChange={(e) => setForm({ ...form, source: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitAdd();
          }}
          spellCheck="false"
        />
        <button type="button" className="plm-btn plm-add" onClick={submitAdd}>
          添加
        </button>
      </div>

      <div className="plm-toolbar">
        <input
          className="widget-h-input inline plm-search"
          type="text"
          placeholder="搜索内容 / 作者 / 出处"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck="false"
        />
        <span className="settings-block-hint">
          共 {rows.length} 条 · 自定义 {customCount} · 已隐藏 {hiddenCount}
        </span>
      </div>

      <div className="plm-table-wrap">
        <table className="plm-table">
          <thead>
            <tr>
              <th className="plm-col-content">内容</th>
              <th className="plm-col-author">作者</th>
              <th className="plm-col-source">出处</th>
              <th className="plm-col-acts"></th>
            </tr>
          </thead>
          <tbody>
            {!builtin && (
              <tr>
                <td className="plm-empty" colSpan={4}>词库加载中…</td>
              </tr>
            )}
            {builtin && !pageRows.length && (
              <tr>
                <td className="plm-empty" colSpan={4}>没有匹配的词条</td>
              </tr>
            )}
            {pageRows.map((r) =>
              editing && editing.uuid === r.uuid ? (
                <tr key={r.uuid}>
                  <td>
                    <input
                      className="widget-h-input inline plm-edit-in"
                      type="text"
                      value={editing.content}
                      autoFocus
                      onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit();
                        if (e.key === "Escape") setEditing(null);
                      }}
                      spellCheck="false"
                    />
                  </td>
                  <td>
                    <input
                      className="widget-h-input inline plm-edit-in"
                      type="text"
                      value={editing.author}
                      onChange={(e) => setEditing({ ...editing, author: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit();
                        if (e.key === "Escape") setEditing(null);
                      }}
                      spellCheck="false"
                    />
                  </td>
                  <td>
                    <input
                      className="widget-h-input inline plm-edit-in"
                      type="text"
                      value={editing.source}
                      onChange={(e) => setEditing({ ...editing, source: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit();
                        if (e.key === "Escape") setEditing(null);
                      }}
                      spellCheck="false"
                    />
                  </td>
                  <td className="plm-acts">
                    <button type="button" className="plm-btn" onClick={saveEdit}>保存</button>
                    <button type="button" className="plm-btn" onClick={() => setEditing(null)}>取消</button>
                  </td>
                </tr>
              ) : (
                <tr key={r.uuid} className={r.hidden ? "plm-row-hidden" : ""}>
                  <td className="plm-cell" title={r.content}>
                    {r.content}
                    {r.custom && <span className="plm-tag">自定义</span>}
                  </td>
                  <td className="plm-cell" title={r.author}>{r.author}</td>
                  <td className="plm-cell" title={r.source}>{r.source}</td>
                  <td className="plm-acts">
                    {r.hidden ? (
                      <button type="button" className="plm-btn" onClick={() => col.setPoemHidden(r.uuid, false)}>
                        恢复
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="plm-btn"
                          onClick={() => setEditing({ uuid: r.uuid, content: r.content, author: r.author, source: r.source })}
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          className="plm-btn"
                          title={r.custom ? "删除该词条（6 秒内可撤销）" : "隐藏内置词条，可随时恢复"}
                          onClick={() => (r.custom ? col.removePoem(r.uuid) : col.setPoemHidden(r.uuid, true))}
                        >
                          {r.custom ? "删除" : "隐藏"}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>

      {rows.length > PAGE_SIZE && (
        <div className="plm-pager">
          <button type="button" className="plm-btn" disabled={curPage === 0} onClick={() => setPage(curPage - 1)}>
            上一页
          </button>
          <span className="settings-block-hint">
            第 {curPage + 1} / {totalPages} 页
          </span>
          <button
            type="button"
            className="plm-btn"
            disabled={curPage >= totalPages - 1}
            onClick={() => setPage(curPage + 1)}
          >
            下一页
          </button>
        </div>
      )}

      {tip && <div className="plm-tip">{tip}</div>}
    </div>
  );
}
