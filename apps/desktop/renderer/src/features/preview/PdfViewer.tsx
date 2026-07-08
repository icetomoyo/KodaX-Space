// PdfViewer - F024 PDF rendering.
//
// Uses pdfjs-dist 4.x ESM build. Vite `?url` emits the worker as a static asset
// URL, then pdfjs starts it internally. The viewer renders PDFs as a continuous
// vertical document with lazy-rendered page canvases so Artifact/Preview reading
// stays fluid without keeping every page canvas in memory.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { base64ToBytes } from './binaryUtils.js';
import { useI18n } from '../../i18n/I18nProvider.js';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PDF_MAX_SCALE = 1.25;
const PDF_MIN_SCALE = 0.2;
const PDF_PAGE_GUTTER = 32;
const DEFAULT_PAGE_SIZE = { width: 760, height: 980 } as const;

interface Props {
  readonly base64: string;
}

interface PageSize {
  readonly width: number;
  readonly height: number;
}

interface PdfPageCanvasProps {
  readonly doc: pdfjs.PDFDocumentProxy;
  readonly pageNumber: number;
  readonly shouldRender: boolean;
  readonly availableWidth: number;
  readonly setPageElement: (pageNumber: number, node: HTMLDivElement | null) => void;
}

function clampPage(page: number, totalPages: number): number {
  if (totalPages <= 0) return 1;
  return Math.min(totalPages, Math.max(1, page));
}

function viewportForWidth(page: pdfjs.PDFPageProxy, availableWidth: number): pdfjs.PageViewport {
  const natural = page.getViewport({ scale: 1 });
  const fitScale =
    availableWidth > 0 ? Math.min(PDF_MAX_SCALE, availableWidth / natural.width) : PDF_MAX_SCALE;
  const scale = Math.max(PDF_MIN_SCALE, fitScale);
  return page.getViewport({ scale });
}

function PdfPageCanvas({
  doc,
  pageNumber,
  shouldRender,
  availableWidth,
  setPageElement,
}: PdfPageCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<PageSize | null>(null);

  useEffect(() => {
    let cancelled = false;

    void doc
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return;
        const viewport = viewportForWidth(page, availableWidth);
        setSize({ width: viewport.width, height: viewport.height });
      })
      .catch(() => {
        /* The full viewer-level error state handles open failures. */
      });

    return () => {
      cancelled = true;
    };
  }, [availableWidth, doc, pageNumber]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!shouldRender || canvas === null) return;

    let cancelled = false;
    let task: pdfjs.RenderTask | null = null;

    void doc
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return;
        const viewport = viewportForWidth(page, availableWidth);
        setSize({ width: viewport.width, height: viewport.height });

        const ctx = canvas.getContext('2d');
        if (ctx === null) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        task = page.render({ canvasContext: ctx, viewport });
        task.promise.catch(() => {
          /* Render cancelled by scroll virtualization or page switch. */
        });
      })
      .catch(() => {
        /* Keep the page shell stable even if one page fails to render. */
      });

    return () => {
      cancelled = true;
      if (task !== null) task.cancel();
    };
  }, [availableWidth, doc, pageNumber, shouldRender]);

  const pageSize = size ?? DEFAULT_PAGE_SIZE;

  return (
    <div
      ref={(node) => setPageElement(pageNumber, node)}
      data-pdf-page={pageNumber}
      aria-label={`Page ${pageNumber}`}
      className="relative overflow-hidden rounded-sm bg-white shadow-lg ring-1 ring-border-default/70"
      style={{ width: pageSize.width, height: pageSize.height }}
    >
      {shouldRender ? (
        <canvas ref={canvasRef} className="block bg-white" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-white text-[11px] text-fg-faint">
          {pageNumber}
        </div>
      )}
    </div>
  );
}

export function PdfViewer({ base64 }: Props): JSX.Element {
  const { t } = useI18n();
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const pageElementsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollFrameRef = useRef<number | null>(null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [visiblePages, setVisiblePages] = useState<ReadonlySet<number>>(() => new Set([1]));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [availablePageWidth, setAvailablePageWidth] = useState<number>(DEFAULT_PAGE_SIZE.width);

  useEffect(() => {
    let cancelled = false;
    let loadedDoc: pdfjs.PDFDocumentProxy | null = null;
    let loadingTask: pdfjs.PDFDocumentLoadingTask | null = null;

    setBusy(true);
    setErr(null);
    setDoc(null);
    setPageNum(1);
    setTotalPages(0);
    setVisiblePages(new Set([1]));
    pageElementsRef.current.clear();

    try {
      const bytes = base64ToBytes(base64);
      loadingTask = pdfjs.getDocument({
        data: bytes,
        isEvalSupported: false,
        disableAutoFetch: true,
      });
    } catch {
      setErr(t('preview.failedDecodePdf'));
      setBusy(false);
      return;
    }

    loadingTask.promise
      .then((nextDoc) => {
        if (cancelled) {
          void nextDoc.destroy();
          return;
        }
        loadedDoc = nextDoc;
        setDoc(nextDoc);
        setTotalPages(nextDoc.numPages);
        setBusy(false);
      })
      .catch(() => {
        if (cancelled) return;
        setErr(t('preview.failedOpenPdf'));
        setBusy(false);
      });

    return () => {
      cancelled = true;
      if (loadingTask !== null) void loadingTask.destroy();
      if (loadedDoc !== null) void loadedDoc.destroy();
    };
  }, [base64, t]);

  const pages = useMemo(
    () => Array.from({ length: totalPages }, (_, index) => index + 1),
    [totalPages],
  );

  const setPageElement = useCallback((pageNumber: number, node: HTMLDivElement | null) => {
    if (node === null) {
      pageElementsRef.current.delete(pageNumber);
    } else {
      pageElementsRef.current.set(pageNumber, node);
    }
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;

    const measure = (): void => {
      setAvailablePageWidth(Math.max(180, scroller.clientWidth - PDF_PAGE_GUTTER));
    };
    measure();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(scroller);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [doc]);

  const updateCurrentPageFromScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    if (scroller === null || totalPages <= 0) return;

    const containerRect = scroller.getBoundingClientRect();
    const viewportCenter = containerRect.top + scroller.clientHeight * 0.48;
    let nextPage = pageNum;
    let bestDistance = Number.POSITIVE_INFINITY;

    pageElementsRef.current.forEach((element, pageNumber) => {
      const rect = element.getBoundingClientRect();
      if (rect.bottom < containerRect.top || rect.top > containerRect.bottom) return;
      const pageCenter = rect.top + rect.height / 2;
      const distance = Math.abs(pageCenter - viewportCenter);
      if (distance < bestDistance) {
        bestDistance = distance;
        nextPage = pageNumber;
      }
    });

    setPageNum((current) => (current === nextPage ? current : nextPage));
  }, [pageNum, totalPages]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null || totalPages <= 0) return;

    const scheduleUpdate = (): void => {
      if (scrollFrameRef.current !== null) return;
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        updateCurrentPageFromScroll();
      });
    };

    scroller.addEventListener('scroll', scheduleUpdate, { passive: true });
    scheduleUpdate();

    return () => {
      scroller.removeEventListener('scroll', scheduleUpdate);
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [totalPages, updateCurrentPageFromScroll]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null || totalPages <= 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages((current) => {
          const next = new Set(current);
          let changed = false;

          for (const entry of entries) {
            const rawPage = (entry.target as HTMLElement).dataset.pdfPage;
            const observedPage = rawPage ? Number(rawPage) : Number.NaN;
            if (!Number.isFinite(observedPage)) continue;

            if (entry.isIntersecting) {
              if (!next.has(observedPage)) {
                next.add(observedPage);
                changed = true;
              }
            } else if (next.delete(observedPage)) {
              changed = true;
            }
          }

          return changed ? next : current;
        });
      },
      {
        root: scroller,
        rootMargin: '900px 0px',
        threshold: 0.01,
      },
    );

    pageElementsRef.current.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [totalPages]);

  const jumpToPage = useCallback(
    (requestedPage: number, behavior: ScrollBehavior = 'smooth') => {
      const scroller = scrollerRef.current;
      const targetPage = clampPage(requestedPage, totalPages);
      setPageNum(targetPage);

      const pageElement = pageElementsRef.current.get(targetPage);
      if (scroller === null || pageElement === undefined) return;

      scroller.scrollTo({
        top: Math.max(0, pageElement.offsetTop - 16),
        behavior,
      });
    },
    [totalPages],
  );

  const goPrevious = useCallback(() => jumpToPage(pageNum - 1), [jumpToPage, pageNum]);
  const goNext = useCallback(() => jumpToPage(pageNum + 1), [jumpToPage, pageNum]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;

      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
          event.preventDefault();
          goPrevious();
          break;
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
          event.preventDefault();
          goNext();
          break;
        case 'Home':
          event.preventDefault();
          jumpToPage(1);
          break;
        case 'End':
          event.preventDefault();
          jumpToPage(totalPages);
          break;
        default:
          break;
      }
    },
    [goNext, goPrevious, jumpToPage, totalPages],
  );

  const focusViewer = useCallback(() => {
    viewerRef.current?.focus({ preventScroll: true });
  }, []);

  if (err !== null) {
    return <div className="p-3 text-xs text-danger">{err}</div>;
  }
  if (busy || doc === null) {
    return <div className="p-3 text-xs text-fg-muted">{t('preview.loadingPdf')}</div>;
  }

  return (
    <div
      ref={viewerRef}
      data-testid="pdf-viewer"
      tabIndex={0}
      role="region"
      aria-label={t('preview.pdfViewerAria')}
      onKeyDown={handleKeyDown}
      onPointerDownCapture={focusViewer}
      className="h-full min-h-0 flex flex-col bg-surface-2 outline-none focus-visible:ring-1 focus-visible:ring-accent/70"
    >
      <div className="px-3 py-2 border-b border-border-default/70 bg-surface/95 flex items-center gap-2 text-xs text-fg-muted flex-shrink-0">
        <button
          type="button"
          data-testid="pdf-prev-page"
          className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border-default bg-surface-4 text-fg-secondary shadow-sm hover:text-fg-primary hover:bg-hover-bg disabled:opacity-35 disabled:cursor-not-allowed"
          onClick={goPrevious}
          disabled={pageNum <= 1}
          title={t('preview.previousPageTitle')}
          aria-label={t('preview.previousPage')}
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={2.2} />
        </button>
        <div
          className="min-w-[5.75rem] text-center text-[11px] font-medium text-fg-secondary tabular-nums"
          data-testid="pdf-page-counter"
        >
          {pageNum} / {totalPages}
        </div>
        <button
          type="button"
          data-testid="pdf-next-page"
          className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border-default bg-surface-4 text-fg-secondary shadow-sm hover:text-fg-primary hover:bg-hover-bg disabled:opacity-35 disabled:cursor-not-allowed"
          onClick={goNext}
          disabled={pageNum >= totalPages}
          title={t('preview.nextPageTitle')}
          aria-label={t('preview.nextPage')}
        >
          <ChevronRight className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </div>

      <div ref={scrollerRef} className="flex-1 min-h-0 overflow-auto bg-surface-2">
        <div className="w-max min-w-full px-4 py-4">
          <div className="mx-auto flex w-max flex-col items-center gap-4">
            {pages.map((page) => (
              <PdfPageCanvas
                key={page}
                doc={doc}
                pageNumber={page}
                shouldRender={visiblePages.has(page) || Math.abs(page - pageNum) <= 1}
                availableWidth={availablePageWidth}
                setPageElement={setPageElement}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
