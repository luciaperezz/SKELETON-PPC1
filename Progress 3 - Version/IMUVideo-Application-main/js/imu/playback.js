"use strict";

/**
 * IMU playback controls (Play/Pause/Back/Forward + Speed).
 *
 * Requirements:
 *  - IMU controls affect only IMU data (the IMU timeline slider)
 *  - Video controls affect only the video
 *
 * Implementation:
 *  - The IMU playhead is the value of #dataTimelineSlider (seconds).
 *  - We update the slider and dispatch an "input" event so the existing slider
 *    listener (IMU.setupDataTimelineSlider) updates charts/markers/labels.
 */
(() => {
  const S = window.IMU_STATE;
  const IMU = (window.IMU = window.IMU || {});

  const $ = (id) => document.getElementById(id);

  const slider = $("dataTimelineSlider");
  const playPauseBtn = $("imuPlayPauseBtn");
  const backBtn = $("imuBackBtn");
  const forwardBtn = $("imuForwardBtn");
  const speedSelect = $("imuSpeedSelect");
  const playPauseIcon = $("imuPlayPauseIcon");
  const playPauseText = $("imuPlayPauseText");

  // If the IMU controls are not present in the current HTML, do nothing.
  if (!slider || !playPauseBtn || !backBtn || !forwardBtn || !speedSelect) return;

  let imuPlaying = false;
  let lastFrameTs = null;

  function setEnabled(enabled) {
    playPauseBtn.disabled = !enabled;
    backBtn.disabled = !enabled;
    forwardBtn.disabled = !enabled;
    speedSelect.disabled = !enabled;
  }

  function updatePlayPauseUI() {
    if (!playPauseIcon || !playPauseText) return;
    if (imuPlaying) {
      playPauseIcon.textContent = "⏸";
      playPauseText.textContent = "Pause";
    } else {
      playPauseIcon.textContent = "▶";
      playPauseText.textContent = "Play";
    }
  }

  function clampToSliderRange(value) {
    const min = parseFloat(slider.min || "0");
    const max = parseFloat(slider.max || "0");
    if (!Number.isFinite(min) || !Number.isFinite(max)) return value;
    return Math.min(Math.max(value, min), max);
  }

  function setSliderTimeSeconds(seconds) {
    const v = clampToSliderRange(seconds);
    slider.value = String(v);

    // Let the existing IMU slider handler update charts/markers.
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function getStepSeconds() {
    const step = parseFloat(slider.step || "0.01");
    // Make stepping usable even if slider.step is very small.
    return Math.max(0.25, Number.isFinite(step) ? step * 25 : 0.25);
  }

  function getMaxSeconds() {
    const max = parseFloat(slider.max || "0");
    return Number.isFinite(max) ? max : 0;
  }

  function tick(ts) {
    if (!imuPlaying) return;

    if (lastFrameTs == null) lastFrameTs = ts;
    const dt = (ts - lastFrameTs) / 1000;
    lastFrameTs = ts;

    const speed = parseFloat(speedSelect.value || "1");
    const playbackRate = Number.isFinite(speed) ? speed : 1;

    const cur = parseFloat(slider.value || "0");
    const curT = Number.isFinite(cur) ? cur : 0;
    const nextT = curT + dt * playbackRate;

    const maxT = getMaxSeconds();
    if (nextT >= maxT) {
      setSliderTimeSeconds(maxT);
      imuPlaying = false;
      lastFrameTs = null;
      updatePlayPauseUI();
      return;
    }

    setSliderTimeSeconds(nextT);
    requestAnimationFrame(tick);
  }

  function play() {
    const maxT = getMaxSeconds();
    if (!(maxT > 0)) return;

    imuPlaying = true;
    lastFrameTs = null;
    updatePlayPauseUI();
    requestAnimationFrame(tick);
  }

  function pause() {
    imuPlaying = false;
    lastFrameTs = null;
    updatePlayPauseUI();
  }

  function togglePlay() {
    imuPlaying ? pause() : play();
  }

  function refreshEnabledState() {
    const enabled = getMaxSeconds() > 0 && Array.isArray(S?.csvTimesSeconds) && S.csvTimesSeconds.length > 0;
    setEnabled(enabled);
    if (!enabled) pause();
  }

  // Enable after CSV load and after project import (which may set slider.max).
  const csvInput = $("csvInput");
  if (csvInput) {
    csvInput.addEventListener("change", () => setTimeout(refreshEnabledState, 0));
  }

  // Poll briefly on startup (import/project load may be async).
  let tries = 0;
  const t = setInterval(() => {
    tries += 1;
    refreshEnabledState();
    if (getMaxSeconds() > 0 || tries > 40) clearInterval(t);
  }, 100);

  // ----- Event handlers (stop bubbling so they can't affect video) -----
  playPauseBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    togglePlay();
  });

  backBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    pause();
    const cur = parseFloat(slider.value || "0");
    setSliderTimeSeconds((Number.isFinite(cur) ? cur : 0) - getStepSeconds());
  });

  forwardBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    pause();
    const cur = parseFloat(slider.value || "0");
    setSliderTimeSeconds((Number.isFinite(cur) ? cur : 0) + getStepSeconds());
  });

  // Prevent clicks on the select from bubbling into any global handlers.
  speedSelect.addEventListener("click", (e) => e.stopPropagation());
  speedSelect.addEventListener("change", (e) => e.stopPropagation());

  // If the user scrubs the IMU slider manually, stop IMU playback.
  slider.addEventListener("input", () => {
    if (imuPlaying) pause();
  });

  updatePlayPauseUI();
})();
