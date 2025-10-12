"""
TorchServe Client - Handles communication with Anomalib TorchServe container
"""

import base64
import requests
import json
import io
# from PIL import Image  # Commented out as preprocess_image is commented
# import torchvision.transforms as transforms  # Commented out as preprocess_image is commented
# import torchvision.transforms.functional as F  # Commented out as preprocess_image is commented

# # ImageNet normalization parameters  # Commented out as preprocess_image is commented
# IMAGENET_MEAN = [0.485, 0.456, 0.406]  # Commented out as preprocess_image is commented
# IMAGENET_STD = [0.229, 0.224, 0.225]  # Commented out as preprocess_image is commented


class TorchServeClient:
    def __init__(self, base_url=None):
        self.base_url = base_url or 'http://prediction-server:8080'
        self.predict_url = f'{self.base_url}/predictions/model'
        self.health_url = f'{self.base_url}/ping'

    # def preprocess_image(self, image_buffer):
    #     """
    #     Preprocess image for Patchcore inference.
    #     Resizes to 256x256, normalizes with ImageNet parameters, and converts to PNG.

    #     Args:
    #         image_buffer: bytes - Raw image data (JPEG/PNG)

    #     Returns:
    #         str - Base64 encoded preprocessed image
    #     """
    #     # Open and convert image to RGB
    #     pil_image = Image.open(io.BytesIO(image_buffer)).convert('RGB')

    #     # Create preprocessing transform
    #     transform = transforms.Compose([
    #         transforms.Resize((256, 256), interpolation=transforms.InterpolationMode.BICUBIC),
    #         transforms.ToTensor(),
    #         transforms.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD)
    #     ])

    #     # Apply transform
    #     processed_tensor = transform(pil_image)

    #     # Convert tensor back to PIL image and then to base64 PNG
    #     buffer = io.BytesIO()
    #     F.to_pil_image(processed_tensor).save(buffer, format='PNG')
    #     base64_image = base64.b64encode(buffer.getvalue()).decode('utf-8')

    #     return base64_image

    def check_health(self):
        """Check if TorchServe is healthy"""
        try:
            response = requests.get(self.health_url, timeout=5)
            return {
                'healthy': response.ok,
                'status': response.status_code
            }
        except Exception as error:
            return {
                'healthy': False,
                'error': str(error)
            }

    def predict(self, image_buffer, options=None):
        """
        Predict anomaly from image buffer

        Args:
            image_buffer: bytes - JPEG/PNG image buffer
            options: dict - Prediction options
                - threshold: float - Anomaly threshold (0-1)
                - include_overlay: bool - Include visualization overlay

        Returns:
            dict - Prediction result
        """
        if options is None:
            options = {}

        threshold = options.get('threshold', 0.5)
        include_overlay = options.get('include_overlay', False)

        try:
            # Directly convert image to base64 without preprocessing
            print(f'[TorchServe] Encoding image...')
            image_base64 = base64.b64encode(image_buffer).decode('utf-8')
            print(f'[TorchServe] Image encoded (base64 length: {len(image_base64)} chars)')

            # Prepare payload matching handler's expected format
            payload = {
                'data': image_base64,
                'threshold': threshold,
                'include_overlay': include_overlay,
                'image_size': None  # No preprocessing, original image size
            }

            print(f'[TorchServe] Sending prediction request to {self.predict_url}')
            print(f'[TorchServe] Parameters: threshold={threshold}, overlay={include_overlay}')

            # Send POST request to TorchServe (increased timeout for remote servers)
            response = requests.post(
                self.predict_url,
                headers={'Content-Type': 'application/json'},
                json=payload,  # Use json parameter instead of data + json.dumps
                timeout=120  # Increased to 2 minutes for remote servers
            )

            print(f'[TorchServe] Response status: {response.status_code}')

            if not response.ok:
                error_text = response.text
                raise Exception(f'TorchServe error ({response.status_code}): {error_text}')

            result = response.json()
            print(f'[TorchServe] Prediction received: {json.dumps(result, indent=2)}')

            # Parse TorchServe response format
            return self.parse_response(result)

        except requests.exceptions.ConnectionError as error:
            print(f'[TorchServe] Connection failed to {self.predict_url}: {error}')
            raise Exception(f'Cannot connect to TorchServe at {self.predict_url}. Is the prediction service running?')
        except requests.exceptions.Timeout as error:
            print(f'[TorchServe] Request timeout: {error}')
            raise Exception('Prediction request timed out after 2 minutes. The remote server may be cold-starting or overloaded.')
        except Exception as error:
            print(f'[TorchServe] Prediction failed: {error}')
            raise Exception(f'Prediction failed: {error}')

    def parse_response(self, torchserve_result):
        """Parse TorchServe response to standardized format"""
        # Handle array response (TorchServe may wrap in array)
        result = torchserve_result[0] if isinstance(torchserve_result, list) else torchserve_result

        # Extract anomaly score from predictions array
        anomaly_prediction = None
        if result.get('predictions'):
            anomaly_prediction = next(
                (p for p in result['predictions'] if p.get('class') == 'anomalous'),
                None
            )
        anomaly_score = anomaly_prediction.get('probability', 0) if anomaly_prediction else 0

        # Return standardized format matching what UI expects
        return {
            'anomaly_score': anomaly_score,
            'is_anomaly': result.get('predicted_class') == 'anomalous',
            'predicted_class': result.get('predicted_class'),
            'threshold_used': result.get('threshold'),
            'predictions': result.get('predictions'),
            'overlay': result.get('overlay'),
            'inference_time_ms': 0  # TorchServe doesn't provide this
        }

