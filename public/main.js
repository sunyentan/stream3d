import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// LiveKit inputs
const urlInput     = document.getElementById("lkUrl");
const apiKeyInput  = document.getElementById("apiKey");
const apiSecInput  = document.getElementById("apiSecret");
const roomInput    = document.getElementById("roomName");
const idInput      = document.getElementById("identity");
const connectBtn   = document.getElementById("lkConnect");

// Frame format constants
const FRAME_WIDTH = 1280, FRAME_HEIGHT = 1296;
const COLOR_HEIGHT = 720;
const LOBITS_Y_START = 720, LOBITS_Y_END = 1008;
const HIBITS_Y_START = 1008, HIBITS_Y_END = 1296;
const UNPACKED_WIDTH = 640, UNPACKED_HEIGHT = 576;
const depthScale = 1 / 1000;
let frameIndex = 0;

// Intrinsics (defaults)
let depthFx = 504.0308, depthFy = 504.0801, depthCx = 323.6529, depthCy = 315.9445;
let colorFx = 604.7008, colorFy = 604.5446, colorCx = 641.4414, colorCy = 365.8837;

let groundLevel = 0;
let environmentPoints = null;

// Scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1, 1);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById("pointCloudContainer").appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minPolarAngle = 0.3;
controls.maxPolarAngle = Math.PI / 2;
controls.enablePan = false;

// WASD camera movement
const moveSpeed = 0.005;
const keys = {};
window.addEventListener("keydown", (event) => { keys[event.code] = true; });
window.addEventListener("keyup", (event) => { keys[event.code] = false; });
const clock = new THREE.Clock();

// Point cloud geometry
const numPoints = UNPACKED_WIDTH * UNPACKED_HEIGHT;
const positions = new Float32Array(numPoints * 3);
const colors = new Float32Array(numPoints * 3);
const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

// UI: toggle control panel
const controlsEl = document.getElementById("controls");
const hideBtn = document.getElementById("hideControlsBtn");
const showBtn = document.getElementById("showControlsBtn");
hideBtn.addEventListener("click", () => {
  controlsEl.style.display = "none";
  showBtn.style.display = "block";
});
showBtn.addEventListener("click", () => {
  controlsEl.style.display = "block";
  showBtn.style.display = "none";
});

const material = new THREE.PointsMaterial({
  size: 0.0001,
  vertexColors: true,
  depthTest: false,
  depthWrite: false,
  transparent: false,
  blending: THREE.NoBlending
});

const pointCloud = new THREE.Points(geometry, material);
pointCloud.scale.set(1, -1, -1);

const liveStreamGroup = new THREE.Group();
liveStreamGroup.add(pointCloud);
liveStreamGroup.scale.set(0.5, 0.5, 0.5);
liveStreamGroup.renderOrder = 10;
scene.add(liveStreamGroup);

const videoElement = document.getElementById("videoElement");
const offscreenCanvas = document.createElement("canvas");
offscreenCanvas.width = FRAME_WIDTH;
offscreenCanvas.height = FRAME_HEIGHT;
const offscreenCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true });

// Split packed 2x1 depth image into full resolution
function unpackPackedDepth(packedData, packedWidth, packedHeight) {
  const origWidth = Math.floor(packedWidth / 2);
  const origHeight = packedHeight * 2;
  const output = new Uint8ClampedArray(origWidth * origHeight);
  for (let row = 0; row < packedHeight; row++) {
    for (let col = 0; col < origWidth; col++) {
      output[row * origWidth + col] = packedData[row * packedWidth + col];
    }
  }
  for (let row = 0; row < packedHeight; row++) {
    for (let col = 0; col < origWidth; col++) {
      output[(row + packedHeight) * origWidth + col] = packedData[row * packedWidth + col + origWidth];
    }
  }
  return { data: output, width: origWidth, height: origHeight };
}

// Main frame handler
function processFrame() {
  offscreenCtx.drawImage(videoElement, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
  const colorImgData = offscreenCtx.getImageData(0, 0, FRAME_WIDTH, COLOR_HEIGHT);
  const lobitsImgData = offscreenCtx.getImageData(0, LOBITS_Y_START, FRAME_WIDTH, LOBITS_Y_END - LOBITS_Y_START);
  const hibitsImgData = offscreenCtx.getImageData(0, HIBITS_Y_START, FRAME_WIDTH, HIBITS_Y_END - HIBITS_Y_START);

  function extractPackedData(imgData) {
    const len = imgData.width * imgData.height;
    const arr = new Uint8ClampedArray(len);
    for (let i = 0; i < len; i++) arr[i] = imgData.data[i * 4];
    return arr;
  }

  const lobitsUnpacked = unpackPackedDepth(extractPackedData(lobitsImgData), lobitsImgData.width, lobitsImgData.height);
  const hibitsUnpacked = unpackPackedDepth(extractPackedData(hibitsImgData), hibitsImgData.width, hibitsImgData.height);

  for (let i = 0; i < numPoints; i++) {
    const msb = hibitsUnpacked.data[i];
    const lsb = lobitsUnpacked.data[i];
    const z = ((msb << 8) | lsb) * depthScale;

    const u = i % UNPACKED_WIDTH, v = Math.floor(i / UNPACKED_WIDTH);
    const x = ((u - depthCx) * z) / depthFx;
    const y = ((v - depthCy) * z) / depthFy;

    let uColor = 0, vColor = 0;
    if (z > 0) {
      uColor = Math.round((x * colorFx / z) + colorCx);
      vColor = Math.round((y * colorFy / z) + colorCy);
    }

    positions[i * 3 + 0] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    let r = 0, g = 0, b = 0;
    if (uColor >= 0 && uColor < colorImgData.width && vColor >= 0 && vColor < colorImgData.height) {
      const idx = (vColor * colorImgData.width + uColor) * 4;
      r = colorImgData.data[idx] / 255;
      g = colorImgData.data[idx + 1] / 255;
      b = colorImgData.data[idx + 2] / 255;
    }

    colors[i * 3 + 0] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }

  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.color.needsUpdate = true;
  frameIndex++;
  videoElement.requestVideoFrameCallback(processFrame);
}

// Start render loop
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (keys["KeyW"] || keys["KeyS"] || keys["KeyA"] || keys["KeyD"]) {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    if (keys["KeyW"]) camera.position.addScaledVector(dir, moveSpeed * delta * 1000);
    if (keys["KeyS"]) camera.position.addScaledVector(dir, -moveSpeed * delta * 1000);
    if (keys["KeyA"]) camera.position.addScaledVector(new THREE.Vector3().crossVectors(camera.up, dir).normalize(), moveSpeed * delta * 1000);
    if (keys["KeyD"]) camera.position.addScaledVector(new THREE.Vector3().crossVectors(dir, camera.up).normalize(), moveSpeed * delta * 1000);
  }

  if (camera.position.y < groundLevel) camera.position.y = groundLevel;
  if (environmentPoints) environmentPoints.material.uniforms.uCameraPos.value.copy(camera.position);

  controls.update();
  renderer.render(scene, camera);
}
animate();

// Start LiveKit + attach video
async function startLiveKit(lkUrl, token) {
  const room = new LivekitClient.Room({ autoSubscribe: true });
  await room.connect(lkUrl, token);
  room.on(LivekitClient.RoomEvent.TrackSubscribed, (track) => {
    if (track.kind === LivekitClient.Track.Kind.Video) {
      const attachedEl = track.attach();
      attachedEl.style.display = "none";
      videoElement.srcObject = attachedEl.srcObject;
      videoElement.play();
      videoElement.addEventListener("loadeddata", () => {
        videoElement.requestVideoFrameCallback(processFrame);
      });
    }
  });
}
