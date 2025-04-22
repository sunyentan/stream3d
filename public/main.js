import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const urlInput     = document.getElementById("lkUrl");
const apiKeyInput  = document.getElementById("apiKey");
const apiSecInput  = document.getElementById("apiSecret");
const roomInput    = document.getElementById("roomName");
const idInput      = document.getElementById("identity");
const connectBtn   = document.getElementById("lkConnect");

const FRAME_WIDTH = 1280, FRAME_HEIGHT = 1296;
const COLOR_HEIGHT = 720;  // top part for color image
const LOBITS_Y_START = 720, LOBITS_Y_END = 1008;
const HIBITS_Y_START = 1008, HIBITS_Y_END = 1296;
const UNPACKED_WIDTH = 640, UNPACKED_HEIGHT = 576;
const depthScale = 1 / 1000;
let frameIndex = 0;

// const depthFx = 504.0308, depthFy = 504.0801;
// const depthCx = 323.6529, depthCy = 315.9445;
// const colorFx = 604.7008, colorFy = 604.5446;
// const colorCx = 641.4414, colorCy = 365.8837;

let depthFx = 504.0308,
    depthFy = 504.0801,
    depthCx = 323.6529,
    depthCy = 315.9445;

let colorFx = 604.7008,
    colorFy = 604.5446,
    colorCx = 641.4414,
    colorCy = 365.8837;

let groundLevel = 0;
let environmentPoints = null;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1, 1);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById("pointCloudContainer").appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minPolarAngle = 0.3; // prevents extreme tilt
controls.maxPolarAngle = Math.PI / 2; // no views below horizontal
controls.enablePan = false; // keeps the environment centered

const moveSpeed = 0.005;
const keys = {};
window.addEventListener("keydown", (event) => { keys[event.code] = true; });
window.addEventListener("keyup", (event) => { keys[event.code] = false; });
const clock = new THREE.Clock();

const numPoints = UNPACKED_WIDTH * UNPACKED_HEIGHT;
const positions = new Float32Array(numPoints * 3);
const colors = new Float32Array(numPoints * 3);

const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

const controlsEl    = document.getElementById("controls");
const hideBtn       = document.getElementById("hideControlsBtn");
const showBtn       = document.getElementById("showControlsBtn");

hideBtn.addEventListener("click", () => {
  controlsEl.style.display = "none";
  showBtn.style.display    = "block";
});

showBtn.addEventListener("click", () => {
  controlsEl.style.display = "block";
  showBtn.style.display    = "none";
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

function processFrame() {
  offscreenCtx.drawImage(videoElement, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);

  const colorImgData = offscreenCtx.getImageData(0, 0, FRAME_WIDTH, COLOR_HEIGHT);

  const lobitsImgData = offscreenCtx.getImageData(0, LOBITS_Y_START, FRAME_WIDTH, LOBITS_Y_END - LOBITS_Y_START);
  const hibitsImgData = offscreenCtx.getImageData(0, HIBITS_Y_START, FRAME_WIDTH, HIBITS_Y_END - HIBITS_Y_START);

  function extractPackedData(imgData) {
    const len = imgData.width * imgData.height;
    const arr = new Uint8ClampedArray(len);
    for (let i = 0; i < len; i++) {
      arr[i] = imgData.data[i * 4];
    }
    return arr;
  }
  const lobitsPacked = extractPackedData(lobitsImgData);
  const hibitsPacked = extractPackedData(hibitsImgData);

  const lobitsUnpacked = unpackPackedDepth(lobitsPacked, lobitsImgData.width, lobitsImgData.height);
  const hibitsUnpacked = unpackPackedDepth(hibitsPacked, hibitsImgData.width, hibitsImgData.height);

  for (let i = 0; i < numPoints; i++) {
    const msb = hibitsUnpacked.data[i];
    const lsb = lobitsUnpacked.data[i];
    const depth16 = (msb << 8) | lsb;
    const z = depth16 * depthScale;

    const u_depth = i % UNPACKED_WIDTH;
    const v_depth = Math.floor(i / UNPACKED_WIDTH);

    const x_depth = ((u_depth - depthCx) * z) / depthFx;
    const y_depth = ((v_depth - depthCy) * z) / depthFy;

    const x_color = x_depth;
    const y_color = y_depth;
    const z_color = z;

    let u_color = 0, v_color = 0;
    if (z_color > 0) {
      u_color = Math.round((x_color * colorFx / z_color) + colorCx);
      v_color = Math.round((y_color * colorFy / z_color) + colorCy);
    }

    positions[i * 3] = x_depth;
    positions[i * 3 + 1] = y_depth;
    positions[i * 3 + 2] = z;

    let r = 0, g = 0, b = 0;
    if (u_color >= 0 && u_color < colorImgData.width && v_color >= 0 && v_color < colorImgData.height) {
      const idx = (v_color * colorImgData.width + u_color) * 4;
      r = colorImgData.data[idx] / 255;
      g = colorImgData.data[idx + 1] / 255;
      b = colorImgData.data[idx + 2] / 255;
    }
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.color.needsUpdate = true;

  frameIndex++;
  videoElement.requestVideoFrameCallback(processFrame);
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (keys["KeyW"]) {
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    camera.position.addScaledVector(direction, moveSpeed * delta * 1000);
  }
  if (keys["KeyS"]) {
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    camera.position.addScaledVector(direction, -moveSpeed * delta * 1000);
  }
  if (keys["KeyA"]) {
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    const left = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
    camera.position.addScaledVector(left, moveSpeed * delta * 1000);
  }
  if (keys["KeyD"]) {
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    const right = new THREE.Vector3().crossVectors(direction, camera.up).normalize();
    camera.position.addScaledVector(right, moveSpeed * delta * 1000);
  }

  if (camera.position.y < groundLevel) {
    camera.position.y = groundLevel;
  }

  if (environmentPoints) {
    environmentPoints.material.uniforms.uCameraPos.value.copy(camera.position);
  }

  controls.update();
  renderer.render(scene, camera);
}
animate();

// async function connectLiveKit() {
//   const room = new LivekitClient.Room({ autoSubscribe: true });
//   await room.connect(LIVEKIT_URL, TOKEN);
//   console.log("Connected to room:", room.name);

//   room.on(LivekitClient.RoomEvent.TrackSubscribed, (track, publication) => {
//     if (track.kind === LivekitClient.Track.Kind.Video) {
//       console.log("Video track subscribed:", publication.sid);
//       const attachedEl = track.attach();
//       attachedEl.style.display = "none";
//       videoElement.srcObject = attachedEl.srcObject;
//       videoElement.play();
//       videoElement.addEventListener("loadeddata", () => {
//         videoElement.requestVideoFrameCallback(processFrame);
//       });
//     }
//   });
// }
// connectLiveKit().catch(err => console.error("LiveKit connection error:", err));

async function startLiveKit(lkUrl, token) {
  const room = new LivekitClient.Room({ autoSubscribe: true });
  await room.connect(lkUrl, token);
  console.log("Connected to room:", room.name);

  room.on(LivekitClient.RoomEvent.TrackSubscribed, (track, publication) => {
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

const modelUploadInput = document.getElementById("modelUpload");
modelUploadInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    const contents = e.target.result;
    if (file.name.toLowerCase().endsWith(".xyz")) {
      const lines = contents.split('\n');
      const vertices = [];
      const colorsArr = [];
      for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        const parts = line.split(/\s+/);
        if (parts.length < 3) continue;
        const x = parseFloat(parts[0]);
        const y = parseFloat(parts[1]);
        const z = parseFloat(parts[2]);
        vertices.push(x, y, z);
        if (parts.length >= 6) {
          const r = parseFloat(parts[3]) / 255;
          const g = parseFloat(parts[4]) / 255;
          const b = parseFloat(parts[5]) / 255;
          colorsArr.push(r, g, b);
        } else {
          colorsArr.push(1, 1, 1);
        }
      }
      const xyzGeometry = new THREE.BufferGeometry();
      xyzGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      xyzGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colorsArr, 3));

      const tempPoints = new THREE.Points(xyzGeometry);
      const bbox = new THREE.Box3().setFromObject(tempPoints);
      const center = new THREE.Vector3();
      bbox.getCenter(center);

      console.log('Bounding Box:', bbox);
      console.log('Center:', center);

      const xyzMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uMin: { value: bbox.min.clone() },
          uMax: { value: bbox.max.clone() },
          uCenter: { value: center.clone() },
          uCameraPos: { value: camera.position },
          opacity: { value: 0.7 },
          uCeilingThreshold: { value: 6.1 },
          uLeftWallThreshold: { value: 2 },
          uRightWallThreshold: { value: 2.1 },
          uFrontWallThreshold: { value: 0.05 },
          uBackWallThreshold: { value: 0.19 }
        },
        vertexShader: `
                  uniform vec3 uMin;
                  uniform vec3 uMax;
                  uniform vec3 uCenter;
                  uniform vec3 uCameraPos;
                  uniform float uCeilingThreshold;
                  uniform float uLeftWallThreshold;
                  uniform float uRightWallThreshold;
                  uniform float uFrontWallThreshold;
                  uniform float uBackWallThreshold;
                  varying vec3 vColor;
                  varying float vVisible;
                  void main() {
                    vec4 worldPos4 = modelMatrix * vec4(position, 1.0);
                    vec3 worldPos = worldPos4.xyz;
                    float visible = 1.0;
            
                    if (worldPos.y > uMax.y - uCeilingThreshold && uCameraPos.y > uCenter.y) {
                      visible = 0.0;
                    }
                    if (worldPos.x < uMin.x + uLeftWallThreshold && uCameraPos.x < uCenter.x) {
                      visible = 0.0;
                    }
                    if (worldPos.x > uMax.x - uRightWallThreshold && uCameraPos.x > uCenter.x) {
                      visible = 0.0;
                    }
                    if (uCameraPos.z < uCenter.z) {
                      // Optionally clip front wall points here.
                    } else {
                      if (worldPos.z > uMax.z - uBackWallThreshold) {
                        visible = 0.0;
                      }
                    }
                    
                    vVisible = visible;
                    vColor = color;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = 2.0;
                  }
                `,
        fragmentShader: `
                  uniform float opacity;
                  varying vec3 vColor;
                  varying float vVisible;
                  void main() {
                    if (vVisible < 0.5) discard;
                    gl_FragColor = vec4(vColor, opacity);
                  }
                `,
        vertexColors: true,
        transparent: true
      });

      const points = new THREE.Points(xyzGeometry, xyzMaterial);
      points.rotation.x = -Math.PI / 2;
      points.material.side = THREE.DoubleSide;
      scene.add(points);
      environmentPoints = points;

      groundLevel = bbox.min.y;
      controls.target.copy(center);
      camera.position.set(center.x, center.y + 1, center.z + 1);
    } else {
      console.error("Unsupported file type");
    }
  };
  reader.readAsText(file);
});

const posXSlider = document.getElementById("posX");
const posXInput = document.getElementById("posXInput");
posXSlider.addEventListener("input", (e) => {
  const value = parseFloat(e.target.value);
  liveStreamGroup.position.x = value;
  document.getElementById("posXVal").innerText = value;
  posXInput.value = value;
});
posXInput.addEventListener("input", (e) => {
  const value = parseFloat(e.target.value);
  liveStreamGroup.position.x = value;
  posXSlider.value = value;
  document.getElementById("posXVal").innerText = value;
});

const posYSlider = document.getElementById("posY");
const posYInput = document.getElementById("posYInput");
posYSlider.addEventListener("input", (e) => {
  const value = parseFloat(e.target.value);
  liveStreamGroup.position.y = value;
  document.getElementById("posYVal").innerText = value;
  posYInput.value = value;
});
posYInput.addEventListener("input", (e) => {
  const value = parseFloat(e.target.value);
  liveStreamGroup.position.y = value;
  posYSlider.value = value;
  document.getElementById("posYVal").innerText = value;
});

const posZSlider = document.getElementById("posZ");
const posZInput = document.getElementById("posZInput");
posZSlider.addEventListener("input", (e) => {
  const value = parseFloat(e.target.value);
  liveStreamGroup.position.z = value;
  document.getElementById("posZVal").innerText = value;
  posZInput.value = value;
});
posZInput.addEventListener("input", (e) => {
  const value = parseFloat(e.target.value);
  liveStreamGroup.position.z = value;
  posZSlider.value = value;
  document.getElementById("posZVal").innerText = value;
});

const rotationSlider = document.getElementById("rotation");
const rotationInput = document.getElementById("rotationInput");
rotationSlider.addEventListener("input", (e) => {
  const value = parseFloat(e.target.value);
  liveStreamGroup.rotation.y = THREE.MathUtils.degToRad(value);
  document.getElementById("rotVal").innerText = value;
  rotationInput.value = value;
});
rotationInput.addEventListener("input", (e) => {
  const value = parseFloat(e.target.value);
  liveStreamGroup.rotation.y = THREE.MathUtils.degToRad(value);
  rotationSlider.value = value;
  document.getElementById("rotVal").innerText = value;
});

const scaleSlider = document.getElementById("scaleSlider");
const scaleInput = document.getElementById("scaleInput");
scaleSlider.addEventListener("input", (e) => {
  const value = parseFloat(e.target.value);
  liveStreamGroup.scale.set(value, value, value);
  document.getElementById("scaleVal").innerText = value;
  scaleInput.value = value;
});
scaleInput.addEventListener("input", (e) => {
  const value = parseFloat(e.target.value);
  liveStreamGroup.scale.set(value, value, value);
  scaleSlider.value = value;
  document.getElementById("scaleVal").innerText = value;
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

connectBtn.addEventListener("click", async () => {
  updateIntrinsics();
  const LIVEKIT_URL  = urlInput.value.trim();
  const apiKey       = apiKeyInput.value.trim();
  const apiSecret    = apiSecInput.value.trim();
  const roomName     = roomInput.value.trim();
  const identity     = idInput.value.trim();

  if (!LIVEKIT_URL || !apiKey || !apiSecret || !roomName || !identity) {
    return alert("Please fill in all LiveKit fields");
  }

  const resp = await fetch("/.netlify/functions/generateToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, apiSecret, roomName, identity }),
  });
  const { token } = await resp.json();

  startLiveKit(LIVEKIT_URL, token);
});

function updateIntrinsics() {
  const dFx = parseFloat(depthFxInput.value);
  const dFy = parseFloat(depthFyInput.value);
  const dCx = parseFloat(depthCxInput.value);
  const dCy = parseFloat(depthCyInput.value);

  const cFx = parseFloat(colorFxInput.value);
  const cFy = parseFloat(colorFyInput.value);
  const cCx = parseFloat(colorCxInput.value);
  const cCy = parseFloat(colorCyInput.value);

  if (!isNaN(dFx)) depthFx = dFx;
  if (!isNaN(dFy)) depthFy = dFy;
  if (!isNaN(dCx)) depthCx = dCx;
  if (!isNaN(dCy)) depthCy = dCy;

  if (!isNaN(cFx)) colorFx = cFx;
  if (!isNaN(cFy)) colorFy = cFy;
  if (!isNaN(cCx)) colorCx = cCx;
  if (!isNaN(cCy)) colorCy = cCy;

  console.log("Intrinsics updated:", { depthFx, depthFy, depthCx, depthCy, colorFx, colorFy, colorCx, colorCy });
}

const depthFxInput   = document.getElementById("depthFxInput");
const depthFyInput   = document.getElementById("depthFyInput");
const depthCxInput   = document.getElementById("depthCxInput");
const depthCyInput   = document.getElementById("depthCyInput");
const colorFxInput   = document.getElementById("colorFxInput");
const colorFyInput   = document.getElementById("colorFyInput");
const colorCxInput   = document.getElementById("colorCxInput");
const colorCyInput   = document.getElementById("colorCyInput");
const intrinsicsBtn   = document.getElementById("intrinsicsUpdateBtn");

intrinsicsBtn.addEventListener("click", updateIntrinsics);