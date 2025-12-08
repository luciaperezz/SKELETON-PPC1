"use strict";

/**
 * IMU / CSV state and plotting logic
 */

// Chart.js instances
let imuCharts = {};

// Parsed CSV rows
let csvData = null;

// Time axis in seconds for each sample
let csvTimesSeconds = [];

// Global offset: dataTime = videoTime + syncOffset
let syncOffset = 0;

// Marked times for sync alignment
let videoMarkedTime = null;
let dataMarkedTime = null;

// Slider listener reference (so we can re-bind cleanly)
let dataSliderListener = null;

// Throttling of IMU updates in render loop
const IMU_UPDATE_THROTTLE_MS = 33;
let lastImuUpdateTime = 0;

/**
 * Initialize three IMU charts: accelerometer, gyroscope, magnetometer
 */
function initImuCharts() {
  if (!window.Chart) return;

  const colors = ["#ff5252", "#00e676", "#40c4ff"];
  const axes = ["X", "Y", "Z"];
  const sensorTypes = [
    { id: "chartAcc", title: "Accelerometer (m/s²)" },
    { id: "chartGyro", title: "Gyroscope (°/s)" },
    { id: "chartMag", title: "Magnetometer (µT)" },
  ];

  sensorTypes.forEach((sensor) => {
    const canvasEl = document.getElementById(sensor.id);
    if (!canvasEl) return;

    // Destroy existing chart if any
    const existing = imuCharts[sensor.id];
    if (existing) {
      existing.destroy();
    }

    const chartCtx = canvasEl.getContext("2d");

    imuCharts[sensor.id] = new Chart(chartCtx, {
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
        interaction: {
          mode: "nearest",
          intersect: false,
        },
        plugins: {
          legend: { display: true, position: "top" },
          tooltip: { enabled: false },
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
}

/**
 * Fill all charts with the complete dataset (no windowing).
 */
function updateImuChartsFull() {
  if (!csvData || !csvTimesSeconds.length) return;

  // Mapping of chart IDs to CSV column names
  const sensors = {
    chartAcc: ["ax", "ay", "az"],
    chartGyro: ["gx", "gy", "gz"],
    chartMag: ["mx", "my", "mz"],
  };

  const maxTime = csvTimesSeconds[csvTimesSeconds.length - 1];

  Object.entries(sensors).forEach(([chartId, keys]) => {
    const chart = imuCharts[chartId];
    if (!chart) return;

    keys.forEach((key, i) => {
      chart.data.datasets[i].data = csvData.map((row, idx) => ({
        x: csvTimesSeconds[idx],
        y: row[key] ?? 0,
      }));
    });

    chart.options.scales.x.min = 0;
    chart.options.scales.x.max = Math.max(5, maxTime);
    chart.update("none");
  });
}

/**
 * Update IMU charts for the given video time:
 * - Use a sliding window around the synced time (videoTime + syncOffset).
 */
function updateChartsForVideoTime(videoTime) {
  if (!csvData || !csvTimesSeconds.length) return;
  if (!imuCharts || !Object.keys(imuCharts).length) return;

  const adjustedTime = videoTime + syncOffset;
  const windowSize = 5;
  const startTime = Math.max(0, adjustedTime - windowSize / 2);
  const endTime = adjustedTime + windowSize / 2;

  const sensors = {
    chartAcc: ["ax", "ay", "az"],
    chartGyro: ["gx", "gy", "gz"],
    chartMag: ["mx", "my", "mz"],
  };

  Object.entries(sensors).forEach(([chartId, keys]) => {
    const chart = imuCharts[chartId];
    if (!chart) return;

    keys.forEach((key, i) => {
      const dataPoints = csvData.map((row, idx) => ({
        x: csvTimesSeconds[idx],
        y: row[key] ?? 0,
      }));
      chart.data.datasets[i].data = dataPoints;
    });

    chart.options.scales.x.min = startTime;
    chart.options.scales.x.max = endTime;
    chart.update("none");
  });

  // Position vertical markers inside each chart
  const markerPercent = (adjustedTime - startTime) / (endTime - startTime);
  const markerPos = Math.min(Math.max(markerPercent * 100, 0), 100);

  ["marker0", "marker1", "marker2"].forEach((id) => {
    const marker = document.getElementById(id);
    if (!marker) return;
    marker.style.display = "block";
    marker.style.left = `${markerPos}%`;
  });

  if (dataTimeDisplay) {
    dataTimeDisplay.textContent = formatTime(adjustedTime);
  }
}

/**
 * Set up the slider to scrub through the data timeline.
 */
function setupDataTimelineSlider() {
  if (!dataTimelineSlider) return;

  if (dataSliderListener) {
    dataTimelineSlider.removeEventListener("input", dataSliderListener);
  }

  dataSliderListener = (e) => {
    const time = parseFloat(e.target.value);
    if (!Number.isFinite(time) || !csvTimesSeconds.length) return;

    const foundIndex = csvTimesSeconds.findIndex((t) => t >= time);
    const idx =
      foundIndex === -1 ? csvTimesSeconds.length - 1 : Math.max(foundIndex, 0);

    dataMarkedTime = csvTimesSeconds[idx];
    updateChartsForVideoTime(dataMarkedTime - syncOffset);

    if (dataTimeDisplay) {
      dataTimeDisplay.textContent = formatTime(dataMarkedTime);
    }
  };

  dataTimelineSlider.addEventListener("input", dataSliderListener);
}

/**
 * CSV upload handling: parse file and populate charts.
 */
function setupCsvUpload() {
  if (!uploadCsvBtn || !csvInput) return;

  uploadCsvBtn.addEventListener("click", () => {
    csvInput.click();
  });

  csvInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
      if (!lines.length) return;

      const headers = lines[0].split(",").map((h) => h.trim());
      csvData = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        const values = line.split(",");
        const row = {};
        headers.forEach((h, j) => {
          const v = parseFloat(values[j]);
          row[h] = Number.isFinite(v) ? v : 0;
        });
        csvData.push(row);
      }

      csvTimesSeconds = csvData.map((_, idx) => idx / SAMPLE_RATE_HZ);
      const totalTime =
        csvTimesSeconds.length > 0
          ? csvTimesSeconds[csvTimesSeconds.length - 1]
          : 0;

      if (dataTimelineSlider) {
        dataTimelineSlider.max = totalTime.toFixed(3);
        dataTimelineSlider.value = 0;
      }

      if (imuStatusEl) {
        imuStatusEl.textContent = `CSV loaded: ${csvData.length} samples, total ${totalTime.toFixed(
          2
        )} s`;
      }

      if (markDataBtn) {
        markDataBtn.disabled = false;
      }

      initImuCharts();
      updateImuChartsFull();
      setupDataTimelineSlider();
    };

    reader.readAsText(file);
  });
}

/**
 * Sync buttons (mark video time, mark data time, apply sync).
 */
function setupSyncButtons() {
  if (markVideoBtn) {
    markVideoBtn.addEventListener("click", () => {
      if (!video) return;
      videoMarkedTime = video.currentTime || 0;
      if (syncStatusEl) {
        syncStatusEl.textContent = `video mark: ${formatTime(videoMarkedTime)}`;
      }
      checkSyncReady();
    });
  }

  if (markDataBtn) {
    markDataBtn.addEventListener("click", () => {
      if (!csvData || !csvTimesSeconds.length) return;
      if (dataMarkedTime == null) {
        dataMarkedTime = 0;
      }
      if (syncStatusEl) {
        const videoText =
          videoMarkedTime != null ? formatTime(videoMarkedTime) : "n/a";
        syncStatusEl.textContent = `video: ${videoText} → data: ${formatTime(
          dataMarkedTime
        )}`;
      }
      checkSyncReady();
    });
  }

  if (setSyncBtn) {
    setSyncBtn.addEventListener("click", () => {
      if (videoMarkedTime == null || dataMarkedTime == null) return;
      syncOffset = dataMarkedTime - videoMarkedTime;
      if (syncStatusEl) {
        syncStatusEl.textContent = `synced: offset ${syncOffset.toFixed(
          3
        )} s`;
      }
      videoMarkedTime = null;
      dataMarkedTime = null;
      setSyncBtn.disabled = true;
    });
  }
}

// Enable or disable "Apply sync" button depending on marks
function checkSyncReady() {
  if (!setSyncBtn) return;
  setSyncBtn.disabled = !(videoMarkedTime != null && dataMarkedTime != null);
}
