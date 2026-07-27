// Collapse — F068 通用高度折叠动画包装。
//
// 采用 CSS Grid grid-template-rows: 0fr → 1fr 技巧（无需 JS 测量像素，零 layout 抖动，
// 对动态内容自适应）。仅动 grid-rows + opacity，GPU 友好。
//
// grid-template-rows 过渡在现代 Chromium（Electron 底座）全支持，比传统 max-height hack 更稳
// （无估高问题），比 JS measuring 更省（零 effect）。
//
// 门控：.collapse-track 工具类在 styles.css 用 html:not(.q-minimal) 前缀 + reduced-motion 兜底，
// 极简档 / 减弱动效用户 = 瞬切。
//
// 用法：<Collapse open={expanded}><DetailContent /></Collapse>

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface CollapseProps {
  /** 是否展开。true = 展示内容（grid-rows 1fr），false = 折叠（grid-rows 0fr）。 */
  open: boolean;
  lazyMount?: boolean;
  children: ReactNode;
}

/**
 * 高度折叠包装。grid-rows 0fr↔1fr + opacity 0↔1，transition 由 styles.css .collapse-track 控制。
 * 内层 overflow:clip 防止折叠态内容溢出，同时不创建会截断后代 sticky 的滚动容器。
 */
export function Collapse({ open, lazyMount = false, children }: CollapseProps): JSX.Element {
  // 可访问性：折叠态把内容移出 accessibility tree 与 Tab 序——aria-hidden + inert。
  // 此前折叠态仅 grid-rows:0fr + opacity:0，内容仍在 DOM 与 a11y tree 中，屏幕阅读器仍朗读、
  // 键盘 Tab 仍可聚焦到隐藏内容里。inert 一并把整棵子树移出 Tab 序 + a11y tree + 禁用指针。
  // inert 用 setAttribute 设/清：默认 @types/react 18.3 未把 inert 声明为 boolean prop（仅在
  // experimental.d.ts），setAttribute 在所有 TS 版本下都类型安全且 Electron/Chromium 运行可靠。
  const contentRef = useRef<HTMLDivElement>(null);
  const [hasMounted, setHasMounted] = useState(() => open || !lazyMount);
  useEffect(() => {
    if (!lazyMount || open) setHasMounted(true);
  }, [lazyMount, open]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    if (open) el.removeAttribute('inert');
    else el.setAttribute('inert', '');
  }, [open]);

  return (
    <div
      className="collapse-track"
      style={{
        display: 'grid',
        gridTemplateRows: open ? '1fr' : '0fr',
        opacity: open ? 1 : 0,
      }}
    >
      <div ref={contentRef} aria-hidden={!open} style={{ overflow: 'clip', minHeight: 0 }}>
        {hasMounted ? children : null}
      </div>
    </div>
  );
}
