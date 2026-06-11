/**
 * vitest.setup.js — Global setup for Vitest test runner.
 *
 * Centralizes jest-dom matchers and React testing-library cleanup.
 * Handles React 19 scheduler false positives that occur during
 * jsdom teardown (setImmediate callbacks accessing window after
 * the environment is destroyed).
 */
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  // Cleanup React rendering tree (unmount roots created by render())
  cleanup();
});
