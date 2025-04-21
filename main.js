// --- CONFIGURATION ---
const LIVEKIT_URL = "wss://web-streamer-0zwqzelt.livekit.cloud";
const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ2aWRlbyI6eyJyb29tIjoidGVzdF9yb29tIiwicm9vbUpvaW4iOnRydWUsImNhblB1Ymxpc2giOmZhbHNlLCJjYW5TdWJzY3JpYmUiOnRydWV9LCJpYXQiOjE3NDM3MTAzNzgsIm5iZiI6MTc0MzcxMDM3OCwiZXhwIjoxNzQzNzMxOTc4LCJpc3MiOiJBUEl4ZWo4ZWU4d0dhaDciLCJzdWIiOiJzdWJzY3JpYmVyX3VzZXIiLCJqdGkiOiJzdWJzY3JpYmVyX3VzZXIifQ._BnEE1Tth-4Mt7TsjkYs4-yATEBcVDnAfA4aXQmI5hA";
import { LIVEKIT_URL, TOKEN } from "./config.js";
// FRAME DIMENSIONS: 
// The video frame contains a 1280x720 color image on top,
// and the lower portion (720 to 1296 in Y) is the packed depth data.
const FRAME_WIDTH = 1280, FRAME_HEIGHT = 1296;
const COLOR_HEIGHT = 720;  // top part for color image
const LOBITS_Y_START = 720, LOBITS_Y_END = 1008;
const HIBITS_Y_START = 1008, HIBITS_Y_END = 1296;
const UNPACKED_WIDTH = 640, UNPACKED_HEIGHT = 576;
const depthScale = 1 / 1000;
let frameIndex = 0;

// --- Camera Intrinsics --- 
// (Assuming these "depth" intrinsics were used in your original web code)
const depthFx = 504.0308, depthFy = 504.0801;
const depthCx = 323.6529, depthCy = 315.9445;
// Use your exported color camera intrinsics:
const colorFx = 604.7008, colorFy = 604.5446;
const colorCx = 641.4414, colorCy = 365.8837;

// --- Global Variables ---
let groundLevel = 0;
let environmentPoints = null;

// --- THREE.JS SETUP ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1, 1);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById("pointCloudContainer").appendChild(renderer.domElement);

// OrbitControls: restrict vertical rotation so the environment isn’t flipped.
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minPolarAngle = 0.3; // prevents extreme tilt
controls.maxPolarAngle = Math.PI / 2; // no views below horizontal
controls.enablePan = false; // keeps the environment centered

// Optional WASD movement:
const moveSpeed = 0.005;
const keys = {};
window.addEventListener("keydown", (event) => { keys[event.code] = true; });
window.addEventListener("keyup", (event) => { keys[event.code] = false; });
const clock = new THREE.Clock();

// Create an empty point cloud for the live stream.
const numPoints = UNPACKED_WIDTH * UNPACKED_HEIGHT;
const positions = new Float32Array(numPoints * 3);
// Create a colors array to hold the per-vertex colors.
const colors = new Float32Array(numPoints * 3);

const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

// Use vertex colors in the material.
const material = new THREE.PointsMaterial({
  size: 0.0001,
  vertexColors: true,
  depthTest: false,
  depthWrite: false,
  transparent: false,
  blending: THREE.NoBlending
});
const pointCloud = new THREE.Points(geometry, material);
// Flip both the Y and Z axes for correct orientation.
pointCloud.scale.set(1, -1, -1);

// Group the live stream point cloud for slider positioning.
const liveStreamGroup = new THREE.Group();
liveStreamGroup.add(pointCloud);
// Apply default scaling for the stream.
liveStreamGroup.scale.set(0.5, 0.5, 0.5);
// Force the live stream to render after the environment.
liveStreamGroup.renderOrder = 10;
scene.add(liveStreamGroup);

// --- VIDEO AND OFFSCREEN CANVAS SETUP ---
const videoElement = document.getElementById("videoElement");
const offscreenCanvas = document.createElement("canvas");
offscreenCanvas.width = FRAME_WIDTH;
offscreenCanvas.height = FRAME_HEIGHT;
const offscreenCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true });

// Helper: Unpack the two halves of the packed depth image.
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

// --- FRAME PROCESSING ---
function processFrame() {
  // Draw the full frame from the video.
  offscreenCtx.drawImage(videoElement, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);

  // Extract the color image data (top region: 0 to 720).
  const colorImgData = offscreenCtx.getImageData(0, 0, FRAME_WIDTH, COLOR_HEIGHT);

  // Extract depth image parts.
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

  // Loop over every point in the unpacked depth image.
  for (let i = 0; i < numPoints; i++) {
    const msb = hibitsUnpacked.data[i];
    const lsb = lobitsUnpacked.data[i];
    const depth16 = (msb << 8) | lsb;
    const z = depth16 * depthScale;

    // Compute pixel coordinates in the depth image.
    const u_depth = i % UNPACKED_WIDTH;
    const v_depth = Math.floor(i / UNPACKED_WIDTH);

    // Reconstruct the 3D point in the depth camera space.
    const x_depth = ((u_depth - depthCx) * z) / depthFx;
    const y_depth = ((v_depth - depthCy) * z) / depthFy;

    // For now, assume the extrinsics from depth->color are identity.
    const x_color = x_depth;
    const y_color = y_depth;
    const z_color = z;

    // Project the 3D point into the color image using the color intrinsics.
    // (Note: division by z_color; ensure z is not zero.)
    let u_color = 0, v_color = 0;
    if (z_color > 0) {
      u_color = Math.round((x_color * colorFx / z_color) + colorCx);
      v_color = Math.round((y_color * colorFy / z_color) + colorCy);
    }

    // Write the 3D position to the positions array.
    positions[i * 3] = x_depth;
    positions[i * 3 + 1] = y_depth;
    positions[i * 3 + 2] = z;

    // Look up the color from the color image.
    // Check that the coordinates are within bounds.
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

// --- ANIMATE LOOP ---
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  // Optional WASD movement:
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

  // Clamp camera's Y position so it never goes below the ground.
  if (camera.position.y < groundLevel) {
    camera.position.y = groundLevel;
  }

  // Update the environment shader uniform with current camera position.
  if (environmentPoints) {
    environmentPoints.material.uniforms.uCameraPos.value.copy(camera.position);
  }

  controls.update();
  renderer.render(scene, camera);
}
animate();

// --- LiveKit Connection ---
async function connectLiveKit() {
  const room = new LivekitClient.Room({ autoSubscribe: true });
  await room.connect(LIVEKIT_URL, TOKEN);
  console.log("Connected to room:", room.name);

  room.on(LivekitClient.RoomEvent.TrackSubscribed, (track, publication) => {
    if (track.kind === LivekitClient.Track.Kind.Video) {
      console.log("Video track subscribed:", publication.sid);
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
connectLiveKit().catch(err => console.error("LiveKit connection error:", err));

// --- Environment Model Upload Handling with Custom Shader ---
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

      // Create a temporary Points object (without rotation) to compute the bounding box.
      const tempPoints = new THREE.Points(xyzGeometry);
      const bbox = new THREE.Box3().setFromObject(tempPoints);
      const center = new THREE.Vector3();
      bbox.getCenter(center);

      console.log('Bounding Box:', bbox);
      console.log('Center:', center);

      // Custom ShaderMaterial for the environment.
      // Note: We add an "opacity" uniform to allow semi-transparency.
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
      // Rotate the model so its floor is at the bottom.
      points.rotation.x = -Math.PI / 2;
      // Make the material double-sided so you can view the interior.
      points.material.side = THREE.DoubleSide;
      // (You can adjust the opacity in the shader uniform "opacity" above.)
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

// --- Slider Controls for Live Stream Positioning, Rotation, and Scale ---
// Position X
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

// Position Y
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

// Position Z
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

// Rotation
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

// Scale
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

// --- Window Resize Handling ---
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});