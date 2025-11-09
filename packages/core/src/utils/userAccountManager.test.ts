/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UserAccountManager } from './userAccountManager.js';
import { Storage } from '../config/storage.js';
import path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

describe('UserAccountManager', () => {
  let userAccountManager: UserAccountManager;
  let tempDir: string;

  beforeEach(() => {
    // Create a real temporary directory
    const tempDirPrefix = path.join(os.tmpdir(), 'gemini-test-');
    tempDir = fs.mkdtempSync(tempDirPrefix);

    vi.stubEnv('XDG_DATA_HOME', tempDir);

    userAccountManager = new UserAccountManager();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    // Clean up the temporary directory
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const getAccountsFilePath = () =>
    path.join(Storage.getDataDir(), 'google_accounts.json');

  // Helper to set up a pre-existing accounts file
  const setupAccountsFile = (content: string | object) => {
    const accountsFilePath = getAccountsFilePath();
    fs.mkdirSync(path.dirname(accountsFilePath), { recursive: true });
    fs.writeFileSync(
      accountsFilePath,
      typeof content === 'string' ? content : JSON.stringify(content, null, 2),
    );
  };

  describe('cacheGoogleAccount', () => {
    it('should create directory and write initial account file', async () => {
      const accountsFilePath = getAccountsFilePath();
      await userAccountManager.cacheGoogleAccount('test1@google.com');

      // Verify Google Account ID was cached
      expect(fs.existsSync(accountsFilePath)).toBe(true);
      expect(fs.readFileSync(accountsFilePath, 'utf-8')).toBe(
        JSON.stringify({ active: 'test1@google.com', old: [] }, null, 2),
      );
    });

    it('should update active account and move previous to old', async () => {
      const accountsFilePath = getAccountsFilePath();
      setupAccountsFile({
        active: 'test2@google.com',
        old: ['test1@google.com'],
      });

      await userAccountManager.cacheGoogleAccount('test3@google.com');

      expect(fs.readFileSync(accountsFilePath, 'utf-8')).toBe(
        JSON.stringify(
          {
            active: 'test3@google.com',
            old: ['test1@google.com', 'test2@google.com'],
          },
          null,
          2,
        ),
      );
    });

    it('should not add a duplicate to the old list', async () => {
      const accountsFilePath = getAccountsFilePath();
      setupAccountsFile({
        active: 'test1@google.com',
        old: ['test2@google.com'],
      });

      await userAccountManager.cacheGoogleAccount('test2@google.com');
      await userAccountManager.cacheGoogleAccount('test1@google.com');

      expect(fs.readFileSync(accountsFilePath, 'utf-8')).toBe(
        JSON.stringify(
          { active: 'test1@google.com', old: ['test2@google.com'] },
          null,
          2,
        ),
      );
    });

    it('should handle corrupted JSON by starting fresh', async () => {
      const accountsFilePath = getAccountsFilePath();
      setupAccountsFile('not valid json');
      const consoleLogSpy = vi
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      await userAccountManager.cacheGoogleAccount('test1@google.com');

      expect(consoleLogSpy).toHaveBeenCalled();
      const fileContent = fs.readFileSync(accountsFilePath, 'utf-8');
      expect(JSON.parse(fileContent as string)).toEqual({
        active: 'test1@google.com',
        old: [],
      });
    });

    it('should handle valid JSON with incorrect schema by starting fresh', async () => {
      const accountsFilePath = getAccountsFilePath();
      setupAccountsFile({ active: 'test1@google.com', old: 'not-an-array' });
      const consoleLogSpy = vi
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      await userAccountManager.cacheGoogleAccount('test2@google.com');

      expect(consoleLogSpy).toHaveBeenCalled();
      const fileContent = fs.readFileSync(accountsFilePath, 'utf-8');
      expect(JSON.parse(fileContent as string)).toEqual({
        active: 'test2@google.com',
        old: [],
      });
    });
  });

  describe('getCachedGoogleAccount', () => {
    it('should return the active account if file exists and is valid', () => {
      setupAccountsFile({ active: 'active@google.com', old: [] });
      const account = userAccountManager.getCachedGoogleAccount();
      expect(account).toBe('active@google.com');
    });

    it('should return null if file does not exist', () => {
      const account = userAccountManager.getCachedGoogleAccount();
      expect(account).toBeNull();
    });

    it('should return null if file is empty', () => {
      setupAccountsFile('');
      const account = userAccountManager.getCachedGoogleAccount();
      expect(account).toBeNull();
    });

    it('should return null and log if file is corrupted', () => {
      setupAccountsFile('{ "active": "test@google.com"'); // Invalid JSON
      const consoleLogSpy = vi
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      const account = userAccountManager.getCachedGoogleAccount();

      expect(account).toBeNull();
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should return null if active key is missing', () => {
      setupAccountsFile({ old: [] });
      const account = userAccountManager.getCachedGoogleAccount();
      expect(account).toBeNull();
    });
  });

  describe('clearCachedGoogleAccount', () => {
    it('should set active to null and move it to old', async () => {
      const accountsFilePath = getAccountsFilePath();
      setupAccountsFile({
        active: 'active@google.com',
        old: ['old1@google.com'],
      });

      await userAccountManager.clearCachedGoogleAccount();

      const stored = JSON.parse(
        fs.readFileSync(accountsFilePath, 'utf-8') as string,
      );
      expect(stored.active).toBeNull();
      expect(stored.old).toEqual(['old1@google.com', 'active@google.com']);
    });

    it('should handle empty file gracefully', async () => {
      const accountsFilePath = getAccountsFilePath();
      setupAccountsFile('');
      await userAccountManager.clearCachedGoogleAccount();
      const stored = JSON.parse(
        fs.readFileSync(accountsFilePath, 'utf-8') as string,
      );
      expect(stored.active).toBeNull();
      expect(stored.old).toEqual([]);
    });

    it('should handle corrupted JSON by creating a fresh file', async () => {
      const accountsFilePath = getAccountsFilePath();
      setupAccountsFile('not valid json');
      const consoleLogSpy = vi
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      await userAccountManager.clearCachedGoogleAccount();

      expect(consoleLogSpy).toHaveBeenCalled();
      const stored = JSON.parse(
        fs.readFileSync(accountsFilePath, 'utf-8') as string,
      );
      expect(stored.active).toBeNull();
      expect(stored.old).toEqual([]);
    });

    it('should be idempotent if active account is already null', async () => {
      const accountsFilePath = getAccountsFilePath();
      setupAccountsFile({ active: null, old: ['old1@google.com'] });

      await userAccountManager.clearCachedGoogleAccount();

      const stored = JSON.parse(
        fs.readFileSync(accountsFilePath, 'utf-8') as string,
      );
      expect(stored.active).toBeNull();
      expect(stored.old).toEqual(['old1@google.com']);
    });

    it('should not add a duplicate to the old list', async () => {
      const accountsFilePath = getAccountsFilePath();
      setupAccountsFile({
        active: 'active@google.com',
        old: ['active@google.com'],
      });

      await userAccountManager.clearCachedGoogleAccount();

      const stored = JSON.parse(
        fs.readFileSync(accountsFilePath, 'utf-8') as string,
      );
      expect(stored.active).toBeNull();
      expect(stored.old).toEqual(['active@google.com']);
    });
  });

  describe('getLifetimeGoogleAccounts', () => {
    it('should return 0 if the file does not exist', () => {
      expect(userAccountManager.getLifetimeGoogleAccounts()).toBe(0);
    });

    it('should return 0 if the file is empty', () => {
      setupAccountsFile('');
      expect(userAccountManager.getLifetimeGoogleAccounts()).toBe(0);
    });

    it('should return 0 if the file is corrupted', () => {
      setupAccountsFile('invalid json');
      const consoleDebugSpy = vi
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      expect(userAccountManager.getLifetimeGoogleAccounts()).toBe(0);
      expect(consoleDebugSpy).toHaveBeenCalled();
    });

    it('should return 1 if there is only an active account', () => {
      setupAccountsFile({ active: 'test1@google.com', old: [] });
      expect(userAccountManager.getLifetimeGoogleAccounts()).toBe(1);
    });

    it('should correctly count old accounts when active is null', () => {
      setupAccountsFile({
        active: null,
        old: ['test1@google.com', 'test2@google.com'],
      });
      expect(userAccountManager.getLifetimeGoogleAccounts()).toBe(2);
    });

    it('should correctly count both active and old accounts', () => {
      setupAccountsFile({
        active: 'test3@google.com',
        old: ['test1@google.com', 'test2@google.com'],
      });
      expect(userAccountManager.getLifetimeGoogleAccounts()).toBe(3);
    });

    it('should handle valid JSON with incorrect schema by returning 0', () => {
      setupAccountsFile({ active: null, old: 1 });
      const consoleLogSpy = vi
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      expect(userAccountManager.getLifetimeGoogleAccounts()).toBe(0);
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should not double count if active account is also in old list', () => {
      setupAccountsFile({
        active: 'test1@google.com',
        old: ['test1@google.com', 'test2@google.com'],
      });
      expect(userAccountManager.getLifetimeGoogleAccounts()).toBe(2);
    });
  });
});
