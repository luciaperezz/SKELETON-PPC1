"use strict";

/**
 * App entry point + global reset logic.
 *
 * This file:
 *  - Defines clearAll(): reset everything back to initial state.
 *  - Loads TensorFlow.js + MoveNet detectors.
 *  - Wires up all UI event listeners.
 */

/**
 * Reset the entire application state:
 *  - Stop tracking and camera.
 *  - Clear video + object URLs.
 *  - Reset sliders, IMU state, timestamp state, and status texts.
 */
function clearAll() {
  // 1) Stop pose tracking if it is running
  if (typeof stopTracking === "function") {
    stopTracking();
  }

  // 2) Stop camera stream (if live mode was active)
  if (typeof cameraStream !== "undefined" && cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }

  // 3) Reset video source (uploaded or live)
  if (typeof videoTimeUpdateListener !== "undefined" && videoTimeUpdateListener) {
    video.removeEventListener("timeupdate", videoTimeUpdateListener);
    videoTimeUpdateListener = null;
  }

  if (typeof videoFileUrl !== "undefined" && videoFileUrl) {
    URL.revokeObjectURL(videoFileUrl);
    videoFileUrl = null;
  }

  if (typeof video !== "undefined" && video) {
    video.pause();
    video.srcObject = null;
    video.src = "";
    video.currentTime = 0;
  }

  if (typeof uploadedVideoReady !== "undefined") {
    uploadedVideoReady = false;
  }

  // Clear video file input
  if (typeof fileInput !== "undefined" && fileInput) {
    fileInput.value = "";
  }

  // 4) Reset video slider + time/step labels
  if (typeof videoTimelineSlider !== "undefined" && videoTimelineSlider) {
    videoTimelineSlider.min = 0;
    videoTimelineSlider.max = 0;
    videoTimelineSlider.value = 0;
  }

  if (typeof videoTimeDisplay !== "undefined" && videoTimeDisplay) {
    videoTimeDisplay.textContent = "0:00.00";
  }

  if (typeof videoStepDisplay !== "undefined" && videoStepDisplay) {
    videoStepDisplay.textContent = "0 / 0";
  }

  if (typeof totalVideoSteps !== "undefined") {
    totalVideoSteps = 0;
  }

  if (typeof currentVideoStep !== "undefined") {
    currentVideoStep = 0;
  }

  if (typeof frameIndex !== "undefined") {
    frameIndex = 0;
  }

  if (typeof lastPose !== "undefined") {
    lastPose = null;
  }

  // Clear skeleton canvas
  if (typeof ctx !== "undefined" && typeof canvas !== "undefined") {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // 5) Reset IMU / CSV state
  if (typeof csvInput !== "undefined" && csvInput) {
    csvInput.value = "";
  }

  if (typeof csvData !== "undefined") {
    csvData = null;
  }

  if (typeof csvTimesSeconds !== "undefined") {
    csvTimesSeconds = [];
  }

  if (typeof syncOffset !== "undefined") {
    syncOffset = 0;
  }

  if (typeof videoMarkedTime !== "undefined") {
    videoMarkedTime = null;
  }

  if (typeof dataMarkedTime !== "undefined") {
    dataMarkedTime = null;
  }

  // Destroy any existing IMU charts
  if (typeof imuCharts !== "undefined" && imuCharts) {
    Object.values(imuCharts).forEach((chart) => {
      if (chart && typeof chart.destroy === "function") {
        chart.destroy();
      }
    });
    imuCharts = {};
  }

  // Reset IMU slider + label
  if (typeof dataTimelineSlider !== "undefined" && dataTimelineSlider) {
    dataTimelineSlider.min = 0;
    dataTimelineSlider.max = 0;
    dataTimelineSlider.value = 0;
  }

  if (typeof dataTimeDisplay !== "undefined" && dataTimeDisplay) {
    dataTimeDisplay.textContent = "0:00.00";
  }

  // Hide chart markers
  ["marker0", "marker1", "marker2"].forEach((id) => {
    const marker = document.getElementById(id);
    if (marker) {
      marker.style.display = "none";
    }
  });

  // Disable sync + timestamp buttons
  if (typeof markVideoBtn !== "undefined" && markVideoBtn) {
    markVideoBtn.disabled = true;
  }
  if (typeof markDataBtn !== "undefined" && markDataBtn) {
    markDataBtn.disabled = true;
  }
  if (typeof setSyncBtn !== "undefined" && setSyncBtn) {
    setSyncBtn.disabled = true;
  }
  if (typeof addTimestampBtn !== "undefined" && addTimestampBtn) {
    addTimestampBtn.disabled = true;
  }

  // Reset IMU status texts
  if (typeof imuStatusEl !== "undefined" && imuStatusEl) {
    imuStatusEl.textContent = "No CSV loaded";
  }

  if (typeof syncStatusEl !== "undefined" && syncStatusEl) {
    syncStatusEl.textContent = "sync offset: 0s";
    syncStatusEl.classList.remove("synced");
  }

  // Reset timestamp UI
  if (typeof resetTimestamps === "function") {
    resetTimestamps();
  }

  // Final user feedback
  if (typeof setStatus === "function") {
    setStatus("Cleared. Select a video and/or CSV to start.");
  }
}

/**
 * Application entry point: load MoveNet models and wire up UI.
 *
 * Steps:
 *  1. Wait for TensorFlow.js to be ready.
 *  2. Load two MoveNet detectors (Lightning for live, Thunder for upload).
 *  3. Attach all UI event listeners (buttons, file inputs, etc).
 *  4. Initialize IMU charts and CSV/sync handling.
 *  5. Default to "upload" mode.
 */
async function main() {
  // Allow video autoplay in some browsers
  video.muted = true;

  setStatus("Initializing TensorFlow.js…");
  await tf.ready();

  setStatus("Loading MoveNet models (Lightning & Thunder)…");

  // Create two detectors:
  //  - Lightning: fast model for live webcam
  //  - Thunder  : more accurate model for offline video
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

  // Attach UI event listeners
  modeLiveBtn.addEventListener("click", () => selectMode("live"));
  modeUploadBtn.addEventListener("click", () => selectMode("upload"));

  startBtn.addEventListener("click", () => handleStart());
  stopBtn.addEventListener("click", () => stopTracking());
  fileInput.addEventListener("change", handleFileChange);

  if (clearBtn) {
    clearBtn.addEventListener("click", clearAll);
  }

  // Initialize IMU-related functionality
  initImuCharts();
  setupCsvUpload();
  setupSyncButtons();

  // Timestamp / project UI
  if (typeof initTimestampUI === "function") {
    initTimestampUI();
  }

  // Default: start in upload mode when index.html is opened
  selectMode("upload");
}

// Start the app immediately
main().catch((err) => {
  console.error(err);
  setStatus("Error during initialization. See console for details.");
});
