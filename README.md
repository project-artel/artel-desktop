# artel-desktop

ARTEL 전체 stack 을 Docker 없이 실행하는 desktop 앱과 runtime bundle 을 만드는 저장소입니다.

- `runtime/`: OS 와 architecture 별 runtime bundle 을 만드는 build script 입니다. PostgreSQL 16 과 pgvector, `jlink` Java runtime, orchestration jar, Python 과 agent-server, `artel-home` 정적 파일이 들어갑니다. 빌드 방법, 구성 요소 출처, release 규칙은 [`runtime/README.md`](runtime/README.md) 에 있습니다.
- `app/`: Electron 앱입니다. `@project-artel/cli` 의 supervisor 로 stack 을 실행하고 console 을 창으로 보여 줍니다. 설치하면 `artel` 명령이 `PATH` 에 등록됩니다.

대상: `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64`, `win32-arm64`.

계획: workspace 저장소의 `.plan/general/2026-10-20-package-artel-as-headless-and-desktop-app.md`.

## License

AGPL-3.0-only
