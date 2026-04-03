# 表格拖动选中效果优化方案

## 问题分析

经过代码分析，当前表格的拖动选中效果存在以下问题：

### 1. 选中状态切换逻辑问题
**位置**: `src/components/business/DataGrid/TableView.tsx` 第 543-561 行

在 `handleCellClick` 中，每次点击单元格都会**清空所有行选中状态**：
```tsx
const nextSelectedRows = new Set<number>();
selectedRowsRef.current = nextSelectedRows;
setSelectedRows(nextSelectedRows);
```

这导致用户无法通过拖动行号列来多选行后，再点击某个单元格保留行选中状态。

### 2. 不支持单元格区域拖动选择
**位置**: `src/components/business/DataGrid/TableView.tsx` 第 543-561 行

当前的 `handleCellClick` 只支持单单元格点击选中，不支持类似 Excel 的拖动选择矩形区域。

### 3. 拖动选择体验不佳
**位置**: `src/components/business/DataGrid/TableView.tsx` 第 489-519 行

- 行号列的拖动选择 (`handleIndexMouseDown` / `handleIndexMouseEnter`) 只支持**行选择**，不支持**单元格区域拖动选择**
- 没有视觉反馈指示当前正在拖动选择中

### 4. 选中样式过渡生硬
**位置**: `src/components/business/DataGrid/TableView.tsx` 第 2009-2029 行

单元格的选中样式只有简单的背景色变化，缺少平滑过渡：
```tsx
selected && !editing
  ? "bg-accent text-accent-foreground"
  : "",
```

### 5. 混合选中状态不清晰
- 单元格选中 (`selectedCell`) 和行选中 (`selectedRows`) 互斥，容易让用户困惑
- 没有明确区分「单选单元格」和「多选行」的操作模式

### 6. 缺少键盘多选支持
无法通过 `Shift+Click` 或 `Ctrl/Cmd+Click` 进行多选。

---

## 优化方案：单元格区域拖动选择

### 方案概述
实现类似 Excel 的单元格区域拖动选择功能，允许用户通过鼠标拖动选择一个矩形区域的单元格。

### 需要修改的地方

#### 1. 新增状态管理
**位置**: `src/components/business/DataGrid/TableView.tsx` 第 218-227 行之后

新增以下状态：
```tsx
// Cell range selection state (Excel-like drag selection)
const [selectedRange, setSelectedRange] = useState<{
  startRow: number;
  endRow: number;
  startColIndex: number;
  endColIndex: number;
} | null>(null);
const [isRangeSelecting, setIsRangeSelecting] = useState(false);
const [rangeSelectionAnchor, setRangeSelectionAnchor] = useState<{
  row: number;
  colIndex: number;
} | null>(null);
```

**位置**: `src/components/business/DataGrid/TableView.tsx` 第 260-261 行之后

新增 ref：
```tsx
const selectedRangeRef = useRef<{
  startRow: number;
  endRow: number;
  startColIndex: number;
  endColIndex: number;
} | null>(null);
```

**位置**: `src/components/business/DataGrid/TableView.tsx` 第 267-270 行之后

添加 useEffect 同步：
```tsx
useEffect(() => {
  selectedRangeRef.current = selectedRange;
}, [selectedRange]);
```

---

#### 2. 修改单元格交互逻辑
**位置**: `src/components/business/DataGrid/TableView.tsx` 第 542-562 行

将 `handleCellClick` 替换为三个新函数：

```tsx
// --- Cell interaction handlers ---
const handleCellMouseDown = useCallback(
  (e: React.MouseEvent, rowIndex: number, colIndex: number, col: string) => {
    if (e.button !== 0) return; // Only handle left click

    // If editing a different cell, commit first
    if (
      editingCell &&
      (editingCell.row !== rowIndex || editingCell.col !== col)
    ) {
      commitEdit();
    }

    // Clear row selection when starting cell selection
    const nextSelectedRows = new Set<number>();
    selectedRowsRef.current = nextSelectedRows;
    setSelectedRows(nextSelectedRows);
    setRowSelectionAnchor(null);
    setIsRowSelecting(false);

    // Start range selection
    setIsRangeSelecting(true);
    setRangeSelectionAnchor({ row: rowIndex, colIndex });

    // Initialize range as single cell
    const range = {
      startRow: rowIndex,
      endRow: rowIndex,
      startColIndex: colIndex,
      endColIndex: colIndex,
    };
    setSelectedRange(range);
    selectedRangeRef.current = range;

    // Also set selected cell for compatibility
    const nextSelectedCell = { row: rowIndex, col };
    selectedCellRef.current = nextSelectedCell;
    setSelectedCell(nextSelectedCell);
  },
  [editingCell, commitEdit],
);

const handleCellMouseEnter = useCallback(
  (rowIndex: number, colIndex: number) => {
    if (!isRangeSelecting || !rangeSelectionAnchor) return;

    // Calculate the normalized range (start <= end)
    const startRow = Math.min(rangeSelectionAnchor.row, rowIndex);
    const endRow = Math.max(rangeSelectionAnchor.row, rowIndex);
    const startColIndex = Math.min(rangeSelectionAnchor.colIndex, colIndex);
    const endColIndex = Math.max(rangeSelectionAnchor.colIndex, colIndex);

    const range = { startRow, endRow, startColIndex, endColIndex };
    setSelectedRange(range);
    selectedRangeRef.current = range;
  },
  [isRangeSelecting, rangeSelectionAnchor],
);

const handleCellClick = useCallback(
  (rowIndex: number, col: string) => {
    // This is now called on mouseup, just ensure state is clean
    // The actual selection logic is in handleCellMouseDown
  },
  [],
);
```

---

#### 3. 添加鼠标释放事件处理
**位置**: `src/components/business/DataGrid/TableView.tsx` 在 useEffect 中添加全局 mouseup 监听

在组件中添加以下 useEffect：
```tsx
// Handle mouse up to end range selection
useEffect(() => {
  const handleMouseUp = () => {
    setIsRangeSelecting(false);
  };

  if (isRangeSelecting) {
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }
}, [isRangeSelecting]);
```

---

#### 4. 修改单元格渲染逻辑
**位置**: `src/components/business/DataGrid/TableView.tsx` 第 2004-2083 行

修改 `<td>` 的渲染：

```tsx
<td
  key={column}
  data-row-index={rowIndex}
  data-col-index={colIndex}
  className={[
    "px-0 py-0 text-sm text-foreground font-mono border-r border-border relative transition-all duration-150 ease-out",
    // Check if this cell is in the selected range
    selectedRange &&
      rowIndex >= selectedRange.startRow &&
      rowIndex <= selectedRange.endRow &&
      colIndex >= selectedRange.startColIndex &&
      colIndex <= selectedRange.endColIndex
      ? "bg-primary/10 ring-1 ring-inset ring-primary/30"
      : "",
    // Single cell selected (when no range or range is single cell)
    selected && !editing && !selectedRange
      ? "bg-accent text-accent-foreground"
      : "",
    isRowSelected && !selected && !editing
      ? "bg-accent/60"
      : "",
    matched && !editing
      ? "bg-amber-100/60 dark:bg-amber-900/20"
      : "",
    activeSearchMatch && !editing
      ? "border-b-2 border-b-amber-500/70"
      : "",
    modified && !editing
      ? "border-l-2 border-l-orange-400"
      : "",
    isEditableForUpdates ? "cursor-pointer" : "",
  ]
    .filter(Boolean)
    .join(" ")}
  style={{
    width: getColWidth(column),
    minWidth: 50,
  }}
  onMouseDown={(e) => handleCellMouseDown(e, rowIndex, colIndex, column)}
  onMouseEnter={() => handleCellMouseEnter(rowIndex, colIndex)}
  onClick={() => handleCellClick(rowIndex, column)}
  onContextMenu={() => {
    if (selectedRows.size > 1 && selectedRows.has(rowIndex)) {
      return;
    }
    handleCellClick(rowIndex, column);
  }}
  onDoubleClick={() =>
    handleCellDoubleClick(rowIndex, column, row[column])
  }
>
```

---

#### 5. 优化选中区域的视觉效果
**位置**: `src/components/business/DataGrid/TableView.tsx` 样式部分

建议添加以下 CSS 样式增强（可以在 tailwind.config.js 或全局 CSS 中）：

```css
/* 选中区域的单元格效果 */
.cell-in-range {
  @apply bg-primary/10 ring-1 ring-inset ring-primary/30;
  transition: all 0.1s ease-out;
}

/* 拖动选择时的视觉反馈 */
.cell-selecting {
  @apply bg-primary/15 ring-2 ring-inset ring-primary/50;
}

/* 选中区域的活动单元格 */
.cell-active-in-range {
  @apply bg-accent text-accent-foreground font-medium;
}
```

---

#### 6. 更新复制逻辑以支持选中区域
**位置**: `src/components/business/DataGrid/TableView.tsx` 复制相关的函数

需要添加一个辅助函数来获取选中范围内的数据：

```tsx
const getSelectedRangeCopyText = useCallback(() => {
  if (!selectedRange) return null;

  const { startRow, endRow, startColIndex, endColIndex } = selectedRange;
  const rangeData: string[][] = [];

  for (let r = startRow; r <= endRow; r++) {
    const rowData: string[] = [];
    for (let c = startColIndex; c <= endColIndex; c++) {
      const col = columns[c];
      const value = currentData[r]?.[col];
      const displayValue = getCellDisplayValue(r, col, value);
      rowData.push(
        displayValue === null || displayValue === undefined
          ? ""
          : String(displayValue)
      );
    }
    rangeData.push(rowData);
  }

  return rangeData.map((row) => row.join("\t")).join("\n");
}, [selectedRange, columns, currentData, getCellDisplayValue]);
```

---

#### 7. 更新右键菜单
**位置**: `src/components/business/DataGrid/TableView.tsx` 第 2088-2191 行

在右键菜单中添加对选中范围的复制支持：

```tsx
<ContextMenuItem
  onClick={() => {
    if (selectedRange) {
      const text = getSelectedRangeCopyText();
      if (text) {
        handleCopy(text);
      }
    } else if (selectedCell && selectedCell.row === rowIndex) {
      const text = getSelectedCellCopyText();
      if (text !== null) {
        handleCopy(text);
      }
    }
  }}
>
  <Copy className="w-4 h-4 mr-2" />
  {selectedRange ? "Copy Range" : "Copy Cell"}
</ContextMenuItem>
```

---

## 修改文件清单

| 文件路径 | 修改内容 |
|---------|---------|
| `src/components/business/DataGrid/TableView.tsx` | 新增状态、修改交互逻辑、更新渲染逻辑 |

---

## 预期效果

1. **拖动选择**: 用户可以在表格上按住鼠标左键拖动，选择一个矩形区域的单元格
2. **视觉反馈**: 选中的区域会有半透明背景和边框高亮
3. **平滑过渡**: 选中状态的切换有平滑的过渡动画
4. **兼容性**: 保持原有的行选择功能（通过行号列）和单单元格选择功能

---

## 可选增强功能

如果需要进一步优化，可以考虑：

1. **键盘辅助选择**: 支持 `Shift+Click` 范围选择、`Ctrl/Cmd+Click` 多选
2. **拖动方向指示**: 在拖动过程中显示选择方向的箭头
3. **选中区域统计**: 在状态栏显示选中区域的行数、列数
4. **跨页选择**: 支持跨分页的单元格选择（需要更复杂的实现）
