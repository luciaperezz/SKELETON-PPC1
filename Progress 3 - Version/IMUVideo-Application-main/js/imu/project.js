"use strict";

/**
 * Local project persistence (localStorage):
 * - syncOffset
 * - timestamps
 * - notes
 * - sampleRate
 *
 * Depends on:
 *  - window.IMU_STATE
 *  - UI globals: notesInput, syncStatusEl, video
 *  - window.SAMPLE_RATE_HZ, window.formatTime
 *  - window.IMU.renderTimestamps / updateChartsForVideoTime
 */
(() => {
  const IMU = (window.IMU = window.IMU || {});
  const S = window.IMU_STATE;

  IMU.setCurrentVideoFileInfo = function setCurrentVideoFileInfo(file) {
    if (file && file.name && typeof file.size === "number") {
      S.currentVideoFileInfo = { name: file.name, size: file.size };
    } else {
      S.currentVideoFileInfo = null;
    }
  };

  function getProjectStorageKey() {
    if (!S.currentVideoFileInfo) return null;
    return `project_${S.currentVideoFileInfo.name}_${S.currentVideoFileInfo.size}`;
  }

  IMU.saveProjectToLocal = function saveProjectToLocal(extra) {
    const key = getProjectStorageKey();
    if (!key) return;

    const projectData = {
      syncOffset: S.syncOffset,
      timestamps: S.timestamps,
      sampleRate: window.SAMPLE_RATE_HZ,
      createdAt: new Date().toISOString(),
      notes: window.notesInput ? window.notesInput.value || "" : "",
    };

    if (extra && typeof extra === "object") Object.assign(projectData, extra);

    try {
      localStorage.setItem(key, JSON.stringify(projectData));
    } catch (err) {
      console.warn("Could not save project to localStorage:", err);
    }
  };

  IMU.loadProjectFromLocal = function loadProjectFromLocal() {
    const key = getProjectStorageKey();
    if (!key) return;

    const saved = localStorage.getItem(key);
    if (!saved) return;

    try {
      const projectData = JSON.parse(saved);

      S.syncOffset = typeof projectData.syncOffset === "number" ? projectData.syncOffset : 0;
      S.timestamps = Array.isArray(projectData.timestamps) ? projectData.timestamps : [];

      if (window.notesInput) window.notesInput.value = projectData.notes || "";

      if (window.syncStatusEl) {
        window.syncStatusEl.textContent = `synced: offset ${S.syncOffset.toFixed(3)} s`;
        window.syncStatusEl.classList.add("synced");
      }

      if (typeof IMU.renderTimestamps === "function") IMU.renderTimestamps();

      // Separation requirement: loading a project must not force IMU view
      // to follow the video. Leave the IMU playhead as-is.
    } catch (err) {
      console.warn("Could not parse stored project data:", err);
    }
  };
})();
