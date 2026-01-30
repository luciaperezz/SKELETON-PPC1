"use strict";

/**
 * Shared IMU state (kept in one place so other files stay small).
 * We attach it to window.IMU_STATE so all split files can access it.
 */
(() => {
  const S = (window.IMU_STATE = window.IMU_STATE || {
    // Chart.js instances, keyed by canvas id (chartAcc / chartGyro / chartMag)
    imuCharts: {},

    // Parsed CSV rows: [{ ax, ay, az, gx, gy, gz, mx, my, mz, ... }]
    csvData: null,

    // Time axis in seconds for each sample (index / SAMPLE_RATE_HZ)
    csvTimesSeconds: [],

    // Global offset: dataTime = videoTime + syncOffset
    syncOffset: 0,

    /**
     * Whether IMU charts should automatically follow the VIDEO playhead.
     *
     * The user's requirement is that video and IMU controls are independent,
     * so this defaults to false.
     */
    followVideo: false,

    // Marked times for sync alignment
    videoMarkedTime: null,
    dataMarkedTime: null,

    // Slider listener reference (so we can re-bind cleanly)
    dataSliderListener: null,

    // Throttling of IMU updates in render loop (upload mode)
    IMU_UPDATE_THROTTLE_MS: 33,
    lastImuUpdateTime: 0,

    // Saved timestamps for annotated video events
    timestamps: [],

    // Track which video file is currently active (for localStorage key)
    currentVideoFileInfo: null,
  });

  // Namespace for functions
  window.IMU = window.IMU || {};
})();
