# 一次性迁移脚本：ManageSheet 弹菜单 Popover 化 + 选中模式 + 全选 + 文案
import io

p = "src/pages/newtab/components/board/ManageSheet.jsx"
s = io.open(p, encoding="utf-8", newline="").read().replace("\r\n", "\n")
reps = [
    # Popover 导入
    ('import FolderBrowser from "./FolderBrowser";',
     'import FolderBrowser from "./FolderBrowser";\nimport Popover from "./Popover";'),
    # 菜单状态：menuId/treeMenuId → menu/treeMenu（带锚点）
    ("""  /* 菜单：列表与树/chips 相互独立（根层级下同一子分组同时出现在树与列表，共用会串扰） */
  const [menuId, setMenuId] = useState(null); // 列表行
  const [treeMenuId, setTreeMenuId] = useState(null); // 树行 + 手机 chips
  const closeMenus = () => { setMenuId(null); setTreeMenuId(null); };""",
     """  /* 菜单：列表与树/chips 相互独立（根层级下同一子分组同时出现在树与列表，共用会串扰）。
     菜单本体经 Popover 渲染到 body（脱离 overflow 裁剪），打开时记录锚点矩形 */
  const [menu, setMenu] = useState(null); // 列表行 {id, anchor}
  const [treeMenu, setTreeMenu] = useState(null); // 树行 + 手机 chips {id, anchor}
  const closeMenus = () => { setMenu(null); setTreeMenu(null); };"""),
    # Esc handler 引用
    ("""      if (editingId || menuId || treeMenuId || treeRenamingId || headerEditing) {
        setEditingId(null); setMenuId(null); setTreeMenuId(null); setTreeRenamingId(null); setHeaderEditing(false);
        return;
      }""",
     """      if (editingId || menu || treeMenu || treeRenamingId || headerEditing) {
        setEditingId(null); setMenu(null); setTreeMenu(null); setTreeRenamingId(null); setHeaderEditing(false);
        return;
      }"""),
    # 选中模式：选中时点行 = 切换选中
    ("""        onClick={() => {
          if (isFolder) {
            if (atRoot) { setQ(""); setCurrentId(row.id); } // 根下的文件夹 = 子分组：树内导航
            else setBrowsing(row.id); // 更深层级交由文件夹浏览浮层
          } else {
            setEditingId(row.id);
          }
        }}""",
     """        onClick={() => {
          if (selected.length > 0) { toggleSelect(row.id); return; } // 选中模式：点行切换选中，避免误触编辑
          if (isFolder) {
            if (atRoot) { setQ(""); setCurrentId(row.id); } // 根下的文件夹 = 子分组：树内导航
            else setBrowsing(row.id); // 更深层级交由文件夹浏览浮层
          } else {
            setEditingId(row.id);
          }
        }}"""),
    # renderRow 菜单 → Popover
    ("    const menuOpen = menuId === row.id;",
     "    const menuOpen = menu?.id === row.id;"),
    ("""          <button
            type="button"
            className="ms-row-more"
            title="更多操作"
            onClick={(e) => { e.stopPropagation(); setMenuId(menuOpen ? null : row.id); }}
          >
            <MoreIcon className="w-4 h-4" />
          </button>
          {menuOpen && (
            <RowMenu
              row={row}
              onClose={closeMenus}
              onEdit={() => setEditingId(row.id)}
              onOpen={() => { const u = safeUrl(row.url); if (u) openUrl(u); }}
              onDelete={() => deleteRow(row)}
            />
          )}""",
     """          <button
            type="button"
            className="ms-row-more"
            title="更多操作"
            onClick={(e) => {
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              setMenu(menuOpen ? null : { id: row.id, anchor: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } });
            }}
          >
            <MoreIcon className="w-4 h-4" />
          </button>
          {menu?.id === row.id && (
            <RowMenu
              row={row}
              anchor={menu.anchor}
              onClose={closeMenus}
              onEdit={() => setEditingId(row.id)}
              onOpen={() => { const u = safeUrl(row.url); if (u) openUrl(u); }}
              onDelete={() => deleteRow(row)}
            />
          )}"""),
    # renderTreeSub 菜单 → Popover
    ("    const menuOpen = treeMenuId === s.id;",
     "    const menuOpen = treeMenu?.id === s.id;"),
    ("""          <button
            type="button"
            className="ms-tree-more"
            title="子分组操作"
            onClick={(e) => { e.stopPropagation(); setTreeMenuId(menuOpen ? null : s.id); }}
          >
            <MoreIcon className="w-3.5 h-3.5" />
          </button>
          {menuOpen && (
            <RowMenu
              row={s}
              onClose={closeMenus}
              onEdit={() => { setTreeRenamingId(s.id); setTreeDraft(s.title || ""); }}
              onOpen={() => {}}
              onDelete={() => { col.removeNode(s.id); if (currentId === s.id) setCurrentId(target.id); }}
            />
          )}""",
     """          <button
            type="button"
            className="ms-tree-more"
            title="子分组操作"
            onClick={(e) => {
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              setTreeMenu(treeMenuOpen ? null : { id: s.id, anchor: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } });
            }}
          >
            <MoreIcon className="w-3.5 h-3.5" />
          </button>
          {treeMenu?.id === s.id && (
            <RowMenu
              row={s}
              anchor={treeMenu.anchor}
              onClose={closeMenus}
              onEdit={() => { setTreeRenamingId(s.id); setTreeDraft(s.title || ""); }}
              onOpen={() => {}}
              onDelete={() => { col.removeNode(s.id); if (currentId === s.id) setCurrentId(target.id); }}
            />
          )}"""),
    # chips 菜单 → treeMenu
    ("""              onClick={(e) => { e.stopPropagation(); setTreeMenuId(treeMenuId === s.id ? null : s.id); }}""",
     """              onClick={(e) => { e.stopPropagation(); setTreeMenu(treeMenu?.id === s.id ? null : s.id); }}"""),
    ("""          {treeMenuId === s.id && (
            <RowMenu
              row={s}
              onClose={closeMenus}
              onEdit={() => { setTreeRenamingId(s.id); setTreeDraft(s.title || ""); }}
              onOpen={() => {}}
              onDelete={() => { col.removeNode(s.id); if (currentId === s.id) setCurrentId(target.id); }}
            />
          )}""",
     """          {treeMenu?.id === s.id && (
            <RowMenu
              row={s}
              anchor={treeMenu.anchor}
              onClose={closeMenus}
              onEdit={() => { setTreeRenamingId(s.id); setTreeDraft(s.title || ""); }}
              onOpen={() => {}}
              onDelete={() => { col.removeNode(s.id); if (currentId === s.id) setCurrentId(target.id); }}
            />
          )}"""),
    # RowMenu 本体改用 Popover（菜单移出任何裁剪上下文）
    ("""function RowMenu({ row, onClose, onEdit, onOpen, onDelete }) {
  const ref = useRef(null);
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose]);
  const hasChildren = !!row.children;
  return (
    <div className="ms-row-menu" ref={ref} onClick={(e) => e.stopPropagation()}>""",
     """function RowMenu({ row, anchor, onClose, onEdit, onOpen, onDelete }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const hasChildren = !!row.children;
  return (
    <Popover anchor={anchor} onClose={onClose} minWidth={168}>
      <div className="ms-row-menu">"""),
    ("""        <button
          type="button"
          className="danger confirm"
          onClick={() => { onDelete(); onClose(); }}
        >
          <TrashIcon className="w-4 h-4" /> 确认删除（含 {row.children.length} 条内容）
        </button>
      ) : (
        <button
          type="button"
          className="danger"
          onClick={() => (hasChildren ? setConfirmDel(true) : onDelete())}
        >
          <TrashIcon className="w-4 h-4" /> 删除{hasChildren ? "…" : ""}
        </button>
      )}
    </div>
  );
}""",
     """        <button
          type="button"
          className="danger confirm"
          onClick={() => { onDelete(); onClose(); }}
        >
          <TrashIcon className="w-4 h-4" /> 确认删除（含 {row.children.length} 条内容）
        </button>
      ) : (
        <button
          type="button"
          className="danger"
          onClick={() => (hasChildren ? setConfirmDel(true) : onDelete())}
        >
          <TrashIcon className="w-4 h-4" /> 删除{hasChildren ? "…" : ""}
        </button>
      )}
    </div>
  );
}"""),
    # RowMenu 调用处传 anchor（树）
    ("""            <RowMenu
              row={s}
              onClose={closeMenus}
              onEdit={() => { setTreeRenamingId(s.id); setTreeDraft(s.title || ""); }}
              onOpen={() => {}}
              onDelete={() => { col.removeNode(s.id); if (currentId === s.id) setCurrentId(target.id); }}
            />
          )}
        </div>
      ))}""",
     """            <RowMenu
              row={s}
              anchor={treeMenu.anchor}
              onClose={closeMenus}
              onEdit={() => { setTreeRenamingId(s.id); setTreeDraft(s.title || ""); }}
              onOpen={() => {}}
              onDelete={() => { col.removeNode(s.id); if (currentId === s.id) setCurrentId(target.id); }}
            />
          )}
        </div>
      ))}"""),
    # RowMenu 调用处传 anchor（chips）
    ("""          {treeMenuId === s.id && (
            <RowMenu
              row={s}
              onClose={closeMenus}
              onEdit={() => { setTreeRenamingId(s.id); setTreeDraft(s.title || ""); }}
              onOpen={() => {}}
              onDelete={() => { col.removeNode(s.id); if (currentId === s.id) setCurrentId(target.id); }}
            />
          )}""",
     """          {treeMenu?.id === s.id && (
            <RowMenu
              row={s}
              anchor={treeMenu.anchor}
              onClose={closeMenus}
              onEdit={() => { setTreeRenamingId(s.id); setTreeDraft(s.title || ""); }}
              onOpen={() => {}}
              onDelete={() => { col.removeNode(s.id); if (currentId === s.id) setCurrentId(target.id); }}
            />
          )}"""),
    # 移动目标菜单 → Popover
    ("""  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const moveAnchorRef = useRef(null);
  useEffect(() => {
    if (!moveMenuOpen) return;
    const close = (e) => { if (!moveAnchorRef.current?.contains(e.target)) setMoveMenuOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [moveMenuOpen]);""",
     """  const [moveMenu, setMoveMenu] = useState(null); // {anchor}"""),
    ("""                <div className="ms-row-menu-anchor" ref={moveAnchorRef}>
                  <button
                    type="button"
                    className="ms-btn primary"
                    disabled={!moveTargets.length}
                    onClick={() => setMoveMenuOpen((o) => !o)}
                  >
                    移动到…
                  </button>
                  {moveMenuOpen && (
                    <div className="ms-row-menu wide">
                      {moveTargets.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            col.moveNodesTo(selected, t.id);
                            setSelected([]);
                            setMoveMenuOpen(false);
                            setHint(`✓ 已移动 ${selected.length} 条到「${t.title}」`);
                            setTimeout(() => setHint(""), 4000);
                          }}
                        >
                          <FolderIcon className="w-4 h-4" /> {t.title}
                        </button>
                      ))}
                      {!moveTargets.length && <div className="settings-snap-empty">没有可选目标</div>}
                    </div>
                  )}
                </div>""",
     """                <div className="ms-row-menu-anchor">
                  <button
                    type="button"
                    className="ms-btn primary"
                    disabled={!moveTargets.length}
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setMoveMenu({ anchor: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } });
                    }}
                  >
                    移动到…
                  </button>
                  {moveMenu && (
                    <Popover anchor={moveMenu.anchor} onClose={() => setMoveMenu(null)} minWidth={220}>
                      <div className="ms-row-menu wide">
                        {moveTargets.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              col.moveNodesTo(selected, t.id);
                              setSelected([]);
                              setMoveMenu(null);
                              setHint(`✓ 已移动 ${selected.length} 条到「${t.title}」`);
                              setTimeout(() => setHint(""), 4000);
                            }}
                          >
                            <FolderIcon className="w-4 h-4" /> {t.title}
                          </button>
                        ))}
                        {!moveTargets.length && <div className="settings-snap-empty">没有可选目标</div>}
                      </div>
                    </Popover>
                  )}
                </div>"""),
    # 全选按钮
    ("""                <span>已选 {selected.length} 条</span>""",
     """                <span>已选 {selected.length} 条</span>
                <button type="button" className="ms-btn" onClick={() => setSelected(displayItems.map((r) => r.id))}>全选</button>"""),
    # 文案
    ("""                ＋ 收录
              </button>
              <button
                type="button"
                className={`ms-btn${batchOpen ? " active" : ""}`}
                onClick={() => { setBatchOpen((o) => !o); setEditingId(null); }}
              >
                批量
              </button>""",
     """                ＋ 添加网站
              </button>
              <button
                type="button"
                className={`ms-btn${batchOpen ? " active" : ""}`}
                onClick={() => { setBatchOpen((o) => !o); setEditingId(null); }}
              >
                批量添加
              </button>"""),
]

ok = 0
for i, (old, new) in enumerate(reps):
    if old in s:
        s = s.replace(old, new)
        ok += 1
    else:
        print(f"WARN reps[{i}] 未匹配: {old[:70]!r}")
io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print(f"ManageSheet: {ok}/{len(reps)} 应用")
