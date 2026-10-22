import { describe, expect, it, vi } from 'vitest';
import { UpdateService } from '../src/update-service.js';
import { shouldCheckForUpdates } from '../src/update-policy.js';

function fixture(prepare = vi.fn(async () => {})) {
  const client = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkForUpdates: vi.fn(() => Promise.resolve(null)),
    downloadUpdate: vi.fn(() => Promise.resolve([])),
    quitAndInstall: vi.fn(),
  };
  return { client, prepare, service: new UpdateService(client, prepare, vi.fn()) };
}

describe('업데이트 설치', () => {
  it('자동 설치를 끄고 다운로드와 백업 뒤에만 설치한다', async () => {
    const { client, service, prepare } = fixture();
    expect(client.autoDownload).toBe(false);
    expect(client.autoInstallOnAppQuit).toBe(false);
    await service.install();
    expect(client.quitAndInstall).not.toHaveBeenCalled();
    service.setPhase('available');
    await service.download();
    await service.install();
    expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(
      client.quitAndInstall.mock.invocationCallOrder[0]!,
    );
    expect(client.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('종료 또는 백업 실패 시 설치하지 않고 재시도를 허용한다', async () => {
    const prepare = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(undefined);
    const { service, client } = fixture(prepare);
    service.setPhase('downloaded');
    await expect(service.install()).rejects.toThrow('disk full');
    expect(service.phase).toBe('downloaded');
    expect(client.quitAndInstall).not.toHaveBeenCalled();
    await service.install();
    expect(client.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('다운로드 중 중복 클릭을 무시한다', async () => {
    const { service, client } = fixture();
    service.setPhase('available');
    await Promise.all([service.download(), service.download()]);
    expect(client.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it('네트워크 오류 후 확인 상태를 복구한다', async () => {
    const { service, client } = fixture();
    client.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
    await expect(service.check()).rejects.toThrow('offline');
    expect(service.phase).toBe('idle');
  });
});

describe('업데이트 플랫폼 조건', () => {
  it('Windows 설치본은 서명이 없어도 확인하고 macOS는 서명이 필요하다', () => {
    const base = { packaged: true, signed: false, env: {} };
    expect(shouldCheckForUpdates({ ...base, platform: 'win32' })).toBe(true);
    expect(shouldCheckForUpdates({ ...base, platform: 'darwin' })).toBe(false);
    expect(shouldCheckForUpdates({ ...base, platform: 'darwin', signed: true })).toBe(true);
    expect(shouldCheckForUpdates({ ...base, platform: 'linux' })).toBe(false);
    expect(shouldCheckForUpdates({ ...base, platform: 'linux', env: { APPIMAGE: '/app' } })).toBe(
      true,
    );
    expect(
      shouldCheckForUpdates({ ...base, platform: 'win32', env: { ARTEL_DISABLE_UPDATES: '1' } }),
    ).toBe(false);
    expect(shouldCheckForUpdates({ ...base, platform: 'win32', packaged: false })).toBe(false);
  });
});
