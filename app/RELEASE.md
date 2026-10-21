Windows에 설치하면 `artel.exe`와 바탕화면·시작 메뉴의 **ARTEL** 바로가기가 생성됩니다.
앱을 실행하면 내장 서비스가 시작되고 로그인 화면이 열립니다. 처음에는 **Create account**에서 첫 계정을 만드세요.

## 설치 파일

- 일반 Intel·AMD Windows PC: `ARTEL-Setup-0.1.0-x64.exe`
- Snapdragon 등 ARM64 Windows PC: `ARTEL-Setup-0.1.0-arm64.exe`

PostgreSQL·Java·Python과 ARTEL runtime이 설치 파일에 포함되어 있습니다.
Docker나 개발 도구를 별도로 설치할 필요가 없습니다. 설치 파일 옆의 `.sha256`으로 무결성을 확인할 수 있습니다.

관리자 권한 없이 현재 사용자용으로 설치하고 실행하세요. 기본 데이터 경로는 `%LOCALAPPDATA%\ARTEL`입니다.
창을 닫으면 트레이에 남고, 트레이의 **Quit**을 누르면 서비스를 종료합니다.
CLI는 새 터미널에서 `artel` 명령으로 사용할 수 있습니다.

이 빌드는 Authenticode 서명이 없어 Windows SmartScreen에서 게시자 확인 경고가 나타날 수 있습니다.
서명되지 않은 빌드의 자동 업데이트 확인은 비활성화되어 있습니다.
