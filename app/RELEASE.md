Windows·macOS·Linux에서 ARTEL 앱을 설치하고 실행할 수 있습니다.
앱을 실행하면 내장 서비스가 시작되고 로그인 화면이 열립니다. 처음에는 **Create account**에서 첫 계정을 만드세요.

## OS별 설치 파일

| OS | CPU | 설치 파일 |
| --- | --- | --- |
| Windows | Intel·AMD x64 | `ARTEL-Setup-0.1.0-x64.exe` |
| Windows | ARM64 | `ARTEL-Setup-0.1.0-arm64.exe` |
| macOS | Intel | `ARTEL-0.1.0-macOS-x64.dmg` |
| macOS | Apple Silicon | `ARTEL-0.1.0-macOS-arm64.dmg` |
| Linux | x64 | `ARTEL-0.1.0-Linux-x64.AppImage` 또는 `.deb` |
| Linux | ARM64 | `ARTEL-0.1.0-Linux-arm64.AppImage` 또는 `.deb` |

- Windows: 설치 후 바탕화면·시작 메뉴의 **ARTEL**을 열면 `artel.exe`가 실행됩니다. 현재 사용자용으로 설치하고 관리자 권한 없이 실행하세요.
- macOS: DMG를 열고 **ARTEL.app**을 Applications로 옮깁니다. 같은 앱의 `.zip`도 제공합니다.
- Linux: AppImage에 실행 권한을 부여해 실행하거나, Debian·Ubuntu에서 `sudo apt install ./ARTEL-0.1.0-Linux-<arch>.deb`로 설치합니다. 앱 자체는 일반 사용자로 실행하세요.

PostgreSQL·Java·Python과 ARTEL runtime이 설치 파일에 포함되어 있습니다.
Docker나 개발 도구를 별도로 설치할 필요가 없습니다. 각 파일 옆의 `.sha256`으로 무결성을 확인할 수 있습니다.
창을 닫으면 트레이에 남고, 트레이의 **Quit**을 누르면 서비스를 종료합니다.
Windows와 Linux deb는 CLI를 등록하며, macOS와 AppImage는 앱의 CLI 설치 메뉴를 사용합니다.

현재 빌드는 코드 서명과 Apple notarization이 없습니다. Windows SmartScreen 또는 macOS Gatekeeper에서 확인 경고나 실행 차단이 발생할 수 있습니다.
서명되지 않은 빌드의 자동 업데이트 확인은 비활성화되어 있습니다.
