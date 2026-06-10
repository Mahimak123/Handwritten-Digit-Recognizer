// Canvas and drawing context
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const previewCanvas = document.getElementById("preview-canvas");
const ctxPreview = previewCanvas.getContext("2d");

// App state
let drawing = false;
let soundEnabled = true;
let currentBrushSize = 20;

// Initialize Main Drawing Canvas
function initCanvas() {
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.strokeStyle = "white";
    ctx.lineWidth = currentBrushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    
    // Clear preview canvas
    ctxPreview.fillStyle = "black";
    ctxPreview.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
}

// Mouse events for drawing
canvas.addEventListener("mousedown", (e) => {
    drawing = true;
    draw(e);
});

canvas.addEventListener("mouseup", () => {
    drawing = false;
    ctx.beginPath();
    updatePreview();
});

canvas.addEventListener("mouseleave", () => {
    drawing = false;
    ctx.beginPath();
});

canvas.addEventListener("mousemove", draw);

// Touch events for drawing (mobile)
canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    drawing = true;
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent("mousedown", {
        clientX: touch.clientX,
        clientY: touch.clientY
    });
    canvas.dispatchEvent(mouseEvent);
});

canvas.addEventListener("touchend", (e) => {
    e.preventDefault();
    drawing = false;
    ctx.beginPath();
    updatePreview();
});

canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent("mousemove", {
        clientX: touch.clientX,
        clientY: touch.clientY
    });
    canvas.dispatchEvent(mouseEvent);
});

function draw(event) {
    if (!drawing) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    ctx.lineWidth = currentBrushSize;
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
    
    // Smoothly update live preview as they draw
    updatePreview();
}

// Update the 28x28 visual preview canvas
function updatePreview() {
    // Clear preview
    ctxPreview.fillStyle = "black";
    ctxPreview.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    
    // Draw scaled down main canvas onto preview canvas
    ctxPreview.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, 28, 28);
}

// Brush size slider input
const brushSlider = document.getElementById("brush-slider");
const brushVal = document.getElementById("brush-val");

brushSlider.addEventListener("input", (e) => {
    currentBrushSize = parseInt(e.target.value);
    brushVal.innerText = `${currentBrushSize}px`;
    ctx.lineWidth = currentBrushSize;
});

// Clear canvas fully
function clearCanvas() {
    initCanvas();
    
    // Reset dashboard prediction values
    document.getElementById("result").innerText = "-";
    document.getElementById("confidence-percentage").innerText = "0%";
    document.getElementById("response-time").innerText = "0 ms";
    
    // Reset probability bars with placeholder
    const container = document.getElementById("prob-bars-container");
    container.innerHTML = `
        <div class="no-data-placeholder">
            <i class="fa-solid fa-chart-bar"></i>
            <p>Draw and predict to view confidence distribution</p>
        </div>
    `;
    
    // Reset result animations
    document.getElementById("result").classList.remove("error-glow", "success-glow");
}

// Predict digit by calling Flask backend API
async function predictDigit() {
    const loading = document.getElementById("loading");
    const resultElement = document.getElementById("result");
    const confidenceVal = document.getElementById("confidence-percentage");
    const timeVal = document.getElementById("response-time");
    const engineVal = document.getElementById("engine-type");
    const probContainer = document.getElementById("prob-bars-container");
    
    // Activate loading circle and reset result states
    loading.classList.add("active");
    resultElement.classList.remove("error-glow", "success-glow");
    resultElement.innerText = "...";
    
    // Capture base64 canvas image data URL
    const image = canvas.toDataURL("image/png");
    
    const startTime = performance.now();
    
    try {
        const response = await fetch("/predict", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ image: image })
        });
        
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || `HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        // Hide loading
        loading.classList.remove("active");
        
        // Render digit result with neon success glow
        resultElement.innerText = data.digit;
        resultElement.classList.add("success-glow");
        
        // Update Telemetry indicators
        confidenceVal.innerText = `${Math.round(data.confidence * 100)}%`;
        timeVal.innerText = `${data.inference_time_ms} ms`;
        engineVal.innerText = data.engine;
        
        // Render detailed Top-3 probability bars
        renderProbabilities(data.predictions);
        
        // Audio Chime feedback
        if (soundEnabled) {
            const chime = document.getElementById("predict-sound");
            chime.currentTime = 0;
            chime.play().catch(e => console.log("Audio failed to play: ", e));
        }
        
    } catch (error) {
        console.error("Prediction API Error:", error);
        
        loading.classList.remove("active");
        resultElement.innerText = "?";
        resultElement.classList.add("error-glow");
        
        confidenceVal.innerText = "Error";
        timeVal.innerText = "0 ms";
        
        // Friendly detailed explanation on Render starting/failure
        probContainer.innerHTML = `
            <div class="error-msg-box">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <h4>Prediction Failed</h4>
                <p>${error.message}</p>
                <div style="margin: 15px 0;">
                    <a href="/status" target="_blank" class="btn btn-secondary" style="padding: 10px 18px; font-size: 0.85rem; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; border-radius: 12px; width: 100%; border: var(--border-glass);">
                        <i class="fa-solid fa-square-poll-vertical"></i> View Server Diagnostics
                    </a>
                </div>
                <span class="warning-tip">If the project was just deployed on Render, the backend container might be booting up. Please wait 30 seconds and try again!</span>
            </div>
        `;
    }
}

// Generate Top-3 probability progress bars
function renderProbabilities(predictions) {
    const container = document.getElementById("prob-bars-container");
    container.innerHTML = ""; // Clear placeholders/previous bars
    
    predictions.forEach((item) => {
        const percentage = Math.round(item.probability * 100);
        
        const row = document.createElement("div");
        row.className = "prob-row";
        row.innerHTML = `
            <span class="prob-number">Digit ${item.digit}</span>
            <div class="prob-track">
                <div class="prob-fill" style="width: 0%"></div>
            </div>
            <span class="prob-percentage">${percentage}%</span>
        `;
        
        container.appendChild(row);
        
        // Trigger smooth transition animation
        setTimeout(() => {
            row.querySelector(".prob-fill").style.width = `${percentage}%`;
        }, 80);
    });
}

// Control Bar: Sound Settings
function toggleSound() {
    const soundBtn = document.getElementById("sound-toggle");
    soundEnabled = !soundEnabled;
    
    if (soundEnabled) {
        soundBtn.classList.add("active");
        soundBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
    } else {
        soundBtn.classList.remove("active");
        soundBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
    }
}

// Control Bar: Dark / Light Mode Switch
function toggleTheme() {
    const body = document.body;
    const themeBtn = document.getElementById("theme-btn");
    
    if (body.classList.contains("dark-theme")) {
        body.classList.remove("dark-theme");
        body.classList.add("light-theme");
        themeBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
    } else {
        body.classList.remove("light-theme");
        body.classList.add("dark-theme");
        themeBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
    }
}

// Ambient Cursor Glow Motion
const glow = document.querySelector(".cursor-glow");
document.addEventListener("mousemove", (e) => {
    glow.style.left = `${e.clientX}px`;
    glow.style.top = `${e.clientY}px`;
});

// Ambient Particles Creation (Floating visual grid background)
function initParticles() {
    const particlesContainer = document.getElementById("particles");
    particlesContainer.innerHTML = "";
    
    const count = 35;
    for (let i = 0; i < count; i++) {
        const p = document.createElement("div");
        p.className = "particle";
        p.style.left = `${Math.random() * 100}vw`;
        p.style.animationDuration = `${6 + Math.random() * 12}s`;
        p.style.opacity = Math.random() * 0.45;
        p.style.width = `${3 + Math.random() * 4}px`;
        p.style.height = p.style.width;
        particlesContainer.appendChild(p);
    }
}

// App Startup Initializer
window.addEventListener("DOMContentLoaded", () => {
    initCanvas();
    initParticles();
});