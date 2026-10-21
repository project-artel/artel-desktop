# CLI 패키지

`project-artel-cli-0.0.1-alpha.1.tgz`는 `project-artel/artel-cli`의 commit
`8137c295a1bebede10f72e0e9dfedbf2b9db17d6`을 `npm ci`, `npm run build`, `npm pack`으로 빌드한 패키지입니다.
원본: https://github.com/project-artel/artel-cli/tree/8137c295a1bebede10f72e0e9dfedbf2b9db17d6

npm 배포본에 없는 supervisor와 network settings API가 설치 앱에 필요합니다.
이 commit은 CLI PR #42의 소스이며 해당 PR의 merge나 npm publish는 이 저장소에서 수행하지 않습니다.
tarball과 package-lock의 integrity를 함께 고정해 설치 앱의 의존성을 재현합니다.
CLI가 같은 API를 npm에 배포하면 일반 version 의존성으로 교체할 수 있습니다.
