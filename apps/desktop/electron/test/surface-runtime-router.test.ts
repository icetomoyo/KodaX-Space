import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SurfaceRuntimeRouteError,
  SurfaceRuntimeRouter,
  type SurfaceRuntimeAdapterRef,
} from '../kodax/runtime/surface-runtime-router.js';

const coder: SurfaceRuntimeAdapterRef<'coder-daemon'> = {
  owner: 'coder-daemon',
  surface: 'code',
};
const partner: SurfaceRuntimeAdapterRef<'partner-inline'> = {
  owner: 'partner-inline',
  surface: 'partner',
};

test('SurfaceRuntimeRouter routes trusted session surfaces to exactly one owner', () => {
  const router = new SurfaceRuntimeRouter({ coder, partner });

  assert.equal(router.forSurface('code'), coder);
  assert.equal(router.forSurface('partner'), partner);
  assert.equal(router.forSession({ sessionId: 's_code', surface: 'code' }), coder);
  assert.equal(router.forSession({ sessionId: 's_partner', surface: 'partner' }), partner);
});

test('SurfaceRuntimeRouter rejects renderer expectation mismatches before routing', () => {
  const router = new SurfaceRuntimeRouter({ coder, partner });

  assert.throws(
    () =>
      router.forSession(
        { sessionId: 's_partner', surface: 'partner' },
        { expectedSurface: 'code' },
      ),
    (error: unknown) => {
      assert.ok(error instanceof SurfaceRuntimeRouteError);
      assert.equal(error.code, 'SURFACE_MISMATCH');
      assert.equal(error.sessionId, 's_partner');
      return true;
    },
  );
});

test('SurfaceRuntimeRouter refuses malformed or missing trusted surface records', () => {
  const router = new SurfaceRuntimeRouter({ coder, partner });

  assert.throws(
    () => router.forSession({ sessionId: 's_missing' } as never),
    /trusted session surface/i,
  );
  assert.throws(() => router.forSurface('chat' as never), /unsupported trusted surface/i);
});

test('SurfaceRuntimeRouter construction rejects adapters registered for the wrong surface', () => {
  assert.throws(
    () =>
      new SurfaceRuntimeRouter({
        coder: { owner: 'coder-daemon', surface: 'partner' } as never,
        partner,
      }),
    /Coder adapter must be registered for code/i,
  );
});
