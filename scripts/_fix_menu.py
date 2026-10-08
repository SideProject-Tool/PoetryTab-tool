# 修复脚本：#1 菜单变量统一 + #2 云端空数据保本地 dirty + #3 设置/搜索 qs 残留 + #4 恢复备份真实成败
import io

def fix(p, reps, label):
    s = io.open(p, encoding="utf-8", newline="").read().replace("\r\n", "\n")
    ok = 0
    for i, (old, new) in enumerate(reps):
        if old in s:
            s = s.replace(old, new)
            ok += 1
        else:
            print(f"WARN {label}[{i}] 未匹配: {old[:60]!r}")
    io.open(p, "w", encoding="utf-8", newline="\n").write(s)
    print(f"{label}: {ok}/{len(reps)} 应用")

# ---------- ManageSheet.jsx：菜单变量统一（带锚点的 menu/treeMenu） ----------
p = "src/pages/newtab/components/board/ManageSheet.jsx"
reps = [
  ("""  const [menuId, setMenuId] = useState(null); // 列表行
  const [treeMenuId, setTreeMenuId] = useState(null); // 树行 + 手机 chips
  const closeMenus = () => { setMenuId(null); setTreeMenuId(null); };""",
   """  const [menu, setMenu] = useState(null); // 列表行 {id, anchor}
  const [treeMenu, setTreeMenu] = useState(null); // 树行 + 手机 chips {id, anchor}
  const closeMenus = () => { setMenu(null); setTreeMenu(null); };"""),
  ("  }, [editingId, menuId, treeMenuId, treeRenamingId, headerEditing, batchOpen, onClose]);",
   "  }, [editingId, menu, treeMenu, treeRenamingId, headerEditing, batchOpen, onClose]);"),
  ("    const menuOpen = menuId === row.id;",
   "    const menuOpen = menu?.id === row.id;"),
  ("""            onClick={(e) => { e.stopPropagation(); setMenuId(menuOpen ? null : row.id); }}""",
   """            onClick={(e) => {
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              setMenu(menuOpen ? null : { id: row.id, anchor: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } });
            }}"""),
  ("    const menuOpen = treeMenuId === s.id;",
   "    const menuOpen = treeMenu?.id === s.id;"),
  ("""          onClick={(e) => { e.stopPropagation(); setTreeMenuId(menuOpen ? null : s.id); }}""",
   """          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            setTreeMenu(treeMenuOpen ? null : { id: s.id, anchor: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } });
          }}"""),
  ("""              onClick={(e) => { e.stopPropagation(); setTreeMenuId(treeMenuId === s.id ? null : s.id); }}""",
   """              onClick={(e) => { e.stopPropagation(); setTreeMenu(treeMenu?.id === s.id ? null : s.id); }}"""),
  ("""          {treeMenuId === s.id && (
            <RowMenu
              row={s}
              onClose={closeMenus}""",
   """          {treeMenu?.id === s.id && (
            <RowMenu
              row={s}
              anchor={treeMenu.anchor}
              onClose={closeMenus}"""),
  ("""          {menu?.id === row.id && (
            <RowMenu
              row={row}
              onClose={closeMenus}""",
   """          {menu?.id === row.id && (
            <RowMenu
              row={row}
              anchor={menu.anchor}
              onClose={closeMenus}"""),
]
fix(p, reps, "ManageSheet")
