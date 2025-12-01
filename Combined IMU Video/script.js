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
 * DOM references – PoseNet / Viewer
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
 * DOM references – IMU / CSV Sync
 */
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
 * Runtime state – PoseNet
 * - liveNet: fast model for live camera
 * - uploadNet: more accurate model for uploaded videos
 * - net: currently active model (either liveNet or uploadNet)
 */
let liveNet = null; // fast model for live mode
let uploadNet = null; // more accurate model for upload mode
let net = null; // model currently in use

let currentMode = "live"; // "live" | "upload"
let isRunning = false;
let animationId = null;
let cameraStream = null;
let videoFileUrl = null;
let uploadedVideoReady = false;

// Frame / pose caching for uploaded videos
let frameIndex = 0;
let lastPose = null;

/**
 * Runtime state – IMU / CSV
 */
let imuCharts = {}; // Chart.js instances
let csvData = null;
let csvTimesSeconds = [];
let syncOffset = 0;
let videoMarkedTime = null;
let dataMarkedTime = null;
const SAMPLE_RATE_HZ = 104;
let dataSliderListener = null;
let lastImuUpdateTime = 0;
const IMU_UPDATE_THROTTLE_MS = 33;

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

/**
 * Format seconds as m:ss.xx
 */
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${m}:${s.toString().padStart(2, "0")}.${ms
    .toString()
    .padStart(2, "0")}`;
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

  // interne Auflösung (für PoseNet)
  video.width = w;
  video.height = h;
  canvas.width = w;
  canvas.height = h;

  // Container-Seitenverhältnis an das Video anpassen
  const container = document.getElementById("container");
  if (container) {
    container.style.aspectRatio = `${w} / ${h}`;
  }
}


/* ---------- Drawing functions (PoseNet) ---------- */

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
        ? "#2196F3" // strong blue for confident points
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

/* ---------- IMU / CSV: Charts ---------- */

/**
 * Initialize / reset the three IMU charts if Chart.js is available.
 */
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

    const existing = imuCharts[sensor.id];
    if (existing) {
      existing.destroy();
    }

    const chartCtx = canvasEl.getContext("2d");

    imuCharts[sensor.id] = new Chart(chartCtx, {
      type: "line",
      data: {
        labels: [],
        datasets: axes.map((axis, i) => ({
          label: axis,
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
        interaction: { mode: "nearest", intersect: false },
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

/**
 * Plot the full dataset once (no moving window).
 */
function updateImuChartsFull() {
  if (!csvData || !csvTimesSeconds.length) return;

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

/**
 * Update the window / marker for a given video time.
 * (videoTime is in seconds, video timeline)
 */
function updateChartsForVideoTime(videoTime) {
  if (!csvData || !csvTimesSeconds.length) return;
  if (!imuCharts || !Object.keys(imuCharts).length) return;

  const adjustedTime = videoTime + syncOffset;
  const windowSize = 5;
  const startTime = Math.max(0, adjustedTime - windowSize / 2);
  const endTime = adjustedTime + windowSize / 2;

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

/* ---------- IMU / CSV: Interaction (Upload, slider, sync) ---------- */

/**
 * Setup the data slider to move inside the CSV time axis.
 */
function setupDataTimelineSlider() {
  if (!dataTimelineSlider) return;

  if (dataSliderListener) {
    dataTimelineSlider.removeEventListener("input", dataSliderListener);
  }

  dataSliderListener = (e) => {
    const time = parseFloat(e.target.value);
    if (!Number.isFinite(time) || !csvTimesSeconds.length) return;

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

/**
 * Handle CSV upload + parsing.
 * CSV expected to have columns ax, ay, az, gx, gy, gz, mx, my, mz.
 */
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

      const headers = lines[0].split(",").map((h) => h.trim());
      csvData = [];

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
        imuStatusEl.textContent = `CSV loaded: ${csvData.length} samples, ${totalTime.toFixed(
          2
        )}s total`;
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

/**
 * Enable the sync marking buttons for video and data.
 */
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
        // If slider hasn't been moved yet, use t = 0 as default
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
      syncOffset = dataMarkedTime - videoMarkedTime;
      if (syncStatusEl) {
        syncStatusEl.textContent = `synced: offset ${syncOffset.toFixed(3)}s`;
      }
      videoMarkedTime = null;
      dataMarkedTime = null;
      setSyncBtn.disabled = true;
    });
  }
}

function checkSyncReady() {
  if (!setSyncBtn) return;
  if (videoMarkedTime != null && dataMarkedTime != null) {
    setSyncBtn.disabled = false;
  }
}

/* ---------- Render loop ---------- */

/**
 * Main render loop. Called on each animation frame while tracking is active.
 * - For live mode: estimate pose on every frame
 * - For upload mode: estimate pose only every Nth frame and reuse it in between
 *   + optional IMU window update (if CSV loaded)
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

  // IMU window follow video time (only in upload mode, if CSV loaded)
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

  // Show or hide upload controls and IMU panel
  uploadControls.style.display = mode === "upload" ? "block" : "none";
  if (imuPanel) {
    imuPanel.style.display = mode === "upload" ? "block" : "none";
  }

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
 * - initialize IMU charts + CSV handling
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

  // IMU: charts, CSV upload, sync buttons
  initImuCharts();
  setupCsvUpload();
  setupSyncButtons();
}

// Start the app
main().catch((err) => {
  console.error(err);
  setStatus("Error during initialization. See console for details.");
});