// useSpotlight — F060 Liquid Glass 光标 specular 高光
//
// Linear/Cursor/visionOS 同款：柔光跟随光标在玻璃面板上移动，靠近的面板提亮。
// 关键：高光层是 .glass::after（radial-gradient，pointer-events:none）—— 全程不挡点击、
// 不移动任何布局，根治「整面板倾斜导致误点」。本 hook 只更新 CSS 变量 --mx/--my + .lit class。
//
// 两种聚光模式（按视觉质量档分流）：
//   · balanced（默认）→ 单卡聚光：保持「160px 内最近一块」的现有观感，每帧最多点亮一块。
//   · full（全特效）   → 多面板晕染：继续点亮 160px 内所有面板，但将跟随频率限制到 30fps。
// 公共：面板 rect 只在布局实际变化时刷新，指针帧只做缓存数字计算，不再逐帧
// querySelectorAll + getBoundingClientRect。拖拽时暂停高光；空闲 / 流式输出时完全不跑。

import { useEffect } from 'react';
import { useAppStore } from '../store/appStore.js';

const NEAR = 160; // 光标进入面板外扩 160px 视为「近」，开始显高光
const FULL_FRAME_MS = 1000 / 30;

function distanceToRect(x: number, y: number, rect: DOMRectReadOnly): number {
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return Math.hypot(dx, dy);
}

export function useSpotlight(): void {
  const quality = useAppStore((s) => s.visualQuality);

  useEffect(() => {
    if (quality === 'minimal') return undefined;
    const multi = quality === 'full'; // full：多面板晕染；balanced：单卡聚光

    let raf = 0;
    let throttleTimer = 0;
    let lastApplyAt = 0;
    let lastX = 0;
    let lastY = 0;
    let pointerDragging = false;
    let litEl: HTMLElement | null = null; // 仅单卡模式追踪当前点亮的那块
    let panels: HTMLElement[] = [];
    let panelRects = new Map<HTMLElement, DOMRectReadOnly>();
    let observedPanels = new Set<HTMLElement>();
    let geometryDirty = true;

    const clearAllLit = (): void => {
      document
        .querySelectorAll<HTMLElement>('.glass.lit')
        .forEach((c) => c.classList.remove('lit'));
      litEl = null;
    };

    const lightPanel = (p: HTMLElement, r: DOMRectReadOnly): void => {
      p.style.setProperty('--mx', `${(lastX - r.left).toFixed(0)}px`);
      p.style.setProperty('--my', `${(lastY - r.top).toFixed(0)}px`);
    };

    const markGeometryDirty = (): void => {
      geometryDirty = true;
    };
    const resizeObserver = new ResizeObserver(markGeometryDirty);
    const mutationObserver = new MutationObserver(markGeometryDirty);

    const refreshGeometry = (): void => {
      const nextPanels = Array.from(document.querySelectorAll<HTMLElement>('.glass'));
      const nextObserved = new Set(nextPanels);
      for (const panel of observedPanels) {
        if (!nextObserved.has(panel)) resizeObserver.unobserve(panel);
      }
      for (const panel of nextPanels) {
        if (!observedPanels.has(panel)) resizeObserver.observe(panel);
      }
      panels = nextPanels;
      observedPanels = nextObserved;
      panelRects = new Map(panels.map((panel) => [panel, panel.getBoundingClientRect()]));
      if (litEl && !observedPanels.has(litEl)) litEl = null;
      geometryDirty = false;
    };

    const apply = (now: number): void => {
      raf = 0;
      lastApplyAt = now;
      if (geometryDirty) refreshGeometry();

      if (multi) {
        // 多面板观感保持不变：每块独立判断 NEAR，只是 rect 来自布局变化时生成的缓存。
        for (const p of panels) {
          const r = panelRects.get(p);
          if (!r) continue;
          const near =
            lastX > r.left - NEAR &&
            lastX < r.right + NEAR &&
            lastY > r.top - NEAR &&
            lastY < r.bottom + NEAR;
          p.classList.toggle('lit', near);
          if (near) lightPanel(p, r);
        }
        return;
      }

      // 单卡：找离光标最近、且在 NEAR 阈值内的单块面板（rect 内距离为 0）。
      let best: HTMLElement | null = null;
      let bestRect: DOMRectReadOnly | null = null;
      let bestDist = Infinity;
      for (const p of panels) {
        const r = panelRects.get(p);
        if (!r) continue;
        const dist = distanceToRect(lastX, lastY, r);
        if (dist <= NEAR && dist < bestDist) {
          bestDist = dist;
          best = p;
          bestRect = r;
        }
      }
      if (best !== litEl) {
        if (litEl) litEl.classList.remove('lit');
        litEl = best;
        if (best) best.classList.add('lit');
      }
      if (litEl && bestRect) lightPanel(litEl, bestRect);
    };

    const scheduleApply = (): void => {
      if (raf !== 0 || throttleTimer !== 0) return;
      if (!multi) {
        raf = requestAnimationFrame(apply);
        return;
      }
      const remaining = FULL_FRAME_MS - (performance.now() - lastApplyAt);
      if (remaining <= 0) {
        raf = requestAnimationFrame(apply);
        return;
      }
      throttleTimer = window.setTimeout(() => {
        throttleTimer = 0;
        raf = requestAnimationFrame(apply);
      }, remaining);
    };

    const cancelScheduledApply = (): void => {
      if (raf !== 0) cancelAnimationFrame(raf);
      if (throttleTimer !== 0) window.clearTimeout(throttleTimer);
      raf = 0;
      throttleTimer = 0;
    };

    const onMove = (e: PointerEvent): void => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (e.buttons !== 0) {
        if (!pointerDragging) {
          pointerDragging = true;
          markGeometryDirty();
          cancelScheduledApply();
          clearAllLit();
        }
        return;
      }
      if (pointerDragging) {
        pointerDragging = false;
        markGeometryDirty();
      }
      scheduleApply();
    };
    const onLeave = (): void => {
      cancelScheduledApply();
      clearAllLit();
    };

    mutationObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', markGeometryDirty, { passive: true });
    document.addEventListener('scroll', markGeometryDirty, { capture: true, passive: true });
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('resize', markGeometryDirty);
      document.removeEventListener('scroll', markGeometryDirty, { capture: true });
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      cancelScheduledApply();
      clearAllLit();
    };
  }, [quality]);
}
