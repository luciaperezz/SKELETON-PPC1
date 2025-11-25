# Skeleton Motion Tracker – README

## 1. What this project does

This project is a small web app that tracks a human skeleton in a video:

- **Live mode:** Use your **webcam** for real-time pose tracking.  
- **Upload mode:** **Upload a video** and get more accurate tracking.

In both modes, the app runs **PoseNet** (via **TensorFlow.js**) directly in your browser and draws a colored **skeleton overlay** on top of the video (points + connecting lines) on a `<canvas>`.   

You only need:

- A modern browser (Chrome, Firefox, Edge, …)
- Internet access (to load TensorFlow.js & PoseNet)
- For live mode: a webcam and permission to use it

---

## 2. How it works

1. Open `index.html` in your browser.
2. At the bottom of the file, three `<script>` tags load:
   - **TensorFlow.js**
   - The **PoseNet model**
   - The app logic in **`script.js`**
3. When the page loads:
   - `script.js` finds all important HTML elements (buttons, video, canvas, status text).
   - It loads **two PoseNet models**: live webcam tracking and uploaded videos
4. For each frame, it:
   - Draws the **keypoints** (body joints) as blue circles.
   - Draws the **skeleton** (connections between joints) as pink lines.

Press **Stop** to end tracking. In upload mode the video also pauses.

---

## 3. Files in this project

- **`index.html`**  
  Defines the page layout (header, mode buttons, upload/input controls, Start/Stop buttons, `<video>`, `<canvas>`) and includes basic CSS for a centered, dark UI. :contentReference[oaicite:1]{index=1}  

- **`script.js`**  
  Handles all interaction:
  - Mode switching (live ↔ upload)
  - Camera setup and cleanup
  - Video file loading
  - PoseNet model loading and selection
  - Drawing the skeleton on the canvas frame by frame :contentReference[oaicite:2]{index=2}  

There is **no server code**: everything runs locally in your browser.
