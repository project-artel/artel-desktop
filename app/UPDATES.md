# Desktop 업데이트와 데이터 보존

ARTEL 메뉴 또는 tray의 `업데이트 확인`에서 새 버전을 확인한다. 새 버전이 있으면
`업데이트 다운로드`, 다운로드가 끝나면 `재시작하여 업데이트`를 선택한다.
작업을 마친 뒤 설치를 선택해야 한다. 앱 종료만으로 업데이트를 설치하지 않는다.

Windows NSIS와 Linux AppImage는 앱 내 업데이트를 지원한다. macOS는 서명된
빌드에서 지원한다. unsigned macOS와 Linux deb는 릴리스 페이지에서 설치 파일을
받는다. `ARTEL_DISABLE_UPDATES=1`이면 앱 내 확인을 끈다.

## 사용자 데이터 경로 유지

설치 파일과 runtime은 교체하지만 supervisor의 기존 데이터 경로는 유지한다.
Windows의 기본 경로는 `%LOCALAPPDATA%\ARTEL`, macOS는
`~/Library/Application Support/ARTEL`, Linux는 `$XDG_DATA_HOME/artel` 또는
`~/.local/share/artel`이다. `ARTEL_DATA_DIR`을 사용했다면 업데이트 후에도 같은
값으로 실행해야 한다. 설치 경로를 사용자 데이터 경로로 지정하지 않는다.
Electron의 기존 `userData` 위치도 변경하지 않는다.

앱 내 설치는 stack 종료를 기다린 뒤 `supervisor.lock`을 확보한다. PostgreSQL의
`postmaster.pid`가 남아 있거나 CLI가 시작한 stack에 연결된 경우 설치를 중단한다.
종료·lock 확보·백업 중 하나라도 실패하면 설치하지 않는다.

`<dataDir>/backups/before-update-*`에 `pgdata`, `storage`, `config.json`을 복사한다.
`config.json`의 암호화 키도 함께 보존한다. `backup.json`이 있는 디렉터리만 복사가
끝난 백업이다. 백업을 자동 삭제하지 않으므로 사용자가 보관 기간과 디스크 공간을
관리해야 한다. runtime, logs, Electron browser profile은 이 백업에 포함하지 않는다.
수동 설치에는 이 사전 백업 절차가 적용되지 않는다.
symlink로 연결한 데이터나 PostgreSQL tablespace가 있으면 앱 내 백업을 중단한다.
해당 외부 경로까지 별도 백업한 뒤 수동 업데이트해야 한다.

## DB migration 적용

desktop 버전만 바뀌면 새 migration은 필요하지 않다. 서버 스키마나 저장 데이터가
바뀔 때 orchestration의 `db/migration`에 새 Flyway migration을 추가한다.
기존 migration을 수정하거나 DB를 다시 만들지 않는다. 새 runtime의 서버가 시작할
때 기존 Flyway 설정으로 미적용 migration을 실행한다.

PostgreSQL major 변경은 SQL migration과 별개다. desktop은 기존 `PG_VERSION`과
runtime manifest의 major가 다르면 시작을 차단한다. 이때 별도의 `pg_upgrade` 또는
dump/restore 절차가 필요하다. `PG_VERSION`이 없는 비어 있지 않은 데이터 폴더도
초기화하지 않고 시작을 차단한다.

실패 후 복원은 모든 ARTEL/CLI stack을 종료한 상태에서 진행한다. 실패한 데이터는
별도 보관하고 완성된 백업의 `pgdata`, `storage`, `config.json`을 같은 경로에 함께
복원한다. 백업의 PostgreSQL major와 호환되는 이전 앱/runtime을 사용한다.
앱만 downgrade해도 migration이 되돌아가지는 않으며 자동 rollback은 제공하지 않는다.

## 업데이트 파일 배포

`app-v<package.json version>` tag의 release workflow가 설치 파일과 `.blockmap`,
업데이트 `.yml`을 함께 게시한다. `TARGET_ARCH`로 `latest-x64`, `latest-arm64`
channel을 나눠 matrix 결과가 서로 덮어쓰지 않게 한다. 직접 빌드할 때도 cross-build
대상과 같은 `TARGET_ARCH`를 지정한다. release는 앱 버전과 일치하는 tag여야 한다.
runtime만 배포하는 release를 GitHub의 latest release로 지정하지 않는다.

Windows signing은 `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`를 사용한다.
macOS signing/notarization은 `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`를 사용한다. 서명 검증과 다운로드
checksum 검증은 electron-updater에 맡긴다.

이미 배포한 0.1.0 앱에는 새 메뉴가 없으므로 이 변경을 포함한 첫 버전은 설치 파일로
업데이트해야 한다. 이후 버전부터 앱 내 업데이트를 사용할 수 있다.

배포 전 서로 다른 두 앱 버전의 실제 installer로 다운로드, 종료, 재실행, 기존 DB
조회와 파일 접근을 확인한다. 단위 테스트만으로 OS installer 교체를 검증할 수는 없다.
