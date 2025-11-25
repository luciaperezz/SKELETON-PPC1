"use strict";

/**
 * Basic configuration
 */
const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;
const MIN_PART_CONFIDENCE = 0.2;

// For uploaded videos: only recompute pose on every Nth frame
const UPLOAD_FRAME_SKIP = 2;

/**
 * DOM references
 */
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const modeLiveBtn = document.getElementById("mode-live");
const modeUploadBtn = document.getElementById("mode-upload");
const uploadControls = document.getElementById("upload-controls");
const fileInput = document.getElementById("video-file-input");
const startBtn = document.getElementById("btn-start");
const stopBtn = document.getElementById("btn-stop");
const statusEl = document.getElementById("status");

/**
 * Runtime state
 * - liveNet: fast model for live camera
 * - uploadNet: more accurate model for uploaded videos
 * - net: currently active model (either liveNet or uploadNet)
 */
let liveNet = null;      // fast model for live mode
let uploadNet = null;    // more accurate model for upload mode
let net = null;          // model currently in use

let currentMode = "live"; // "live" | "upload"
let isRunning = false;
let animationId = null;
let cameraStream = null;
let videoFileUrl = null;
let uploadedVideoReady = false;

// Frame / pose caching for uploaded videos
let frameIndex = 0;
let lastPose = null;

/* ---------- UI helpers ---------- */

/**
 * Set the status text in the UI.
 */
function setStatus(text) {
  statusEl.textContent = text;
}

/**
 * Enable / disable start and stop buttons
 * based on whether tracking is running.
 */
function setButtonsRunning(running) {
  isRunning = running;
  startBtn.disabled = running;
  stopBtn.disabled = !running;
}

/* ---------- Camera / video handling ---------- */

/**
 * Initialize the camera stream and attach it to the <video>.
 */
async function setupCamera() {
  const hasMediaDevices = navigator.mediaDevices?.getUserMedia;
  if (!hasMediaDevices) {
    alert("Your browser does not support getUserMedia.");
    throw new Error("getUserMedia not supported");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
    audio: false,
  });

  cameraStream = stream;
  video.srcObject = stream;
  video.muted = true;

  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play();
      resolve();
    };
  });
}

/**
 * Make canvas and video resolution match the actual video stream.
 * This needs to be called once the video metadata is ready.
 */
function syncVideoAndCanvasSize() {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;

  video.width = w;
  video.height = h;
  canvas.width = w;
  canvas.height = h;
}

/* ---------- Drawing functions ---------- */

/**
 * Draw PoseNet keypoints as blue circles.
 * - High confidence keypoints: solid blue
 * - Low confidence keypoints: more transparent blue
 */
function drawKeypoints(keypoints) {
  keypoints.forEach((kp) => {
    // Very low confidence → skip completely
    if (kp.score < 0.02) return;

    const { x, y } = kp.position;

    ctx.beginPath();
    ctx.arc(x, y, 5, 0, 2 * Math.PI);
    // Points: blue / light blue
    ctx.fillStyle =
      kp.score >= MIN_PART_CONFIDENCE
        ? "#2196F3"                  // strong blue for confident points
        : "rgba(33, 150, 243, 0.3)"; // more transparent blue otherwise
    ctx.fill();
  });
}

/**
 * Draw the skeleton as pink lines connecting adjacent keypoints.
 */
function drawSkeleton(keypoints) {
  const adjacentKeyPoints = posenet.getAdjacentKeyPoints(
    keypoints,
    MIN_PART_CONFIDENCE
  );

  adjacentKeyPoints.forEach(([from, to]) => {
    ctx.beginPath();
    ctx.moveTo(from.position.x, from.position.y);
    ctx.lineTo(to.position.x, to.position.y);
    ctx.lineWidth = 3;
    // Lines: pink
    ctx.strokeStyle = "#FF4081";
    ctx.stroke();
  });
}

/* ---------- Render loop ---------- */

/**
 * Main render loop. Called on each animation frame while tracking is active.
 * - For live mode: estimate pose on every frame
 * - For upload mode: estimate pose only every Nth frame and reuse it in between
 */
async function renderFrame() {
  if (!isRunning) return;

  // Wait until the video has enough data
  if (video.readyState < 2) {
    animationId = requestAnimationFrame(renderFrame);
    return;
  }

  // Keep canvas size in sync with video
  if (
    canvas.width !== video.videoWidth ||
    canvas.height !== video.videoHeight
  ) {
    syncVideoAndCanvasSize();
  }

  // End of uploaded video → stop automatically
  if (currentMode === "upload" && video.ended) {
    stopTracking();
    return;
  }

  frameIndex++;

  let poseToDraw = lastPose;

  if (currentMode === "upload") {
    // Uploaded video: recalculate pose only every UPLOAD_FRAME_SKIP frames
    const shouldUpdatePose = frameIndex % UPLOAD_FRAME_SKIP === 0 || !lastPose;
    if (shouldUpdatePose) {
      lastPose = await net.estimateSinglePose(video, {
        flipHorizontal: false,
      });
      poseToDraw = lastPose;
    }
  } else {
    // Live mode: compute pose every frame (MobileNet is light enough)
    lastPose = await net.estimateSinglePose(video, {
      flipHorizontal: false,
    });
    poseToDraw = lastPose;
  }

  if (!poseToDraw) {
    animationId = requestAnimationFrame(renderFrame);
    return;
  }

  const pose = poseToDraw;

  // Clear canvas for this frame
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Small overlay with mode + pose score
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(10, 10, 310, 60);
  ctx.fillStyle = "white";
  ctx.font = "14px system-ui, sans-serif";

  const modeLabel =
    currentMode === "live"
      ? "Mode: Live (fast)"
      : "Mode: Upload (more accurate, slightly slower)";
  ctx.fillText(modeLabel, 20, 32);
  ctx.fillText(`Pose score: ${pose.score.toFixed(2)}`, 20, 52);

  // Optionally highlight the nose a bit
  const nose = pose.keypoints.find((kp) => kp.part === "nose");
  if (nose && nose.score > 0.5) {
    const { x, y } = nose.position;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, 2 * Math.PI);
    ctx.fillStyle = "yellow";
    ctx.fill();
  }

  // Draw skeleton on top
  drawKeypoints(pose.keypoints);
  drawSkeleton(pose.keypoints);

  // Schedule next frame
  animationId = requestAnimationFrame(renderFrame);
}

/* ---------- Start / Stop handling ---------- */

/**
 * Start tracking:
 * - chooses the correct model based on current mode
 * - initializes camera or video playback
 * - starts the render loop
 */
async function handleStart() {
  if (isRunning) return;

  if (currentMode === "live") {
    // Live mode: use the fast model
    net = liveNet;
    if (!net) {
      setStatus("Live model is still loading…");
      return;
    }

    // Start camera if needed
    try {
      if (!cameraStream) {
        setStatus("Initializing camera…");
        await setupCamera();
        syncVideoAndCanvasSize();
      }
    } catch (err) {
      console.error(err);
      setStatus("Camera could not be started.");
      return;
    }

    // Normal playback speed
    video.playbackRate = 1.0;
  } else {
    // Upload mode: use the more accurate model
    net = uploadNet;
    if (!net) {
      setStatus("Upload model is still loading…");
      return;
    }

    if (!uploadedVideoReady) {
      setStatus("Please select a video first.");
      return;
    }

    // Slightly slower playback so tracking can keep up better
    video.playbackRate = 0.75;

    if (video.paused || video.currentTime === 0) {
      try {
        await video.play();
      } catch (_) {
        // Ignore play errors (e.g. autoplay restrictions)
      }
    }
  }

  frameIndex = 0;
  lastPose = null;

  setButtonsRunning(true);
  setStatus(
    currentMode === "live"
      ? "Live tracking is running…"
      : "Video tracking is running (more accurate, slightly slower)…"
  );
  animationId = requestAnimationFrame(renderFrame);
}

/**
 * Stop tracking:
 * - stops animation frame loop
 * - pauses uploaded video (if in upload mode)
 */
function stopTracking() {
  if (!isRunning) return;
  setButtonsRunning(false);

  if (animationId != null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  if (currentMode === "upload") {
    video.pause();
  }

  setStatus("Tracking stopped.");
}

/* ---------- Mode switching ---------- */

/**
 * Switch between "live" and "upload" mode.
 * Cleans up the previous mode (camera stream or video URL).
 */
function selectMode(mode) {
  if (mode === currentMode) return;

  // Stop any running tracking
  if (isRunning) {
    stopTracking();
  }

  currentMode = mode;

  // Update active button styling
  modeLiveBtn.classList.toggle("active", mode === "live");
  modeUploadBtn.classList.toggle("active", mode === "upload");

  // Show or hide upload controls
  uploadControls.style.display = mode === "upload" ? "block" : "none";

  frameIndex = 0;
  lastPose = null;

  if (mode === "live") {
    // Leaving upload mode: release the object URL and reset video
    if (videoFileUrl) {
      URL.revokeObjectURL(videoFileUrl);
      videoFileUrl = null;
    }
    uploadedVideoReady = false;
    video.src = "";
    video.srcObject = null;
    setStatus("Live mode: click Start to use your camera.");
  } else {
    // Leaving live mode: stop the camera
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      cameraStream = null;
    }
    video.srcObject = null;
    video.src = "";
    uploadedVideoReady = false;
    setStatus("Upload mode: select a video and then click Start.");
  }
}

/* ---------- Video upload handling ---------- */

/**
 * Handle file input change:
 * - create an object URL from the selected file
 * - attach it to the video element
 * - wait for metadata to load, then mark the video as ready
 */
function handleFileChange() {
  const file = fileInput.files[0];
  if (!file) return;

  // Revoke previous URL if any
  if (videoFileUrl) {
    URL.revokeObjectURL(videoFileUrl);
  }

  videoFileUrl = URL.createObjectURL(file);
  video.srcObject = null;
  video.src = videoFileUrl;
  video.muted = true;
  uploadedVideoReady = false;

  video.onloadedmetadata = () => {
    syncVideoAndCanvasSize();
    uploadedVideoReady = true;
    setStatus(`Video loaded: ${file.name}. Click Start to begin.`);
  };
}

/* ---------- Initialization ---------- */

/**
 * Main entry point:
 * - wait for TensorFlow.js
 * - load both PoseNet models (live + upload)
 * - wire up all event listeners
 */
async function main() {
  video.muted = true;

  setStatus("Initializing…");
  await tf.ready();

  // Load both models in parallel
  setStatus("Loading live and upload models…");

  const [live, upload] = await Promise.all([
    // Live mode: MobileNet with smaller input resolution → very smooth
    posenet.load({
      architecture: "MobileNetV1",
      outputStride: 16,
      inputResolution: { width: 321, height: 321 },
      multiplier: 0.75,
      quantBytes: 2,
    }),
    // Upload mode: MobileNet with higher input resolution → more accurate
    posenet.load({
      architecture: "MobileNetV1",
      outputStride: 16,
      inputResolution: { width: 513, height: 513 },
      multiplier: 1.0,
      quantBytes: 2,
    }),
  ]);

  liveNet = live;
  uploadNet = upload;
  net = liveNet;

  setStatus(
    "Models loaded. Live mode is active. Click Start or switch to Upload."
  );

  // Hook up UI events
  modeLiveBtn.addEventListener("click", () => selectMode("live"));
  modeUploadBtn.addEventListener("click", () => selectMode("upload"));
  startBtn.addEventListener("click", () => {
    handleStart();
  });
  stopBtn.addEventListener("click", () => {
    stopTracking();
  });
  fileInput.addEventListener("change", handleFileChange);
}

// Start the app
main().catch((err) => {
  console.error(err);
  setStatus("Error during initialization. See console for details.");
});
