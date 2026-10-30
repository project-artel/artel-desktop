# artel-desktop

ARTEL 전체 stack 을 Docker 없이 실행하는 desktop 앱과 runtime bundle 을 만드는 저장소입니다.

- `runtime/`: OS 와 architecture 별 runtime bundle 을 만드는 build script 입니다. PostgreSQL 16 과 pgvector, `jlink` Java runtime, orchestration jar, Python 과 agent-server, `artel-home` 정적 파일이 들어갑니다. 빌드 방법, 구성 요소 출처, release 규칙은 [`runtime/README.md`](runtime/README.md) 에 있습니다.
- `app/`: Electron 앱입니다. `@project-artel/cli` 의 supervisor 로 stack 을 실행하고 console 을 창으로 보여 줍니다. 설치하면 `artel` 명령이 `PATH` 에 등록됩니다.

대상: `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64`, `win32-arm64`.

계획: workspace 저장소의 `.plan/general/2026-10-20-package-artel-as-headless-and-desktop-app.md`.

## OS별 앱 설치

[앱 release](https://github.com/project-artel/artel-desktop/releases/tag/app-v0.2.0)에서
일반 Intel·AMD PC는 `ARTEL-Setup-0.2.0-x64.exe`, ARM64 PC는 `ARTEL-Setup-0.2.0-arm64.exe`를 실행합니다.
설치 후 바탕화면이나 시작 메뉴의 **ARTEL**을 열면 `artel.exe`가 내장 서비스를 시작합니다.
처음 표시되는 로그인 화면의 **Create account**에서 첫 계정을 만드세요.
Docker·Node·Java·Python을 따로 설치할 필요는 없습니다.

`runtime-v*` release의 `.tar.gz`는 앱 설치 파일이 아니라 앱 안에 들어가는 runtime입니다.
모든 OS의 앱 설치 파일은 `app-v*` release에 있습니다. 현재 빌드는 Authenticode 서명이 없어
Windows에서 게시자 확인 경고가 나타날 수 있습니다.

macOS는 Intel 또는 Apple Silicon용 `.dmg`를 열어 **ARTEL.app**을 Applications로 옮깁니다. Linux는 CPU에 맞는 `.AppImage` 또는 `.deb`를 설치합니다. 자세한 파일 목록과 서명 안내는 [release 안내](app/RELEASE.md)에 있습니다.

## app/

```sh
cd app
npm ci
npm run typecheck && npm run lint && npm test
npm run dist:dir   # `ARTEL_RUNTIME_SOURCE=<runtime 디렉터리>` 로 runtime 위치를 바꿀 수 있습니다
```

- 개발 중에는 `ARTEL_RUNTIME_DIR` 로 runtime 디렉터리를 지정합니다. 설치된 앱은 `resources/runtime` 을 씁니다.
- supervisor 는 고정된 CLI source commit의 패키지를 사용합니다. 출처와 재빌드 명령은 [`app/vendor/README.md`](app/vendor/README.md)에 있습니다.
- `ARTEL_DATA_DIR`로 서비스와 Electron 데이터를 별도 디렉터리에 저장할 수 있습니다. 기본 서비스 데이터 경로는 Windows의 `%LOCALAPPDATA%\ARTEL`입니다.
- 서명은 `CSC_LINK`, `WIN_CSC_LINK`, `APPLE_*` 환경 변수로 설정합니다. Windows NSIS와 Linux AppImage는 앱 내 업데이트를 지원하고, macOS는 서명된 빌드가 필요합니다.
- 업데이트 메뉴, 데이터 백업과 Flyway migration 적용 방식은 [업데이트 안내](app/UPDATES.md)에 있습니다.
- `app-v<version>` tag는 Windows·macOS·Linux의 x64·ARM64 설치 파일을 빌드하고 패키지 및 내장 CLI를 검사한 뒤 release합니다. `app/package.json`의 version과 tag가 같아야 합니다.

## License

AGPL-3.0-only
