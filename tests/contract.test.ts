import { describe, expect, test } from 'bun:test';
import { remoteFlags } from '../src/reconcile';

describe('SyncPlan JSON contract', () => {
  test('hasRemoteAhead agrees with every underlying remote classification', () => {
    const cases = [
      { remote: 'no-remote' as const, hasRemoteAhead: false, hasRemoteBehind: false },
      { remote: 'in-sync' as const, hasRemoteAhead: false, hasRemoteBehind: false },
      { remote: 'ahead' as const, hasRemoteAhead: false, hasRemoteBehind: true },
      { remote: 'behind' as const, hasRemoteAhead: true, hasRemoteBehind: false },
      { remote: 'diverged' as const, hasRemoteAhead: true, hasRemoteBehind: true },
      { remote: 'unknown' as const, hasRemoteAhead: false, hasRemoteBehind: false },
    ];

    for (const c of cases) {
      expect(remoteFlags(c.remote)).toEqual({
        hasRemoteAhead: c.hasRemoteAhead,
        hasRemoteBehind: c.hasRemoteBehind,
      });
    }
  });
});
