"use strict";

/**
 * IMU / CSV state and plotting logic.
 *
 * Responsibilities:
 *  - Parse CSV files into an array of samples.
 *  - Initialize and update three Chart.js plots (acc / gyro / mag).
 *  - Provide a "window view" around the current synced time.
 *  - Handle sync between video time and IMU time via offset.
 *  - Manage timestamp annotations + project export/import/report.
 */

// Chart.js instances, keyed by canvas id (chartAcc / chartGyro / chartMag)
let imuCharts = {};

// Parsed CSV rows (array of objects: { ax, ay, az, gx, gy, gz, mx, my, mz, ... })
let csvData = null;

// Time axis in seconds for each sample (index / SAMPLE_RATE_HZ)
let csvTimesSeconds = [];

// Global offset: dataTime = videoTime + syncOffset
let syncOffset = 0;

// Marked times for sync alignment
let videoMarkedTime = null;
let dataMarkedTime = null;

// Slider listener reference (so we can re-bind cleanly)
let dataSliderListener = null;

// Throttling of IMU updates in render loop (upload mode)
const IMU_UPDATE_THROTTLE_MS = 33;
let lastImuUpdateTime = 0;

/**
 * Initialize three IMU charts: accelerometer, gyroscope, magnetometer.
 * Each chart has three lines: X, Y, Z.
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

    // Destroy existing chart if any (e.g. when reloading a CSV)
    const existing = imuCharts[sensor.id];
    if (existing) existing.destroy();

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
        interaction: { mode: "nearest", intersect: false},
        plugins: {
          legend: { display: false, position: "right", align: "center", labels: {color: "#ffffff", padding:12},},
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
}

/**
 * Fill all charts with the complete dataset (no windowing).
 * This is called when a CSV is first loaded.
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
 *  - Compute adjustedTime = videoTime + syncOffset.
 *  - Show a sliding 5-second window centered around adjustedTime.
 *  - Move a vertical green marker line to the current sample.
 */
function updateChartsForVideoTime(videoTime) {
  if (!csvData || !csvTimesSeconds.length) return;
  if (!imuCharts || !Object.keys(imuCharts).length) return;

  const adjustedTime = videoTime - syncOffset;
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
 * Moving this slider sets dataMarkedTime and updates the charts.
 */
function setupDataTimelineSlider() {
  if (!dataTimelineSlider) return;

  // Remove previous listener if we reconfigure the slider (e.g. new CSV)
  if (dataSliderListener) {
    dataTimelineSlider.removeEventListener("input", dataSliderListener);
  }

  dataSliderListener = (e) => {
    const time = parseFloat(e.target.value);
    if (!Number.isFinite(time) || !csvTimesSeconds.length) return;

    // Find first IMU sample whose timestamp is >= selected time
    const foundIndex = csvTimesSeconds.findIndex((t) => t >= time);
    const idx =
      foundIndex === -1 ? csvTimesSeconds.length - 1 : Math.max(foundIndex, 0);

    dataMarkedTime = csvTimesSeconds[idx];
    updateChartsForVideoTime(dataMarkedTime + syncOffset);

    if (dataTimeDisplay) {
      dataTimeDisplay.textContent = formatTime(dataMarkedTime);
    }
  };

  dataTimelineSlider.addEventListener("input", dataSliderListener);
}

/**
 * CSV upload handling: parse file and populate charts + timeline.
 */
function setupCsvUpload() {
  if (!uploadCsvBtn || !csvInput) return;

  // Open file dialog when clicking the button
  uploadCsvBtn.addEventListener("click", () => {
    csvInput.click();
  });

  // Parse CSV when a file is selected
  csvInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (event) => {
      const text = event.target.result;

      // Split into non-empty lines
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
      if (!lines.length) return;

      // First line is header row
      const headers = lines[0].split(",").map((h) => h.trim());
      csvData = [];

      // Convert each remaining line to a numeric sample object
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

      // Generate time axis from sample indices
      csvTimesSeconds = csvData.map((_, idx) => idx / SAMPLE_RATE_HZ);

      const totalTime =
        csvTimesSeconds.length > 0
          ? csvTimesSeconds[csvTimesSeconds.length - 1]
          : 0;

      // Configure slider bounds
      if (dataTimelineSlider) {
        dataTimelineSlider.max = totalTime.toFixed(3);
        dataTimelineSlider.value = 0;
      }

      // Update status text
      if (imuStatusEl) {
        imuStatusEl.textContent = `CSV loaded: ${csvData.length} samples, total ${totalTime.toFixed(
          2
        )} s`;
      }

      // Once we have data, allow marking data time
      if (markDataBtn) {
        markDataBtn.disabled = false;
      }

      // Initialize charts + full data, then enable scrubbing
      initImuCharts();
      updateImuChartsFull();
      setupDataTimelineSlider();
    };

    reader.readAsText(file);
  });
}

/**
 * Sync buttons (mark video time, mark data time, apply sync).
 * This creates a simple two-point alignment: video mark → data mark.
 */
function setupSyncButtons() {
  // 1) Mark current video time
  if (markVideoBtn) {
    markVideoBtn.addEventListener("click", () => {
      if (!video) return;
      videoMarkedTime = video.currentTime || 0;

      if (syncStatusEl) {
        syncStatusEl.textContent = `video mark: ${formatTime(videoMarkedTime)}`;
        syncStatusEl.classList.remove("synced");
      }

      checkSyncReady();
    });
  }

  // 2) Mark current data time (from slider)
  if (markDataBtn) {
    markDataBtn.addEventListener("click", () => {
      if (!csvData || !csvTimesSeconds.length) return;

      // If user did not move the data slider yet, default to 0
      if (dataMarkedTime == null) {
        dataMarkedTime = 0;
      }

      if (syncStatusEl) {
        const videoText =
          videoMarkedTime != null ? formatTime(videoMarkedTime) : "n/a";
        syncStatusEl.textContent = `video: ${videoText} → data: ${formatTime(
          dataMarkedTime
        )}`;
        syncStatusEl.classList.remove("synced");
      }

      checkSyncReady();
    });
  }

  // 3) Compute and apply syncOffset
  if (setSyncBtn) {
    setSyncBtn.addEventListener("click", () => {
      if (videoMarkedTime == null || dataMarkedTime == null) return;

      // We want: dataTime = videoTime + syncOffset
      syncOffset = videoMarkedTime - dataMarkedTime;

      if (syncStatusEl) {
        syncStatusEl.textContent = `synced: offset ${syncOffset.toFixed(
          3
        )} s`;
        syncStatusEl.classList.add("synced");
      }

      // Clear marks and disable button until we mark again
      videoMarkedTime = null;
      dataMarkedTime = null;
      setSyncBtn.disabled = true;

      // Persist sync + timestamps for this video, if we know it
      saveProjectToLocal();
    });
  }
}

/**
 * Enable or disable "Apply sync" button depending on whether
 * both a video mark and a data mark exist.
 */
function checkSyncReady() {
  if (!setSyncBtn) return;
  setSyncBtn.disabled = !(videoMarkedTime != null && dataMarkedTime != null);
}

/* ------------------------------------------------------------------
   Project / timestamp logic (Movesense-style)
------------------------------------------------------------------- */

// Saved timestamps for annotated video events
let timestamps = [];

// Track which video file is currently active (for localStorage key)
let currentVideoFileInfo = null;

/**
 * Remember basic info about the currently loaded video file.
 * Called from handleFileChange() in movenet.js.
 */
function setCurrentVideoFileInfo(file) {
  if (file && file.name && typeof file.size === "number") {
    currentVideoFileInfo = { name: file.name, size: file.size };
  } else {
    currentVideoFileInfo = null;
  }
}

/**
 * Build the localStorage key for the current video, or null if unknown.
 */
function getProjectStorageKey() {
  if (!currentVideoFileInfo) return null;
  return `project_${currentVideoFileInfo.name}_${currentVideoFileInfo.size}`;
}

/**
 * Save current syncOffset + timestamps (+ optional extra fields) to localStorage.
 */
function saveProjectToLocal(extra) {
  const key = getProjectStorageKey();
  if (!key) return;

  const projectData = {
    syncOffset,
    timestamps,
    sampleRate: SAMPLE_RATE_HZ,
    createdAt: new Date().toISOString(),
    notes: notesInput ? notesInput.value || "" : "",
  };

  if (extra && typeof extra === "object") {
    Object.assign(projectData, extra);
  }

  try {
    localStorage.setItem(key, JSON.stringify(projectData));
  } catch (err) {
    console.warn("Could not save project to localStorage:", err);
  }
}

/**
 * Load syncOffset + timestamps from localStorage for the current video, if present.
 * Also updates UI (syncStatus, timestamp list, notes).
 */
function loadProjectFromLocal() {
  const key = getProjectStorageKey();
  if (!key) return;

  const saved = localStorage.getItem(key);
  if (!saved) return;

  try {
    const projectData = JSON.parse(saved);

    if (typeof projectData.syncOffset === "number") {
      syncOffset = projectData.syncOffset;
    } else {
      syncOffset = 0;
    }

    timestamps = Array.isArray(projectData.timestamps)
      ? projectData.timestamps
      : [];

    if (notesInput) {
      notesInput.value = projectData.notes || "";
    }

    if (syncStatusEl) {
      syncStatusEl.textContent = `synced: offset ${syncOffset.toFixed(3)} s`;
      syncStatusEl.classList.add("synced");
    }

    renderTimestamps();

    // Immediately update charts to current video time, if possible
    if (video && csvData && csvTimesSeconds.length) {
      updateChartsForVideoTime(video.currentTime || 0);
    }
  } catch (err) {
    console.warn("Could not parse stored project data:", err);
  }
}

/**
 * Render the list of timestamps into the timestampListEl container.
 */
function renderTimestamps() {
  if (!timestampListEl) return;

  if (!timestamps.length) {
    timestampListEl.innerHTML =
      '<div class="timestamp-empty">No timestamps yet.</div>';
    return;
  }

  const itemsHtml = timestamps
    .map(
      (ts, idx) => `
      <div class="timestamp-item" data-index="${idx}">
        <span>${ts.label} @ ${formatTime(ts.time)} [${ts.eventType}]</span>
        <button type="button" data-delete="${idx}">×</button>
      </div>
    `
    )
    .join("");

  timestampListEl.innerHTML = itemsHtml;
}

/**
 * When clicking on a timestamp row: jump video to that time and show info.
 */
function selectTimestamp(index) {
  const ts = timestamps[index];
  if (!ts) return;

  if (video) {
    video.currentTime = ts.time;
  }

  if (eventLabelEl) {
    eventLabelEl.textContent = `Label: ${ts.label}`;
  }
  if (eventTimeEl) {
    eventTimeEl.textContent = `Time: ${formatTime(ts.time)}`;
  }
  if (eventNotesEl) {
    eventNotesEl.textContent = ts.notes
      ? `Notes: ${ts.notes}`
      : "Notes: (none)";
  }
  if (eventInfoEl) {
    eventInfoEl.style.display = "block";
  }

  // Also move IMU view to that time if data is present
  if (csvData && csvTimesSeconds.length) {
    updateChartsForVideoTime(ts.time);
  }
}

/**
 * Delete a timestamp by index and refresh list + storage.
 */
function deleteTimestamp(index) {
  if (index < 0 || index >= timestamps.length) return;
  timestamps.splice(index, 1);
  renderTimestamps();
  saveProjectToLocal();
}

/**
 * Export current project as JSON file (syncOffset + timestamps + metadata).
 */
function exportProject() {
  if (!window.JSZip) {
    alert("JSZip library is not loaded – cannot export video + CSV.");
    return;
  }

  const zip = new JSZip();

  // --- 1) Metadaten wie bisher ---
  const projectData = {
    syncOffset: syncOffset,
    timestamps: timestamps,
    sampleRate: SAMPLE_RATE_HZ,
    createdAt: new Date().toISOString(),
    notes: document.getElementById("notesInput")?.value || "",
    // wir kennen den Originalnamen evtl. nicht -> generischer Name
    videoFileName: "video_from_project.mp4",
    csvFileName: csvData && csvData.length ? "imu_data.csv" : null,
  };

  zip.file("project.json", JSON.stringify(projectData, null, 2));

  // --- 2) Video aus dem <video>-Element holen (blob:-URL) ---
  const videoEl = typeof video !== "undefined" ? video : document.getElementById("video");
  const asyncTasks = [];

  if (videoEl && typeof videoEl.src === "string" && videoEl.src.startsWith("blob:")) {
    const videoUrl = videoEl.src;

    const videoTask = fetch(videoUrl)
      .then((res) => res.blob())
      .then((blob) => {
        // Extension grob raten
        const mime = blob.type || "video/mp4";
        const ext = mime.includes("/") ? mime.split("/")[1] : "mp4";
        const fileName = `video/video_from_project.${ext}`;
        zip.file(fileName, blob);
      })
      .catch((err) => {
        console.error("Could not fetch video blob for export:", err);
        alert("Warning: video could not be added to ZIP (see console).");
      });

    asyncTasks.push(videoTask);
  } else {
    // kein Video geladen – ist okay, dann nur Metadaten + CSV
    console.warn("No blob video source found; exporting without video file.");
  }

  // --- 3) CSV generieren und hinzufügen ---
  if (csvData && csvData.length > 0) {
    const headers = Object.keys(csvData[0]);
    const lines = [headers.join(",")];

    csvData.forEach((row) => {
      const values = headers.map((h) =>
        row[h] != null ? String(row[h]) : ""
      );
      lines.push(values.join(","));
    });

    const csvText = lines.join("\n");
    zip.file("data/imu_data.csv", csvText);
  }

  // --- 4) Dateinamen fragen + ZIP erzeugen ---
  let filename =
    prompt("Enter a filename for the project (without extension):", "movesense_project") || "";
  if (!filename) return;

  if (!filename.toLowerCase().endsWith(".zip")) {
    filename = filename + ".zip";
  }

  Promise.all(asyncTasks)
    .then(() => zip.generateAsync({ type: "blob" }))
    .then((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    })
    .catch((err) => {
      console.error("Error generating ZIP:", err);
      alert("Error while creating project ZIP. See console for details.");
    });
}



/**
 * Import a project JSON file and update state (syncOffset, timestamps, notes).
 */
function importProject() {
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".zip,.json";

  fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const name = file.name.toLowerCase();

    // ---------- Neuer Weg: komplettes Projekt als ZIP ----------
    if (name.endsWith(".zip")) {
      if (!window.JSZip) {
        alert("JSZip is not available – cannot read ZIP project.");
        return;
      }

      JSZip.loadAsync(file)
        .then(async (zip) => {
          // 1) project.json lesen
          const projectFile = zip.file("project.json");
          if (!projectFile) {
            alert("project.json not found in ZIP.");
            return;
          }

          const projectText = await projectFile.async("string");
          const projectData = JSON.parse(projectText);

          // --- Metadaten anwenden ---
          syncOffset = projectData.syncOffset || 0;
          timestamps = projectData.timestamps || [];

          if (syncStatusEl) {
            syncStatusEl.textContent = `synced: offset ${syncOffset.toFixed(
              3
            )} s`;
            syncStatusEl.classList.add("synced");
          }

          if (notesInput) {
            notesInput.value = projectData.notes || "";
          }

          renderTimestamps();

          // 2) Video aus /video/ laden (falls vorhanden)
          let videoEntry = null;
          zip.folder("video").forEach((relativePath, zipObj) => {
            if (!zipObj.dir && !videoEntry) {
              videoEntry = zipObj;
            }
          });

          if (videoEntry) {
            const videoBlob = await videoEntry.async("blob");
            const videoName =
              videoEntry.name.split("/").pop() || "video_from_project.mp4";
            const importedVideoFile = new File([videoBlob], videoName, {
              type: videoBlob.type || "video/mp4",
            });

            // Video-Info für localStorage-Key merken
            setCurrentVideoFileInfo(importedVideoFile);

            // Genauso behandeln wie beim normalen Upload
            if (typeof videoFileUrl !== "undefined" && videoFileUrl) {
              URL.revokeObjectURL(videoFileUrl);
            }

            const url = URL.createObjectURL(importedVideoFile);
            if (typeof videoFileUrl !== "undefined") {
              videoFileUrl = url;
            }

            if (video) {
              video.srcObject = null;
              video.src = url;
              video.muted = true;

              if (typeof uploadedVideoReady !== "undefined") {
                uploadedVideoReady = false;
              }

              video.onloadedmetadata = () => {
                syncVideoAndCanvasSize();
                if (typeof uploadedVideoReady !== "undefined") {
                  uploadedVideoReady = true;
                }
                if (typeof setupVideoTimelineSlider === "function") {
                  setupVideoTimelineSlider();
                }
                setStatus(
                  `Video loaded from project: ${videoName}. Click Start to begin.`
                );
              };
            }
          }

          // 3) CSV aus /data/ laden (falls vorhanden)
          let csvEntry = null;
          zip.folder("data").forEach((relativePath, zipObj) => {
            if (
              !zipObj.dir &&
              !csvEntry &&
              relativePath.toLowerCase().endsWith(".csv")
            ) {
              csvEntry = zipObj;
            }
          });

          if (csvEntry) {
            const csvText = await csvEntry.async("string");
            const lines = csvText
              .split(/\r?\n/)
              .filter((l) => l.trim().length);
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

            initImuCharts();
            updateImuChartsFull();
            setupDataTimelineSlider();
          }

          // Charts direkt auf aktuelle Videozeit setzen (falls beides da ist)
          if (video && csvData && csvTimesSeconds.length) {
            updateChartsForVideoTime(video.currentTime || 0);
          }

          // Alles auch wieder in localStorage spiegeln
          saveProjectToLocal(projectData);
        })
        .catch((err) => {
          console.error("Error reading ZIP:", err);
          alert("Error while importing ZIP project. See console for details.");
        });

      // ---------- Alte Variante: nur JSON-Projekt ----------
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const projectData = JSON.parse(event.target.result);

          syncOffset = projectData.syncOffset || 0;
          timestamps = projectData.timestamps || [];

          if (syncStatusEl) {
            syncStatusEl.textContent = `synced: offset ${syncOffset.toFixed(
              3
            )} s`;
            syncStatusEl.classList.add("synced");
          }

          if (notesInput) {
            notesInput.value = projectData.notes || "";
          }

          renderTimestamps();

          // Nur Metadaten – CSV & Video musst du in diesem Fall separat laden
          saveProjectToLocal(projectData);
        } catch (err) {
          console.error("Error parsing JSON:", err);
          alert("Could not parse JSON project file.");
        }
      };
      reader.readAsText(file);
    }
  };

  fileInput.click();
}



/**
 * Generate a human-readable TXT report instead of JSON.
 */
function generateReport() {
  if (!csvData || !csvData.length) {
    alert("No CSV data loaded – cannot create report.");
    return;
  }

  const defaultName = "movesense_report.txt";
  const filename =
    prompt("Enter a filename for the report:", defaultName) || "";
  if (!filename) return;

  const totalMovementTime =
    csvTimesSeconds.length > 0
      ? csvTimesSeconds[csvTimesSeconds.length - 1]
      : 0;

  const avg = (key) =>
    csvData.reduce((sum, row) => sum + (row[key] || 0), 0) / csvData.length;

  const peak = (key) => Math.max(...csvData.map((row) => row[key] || 0));

  const lines = [];

  lines.push("Movesense IMU Report :)");
  lines.push("");
  lines.push("");
  lines.push(`Total movement time: ${totalMovementTime.toFixed(2)} s`);
  lines.push(`Number of events: ${timestamps.length}`);
  lines.push("");
  lines.push("Events:");
  if (!timestamps.length) {
    lines.push("  (no events stored)");
  } else {
    timestamps.forEach((ts, i) => {
      lines.push(
        `  [${i + 1}] ${ts.label} @ ${formatTime(ts.time)} [${
          ts.eventType
        }]${ts.notes ? " - " + ts.notes : ""}`
      );
    });
  }
  lines.push("");

  const blob = new Blob([lines.join("\n")], {
    type: "text/plain;charset=utf-8",
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Initialize timestamp UI: bind button + list handlers + export/import/report.
 */
function initTimestampUI() {
  if (timestampListEl) {
    renderTimestamps();

    timestampListEl.addEventListener("click", (e) => {
      const deleteIndexAttr = e.target.getAttribute("data-delete");
      if (deleteIndexAttr != null) {
        e.stopPropagation();
        const idx = parseInt(deleteIndexAttr, 10);
        if (!Number.isNaN(idx)) {
          deleteTimestamp(idx);
        }
        return;
      }

      const item = e.target.closest(".timestamp-item");
      if (!item) return;

      const idx = parseInt(item.getAttribute("data-index"), 10);
      if (!Number.isNaN(idx)) {
        selectTimestamp(idx);
      }
    });
  }

  if (addTimestampBtn) {
    addTimestampBtn.addEventListener("click", () => {
      if (!video) return;

      const t = video.currentTime || 0;
      const rawLabel = timestampLabelInput
        ? timestampLabelInput.value.trim()
        : "";
      const label = rawLabel || formatTime(t);
      const eventType =
        eventTypeSelect && eventTypeSelect.value
          ? eventTypeSelect.value
          : "other";
      const notes =
        notesInput && notesInput.value ? notesInput.value.trim() : "";

      timestamps.push({ time: t, label, eventType, notes });

      if (timestampLabelInput) timestampLabelInput.value = "";
      if (notesInput) notesInput.value = "";

      renderTimestamps();
      saveProjectToLocal();
    });
  }

  if (exportProjectBtn) {
    exportProjectBtn.addEventListener("click", exportProject);
  }
  if (importProjectBtn) {
    importProjectBtn.addEventListener("click", importProject);
  }
  if (generateReportBtn) {
    generateReportBtn.addEventListener("click", generateReport);
  }
}

/**
 * Reset all timestamp-related state and UI.
 * Called from clearAll() in main.js.
 */
function resetTimestamps() {
  timestamps = [];

  if (timestampLabelInput) {
    timestampLabelInput.value = "";
  }
  if (notesInput) {
    notesInput.value = "";
  }

  if (eventInfoEl) {
    eventInfoEl.style.display = "none";
  }

  renderTimestamps();
}
