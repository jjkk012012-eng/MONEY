공장 내부용 STP 어셈블리 견적 계산기 - 실제 3D 뷰어 구조 버전

실행:
1) 압축 해제
2) 폴더에서 터미널 실행
3) python -m http.server 8080
4) http://localhost:8080 접속

중요:
- GitHub Pages에 올릴 수 있도록 단일 파일 100MB 이하로 구성했습니다.
- app.js는 occt-import-js + Three.js CDN을 사용합니다.
- 인터넷이 연결되어 있으면 STP/STEP 파일을 OCCT로 읽고, 실제 mesh가 있는 말단 파트만 견적표에 넣습니다.
- 파트 행을 클릭하면 해당 mesh만 3D 뷰어에 isolate해서 보여줍니다.
- 어셈블리/서브어셈블리처럼 형상이 없는 컨테이너는 견적 대상이 아닙니다.
- CDN/브라우저 보안 문제로 OCCT가 실패하면 텍스트 fallback으로 전환되며, 이 경우 진짜 3D 형상 뷰어가 아닙니다.

분류 기준:
1. 구매품 우선: BOLT, NUT, BEARING, SENSOR, MOTOR, PIPE, TUBE, 각관, 배관 등
2. 프로파일/압출: PROFILE, 2020, 3030, 4040, 4080 등. 단 PIPE/TUBE는 구매품 우선
3. 선반: SHAFT, PIN, BUSH, ROLLER 등
4. 판금/절곡: 얇은 판재형 + BEND/BENT/FOLD/FLANGE/L_BRACKET/U_BRACKET/절곡 힌트
5. 3D프린팅/사출 후보
6. CNC/MCT: 구매품/프로파일/선반/판금이 아닌 덩어리형 절삭 가공품. 포켓/홈/단차/탭/홀 후보 반영

절곡 기준:
- 같은 두께를 유지한 판재가 휘어진 구조를 절곡 후보로 봅니다.
- mesh만으로 완전한 R/내측반경/전개 검증은 어렵기 때문에, 초기값은 후보로 넣고 공장이 직접 수정하게 했습니다.

탭 기준:
- 탭은 자동 확정이 아니라 후보값입니다.
- 공장이 탭 개수를 수정하면 즉시 견적에 반영됩니다.
