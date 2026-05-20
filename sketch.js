// ================================================================
// 픽셀 비 — p5.js + MediaPipe Selfie Segmentation
// ================================================================
// 흐름:
//   1. 웹캠 영상을 캔버스에 그림 (좌우 반전 = 거울 효과)
//   2. MediaPipe AI가 매 프레임마다 "어디가 사람인지" 마스크로 알려줌
//   3. 빗방울이 떨어지다가 사람 위치에 닿으면 튀기는 효과
// ================================================================

let capture;       // 웹캠 영상
let drops = [];    // 빗방울 목록

// 사람 감지 마스크 — MediaPipe가 채워줌
let maskData = null;
let maskW = 0;
let maskH = 0;

// getImageData를 자주 쓰기 위해 willReadFrequently 옵션을 준 숨겨진 canvas
const maskCanvas = document.createElement('canvas');
const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });

const DROP_COUNT = 200;

// ================================================================
// p5.js 진입점: setup()은 처음 한 번만 실행
// ================================================================
function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1); // Retina 화면에서도 픽셀 크기 유지

  // 웹캠 켜기
  capture = createCapture(VIDEO);
  capture.size(640, 480);
  capture.hide(); // <video> 태그는 숨기고 canvas에만 그릴 거라서

  // AI 감지 시작
  setupSegmentation();

  // 빗방울 생성 — scatter: true면 처음에 화면 전체에 퍼뜨림
  for (let i = 0; i < DROP_COUNT; i++) {
    drops.push(new Drop(true));
  }
}

// ================================================================
// p5.js 진입점: draw()는 1초에 약 60번 반복 실행 (60fps)
// ================================================================
function draw() {
  // 완전히 지우고 어두운 배경
  background(8, 12, 35);

  // 웹캠을 좌우 반전해서 그리기 (거울처럼 보이게)
  push();
    translate(width, 0);
    scale(-1, 1);
    drawCameraCover();
  pop();

  // 비 오는 분위기를 위한 어두운 파란 오버레이
  fill(5, 10, 30, 80);
  noStroke();
  rect(0, 0, width, height);

  // 빗방울 하나씩 업데이트하고 그리기
  for (let drop of drops) {
    drop.update();
    drop.draw();
  }
}

// 창 크기가 바뀌면 canvas도 맞춰서 조정
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

// 웹캠을 비율 유지하면서 화면 꽉 채우기 (CSS object-fit: cover 동작)
// 화면이 영상보다 넓으면 위아래를 잘라내고, 좁으면 좌우를 잘라냄
function drawCameraCover() {
  const vidW = capture.width;
  const vidH = capture.height;
  const vidAspect = vidW / vidH;
  const canvasAspect = width / height;

  let sx, sy, sw, sh; // 원본 영상에서 잘라낼 영역

  if (canvasAspect > vidAspect) {
    // 화면이 영상보다 가로로 넓음 → 위아래 잘라냄
    sw = vidW;
    sh = vidW / canvasAspect;
    sx = 0;
    sy = (vidH - sh) / 2;
  } else {
    // 화면이 영상보다 세로로 김 → 좌우 잘라냄
    sh = vidH;
    sw = vidH * canvasAspect;
    sx = (vidW - sw) / 2;
    sy = 0;
  }

  image(capture, 0, 0, width, height, sx, sy, sw, sh);
}

// ================================================================
// MediaPipe 설정 — 사람 감지 AI
// ================================================================
function setupSegmentation() {
  const seg = new SelfieSegmentation({
    // MediaPipe 모델 파일을 CDN에서 불러오는 경로
    locateFile: file =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
  });

  // modelSelection: 0 = 빠름, 1 = 더 정확
  seg.setOptions({ modelSelection: 1 });

  // AI가 한 프레임 처리를 끝낼 때마다 이 함수가 호출됨
  seg.onResults(results => {
    // results.segmentationMask: 사람=흰색, 배경=검정인 흑백 이미지
    maskCanvas.width  = results.segmentationMask.width;
    maskCanvas.height = results.segmentationMask.height;
    maskCtx.drawImage(results.segmentationMask, 0, 0);

    // 픽셀 데이터를 배열로 읽어 저장 — 빗방울 충돌 판정에 사용
    const imgData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    maskData = imgData.data; // [R, G, B, A, R, G, B, A, ...] 형태
    maskW = maskCanvas.width;
    maskH = maskCanvas.height;

    // 카메라 연결되면 안내 메시지 숨기기
    const ui = document.getElementById('ui');
    if (ui) ui.style.opacity = '0';
  });

  // 매 프레임마다 웹캠 영상을 AI에 전달
  async function sendFrame() {
    if (capture && capture.elt.readyState >= 2) {
      await seg.send({ image: capture.elt });
    }
    requestAnimationFrame(sendFrame);
  }

  // capture가 초기화될 시간을 잠깐 줌
  setTimeout(sendFrame, 500);
}

// ================================================================
// 사람이 있는 좌표인지 확인 — 빗방울 충돌 판정에 사용
// ================================================================
function isPersonAt(x, y) {
  if (!maskData || maskW === 0) return false;

  // 화면 좌표 → 마스크 좌표 변환
  // 화면은 좌우 반전해서 표시했으므로 x도 반전해서 조회
  const mx = Math.floor(maskW - (x / width) * maskW);
  const my = Math.floor((y / height) * maskH);

  // 범위 벗어나면 false
  if (mx < 0 || mx >= maskW || my < 0 || my >= maskH) return false;

  // 마스크 픽셀의 R 채널: 255(흰색) = 사람, 0(검정) = 배경
  const pixelIndex = (my * maskW + mx) * 4; // RGBA 배열에서 위치 계산
  return maskData[pixelIndex] > 128;
}

// ================================================================
// Drop 클래스 — 빗방울 하나
// ================================================================
class Drop {
  // scatter=true면 처음에 화면 전체에 랜덤 배치
  constructor(scatter = false) {
    this.scatter = scatter;
    this.init();
  }

  init() {
    this.x = Math.floor(random(width));
    this.y = this.scatter ? random(-height, 0) : random(-120, -10);
    this.scatter = false; // 다음 초기화부턴 위에서 시작

    this.speed = random(6, 13);   // 떨어지는 속도
    this.len   = floor(random(3, 8)) * 2; // 길이 (2의 배수 = 픽셀 느낌)
    this.alpha = random(0.4, 1.0); // 투명도

    this.isSplashing = false; // 튀는 중인지
    this.particles   = [];    // 튀는 물방울 파티클
  }

  update() {
    if (this.isSplashing) {
      this.updateParticles();
      return;
    }

    this.y += this.speed;

    if (this.y >= height) {
      // 바닥에 닿음
      this.startSplash('ground');
    } else if (isPersonAt(this.x, this.y)) {
      // 사람에 닿음
      this.startSplash('person');
    }
  }

  startSplash(type) {
    this.isSplashing = true;

    const count = type === 'person' ? floor(random(5, 10)) : floor(random(3, 6));

    for (let i = 0; i < count; i++) {
      if (type === 'person') {
        // 사람 몸: 위쪽 반원으로 튕겨나감
        const angle = PI + random(PI); // 180°~360° (위쪽 방향)
        const speed = random(1, 4);
        this.particles.push({
          x: this.x, y: this.y,
          vx: cos(angle) * speed,
          vy: sin(angle) * speed - random(1),
          life: floor(random(12, 25))
        });
      } else {
        // 바닥: 좌우로 낮게 퍼짐
        const dir = random(-1, 1) > 0 ? 1 : -1;
        this.particles.push({
          x: this.x, y: height - 2,
          vx: dir * random(1, 3),
          vy: -random(1, 3),
          life: floor(random(8, 16))
        });
      }
    }
  }

  updateParticles() {
    for (let p of this.particles) {
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += 0.35; // 중력
      p.life--;
    }
    // 수명이 끝난 파티클 제거
    this.particles = this.particles.filter(p => p.life > 0);

    // 모두 사라지면 새 빗방울로 리셋
    if (this.particles.length === 0) this.init();
  }

  draw() {
    noStroke();

    if (this.isSplashing) {
      // 파티클을 2×2 픽셀 사각형으로 표현
      for (let p of this.particles) {
        const a = (p.life / 25) * this.alpha * 255;
        fill(180, 220, 255, a);
        rect(floor(p.x), floor(p.y), 2, 2);
      }
      return;
    }

    // 빗방울 본체: 2×2 사각형을 세로로 쌓아서 픽셀 느낌
    const segments = this.len / 2;
    for (let i = 0; i < segments; i++) {
      // 아래가 밝고 위로 갈수록 흐릿하게
      const a = ((segments - i) / segments) * this.alpha * 255;
      fill(160, 215, 255, a);
      rect(this.x, floor(this.y) - i * 2, 2, 2);
    }
  }
}
