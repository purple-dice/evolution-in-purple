import { ConfigService } from '@config/env.config';
import { describe, expect, it, vi } from 'vitest';

const telemetryEnabled = () => new ConfigService().get('TELEMETRY').ENABLED;

describe('TELEMETRY config', () => {
  it('stays disabled when TELEMETRY_ENABLED is unset', () => {
    vi.stubEnv('TELEMETRY_ENABLED', undefined);
    expect(telemetryEnabled()).toBe(false);
  });

  it('turns on only when TELEMETRY_ENABLED is true', () => {
    vi.stubEnv('TELEMETRY_ENABLED', 'true');
    expect(telemetryEnabled()).toBe(true);
  });

  it('stays disabled for any other value', () => {
    for (const value of ['false', '', '1', 'TRUE']) {
      vi.stubEnv('TELEMETRY_ENABLED', value);
      expect(telemetryEnabled()).toBe(false);
    }
  });
});
