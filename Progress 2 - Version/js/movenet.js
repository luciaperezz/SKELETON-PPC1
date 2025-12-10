"use strict";

/**
 * MoveNet pose estimation and rendering logic.
 *
 * Responsibilities:
 *  - Configure MoveNet connections for skeleton lines.
 *  - Manage live vs. upload mode (different detectors).
 *  - Run the render loop: estimate pose, draw skeleton, update sliders.
 *  - Notify IMU charts about current video time.
 */

// Simple skeleton definition for MoveNet keypoint names
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

// Logical frame rate used for the “step index” display
const VIDEO_TIMESTEP_FPS = 30;

// Detectors for live and upload modes
let liveDetector = null;
let uploadDetector = null;
let detector = null;

// Global state for tracking
let currentMode = "live"; // "live" | "upload"
let isRunning = false;
let animationId = null;

// Camera stream + uploaded file URL
let cameraStream = null;
let videoFileUrl = null;
let uploadedVideoReady = false;

// Frame skipping for upload mode (performance)
let frameIndex = 0;
let lastPose = null;

// Slider listener for the video timeline (upload mode)
let videoSliderListener = null;
let isScrubbingVideo = false;
let totalVideoSteps = 0;
let currentVideoStep = 0;

// Listener for video timeupdate (used to drive IMU charts when not tracking)
let videoTimeUpdateListener = null;

/**
 * Initialize and start camera stream (webcam).
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
 * Draw MoveNet keypoints as simple circles.
 */
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

/**
 * Draw a skeleton by connecting pairs of keypoints by name.
 */
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
 * Main render loop:
 *  - Ensure video is ready.
 *  - Estimate pose(s) with MoveNet.
 *  - Draw skeleton on canvas.
 *  - Update sliders and IMU charts.
 */
async function renderFrame() {
  if (!isRunning) return;

  // Ensure enough video data is ready
  if (video.readyState < 2) {
    animationId = requestAnimationFrame(renderFrame);
    return;
  }

  // Sync canvas size with actual video resolution
  if (
    canvas.width !== video.videoWidth ||
    canvas.height !== video.videoHeight
  ) {
    syncVideoAndCanvasSize();
  }

  // Stop video at the end in upload mode, but keep render loop running
  // so the slider + skeleton still represent the final frame.
  if (currentMode === "upload" && video.ended) {
    video.pause();
    // No early return here – we want to keep drawing.
  }

  frameIndex++;

  const flipHorizontal =
    currentMode === "live"
      ? FLIP_HORIZONTAL_LIVE
      : FLIP_HORIZONTAL_UPLOAD;

  let poseToDraw = lastPose;

  // Upload mode: use frame skipping for better performance
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
    // Live mode: estimate pose every frame (Lightning is fast)
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

  // Overlay: mode and average keypoint score
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

  // Example: highlight nose if confidence is high
  const nose = keypoints.find(
    (kp) => kp.name === "nose" && (kp.score ?? 0) > 0.5
  );
  if (nose) {
    ctx.beginPath();
    ctx.arc(nose.x, nose.y, 5, 0, 2 * Math.PI);
    ctx.fillStyle = "yellow";
    ctx.fill();
  }

  // Draw keypoints and skeleton
  drawKeypoints(keypoints);
  drawSkeleton(keypoints);

  // Update video timeline slider + timestep label for upload mode
  if (currentMode === "upload" && videoTimelineSlider && !isScrubbingVideo) {
    const t = video.currentTime || 0;
    videoTimelineSlider.value = t;

    if (videoTimeDisplay) {
      videoTimeDisplay.textContent = formatTime(t);
    }

    // Step index is an artificial "frame counter" at VIDEO_TIMESTEP_FPS
    const stepIndex = Math.max(0, Math.round(t * VIDEO_TIMESTEP_FPS));
    currentVideoStep =
      totalVideoSteps > 0
        ? Math.min(stepIndex, totalVideoSteps)
        : stepIndex;

    if (videoStepDisplay) {
      videoStepDisplay.textContent =
        totalVideoSteps > 0
          ? `${currentVideoStep} / ${totalVideoSteps}`
          : String(currentVideoStep);
    }
  }

  // Update IMU charts to follow video time (upload mode only)
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

  // Next frame
  animationId = requestAnimationFrame(renderFrame);
}

/**
 * Start tracking in the currently selected mode.
 * - In live mode, open the camera and run Lightning.
 * - In upload mode, play the selected video and run Thunder.
 */
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

    // Slightly slower playback for better performance
    video.playbackRate = 0.75;

    if (video.paused || video.currentTime === 0) {
      try {
        await video.play();
      } catch (_) {
        // Ignore play errors (autoplay restrictions etc.)
      }
    }
  }

  // Reset frame-based state
  frameIndex = 0;
  lastPose = null;

  isRunning = true;
  setButtonsRunning(true);
  setStatus(
    currentMode === "live"
      ? "Live MoveNet tracking is running…"
      : "Video tracking with MoveNet…"
  );
  animationId = requestAnimationFrame(renderFrame);
}

/**
 * Stop tracking and pause video if needed.
 */
function stopTracking() {
  if (!isRunning) return;

  isRunning = false;
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
 * Switch between "live" (camera) and "upload" (video file) modes.
 * This will:
 *  - Stop current tracking
 *  - Free resources for the previous mode
 *  - Prepare UI for the new mode
 */
function selectMode(mode) {
  if (mode === currentMode) return;

  // Always stop tracking when changing mode
  if (isRunning) {
    stopTracking();
  }

  currentMode = mode;

  modeLiveBtn.classList.toggle("active", mode === "live");
  modeUploadBtn.classList.toggle("active", mode === "upload");

  // Show/hide upload controls and IMU panel
  uploadControls.style.display = mode === "upload" ? "block" : "none";
  if (imuPanel) {
    imuPanel.style.display = mode === "upload" ? "block" : "none";
  }

  // Reset pose-related state
  frameIndex = 0;
  lastPose = null;

  // Enable/disable sync + timestamp buttons depending on mode
  if (mode === "upload") {
    if (csvData && csvTimesSeconds.length && markDataBtn) {
      markDataBtn.disabled = false;
    }
    // addTimestampBtn / markVideoBtn are enabled once a video is loaded
  } else {
    if (markVideoBtn) markVideoBtn.disabled = true;
    if (markDataBtn) markDataBtn.disabled = true;
    if (setSyncBtn) setSyncBtn.disabled = true;
    if (addTimestampBtn) addTimestampBtn.disabled = true;
  }

  if (mode === "live") {
    // Leaving upload mode: free video URL and reset video element
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
    // Leaving live mode: stop camera stream
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
 * Setup the video timeline slider for the currently loaded upload video.
 * Lets you scrub through time while keeping the skeleton overlay active.
 * Also computes a logical "timestep index" based on VIDEO_TIMESTEP_FPS.
 */
function setupVideoTimelineSlider() {
  if (!videoTimelineSlider) return;

  // Remove previous listener if we re-load a new video
  if (videoSliderListener) {
    videoTimelineSlider.removeEventListener("input", videoSliderListener);
  }

  const duration = video.duration || 0;

  videoTimelineSlider.min = 0;
  videoTimelineSlider.max = duration;
  // Fine-grained time slider; timesteps are calculated separately via FPS
  videoTimelineSlider.step = duration > 0 ? duration / 500 : 0.01;
  videoTimelineSlider.value = 0;

  // Timesteps based on estimated FPS
  totalVideoSteps =
    duration > 0 ? Math.max(1, Math.round(duration * VIDEO_TIMESTEP_FPS)) : 0;
  currentVideoStep = 0;

  if (videoTimeDisplay) {
    videoTimeDisplay.textContent = formatTime(0);
  }
  if (videoStepDisplay) {
    videoStepDisplay.textContent =
      totalVideoSteps > 0 ? `0 / ${totalVideoSteps}` : "0 / 0";
  }

  // User drags the slider → jump to that time in the video
  videoSliderListener = (e) => {
    if (!uploadedVideoReady) return;

    const t = parseFloat(e.target.value);
    if (!Number.isFinite(t)) return;

    isScrubbingVideo = true;
    video.currentTime = t;

    if (videoTimeDisplay) {
      videoTimeDisplay.textContent = formatTime(t);
    }

    // Update logical timestep index based on time
    const stepIndex = Math.max(0, Math.round(t * VIDEO_TIMESTEP_FPS));
    currentVideoStep =
      totalVideoSteps > 0
        ? Math.min(stepIndex, totalVideoSteps)
        : stepIndex;

    if (videoStepDisplay) {
      videoStepDisplay.textContent =
        totalVideoSteps > 0
          ? `${currentVideoStep} / ${totalVideoSteps}`
          : String(currentVideoStep);
    }

    // renderFrame() keeps running and will estimate pose at this time
    isScrubbingVideo = false;
  };

  videoTimelineSlider.addEventListener("input", videoSliderListener);
}

/**
 * Handle video file selection for upload mode.
 */
function handleFileChange() {
  const file = fileInput.files[0];
  if (!file) return;

  // Clean up old object URL if any
  if (videoFileUrl) {
    URL.revokeObjectURL(videoFileUrl);
  }

  // Remove previous timeupdate listener if any
  if (videoTimeUpdateListener) {
    video.removeEventListener("timeupdate", videoTimeUpdateListener);
    videoTimeUpdateListener = null;
  }

  videoFileUrl = URL.createObjectURL(file);
  video.srcObject = null;
  video.src = videoFileUrl;
  video.muted = true;
  uploadedVideoReady = false;

  video.onloadedmetadata = () => {
    // Match canvas size to uploaded video
    syncVideoAndCanvasSize();
    uploadedVideoReady = true;
    setupVideoTimelineSlider();
    setStatus(`Video loaded: ${file.name}. Click Start to begin.`);

    // Enable timestamp + mark video buttons
    if (addTimestampBtn) {
      addTimestampBtn.disabled = false;
    }
    if (markVideoBtn) {
      markVideoBtn.disabled = false;
    }

    // Inform IMU module about this video file (for project storage)
    if (typeof setCurrentVideoFileInfo === "function") {
      setCurrentVideoFileInfo(file);
    }

    // Load any stored project (syncOffset + timestamps) for this video
    if (typeof loadProjectFromLocal === "function") {
      loadProjectFromLocal();
    }

    // timeupdate: update slider & IMU charts even when MoveNet is stopped
    videoTimeUpdateListener = () => {
      if (!csvData || !csvTimesSeconds.length) {
        // We also still keep the slider in sync
        if (videoTimelineSlider && !isScrubbingVideo) {
          const t = video.currentTime || 0;
          videoTimelineSlider.value = t;
          if (videoTimeDisplay) {
            videoTimeDisplay.textContent = formatTime(t);
          }
        }
        return;
      }

      // Avoid double updates if render loop is already updating
      if (isRunning) return;

      const t = video.currentTime || 0;

      if (videoTimelineSlider && !isScrubbingVideo) {
        videoTimelineSlider.value = t;
        if (videoTimeDisplay) {
          videoTimeDisplay.textContent = formatTime(t);
        }
      }

      updateChartsForVideoTime(t);
    };

    video.addEventListener("timeupdate", videoTimeUpdateListener);
  };
}
