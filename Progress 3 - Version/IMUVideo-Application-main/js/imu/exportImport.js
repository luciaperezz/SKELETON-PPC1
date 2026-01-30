"use strict";

/**
 * Export / Import projects as ZIP (project.json + optional video + optional CSV).
 * Depends on:
 *  - window.IMU_STATE
 *  - window.JSZip (for ZIP import/export)
 *  - UI globals: video, notesInput, syncStatusEl, dataTimelineSlider, imuStatusEl,
 *               addTimestampBtn, markVideoBtn
 *  - Helpers: syncVideoAndCanvasSize, setupVideoTimelineSlider, setStatus
 *  - window.SAMPLE_RATE_HZ
 *  - window.IMU.setCurrentVideoFileInfo / initImuCharts / updateImuChartsFull / setupDataTimelineSlider /
 *    renderTimestamps / saveProjectToLocal / updateChartsForVideoTime
 */
(() => {
  const IMU = (window.IMU = window.IMU || {});
  const S = window.IMU_STATE;

  IMU.exportProject = function exportProject() {
    if (!window.JSZip) {
      alert("JSZip library is not loaded – cannot export video + CSV.");
      return;
    }

    const zip = new JSZip();

    // 1) Metadata
    const projectData = {
      syncOffset: S.syncOffset,
      timestamps: S.timestamps,
      sampleRate: window.SAMPLE_RATE_HZ,
      createdAt: new Date().toISOString(),
      notes: document.getElementById("notesInput")?.value || "",
      videoFileName: "video_from_project.mp4",
      csvFileName: S.csvData && S.csvData.length ? "imu_data.csv" : null,
    };

    zip.file("project.json", JSON.stringify(projectData, null, 2));

    // 2) Optional video blob from <video> element (blob:-URL)
    const videoEl = typeof window.video !== "undefined" ? window.video : document.getElementById("video");
    const asyncTasks = [];

    if (videoEl && typeof videoEl.src === "string" && videoEl.src.startsWith("blob:")) {
      const videoUrl = videoEl.src;

      const videoTask = fetch(videoUrl)
        .then((res) => res.blob())
        .then((blob) => {
          const mime = blob.type || "video/mp4";
          const ext = mime.includes("/") ? mime.split("/")[1] : "mp4";
          zip.file(`video/video_from_project.${ext}`, blob);
        })
        .catch((err) => {
          console.error("Could not fetch video blob for export:", err);
          alert("Warning: video could not be added to ZIP (see console).");
        });

      asyncTasks.push(videoTask);
    } else {
      console.warn("No blob video source found; exporting without video file.");
    }

    // 3) Optional CSV file
    if (S.csvData && S.csvData.length > 0) {
      const headers = Object.keys(S.csvData[0]);
      const lines = [headers.join(",")];

      S.csvData.forEach((row) => {
        const values = headers.map((h) => (row[h] != null ? String(row[h]) : ""));
        lines.push(values.join(","));
      });

      zip.file("data/imu_data.csv", lines.join("\n"));
    }

    // 4) Ask filename and create ZIP
    let filename = prompt("Enter a filename for the project (without extension):", "movesense_project") || "";
    if (!filename) return;
    if (!filename.toLowerCase().endsWith(".zip")) filename += ".zip";

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
  };

  IMU.importProject = function importProject() {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".zip,.json";

    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const name = file.name.toLowerCase();

      // ZIP project
      if (name.endsWith(".zip")) {
        if (!window.JSZip) {
          alert("JSZip is not available – cannot read ZIP project.");
          return;
        }

        JSZip.loadAsync(file)
          .then(async (zip) => {
            // project.json
            const projectFile = zip.file("project.json");
            if (!projectFile) {
              alert("project.json not found in ZIP.");
              return;
            }

            const projectData = JSON.parse(await projectFile.async("string"));

            S.syncOffset = projectData.syncOffset || 0;
            S.timestamps = projectData.timestamps || [];

            if (window.syncStatusEl) {
              window.syncStatusEl.textContent = `synced: offset ${S.syncOffset.toFixed(3)} s`;
              window.syncStatusEl.classList.add("synced");
            }
            if (window.notesInput) window.notesInput.value = projectData.notes || "";

            if (typeof IMU.renderTimestamps === "function") IMU.renderTimestamps();

            // video
            let videoEntry = null;
            zip.folder("video")?.forEach((relativePath, zipObj) => {
              if (!zipObj.dir && !videoEntry) videoEntry = zipObj;
            });

            if (videoEntry) {
              const videoBlob = await videoEntry.async("blob");
              const videoName = videoEntry.name.split("/").pop() || "video_from_project.mp4";
              const importedVideoFile = new File([videoBlob], videoName, { type: videoBlob.type || "video/mp4" });

              if (typeof IMU.setCurrentVideoFileInfo === "function") IMU.setCurrentVideoFileInfo(importedVideoFile);

              if (typeof window.videoFileUrl !== "undefined" && window.videoFileUrl) {
                URL.revokeObjectURL(window.videoFileUrl);
              }

              const url = URL.createObjectURL(importedVideoFile);
              if (typeof window.videoFileUrl !== "undefined") window.videoFileUrl = url;

              if (window.video) {
                window.video.srcObject = null;
                window.video.src = url;
                window.video.muted = true;

                if (typeof window.uploadedVideoReady !== "undefined") window.uploadedVideoReady = false;

                window.video.onloadedmetadata = () => {
                  if (typeof window.syncVideoAndCanvasSize === "function") window.syncVideoAndCanvasSize();
                  if (typeof window.uploadedVideoReady !== "undefined") window.uploadedVideoReady = true;
                  if (typeof window.setupVideoTimelineSlider === "function") window.setupVideoTimelineSlider();
                  if (typeof window.setStatus === "function") {
                    window.setStatus(`Video loaded from project: ${videoName}. Click Start to begin.`);
                  }

                  if (window.addTimestampBtn) window.addTimestampBtn.disabled = false;
                  if (window.markVideoBtn) window.markVideoBtn.disabled = false;
                };
              }
            }

            // csv
            let csvEntry = null;
            zip.folder("data")?.forEach((relativePath, zipObj) => {
              if (!zipObj.dir && !csvEntry && relativePath.toLowerCase().endsWith(".csv")) {
                csvEntry = zipObj;
              }
            });

            if (csvEntry) {
              const csvText = await csvEntry.async("string");
              const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length);
              if (!lines.length) return;

              const headers = lines[0].split(",").map((h) => h.trim());
              S.csvData = [];

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

              const hz = window.SAMPLE_RATE_HZ || 1;
              S.csvTimesSeconds = S.csvData.map((_, idx) => idx / hz);

              const totalTime = S.csvTimesSeconds.length
                ? S.csvTimesSeconds[S.csvTimesSeconds.length - 1]
                : 0;

              if (window.dataTimelineSlider) {
                window.dataTimelineSlider.max = totalTime.toFixed(3);
                window.dataTimelineSlider.value = 0;
              }

              if (window.imuStatusEl) {
                window.imuStatusEl.textContent =
                  `CSV loaded: ${S.csvData.length} samples, total ${totalTime.toFixed(2)} s`;
              }

              if (typeof IMU.initImuCharts === "function") IMU.initImuCharts();
              if (typeof IMU.updateImuChartsFull === "function") IMU.updateImuChartsFull();
              if (typeof IMU.setupDataTimelineSlider === "function") IMU.setupDataTimelineSlider();
            }

            // Separation requirement: importing a project must not force IMU view
            // to follow the video. Leave the IMU playhead as-is.

            if (typeof IMU.saveProjectToLocal === "function") IMU.saveProjectToLocal(projectData);
          })
          .catch((err) => {
            console.error("Error reading ZIP:", err);
            alert("Error while importing ZIP project. See console for details.");
          });
      } else {
        // JSON-only metadata import
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const projectData = JSON.parse(event.target.result);

            S.syncOffset = projectData.syncOffset || 0;
            S.timestamps = projectData.timestamps || [];

            if (window.syncStatusEl) {
              window.syncStatusEl.textContent = `synced: offset ${S.syncOffset.toFixed(3)} s`;
              window.syncStatusEl.classList.add("synced");
            }

            if (window.notesInput) window.notesInput.value = projectData.notes || "";

            if (typeof IMU.renderTimestamps === "function") IMU.renderTimestamps();

            if (typeof IMU.saveProjectToLocal === "function") IMU.saveProjectToLocal(projectData);
          } catch (err) {
            console.error("Error parsing JSON:", err);
            alert("Could not parse JSON project file.");
          }
        };
        reader.readAsText(file);
      }
    };

    fileInput.click();
  };
})();
