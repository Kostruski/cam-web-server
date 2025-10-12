"""
Collection Scheduler Service
Manages scheduled image collection with persistence
"""

import os
import json
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
import shutil


class CollectionScheduler:
    def __init__(self, camera_service, data_dir):
        self.camera_service = camera_service
        self.data_dir = data_dir
        self.schedule_file = os.path.join(data_dir, 'collection_schedule.json')
        self.collections_dir = os.path.join(data_dir, 'training_data')

        self.schedule = None
        self.collection_state = {
            'active': False,
            'paused': False,
            'collected_count': 0,
            'total_count': 0,
            'folder_name': None,
            'folder_path': None,
            'next_capture': None,
            'capture_schedule': []  # Array of {timestamp, hour, date}
        }

        self.timer = None
        self.timer_thread = None

        # Initialize
        self.init()

    def init(self):
        try:
            Path(self.collections_dir).mkdir(parents=True, exist_ok=True)
            self.load_schedule()

            if self.collection_state['active']:
                print('[CollectionScheduler] Resuming collection from saved state')
                self.start_scheduled_captures()
        except Exception as error:
            print(f'[CollectionScheduler] Initialization error: {error}')

    def start_collection(self, schedule_config):
        """Start a new collection schedule"""
        if self.collection_state['active']:
            raise Exception('Collection already active')

        # Generate capture schedule
        capture_schedule = self.generate_capture_schedule(schedule_config)

        if len(capture_schedule) == 0:
            raise Exception('No valid capture times in the schedule')

        # Create collection folder
        first_capture = datetime.fromtimestamp(capture_schedule[0]['timestamp'] / 1000)
        folder_name = f'training_data_{schedule_config["totalImages"]}_{self.format_folder_timestamp(first_capture)}'
        folder_path = os.path.join(self.collections_dir, folder_name)

        Path(folder_path).mkdir(parents=True, exist_ok=True)

        # Update state
        self.schedule = schedule_config
        self.collection_state = {
            'active': True,
            'paused': False,
            'collected_count': 0,
            'total_count': schedule_config['totalImages'],
            'folder_name': folder_name,
            'folder_path': folder_path,
            'capture_schedule': capture_schedule,
            'resolution': schedule_config.get('resolution', '1280x720'),
            'next_capture': None
        }

        self.save_schedule()
        self.start_scheduled_captures()

        return {
            'success': True,
            'folderName': folder_name,
            'totalSlots': len(capture_schedule)
        }

    def generate_capture_schedule(self, config):
        """Generate capture schedule from config"""
        schedule = []
        now = datetime.now()

        if config['scheduleType'] == 'dates':
            # Specific dates
            for date_str in config['dates']:
                date = datetime.fromisoformat(date_str + 'T00:00:00')

                for hour in config['hours']:
                    capture_time = date.replace(hour=hour, minute=0, second=0, microsecond=0)

                    # Only include future times
                    if capture_time > now:
                        schedule.append({
                            'timestamp': int(capture_time.timestamp() * 1000),
                            'hour': hour,
                            'date': date_str
                        })
        else:
            # Weekdays
            start_date = datetime.fromisoformat(config['startDate'] + 'T00:00:00')
            end_date = datetime.fromisoformat(config['endDate'] + 'T23:59:59')

            current_date = start_date
            while current_date <= end_date:
                if current_date.weekday() in config['weekdays']:
                    for hour in config['hours']:
                        capture_time = current_date.replace(hour=hour, minute=0, second=0, microsecond=0)

                        if capture_time > now:
                            schedule.append({
                                'timestamp': int(capture_time.timestamp() * 1000),
                                'hour': hour,
                                'date': current_date.strftime('%Y-%m-%d')
                            })
                current_date += timedelta(days=1)

        # Sort by timestamp
        schedule.sort(key=lambda x: x['timestamp'])

        return schedule

    def start_scheduled_captures(self):
        """Start capturing based on schedule"""
        if self.timer_thread:
            return

        self.timer_thread = threading.Thread(target=self.check_and_capture_loop, daemon=True)
        self.timer_thread.start()

    def check_and_capture_loop(self):
        """Check if it's time to capture and schedule next check"""
        while self.collection_state['active']:
            if not self.collection_state['paused']:
                try:
                    self.check_and_capture()
                except Exception as e:
                    print(f'[CollectionScheduler] Error in capture loop: {e}')

            time.sleep(60)  # Check every minute

    def check_and_capture(self):
        """Check if it's time to capture"""
        if not self.collection_state['active'] or self.collection_state['paused']:
            return

        now = int(time.time() * 1000)
        schedule = self.collection_state['capture_schedule']

        # Find next capture slot
        next_slot_index = None
        for i, slot in enumerate(schedule):
            if slot['timestamp'] > now:
                next_slot_index = i
                break

        if next_slot_index is None:
            # No more captures scheduled
            print('[CollectionScheduler] Collection completed')
            self.complete_collection()
            return

        current_slot = schedule[next_slot_index - 1] if next_slot_index > 0 else None
        next_slot = schedule[next_slot_index]

        # Update next capture time
        next_capture_dt = datetime.fromtimestamp(next_slot['timestamp'] / 1000)
        self.collection_state['next_capture'] = next_capture_dt.isoformat()

        # Check if we should capture now (within current slot)
        if current_slot and now >= current_slot['timestamp'] and now < current_slot['timestamp'] + 3600000:
            # We're in a capture slot (within the hour)
            self.capture_images(current_slot)

        self.save_schedule()

    def capture_images(self, slot):
        """Capture images for a time slot"""
        if self.collection_state['collected_count'] >= self.collection_state['total_count']:
            self.complete_collection()
            return

        total_slots = len(self.collection_state['capture_schedule'])
        images_per_slot = (self.collection_state['total_count'] + total_slots - 1) // total_slots
        remaining = self.collection_state['total_count'] - self.collection_state['collected_count']
        images_to_capture = min(images_per_slot, remaining)

        print(f'[CollectionScheduler] Capturing {images_to_capture} images for slot {slot["date"]} {slot["hour"]}:00')

        # Distribute captures evenly throughout the hour
        interval_s = 3600 / images_to_capture  # seconds per image

        for i in range(images_to_capture):
            if not self.collection_state['active'] or self.collection_state['paused']:
                break

            try:
                self.capture_and_save_image()

                # Wait before next capture
                if i < images_to_capture - 1:
                    time.sleep(interval_s)
            except Exception as error:
                print(f'[CollectionScheduler] Capture error: {error}')

        self.save_schedule()

    def capture_and_save_image(self):
        """Capture and save a single image"""
        try:
            # Set camera resolution
            width, height = map(int, self.collection_state['resolution'].split('x'))
            self.camera_service.width = width
            self.camera_service.height = height

            image_buffer = self.camera_service.capture_frame()
            timestamp = int(time.time() * 1000)
            filename = f'{timestamp}.jpg'
            filepath = os.path.join(self.collection_state['folder_path'], filename)

            with open(filepath, 'wb') as f:
                f.write(image_buffer)

            self.collection_state['collected_count'] += 1

            print(f'[CollectionScheduler] Captured {filename} ({self.collection_state["collected_count"]}/{self.collection_state["total_count"]})')

            return filename
        except Exception as error:
            print(f'[CollectionScheduler] Failed to capture image: {error}')
            raise

    def pause_collection(self):
        """Pause collection"""
        if not self.collection_state['active']:
            raise Exception('No active collection')

        self.collection_state['paused'] = True
        self.save_schedule()
        print('[CollectionScheduler] Collection paused')

    def resume_collection(self):
        """Resume collection"""
        if not self.collection_state['active'] or not self.collection_state['paused']:
            raise Exception('Collection not paused')

        self.collection_state['paused'] = False
        self.save_schedule()
        print('[CollectionScheduler] Collection resumed')

    def cancel_collection(self, delete_images=False):
        """Cancel collection"""
        if not self.collection_state['active']:
            raise Exception('No active collection')

        folder_path = self.collection_state['folder_path']

        if delete_images and folder_path and os.path.exists(folder_path):
            try:
                shutil.rmtree(folder_path)
                print('[CollectionScheduler] Deleted collection folder')
            except Exception as error:
                print(f'[CollectionScheduler] Failed to delete folder: {error}')

        self.collection_state = {
            'active': False,
            'paused': False,
            'collected_count': 0,
            'total_count': 0,
            'folder_name': None,
            'folder_path': None,
            'capture_schedule': [],
            'next_capture': None
        }

        self.schedule = None
        self.save_schedule()

        print('[CollectionScheduler] Collection cancelled')

    def complete_collection(self):
        """Complete collection"""
        print(f'[CollectionScheduler] Collection completed: {self.collection_state["collected_count"]} images')

        self.collection_state['active'] = False
        self.collection_state['paused'] = False
        self.save_schedule()

    def get_status(self):
        """Get current status"""
        return {
            'active': self.collection_state['active'],
            'paused': self.collection_state['paused'],
            'collectedCount': self.collection_state['collected_count'],
            'totalCount': self.collection_state['total_count'],
            'folderName': self.collection_state['folder_name'],
            'nextCapture': self.collection_state['next_capture']
        }

    def save_schedule(self):
        """Save schedule to disk"""
        try:
            data = {
                'schedule': self.schedule,
                'state': self.collection_state
            }
            with open(self.schedule_file, 'w') as f:
                json.dump(data, f, indent=2)
        except Exception as error:
            print(f'[CollectionScheduler] Failed to save schedule: {error}')

    def load_schedule(self):
        """Load schedule from disk"""
        try:
            with open(self.schedule_file, 'r') as f:
                saved = json.load(f)

            self.schedule = saved.get('schedule')
            self.collection_state = saved.get('state', self.collection_state)

            print('[CollectionScheduler] Schedule loaded from disk')
        except:
            print('[CollectionScheduler] No saved schedule found')

    def format_folder_timestamp(self, date):
        """Format timestamp for folder name"""
        return date.strftime('%y-%m-%d-%H')

    def list_collections(self):
        """List collection folders"""
        try:
            if not os.path.exists(self.collections_dir):
                return []

            folders = os.listdir(self.collections_dir)
            results = []

            for folder in folders:
                folder_path = os.path.join(self.collections_dir, folder)
                if not os.path.isdir(folder_path):
                    continue

                stats = os.stat(folder_path)
                images = os.listdir(folder_path)
                image_files = [f for f in images if f.endswith(('.jpg', '.png'))]

                total_size = 0
                for img in image_files:
                    img_path = os.path.join(folder_path, img)
                    img_stats = os.stat(img_path)
                    total_size += img_stats.st_size

                results.append({
                    'name': folder,
                    'path': folder_path,
                    'imageCount': len(image_files),
                    'size': total_size,
                    'created': datetime.fromtimestamp(stats.st_ctime).isoformat()
                })

            results.sort(key=lambda x: x['created'], reverse=True)
            return results
        except Exception as error:
            print(f'[CollectionScheduler] Failed to list collections: {error}')
            return []

    def get_folder_images(self, folder_name):
        """Get images in a folder"""
        try:
            folder_path = os.path.join(self.collections_dir, folder_name)
            files = os.listdir(folder_path)
            image_files = sorted([f for f in files if f.endswith(('.jpg', '.png'))])
            return image_files
        except Exception as error:
            print(f'[CollectionScheduler] Failed to get folder images: {error}')
            return []

    def delete_collection(self, folder_name):
        """Delete collection folder"""
        try:
            folder_path = os.path.join(self.collections_dir, folder_name)
            shutil.rmtree(folder_path)
            print(f'[CollectionScheduler] Deleted collection: {folder_name}')
            return True
        except Exception as error:
            print(f'[CollectionScheduler] Failed to delete collection: {error}')
            raise
