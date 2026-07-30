// Reveal — F068 通用入场动画包装（fade-up + stagger）。
//
// mount 触发的一次性入场：CSS keyframe ks-msg-in（styles.css）+ inline animation-delay 注入 stagger。
// stagger 受 STAGGER_CAP 封顶：超过 N 条后不再累加延迟（避免 50 条历史回填时最后一条等 1.2s）。
//
// 门控：.reveal 工具类已在 styles.css 用 html:not(.q-minimal) 前缀 + reduced-motion 兜底，
// 极简档 / 减弱动效用户 = 瞬切，组件本身无需关心。
//
// 用法：<Reveal index={i}><MessageContent /></Reveal>

import type { ReactNode } from 'react';
import { STAGGER_CAP, STAGGER_MS } from '../lib/motion.js';

interface RevealProps {
  /** 列表位置索引，用于计算 stagger 延迟。默认 0（无延迟）。 */
  index?: number;
  /** 额外 class。 */
  className?: string;
  /** Long restored transcripts animate only their recent tail; older rows mount without fan-out. */
  animate?: boolean;
  children: ReactNode;
}

/**
 * 通用 fade-up + stagger 入场包装。仅注入 class + animation-delay；
 * 实际 keyframe/easing/门控全在 styles.css .reveal 工具类。
 */
export function Reveal({
  index = 0,
  className,
  animate = true,
  children,
}: RevealProps): JSX.Element {
  // index 超过 STAGGER_CAP 不再累加延迟，避免长列表拖尾
  const delay = Math.min(index, STAGGER_CAP) * STAGGER_MS;
  return (
    <div
      className={`${animate ? 'reveal' : ''} ${className ?? ''}`}
      style={animate ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
