// GlassAurora — F060 背景柔光层（Liquid Glass）
//
//   - minimal  → 不渲染，零开销。
//   - balanced → 3 团静止柔光：玻璃 backdrop-filter 模糊结果可被缓存，空闲与鼠标移动近零开销。
//   - full     → 同 3 团但慢漂（transform 动画），更有生命感；失焦/隐藏时自动暂停。
//
// 立体感不在背景，而在玻璃面板本身（光向描边 + 光标 specular + 分层柔影，见 styles.css）。
// 背景只提供克制的环境光，遵循 visionOS「别堆叠花哨元素、保持简洁」。
//
// 性能护栏：漂移动画会让其上方 backdrop-filter 每帧重算，故仅 full 档开（见 styles.css）；
// 且窗口失焦 / 隐藏时挂 .is-paused 暂停动画，绝不在后台抢占共享 GPU。

import type { WindowActivityPayload } from '@kodax-space/space-ipc-schema';
import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore.js';
import { isLocalDocumentActive, shouldPauseAurora } from './auroraActivity.js';

export function GlassAurora(): JSX.Element | null {
  const quality = useAppStore((s) => s.visualQuality);
  const layerRef = useRef<HTMLDivElement | null>(null);

  // 窗口可见且聚焦时才让极光漂移；失焦 / 最小化 / 切后台一律暂停。
  // 仅 full 档有漂移动画需要暂停；balanced 静止、minimal 不渲染，都无需挂监听。
  useEffect(() => {
    const layer = layerRef.current;
    if (quality !== 'full') {
      layer?.classList.remove('is-paused');
      return undefined;
    }

    let activity: WindowActivityPayload | null = null;
    const sync = (): void => {
      const paused = shouldPauseAurora(quality, activity, isLocalDocumentActive(document));
      layer?.classList.toggle('is-paused', paused);
    };
    const offWindowActivity = window.kodaxSpace?.on('window.activity', (payload) => {
      activity = payload;
      sync();
    });

    sync();
    window.addEventListener('focus', sync);
    window.addEventListener('blur', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      offWindowActivity?.();
      window.removeEventListener('focus', sync);
      window.removeEventListener('blur', sync);
      document.removeEventListener('visibilitychange', sync);
      layer?.classList.remove('is-paused');
    };
  }, [quality]);

  if (quality === 'minimal') return null;

  return (
    <div className="aurora-layer" aria-hidden ref={layerRef}>
      <div className="aurora-blob aurora-b1" />
      <div className="aurora-blob aurora-b2" />
      <div className="aurora-blob aurora-b3" />
    </div>
  );
}
