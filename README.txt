공장 내부용 STEP/STP 어셈블리 견적 계산기

핵심 수정 사항
1) 공장 선택 없음: 한 공장이 자기 내부 단가표로 견적 계산
2) 어셈블리/서브어셈블리 제외: NEXT_ASSEMBLY_USAGE_OCCURRENCE의 parent 노드는 견적 제외
3) 말단 파트만 집계: child 이면서 parent가 아닌 leaf part만 표에 표시
4) 자동 분석값 표시 후 수정 가능: 공법/재질/수량/중량/길이/탭/절곡/추가비/마진 수정
5) 견적 과대 방지: 사출 금형비는 기본 미포함, 공정 기본 단가도 현실적 소액 기준
6) 고객 화면용이 아니라 공장 내부용: 고객 제출 견적가만 최종 출력

실행
- index.html 더블클릭
- 또는 python -m http.server 8080 후 http://localhost:8080

실제 STEP 형상 파싱 연동
- app.js의 StepParserAdapter.parse()를 occt-import-js/OpenCascade WASM 파서로 교체
- 하위 견적 계산 함수(calcPart, calcTapCost, calcBendCost)는 그대로 사용 가능

주의
- 현재 브라우저 단독 데모는 STEP 텍스트의 PRODUCT / PRODUCT_DEFINITION / NEXT_ASSEMBLY_USAGE_OCCURRENCE 이름 기반 파싱 + 형상값 추정입니다.
- 실제 크기/부피/표면적/홀/절곡 후보는 CAD 커널 연동 시 정확화됩니다.
