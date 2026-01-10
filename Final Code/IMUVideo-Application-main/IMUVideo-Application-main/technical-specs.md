# Technical Documentation

Deep dive into the IMUVideo Application architecture and implementation.

---

## System Overview

The IMUVideo Application is a **client-side web application** that combines:
1. **Video pose estimation** (TensorFlow.js + MoveNet Thunder)
2. **IMU sensor data visualization** (Chart.js)
3. **Manual synchronization** between video and sensor timelines
4. **Project persistence** (localStorage + ZIP export/import)

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **No backend** | Privacy-first, zero cost, works offline, instant deployment via GitHub Pages |
| **Pure vanilla JavaScript** | No build step, no dependencies to manage, easy for contributors |
| **localStorage** | Automatic session recovery, no user accounts needed |
| **ZIP export** | Self-contained projects, shareable between users and devices |
| **MoveNet Thunder** | Higher accuracy for offline video analysis |

---

## Module Architecture

### File Structure & Responsibilities

```
index.html          # DOM structure, CSS styles, external library imports
│
js/
├── config.js       # Constants, DOM refs, utility functions
├── imu.js          # IMU data handling, charts, sync, timestamps
├── movenet.js      # Pose detection, rendering, video controls
└── main.js         # App initialization, global state reset
```

### Dependency Graph

```
main.js
  ├─→ config.js (global constants, DOM refs)
  ├─→ imu.js (CSV parsing, charts)
  └─→ movenet.js (pose estimation)
       └─→ imu.js (IMU chart updates)
```

**Load Order** (defined in `index.html`):
1. External libraries (TensorFlow.js, MoveNet, Chart.js, JSZip)
2. `config.js` (defines globals used by all modules)
3. `imu.js` (self-contained IMU logic)
4. `movenet.js` (depends on IMU for chart updates)
5. `main.js` (orchestrates everything)

---

## Application Flow

### Startup Sequence

```javascript
// main.js → main()
async function main() {
  1. Wait for TensorFlow.js: await tf.ready()
  2. Load MoveNet Thunder model
  3. Attach UI event listeners
  4. Initialize IMU charts
  5. Setup CSV upload
  6. Setup sync buttons
  7. Initialize timestamp UI
}
```

### Video Upload Flow

```
User selects file
  → handleFileChange()
    → Revoke old URL
    → Create new blob URL
    → Set video.src
    → video.onloadedmetadata:
      → syncVideoAndCanvasSize()
      → setupVideoTimelineSlider()
      → setCurrentVideoFileInfo()
      → loadProjectFromLocal()
      → Attach timeupdate listener
```

### CSV Upload Flow

```
User clicks "Upload CSV"
  → File dialog opens
  → User selects CSV
  → FileReader reads as text
  → Parse CSV:
    → Split into lines
    → Extract headers
    → Convert rows to objects
    → Generate time axis (index / SAMPLE_RATE_HZ)
  → Initialize/update Chart.js plots
  → Setup data timeline slider
  → Enable "Mark data time" button
```

### Tracking Loop

```javascript
renderFrame() {
  1. Check video.readyState
  2. Sync canvas size with video
  3. Check if video ended
  4. Increment frameIndex
  
  5. Estimate pose (with frame skipping):
     if (frameIndex % UPLOAD_FRAME_SKIP === 0) {
       poses = await detector.estimatePoses(video)
       lastPose = poses[0]
     }
  
  6. Clear canvas
  7. Draw overlay info (mode, score)
  8. Highlight nose if present
  9. drawKeypoints(keypoints)
  10. drawSkeleton(keypoints)
  
  11. Update video timeline slider
  12. Update IMU charts (throttled to 33ms)
  
  13. requestAnimationFrame(renderFrame)
}
```

---

## Synchronization System

### Problem
Video and IMU data are recorded separately with different start times. We need to align them.

### Solution: Two-Point Alignment

1. **User marks video time** (e.g., at a jump): `videoMarkedTime = video.currentTime`
2. **User marks data time** (e.g., at acceleration spike): `dataMarkedTime = csvTimesSeconds[index]`
3. **Calculate offset**: `syncOffset = videoMarkedTime - dataMarkedTime`

### Usage
Whenever we need to show IMU data for a video time:
```javascript
const adjustedTime = videoTime - syncOffset;
// Find IMU samples around adjustedTime
```

### Example
```
Video event at t=5.2s
IMU event at t=1.0s
syncOffset = 5.2 - 1.0 = 4.2s

Later, when video is at t=10.0s:
adjustedTime = 10.0 - 4.2 = 5.8s
→ Show IMU data from 5.8s
```

### Edge Cases
- **No sync applied**: `syncOffset = 0` (default)
- **Reverse sync**: If IMU starts before video, offset can be negative
- **Multiple syncs**: Each new sync overwrites the previous offset

---

## Chart System

### Chart.js Configuration

**Three independent charts:**
- `chartAcc`: Accelerometer (ax, ay, az)
- `chartGyro`: Gyroscope (gx, gy, gz)
- `chartMag`: Magnetometer (mx, my, mz)

**Performance Optimizations:**
```javascript
options: {
  animation: false,           // No smooth transitions
  parsing: false,             // Data is pre-parsed
  normalized: true,           // Data is normalized
  responsive: true,           // Adapt to container size
  maintainAspectRatio: false, // Fill container height
  pointRadius: 0,             // No point markers (performance)
}
```

### Update Strategies

**Full Update** (on CSV load):
```javascript
updateImuChartsFull() {
  // Load ALL data points into chart
  chart.data.datasets[i].data = csvData.map((row, idx) => ({
    x: csvTimesSeconds[idx],
    y: row[key] ?? 0
  }));
  chart.update("none"); // "none" = skip animations
}
```

**Windowed Update** (during playback):
```javascript
updateChartsForVideoTime(videoTime) {
  // Show 5-second sliding window
  const adjustedTime = videoTime - syncOffset;
  const windowSize = 5;
  const startTime = adjustedTime - 2.5;
  const endTime = adjustedTime + 2.5;
  
  // Update X-axis bounds
  chart.options.scales.x.min = startTime;
  chart.options.scales.x.max = endTime;
  chart.update("none");
  
  // Position vertical marker
  const markerPos = (adjustedTime - startTime) / windowSize * 100;
  marker.style.left = `${markerPos}%`;
}
```

**Throttling:**
```javascript
// Avoid updating charts every frame (performance)
const IMU_UPDATE_THROTTLE_MS = 33; // ~30fps
let lastImuUpdateTime = 0;

if (now - lastImuUpdateTime > IMU_UPDATE_THROTTLE_MS) {
  updateChartsForVideoTime(currentTime);
  lastImuUpdateTime = now;
}
```

---

## Pose Estimation

### MoveNet Thunder

**Specifications:**
- Accuracy: High (trained on diverse datasets)
- Speed: ~10fps on typical CPU
- Keypoints: 17 body landmarks
- Use case: Offline video analysis

### Skeleton Definition

MoveNet outputs 17 keypoints:
```javascript
keypoints = [
  { name: "nose", x: 320, y: 240, score: 0.95 },
  { name: "left_eye", x: 315, y: 235, score: 0.92 },
  { name: "right_eye", x: 325, y: 235, score: 0.93 },
  // ... 14 more keypoints
]
```

**Connected Pairs** (for skeleton lines):
```javascript
MOVENET_CONNECTED_KEYPOINTS = [
  ["nose", "left_eye"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["left_shoulder", "right_shoulder"],
  ["left_hip", "right_hip"],
  // ... etc
]
```

### Drawing Pipeline

```javascript
drawKeypoints(keypoints) {
  keypoints.forEach(kp => {
    if (kp.score < 0.02) return; // Skip very low confidence
    
    // Color by confidence
    const color = kp.score >= MIN_PART_CONFIDENCE 
      ? "#2196F3"  // High confidence: blue
      : "rgba(33, 150, 243, 0.3)"; // Low confidence: transparent
    
    ctx.arc(kp.x, kp.y, 5, ...);
  });
}

drawSkeleton(keypoints) {
  // Create lookup: name → keypoint
  const byName = {};
  keypoints.forEach(kp => byName[kp.name] = kp);
  
  // Draw lines between connected pairs
  MOVENET_CONNECTED_KEYPOINTS.forEach(([a, b]) => {
    const kp1 = byName[a];
    const kp2 = byName[b];
    
    // Only draw if both endpoints are confident
    if (kp1.score >= MIN_PART_CONFIDENCE && 
        kp2.score >= MIN_PART_CONFIDENCE) {
      ctx.moveTo(kp1.x, kp1.y);
      ctx.lineTo(kp2.x, kp2.y);
      ctx.stroke();
    }
  });
}
```

### Frame Skipping

**Problem:** Thunder model is too slow to process every frame at 30fps.

**Solution:** Process every Nth frame, reuse last pose for skipped frames.

```javascript
frameIndex++;
let poseToDraw = lastPose;

if (frameIndex % UPLOAD_FRAME_SKIP === 0 || !lastPose) {
  const poses = await detector.estimatePoses(video);
  lastPose = poses[0] || null;
  poseToDraw = lastPose;
}

// Draw skeleton using poseToDraw (may be from a previous frame)
```

**Trade-offs:**
- `UPLOAD_FRAME_SKIP = 1`: Max accuracy, slow performance
- `UPLOAD_FRAME_SKIP = 2`: Good balance (default)
- `UPLOAD_FRAME_SKIP = 5`: Fast performance, noticeable lag

---

## Persistence System

### localStorage Strategy

**Key Format:**
```
project_${videoName}_${videoSize}
```

Example: `project_exercise_720p.mp4_52428800`

**Stored Data:**
```javascript
{
  syncOffset: 4.2,
  timestamps: [
    { time: 5.5, label: "Jump 1", eventType: "jump", notes: "Good form" },
    { time: 12.3, label: "Jump 2", eventType: "jump", notes: "Leaning left" }
  ],
  sampleRate: 104,
  createdAt: "2025-12-15T10:30:00.000Z",
  notes: "Morning training session"
}
```

**Auto-save Triggers:**
- After applying sync
- After adding/deleting timestamp
- After updating notes

**Auto-load Trigger:**
- When video file is loaded (`handleFileChange()`)

### ZIP Export Format

```
project_name.zip
├── project.json          # Metadata
│   {
│     "syncOffset": 4.2,
│     "timestamps": [...],
│     "sampleRate": 104,
│     "createdAt": "...",
│     "notes": "...",
│     "videoFileName": "video_from_project.mp4",
│     "csvFileName": "imu_data.csv"
│   }
├── video/
│   └── video_from_project.mp4
└── data/
    └── imu_data.csv
```

### Import Process

```javascript
importProject() {
  1. User selects ZIP file
  2. JSZip.loadAsync(file)
  3. Read project.json → parse metadata
  4. Apply syncOffset and timestamps to state
  5. Look for video file in /video/ folder
     → Create File object from blob
     → Set as video source (same as manual upload)
  6. Look for CSV file in /data/ folder
     → Parse as text
     → Convert to csvData array (same as manual CSV upload)
  7. Initialize charts and sliders
  8. Save to localStorage
}
```

---

## UI State Management

### Tracking State

```javascript
isRunning = true | false
```

**Controls:**
- Whether `renderFrame()` continues looping
- Button states (Start/Stop)
- Video playback

### Sync State

```javascript
videoMarkedTime = null | number
dataMarkedTime = null | number
syncOffset = number
```

**State Machine:**
```
Initial: both null, offset = 0
  ↓ Mark video time
videoMarked = 5.2s, dataMarked = null
  ↓ Mark data time
videoMarked = 5.2s, dataMarked = 1.0s
  ↓ Apply sync
videoMarked = null, dataMarked = null, offset = 4.2s
```

---

## Performance Optimizations

### Video Processing
1. **Frame skipping**: Process every 2nd frame by default
2. **Playback speed**: `video.playbackRate = 0.75` for smoother processing
3. **Canvas sync**: Only update canvas size when video dimensions change
4. **Conditional rendering**: Stop pose estimation when video ends

### Chart Updates
1. **Throttling**: Update at most 30fps (`IMU_UPDATE_THROTTLE_MS = 33`)
2. **Windowed rendering**: Only show 5s of data at a time
3. **No animations**: `animation: false` in Chart.js config
4. **No point markers**: `pointRadius: 0` (thousands of points)

### Memory Management
1. **URL cleanup**: Revoke object URLs when done (`URL.revokeObjectURL()`)
2. **Chart reuse**: Destroy old charts before creating new ones
3. **Event listener cleanup**: Remove old listeners when re-configuring sliders

### Potential Improvements
- Web Workers for CSV parsing (offload from main thread)
- WebGL for Chart.js (better performance with large datasets)
- Video thumbnails for quick navigation
- Progressive CSV loading (stream large files)

---

## Privacy & Security

### Data Flow
```
User's device → Browser → User's device
(No external servers involved)
```

### Privacy Features
- **No server uploads**: All processing happens locally
- **No analytics**: No tracking, no telemetry
- **No accounts**: No personal information collected
- **localStorage only**: Data stored in user's browser
- **User-controlled exports**: Projects exported only on user action

### Security Considerations
- **File validation**: CSV parsing handles malformed data gracefully
- **No code execution**: CSV data parsed as data, not evaluated as code
- **Browser sandboxing**: Processing in isolated browser context
- **No XSS vectors**: No dynamic HTML from user input (uses `textContent`)

---

## File Structure Reference

### config.js
**Purpose**: Global configuration, DOM references, utility functions  
**Lines**: ~180  
**Key Exports**:
```javascript
// Configuration constants
VIDEO_WIDTH, VIDEO_HEIGHT, MIN_PART_CONFIDENCE
UPLOAD_FRAME_SKIP, FLIP_HORIZONTAL_UPLOAD
SAMPLE_RATE_HZ

// DOM element references
video, canvas, ctx
startBtn, stopBtn, clearBtn, statusEl
uploadCsvBtn, csvInput, imuStatusEl
dataTimelineSlider, videoTimelineSlider
markVideoBtn, markDataBtn, setSyncBtn
timestampLabelInput, timestampListEl
exportProjectBtn, importProjectBtn

// Utility functions
setStatus(text), setButtonsRunning(running)
formatTime(seconds), syncVideoAndCanvasSize()
```

### imu.js
**Purpose**: IMU data handling, Chart.js visualization, synchronization  
**Lines**: ~660  
**Key Functions**:
```javascript
// Chart management
initImuCharts(), updateImuChartsFull()
updateChartsForVideoTime(time)

// CSV handling
setupCsvUpload()

// Synchronization
setupSyncButtons(), checkSyncReady()
setupDataTimelineSlider()

// Timestamps & Projects
saveProjectToLocal(), loadProjectFromLocal()
exportProject(), importProject(), generateReport()
renderTimestamps(), selectTimestamp(), deleteTimestamp()
```

### movenet.js
**Purpose**: MoveNet pose estimation, rendering, video controls  
**Lines**: ~510  
**Key Functions**:
```javascript
// Rendering
renderFrame(), drawKeypoints(), drawSkeleton()

// Tracking control
handleStart(), stopTracking()

// Video management
setupVideoTimelineSlider(), handleFileChange()
```

### main.js
**Purpose**: App initialization and global reset  
**Lines**: ~140  
**Key Functions**:
```javascript
clearAll()  // Reset entire app state
main()      // Initialize and start app
```

---

## Development Workflow

### Local Development
```bash
# Start local server
python -m http.server 8000

# Open browser
open http://localhost:8000

# Make changes to JS files
# Refresh browser to see changes
```

### Debugging Tips
```javascript
// Enable verbose logging
const DEBUG = true;
if (DEBUG) console.log("Sync offset:", syncOffset);

// Inspect TensorFlow backend
console.log("TF Backend:", tf.getBackend());

// Check video state
console.log({
  duration: video.duration,
  currentTime: video.currentTime,
  readyState: video.readyState,
  paused: video.paused
});

// Inspect IMU data
console.table(csvData.slice(0, 10)); // First 10 samples
```

### Browser DevTools
- **Console**: Check for errors and warnings
- **Network**: Verify model and library loading
- **Performance**: Profile render loop for bottlenecks
- **Memory**: Check for leaks during long sessions

---

## Deployment

### GitHub Pages Setup

1. **Repository Settings**:
   - Go to Settings → Pages
   - Source: Deploy from branch
   - Branch: `main` (or `gh-pages`)
   - Folder: `/ (root)`

2. **URL**: `https://[username].github.io/[repo-name]/`

3. **No build process needed**: Static files deploy as-is

### CDN Dependencies
All external libraries are loaded from CDNs:
- TensorFlow.js: `cdn.jsdelivr.net`
- MoveNet: `cdn.jsdelivr.net`
- Chart.js: `cdnjs.cloudflare.com`
- JSZip: `cdnjs.cloudflare.com`

---

## Additional Resources

- [TensorFlow.js Performance Guide](https://www.tensorflow.org/js/guide/platform_and_environment)
- [MoveNet Architecture](https://blog.tensorflow.org/2021/05/next-generation-pose-detection-with-movenet-and-tensorflowjs.html)
- [Chart.js Performance Tips](https://www.chartjs.org/docs/latest/general/performance.html)
- [Web Video Best Practices](https://web.dev/fast/#optimize-your-images)

---

**Last Updated**: December 2025