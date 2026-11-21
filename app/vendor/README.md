# CLI 패키지

`project-artel-cli-0.0.1-alpha.1.tgz`는 `project-artel/artel-cli`의 commit
`3f535940315b2ca9c9b3b17341dd02902eadcdd2`을 `npm ci`, `npm run build`, `npm pack`으로 빌드한 패키지입니다.
원본: https://github.com/project-artel/artel-cli/tree/3f535940315b2ca9c9b3b17341dd02902eadcdd2

npm 배포본에 없는 supervisor와 network settings API가 설치 앱에 필요합니다.
tarball과 package-lock의 integrity를 함께 고정해 설치 앱의 의존성을 재현합니다.
CLI가 같은 API를 npm에 배포하면 일반 version 의존성으로 교체할 수 있습니다.
