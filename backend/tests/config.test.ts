import { describe,expect,it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { fixture } from './helpers.js';

describe('configuration and boundaries',() => {
  it('rejects missing secrets rather than starting with defaults',() => {
    expect(() => parseConfig({})).toThrow();
  });
  it('keeps session and business storage separate',() => {
    const f = fixture();
    try {expect(f.config.databasePath).not.toBe(f.config.sessionDatabasePath);} finally {f.close();}
  });
});
