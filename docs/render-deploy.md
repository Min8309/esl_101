# Render에 말줍 배포하기

## 배포 전에 자료 백업

현재 사용하는 말줍의 데이터 관리에서 전체 백업을 다운로드합니다. localhost와 Render 주소는 다른 브라우저 저장소를 사용하므로 배포해도 기존 자료가 자동으로 나타나지 않습니다. 배포 후 새 사이트의 데이터 관리에서 백업을 복원하세요.

## Render 연결

1. https://dashboard.render.com 에 로그인합니다.
2. **New → Web Service**를 선택합니다. Static Site가 아닌 Web Service를 사용합니다.
3. GitHub를 연결하고 **Min8309/esl_101** 저장소를 선택합니다. 목록에 없다면 GitHub의 Render 앱 접근 권한에 해당 저장소를 추가합니다.
4. 이름은 원하는 이름(예: `maljup`), 브랜치는 **main**, Language/Runtime은 **Docker**로 설정합니다. Root Directory는 비워 두고 Dockerfile 경로는 **./Dockerfile**로 둡니다.
5. 제공되는 인스턴스 요금과 제한을 확인하고 선택합니다. Free가 표시되면 기능 확인에 사용할 수 있으나 유휴 정지와 자원 제한이 있을 수 있습니다. 운영 목적이라면 필요에 맞는 유료 인스턴스를 검토합니다.
6. Advanced의 **Health Check Path**를 **/healthz**로 설정합니다. 별도의 Build Command나 Start Command를 입력할 필요가 없습니다. Dockerfile이 설치와 실행을 담당합니다. PORT, Python 경로도 Dockerfile과 Render가 처리합니다.
7. **Create Web Service / Deploy Web Service**를 누릅니다. 첫 빌드는 Node.js·Python·자막 패키지를 설치하므로 시간이 걸립니다.
8. 상태가 **Live**가 되면 Render가 표시한 HTTPS 주소를 엽니다. 해당 주소 뒤에 `/healthz`를 붙였을 때 `{"status":"ok"}`가 나오면 서버가 응답하는 것입니다. 이 응답이 실제 YouTube 자막 접근 성공까지 보장하지는 않습니다.

## 배포 후 확인

- 로고, 모바일 메뉴, 카드 저장, 형광펜 수집이 정상인지 확인합니다.
- 공개 자막이 있는 유튜브 영상으로 가져오기를 확인합니다. YouTube가 데이터센터 IP를 차단하거나 제한하면 페이지는 열리더라도 자막 가져오기가 실패할 수 있습니다. 해당 오류를 확인해야 하며 배포 자체가 이를 해결하지는 않습니다.
- 모바일에서 HTTPS 주소로 접속하고 마이크 권한을 허용해 녹음을 확인합니다.
- 기존 JSON 백업을 새 주소에서 복원합니다. PC와 휴대폰의 브라우저 자료는 계속 별개입니다.
- Google Sheets를 사용한다면 Google Cloud의 웹 OAuth 클라이언트에 Render에서 발급된 실제 HTTPS 원본을 승인된 JavaScript 원본으로 추가합니다. 경로는 넣지 않습니다. 배포된 앱의 데이터 관리에서 클라이언트 ID를 다시 입력하고 연결합니다. 보안 비밀을 앱이나 저장소에 넣지 않습니다.

## 다음 업데이트

GitHub main에 새 커밋이 올라왔을 때 Render의 자동 배포 설정에 따라 배포되며, 자동 배포를 끈 경우 Manual Deploy에서 최신 커밋을 배포합니다. 코드 변경이 없는 일시적인 재시작은 별도의 설정 변경이 필요하지 않습니다.

## 로컬 Docker 확인

```sh
docker build -t maljup .
docker run --rm -p 3000:10000 maljup
```

브라우저에서 로컬 3000번 포트를 확인합니다. Dockerfile은 관리자 계정 대신 node 사용자로 서버를 실행하고, 웹에 필요한 파일만 이미지에 포함합니다. 데이터베이스 서비스나 API 키는 기본 배포에 필요하지 않습니다. 이 저장소에 배포 설정이 있다는 것과 Render 서비스가 실제 생성·배포됐다는 것은 다릅니다.
