from flask import Flask, render_template, request, jsonify
import numpy as np
import cv2
import base64
import os
import time
import traceback

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
app = Flask(__name__)

TFLITE_PATH = "digit_model.tflite"
H5_PATH = "digit_model.h5"

interpreter = None
input_details = None
output_details = None
model_h5 = None
model_engine = "None"

model_status = {
    "engine": "None",
    "tflite": {
        "status": "not_loaded",
        "error": None
    },
    "keras": {
        "status": "not_loaded",
        "error": None
    }
}

# Initialize model
try:
    if os.path.exists(TFLITE_PATH):
        try:
            import tflite_runtime.interpreter as tflite
        except (ImportError, ValueError) as imp_err:
            try:
                import tensorflow.lite as tflite
            except (ImportError, ValueError):
                try:
                    import tensorflow.lite.interpreter as tflite
                except (ImportError, ValueError) as final_imp_err:
                    raise ImportError(f"Could not import tflite_runtime or tensorflow.lite: {imp_err} / {final_imp_err}")
        
        interpreter = tflite.Interpreter(model_path=TFLITE_PATH)
        interpreter.allocate_tensors()
        input_details = interpreter.get_input_details()
        output_details = interpreter.get_output_details()
        model_engine = "TFLite"
        model_status["engine"] = "TFLite"
        model_status["tflite"]["status"] = "success"
        print("Loaded TFLite model successfully!")
    else:
        raise FileNotFoundError("TFLite model file not found.")
except Exception as e:
    err_msg = f"{type(e).__name__}: {str(e)}\n{traceback.format_exc()}"
    model_status["tflite"]["status"] = "failed"
    model_status["tflite"]["error"] = err_msg
    print(f"TFLite model loading failed: {e}. Falling back to Keras H5 model...")
    
    try:
        import tensorflow as tf
        model_h5 = tf.keras.models.load_model(H5_PATH, compile=False)
        model_engine = "Keras H5"
        model_status["engine"] = "Keras H5"
        model_status["keras"]["status"] = "success"
        print("Loaded Keras H5 model successfully!")
    except Exception as ex:
        ex_msg = f"{type(ex).__name__}: {str(ex)}\n{traceback.format_exc()}"
        model_status["keras"]["status"] = "failed"
        model_status["keras"]["error"] = ex_msg
        print(f"Critical Error: Failed to load Keras model: {ex}")
        model_engine = "None"
        model_status["engine"] = "None"

def preprocess_canvas_image(image):
    # Convert to grayscale
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # Resize to 28x28
    gray = cv2.resize(gray, (28, 28))
    
    # Normalize to [0.0, 1.0]
    gray = gray.astype("float32") / 255.0
    
    # Reshape for CNN model input: (1, 28, 28, 1)
    gray = gray.reshape(1, 28, 28, 1)
    
    return gray

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/status")
def status():
    return jsonify({
        "model_status": model_status,
        "tflite_path_exists": os.path.exists(TFLITE_PATH),
        "h5_path_exists": os.path.exists(H5_PATH),
        "python_version": os.sys.version,
        "platform": os.sys.platform,
        "numpy_version": np.__version__
    })


@app.route("/predict", methods=["POST"])
def predict():
    start_time = time.time()
    try:
        if model_engine == "None":
            return jsonify({"error": "No model is currently loaded on the server."}), 500

        data = request.json.get("image")
        if not data:
            return jsonify({"error": "No image data provided"}), 400

        # Extract base64 image data
        encoded = data.split(",")[1]
        decoded = base64.b64decode(encoded)
        np_data = np.frombuffer(decoded, np.uint8)
        image = cv2.imdecode(np_data, cv2.IMREAD_COLOR)

        if image is None:
            return jsonify({"error": "Failed to decode drawing canvas image."}), 400

        # Preprocess
        processed = preprocess_canvas_image(image)

        # Run Prediction based on available engine
        if model_engine == "TFLite":
            interpreter.set_tensor(input_details[0]['index'], processed)
            interpreter.invoke()
            prediction = interpreter.get_tensor(output_details[0]['index'])[0]
        else:
            prediction = model_h5.predict(processed, verbose=0)[0]

        # Calculate prediction details response 
        digit = int(np.argmax(prediction))
        confidence = float(prediction[digit])
        
        # Get Top-3 Predictions with confidence percentages for visual probability charts
        top_indices = np.argsort(prediction)[::-1][:3]
        top_predictions = [
            {"digit": int(idx), "probability": float(prediction[idx])}
            for idx in top_indices
        ]

        inference_time_ms = round((time.time() - start_time) * 1000, 2)

        return jsonify({
            "digit": digit,
            "confidence": confidence,
            "predictions": top_predictions,
            "engine": model_engine,
            "inference_time_ms": inference_time_ms
        })

    except Exception as e:
        print(f"Prediction error: {e}")
        return jsonify({"error": f"Inference failure: {str(e)}"}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)