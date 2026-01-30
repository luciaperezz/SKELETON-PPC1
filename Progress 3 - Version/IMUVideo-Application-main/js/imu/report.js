"use strict";

/**
 * Simple TXT report generator.
 * Depends on:
 *  - window.IMU_STATE
 *  - window.formatTime
 */
(() => {
  const IMU = (window.IMU = window.IMU || {});
  const S = window.IMU_STATE;

  IMU.generateReport = function generateReport() {
    if (!S.csvData || !S.csvData.length) {
      alert("No CSV data loaded – cannot create report.");
      return;
    }

    const defaultName = "movesense_report.txt";
    const filename = prompt("Enter a filename for the report:", defaultName) || "";
    if (!filename) return;

    const totalMovementTime = S.csvTimesSeconds.length
      ? S.csvTimesSeconds[S.csvTimesSeconds.length - 1]
      : 0;

    const lines = [];
    lines.push("Movesense IMU Report :)");
    lines.push("");
    lines.push(`Total movement time: ${totalMovementTime.toFixed(2)} s`);
    lines.push(`Number of events: ${S.timestamps.length}`);
    lines.push("");
    lines.push("Events:");

    if (!S.timestamps.length) {
      lines.push("  (no events stored)");
    } else {
      S.timestamps.forEach((ts, i) => {
        lines.push(
          `  [${i + 1}] ${ts.label} @ ${window.formatTime(ts.time)} [${ts.eventType}]` +
          (ts.notes ? " - " + ts.notes : "")
        );
      });
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  };
})();
