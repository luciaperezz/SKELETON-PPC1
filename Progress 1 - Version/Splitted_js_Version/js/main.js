"use strict";

/**
 * Application entry point: load MoveNet models and wire up UI.
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

  // Initialize IMU-related functions
  initImuCharts();
  setupCsvUpload();
  setupSyncButtons();

  // Default: start in upload mode when index.html is opened
  selectMode("upload");

}

// Start the app
main().catch((err) => {
  console.error(err);
  setStatus("Error during initialization. See console for details.");
});
