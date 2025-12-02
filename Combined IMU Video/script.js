"use strict";

/**
 * -----------------------------
 * Basic configuration constants
 * -----------------------------
 */

// For webcam constraints (not critical for detection, mainly for getUserMedia)
const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;

// Minimum keypoint confidence to draw body parts
const MIN_PART_CONFIDENCE = 0.2;

// For uploaded videos: only recompute pose on every Nth frame
// (helps performance)
const UPLOAD_FRAME_SKIP = 2;

// Flip settings for different modes.
// Set to true if your camera/video is mirrored (selfie/front camera).
const FLIP_HORIZONTAL_LIVE = true;    // Webcam / selfie
const FLIP_HORIZONTAL_UPLOAD = true;  // Smartphone selfie videos; set false if needed

// Simple skeleton definition using MoveNet keypoint names
const MOVENET_CONNECTED_KEYPOINTS = [
  ["nose", "left_eye"],
  ["nose", "right_eye"],
  ["left_eye", "left_ear"],
  ["right_eye", "right_ear"],
  ["nose", "left_shoulder"],
  ["nose", "right_shoulder"],
  ["left_shoulder", "right_shoulder"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["left_shoulder", "left_hip"],
  ["right_shoulder", "right_hip"],
  ["left_hip", "right_hip"],
  ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"],
  ["right_hip", "right_knee"],
  ["right_knee", "right_ankle"],
];

/**
 * -----------------------------
 * DOM references (video / UI)
 * -----------------------------
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

// IMU / CSV UI elements
const imuPanel = document.getElementById("imu-panel");
const uploadCsvBtn = document.getElementById("uploadCsvBtn");
const csvInput = document.getElementById("csvInput");
const imuStatusEl = document.getElementById("imu-status");
const syncStatusEl = document.getElementById("syncStatus");
const dataTimelineSlider = document.getElementById("dataTimelineSlider");
const dataTimeDisplay = document.getElementById("dataTimeDisplay");
const markVideoBtn = document.getElementById("markVideoBtn");
const markDataBtn = document.getElementById("markDataBtn");
const setSyncBtn = document.getElementById("setSyncBtn");

/**
 * Runtime state (MoveNet)
 * We use two detectors:
 *  - liveDetector   : MoveNet Lightning
 *  - uploadDetector : MoveNet Thunder 
 */

let liveDetector = null;
let uploadDetector = null;
let detector = null; // currently active detector

let currentMode = "live"; // "live" | "upload"
let isRunning = false;
let animationId = null;
let cameraStream = null;
let videoFileUrl = null;
let uploadedVideoReady = false;

// Frame index and last pose to enable frame skipping in upload mode
let frameIndex = 0;
let lastPose = null;

/**
 * Runtime state (IMU / CSV)
 */

// Chart.js instances (acc, gyro, mag)
let imuCharts = {};
// Parsed CSV data, one row per sample
let csvData = null;
// Time axis in seconds for each sample
let csvTimesSeconds = [];
// Global time offset between video and CSV data
let syncOffset = 0;
// Markers for sync
let videoMarkedTime = null;
let dataMarkedTime = null;
// Assumed IMU sample rate [Hz]; adjust to your device
const SAMPLE_RATE_HZ = 104;
// Slider event listener, to allow re-binding
let dataSliderListener = null;
// Throttle IMU plot updates for smoother performance
let lastImuUpdateTime = 0;
const IMU_UPDATE_THROTTLE_MS = 33;

/**
 * Small helper functions
 */

// Update the plain text status shown in the top right
function setStatus(text) {
  statusEl.textContent = text;
}

// Enable or disable Start / Stop buttons depending on running state
function setButtonsRunning(running) {
  isRunning = running;
  startBtn.disabled = running;
  stopBtn.disabled = !running;
}

// Format time in seconds as mm:ss.xx
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${m}:${s.toString().padStart(2, "0")}.${ms
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Video / camera setup
 */

// Initialize the webcam stream and attach it to the <video> element
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

// Synchronize canvas and container resolution to the actual video dimensions
function syncVideoAndCanvasSize() {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;

  video.width = w;
  video.height = h;
  canvas.width = w;
  canvas.height = h;

  // Update container aspect ratio to match the actual video ratio
  const container = document.getElementById("container");
  if (container) {
    container.style.aspectRatio = `${w} / ${h}`;
  }
}

/**
 * MoveNet drawing helpers
 */

// Draw all keypoints as circles
function drawKeypoints(keypoints) {
  keypoints.forEach((kp) => {
    const score = kp.score ?? 0;
    if (score < 0.02) return;

    const x = kp.x;
    const y = kp.y;

    ctx.beginPath();
    ctx.arc(x, y, 5, 0, 2 * Math.PI);
    ctx.fillStyle =
      score >= MIN_PART_CONFIDENCE
        ? "#2196F3"
        : "rgba(33, 150, 243, 0.3)";
    ctx.fill();
  });
}

// Draw a simple skeleton by connecting pairs of keypoints by name
function drawSkeleton(keypoints) {
  const byName = {};
  keypoints.forEach((kp) => {
    if (kp.name) {
      byName[kp.name] = kp;
    }
  });

  MOVENET_CONNECTED_KEYPOINTS.forEach(([a, b]) => {
    const kp1 = byName[a];
    const kp2 = byName[b];
    if (!kp1 || !kp2) return;

    const s1 = kp1.score ?? 0;
    const s2 = kp2.score ?? 0;
    if (s1 < MIN_PART_CONFIDENCE || s2 < MIN_PART_CONFIDENCE) return;

    ctx.beginPath();
    ctx.moveTo(kp1.x, kp1.y);
    ctx.lineTo(kp2.x, kp2.y);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#FF4081";
    ctx.stroke();
  });
}

/**
 * IMU / CSV: Chart initialization
 */

// Initialize three IMU charts (accelerometer, gyroscope, magnetometer)
function initImuCharts() {
  if (!window.Chart) return;

  const colors = ["#ff5252", "#00e676", "#40c4ff"];
  const axes = ["X", "Y", "Z"];
  const sensorTypes = [
    { id: "chartAcc", title: "Accelerometer (m/s²)" },
    { id: "chartGyro", title: "Gyroscope (°/s)" },
    { id: "chartMag", title: "Magnetometer (µT)" },
  ];

  sensorTypes.forEach((sensor) => {
    const canvasEl = document.getElementById(sensor.id);
    if (!canvasEl) return;

    // Destroy old chart if it exists
    const existing = imuCharts[sensor.id];
    if (existing) {
      existing.destroy();
    }

    const chartCtx = canvasEl.getContext("2d");

    imuCharts[sensor.id] = new Chart(chartCtx, {
      type: "line",
      data: {
        labels: [],
        datasets: axes.map((axisLabel, i) => ({
          label: axisLabel,
          data: [],
          borderColor: colors[i],
          backgroundColor: "transparent",
          fill: false,
          tension: 0,
          borderWidth: 1,
          pointRadius: 0,
          pointHoverRadius: 0,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        normalized: true,
        animation: false,
        interaction: {
          mode: "nearest",
          intersect: false,
        },
        plugins: {
          legend: { display: true, position: "top" },
          tooltip: { enabled: false },
        },
        scales: {
          y: { beginAtZero: false, type: "linear" },
          x: {
            type: "linear",
            title: { display: true, text: "Time (s)" },
            min: 0,
            max: 5,
          },
        },
      },
    });
  });
}

// Fill the charts with the full dataset (no windowing yet)
function updateImuChartsFull() {
  if (!csvData || !csvTimesSeconds.length) return;

  // Expected CSV columns for each sensor
  const sensors = {
    chartAcc: ["ax", "ay", "az"],
    chartGyro: ["gx", "gy", "gz"],
    chartMag: ["mx", "my", "mz"],
  };

  const maxTime = csvTimesSeconds[csvTimesSeconds.length - 1];

  Object.entries(sensors).forEach(([chartId, keys]) => {
    const chart = imuCharts[chartId];
    if (!chart) return;

    keys.forEach((key, i) => {
      chart.data.datasets[i].data = csvData.map((row, idx) => ({
        x: csvTimesSeconds[idx],
        y: row[key] ?? 0,
      }));
    });

    chart.options.scales.x.min = 0;
    chart.options.scales.x.max = Math.max(5, maxTime);
    chart.update("none");
  });
}

// Update charts for a given video time (with sync offset), showing a 5s window
function updateChartsForVideoTime(videoTime) {
  if (!csvData || !csvTimesSeconds.length) return;
  if (!imuCharts || !Object.keys(imuCharts).length) return;

  const adjustedTime = videoTime + syncOffset;
  const windowSize = 5;
  const startTime = Math.max(0, adjustedTime - windowSize / 2);
  const endTime = adjustedTime + windowSize / 2;

  // Same mapping between chart ID and column names as above
  const sensors = {
    chartAcc: ["ax", "ay", "az"],
    chartGyro: ["gx", "gy", "gz"],
    chartMag: ["mx", "my", "mz"],
  };

  Object.entries(sensors).forEach(([chartId, keys]) => {
    const chart = imuCharts[chartId];
    if (!chart) return;

    keys.forEach((key, i) => {
      const dataPoints = csvData.map((row, idx) => ({
        x: csvTimesSeconds[idx],
        y: row[key] ?? 0,
      }));
      chart.data.datasets[i].data = dataPoints;
    });

    chart.options.scales.x.min = startTime;
    chart.options.scales.x.max = endTime;
    chart.update("none");
  });

  // Move the vertical markers to the correct position in each chart
  const markerPercent = (adjustedTime - startTime) / (endTime - startTime);
  const markerPos = Math.min(Math.max(markerPercent * 100, 0), 100);

  ["marker0", "marker1", "marker2"].forEach((id) => {
    const marker = document.getElementById(id);
    if (!marker) return;
    marker.style.display = "block";
    marker.style.left = `${markerPos}%`;
  });

  if (dataTimeDisplay) {
    dataTimeDisplay.textContent = formatTime(adjustedTime);
  }
}

/**
 * IMU / CSV: slider + upload + sync buttons
 */

// Set up the slider to move along the CSV time axis
function setupDataTimelineSlider() {
  if (!dataTimelineSlider) return;

  // Remove previous listener to avoid multiple bindings
  if (dataSliderListener) {
    dataTimelineSlider.removeEventListener("input", dataSliderListener);
  }

  dataSliderListener = (e) => {
    const time = parseFloat(e.target.value);
    if (!Number.isFinite(time) || !csvTimesSeconds.length) return;

    // Find the closest sample index at or after the chosen slider time
    const foundIndex = csvTimesSeconds.findIndex((t) => t >= time);
    const idx =
      foundIndex === -1 ? csvTimesSeconds.length - 1 : Math.max(foundIndex, 0);

    dataMarkedTime = csvTimesSeconds[idx];
    updateChartsForVideoTime(dataMarkedTime - syncOffset);

    if (dataTimeDisplay) {
      dataTimeDisplay.textContent = formatTime(dataMarkedTime);
    }
  };

  dataTimelineSlider.addEventListener("input", dataSliderListener);
}

// Handle CSV upload and parsing
function setupCsvUpload() {
  if (!uploadCsvBtn || !csvInput) return;

  uploadCsvBtn.addEventListener("click", () => {
    csvInput.click();
  });

  csvInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
      if (!lines.length) return;

      // First line is assumed to be header row
      const headers = lines[0].split(",").map((h) => h.trim());
      csvData = [];

      // Parse each subsequent line as a numeric row
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        const values = line.split(",");
        const row = {};
        headers.forEach((h, j) => {
          const v = parseFloat(values[j]);
          row[h] = Number.isFinite(v) ? v : 0;
        });
        csvData.push(row);
      }

      // Time axis based on fixed sample rate
      csvTimesSeconds = csvData.map((_, idx) => idx / SAMPLE_RATE_HZ);
      const totalTime =
        csvTimesSeconds.length > 0
          ? csvTimesSeconds[csvTimesSeconds.length - 1]
          : 0;

      if (dataTimelineSlider) {
        dataTimelineSlider.max = totalTime.toFixed(3);
        dataTimelineSlider.value = 0;
      }

      if (imuStatusEl) {
        imuStatusEl.textContent = `CSV loaded: ${csvData.length} samples, total ${totalTime.toFixed(
          2
        )} s`;
      }

      if (markDataBtn) {
        markDataBtn.disabled = false;
      }

      initImuCharts();
      updateImuChartsFull();
      setupDataTimelineSlider();
    };

    reader.readAsText(file);
  });
}

// Set up buttons for marking sync points (video time, data time)
function setupSyncButtons() {
  if (markVideoBtn) {
    markVideoBtn.addEventListener("click", () => {
      if (!video) return;
      videoMarkedTime = video.currentTime || 0;
      if (syncStatusEl) {
        syncStatusEl.textContent = `video mark: ${formatTime(videoMarkedTime)}`;
      }
      checkSyncReady();
    });
  }

  if (markDataBtn) {
    markDataBtn.addEventListener("click", () => {
      if (!csvData || !csvTimesSeconds.length) return;
      if (dataMarkedTime == null) {
        // Default to t = 0 if slider has not yet been moved
        dataMarkedTime = 0;
      }
      if (syncStatusEl) {
        const videoText =
          videoMarkedTime != null ? formatTime(videoMarkedTime) : "n/a";
        syncStatusEl.textContent = `video: ${videoText} → data: ${formatTime(
          dataMarkedTime
        )}`;
      }
      checkSyncReady();
    });
  }

  if (setSyncBtn) {
    setSyncBtn.addEventListener("click", () => {
      if (videoMarkedTime == null || dataMarkedTime == null) return;
      // Data time = video time + offset => offset = data - video
      syncOffset = dataMarkedTime - videoMarkedTime;
      if (syncStatusEl) {
        syncStatusEl.textContent = `synced: offset ${syncOffset.toFixed(
          3
        )} s`;
      }
      videoMarkedTime = null;
      dataMarkedTime = null;
      setSyncBtn.disabled = true;
    });
  }
}

// Enable "Apply sync" only when both marks are set
function checkSyncReady() {
  if (!setSyncBtn) return;
  setSyncBtn.disabled = !(videoMarkedTime != null && dataMarkedTime != null);
}

/**
 * Render loop with MoveNet
 */

// Main loop: called repeatedly via requestAnimationFrame
async function renderFrame() {
  if (!isRunning) return;

  // Ensure enough video data is available
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

  // If we are in upload mode and video ended, stop
  if (currentMode === "upload" && video.ended) {
    stopTracking();
    return;
  }

  frameIndex++;

  const flipHorizontal =
    currentMode === "live"
      ? FLIP_HORIZONTAL_LIVE
      : FLIP_HORIZONTAL_UPLOAD;

  let poseToDraw = lastPose;

  // Upload mode: update pose only every N frames (frame skipping)
  if (currentMode === "upload") {
    const shouldUpdatePose = frameIndex % UPLOAD_FRAME_SKIP === 0 || !lastPose;
    if (shouldUpdatePose) {
      const poses = await detector.estimatePoses(video, {
        maxPoses: 1,
        flipHorizontal,
      });
      lastPose = poses[0] || null;
      poseToDraw = lastPose;
    }
  } else {
    // Live mode: estimate pose on every frame (Lightning is fast enough)
    const poses = await detector.estimatePoses(video, {
      maxPoses: 1,
      flipHorizontal,
    });
    lastPose = poses[0] || null;
    poseToDraw = lastPose;
  }

  if (!poseToDraw) {
    animationId = requestAnimationFrame(renderFrame);
    return;
  }

  const pose = poseToDraw;
  const keypoints = pose.keypoints || [];

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Overlay: mode + average keypoint score
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(10, 10, 360, 60);
  ctx.fillStyle = "white";
  ctx.font = "14px system-ui, sans-serif";

  const modeLabel =
    currentMode === "live"
      ? "Mode: Live (MoveNet Lightning)"
      : "Mode: Upload (MoveNet Thunder)";

  const poseScore =
    keypoints.length > 0
      ? keypoints.reduce((s, kp) => s + (kp.score ?? 0), 0) /
        keypoints.length
      : 0;

  ctx.fillText(modeLabel, 20, 32);
  ctx.fillText(`Pose score (avg): ${poseScore.toFixed(2)}`, 20, 52);

  // Highlight nose if confidence is high
  const nose = keypoints.find(
    (kp) => kp.name === "nose" && (kp.score ?? 0) > 0.5
  );
  if (nose) {
    ctx.beginPath();
    ctx.arc(nose.x, nose.y, 5, 0, 2 * Math.PI);
    ctx.fillStyle = "yellow";
    ctx.fill();
  }

  // Draw points and skeleton
  drawKeypoints(keypoints);
  drawSkeleton(keypoints);

  // Update IMU charts to follow the current video time (upload mode only)
  if (
    currentMode === "upload" &&
    csvData &&
    csvTimesSeconds.length &&
    imuPanel &&
    imuPanel.style.display !== "none"
  ) {
    const now = performance.now();
    if (now - lastImuUpdateTime > IMU_UPDATE_THROTTLE_MS) {
      updateChartsForVideoTime(video.currentTime || 0);
      lastImuUpdateTime = now;
    }
  }

  // Schedule next frame
  animationId = requestAnimationFrame(renderFrame);
}

/**
 * Start / stop handling
 */

// Start tracking in the current mode
async function handleStart() {
  if (isRunning) return;

  if (currentMode === "live") {
    detector = liveDetector;
    if (!detector) {
      setStatus("Live MoveNet model is still loading…");
      return;
    }

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

    video.playbackRate = 1.0;
  } else {
    detector = uploadDetector;
    if (!detector) {
      setStatus("Upload MoveNet model is still loading…");
      return;
    }

    if (!uploadedVideoReady) {
      setStatus("Please select a video first.");
      return;
    }

    // Slightly slower playback, so detection can keep up more easily
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
      ? "Live MoveNet tracking is running…"
      : "Video tracking with MoveNet…"
  );
  animationId = requestAnimationFrame(renderFrame);
}

// Stop tracking and pause video in upload mode
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

/**
 * Mode switching (live / upload)
 */

function selectMode(mode) {
  if (mode === currentMode) return;

  // Stop tracking when switching modes
  if (isRunning) {
    stopTracking();
  }

  currentMode = mode;

  modeLiveBtn.classList.toggle("active", mode === "live");
  modeUploadBtn.classList.toggle("active", mode === "upload");

  // Show or hide upload controls & IMU panel
  uploadControls.style.display = mode === "upload" ? "block" : "none";
  if (imuPanel) {
    imuPanel.style.display = mode === "upload" ? "block" : "none";
  }

  frameIndex = 0;
  lastPose = null;

  if (mode === "live") {
    // Leaving upload mode: release object URL and reset video
    if (videoFileUrl) {
      URL.revokeObjectURL(videoFileUrl);
      videoFileUrl = null;
    }
    uploadedVideoReady = false;
    video.src = "";
    video.srcObject = null;
    if (imuStatusEl) {
      imuStatusEl.textContent = "No CSV loaded";
    }
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

/**
 * Video upload handling
 */

// Handle file selection for uploaded videos
function handleFileChange() {
  const file = fileInput.files[0];
  if (!file) return;

  // Revoke previous object URL if it exists
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

/**
 * Main initialization
 */

async function main() {
  // Ensure the video is allowed to autoplay as muted
  video.muted = true;

  setStatus("Initializing TensorFlow.js…");
  await tf.ready();

  setStatus("Loading MoveNet models…");

  // Create both detectors in parallel:
  //  - Lightning: fast model for live webcam
  //  - Thunder  : more accurate model for offline video analysis
  const [live, upload] = await Promise.all([
    poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
    }),
    poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
    }),
  ]);

  liveDetector = live;
  uploadDetector = upload;
  detector = liveDetector;

  setStatus(
    "MoveNet models loaded. Live mode is active. Click Start or switch to Upload."
  );

  // Attach UI event handlers
  modeLiveBtn.addEventListener("click", () => selectMode("live"));
  modeUploadBtn.addEventListener("click", () => selectMode("upload"));
  startBtn.addEventListener("click", () => {
    handleStart();
  });
  stopBtn.addEventListener("click", () => {
    stopTracking();
  });
  fileInput.addEventListener("change", handleFileChange);

  // Initialize IMU / CSV functions
  initImuCharts();
  setupCsvUpload();
  setupSyncButtons();
}

// Start everything
main().catch((err) => {
  console.error(err);
  setStatus("Error during initialization. See console for details.");
});
