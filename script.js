// Global variables
// Global variables
let webcam, overlayCanvas, whiteboardCanvas;
let overlayCtx, whiteboardCtx;
let videoWidth, videoHeight;
let trapezoidPoints = [];
let isWhiteboardMode = false;
let gl, program;
let positionLocation, texCoordLocation;
let matrixLocation, resolutionLocation;

// Global variable to control initial phase ('setup' or 'whiteboard')
// Set to 'whiteboard' for debugging purposes as requested.
let initialPhase = 'whiteboard'; 

// Global variable for the rotating triangle's angle
let triangleAngle = 0;

// Global constants for initial trapezoid ratios, derived from the CSS #trapezoid-overlay clip-path
// These ensure the drawn trapezoid aligns with the visual guide.
// The #trapezoid-overlay has width: 80% and is centered (10% margin on each side).
// Its clip-path defines points relative to its own 80% width.
// Bottom points: 0% and 100% of its 80% width -> effectively 10% and 90% of videoWidth.
const INITIAL_BOTTOM_WIDTH_RATIO = 0.8; // (0.9 - 0.1)
// Top points: 15% and 85% of its 80% width -> effectively (0.1 + 0.15*0.8) and (0.1 + 0.85*0.8) of videoWidth
// -> 0.22 and 0.78 of videoWidth. Width = 0.78 - 0.22 = 0.56.
const INITIAL_TOP_WIDTH_RATIO = 0.56;
// The #trapezoid-overlay has height: 60% and bottom: 0. Top of div is at 40% of videoHeight.
// Its clip-path's 0% height is the top of the div, 100% height is the bottom of the div.
// So, the drawn trapezoid's bottom Y will be videoHeight, and its top Y will be 0.4 * videoHeight.
// This means the effective height is 0.6 * videoHeight.
const INITIAL_TRAPEZOID_HEIGHT_RATIO = 0.6;

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Get DOM elements
    webcam = document.getElementById('webcam');
    overlayCanvas = document.getElementById('overlay-canvas');
    whiteboardCanvas = document.getElementById('whiteboard-canvas');
    overlayCtx = overlayCanvas.getContext('2d');
    // whiteboardCtx is no longer initialized here, as whiteboardCanvas will be used for WebGL.
    
    // Set up event listeners
    document.getElementById('start-btn').addEventListener('click', startWhiteboardMode);
    document.getElementById('back-btn').addEventListener('click', backToSetupMode);
    document.getElementById('clear-btn').addEventListener('click', clearWhiteboard);
    document.getElementById('save-btn').addEventListener('click', saveWhiteboard);
    document.getElementById('minus-btn').addEventListener('click', () => adjustZoom(-5));
    document.getElementById('plus-btn').addEventListener('click', () => adjustZoom(5));
    document.getElementById('zoom-slider').addEventListener('input', handleZoomSlider);
    
    // Initialize webcam
    initWebcam();

    // Handle initial phase display based on the global variable
    if (initialPhase === 'whiteboard') {
        document.getElementById('setup-view').style.display = 'none';
        document.getElementById('whiteboard-view').style.display = 'flex';
        document.getElementById('whiteboard-view').style.opacity = '1';
        isWhiteboardMode = true; // Set mode immediately
    } else {
        document.getElementById('setup-view').classList.add('active'); // Ensure setup view is active initially
    }
});

// Initialize webcam access
async function initWebcam() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'environment' // Use back camera if available
            }
        });
        
        webcam.srcObject = stream;
        
        // Wait for video metadata to load
        webcam.onloadedmetadata = () => {
            videoWidth = webcam.videoWidth;
            videoHeight = webcam.videoHeight;
            
            // Set canvas dimensions to match video
            overlayCanvas.width = videoWidth;
            overlayCanvas.height = videoHeight;
            whiteboardCanvas.width = videoWidth;
            whiteboardCanvas.height = videoHeight;
            
            // Calculate trapezoid points based on video dimensions
            calculateTrapezoidPoints();
            
            // Start drawing loop
            requestAnimationFrame(drawLoop);
            
            // If starting directly in whiteboard mode, ensure WebGL is initialized after canvas is ready
            if (initialPhase === 'whiteboard') {
                if (!isWebGLInitialized) {
                    // Defer WebGL initialization with a short timeout.
                    // This gives the browser more time to fully render the canvas 
                    // with its new dimensions and visibility before attempting to get the WebGL context.
                    setTimeout(() => {
                        requestAnimationFrame(() => { // Still good to sync with rendering cycle
                            initWebGL();
                            isWebGLInitialized = true;
                        });
                    }, 2000); // 2000ms delay
                }
            }
        };
    } catch (error) {
        console.error('Error accessing webcam:', error);
        alert('Unable to access webcam. Please ensure you have granted camera permissions.');
    }
}

// Global flag to ensure WebGL is initialized only once
let isWebGLInitialized = false;

// Calculate trapezoid points based on video dimensions and zoom factor
function calculateTrapezoidPoints(zoomFactor = 1.0) {
    const width = videoWidth;
    const height = videoHeight;

    // Anchor the bottom of the trapezoid to the bottom of the canvas
    const bottomY = height;

    // Calculate current dimensions based on initial ratios and zoom factor
    const currentTrapezoidHeight = INITIAL_TRAPEZOID_HEIGHT_RATIO * height * zoomFactor;
    const currentBottomWidth = INITIAL_BOTTOM_WIDTH_RATIO * width * zoomFactor;
    const currentTopWidth = INITIAL_TOP_WIDTH_RATIO * width * zoomFactor;

    // Ensure trapezoid doesn't go out of bounds (top Y should not be negative)
    const topY = Math.max(0, bottomY - currentTrapezoidHeight);

    // Calculate horizontal positions, centered
    const bottomLeftX = (width - currentBottomWidth) / 2;
    const bottomRightX = (width + currentBottomWidth) / 2;
    const topLeftX = (width - currentTopWidth) / 2;
    const topRightX = (width + currentTopWidth) / 2;

    // Define trapezoid points (clockwise from bottom-left)
    trapezoidPoints = [
        [bottomLeftX, bottomY],  // Bottom-left
        [bottomRightX, bottomY], // Bottom-right
        [topRightX, topY],       // Top-right
        [topLeftX, topY]         // Top-left
    ];
}

// Main drawing loop
function drawLoop() {
    if (!isWhiteboardMode) {
        // Draw video frame to overlay canvas
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        
        // Draw trapezoid outline
        drawTrapezoid();
    } else {
        // Process video frame with perspective correction
        processVideoFrame();
    }
    
    // Continue the loop
    requestAnimationFrame(drawLoop);
}

// Draw trapezoid outline on overlay canvas
function drawTrapezoid() {
    // Draw semi-transparent overlay
    overlayCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    overlayCtx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    
    // Create clipping path for trapezoid
    overlayCtx.beginPath();
    overlayCtx.moveTo(trapezoidPoints[0][0], trapezoidPoints[0][1]);
    
    for (let i = 1; i < trapezoidPoints.length; i++) {
        overlayCtx.lineTo(trapezoidPoints[i][0], trapezoidPoints[i][1]);
    }
    
    overlayCtx.closePath();
    
    // Clear the trapezoid area
    overlayCtx.save();
    overlayCtx.clip();
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    overlayCtx.restore();
    
    // Draw trapezoid outline
    overlayCtx.beginPath();
    overlayCtx.moveTo(trapezoidPoints[0][0], trapezoidPoints[0][1]);
    
    for (let i = 1; i < trapezoidPoints.length; i++) {
        overlayCtx.lineTo(trapezoidPoints[i][0], trapezoidPoints[i][1]);
    }
    
    overlayCtx.closePath();
    overlayCtx.strokeStyle = 'white';
    overlayCtx.lineWidth = 3;
    overlayCtx.stroke();
}

// Initialize WebGL for perspective correction
function initWebGL() {
    console.log('Attempting to initialize WebGL...');
    console.log('whiteboardCanvas element:', whiteboardCanvas);
    if (whiteboardCanvas) {
        console.log('whiteboardCanvas dimensions: width=', whiteboardCanvas.width, 'height=', whiteboardCanvas.height);
    } else {
        console.error('whiteboardCanvas element is not found or not ready.');
        alert('Critical error: Whiteboard canvas element not found.');
        return;
    }

    // Get WebGL context
    gl = whiteboardCanvas.getContext('webgl', { preserveDrawingBuffer: true }) || 
         whiteboardCanvas.getContext('experimental-webgl', { preserveDrawingBuffer: true });
    
    if (!gl) {
        console.error('WebGL not supported. getContext() returned null.');
        alert('Your browser does not support WebGL, which is required for this application.');
        return;
    }
    console.log('WebGL context obtained successfully!');
    
    // Get shader sources
    const vertexShaderSource = document.getElementById('vertex-shader').text;
    const fragmentShaderSource = document.getElementById('fragment-shader').text;
    
    // Create shader program
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    program = createProgram(gl, vertexShader, fragmentShader);
    
    // Look up attribute locations
    positionLocation = gl.getAttribLocation(program, 'a_position');
    texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');
    
    // Look up uniform locations
    resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
    matrixLocation = gl.getUniformLocation(program, 'u_matrix');
    
    // Create buffers
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    setRectangle(gl, 0, 0, videoWidth, videoHeight);
    
    const texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0.0, 0.0,
        1.0, 0.0,
        0.0, 1.0,
        0.0, 1.0,
        1.0, 0.0,
        1.0, 1.0
    ]), gl.STATIC_DRAW);
    
    // Create texture
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    
    // Set texture parameters
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}

// Create shader helper function
function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (success) {
        return shader;
    }
    
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
}

// Create program helper function
function createProgram(gl, vertexShader, fragmentShader) {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    
    const success = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (success) {
        return program;
    }
    
    console.error(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
}

// Set rectangle helper function
function setRectangle(gl, x, y, width, height) {
    const x1 = x;
    const x2 = x + width;
    const y1 = y;
    const y2 = y + height;
    
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        x1, y1,
        x2, y1,
        x1, y2,
        x1, y2,
        x2, y1,
        x2, y2
    ]), gl.STATIC_DRAW);
}

// Process video frame with perspective correction
function processVideoFrame() {
    if (!gl) return;
    
    // Tell WebGL how to convert from clip space to pixels
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    
    // Clear the canvas
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    // Tell it to use our program (pair of shaders)
    gl.useProgram(program);
    
    // Turn on the position attribute
    gl.enableVertexAttribArray(positionLocation);
    
    // Bind the position buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    setRectangle(gl, 0, 0, videoWidth, videoHeight);
    
    // Tell the position attribute how to get data out of positionBuffer
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    
    // Turn on the texCoord attribute
    gl.enableVertexAttribArray(texCoordLocation);
    
    // Bind the texCoord buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0.0, 0.0,
        1.0, 0.0,
        0.0, 1.0,
        0.0, 1.0,
        1.0, 0.0,
        1.0, 1.0
    ]), gl.STATIC_DRAW);
    
    // Tell the texCoord attribute how to get data out of texCoordBuffer
    gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);
    
    // Set the resolution
    gl.uniform2f(resolutionLocation, gl.canvas.width, gl.canvas.height);
    
    // Calculate perspective transformation matrix
    const matrix = calculatePerspectiveMatrix();
    gl.uniformMatrix3fv(matrixLocation, false, matrix);
    
    // Update the texture with the current video frame
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, webcam);
    
    // Draw the rectangle
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // --- Additional render: Draw a small rotating triangle (Temporarily Commented Out) ---
    // The following code for drawing the triangle used whiteboardCtx, which is no longer
    // initialized for whiteboardCanvas as it's now dedicated to WebGL.
    // To re-enable the triangle, it would need to be drawn on a separate 2D overlay canvas
    // or rendered using WebGL.
    /*
    if (whiteboardCtx) { // Guard in case it was initialized elsewhere, though it shouldn't be
        whiteboardCtx.save();
        
        // Position in top-right corner, with some padding
        const triangleSize = 20; // Half-side length for equilateral triangle
        const padding = 30;
        const triangleX = whiteboardCanvas.width - padding;
        const triangleY = padding;

        whiteboardCtx.translate(triangleX, triangleY);
        whiteboardCtx.rotate(triangleAngle);
        
        whiteboardCtx.beginPath();
        // Equilateral triangle points relative to (0,0) after translation
        whiteboardCtx.moveTo(0, -triangleSize); // Top point
        whiteboardCtx.lineTo(triangleSize * Math.sqrt(3) / 2, triangleSize / 2); // Bottom-right point
        whiteboardCtx.lineTo(-triangleSize * Math.sqrt(3) / 2, triangleSize / 2); // Bottom-left point
        whiteboardCtx.closePath();
        
        whiteboardCtx.fillStyle = 'red';
        whiteboardCtx.fill();
        whiteboardCtx.restore();

        triangleAngle += 0.05; // Increment rotation angle for next frame
    }
    */
    triangleAngle += 0.05; // Keep angle updating if triangle is re-enabled later
}

// Calculate perspective transformation matrix
function calculatePerspectiveMatrix() {
    // Source points (trapezoid corners in normalized coordinates)
    const srcPoints = trapezoidPoints.map(point => [
        point[0] / videoWidth,
        point[1] / videoHeight
    ]);
    
    // Destination points (rectangle corners in normalized coordinates)
    // The goal is to map the paper's actual orientation to the output canvas correctly:
    // - Paper's Top-Left (PTL) should map to Output Top-Left [0,0]
    // - Paper's Top-Right (PTR) should map to Output Top-Right [1,0]
    // - Paper's Bottom-Left (PBL) should map to Output Bottom-Left [0,1]
    // - Paper's Bottom-Right (PBR) should map to Output Bottom-Right [1,1]

    // From setup analysis, the trapezoidPoints correspond to paper corners as follows:
    // trapezoidPoints[0] (Trapezoid's Bottom-Left) is Paper's Top-Right (PTR)
    // trapezoidPoints[1] (Trapezoid's Bottom-Right) is Paper's Top-Left (PTL)
    // trapezoidPoints[2] (Trapezoid's Top-Right) is Paper's Bottom-Left (PBL)
    // trapezoidPoints[3] (Trapezoid's Top-Left) is Paper's Bottom-Right (PBR)

    // Therefore, dstPoints (which maps 1:1 with srcPoints derived from trapezoidPoints) should be:
    const dstPoints = [
        [1, 0],  // srcPoints[0] (PTR) maps to Output Top-Right
        [0, 0],  // srcPoints[1] (PTL) maps to Output Top-Left
        [0, 1],  // srcPoints[2] (PBL) maps to Output Bottom-Left
        [1, 1]   // srcPoints[3] (PBR) maps to Output Bottom-Right
    ];
    
    // Calculate homography matrix (perspective transformation)
    // Implementation of the Direct Linear Transform algorithm
    
    // Create the coefficient matrix for the system of equations
    const A = [];
    
    for (let i = 0; i < 4; i++) {
        // To compute H_dst_to_src (map output canvas points to source video points):
        // - The "source" points for this transformation are dstPoints (e.g., [0,0], [1,0] on canvas).
        // - The "destination" points for this transformation are srcPoints (trapezoid points on video).
        const [x, y] = dstPoints[i]; // Point from the output canvas rectangle
        const [X, Y] = srcPoints[i]; // Corresponding point from the source video trapezoid
        
        // Each point correspondence gives two equations
        A.push([
            x, y, 1, 0, 0, 0, -X*x, -X*y, -X
        ]);
        
        A.push([
            0, 0, 0, x, y, 1, -Y*x, -Y*y, -Y
        ]);
    }
    
    // Solve the system using Singular Value Decomposition (SVD)
    // For simplicity, we'll use a numerical approximation method
    // In a production app, you would use a proper linear algebra library
    
    // Compute A^T * A (approximation of the SVD)
    const AtA = [];
    for (let i = 0; i < 9; i++) {
        AtA[i] = [];
        for (let j = 0; j < 9; j++) {
            let sum = 0;
            for (let k = 0; k < 8; k++) {
                sum += A[k][i] * A[k][j];
            }
            AtA[i][j] = sum;
        }
    }
    
    // Find the eigenvector corresponding to the smallest eigenvalue
    // This is a simplified approach - in practice, use a proper linear algebra library
    // For now, we'll use an iterative power method approximation
    let h = [1, 1, 1, 1, 1, 1, 1, 1, 1]; // Initial guess
    
    // Normalize the vector
    const normalize = (v) => {
        const magnitude = Math.sqrt(v.reduce((sum, val) => sum + val * val, 0));
        return v.map(val => val / magnitude);
    };
    
    // Power iteration (simplified)
    for (let iter = 0; iter < 10; iter++) {
        // Matrix-vector multiplication
        const Ah = Array(9).fill(0);
        for (let i = 0; i < 9; i++) {
            for (let j = 0; j < 9; j++) {
                Ah[i] += AtA[i][j] * h[j];
            }
        }
        
        // Update h
        h = normalize(Ah);
    }
    
    // Reshape the result into a 3x3 matrix
    return [
        h[0], h[1], h[2],
        h[3], h[4], h[5],
        h[6], h[7], h[8]
    ];
}

// Switch to whiteboard mode
function startWhiteboardMode() {
    // Animate transition
    const setupView = document.getElementById('setup-view');
    const whiteboardView = document.getElementById('whiteboard-view');
    
    setupView.style.opacity = '1';
    whiteboardView.style.display = 'flex';
    whiteboardView.style.opacity = '0';
    
    // Fade out setup view
    let opacity = 1;
    const fadeOut = setInterval(() => {
        opacity -= 0.1;
        setupView.style.opacity = opacity;
        
        if (opacity <= 0) {
            clearInterval(fadeOut);
            setupView.classList.remove('active');
            setupView.style.display = 'none';
            
            // Fade in whiteboard view
            let whiteboardOpacity = 0;
            const fadeIn = setInterval(() => {
                whiteboardOpacity += 0.1;
                whiteboardView.style.opacity = whiteboardOpacity;
                
                if (whiteboardOpacity >= 1) {
                    clearInterval(fadeIn);
                    // Initialize WebGL here, after the canvas is fully visible
                    if (!isWebGLInitialized) {
                        initWebGL();
                        isWebGLInitialized = true;
                    }
                    // No need for captureAndProcessFrame here, processVideoFrame uses webcam directly
                }
            }, 30);
        }
    }, 30);
    
    isWhiteboardMode = true;
}

// Switch back to setup mode
function backToSetupMode() {
    // Animate transition
    const setupView = document.getElementById('setup-view');
    const whiteboardView = document.getElementById('whiteboard-view');
    
    whiteboardView.style.opacity = '1';
    setupView.style.display = 'flex';
    setupView.style.opacity = '0';
    
    // Fade out whiteboard view
    let opacity = 1;
    const fadeOut = setInterval(() => {
        opacity -= 0.1;
        whiteboardView.style.opacity = opacity;
        
        if (opacity <= 0) {
            clearInterval(fadeOut);
            whiteboardView.style.display = 'none';
            
            // Fade in setup view
            let setupOpacity = 0;
            const fadeIn = setInterval(() => {
                setupOpacity += 0.1;
                setupView.style.opacity = setupOpacity;
                
                if (setupOpacity >= 1) {
                    clearInterval(fadeIn);
                    setupView.classList.add('active');
                }
            }, 30);
        }
    }, 30);
    
    isWhiteboardMode = false;
}

// Capture and process the current frame
function captureAndProcessFrame() {
    // Create a temporary canvas to capture the current frame
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = videoWidth;
    tempCanvas.height = videoHeight;
    const tempCtx = tempCanvas.getContext('2d');
    
    // Draw the current video frame to the temporary canvas
    tempCtx.drawImage(webcam, 0, 0, videoWidth, videoHeight);
    
    // Use the captured frame for perspective correction
    const imageData = tempCtx.getImageData(0, 0, videoWidth, videoHeight);
    
    // Update the texture with the captured frame
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tempCanvas);
}

// Clear the whiteboard
function clearWhiteboard() {
    // whiteboardCanvas is now a WebGL canvas.
    // Clearing it means clearing the WebGL drawing buffer.
    if (gl) {
        gl.clearColor(1, 1, 1, 1); // Set clear color to white (or any desired color)
        gl.clear(gl.COLOR_BUFFER_BIT);
        // Note: If drawLoop is running, this clear will be immediate, 
        // and the next frame from the camera will be drawn.
        // For a persistent clear, you might need to stop the video processing loop
        // or draw a static blank frame.
    }
}

// Save the whiteboard as an image
function saveWhiteboard() {
    const link = document.createElement('a');
    link.download = 'whiteboard-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.png';
    link.href = whiteboardCanvas.toDataURL();
    link.click();
}

// Adjust zoom level
function adjustZoom(delta) {
    const slider = document.getElementById('zoom-slider');
    slider.value = parseInt(slider.value) + delta;
    handleZoomSlider();
}

// Handle zoom slider changes
function handleZoomSlider() {
    const zoomValue = document.getElementById('zoom-slider').value;
    // Convert zoomValue (1-100) to a zoomFactor (e.g., 0.5 to 2.0)
    // 50 is no zoom (factor 1.0)
    const zoomFactor = zoomValue / 50;

    // Recalculate trapezoid points with the new zoom factor, keeping the bottom anchored
    calculateTrapezoidPoints(zoomFactor);
}

// Switch back to setup mode
function backToSetupMode() {
    // Animate transition
    const setupView = document.getElementById('setup-view');
    const whiteboardView = document.getElementById('whiteboard-view');
    
    whiteboardView.style.opacity = '1';
    setupView.style.display = 'flex';
    setupView.style.opacity = '0';
    
    // Fade out whiteboard view
    let opacity = 1;
    const fadeOut = setInterval(() => {
        opacity -= 0.1;
        whiteboardView.style.opacity = opacity;
        
        if (opacity <= 0) {
            clearInterval(fadeOut);
            whiteboardView.style.display = 'none';
            
            // Fade in setup view
            let setupOpacity = 0;
            const fadeIn = setInterval(() => {
                setupOpacity += 0.1;
                setupView.style.opacity = setupOpacity;
                
                if (setupOpacity >= 1) {
                    clearInterval(fadeIn);
                    setupView.classList.add('active');
                }
            }, 30);
        }
    }, 30);
    
    isWhiteboardMode = false;
}

// Capture and process the current frame
function captureAndProcessFrame() {
    // Create a temporary canvas to capture the current frame
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = videoWidth;
    tempCanvas.height = videoHeight;
    const tempCtx = tempCanvas.getContext('2d');
    
    // Draw the current video frame to the temporary canvas
    tempCtx.drawImage(webcam, 0, 0, videoWidth, videoHeight);
    
    // Use the captured frame for perspective correction
    const imageData = tempCtx.getImageData(0, 0, videoWidth, videoHeight);
    
    // Update the texture with the captured frame
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tempCanvas);
}

// Clear the whiteboard
function clearWhiteboard() {
    whiteboardCtx.clearRect(0, 0, whiteboardCanvas.width, whiteboardCanvas.height);
}

// Save the whiteboard as an image
function saveWhiteboard() {
    const link = document.createElement('a');
    link.download = 'whiteboard-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.png';
    link.href = whiteboardCanvas.toDataURL();
    link.click();
}

// Adjust zoom level
function adjustZoom(delta) {
    const slider = document.getElementById('zoom-slider');
    slider.value = parseInt(slider.value) + delta;
    handleZoomSlider();
}

// Handle zoom slider changes
function handleZoomSlider() {
    const zoomValue = document.getElementById('zoom-slider').value;
    // Convert zoomValue (1-100) to a zoomFactor (e.g., 0.5 to 2.0)
    // 50 is no zoom (factor 1.0)
    const zoomFactor = zoomValue / 50;

    // Recalculate trapezoid points with the new zoom factor, keeping the bottom anchored
    calculateTrapezoidPoints(zoomFactor);
}
