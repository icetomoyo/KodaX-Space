// GlassAurora — F060 背景柔光层（Liquid Glass）
//
//   - minimal  → 不渲染，零开销。
//   - balanced → 3 团静止柔光：玻璃 backdrop-filter 模糊结果可被缓存，空闲与鼠标移动近零开销。
//   - full     → 同 3 团但慢漂（transform 动画），更有生命感；失焦/隐藏/重交互时自动暂停。
//
// 立体感不在背景，而在玻璃面板本身（光向描边 + 光标 specular + 分层柔影，见 styles.css）。
// 背景只提供克制的环境光，遵循 visionOS「别堆叠花哨元素、保持简洁」。
//
// 性能护栏：漂移动画仅在 full 档开启；窗口失焦 / 隐藏时暂停，滚动、拖拽与窗口缩放期间
// 也会短暂停漂，并通过 html class 临时卸下中央大面积 backdrop-filter。

import type { WindowActivityPayload } from '@kodax-space/space-ipc-schema';
import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore.js';
import { isLocalDocumentActive, shouldPauseAurora } from './auroraActivity.js';

const INTERACTION_PAUSE_MS = 180;
const INTERACTION_CLASS = 'visual-interaction-active';
const STREAMING_CLASS = 'visual-streaming-active';

export function GlassAurora(): JSX.Element | null {
  const quality = useAppStore((s) => s.visualQuality);
  const streaming = useAppStore((s) => {
    const sessionId = s.currentSessionId;
    if (!sessionId) return false;
    const projection = s.liveProjectionBySession[sessionId];
    return (
      Boolean(s.pendingSendBySession[sessionId]) ||
      projection?.activeRun !== undefined ||
      (projection?.queuedRuns.length ?? 0) > 0 ||
      s.compactingBySession[sessionId] === true
    );
  });
  const layerRef = useRef<HTMLDivElement | null>(null);

  // 窗口可见且聚焦时才让极光漂移；失焦 / 最小化 / 切后台一律暂停。
  // 滚动、拖拽或缩放窗口时短暂停漂与中央大面积模糊，停止交互后自动恢复完整观感。
  // 仅 full 档有漂移动画需要暂停；balanced 静止、minimal 不渲染，都无需挂监听。
  useEffect(() => {
    const layer = layerRef.current;
    if (quality !== 'full') {
      layer?.classList.remove('is-paused');
      document.documentElement.classList.remove(INTERACTION_CLASS);
      document.documentElement.classList.remove(STREAMING_CLASS);
      return undefined;
    }

    let activity: WindowActivityPayload | null = null;
    let interactionActive = false;
    let interactionTimer = 0;
    const sync = (): void => {
      const paused = shouldPauseAurora(
        quality,
        activity,
        isLocalDocumentActive(document),
        interactionActive,
        streaming,
      );
      layer?.classList.toggle('is-paused', paused);
      document.documentElement.classList.toggle(INTERACTION_CLASS, interactionActive);
      document.documentElement.classList.toggle(STREAMING_CLASS, streaming);
    };
    const pauseForInteraction = (): void => {
      if (!interactionActive) {
        interactionActive = true;
        sync();
      }
      if (interactionTimer !== 0) window.clearTimeout(interactionTimer);
      interactionTimer = window.setTimeout(() => {
        interactionTimer = 0;
        interactionActive = false;
        sync();
      }, INTERACTION_PAUSE_MS);
    };
    const pauseForPointerDrag = (event: PointerEvent): void => {
      if (event.buttons !== 0) pauseForInteraction();
    };
    const offWindowActivity = window.kodaxSpace?.on('window.activity', (payload) => {
      activity = payload;
      sync();
    });

    sync();
    window.addEventListener('focus', sync);
    window.addEventListener('blur', sync);
    window.addEventListener('resize', pauseForInteraction, { passive: true });
    window.addEventListener('wheel', pauseForInteraction, { passive: true });
    document.addEventListener('scroll', pauseForInteraction, { capture: true, passive: true });
    document.addEventListener('pointermove', pauseForPointerDrag, { passive: true });
    document.addEventListener('visibilitychange', sync);
    return () => {
      offWindowActivity?.();
      window.removeEventListener('focus', sync);
      window.removeEventListener('blur', sync);
      window.removeEventListener('resize', pauseForInteraction);
      window.removeEventListener('wheel', pauseForInteraction);
      document.removeEventListener('scroll', pauseForInteraction, { capture: true });
      document.removeEventListener('pointermove', pauseForPointerDrag);
      document.removeEventListener('visibilitychange', sync);
      if (interactionTimer !== 0) window.clearTimeout(interactionTimer);
      layer?.classList.remove('is-paused');
      document.documentElement.classList.remove(INTERACTION_CLASS);
      document.documentElement.classList.remove(STREAMING_CLASS);
    };
  }, [quality, streaming]);

  if (quality === 'minimal') return null;

  return (
    <div className="aurora-layer" aria-hidden ref={layerRef}>
      <div className="aurora-blob aurora-b1" />
      <div className="aurora-blob aurora-b2" />
      <div className="aurora-blob aurora-b3" />
    </div>
  );
}
