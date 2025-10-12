"""
Camera Service - Handles camera access and streaming
Uses ffmpeg/raspivid for Raspberry Pi camera access
"""

import subprocess
import os
from pathlib import Path


class CameraService:
    def __init__(self, camera_index=0, width=1280, height=720, fps=15):
        self.camera_index = camera_index
        self.width = width
        self.height = height
        self.fps = fps
        self.mjpeg_process = None
        self.is_streaming = False

    def start_stream(self):
        """
        Start MJPEG stream using ffmpeg/raspivid
        Returns a generator that yields MJPEG frames
        """
        if self.mjpeg_process:
            return None  # Already streaming

        self.is_streaming = True

        # For Raspberry Pi Camera Module, use raspivid
        if self.is_raspberry_pi_camera():
            self.mjpeg_process = subprocess.Popen([
                'raspivid',
                '-t', '0',  # No timeout
                '-w', str(self.width),
                '-h', str(self.height),
                '-fps', str(self.fps),
                '-o', '-',  # Output to stdout
                '-pf', 'baseline',  # H264 profile
                '-cd', 'MJPEG'  # Output as MJPEG
            ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        else:
            # For USB cameras, use ffmpeg
            self.mjpeg_process = subprocess.Popen([
                'ffmpeg',
                '-f', 'v4l2',
                '-framerate', str(self.fps),
                '-video_size', f'{self.width}x{self.height}',
                '-i', f'/dev/video{self.camera_index}',
                '-f', 'mjpeg',
                '-q:v', '5',  # Quality (2-31, lower is better)
                '-'  # Output to stdout
            ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        def frame_generator():
            try:
                while self.is_streaming and self.mjpeg_process:
                    chunk = self.mjpeg_process.stdout.read(1024)
                    if not chunk:
                        break
                    yield chunk
            finally:
                self.stop_stream()

        return frame_generator()

    def stop_stream(self):
        """Stop MJPEG stream"""
        if self.mjpeg_process:
            self.mjpeg_process.terminate()
            try:
                self.mjpeg_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.mjpeg_process.kill()
            self.mjpeg_process = None
            self.is_streaming = False

    def capture_frame(self):
        """
        Capture a single frame as JPEG
        Returns: bytes containing JPEG data
        """
        temp_file = f'/tmp/capture_{int(os.times().elapsed * 1000)}.jpg'

        try:
            if self.is_raspberry_pi_camera():
                # Use raspistill for Pi camera
                subprocess.run([
                    'raspistill',
                    '-w', str(self.width),
                    '-h', str(self.height),
                    '-o', temp_file,
                    '-t', '100',  # 100ms timeout
                    '-n',  # No preview
                    '-e', 'jpg'
                ], check=True, capture_output=True)
            else:
                # Use ffmpeg for USB camera
                subprocess.run([
                    'ffmpeg',
                    '-f', 'v4l2',
                    '-video_size', f'{self.width}x{self.height}',
                    '-i', f'/dev/video{self.camera_index}',
                    '-frames:v', '1',
                    '-y',  # Overwrite
                    temp_file
                ], check=True, capture_output=True)

            # Read captured image
            with open(temp_file, 'rb') as f:
                image_buffer = f.read()

            # Clean up temp file
            try:
                os.unlink(temp_file)
            except:
                pass

            return image_buffer

        except subprocess.CalledProcessError as e:
            raise Exception(f'Capture failed: {e}')
        except Exception as e:
            raise Exception(f'Failed to read captured frame: {e}')

    def check_availability(self):
        """Check if camera is available"""
        try:
            if self.is_raspberry_pi_camera():
                # Check if raspistill exists
                result = subprocess.run(['which', 'raspistill'],
                                       capture_output=True, text=True)
                if result.returncode == 0:
                    return {'available': True, 'type': 'raspberrypi'}
                else:
                    return {'available': False, 'error': 'raspistill not found'}
            else:
                # Check if camera device exists
                device_path = f'/dev/video{self.camera_index}'
                if os.path.exists(device_path):
                    return {'available': True, 'type': 'usb', 'device': device_path}
                else:
                    return {'available': False, 'error': f'{device_path} not found'}
        except Exception as err:
            return {'available': False, 'error': str(err)}

    def is_raspberry_pi_camera(self):
        """Detect if Raspberry Pi camera is being used"""
        try:
            with open('/proc/cpuinfo', 'r') as f:
                cpu_info = f.read()
            return 'Raspberry Pi' in cpu_info and self.camera_index == 0
        except:
            return False
