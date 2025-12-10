# movesense_sensor_data_optimized.py
# -*- coding: utf-8 -*-
"""
Movesense IMU dashboard (Tkinter + embedded Matplotlib)
- Connect / Start / Stop / Disconnect / Exit
- Plots Acc/Gyro/Mag X/Y/Z live at full 104 Hz
- Legends placed to the right (outside) so they don't obscure data
- Exit button performs clean shutdown
- Data recording / saving / importing
- X-axis in seconds under each graph
- Load/Unload CSV data
- Smooth plotting using NumPy buffers and throttled redraw
"""

import asyncio
import threading
import queue
import time
import struct
import csv
import numpy as np
from typing import Optional

import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import matplotlib.pyplot as plt
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg

from bleak import BleakScanner, BleakClient

# -----------------------
# Config / UUIDs
# -----------------------
MOVESENSE_NAME_SUBSTR = "Movesense"
WRITE_CHAR = "34800001-7185-4d5d-b431-630e7050e8f0"
NOTIFY_CHAR = "34800002-7185-4d5d-b431-630e7050e8f0"

CMD_START_IMU9 = bytearray([1, 99]) + bytearray("/Meas/IMU9/104", "utf-8")
CMD_STOP_IMU9  = bytearray([2, 99])

PACKET_TYPE_DATA = 2
PACKET_TYPE_DATA_PART2 = 3

BUFFER_LEN = 500  # number of points per plot window
POLL_INTERVAL_MS = 30  # GUI update interval (ms)

SAMPLE_RATE_HZ = 104
SAMPLE_INTERVAL = 1.0 / SAMPLE_RATE_HZ

data_queue = queue.Queue(maxsize=5000)

ble_loop: Optional[asyncio.AbstractEventLoop] = None
ble_thread: Optional[threading.Thread] = None
ble_client: Optional[BleakClient] = None
ble_client_lock = threading.Lock()
ble_connected = threading.Event()
streaming_flag = threading.Event()

# -----------------------
# DataView helper
# -----------------------
class DataView:
    def __init__(self, arr):
        self.arr = arr
    def get_uint_8(self, i): return self.arr[i]
    def get_uint_32(self, i): return struct.unpack_from("<I", bytes(self.arr[i:i+4]))[0]
    def get_float_32(self, i): return struct.unpack_from("<f", bytes(self.arr[i:i+4]))[0]

# -----------------------
# BLE event loop utilities
# -----------------------
def start_ble_event_loop_thread():
    global ble_loop, ble_thread
    if ble_thread and ble_thread.is_alive():
        return
    def _run_loop(loop):
        asyncio.set_event_loop(loop)
        loop.run_forever()
    ble_loop = asyncio.new_event_loop()
    ble_thread = threading.Thread(target=_run_loop, args=(ble_loop,), daemon=True)
    ble_thread.start()

def run_coro_threadsafe(coro):
    if not ble_loop:
        raise RuntimeError("BLE loop not started")
    return asyncio.run_coroutine_threadsafe(coro, ble_loop)

# -----------------------
# BLE coroutines
# -----------------------
async def _scan_find_movesense(timeout=5.0):
    devices = await BleakScanner.discover(timeout=timeout)
    for d in devices:
        if d.name and MOVESENSE_NAME_SUBSTR in d.name:
            return d
    return None

async def _connect_and_prepare():
    global ble_client
    dev = await _scan_find_movesense()
    if not dev:
        return False, "No Movesense found"
    client = BleakClient(dev.address)
    try:
        await client.connect()
    except Exception as e:
        return False, f"Connect failed: {e}"
    if not client.is_connected:
        return False, "Connect failed"
    with ble_client_lock:
        ble_client = client
    return True, f"Connected: {dev.name}"

async def _start_streaming():
    global ble_client
    if not ble_client:
        return False, "Not connected"
    ongoing = {"part": None}

    def _handle_notify(sender, data: bytearray):
        try:
            d = DataView(data)
            ptype = d.get_uint_8(0)
            if ptype == PACKET_TYPE_DATA:
                ongoing["part"] = bytes(data)
            elif ptype == PACKET_TYPE_DATA_PART2:
                if ongoing["part"] is None:
                    return
                combined = bytearray(ongoing["part"]) + bytearray(data[2:])
                dv = DataView(combined)
                timestamp = dv.get_uint_32(2)
                for i in range(8):
                    offset = 6 + i * 3 * 4
                    skip = 3 * 8 * 4
                    ax = dv.get_float_32(offset)
                    ay = dv.get_float_32(offset+4)
                    az = dv.get_float_32(offset+8)
                    gx = dv.get_float_32(offset+skip+0)
                    gy = dv.get_float_32(offset+skip+4)
                    gz = dv.get_float_32(offset+skip+8)
                    mx = dv.get_float_32(offset+2*skip+0)
                    my = dv.get_float_32(offset+2*skip+4)
                    mz = dv.get_float_32(offset+2*skip+8)
                    try:
                        data_queue.put_nowait((timestamp + i, ax, ay, az, gx, gy, gz, mx, my, mz))
                    except queue.Full:
                        pass
                ongoing["part"] = None
        except Exception:
            return

    try:
        await ble_client.start_notify(NOTIFY_CHAR, _handle_notify)
        await ble_client.write_gatt_char(WRITE_CHAR, CMD_START_IMU9, response=True)
    except Exception as e:
        return False, f"Start failed: {e}"
    streaming_flag.set()
    return True, "Streaming"

async def _stop_streaming():
    global ble_client
    if not ble_client:
        return False, "Not connected"
    try:
        await ble_client.write_gatt_char(WRITE_CHAR, CMD_STOP_IMU9, response=True)
        await ble_client.stop_notify(NOTIFY_CHAR)
    except Exception:
        pass
    streaming_flag.clear()
    return True, "Stopped"

async def _disconnect():
    global ble_client
    if ble_client:
        try:
            await ble_client.disconnect()
        except Exception:
            pass
    with ble_client_lock:
        ble_client = None
    ble_connected.clear()
    streaming_flag.clear()
    return True, "Disconnected"

# -----------------------
# Tkinter App
# -----------------------
class MovesenseApp:
    def __init__(self, root):
        self.root = root
        root.title("Movesense IMU Dashboard")

        # Status
        self.status_var = tk.StringVar(value="Disconnected")
        status_frame = ttk.Frame(root)
        status_frame.pack(fill="x", padx=6, pady=6)
        ttk.Label(status_frame, text="Status:").pack(side="left")
        self.status_label = ttk.Label(status_frame, textvariable=self.status_var, foreground="red")
        self.status_label.pack(side="left", padx=6)

        # Buttons
        btn_frame = ttk.Frame(root)
        btn_frame.pack(fill="x", padx=6, pady=6)
        self.btn_connect = ttk.Button(btn_frame, text="Connect", command=self.connect_clicked)
        self.btn_connect.pack(side="left", padx=4)
        self.btn_start = ttk.Button(btn_frame, text="Start", command=self.start_clicked, state="disabled")
        self.btn_start.pack(side="left", padx=4)
        self.btn_stop = ttk.Button(btn_frame, text="Stop", command=self.stop_clicked, state="disabled")
        self.btn_stop.pack(side="left", padx=4)
        self.btn_disconnect = ttk.Button(btn_frame, text="Disconnect", command=self.disconnect_clicked, state="disabled")
        self.btn_disconnect.pack(side="left", padx=4)
        self.btn_record = ttk.Button(btn_frame, text="Start Record", command=self.toggle_record)
        self.btn_record.pack(side="left", padx=4)
        self.btn_save = ttk.Button(btn_frame, text="Save CSV", command=self.save_csv, state="disabled")
        self.btn_save.pack(side="left", padx=4)
        self.btn_load = ttk.Button(btn_frame, text="Load CSV", command=self.load_csv)
        self.btn_load.pack(side="left", padx=4)
        self.btn_unload = ttk.Button(btn_frame, text="Unload Data", command=self.unload_csv)
        self.btn_unload.pack(side="left", padx=4)
        self.btn_exit = ttk.Button(btn_frame, text="Exit", command=self.exit_clicked)
        self.btn_exit.pack(side="right", padx=4)

        # Timer
        self.timer_var = tk.StringVar(value="00:00")
        self.timer_label = ttk.Label(status_frame, textvariable=self.timer_var)
        self.timer_label.pack(side="right", padx=6)
        self.recording = False
        self.record_start_time = None
        self.recorded_data = []

        # Figure and lines
        self.fig, self.axs = plt.subplots(3,1,figsize=(8,6))
        plt.subplots_adjust(right=0.75, hspace=0.6)
        self.canvas = FigureCanvasTkAgg(self.fig, master=root)
        self.canvas.get_tk_widget().pack(fill="both", expand=True)

        # Use NumPy buffers
        self.buff_time = np.zeros(BUFFER_LEN)
        self.buff_ax = np.zeros((BUFFER_LEN,3))
        self.buff_gyro = np.zeros((BUFFER_LEN,3))
        self.buff_mag = np.zeros((BUFFER_LEN,3))
        self.ptr = 0
        self.count = 0  # total points received

        self.lines = []
        for ax, labels in zip(self.axs,[['Acc X','Acc Y','Acc Z'],['Gyro X','Gyro Y','Gyro Z'],['Mag X','Mag Y','Mag Z']]):
            for label in labels:
                line, = ax.plot([], [], label=label)
                self.lines.append(line)
            ax.legend(loc='center left', bbox_to_anchor=(1.02, 0.5))
            ax.set_xlabel("Time (s)")
        self.axs[0].set_title("Accelerometer")
        self.axs[1].set_title("Gyroscope")
        self.axs[2].set_title("Magnetometer")

        # Slider
        self.slider = ttk.Scale(root, from_=0, to=0, orient="horizontal", command=self.slider_moved)
        self.slider.pack_forget()
        self.loaded_data = None
        self.loaded_times = None

        self.root.after(POLL_INTERVAL_MS, self._poll_data_and_update_plot)
        self.root.after(200, self._update_timer)

    # -------------------
    # Status and timer
    # -------------------
    def _set_status(self, text, ok=False):
        self.status_var.set(text)
        self.status_label.config(foreground="green" if ok else "red")

    def _update_timer(self):
        if self.recording and self.record_start_time:
            elapsed = time.time() - self.record_start_time
            self.timer_var.set(f"{int(elapsed//60):02d}:{int(elapsed%60):02d}")
        self.root.after(200, self._update_timer)

    # -------------------
    # Connect / Start / Stop / Disconnect / Exit
    # -------------------
    def connect_clicked(self):
        self._set_status("Scanning...", ok=False)
        start_ble_event_loop_thread()
        fut = run_coro_threadsafe(_connect_and_prepare())
        def _on_done(f):
            try:
                ok,msg = f.result()
            except Exception as e:
                ok,msg = False,f"Connect exception: {e}"
            if ok:
                ble_connected.set()
                self._set_status(msg, ok=True)
                self.btn_start.config(state="normal")
                self.btn_disconnect.config(state="normal")
                self.btn_connect.config(state="disabled")
            else:
                self._set_status(msg, ok=False)
        fut.add_done_callback(_on_done)

    def start_clicked(self):
        if not ble_connected.is_set():
            self._set_status("Not connected", ok=False)
            return
        if self.loaded_data is not None:
            self.unload_csv()
        self._set_status("Starting...", ok=False)
        fut = run_coro_threadsafe(_start_streaming())
        def _on_done(f):
            try:
                ok,msg = f.result()
            except Exception as e:
                ok,msg = False,f"Start exception: {e}"
            if ok:
                streaming_flag.set()
                self._set_status("Streaming", ok=True)
                self.btn_start.config(state="disabled")
                self.btn_stop.config(state="normal")
            else:
                self._set_status(msg, ok=False)
        fut.add_done_callback(_on_done)

    def stop_clicked(self):
        if not ble_connected.is_set():
            return
        fut = run_coro_threadsafe(_stop_streaming())
        def _on_done(f):
            streaming_flag.clear()
            self._set_status("Stopped", ok=False)
            self.btn_start.config(state="normal")
            self.btn_stop.config(state="disabled")
        fut.add_done_callback(_on_done)

    def disconnect_clicked(self):
        fut = run_coro_threadsafe(_disconnect())
        def _on_done(f):
            ble_connected.clear()
            streaming_flag.clear()
            self._set_status("Disconnected", ok=False)
            self.btn_connect.config(state="normal")
            self.btn_start.config(state="disabled")
            self.btn_stop.config(state="disabled")
            self.btn_disconnect.config(state="disabled")
        fut.add_done_callback(_on_done)

    def exit_clicked(self):
        self._set_status("Shutting down...", ok=False)
        def _shutdown_and_close():
            try:
                if ble_loop:
                    fut1 = run_coro_threadsafe(_stop_streaming())
                    try: fut1.result(timeout=2.0)
                    except Exception: pass
                    fut2 = run_coro_threadsafe(_disconnect())
                    try: fut2.result(timeout=2.0)
                    except Exception: pass
                    try: ble_loop.call_soon_threadsafe(ble_loop.stop)
                    except Exception: pass
            finally:
                try: self.root.after(0,self.root.quit)
                except Exception: pass
        threading.Thread(target=_shutdown_and_close, daemon=True).start()

    # -------------------
    # Record / Save / Load
    # -------------------
    def toggle_record(self):
        self.recording = not self.recording
        if self.recording:
            self.record_start_time = time.time()
            self.recorded_data = []
            self.btn_record.config(text="Stop Record")
            self.btn_save.config(state="disabled")
        else:
            self.btn_record.config(text="Start Record")
            self.btn_save.config(state="normal")

    def save_csv(self):
        if not self.recorded_data:
            return
        fname = filedialog.asksaveasfilename(defaultextension=".csv")
        if fname:
            with open(fname,"w",newline="") as f:
                writer = csv.writer(f)
                writer.writerow(["Time","ax","ay","az","gx","gy","gz","mx","my","mz"])
                for row in self.recorded_data:
                    writer.writerow(row)
            messagebox.showinfo("Saved", f"Saved {fname}")

    def load_csv(self):
        fname = filedialog.askopenfilename(filetypes=[("CSV files","*.csv")])
        if fname:
            times, data = [], []
            with open(fname) as f:
                reader = csv.reader(f)
                headers = next(reader)
                for i,row in enumerate(reader):
                    times.append(i*SAMPLE_INTERVAL)
                    data.append([float(x) for x in row[1:]])
            self.loaded_times = times
            self.loaded_data = data
            self.slider.config(from_=0, to=max(0,len(times)-BUFFER_LEN))
            self.slider.pack(fill="x", padx=6, pady=6)
            self.slider.set(0)
            self._update_plot_loaded(0)

    def unload_csv(self):
        self.loaded_data = None
        self.loaded_times = None
        self.slider.pack_forget()
        for line in self.lines:
            line.set_data([],[])
        for ax in self.axs:
            ax.relim()
            ax.autoscale_view()
        self.canvas.draw_idle()

    def slider_moved(self, val):
        if self.loaded_data is None:
            return
        idx = int(float(val))
        self._update_plot_loaded(idx)

    def _update_plot_loaded(self, start_idx):
        end_idx = start_idx + BUFFER_LEN
        end_idx = min(end_idx, len(self.loaded_data))
        if start_idx >= len(self.loaded_data):
            return
        data_window = self.loaded_data[start_idx:end_idx]
        times_window = self.loaded_times[start_idx:end_idx]

        acc = [ [row[0],row[1],row[2]] for row in data_window ]
        gyro = [ [row[3],row[4],row[5]] for row in data_window ]
        mag = [ [row[6],row[7],row[8]] for row in data_window ]

        for i,line_group in enumerate([acc,gyro,mag]):
            for j in range(3):
                self.lines[i*3+j].set_data(times_window,[row[j] for row in line_group])
        for ax in self.axs:
            ax.relim()
            ax.autoscale_view()
        self.canvas.draw_idle()

    # -------------------
    # Live plotting optimized
    # -------------------
    def _poll_data_and_update_plot(self):
        updated = False
        while not data_queue.empty():
            timestamp, axv, ayv, azv, gxv, gyv, gzv, mxv, myv, mzv = data_queue.get()
            t_sec = timestamp * SAMPLE_INTERVAL

            self.buff_time[self.ptr] = t_sec
            self.buff_ax[self.ptr] = [axv, ayv, azv]
            self.buff_gyro[self.ptr] = [gxv, gyv, gzv]
            self.buff_mag[self.ptr] = [mxv, myv, mzv]
            self.ptr = (self.ptr + 1) % BUFFER_LEN
            self.count += 1

            if self.recording:
                self.recorded_data.append([t_sec, axv, ayv, azv, gxv, gyv, gzv, mxv, myv, mzv])

            updated = True

        if updated and self.loaded_data is None and self.count > 0:
            # Compute slice for plotting
            if self.count < BUFFER_LEN:
                idxs = slice(0,self.count)
            else:
                idxs = np.arange(self.ptr, self.ptr+BUFFER_LEN) % BUFFER_LEN

            # Acc
            for i in range(3):
                self.lines[i].set_data(self.buff_time[idxs], self.buff_ax[idxs,i])
            # Gyro
            for i in range(3):
                self.lines[3+i].set_data(self.buff_time[idxs], self.buff_gyro[idxs,i])
            # Mag
            for i in range(3):
                self.lines[6+i].set_data(self.buff_time[idxs], self.buff_mag[idxs,i])

            for ax in self.axs:
                ax.relim()
                ax.autoscale_view()

            self.canvas.draw_idle()

        self.root.after(POLL_INTERVAL_MS, self._poll_data_and_update_plot)


# -----------------------
# Run app
# -----------------------
if __name__ == "__main__":
    root = tk.Tk()
    app = MovesenseApp(root)
    root.protocol("WM_DELETE_WINDOW", app.exit_clicked)
    root.mainloop()
