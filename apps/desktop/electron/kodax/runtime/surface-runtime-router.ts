// F121 trusted surface owner router.
//
// This module is deliberately SDK-neutral. It prevents IPC handlers from
// selecting an execution owner from renderer input; callers must pass a
// main-owned session record whose surface has already been normalized.

import type { Surface } from '@kodax-space/space-ipc-schema';

export type SurfaceRuntimeOwner = 'coder-daemon' | 'partner-inline';

export interface SurfaceRuntimeAdapterRef<Owner extends SurfaceRuntimeOwner = SurfaceRuntimeOwner> {
  readonly owner: Owner;
  readonly surface: Surface;
}

export interface TrustedSurfaceSessionRecord {
  readonly sessionId: string;
  readonly surface: Surface;
}

export type SurfaceRuntimeRouteErrorCode =
  | 'SURFACE_MISMATCH'
  | 'TRUSTED_SURFACE_MISSING'
  | 'TRUSTED_SURFACE_UNSUPPORTED';

export class SurfaceRuntimeRouteError extends Error {
  readonly code: SurfaceRuntimeRouteErrorCode;
  readonly sessionId?: string;

  constructor(
    code: SurfaceRuntimeRouteErrorCode,
    message: string,
    options?: { readonly sessionId?: string },
  ) {
    super(message);
    this.name = 'SurfaceRuntimeRouteError';
    this.code = code;
    this.sessionId = options?.sessionId;
  }
}

export interface SurfaceRuntimeRouterOptions<
  Coder extends SurfaceRuntimeAdapterRef<'coder-daemon'>,
  Partner extends SurfaceRuntimeAdapterRef<'partner-inline'>,
> {
  readonly coder: Coder;
  readonly partner: Partner;
}

export class SurfaceRuntimeRouter<
  Coder extends SurfaceRuntimeAdapterRef<'coder-daemon'>,
  Partner extends SurfaceRuntimeAdapterRef<'partner-inline'>,
> {
  readonly #coder: Coder;
  readonly #partner: Partner;

  constructor(options: SurfaceRuntimeRouterOptions<Coder, Partner>) {
    if (options.coder.surface !== 'code') {
      throw new Error('Coder adapter must be registered for code surface.');
    }
    if (options.partner.surface !== 'partner') {
      throw new Error('Partner adapter must be registered for partner surface.');
    }
    this.#coder = options.coder;
    this.#partner = options.partner;
  }

  forSurface(surface: 'code'): Coder;
  forSurface(surface: 'partner'): Partner;
  forSurface(surface: Surface): Coder | Partner;
  forSurface(surface: Surface): Coder | Partner {
    if (surface === 'code') return this.#coder;
    if (surface === 'partner') return this.#partner;
    throw new SurfaceRuntimeRouteError(
      'TRUSTED_SURFACE_UNSUPPORTED',
      `Unsupported trusted surface: ${String(surface)}`,
    );
  }

  forSession(
    session: TrustedSurfaceSessionRecord,
    guard?: { readonly expectedSurface?: Surface },
  ): Coder | Partner {
    const surface = (session as Partial<TrustedSurfaceSessionRecord>).surface;
    if (surface !== 'code' && surface !== 'partner') {
      throw new SurfaceRuntimeRouteError(
        'TRUSTED_SURFACE_MISSING',
        `A trusted session surface is required for ${session.sessionId}.`,
        { sessionId: session.sessionId },
      );
    }
    if (guard?.expectedSurface !== undefined && guard.expectedSurface !== surface) {
      throw new SurfaceRuntimeRouteError(
        'SURFACE_MISMATCH',
        `Session ${session.sessionId} belongs to ${surface}, not ${guard.expectedSurface}.`,
        { sessionId: session.sessionId },
      );
    }
    return this.forSurface(surface);
  }
}
