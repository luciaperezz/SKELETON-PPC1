"use strict";

/**
 * Sync buttons: mark video time, mark data time, apply sync offset.
 * Depends on:
 *  - window.IMU_STATE
 *  - UI globals: video, markVideoBtn, markDataBtn, setSyncBtn, syncStatusEl
 *  - window.formatTime (helper)
 *  - window.IMU.saveProjectToLocal (project persistence)
 */
(() => {
  const IMU = (window.IMU = window.IMU || {});
  const S = window.IMU_STATE;

  function checkSyncReady() {
    if (!window.setSyncBtn) return;
    window.setSyncBtn.disabled = !(S.videoMarkedTime != null && S.dataMarkedTime != null);
  }

  IMU.setupSyncButtons = function setupSyncButtons() {
    // 1) Mark current video time
    if (window.markVideoBtn) {
      window.markVideoBtn.addEventListener("click", () => {
        if (!window.video) return;
        S.videoMarkedTime = window.video.currentTime || 0;

        if (window.syncStatusEl && typeof window.formatTime === "function") {
          window.syncStatusEl.textContent = `video mark: ${window.formatTime(S.videoMarkedTime)}`;
          window.syncStatusEl.classList.remove("synced");
        }

        checkSyncReady();
      });
    }

    // 2) Mark current data time (from slider)
    if (window.markDataBtn) {
      window.markDataBtn.addEventListener("click", () => {
        if (!S.csvData || !S.csvTimesSeconds.length) return;
        if (S.dataMarkedTime == null) S.dataMarkedTime = 0;

        if (window.syncStatusEl && typeof window.formatTime === "function") {
          const videoText = S.videoMarkedTime != null ? window.formatTime(S.videoMarkedTime) : "n/a";
          window.syncStatusEl.textContent = `video: ${videoText} → data: ${window.formatTime(S.dataMarkedTime)}`;
          window.syncStatusEl.classList.remove("synced");
        }

        checkSyncReady();
      });
    }

    // 3) Compute and apply syncOffset
    if (window.setSyncBtn) {
      window.setSyncBtn.addEventListener("click", () => {
        if (S.videoMarkedTime == null || S.dataMarkedTime == null) return;

        // We want: dataTime = videoTime - syncOffset
        S.syncOffset = S.videoMarkedTime - S.dataMarkedTime;

        if (window.syncStatusEl) {
          window.syncStatusEl.textContent = `synced: offset ${S.syncOffset.toFixed(3)} s`;
          window.syncStatusEl.classList.add("synced");
        }

        // Clear marks until next alignment
        S.videoMarkedTime = null;
        S.dataMarkedTime = null;
        window.setSyncBtn.disabled = true;

        if (typeof IMU.saveProjectToLocal === "function") IMU.saveProjectToLocal();
      });
    }
  };

  // Keep this name for compatibility if your other files call it
  IMU.checkSyncReady = checkSyncReady;
})();
