"use strict";

/**
 * One place to initialize IMU features.
 * Call IMU.init() once after your UI elements exist.
 */
(() => {
  const IMU = (window.IMU = window.IMU || {});

  IMU.init = function init() {
    // CSV + charts
    if (typeof IMU.setupCsvUpload === "function") IMU.setupCsvUpload();

    // Sync buttons
    if (typeof IMU.setupSyncButtons === "function") IMU.setupSyncButtons();

    // Timestamp UI + export/import/report
    if (typeof IMU.initTimestampUI === "function") IMU.initTimestampUI();
  };
})();
