# artel-desktop

ARTEL 전체 stack 을 Docker 없이 실행하는 desktop 앱과 runtime bundle 을 만드는 저장소입니다.

- `runtime/`: OS 와 architecture 별 runtime bundle 을 만드는 build script 입니다. PostgreSQL 16 과 pgvector, `jlink` Java runtime, orchestration jar, Python 과 agent-server, `artel-home` 정적 파일이 들어갑니다.
- `app/`: Electron 앱입니다. `@project-artel/cli` 의 supervisor 로 stack 을 실행하고 console 을 창으로 보여 줍니다. 설치하면 `artel` 명령이 `PATH` 에 등록됩니다.

대상: `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64`, `win32-arm64`.

계획: workspace 저장소의 `.plan/general/2026-10-20-package-artel-as-headless-and-desktop-app.md`.

## app/

```sh
cd app
npm ci
npm run typecheck && npm run lint && npm test
npm run dist:dir   # `ARTEL_RUNTIME_SOURCE=<runtime 디렉터리>` 로 runtime 위치를 바꿀 수 있습니다
```

- 개발 중에는 `ARTEL_RUNTIME_DIR` 로 runtime 디렉터리를 지정합니다. 설치된 앱은 `resources/runtime` 을 씁니다.
- supervisor 는 `@project-artel/cli/supervisor` 가 publish 되기 전까지 `app/src/supervisor-types.ts` 의 타입과 `app/src/supervisor.ts` 의 동적 import 로 연결합니다.
- 서명은 `CSC_LINK`, `WIN_CSC_LINK`, `APPLE_*` 환경 변수가 있을 때만 켜지고, 서명되지 않은 build 는 update 확인을 하지 않습니다.

## License

AGPL-3.0-only
