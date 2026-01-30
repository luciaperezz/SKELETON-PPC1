"use strict";

/**
 * CSV upload + data timeline slider.
 * Depends on:
 *  - window.IMU_STATE
 *  - window.IMU.initImuCharts / updateImuChartsFull / updateChartsForVideoTime
 *  - UI globals:
 *      * uploadCsvBtn
 *      * csvInput
 *      * dataTimelineSlider
 *      * imuStatusEl,
 *      * markDataBtn
 *      * dataTimeDisplay
 *  - window.SAMPLE_RATE_HZ
 */
(() => {
  const IMU = (window.IMU = window.IMU || {});
  const S = window.IMU_STATE;

  /**
   * Slider scrubbing through data timeline.
   * Moving the slider sets dataMarkedTime and updates the charts.
   */
  IMU.setupDataTimelineSlider = function setupDataTimelineSlider() {
    if (!window.dataTimelineSlider) return;

    // Remove previous listener if we reconfigure the slider (e.g. new CSV)
    if (S.dataSliderListener) {
      window.dataTimelineSlider.removeEventListener("input", S.dataSliderListener);
    }

    S.dataSliderListener = (e) => {
      const time = parseFloat(e.target.value);
      if (!Number.isFinite(time) || !S.csvTimesSeconds.length) return;

      // Find first IMU sample whose timestamp is >= selected time
      const foundIndex = S.csvTimesSeconds.findIndex((t) => t >= time);
      const idx = foundIndex === -1 ? S.csvTimesSeconds.length - 1 : Math.max(foundIndex, 0);

      S.dataMarkedTime = S.csvTimesSeconds[idx];

      // Independent IMU timeline: moving the IMU slider updates charts
      // based on DATA time (not video time).
      if (typeof IMU.updateChartsForDataTime === "function") {
        IMU.updateChartsForDataTime(S.dataMarkedTime);
      }

      if (window.dataTimeDisplay && typeof window.formatTime === "function") {
        window.dataTimeDisplay.textContent = window.formatTime(S.dataMarkedTime);
      }
    };

    window.dataTimelineSlider.addEventListener("input", S.dataSliderListener);
  };

  /**
   * CSV upload: parse file and populate charts + timeline.
   */
  IMU.setupCsvUpload = function setupCsvUpload() {
    if (!window.uploadCsvBtn || !window.csvInput) return;

    // Open file dialog
    window.uploadCsvBtn.addEventListener("click", () => window.csvInput.click());

    // Parse CSV
    window.csvInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();

      reader.onload = (event) => {
        const text = event.target.result;

        // Non-empty lines
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
        if (!lines.length) return;

        const headers = lines[0].split(",").map((h) => h.trim());
        S.csvData = [];

        // Convert each row to a numeric object
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          if (!line.trim()) continue;

          const values = line.split(",");
          const row = {};

          headers.forEach((h, j) => {
            const v = parseFloat(values[j]);
            row[h] = Number.isFinite(v) ? v : 0;
          });

          S.csvData.push(row);
        }

        // Time axis from sample index
        const hz = window.SAMPLE_RATE_HZ || 1;
        S.csvTimesSeconds = S.csvData.map((_, idx) => idx / hz);

        const totalTime = S.csvTimesSeconds.length
          ? S.csvTimesSeconds[S.csvTimesSeconds.length - 1]
          : 0;

        // Slider bounds
        if (window.dataTimelineSlider) {
          window.dataTimelineSlider.max = totalTime.toFixed(3);
          window.dataTimelineSlider.value = 0;
        }

        // Status text
        if (window.imuStatusEl) {
          window.imuStatusEl.textContent =
            `CSV loaded: ${S.csvData.length} samples, total ${totalTime.toFixed(2)} s`;
        }

        // Once we have data, allow marking data time
        if (window.markDataBtn) window.markDataBtn.disabled = false;

        // Initialize charts + full data, then enable scrubbing
        IMU.initImuCharts();
        IMU.updateImuChartsFull();
        IMU.setupDataTimelineSlider();
      };

      reader.readAsText(file);
    });
  };
})();
