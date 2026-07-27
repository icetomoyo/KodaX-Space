// ScrollCapBox — 展开内容限高 + 内部滚动 + 底部 sticky 操作栏。
//
// 背景（2026-07-27 用户反馈）：ToolCluster / ThinkingBlock 展开时全量撑开，几千行内容
// 把历史突然拉长，看完想折叠要滚回去找头部按钮，很费劲。
//
// 行为：
//   - 内容超过 CAP（60vh）时限高并内部滚动（overflow-y-auto），历史不再被拉长；
//     未超高内容零影响（max-height 不生效，操作栏也不出现）。
//   - 截断时块底出现 sticky 操作栏：「收起」一键折叠（不用滚回头部）、
//     「查看全部」临时解除限高（恢复旧的全量撑开，便于线性通读），再点「恢复限高」回到内滚。
//   - 截断时操作栏上方带渐变遮罩，提示"下面还有内容"。
//
// 嵌套滚动取舍：Chromium 默认滚动链式传递（内层滚到底后轮转给外层历史），可接受；
// 不加 overscroll-behavior: contain，避免把滚轮"困死"在块内。
//
// 纯度约定：components/ 层不依赖 i18n（见 Collapse），文案经 labels 由调用方注入。

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** 限高阈值：视口高的 60%。超出才出现内部滚动与操作栏。 */
const CAP_CLASS = 'max-h-[60vh]';
const TAIL_DISTANCE_PX = 1;

export interface ScrollCapBoxLabels {
  /** 底部栏「收起」——与头部折叠按钮同义，调 onCollapse。 */
  collapse: string;
  /** 解除限高，全量撑开（旧的展开行为）。 */
  expandAll: string;
  /** 从全量状态回到限高内滚。 */
  restoreCap: string;
}

interface ScrollCapBoxProps {
  /** 底部栏「收起」回调——通常与头部折叠按钮同一 handler（幂等收起）。 */
  onCollapse: () => void;
  labels: ScrollCapBoxLabels;
  /** 外层间距/定位类（如 'mt-1.5 ml-3'），作用于限高容器本身。 */
  className?: string;
  /** 需要继续作用于内容直属包装层的布局类。 */
  contentClassName?: string;
  /** 内容流式增长时追随末尾；用户在块内上滚后自动停止。 */
  followTail?: boolean;
  children: ReactNode;
}

export function ScrollCapBox({
  onCollapse,
  labels,
  className,
  contentClassName,
  followTail = false,
  children,
}: ScrollCapBoxProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followingTailRef = useRef(followTail);
  const previousFollowTailRef = useRef(followTail);
  const [truncated, setTruncated] = useState(false);
  const [unlimited, setUnlimited] = useState(false);
  const [atTail, setAtTail] = useState(true);

  // 截断检测：scrollHeight > clientHeight 即被限高截断。
  // ResizeObserver 覆盖内容异步增长（图片/markdown 重排）与窗口 resize。
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    if (followTail && !previousFollowTailRef.current) {
      followingTailRef.current = true;
    } else if (!followTail) {
      followingTailRef.current = false;
    }
    previousFollowTailRef.current = followTail;
    if (unlimited) {
      setTruncated(false);
      setAtTail(true);
      return;
    }
    const check = (): void => {
      const overflowing = el.scrollHeight > el.clientHeight + TAIL_DISTANCE_PX;
      setTruncated(overflowing);
      if (overflowing && followTail && followingTailRef.current) {
        el.scrollTop = el.scrollHeight;
      }
      setAtTail(el.scrollHeight - el.clientHeight - el.scrollTop <= TAIL_DISTANCE_PX);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    // 达到 max-height 后，滚动容器本身不再变高；继续观察内容层，
    // 才能在流式文本继续增长时维持截断判断与末尾跟随。
    observer.observe(content);
    return () => observer.disconnect();
  }, [followTail, unlimited]);

  function handleScroll(): void {
    const el = scrollRef.current;
    if (!el || unlimited) return;
    const nextAtTail = el.scrollHeight - el.clientHeight - el.scrollTop <= TAIL_DISTANCE_PX;
    followingTailRef.current = followTail && nextAtTail;
    setAtTail(nextAtTail);
  }

  // 操作栏出现条件：当前被截断（限高态），或已解除限高（需要「恢复限高」出口）。
  const showBar = truncated || unlimited;

  return (
    <div
      ref={scrollRef}
      data-scrollcapbox=""
      onScroll={handleScroll}
      className={[unlimited ? '' : `${CAP_CLASS} overflow-y-auto`, className ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      <div ref={contentRef} className={contentClassName}>
        {children}
      </div>
      {showBar && (
        // sticky bottom-0：限高态下吸附在块内滚动口底部，「收起」随手可点；
        // unlimited 态下相对外层历史滚动口吸附，通读长文时收起按钮始终在视野内。
        <div className="sticky bottom-0">
          {truncated && !unlimited && !atTail && (
            <div className="pointer-events-none h-6 bg-gradient-to-t from-surface to-transparent" />
          )}
          <div className="flex items-center gap-2 border-t border-border-default/60 bg-surface/95 px-2 py-1 backdrop-blur-sm">
            <button
              type="button"
              onClick={onCollapse}
              className={[
                'rounded border border-border-default/70 bg-surface-2/45 px-2 py-0.5',
                'font-mono text-[11px] text-fg-muted transition-colors',
                'hover:border-border-strong hover:bg-hover-bg hover:text-fg-primary',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong',
              ].join(' ')}
            >
              {labels.collapse}
            </button>
            <button
              type="button"
              onClick={() => setUnlimited((value) => !value)}
              className={[
                'rounded border border-border-default/70 bg-surface-2/45 px-2 py-0.5',
                'font-mono text-[11px] text-fg-muted transition-colors',
                'hover:border-border-strong hover:bg-hover-bg hover:text-fg-primary',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong',
              ].join(' ')}
            >
              {unlimited ? labels.restoreCap : labels.expandAll}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
