# MemEat Backend

MemEat 게임의 백엔드 서버입니다. Socket.IO를 사용한 실시간 멀티플레이어 뱀 게임 서버이며, Relayer 패턴을 통해 오프체인 게임 로직을 검증하고 온체인 상태를 업데이트합니다.

## 프로젝트 소개

MemEat-BE는 Node.js/TypeScript 기반의 게임 서버로, 다음과 같은 기능을 제공합니다:

- **실시간 멀티플레이어 게임**: Socket.IO를 통한 실시간 게임 상태 동기화
- **블록체인 연동**: Ethers.js를 사용한 WormGame 스마트 컨트랙트 통신
- **게임 로직 검증**: 오프체인에서 게임 로직을 처리하고 결과를 온체인에 기록
- **토큰 가격 조회**: 실시간 토큰 가격 정보를 제공하여 탈출 조건 계산
- **Relayer 역할**: 게임 결과를 검증하고 스마트 컨트랙트의 상태를 업데이트

## 아키텍처

```
MemEat-BE/
├── src/
│   ├── server.ts              # 메인 서버 진입점
│   ├── controllers/           # API 컨트롤러
│   │   ├── gameController.ts  # 게임 세션 관리
│   │   └── priceController.ts # 토큰 가격 조회
│   ├── services/              # 비즈니스 로직
│   │   ├── gameService.ts     # 게임 로직 처리
│   │   └── blockchainService.ts # 블록체인 연동
│   ├── socket/                # Socket.IO 이벤트 핸들러
│   │   └── gameSocket.ts      # 게임 소켓 이벤트
│   ├── models/                # 데이터 모델
│   └── abis/                  # 스마트 컨트랙트 ABI
├── package.json
├── tsconfig.json
└── .env                       # 환경 변수 설정
```

### 주요 컴포넌트

#### 1. Game Service
- 게임 상태 관리 (플레이어, 음식, 점수)
- 충돌 감지 및 게임 로직 처리
- 리더보드 관리

#### 2. Blockchain Service (Relayer)
- WormGame 컨트랙트와 통신
- 게임 결과를 온체인에 기록
- 탈출 조건 검증 (획득한 토큰의 총 M 환산 가치)

#### 3. Socket Handler
- 실시간 게임 이벤트 처리
- 플레이어 입장/퇴장 관리
- 게임 상태 브로드캐스팅

#### 4. REST API
- `/health`: 서버 상태 확인
- `/api/leaderboard`: 리더보드 조회
- `/api/game-state`: 게임 상태 조회
- `/api/price/:chainId/:tokenAddress`: 토큰 가격 조회
- `/api/enter-game`: 게임 입장
- `/api/check-session`: 활성 세션 확인
- `/api/rejoin-game`: 게임 재입장
- `/api/check-pending-claim`: 보상 대기 상태 확인

## 실행 방법

### 사전 요구사항

- Node.js 18.x 이상
- npm 또는 yarn

### 설치

```bash
cd MemEat-BE
npm install
```

### 환경 변수 설정

`.env` 파일을 생성하고 다음 내용을 설정합니다:

```env
# Supabase 설정 (데이터베이스)
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_key

# 스마트 컨트랙트 설정
CONTRACT_ADDRESS=0x04686e9284B54d8719A5a4DecaBE82158316C8f0
RPC_URL=https://rpc.formicarium.memecore.net/

# Relayer 계정 (서버가 트랜잭션을 전송하는 계정)
RELAYER_PRIVATE_KEY=your_relayer_private_key

# 서버 포트 (선택사항, 기본값: 3333)
PORT=3333
```

### 개발 모드 실행

```bash
npm run dev
```

서버가 `http://localhost:3333`에서 실행됩니다.

### 프로덕션 빌드 및 실행

```bash
# TypeScript 컴파일
npm run build

# 컴파일된 코드 실행
npm start
```

## 주요 기능

### 1. 게임 세션 관리

플레이어가 게임에 입장하면:
1. 스마트 컨트랙트에서 입장료 지불 확인
2. 게임 세션 생성 및 플레이어 ID 할당
3. Socket.IO를 통해 실시간 게임 상태 동기화

### 2. 탈출 조건 검증

플레이어가 탈출을 시도하면:
1. 획득한 모든 MRC-20 토큰의 실시간 가격 조회
2. 총 M 환산 가치 계산
3. 입장료 이상인지 검증
4. 조건 충족 시 `updateGameState()` 호출하여 Exited 상태로 변경

**예시:**
- 입장료: 1 M
- 획득 토큰: sdf 100개 (0.005 M/개) + z 20개 (0.05 M/개)
- 총 가치: (100 × 0.005) + (20 × 0.05) = 1.5 M
- 1.5 M >= 1 M → 탈출 성공 ✅

### 3. Relayer 패턴

서버는 신뢰할 수 있는 Relayer 역할을 수행합니다:
- 오프체인에서 게임 로직 처리 (빠른 응답)
- 게임 결과를 검증하고 온체인에 기록 (보안)
- 플레이어는 가스비 부담 없이 게임 진행 가능

## 기술 스택

- **Runtime**: Node.js
- **언어**: TypeScript
- **웹 프레임워크**: Express.js
- **실시간 통신**: Socket.IO
- **블록체인**: Ethers.js v6
- **데이터베이스**: Supabase (PostgreSQL)
- **환경 변수**: dotenv
- **개발 도구**: tsx (TypeScript 실행), ts-node-dev

## 배포

프로덕션 환경에 배포 시:

1. 환경 변수 설정 확인
2. `npm run build`로 컴파일
3. `dist/` 폴더의 컴파일된 코드를 서버에 배포
4. `npm start`로 실행
5. CORS 설정을 프론트엔드 도메인에 맞게 수정

## 개발 가이드

### 새로운 API 엔드포인트 추가

1. [src/controllers/](src/controllers/)에 컨트롤러 함수 추가
2. [src/server.ts](src/server.ts)에 라우트 등록

### 게임 로직 수정

1. [src/services/gameService.ts](src/services/gameService.ts)에서 게임 로직 수정
2. [src/socket/gameSocket.ts](src/socket/gameSocket.ts)에서 소켓 이벤트 핸들러 업데이트

### 블록체인 연동 수정

1. [src/services/blockchainService.ts](src/services/blockchainService.ts)에서 컨트랙트 호출 로직 수정
2. [src/abis/](src/abis/)에 최신 ABI 파일 업데이트

## 라이선스

ISC
