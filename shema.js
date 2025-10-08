const requestSchema =    {
   {
  "data": "<base64-encoded-image-string>",
  "threshold": 0.6,                // optional, float between 0 and 1
  "include_overlay": true           // optional, boolean
}
    }

const responseSchema = {
  "predictions": [
    { "class": "normal", "probability": 0.9876 },
    { "class": "anomalous", "probability": 0.0124 }
  ],
  "predicted_class": "normal",           // or "anomalous"
  "threshold": 0.5,                      // or custom value
  "overlay": "<base64 PNG>",             // only if include_overlay=True and overlay generated
  "visualization_error": "...",          // only if overlay generation failed
  "error": "..."                         // only if inference/postprocessing failed
}

export const PREDICTION_URL = 'https://anomalib-serving-360893797389.europe-central2.run.app/predictions/model';
export const HEALTH_URL = 'https://anomalib-serving-360893797389.europe-central2.run.app/ping'
