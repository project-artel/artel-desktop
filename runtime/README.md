# runtime

ARTEL stack 을 Docker 없이 실행하는 데 필요한 프로그램을 OS 와 architecture 별 archive 하나로 묶는 build script 입니다. CLI 의 supervisor(`artel server`)와 Electron 앱이 이 archive 를 읽습니다. archive 이름, release 주소, 디렉터리 구조, `manifest.json` 형식은 workspace 저장소의 계획 문서 `.plan/general/2026-10-20-package-artel-as-headless-and-desktop-app.md` 의 `## Shared contract` 2절을 따릅니다.

## 파일

| 파일 | 하는 일 |
| --- | --- |
| `build.sh` | `common` 은 orchestration jar, `artel-home` dist, agent-server 소스를 한 번 만든다. `bundle <target> <version>` 은 target 하나의 archive 를 만든다. |
| `smoke-test.sh` | archive 를 임시 디렉터리에 풀고 postgres, pgvector, orchestration, agent-server 를 실제로 띄워 본 뒤 모두 종료한다. |
| `versions.env` | 내려받는 구성 요소의 version 과 고정한 checksum. |
| `lib.sh` | 두 script 가 함께 쓰는 함수. |
| `../.github/workflows/runtime.yml` | 6개 target 을 각 OS 의 runner 에서 빌드하고 smoke test 한 뒤, `runtime-v*` tag 에서 release 를 만든다. |

## 로컬 빌드

```bash
# 공통 부분: git, JDK 21, Node 22 이상, python3 3.11 이상
runtime/build.sh common
# target 하나: 빌드하는 machine 과 target 이 같아야 한다
runtime/build.sh bundle linux-x64 0.1.0
runtime/smoke-test.sh runtime/build/out/artel-runtime-0.1.0-linux-x64.tar.gz
```

- 결과물은 `runtime/build/out/artel-runtime-<version>-<target>.tar.gz` 와 `.sha256`(hex digest, 공백 두 칸, 파일 이름)입니다.
- `manifest.json` 은 archive 의 최상위에 있습니다. 빈 디렉터리에 풀면 그 디렉터리가 runtime 디렉터리가 됩니다.
- 소스 저장소와 ref 는 `ARTEL_ORCHESTRATION_REPO`/`_REF`, `ARTEL_AGENT_SERVER_REPO`/`_REF`, `ARTEL_HOME_REPO`/`_REF` 로 바꿉니다. 기본값은 각 저장소의 `develop` 이고, 저장소 자리에 로컬 경로를 줄 수도 있습니다. 빌드한 commit SHA 는 `manifest.json` 의 `sources` 에 기록됩니다.
- 내려받은 파일은 `runtime/build/cache/` 에 남고, 쓰기 전에 매번 checksum 을 확인합니다.
- Windows 에서는 Visual Studio 개발자 환경(`cl`, `nmake`)이 잡힌 상태에서 Git Bash 로 실행합니다.
- Windows arm64 에서는 `vcpkg install openssl:arm64-windows-static-md --classic` 으로 OpenSSL 을 빌드하고, `OPENSSL_DIR` 을 vcpkg 의 `installed/arm64-windows-static-md` 경로로, `OPENSSL_STATIC=1` 로 설정합니다. CI 는 bundle 빌드 전에 이 단계를 실행합니다. static OpenSSL 을 사용하므로 별도 OpenSSL DLL 을 배포할 필요가 없습니다.
- `smoke-test.sh --skip-services` 는 postgres 와 pgvector 만 확인합니다. orchestration 과 agent-server 는 bundled mode 환경 변수(`ARTEL_STORE=postgres`, `ARTEL_STORAGE=filesystem`, `SESSION_STORE=memory`)로 띄우고, `GET /api/auth/me` 가 어떤 status 든 응답하는지, `GET /health` 가 200 인지 확인합니다.

## 구성 요소 출처

| 구성 요소 | 출처 | 검증 | License |
| --- | --- | --- | --- |
| PostgreSQL 16 | [theseus-rs/postgresql-binaries](https://github.com/theseus-rs/postgresql-binaries) release `16.15.1`. 6개 target 모두 prebuilt 가 있고 `pg_config`, `include/server`, `lib/pgxs` 가 들어 있다. | 같은 release 의 `<asset>.sha256` | [PostgreSQL License](https://www.postgresql.org/about/licence/) |
| pgvector 0.8.7 | [pgvector/pgvector](https://github.com/pgvector/pgvector) tag archive 를 위 PostgreSQL 로 target 마다 compile. POSIX 는 `make OPTFLAGS=` (`-march=native` 제거), Windows 는 `nmake /F Makefile.win`. `postgres/lib` 와 `postgres/share/extension` 에 설치된다. | 배포처가 checksum 을 내지 않으므로 `versions.env` 에 고정한 SHA-256 | PostgreSQL License |
| Java 21 | [Eclipse Temurin](https://adoptium.net/) `21.0.12.1+1` JDK 를 [adoptium/temurin21-binaries](https://github.com/adoptium/temurin21-binaries) 에서 받아 `jlink` 에만 쓴다. Windows arm64 도 Temurin build 가 있어 Microsoft Build of OpenJDK 는 쓰지 않는다. | `<asset>.sha256.txt` | GPL-2.0 with Classpath Exception |
| Python 3.12 | [astral-sh/python-build-standalone](https://github.com/astral-sh/python-build-standalone) release `20261013`, CPython `3.12.15`, `install_only_stripped` (debug symbol 을 뺀 `install_only`). agent-server 의 `pyproject.toml` 의존성을 그 Python 에 `pip install` 한 뒤 pip 는 지운다. | release 의 `SHA256SUMS` | Python Software Foundation License, 빌드 script 는 MPL-2.0 |
| orchestration | `artel-orchestration-server` 를 `./mvnw -DskipTests package` 로 빌드한 Spring Boot jar | commit SHA 를 `manifest.json` 에 기록 | AGPL-3.0-only |
| agent-server | `artel-agent-server` 의 `app/` 디렉터리 | 같음 | AGPL-3.0-only |
| artel-home | `VITE_ORCHESTRATION_URL=__ARTEL_ORCHESTRATION_URL__` 로 빌드한 `dist/` | 같음 | AGPL-3.0-only |

`jlink` 에 넣는 module 은 `jdeps --ignore-missing-deps --multi-release 21 --print-module-deps` 가 jar 의 `BOOT-INF/classes` 와 `BOOT-INF/lib/*.jar` 에서 찾은 목록에 `versions.env` 의 `JAVA_EXTRA_MODULES`(`jdk.crypto.ec`, `jdk.unsupported`, `jdk.naming.dns`, `jdk.zipfs`, `jdk.localedata`, `jdk.charsets`)를 더한 것입니다. jdeps 는 이름으로 load 되는 class 를 보지 못하기 때문입니다.

## Target 과 runner

| Target | Runner | 비고 |
| --- | --- | --- |
| `linux-x64` | `ubuntu-latest` | |
| `linux-arm64` | `ubuntu-24.04-arm` | |
| `darwin-x64` | `macos-15-intel` | `macos-13` 은 2025년에 GitHub 에서 사라져 남은 Intel image 를 쓴다. |
| `darwin-arm64` | `macos-14` | |
| `win32-x64` | `windows-latest` | |
| `win32-arm64` | `windows-11-arm` | ARM64 static OpenSSL 을 빌드한 뒤 Python 의존성을 설치한다. 다른 target 과 동일하게 실패하면 release 를 중단한다. |

## Release

`runtime-v<version>` tag 를 push 하면 `release` job 이 모든 archive 와 `.sha256` 를 `https://github.com/project-artel/artel-desktop/releases/download/runtime-v<version>/<archive>` 에 올립니다. release 는 `--latest=false` 로 만듭니다. Electron 앱의 `electron-updater` 가 이 저장소의 latest release 를 읽기 때문에, runtime release 가 latest 가 되면 앱 update 가 깨집니다.

## 크기

CI 의 archive 크기(2026-10-20, `develop` 기준): `linux-x64` 293 MB, `linux-arm64` 284 MB, `darwin-x64` 321 MB, `darwin-arm64` 304 MB, `win32-x64` 265 MB. linux-x64 를 풀면 약 710 MB 이고, 그중 Python 과 agent-server 의존성이 430 MB(`site-packages` 332 MB), PostgreSQL 105 MB, orchestration jar 90 MB, Java 74 MB 입니다.

## 아직 처리하지 않은 것

- macOS: bundle 안의 Mach-O 파일은 서명이 유효하지 않을 때만 ad-hoc 서명합니다. Developer ID 서명과 notarization 은 desktop 앱 빌드에서 `postgres`, `java`, `python`, 모든 `.dylib` 와 `.so` 를 대상으로 해야 합니다.
- Windows: 실행 파일이 서명되지 않아 백신 프로그램이 격리할 수 있습니다.
- Linux: PostgreSQL 이 함께 싣고 오는 `libstdc++.so.6` 이 glibc 2.36 을 요구하므로 Ubuntu 22.04, Debian 11, RHEL 9 처럼 glibc 2.36 미만인 배포판에서는 `initdb` 가 실행되지 않습니다. `vector.so` 는 `-std=gnu11` 에 `_GNU_SOURCE` 없이 compile 해 glibc 2.14 까지만 요구하고, `build.sh` 가 이 값이 PostgreSQL 의 요구치를 넘지 않는지 확인합니다.
- `win32-arm64`: 기존 CI 에서 `cryptography` source build 가 OpenSSL 을 찾지 못했습니다. ARM64 static OpenSSL 빌드와 `OPENSSL_DIR` 설정을 추가했으며, smoke test 는 압축을 푼 Python 으로 `cryptography` 의 AES-GCM 암호화·복호화를 확인합니다. 2026-10-21 [CI run 39559060851](https://github.com/project-artel/artel-desktop/actions/runs/39559060851) 에서 6개 target 모두 build 와 smoke test 를 통과했습니다.
