# IMUVideo Application

**An affordable, portable body tracking system for sports and physiotherapy applications**

This tool is a web-based application that combines real-time pose estimation with IMU (Inertial Measurement Unit) sensor data to provide comprehensive movement analysis. No installation required.

---

## Purpose

This tool is designed as an **observational aid** for coaches, physiotherapists, athletes, and researchers who want to:
- Analyze movement patterns and biomechanics
- Track progress over time
- Document rehabilitation exercises
- Review athletic performance
- Correlate visual movement with acceleration, rotation, and magnetic field data

**Important:** This is not a medical diagnostic tool. It provides observational data only and should not replace professional medical advice.

---

## Features

### Video Analysis
- Analyze pre-recorded videos with MoveNet Thunder pose estimation
- Real-time skeleton overlay during video playback
- Frame-by-frame scrubbing with timeline slider

### IMU Integration
- Upload CSV files from IMU sensors (accelerometer, gyroscope, magnetometer)
- Visualize sensor data in synchronized, interactive charts
- Manual synchronization between video and sensor data

### Annotation & Analysis
- Add timestamped events during video playback
- Label specific movements (jumps, claps, custom events)
- Add notes and observations for each timestamp
- Jump directly to marked events

### Project Management
- Export complete projects as ZIP files (includes video, CSV data, and annotations)
- Import previously saved projects to continue analysis
- Generate human-readable text reports
- Automatic localStorage backup for active sessions

---

## Getting Started

### Accessing the App

1. Navigate to the GitHub Pages URL: `https://[your-username].github.io/[repo-name]/`
2. The app loads entirely in your browser—no downloads or installations needed.

### Basic Workflow

#### For Video Analysis:

1. **Upload Video**: Click "Select video" and choose your video file
2. **Optional - Upload IMU Data**: 
   - Click "Upload CSV" to load sensor data
   - Use the data timeline slider to find a reference point in your sensor data
3. **Synchronize** (if using IMU data):
   - Play the video to a recognizable event (e.g., a jump or clap)
   - Click "Mark video time"
   - Move the data timeline slider to the same event in your sensor data
   - Click "Mark data time"
   - Click "Apply sync" to align both timelines
4. **Start Tracking**: Click "Start" to begin pose estimation
5. **Annotate**: While playing, click "Add timestamp" to mark important moments
6. **Export**: Save your complete project using "Export project"

---

## IMU Data Format

Your CSV file must follow this structure:

### Required Headers
```csv
ax,ay,az,gx,gy,gz,mx,my,mz
```

- **ax, ay, az**: Accelerometer data (m/s²) for X, Y, Z axes
- **gx, gy, gz**: Gyroscope data (°/s) for X, Y, Z axes
- **mx, my, mz**: Magnetometer data (µT) for X, Y, Z axes

### Example CSV:
```csv
ax,ay,az,gx,gy,gz,mx,my,mz
0.12,9.81,0.05,0.01,-0.02,0.00,45.2,-12.3,38.7
0.15,9.82,0.04,0.02,-0.01,0.01,45.1,-12.4,38.8
...
```

### Important Notes:
- **No timestamp column needed**: The app generates timestamps automatically based on sample rate
- **Default sample rate**: 104 Hz (configurable in `config.js` via `SAMPLE_RATE_HZ`)
- **Data order**: Each row represents one sample; samples must be in chronological order
- **Missing values**: Use `0` for any missing sensor values

### Exporting from Common IMU Devices:
- **Movesense**: Export as CSV, ensure headers match the required format
- **Arduino/Custom sensors**: Format your output to match the header structure above
- **Mobile apps**: Many IMU recording apps allow CSV export—verify the header names

---

## Controls & Interface

### Video Controls
- **Start/Stop**: Begin or pause pose estimation
- **Clear**: Reset everything and start fresh
- **Video timeline slider**: Scrub through uploaded video frames
- **Step counter**: Shows current frame / total frames at 30 FPS

### IMU Controls
- **Upload CSV**: Load sensor data file
- **Data timeline slider**: Navigate through IMU data independently
- **Mark video time**: Set a reference point in the video
- **Mark data time**: Set a reference point in the sensor data
- **Apply sync**: Calculate and apply time offset between video and data

### Timestamp Controls
- **Add timestamp**: Mark current video time with optional label, event type, and notes
- **Timestamp list**: Click any timestamp to jump to that moment
- **Delete button (×)**: Remove individual timestamps

### Project Controls
- **Export project**: Download complete ZIP file with video, CSV, and all annotations
- **Import project**: Load a previously saved project
- **Generate report**: Create a human-readable text summary

---

## Project Files

### Export Structure
When you export a project, you get a ZIP file containing:
```
project_name.zip
├── project.json          # Metadata, sync offset, timestamps
├── video/
│   └── video_from_project.mp4
└── data/
    └── imu_data.csv
```

### What's Saved:
- **project.json**: Sync offset, all timestamps with labels/notes/event types, sample rate, creation date
- **Video file**: Your original uploaded video
- **CSV file**: Your IMU sensor data
- **Notes**: Any general notes added in the notes field

### Import Workflow:
1. Click "Import project"
2. Select your `.zip` file
3. The app automatically loads video, CSV data, annotations, and sync settings
4. Continue where you left off

---

## Technical Details

### Technologies Used
- **TensorFlow.js**: Machine learning framework for browser-based pose estimation
- **MoveNet Thunder**: Google's pose detection model optimized for accuracy
- **Chart.js**: Real-time visualization of IMU sensor data
- **JSZip**: Project export/import functionality

### Browser Requirements
- Modern browser with WebGL support (Chrome, Firefox, Edge, Safari)
- JavaScript enabled
- Recommended: Desktop or laptop for best experience

### Performance Considerations
- **Frame skipping**: Upload mode processes every 2nd frame by default for better performance
- **Chart throttling**: IMU charts update at most every 33ms to maintain smooth playback
- **Memory usage**: Large videos (>500MB) may cause slowdown; consider compressing videos first

### Privacy & Data
- **Everything runs locally**: No data is sent to external servers
- **No account required**: No login, no tracking, no data collection
- **localStorage**: Projects are automatically saved in your browser (cleared when you clear browser data)
- **Export for backup**: Always export important projects to preserve them

---

## Use Cases

### Sports Performance
- **Analyze technique**: Review and compare movement patterns across sessions
- **Progress tracking**: Document improvements in form or range of motion
- **Injury prevention**: Identify movement asymmetries or compensation patterns

### Physiotherapy & Rehabilitation
- **Exercise documentation**: Record patient exercises for remote review
- **Progress monitoring**: Track ROM, balance, and coordination improvements
- **Patient education**: Visual feedback to help patients understand their movement

### Research & Education
- **Biomechanics studies**: Collect movement and IMU data for analysis
- **Teaching tool**: Demonstrate proper form and movement principles
- **Low-cost alternative**: Accessible motion capture for educational institutions

---

## Troubleshooting

### Video won't load
- **Check file format**: Supported formats are MP4, WebM, MOV (browser-dependent)
- **File size**: Very large files (>1GB) may cause issues; try compressing the video
- **Codec issues**: Re-encode video using H.264 codec for best compatibility

### CSV not loading
- **Check headers**: Ensure first row exactly matches: `ax,ay,az,gx,gy,gz,mx,my,mz`
- **No extra columns**: Remove timestamp columns or other non-sensor data
- **Encoding**: Save CSV as UTF-8 without BOM
- **Commas only**: Use comma separators, not semicolons or tabs

### Sync not working
- **Clear markers**: Click "Apply sync" to reset, then mark again
- **Recognizable events**: Choose obvious events (jumps, claps, impacts) for sync points
- **Data timeline**: Make sure you've moved the data timeline slider before marking data time

### Charts not updating
- **Refresh page**: Sometimes Chart.js needs a fresh start
- **Check CSV data**: Ensure your CSV has valid numeric values
- **Sample rate**: Verify `SAMPLE_RATE_HZ` in `config.js` matches your actual sensor rate

### Performance issues
- **Reduce video resolution**: Lower resolution videos process faster
- **Close other tabs**: Free up system resources
- **Increase frame skip**: Edit `UPLOAD_FRAME_SKIP` in `config.js` (default: 2)

---

## Configuration

Advanced users can customize the app by editing `js/config.js`:

```javascript
// Video resolution for webcam
VIDEO_WIDTH = 640;
VIDEO_HEIGHT = 480;

// Keypoint confidence threshold
MIN_PART_CONFIDENCE = 0.2;

// Frame skipping for performance
UPLOAD_FRAME_SKIP = 2;  // Process every 2nd frame

// Horizontal flip (mirror effect)
FLIP_HORIZONTAL_UPLOAD = true;  // Flip uploaded videos

// IMU sample rate in Hz
SAMPLE_RATE_HZ = 104;  // Adjust to match your sensor
```


---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

The MIT License allows you to:
- Use the software for any purpose (commercial or non-commercial)
- Modify the software
- Distribute copies of the software
- Sublicense the software

The only requirement is that you include the original copyright notice and license in any copies or substantial portions of the software.

---

## Team

Developed by the IMUVideo team in the CM2018 PCC at KTH as part of an effort to create affordable, accessible motion analysis tools for sports and physiotherapy applications.

---

## Contact & Support

- **Documentation**: This README and inline code comments

For technical details about the architecture and implementation, see [TECHNICAL.md](TECHNICAL.md).

---

## Acknowledgments

- **TensorFlow.js team**: For making ML accessible in the browser
- **MoveNet**: Google's pose estimation model
- **Chart.js**: Beautiful, responsive charts

---

## Additional Resources

- [MoveNet Documentation](https://www.tensorflow.org/hub/tutorials/movenet)
- [TensorFlow.js Guide](https://www.tensorflow.org/js)
- [IMU Sensor Basics](https://www.sparkfun.com/pages/accel_gyro_guide)
- [Human Pose Estimation Overview](https://viso.ai/deep-learning/pose-estimation-ultimate-overview/)

---

**Version**: 1.0  
**Last Updated**: December 2025
