from flask import Flask, request, jsonify, send_file, send_from_directory, Response
import os
import json
from datetime import datetime
from pathlib import Path
from werkzeug.utils import secure_filename
import base64

from services.camera_service import CameraService
from services.torchserve_client import TorchServeClient
from services.collection_scheduler import CollectionScheduler

app = Flask(__name__, static_folder='public', static_url_path='')

# Configuration
PORT = int(os.environ.get('PORT', 8082))
MODELS_DIR = os.environ.get('MODELS_DIR', os.path.join(os.path.dirname(__file__), '../data/models'))
CONFIG_DIR = os.environ.get('CONFIG_DIR', os.path.join(os.path.dirname(__file__), '../data/config'))
LOGS_DIR = os.environ.get('LOGS_DIR', os.path.join(os.path.dirname(__file__), '../data/logs'))
DATA_DIR = os.environ.get('DATA_DIR', os.path.join(os.path.dirname(__file__), '../data'))

# BASE_URL for remote and local TorchServe endpoints
BASE_URL = os.environ.get('PREDICTION_SERVICE_URL', 'https://anomalib-serving-360893797389.europe-central2.run.app')
# BASE_URL = os.environ.get('PREDICTION_SERVICE_URL', 'http://localhost:8080')


# Initialize services
camera_service = CameraService(
    camera_index=0,
    width=1280,
    height=720,
    fps=15
)

torchserve_client = TorchServeClient(BASE_URL)
collection_scheduler = CollectionScheduler(camera_service, DATA_DIR)

# In-memory state
system_state = {
    'detector_running': False,
    'last_prediction': None,
    'model_info': None,
    'logs': []
}

# Camera streaming state
camera_interval = None

# Initialize directories
def init_directories():
    Path(MODELS_DIR).mkdir(parents=True, exist_ok=True)
    Path(CONFIG_DIR).mkdir(parents=True, exist_ok=True)
    Path(LOGS_DIR).mkdir(parents=True, exist_ok=True)
    add_log('Directories initialized')

# Logging helper
def add_log(message, level='INFO'):
    timestamp = datetime.now().isoformat()
    log_entry = f'[{timestamp}] [{level}] {message}'

    system_state['logs'].append(log_entry)
    if len(system_state['logs']) > 100:
        system_state['logs'] = system_state['logs'][-100:]

    print(log_entry)

    # Write to file
    log_file = os.path.join(LOGS_DIR, f'web-server-{datetime.now().date()}.log')
    try:
        with open(log_file, 'a') as f:
            f.write(log_entry + '\n')
    except Exception as err:
        print(f'Failed to write log: {err}')

# File upload configuration
ALLOWED_EXTENSIONS = {'.onnx', '.pt', '.pth', '.h5', '.tflite', '.pb', '.jpg', '.jpeg', '.png', '.bmp'}

def allowed_file(filename):
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS

# ============================================================================
# API ROUTES
# ============================================================================

# Serve static files
@app.route('/')
def index():
    return send_from_directory('public', 'index.html')

# Health check
@app.route('/api/health', methods=['GET'])
def health_check():
    try:
        torchserve_health = torchserve_client.check_health()

        return jsonify({
            'status': 'healthy',
            'webServer': 'ok',
            'torchserve': 'ok' if torchserve_health.get('healthy') else 'unhealthy',
            'timestamp': datetime.now().isoformat()
        })
    except Exception as error:
        return jsonify({'status': 'error', 'error': str(error)}), 500

# Get system status
@app.route('/api/status', methods=['GET'])
def get_status():
    try:
        model_files = os.listdir(MODELS_DIR) if os.path.exists(MODELS_DIR) else []
        model_exists = any(f.endswith(('.onnx', '.pt', '.pth')) for f in model_files)

        model_info = None
        # Model info endpoint removed to avoid unnecessary requests

        torchserve_health = None
        try:
            torchserve_health = torchserve_client.check_health()
        except:
            pass

        config = {}
        try:
            config_path = os.path.join(CONFIG_DIR, 'settings.json')
            with open(config_path, 'r') as f:
                config = json.load(f)
        except:
            pass

        return jsonify({
            'detectorRunning': system_state['detector_running'],
            'modelUploaded': model_exists,
            'configured': len(config) > 0,
            'modelInfo': model_info,
            'torchserveHealthy': torchserve_health.get('healthy', False) if torchserve_health else False,
            'lastPrediction': system_state['last_prediction'],
            'uptime': 0,  # Python doesn't have process.uptime() equivalent
            'logs': system_state['logs'][-10:],
            'config': config,
            'predictionServiceUrl': BASE_URL
        })
    except Exception as error:
        return jsonify({'error': str(error)}), 500

# Save configuration
@app.route('/api/config', methods=['POST'])
def save_config():
    try:
        config = request.json
        config_path = os.path.join(CONFIG_DIR, 'settings.json')

        with open(config_path, 'w') as f:
            json.dump(config, f, indent=2)
        add_log('Configuration saved')

        return jsonify({'success': True, 'config': config})
    except Exception as error:
        add_log(f'Configuration save failed: {error}', 'ERROR')
        return jsonify({'error': str(error)}), 500

# Test prediction (upload image)
@app.route('/api/predict/test', methods=['POST'])
def test_prediction():
    try:
        if 'image' not in request.files:
            return jsonify({'error': 'No image provided'}), 400

        file = request.files['image']
        if file.filename == '':
            return jsonify({'error': 'No image provided'}), 400

        if not allowed_file(file.filename):
            return jsonify({'error': 'Invalid file type'}), 400

        add_log(f'Testing prediction with uploaded image: {file.filename}')

        image_buffer = file.read()

        threshold = float(request.form.get('threshold', 0.5))
        include_overlay = request.form.get('includeOverlay', 'false').lower() == 'true'

        import time
        start_time = time.time()
        result = torchserve_client.predict(image_buffer, {
            'threshold': threshold,
            'include_overlay': include_overlay
        })
        inference_time = int((time.time() - start_time) * 1000)

        result['inference_time_ms'] = inference_time

        add_log(f'Test prediction: {"ANOMALY" if result["is_anomaly"] else "NORMAL"} (score: {result["anomaly_score"]:.3f}, time: {inference_time}ms)')

        return jsonify(result)
    except Exception as error:
        add_log(f'Prediction failed: {error}', 'ERROR')
        return jsonify({'error': str(error)}), 500

# Start detector
@app.route('/api/detector/start', methods=['POST'])
def start_detector():
    try:
        if system_state['detector_running']:
            return jsonify({'error': 'Detector already running'}), 400

        config_path = os.path.join(CONFIG_DIR, 'settings.json')
        try:
            with open(config_path, 'r') as f:
                config = json.load(f)
        except:
            return jsonify({'error': 'Configuration not found'}), 400

        health_check = torchserve_client.check_health()
        if not health_check.get('healthy'):
            return jsonify({'error': 'TorchServe not ready'}), 503

        system_state['detector_running'] = True
        add_log('Detector started')

        fps = config.get('fps', 10)
        threshold = config.get('threshold', 0.5)

        add_log(f'Monitoring at {fps} FPS with threshold {threshold}')

        return jsonify({'success': True, 'status': 'running'})
    except Exception as error:
        add_log(f'Failed to start detector: {error}', 'ERROR')
        return jsonify({'error': str(error)}), 500

# Stop detector
@app.route('/api/detector/stop', methods=['POST'])
def stop_detector():
    try:
        if not system_state['detector_running']:
            return jsonify({'error': 'Detector not running'}), 400

        system_state['detector_running'] = False
        add_log('Detector stopped')

        return jsonify({'success': True, 'status': 'stopped'})
    except Exception as error:
        return jsonify({'error': str(error)}), 500

# Get logs
@app.route('/api/logs', methods=['GET'])
def get_logs():
    limit = int(request.args.get('limit', 100))
    return jsonify({'logs': system_state['logs'][-limit:]})

# ============================================================================
# CAMERA ENDPOINTS
# ============================================================================

# Camera status
@app.route('/api/camera/status', methods=['GET'])
def camera_status():
    try:
        status = camera_service.check_availability()
        return jsonify(status)
    except Exception as error:
        return jsonify({'error': str(error)}), 500

# Camera MJPEG stream
@app.route('/api/camera/stream', methods=['GET'])
def camera_stream():
    try:
        def generate():
            stream = camera_service.start_stream()
            if not stream:
                return

            try:
                for chunk in stream:
                    yield chunk
            finally:
                camera_service.stop_stream()

        return Response(
            generate(),
            mimetype='multipart/x-mixed-replace; boundary=frame',
            headers={
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            }
        )
    except Exception as error:
        add_log(f'Camera stream error: {error}', 'ERROR')
        return jsonify({'error': str(error)}), 500

# Capture frame and send to TorchServe
@app.route('/api/camera/capture', methods=['POST'])
def camera_capture():
    try:
        add_log('Capturing frame from camera...')

        image_buffer = camera_service.capture_frame()

        add_log('Frame captured, sending to TorchServe...')

        data = request.json or {}
        threshold = data.get('threshold', 0.5)
        include_overlay = data.get('includeOverlay', False)

        import time
        start_time = time.time()
        result = torchserve_client.predict(image_buffer, {
            'threshold': threshold,
            'include_overlay': include_overlay
        })
        inference_time = int((time.time() - start_time) * 1000)

        result['inference_time_ms'] = inference_time

        image_base64 = base64.b64encode(image_buffer).decode('utf-8')
        result['image'] = f'data:image/jpeg;base64,{image_base64}'

        add_log(f'Prediction: {"ANOMALY" if result["is_anomaly"] else "NORMAL"} (score: {result["anomaly_score"]:.3f}, time: {inference_time}ms)')

        return jsonify(result)
    except Exception as error:
        add_log(f'Camera capture failed: {error}', 'ERROR')
        return jsonify({'error': str(error)}), 500

# Capture single image without prediction
@app.route('/api/camera/take_image', methods=['POST'])
def take_single_image():
    try:
        add_log('Capturing single image...')

        # Get camera status first
        camera_status = camera_service.check_availability()
        if not camera_status.get('available', False):
            error_msg = camera_status.get('error', 'Camera not available')
            add_log(f'Camera not available: {error_msg}', 'ERROR')
            return jsonify({'error': error_msg, 'camera_status': camera_status}), 400

        image_buffer = camera_service.capture_frame()

        add_log('Single image captured')

        data = request.json or {}
        threshold = data.get('threshold', 0.5)
        include_overlay = data.get('includeOverlay', False)

        import time
        start_time = time.time()
        result = torchserve_client.predict(image_buffer, {
            'threshold': threshold,
            'include_overlay': include_overlay
        })
        inference_time = int((time.time() - start_time) * 1000)

        result['inference_time_ms'] = inference_time

        # Base64 encode the image to match frontend expectations
        image_base64 = base64.b64encode(image_buffer).decode('utf-8')
        result['image'] = image_base64

        add_log(f'Prediction: {"ANOMALY" if result["is_anomaly"] else "NORMAL"} (score: {result["anomaly_score"]:.3f}, time: {inference_time}ms)')

        return jsonify(result)
    except Exception as error:
        add_log(f'Single image capture failed: {error}', 'ERROR')
        # Provide a more detailed error response
        return jsonify({
            'error': str(error),
            'details': {
                'camera_status': camera_service.check_availability(),
                'torchserve_status': torchserve_client.check_health()
            }
        }), 500

# ============================================================================
# COLLECTION ENDPOINTS
# ============================================================================

# Start collection
@app.route('/api/collection/start', methods=['POST'])
def start_collection():
    try:
        result = collection_scheduler.start_collection(request.json)
        add_log(f'Data collection started: {result["folderName"]}')
        return jsonify({'success': True, **result})
    except Exception as error:
        add_log(f'Failed to start collection: {error}', 'ERROR')
        return jsonify({'error': str(error)}), 400

# Get collection status
@app.route('/api/collection/status', methods=['GET'])
def collection_status():
    try:
        status = collection_scheduler.get_status()
        return jsonify(status)
    except Exception as error:
        return jsonify({'error': str(error)}), 500

# Pause collection
@app.route('/api/collection/pause', methods=['POST'])
def pause_collection():
    try:
        collection_scheduler.pause_collection()
        add_log('Collection paused')
        return jsonify({'success': True})
    except Exception as error:
        add_log(f'Failed to pause collection: {error}', 'ERROR')
        return jsonify({'error': str(error)}), 400

# Resume collection
@app.route('/api/collection/resume', methods=['POST'])
def resume_collection():
    try:
        collection_scheduler.resume_collection()
        add_log('Collection resumed')
        return jsonify({'success': True})
    except Exception as error:
        add_log(f'Failed to resume collection: {error}', 'ERROR')
        return jsonify({'error': str(error)}), 400

# Cancel collection
@app.route('/api/collection/cancel', methods=['POST'])
def cancel_collection():
    try:
        data = request.json or {}
        delete_images = data.get('deleteImages', False)
        collection_scheduler.cancel_collection(delete_images)
        add_log(f'Collection cancelled (images {"deleted" if delete_images else "kept"})')
        return jsonify({'success': True})
    except Exception as error:
        add_log(f'Failed to cancel collection: {error}', 'ERROR')
        return jsonify({'error': str(error)}), 400

# List collection folders
@app.route('/api/collection/folders', methods=['GET'])
def list_folders():
    try:
        folders = collection_scheduler.list_collections()
        return jsonify({'folders': folders})
    except Exception as error:
        return jsonify({'error': str(error)}), 500

# Get images in a folder
@app.route('/api/collection/folders/<folder_name>/images', methods=['GET'])
def get_folder_images(folder_name):
    try:
        images = collection_scheduler.get_folder_images(folder_name)
        return jsonify({'images': images})
    except Exception as error:
        return jsonify({'error': str(error)}), 500

# Serve a specific image
@app.route('/api/collection/folders/<folder_name>/images/<image_name>', methods=['GET'])
def serve_image(folder_name, image_name):
    try:
        image_path = os.path.join(DATA_DIR, 'training_data', folder_name, image_name)
        return send_file(image_path)
    except Exception as error:
        return jsonify({'error': str(error)}), 500

# Download folder as zip
@app.route('/api/collection/folders/<folder_name>/download', methods=['GET'])
def download_folder(folder_name):
    try:
        import zipfile
        from io import BytesIO

        folder_path = os.path.join(DATA_DIR, 'training_data', folder_name)

        memory_file = BytesIO()
        with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(folder_path):
                for file in files:
                    file_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_path, folder_path)
                    zf.write(file_path, arcname)

        memory_file.seek(0)
        return send_file(
            memory_file,
            mimetype='application/zip',
            as_attachment=True,
            download_name=f'{folder_name}.zip'
        )
    except Exception as error:
        return jsonify({'error': str(error)}), 500

# Delete folder
@app.route('/api/collection/folders/<folder_name>', methods=['DELETE'])
def delete_folder(folder_name):
    try:
        collection_scheduler.delete_collection(folder_name)
        add_log(f'Deleted collection: {folder_name}')
        return jsonify({'success': True})
    except Exception as error:
        add_log(f'Failed to delete collection: {error}', 'ERROR')
        return jsonify({'error': str(error)}), 500

# ============================================================================
# STARTUP
# ============================================================================

def startup():
    try:
        init_directories()

        try:
            health = torchserve_client.check_health()
            if health.get('healthy'):
                add_log(f'Connected to TorchServe at {BASE_URL}')
            else:
                add_log(f'Warning: TorchServe not healthy at {BASE_URL}', 'WARN')
        except:
            add_log(f'Warning: TorchServe not reachable at {BASE_URL}', 'WARN')

        add_log(f'Web server running on port {PORT}')
        add_log(f'Access at: http://localhost:{PORT}')
    except Exception as error:
        print(f'Startup failed: {error}')
        exit(1)

if __name__ == '__main__':
    startup()
    app.run(host='0.0.0.0', port=PORT, debug=False)
