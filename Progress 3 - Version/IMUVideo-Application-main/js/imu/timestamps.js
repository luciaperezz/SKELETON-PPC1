"use strict";

/**
 * Timestamp UI (events list + click-to-jump).
 * Depends on:
 *  - window.IMU_STATE
 *  - UI globals: timestampListEl, video, eventLabelEl, eventTimeEl, eventNotesEl,
 *               eventInfoEl, addTimestampBtn, timestampLabelInput, eventTypeSelect,
 *               notesInput, exportProjectBtn, importProjectBtn, generateReportBtn
 *  - window.formatTime
 *  - window.IMU.saveProjectToLocal / updateChartsForVideoTime
 */
(() => {
  const IMU = (window.IMU = window.IMU || {});
  const S = window.IMU_STATE;

  IMU.renderTimestamps = function renderTimestamps() {
    if (!window.timestampListEl) return;

    if (!S.timestamps.length) {
      window.timestampListEl.innerHTML =
        '<div class="timestamp-empty">No timestamps yet.</div>';
      return;
    }

    window.timestampListEl.innerHTML = S.timestamps
      .map(
        (ts, idx) => `
        <div class="timestamp-item" data-index="${idx}">
          <span>${ts.label} @ ${window.formatTime(ts.time)} [${ts.eventType}]</span>
          <button type="button" data-delete="${idx}">×</button>
        </div>
      `
      )
      .join("");
  };

  function selectTimestamp(index) {
    const ts = S.timestamps[index];
    if (!ts) return;

    if (window.video) window.video.currentTime = ts.time;

    if (window.eventLabelEl) window.eventLabelEl.textContent = `Label: ${ts.label}`;
    if (window.eventTimeEl) window.eventTimeEl.textContent = `Time: ${window.formatTime(ts.time)}`;
    if (window.eventNotesEl) {
      window.eventNotesEl.textContent = ts.notes ? `Notes: ${ts.notes}` : "Notes: (none)";
    }
    if (window.eventInfoEl) window.eventInfoEl.style.display = "block";

    // IMPORTANT (separation requirement): selecting / jumping in the VIDEO
    // must not change the IMU playhead. Keep timelines independent.
  }

  function deleteTimestamp(index) {
    if (index < 0 || index >= S.timestamps.length) return;
    S.timestamps.splice(index, 1);
    IMU.renderTimestamps();
    if (typeof IMU.saveProjectToLocal === "function") IMU.saveProjectToLocal();
  }

  IMU.initTimestampUI = function initTimestampUI() {
    if (window.timestampListEl) {
      IMU.renderTimestamps();

      window.timestampListEl.addEventListener("click", (e) => {
        const deleteIndexAttr = e.target.getAttribute("data-delete");
        if (deleteIndexAttr != null) {
          e.stopPropagation();
          const idx = parseInt(deleteIndexAttr, 10);
          if (!Number.isNaN(idx)) deleteTimestamp(idx);
          return;
        }

        const item = e.target.closest(".timestamp-item");
        if (!item) return;

        const idx = parseInt(item.getAttribute("data-index"), 10);
        if (!Number.isNaN(idx)) selectTimestamp(idx);
      });
    }

    if (window.addTimestampBtn) {
      window.addTimestampBtn.addEventListener("click", () => {
        if (!window.video) return;

        const t = window.video.currentTime || 0;
        const rawLabel = window.timestampLabelInput ? window.timestampLabelInput.value.trim() : "";
        const label = rawLabel || window.formatTime(t);

        const eventType =
          window.eventTypeSelect && window.eventTypeSelect.value
            ? window.eventTypeSelect.value
            : "other";

        const notes = window.notesInput && window.notesInput.value ? window.notesInput.value.trim() : "";

        S.timestamps.push({ time: t, label, eventType, notes });

        if (window.timestampLabelInput) window.timestampLabelInput.value = "";
        if (window.notesInput) window.notesInput.value = "";

        IMU.renderTimestamps();
        if (typeof IMU.saveProjectToLocal === "function") IMU.saveProjectToLocal();
      });
    }

    if (window.exportProjectBtn) window.exportProjectBtn.addEventListener("click", IMU.exportProject);
    if (window.importProjectBtn) window.importProjectBtn.addEventListener("click", IMU.importProject);
    if (window.generateReportBtn) window.generateReportBtn.addEventListener("click", IMU.generateReport);
  };

  IMU.resetTimestamps = function resetTimestamps() {
    S.timestamps = [];

    if (window.timestampLabelInput) window.timestampLabelInput.value = "";
    if (window.notesInput) window.notesInput.value = "";
    if (window.eventInfoEl) window.eventInfoEl.style.display = "none";

    IMU.renderTimestamps();
  };
})();
