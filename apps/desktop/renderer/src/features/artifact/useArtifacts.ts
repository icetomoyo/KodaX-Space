// Renderer hooks for the artifact store (F059): list a session's artifacts (live,
// re-fetched on artifact.changed) and read one version's content.

import { useEffect, useRef, useState } from 'react';
import type { ArtifactRefT } from '@kodax-space/space-ipc-schema';
import type { ArtifactVersionPayload } from './toArtifactContent';

/** Live list of a session's artifacts; re-fetches on artifact.changed push. */
export function useArtifacts(sessionId: string | null): {
  artifacts: readonly ArtifactRefT[];
  loading: boolean;
  error: string | null;
} {
  const [artifacts, setArtifacts] = useState<readonly ArtifactRefT[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bridge = window.kodaxSpace;
    if (!bridge || !sessionId) {
      setArtifacts([]);
      setLoading(false);
      setError(null);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = (): void => {
      setLoading(true);
      bridge
        .invoke('artifact.list', { sessionId })
        .then((res) => {
          if (!alive) return;
          if (res.ok) {
            setArtifacts(res.data.artifacts);
            setError(null);
          } else {
            setError(res.error.message || 'Unable to load artifacts');
          }
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (!alive) return;
          setError(err instanceof Error ? err.message : 'Unable to load artifacts');
          setLoading(false);
        });
    };
    // Trailing debounce — bounds IPC churn under high-cadence agent writes.
    const scheduleLoad = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, 200);
    };
    load();
    const off = bridge.on('artifact.changed', (payload) => {
      // Skip events that belong to a different session (delete omits sessionId →
      // always reload, since it may have removed one of ours).
      if (payload.sessionId && payload.sessionId !== sessionId) return;
      scheduleLoad();
    });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      off();
    };
  }, [sessionId]);

  return { artifacts, loading, error };
}

/**
 * Fire `onCreated` when a NEW artifact is created for `sessionId` (the precise
 * `artifact.changed reason==='created'` signal — not version bumps, deletes, or
 * session switches). Used by the dynamic RightSidebar to auto-focus the Artifact
 * tab the moment the agent produces one.
 */
export function useArtifactCreated(sessionId: string | null, onCreated: () => void): void {
  const cbRef = useRef(onCreated);
  cbRef.current = onCreated;
  useEffect(() => {
    const bridge = window.kodaxSpace;
    if (!bridge || !sessionId) return;
    const off = bridge.on('artifact.changed', (payload) => {
      if (payload.reason === 'created' && payload.sessionId === sessionId) cbRef.current();
    });
    return off;
  }, [sessionId]);
}

/**
 * Read one artifact by id → its `ref` (kind/title/versions) + the selected version's
 * payload, re-reading on `artifact.changed` for that id (so an open standalone window
 * follows iterations). Unlike useArtifacts/useArtifactContent this needs no sessionId —
 * it's what the store-free ArtifactWindow (F059c L3) renders from.
 */
export function useArtifactRead(
  id: string | null,
  version: number | undefined,
): {
  ref: ArtifactRefT | null;
  payload: ArtifactVersionPayload | null;
  loading: boolean;
  error: string | null;
} {
  const [ref, setRef] = useState<ArtifactRefT | null>(null);
  const [payload, setPayload] = useState<ArtifactVersionPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(id));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bridge = window.kodaxSpace;
    if (!bridge || !id) {
      setRef(null);
      setPayload(null);
      setLoading(false);
      setError(id ? '运行环境不可用' : null);
      return;
    }
    let alive = true;
    // Clear stale data so a changed id/version never flashes the previous artifact.
    setRef(null);
    setPayload(null);
    setError(null);
    // silent=true：artifact.changed 触发的后台刷新——不切 loading 旋转，避免 pin 版本时
    // 每次变更都闪一下"加载中"（版本内容不可变；刷新只为让新版本进 ref.versions 下拉）。
    const load = (silent = false): void => {
      if (!silent) setLoading(true);
      bridge
        .invoke('artifact.read', version !== undefined ? { id, version } : { id })
        .then((res) => {
          if (!alive) return;
          if (res.ok) {
            setRef(res.data.ref);
            setPayload({
              content: res.data.content,
              path: res.data.path,
              fileSource: res.data.fileSource,
              contentHash: res.data.contentHash,
            });
            setError(null);
          } else {
            setRef(null);
            setPayload(null);
            setError('无法加载该 artifact');
          }
          setLoading(false);
        })
        .catch(() => {
          if (!alive) return;
          setRef(null);
          setPayload(null);
          setError('无法加载该 artifact');
          setLoading(false);
        });
    };
    load();
    const off = bridge.on('artifact.changed', (p) => {
      if (p.id === id) load(true);
    });
    return () => {
      alive = false;
      off();
    };
  }, [id, version]);

  return { ref, payload, loading, error };
}

/** Read one artifact version's payload (content for content kinds, path for doc kinds). */
export function useArtifactContent(
  id: string | null,
  version: number | undefined,
): { payload: ArtifactVersionPayload | null; loading: boolean } {
  const [payload, setPayload] = useState<ArtifactVersionPayload | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const bridge = window.kodaxSpace;
    if (!bridge || !id) {
      setPayload(null);
      return;
    }
    let alive = true;
    setLoading(true);
    bridge
      .invoke('artifact.read', version !== undefined ? { id, version } : { id })
      .then((res) => {
        if (!alive) return;
        setPayload(
          res.ok
            ? {
                content: res.data.content,
                path: res.data.path,
                fileSource: res.data.fileSource,
                contentHash: res.data.contentHash,
              }
            : null,
        );
        setLoading(false);
      })
      .catch(() => {
        if (alive) {
          setPayload(null);
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [id, version]);

  return { payload, loading };
}
