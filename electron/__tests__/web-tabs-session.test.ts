import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockDefaultSession, mockPartitionSession, fromPartitionMock } = vi.hoisted(() => {
  const mockDefaultSession = {
    setProxy: vi.fn().mockResolvedValue(undefined),
    clearStorageData: vi.fn().mockResolvedValue(undefined),
    clearCache: vi.fn().mockResolvedValue(undefined),
    loadExtension: vi.fn().mockResolvedValue({ id: 'ext1', name: 'Ext 1' }),
    getAllExtensions: vi.fn().mockReturnValue([]),
    setPermissionRequestHandler: vi.fn(),
    on: vi.fn(),
  };

  const mockPartitionSession = {
    setProxy: vi.fn().mockResolvedValue(undefined),
    clearStorageData: vi.fn().mockResolvedValue(undefined),
    clearCache: vi.fn().mockResolvedValue(undefined),
    loadExtension: vi.fn().mockResolvedValue({ id: 'ext1', name: 'Ext 1' }),
    getAllExtensions: vi.fn().mockReturnValue([]),
    setPermissionRequestHandler: vi.fn(),
    on: vi.fn(),
  };

  const fromPartitionMock = vi.fn((partition: string) => {
    if (partition === 'persist:pandora-web-tabs') {
      return mockPartitionSession;
    }
    return mockDefaultSession;
  });

  return { mockDefaultSession, mockPartitionSession, fromPartitionMock };
});

vi.mock('electron', () => {
  return {
    session: {
      defaultSession: mockDefaultSession,
      fromPartition: fromPartitionMock,
    },
    BrowserView: vi.fn().mockImplementation(function (this: any, options: any) {
      this.options = options;
      this.webContents = {
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        loadURL: vi.fn(),
      };
      this.setBounds = vi.fn();
      this.setAutoResize = vi.fn();
      this.setBackgroundColor = vi.fn();
    }),
  };
});

import {
  WEB_TABS_PARTITION,
  getWebTabsSession,
  isValidWebTabUrl,
  createIsolatedBrowserView,
} from '../browser-view-factory';

describe('Web Tabs Session & Navigation Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Session Partition Invariant', () => {
    it('uses persist:pandora-web-tabs as the single partition constant', () => {
      expect(WEB_TABS_PARTITION).toBe('persist:pandora-web-tabs');
    });

    it('getWebTabsSession retrieves session using the exact WEB_TABS_PARTITION constant', () => {
      const sess = getWebTabsSession();
      expect(fromPartitionMock).toHaveBeenCalledWith('persist:pandora-web-tabs');
      expect(fromPartitionMock).toHaveBeenCalledWith(WEB_TABS_PARTITION);
      expect(sess).toBe(mockPartitionSession);
    });

    it('createIsolatedBrowserView configures BrowserView with WEB_TABS_PARTITION', () => {
      const view = createIsolatedBrowserView() as any;
      expect(view.options?.webPreferences?.partition).toBe(WEB_TABS_PARTITION);
      expect(view.options?.webPreferences?.partition).toBe('persist:pandora-web-tabs');
    });

    it('guarantees session isolation: operations on web tabs session do not mutate defaultSession', async () => {
      const webTabsSession = getWebTabsSession();

      // Simulate proxy set on web tabs session
      await webTabsSession.setProxy({ mode: 'direct' });
      expect(mockPartitionSession.setProxy).toHaveBeenCalledWith({ mode: 'direct' });
      expect(mockDefaultSession.setProxy).not.toHaveBeenCalled();

      // Simulate clearing browsing data on web tabs session
      await webTabsSession.clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage']
      });
      await webTabsSession.clearCache();

      expect(mockPartitionSession.clearStorageData).toHaveBeenCalled();
      expect(mockPartitionSession.clearCache).toHaveBeenCalled();
      expect(mockDefaultSession.clearStorageData).not.toHaveBeenCalled();
      expect(mockDefaultSession.clearCache).not.toHaveBeenCalled();
    });
  });

  describe('isValidWebTabUrl protocol gatekeeper', () => {
    it.each([
      'http://example.com',
      'http://example.com/test?query=1',
      'https://example.com',
      'https://pandora.os/investigation',
      'https://sub.domain.org:8080/path#hash',
      'http://localhost:3000',
    ])('allows valid HTTP/HTTPS URL: %s', (validUrl) => {
      expect(isValidWebTabUrl(validUrl)).toBe(true);
    });

    it.each([
      'file:///C:/Windows/System32/drivers/etc/hosts',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'javascript:void(0)',
      'data:text/html,<h1>Malicious</h1>',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'chrome://settings',
      'chrome-extension://some-ext-id/page.html',
      'about:blank',
      'ftp://ftp.example.com/resource',
      'blob:https://example.com/uuid',
      'pandora://newtab',
      'pandora://settings',
      '',
      'not-a-valid-url',
      '://missing-protocol',
    ])('blocks unsafe or non-http(s) URL: %s', (unsafeUrl) => {
      expect(isValidWebTabUrl(unsafeUrl)).toBe(false);
    });
  });
});
