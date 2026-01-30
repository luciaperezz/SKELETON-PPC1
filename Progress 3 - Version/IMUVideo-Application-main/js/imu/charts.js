"use strict";

/**
 * Chart rendering + windowing (video time -> data time).
 * Depends on:
 *  - window.IMU_STATE (state)
 *  - window.Chart (Chart.js)
 *  - window.formatTime (helper)
 *  - UI globals: marker0/1/2, dataTimeDisplay
 */
(() => {
  const IMU = (window.IMU = window.IMU || {});
  const S = window.IMU_STATE;

  /**
   * Initialize three IMU charts: accelerometer, gyroscope, magnetometer.
   * Each chart has three lines: X, Y, Z.
   */
  IMU.initImuCharts = function initImuCharts() {
    if (!window.Chart) return;

    const colors = ["#ff5252", "#00e676", "#40c4ff"];
    const axes = ["X", "Y", "Z"];

    const sensorTypes = [
      { id: "chartAcc",  title: "Accelerometer (m/s²)" },
      { id: "chartGyro", title: "Gyroscope (°/s)" },
      { id: "chartMag",  title: "Magnetometer (µT)" },
    ];

    sensorTypes.forEach((sensor) => {
      const canvasEl = document.getElementById(sensor.id);
      if (!canvasEl) return;

      // Destroy existing chart if any (e.g. when reloading a CSV)
      const existing = S.imuCharts[sensor.id];
      if (existing) existing.destroy();

      const chartCtx = canvasEl.getContext("2d");

      S.imuCharts[sensor.id] = new Chart(chartCtx, {
        type: "line",
        data: {
          labels: [],
          datasets: axes.map((axisLabel, i) => ({
            label: axisLabel,
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
            legend: { display: false },
            tooltip: { enabled: false }, // keep UI simple
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
  };

  /**
   * Fill all charts with the complete dataset (no windowing).
   * Called when a CSV is first loaded.
   */
  IMU.updateImuChartsFull = function updateImuChartsFull() {
    if (!S.csvData || !S.csvTimesSeconds.length) return;

    const sensors = {
      chartAcc:  ["ax", "ay", "az"],
      chartGyro: ["gx", "gy", "gz"],
      chartMag:  ["mx", "my", "mz"],
    };

    const maxTime = S.csvTimesSeconds[S.csvTimesSeconds.length - 1];

    Object.entries(sensors).forEach(([chartId, keys]) => {
      const chart = S.imuCharts[chartId];
      if (!chart) return;

      keys.forEach((key, i) => {
        chart.data.datasets[i].data = S.csvData.map((row, idx) => ({
          x: S.csvTimesSeconds[idx],
          y: row[key] ?? 0,
        }));
      });

      chart.options.scales.x.min = 0;
      chart.options.scales.x.max = Math.max(5, maxTime);
      chart.update("none");
    });
  };

  /**
   * Update charts for the given video time:
   *  - adjustedTime = videoTime - syncOffset
   *  - show a 5-second window centered around adjustedTime
   *  - move the vertical green marker lines
   */
  function updateChartsForTimeSeconds(timeSeconds) {
    if (!S.csvData || !S.csvTimesSeconds.length) return;
    if (!S.imuCharts || !Object.keys(S.imuCharts).length) return;

    const windowSize = 5;
    const startTime = Math.max(0, timeSeconds - windowSize / 2);
    const endTime = timeSeconds + windowSize / 2;

    ["chartAcc", "chartGyro", "chartMag"].forEach((chartId) => {
      const chart = S.imuCharts[chartId];
      if (!chart) return;

      chart.options.scales.x.min = startTime;
      chart.options.scales.x.max = endTime;
      chart.update("none");
    });

    // Marker position as percent inside the visible window
    const markerPercent = (timeSeconds - startTime) / (endTime - startTime);
    const markerPos = Math.min(Math.max(markerPercent * 100, 0), 100);

    ["marker0", "marker1", "marker2"].forEach((id) => {
      const marker = document.getElementById(id);
      if (!marker) return;
      marker.style.display = "block";
      marker.style.left = `${markerPos}%`;
    });

    // Optional: update UI time label
    if (window.dataTimeDisplay && typeof window.formatTime === "function") {
      window.dataTimeDisplay.textContent = window.formatTime(timeSeconds);
    }
  }

  /**
   * Update charts for the given IMU DATA time (seconds).
   * This is the independent IMU playhead (what the IMU slider controls).
   */
  IMU.updateChartsForDataTime = function updateChartsForDataTime(dataTimeSeconds) {
    updateChartsForTimeSeconds(dataTimeSeconds);
  };

  /**
   * Update charts for the given VIDEO time (seconds).
   * Only used when you explicitly want the IMU view to follow the video.
   */
  IMU.updateChartsForVideoTime = function updateChartsForVideoTime(videoTimeSeconds) {
    const adjustedTime = (videoTimeSeconds || 0) - (S.syncOffset || 0);
    updateChartsForTimeSeconds(adjustedTime);
  };
})();
