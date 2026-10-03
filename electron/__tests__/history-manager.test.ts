import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const { mockSafeStorage, mockApp } = vi.hoisted(() => {
  let encryptionAvailable = true;

  const mockSafeStorage = {
    isEncryptionAvailable: vi.fn(() => encryptionAvailable),
    setEncryptionAvailable: (avail: boolean) => {
      encryptionAvailable = avail;
    },
    encryptString: vi.fn((plainText: string) => {
      if (!encryptionAvailable) throw new Error('safeStorage encryption unavailable');
      return Buffer.from(`mock_enc:${Buffer.from(plainText, 'utf8').toString('base64')}`, 'utf8');
    }),
    decryptString: vi.fn((cipherBuffer: Buffer) => {
      if (!encryptionAvailable) throw new Error('safeStorage decryption unavailable');
      const text = cipherBuffer.toString('utf8');
      if (!text.startsWith('mock_enc:')) throw new Error('Decryption failed');
      return Buffer.from(text.slice('mock_enc:'.length), 'base64').toString('utf8');
    }),
  };

  const mockApp = {
    getPath: vi.fn(() => path.join(os.tmpdir(), 'pandora-test-userData')),
  };

  return { mockSafeStorage, mockApp };
});

vi.mock('electron', () => ({
  safeStorage: mockSafeStorage,
  app: mockApp,
}));

import { HistoryManager } from '../history-manager';

describe('HistoryManager - Second Brain Encrypt-At-Rest', () => {
  let tempDir: string;
  let storagePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-history-test-'));
    storagePath = path.join(tempDir, 'history-index.json');
    mockSafeStorage.setEncryptionAvailable(true);
    vi.clearAllMocks();
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('never stores plaintext page body on disk when adding entries', () => {
    const manager = new HistoryManager(storagePath);
    const secretContent = 'SECRET_FORENSIC_INVESTIGATION_DATA_998877';

    manager.addEntry({
      url: 'https://internal.investigation.local/case/42',
      title: 'Case 42 File',
      content: secretContent,
    });

    expect(fs.existsSync(storagePath)).toBe(true);
    const rawDiskContent = fs.readFileSync(storagePath, 'utf8');

    // 1. Plaintext secret MUST NOT appear anywhere in the file
    expect(rawDiskContent).not.toContain(secretContent);

    // 2. The JSON records must NOT contain a plaintext 'content' key
    const parsed = JSON.parse(rawDiskContent);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0].content).toBeUndefined();
    expect(parsed[0].encryptedContent).toBeDefined();
    expect(typeof parsed[0].encryptedContent).toBe('string');
  });

  it('decrypts content on load and enables in-memory retrieval via getContent', () => {
    const manager1 = new HistoryManager(storagePath);
    const secretContent = 'PATIENT_OR_CASE_DISCOVERY_RECORD';

    manager1.addEntry({
      url: 'https://vault.pandora.local/doc/1',
      title: 'Doc 1',
      content: secretContent,
    });

    // Create a new instance pointing to the same storage path (simulating app restart)
    const manager2 = new HistoryManager(storagePath);
    const retrieved = manager2.getContent('https://vault.pandora.local/doc/1');

    expect(retrieved).not.toBeNull();
    expect(retrieved?.url).toBe('https://vault.pandora.local/doc/1');
    expect(retrieved?.title).toBe('Doc 1');
    expect(retrieved?.content).toBe(secretContent);
  });

  it('searches in-memory indexed content without leaking content field in search results', () => {
    const manager = new HistoryManager(storagePath);

    manager.addEntry({
      url: 'https://cases.local/suspect',
      title: 'Suspect Dossier',
      content: 'Contains fingerprint analysis and cryptographic hash matches',
    });

    const searchResults = manager.search('cryptographic');
    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0].url).toBe('https://cases.local/suspect');
    expect(searchResults[0].title).toBe('Suspect Dossier');

    // Search results must only contain metadata (title, url, timestamp, id)
    expect((searchResults[0] as any).content).toBeUndefined();
    expect((searchResults[0] as any).encryptedContent).toBeUndefined();
  });

  it('fails closed when encryption is unavailable: never stores content on disk', () => {
    mockSafeStorage.setEncryptionAvailable(false);

    const manager = new HistoryManager(storagePath);
    const secretContent = 'TOP_SECRET_UNENCRYPTABLE_BODY';

    manager.addEntry({
      url: 'https://classified.gov/memo',
      title: 'Classified Memo',
      content: secretContent,
    });

    const raw = fs.readFileSync(storagePath, 'utf8');
    expect(raw).not.toContain(secretContent);

    const parsed = JSON.parse(raw);
    expect(parsed.length).toBe(1);
    expect(parsed[0].content).toBeUndefined();
    expect(parsed[0].encryptedContent).toBeUndefined();
    expect(parsed[0].title).toBe('Classified Memo');

    // On reload without encryption, content is safely empty
    const managerReloaded = new HistoryManager(storagePath);
    const doc = managerReloaded.getContent('https://classified.gov/memo');
    expect(doc?.content).toBe('');
  });

  describe('Legacy migration', () => {
    it('migrates legacy plaintext history-index.json by encrypting and rewriting the file immediately', () => {
      // Simulate existing unencrypted history-index.json from previous version
      const legacyData = [
        {
          id: 'legacy-1',
          url: 'https://legacy.example.org/page1',
          title: 'Legacy Page 1',
          content: 'LEGACY_PLAINTEXT_PAGE_BODY_CONTENT_12345',
          timestamp: 1600000000000,
        },
      ];
      fs.writeFileSync(storagePath, JSON.stringify(legacyData, null, 2), 'utf8');

      // Assert legacy file initially contained plaintext
      expect(fs.readFileSync(storagePath, 'utf8')).toContain('LEGACY_PLAINTEXT_PAGE_BODY_CONTENT_12345');

      // Initialize HistoryManager: should detect legacy format and rewrite immediately
      const manager = new HistoryManager(storagePath);

      // Verify file on disk has been rewritten and no plaintext remains
      const rewrittenDiskContent = fs.readFileSync(storagePath, 'utf8');
      expect(rewrittenDiskContent).not.toContain('LEGACY_PLAINTEXT_PAGE_BODY_CONTENT_12345');

      const parsed = JSON.parse(rewrittenDiskContent);
      expect(parsed.length).toBe(1);
      expect(parsed[0].id).toBe('legacy-1');
      expect(parsed[0].content).toBeUndefined();
      expect(parsed[0].encryptedContent).toBeDefined();

      // In memory, content was migrated and is accessible via getContent
      const retrieved = manager.getContent('https://legacy.example.org/page1');
      expect(retrieved?.content).toBe('LEGACY_PLAINTEXT_PAGE_BODY_CONTENT_12345');
    });

    it('migrates legacy plaintext by discarding content when encryption is unavailable', () => {
      mockSafeStorage.setEncryptionAvailable(false);

      const legacyData = [
        {
          id: 'legacy-2',
          url: 'https://legacy.example.org/page2',
          title: 'Legacy Page 2',
          content: 'PLAINTEXT_THAT_CANNOT_BE_ENCRYPTED',
          timestamp: 1600000000001,
        },
      ];
      fs.writeFileSync(storagePath, JSON.stringify(legacyData, null, 2), 'utf8');

      const manager = new HistoryManager(storagePath);

      // Verify plaintext content was stripped from disk
      const rewritten = fs.readFileSync(storagePath, 'utf8');
      expect(rewritten).not.toContain('PLAINTEXT_THAT_CANNOT_BE_ENCRYPTED');

      const parsed = JSON.parse(rewritten);
      expect(parsed[0].content).toBeUndefined();
      expect(parsed[0].encryptedContent).toBeUndefined();
      expect(parsed[0].title).toBe('Legacy Page 2');

      // In memory, content is discarded to prevent leak
      const doc = manager.getContent('https://legacy.example.org/page2');
      expect(doc?.content).toBe('');
    });
  });

  describe('Validation and edge cases', () => {
    it('handles getContent with invalid or missing url', () => {
      const manager = new HistoryManager(storagePath);
      expect(manager.getContent('')).toBeNull();
      expect(manager.getContent(null as any)).toBeNull();
      expect(manager.getContent(undefined as any)).toBeNull();
      expect(manager.getContent('https://nonexistent.local')).toBeNull();
    });

    it('handles search with invalid query', () => {
      const manager = new HistoryManager(storagePath);
      expect(manager.search('')).toEqual([]);
      expect(manager.search(null as any)).toEqual([]);
    });

    it('clear() resets memory and storage file', () => {
      const manager = new HistoryManager(storagePath);
      manager.addEntry({
        url: 'https://test.local',
        title: 'Title',
        content: 'Content',
      });

      expect(manager.getContent('https://test.local')).not.toBeNull();
      manager.clear();

      expect(manager.getContent('https://test.local')).toBeNull();
      const parsed = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
      expect(parsed).toEqual([]);
    });
  });

  describe('Ciphertext round-trip (Copilot P1)', () => {
    it('(a) preserves ciphertext when encryption off during session, restores body after re-enabling', () => {
      // Step 1: write encrypted entry with encryption on
      const manager1 = new HistoryManager(storagePath);
      manager1.addEntry({ url: 'https://case.local/doc', title: 'Doc', content: 'ORIGINAL_BODY' });

      // Step 2: turn encryption off, reload (decrypt unavailable) and add a new entry
      mockSafeStorage.setEncryptionAvailable(false);
      const manager2 = new HistoryManager(storagePath);
      manager2.addEntry({ url: 'https://case.local/doc2', title: 'Doc2', content: 'NEW_BODY' });
      // NEW_BODY cannot be encrypted — must not appear on disk
      const raw2 = fs.readFileSync(storagePath, 'utf8');
      expect(raw2).not.toContain('NEW_BODY');
      // Original ciphertext must still be present on disk (round-tripped)
      const parsed2 = JSON.parse(raw2);
      const originalOnDisk = parsed2.find((r: any) => r.url === 'https://case.local/doc');
      expect(originalOnDisk?.encryptedContent).toBeDefined();

      // Step 3: turn encryption back on, reload — old body decrypts correctly
      mockSafeStorage.setEncryptionAvailable(true);
      const manager3 = new HistoryManager(storagePath);
      const restored = manager3.getContent('https://case.local/doc');
      expect(restored?.content).toBe('ORIGINAL_BODY');
    });

    it('(b) preserves ciphertext when decryptString throws, restores body after fix', () => {
      // Step 1: write encrypted entry
      const manager1 = new HistoryManager(storagePath);
      manager1.addEntry({ url: 'https://case.local/secure', title: 'Secure', content: 'DECRYPT_ME' });

      // Step 2: make decryptString throw, reload
      const originalDecrypt = mockSafeStorage.decryptString.getMockImplementation?.();
      mockSafeStorage.decryptString.mockImplementationOnce(() => { throw new Error('mock decrypt failure') });
      const manager2 = new HistoryManager(storagePath);
      // content is empty in memory
      expect(manager2.getContent('https://case.local/secure')?.content).toBe('');
      // ciphertext must still be on disk
      const raw2 = fs.readFileSync(storagePath, 'utf8');
      const parsed2 = JSON.parse(raw2);
      expect(parsed2.find((r: any) => r.url === 'https://case.local/secure')?.encryptedContent).toBeDefined();

      // Step 3: decrypt works again — reload and recover
      const manager3 = new HistoryManager(storagePath);
      expect(manager3.getContent('https://case.local/secure')?.content).toBe('DECRYPT_ME');
    });
  });

  describe('IPC Sender Gating (Requirement 3)', () => {
    it('verifies electron/main.mts gates both history:search and history:getContent with isMainWindowSender', () => {
      const mainPath = path.resolve(__dirname, '../main.mts');
      const mainSrc = fs.readFileSync(mainPath, 'utf8');

      // history:search must check isMainWindowSender
      const searchBlock = mainSrc.slice(mainSrc.indexOf("ipcMain.handle('history:search'"));
      const searchHandler = searchBlock.slice(0, searchBlock.indexOf('})'));
      expect(searchHandler).toContain('isMainWindowSender(event)');
      expect(searchHandler).toContain('return []');

      // history:getContent must check isMainWindowSender
      const contentBlock = mainSrc.slice(mainSrc.indexOf("ipcMain.handle('history:getContent'"));
      const contentHandler = contentBlock.slice(0, contentBlock.indexOf('})'));
      expect(contentHandler).toContain('isMainWindowSender(event)');
      expect(contentHandler).toContain('return null');
    });

    it('simulates sender gating behavior: allows mainWindow, blocks BrowserViews', () => {
      const mainWindowId = 100;
      const isMainWindowSender = (event: { sender: { id: number } }) => {
        return event.sender.id === mainWindowId;
      };

      const manager = new HistoryManager(storagePath);
      manager.addEntry({
        url: 'https://secret.local/case',
        title: 'Secret Case',
        content: 'Evidence text',
      });

      // Simulated handlers matching main.mts logic
      const handleSearch = (event: { sender: { id: number } }, query: unknown) => {
        if (!isMainWindowSender(event)) return [];
        if (typeof query !== 'string') return [];
        return manager.search(query);
      };

      const handleGetContent = (event: { sender: { id: number } }, url: unknown) => {
        if (!isMainWindowSender(event)) return null;
        if (typeof url !== 'string') return null;
        return manager.getContent(url);
      };

      // 1. Authorized call from mainWindow
      const authorizedEvent = { sender: { id: mainWindowId } };
      expect(handleSearch(authorizedEvent, 'Secret').length).toBe(1);
      expect(handleGetContent(authorizedEvent, 'https://secret.local/case')).not.toBeNull();

      // 2. Unauthorized crosstalk call from a BrowserView (sender id 200)
      const unauthorizedEvent = { sender: { id: 200 } };
      expect(handleSearch(unauthorizedEvent, 'Secret')).toEqual([]);
      expect(handleGetContent(unauthorizedEvent, 'https://secret.local/case')).toBeNull();

      // 3. Validation errors
      expect(handleSearch(authorizedEvent, 12345)).toEqual([]);
      expect(handleGetContent(authorizedEvent, null)).toBeNull();
    });
  });
});

