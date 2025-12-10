"use strict";

/**
 * Global configuration and shared DOM references.
 *
 * This file defines:
 *  - Video + pose detection configuration
 *  - Slider / button / label references
 *  - Small helper utilities (status + time formatting)
 */

// Basic video constraints (for getUserMedia)
const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;

// Pose keypoint thresholds
const MIN_PART_CONFIDENCE = 0.2;

// Frame skipping for uploaded videos (performance tweak)
const UPLOAD_FRAME_SKIP = 2;

// Flip settings (set false if your videos are not mirrored)
const FLIP_HORIZONTAL_LIVE = true;
const FLIP_HORIZONTAL_UPLOAD = true;

// IMU sample rate in Hz (adjust to your sensor)
const SAMPLE_RATE_HZ = 104;

/** ---------- DOM references: video, canvas, buttons, status, IMU controls ---------- */

// Video + canvas (MoveNet draws only on the canvas)
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Mode buttons
const modeLiveBtn = document.getElementById("mode-live");
const modeUploadBtn = document.getElementById("mode-upload");

// Upload controls + buttons
const uploadControls = document.getElementById("upload-controls");
const fileInput = document.getElementById("video-file-input");
const startBtn = document.getElementById("btn-start");
const stopBtn = document.getElementById("btn-stop");
const clearBtn = document.getElementById("btn-clear");
const statusEl = document.getElementById("status");

// IMU / CSV controls
const imuPanel = document.getElementById("imu-panel");
const uploadCsvBtn = document.getElementById("uploadCsvBtn");
const csvInput = document.getElementById("csvInput");
const imuStatusEl = document.getElementById("imu-status");
const syncStatusEl = document.getElementById("syncStatus");
const dataTimelineSlider = document.getElementById("dataTimelineSlider");
const dataTimeDisplay = document.getElementById("dataTimeDisplay");

// Video timeline slider
const videoTimelineSlider = document.getElementById("videoTimelineSlider");
const videoTimeDisplay = document.getElementById("videoTimeDisplay");
const videoStepDisplay = document.getElementById("videoStepDisplay");

// Sync buttons (video ↔ IMU data)
const markVideoBtn = document.getElementById("markVideoBtn");
const markDataBtn = document.getElementById("markDataBtn");
const setSyncBtn = document.getElementById("setSyncBtn");

// Timestamp & project controls (annotation UI)
const addTimestampBtn = document.getElementById("addTimestampBtn");
const timestampLabelInput = document.getElementById("timestampLabel");
const eventTypeSelect = document.getElementById("eventType");
const notesInput = document.getElementById("notesInput");
const timestampListEl = document.getElementById("timestampList");
const eventInfoEl = document.getElementById("eventInfo");
const eventLabelEl = document.getElementById("eventLabel");
const eventTimeEl = document.getElementById("eventTime");
const eventNotesEl = document.getElementById("eventNotes");
const exportProjectBtn = document.getElementById("exportProjectBtn");
const importProjectBtn = document.getElementById("importProjectBtn");
const generateReportBtn = document.getElementById("generateReportBtn");

/** ---------- Small helper utilities ---------- */

/**
 * Update status text in the top right corner.
 * This is used throughout the app for user feedback.
 */
function setStatus(text) {
  statusEl.textContent = text;
}

/**
 * Enable or disable Start/Stop buttons depending on tracking state.
 */
function setButtonsRunning(running) {
  startBtn.disabled = running;
  stopBtn.disabled = !running;
}

/**
 * Format seconds as "m:ss.xx".
 * Example: 65.123 → "1:05.12"
 */
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);

  return `${m}:${s.toString().padStart(2, "0")}.${ms
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Synchronize canvas and container resolution to the actual video dimensions.
 *
 * This keeps MoveNet's drawing in sync with the displayed video size.
 */
function syncVideoAndCanvasSize() {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;

  // Set internal resolution of the HTML elements
  video.width = w;
  video.height = h;
  canvas.width = w;
  canvas.height = h;

  // Update container aspect ratio to match the real video aspect ratio
  const container = document.getElementById("container");
  if (container) {
    container.style.aspectRatio = `${w} / ${h}`;
  }
}
