// Global variables
let webcam, overlayCanvas, whiteboardCanvas, cameraSelect;
let magnifierDiv, magnifierCanvas, magnifierCtx;
let overlayCtx; // whiteboardCtx removed as whiteboard is WebGL
let videoWidth, videoHeight;
let trapezoidPoints = [];
let isWhiteboardMode = false;
let gl, program;
let positionLocation, texCoordLocation;
let matrixLocation, resolutionLocation;
let currentPerspectiveMatrix = null; // To store the calculated perspective matrix
let currentSrcPoints = null; // To store the source points for logging
let positionBuffer = null; // WebGL buffer for vertex positions
let texCoordBuffer = null; // WebGL buffer for texture coordinates

// Variables for draggable trapezoid corners
let htmlHandles = []; // To store the DOM elements for handles
let draggedHtmlHandle = null; // The HTML handle element being dragged
const HANDLE_SIZE = 20; // Pixel dimension of the square HTML handle (matches CSS)

// Global variable to control initial phase ('setup' or 'whiteboard')
let initialPhase = 'setup';

// Maps handle index (0:BR, 1:BL, 2:UL, 3:UR) to trapezoidPoints index
const trapezoidPointIndices = [1, 0, 3, 2];

// Whiteboard resizing variables
let wbLeftHandle, wbRightHandle;
let isResizingWhiteboard = false;
let draggedWhiteboardHandleSide = null;
let currentWhiteboardDrawingWidth, currentWhiteboardDrawingHeight;
let wbResizeInitialMouseX, wbResizeInitialWidth;

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
    cameraSelect = document.getElementById('camera-select'); // Get camera select element
    magnifierDiv = document.getElementById('magnifier');
    magnifierCanvas = document.getElementById('magnifier-canvas');
    
    overlayCtx = overlayCanvas.getContext('2d');
    if (magnifierCanvas) { // Ensure it exists before getting context
        magnifierCtx = magnifierCanvas.getContext('2d');
        magnifierCanvas.width = 100; // Set drawing surface size
        magnifierCanvas.height = 100;
    }
    // whiteboardCtx is no longer initialized here, as whiteboardCanvas will be used for WebGL.
    
    // Set up event listeners
    cameraSelect.addEventListener('change', () => {
        initWebcam(cameraSelect.value);
    });
    document.getElementById('start-btn').addEventListener('click', startWhiteboardMode);
    document.getElementById('back-btn').addEventListener('click', backToSetupMode);
    document.getElementById('clear-btn').addEventListener('click', clearWhiteboard);
    document.getElementById('save-btn').addEventListener('click', saveWhiteboard);
    document.getElementById('minus-btn').addEventListener('click', () => adjustZoom(-5));
    document.getElementById('plus-btn').addEventListener('click', () => adjustZoom(5));
    document.getElementById('zoom-slider').addEventListener('input', handleZoomSlider);

    // Add event listeners for dragging trapezoid corners
    // overlayCanvas.addEventListener('mousedown', handleTrapezoidInteractionStart); // Removed to prevent dragging canvas itself
    document.addEventListener('mousemove', handleTrapezoidInteractionMove);
    document.addEventListener('mouseup', handleTrapezoidInteractionEnd);
    // Touch events for document are for moving/ending drag
    document.addEventListener('touchmove', handleTrapezoidInteractionMove, { passive: false });
    document.addEventListener('touchend', handleTrapezoidInteractionEnd);

    // Get HTML handles
    for (let i = 0; i < 4; i++) {
        const handle = document.getElementById(`handle-${i}`);
        htmlHandles.push(handle);
        // Attach mousedown/touchstart to each handle
        handle.addEventListener('mousedown', handleTrapezoidInteractionStart);
        handle.addEventListener('touchstart', handleTrapezoidInteractionStart, { passive: false });
    }

    // Refresh cameras button
    document.getElementById('refresh-cameras-btn').addEventListener('click', async () => {
        console.log('Refresh cameras button clicked.');
        
        await populateCameraList(); // This repopulates cameraSelect

        const currentStream = webcam.srcObject;
        let activeStreamStillAvailableAndSelected = false;

        if (currentStream && currentStream.active) {
            const videoTracks = currentStream.getVideoTracks();
            if (videoTracks.length > 0) {
                const currentTrackSettings = videoTracks[0].getSettings();
                const activeDeviceId = currentTrackSettings.deviceId;

                if (activeDeviceId) {
                    for (let i = 0; i < cameraSelect.options.length; i++) {
                        if (cameraSelect.options[i].value === activeDeviceId) {
                            cameraSelect.value = activeDeviceId; // Re-select it
                            activeStreamStillAvailableAndSelected = true;
                            break;
                        }
                    }
                }
            }
        }

        if (!activeStreamStillAvailableAndSelected && webcam.srcObject) {
            console.warn('Previously active camera is no longer available or stream is inactive after refresh.');
            if (cameraSelect.options.length === 0) {
                alert("No cameras found after refresh. Stopping video stream.");
                if (webcam.srcObject) {
                    webcam.srcObject.getTracks().forEach(track => track.stop());
                    webcam.srcObject = null;
                    webcam.style.display = 'none'; // Hide webcam element
                    overlayCanvas.style.display = 'none'; // Hide overlay
                }
            } else {
                // A new camera might have been selected by default if the list is not empty.
                // The 'change' event on cameraSelect should handle initializing this new camera.
                // If cameraSelect.value is different than before, initWebcam(cameraSelect.value) will be called.
            }
        } else if (!webcam.srcObject && cameraSelect.options.length > 0) {
            // No active stream, but cameras are now listed. User can select one.
            // Or, we could auto-init the first one:
            // initWebcam(cameraSelect.value); 
            // For now, let user explicitly select.
            console.log("Cameras found after refresh. Please select one to start.");
        }
    });
    
    // Initialize webcam and populate camera list
    // initWebcam will now be called first, and it will call populateCameraList after stream is active.
    initWebcam(); 

    // Add resize listener to update handle positions and whiteboard size
    window.addEventListener('resize', () => {
        updateHtmlHandlesPositions(); // For setup view
        if (isWhiteboardMode && whiteboardCanvas && currentWhiteboardDrawingWidth && currentWhiteboardDrawingHeight) {
            // Recalculate whiteboard size based on new container dimensions
            const canvasContainer = document.getElementById('canvas-container');
            if (canvasContainer) {
                const containerSize = Math.min(canvasContainer.offsetWidth, canvasContainer.offsetHeight);
                console.log('Window resized - new container size:', containerSize);
                
                // Update whiteboard dimensions to fill new container size
                currentWhiteboardDrawingWidth = containerSize;
                currentWhiteboardDrawingHeight = containerSize;
                whiteboardCanvas.width = currentWhiteboardDrawingWidth;
                whiteboardCanvas.height = currentWhiteboardDrawingHeight;
                
                // Update WebGL viewport and buffers
                if (gl && program) {
                    gl.viewport(0, 0, currentWhiteboardDrawingWidth, currentWhiteboardDrawingHeight);
                    gl.useProgram(program);
                    gl.uniform2f(resolutionLocation, currentWhiteboardDrawingWidth, currentWhiteboardDrawingHeight);
                    
                    // Update position buffer with new dimensions
                    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
                    setRectangle(gl, 0, 0, currentWhiteboardDrawingWidth, currentWhiteboardDrawingHeight);
                }
            }
            updateWhiteboardLayout(); // Update layout and handle positions
        }
    });

    // Handle initial phase display based on the global variable
    if (initialPhase === 'whiteboard') {
        document.getElementById('setup-view').style.display = 'none';
        document.getElementById('whiteboard-view').style.display = 'flex';
        document.getElementById('whiteboard-view').style.opacity = '1';
        isWhiteboardMode = true; // Set mode immediately
        // updateWhiteboardLayout will be called in initWebcam after dimensions are known
    } else {
        document.getElementById('setup-view').classList.add('active'); // Ensure setup view is active initially
    }

    // Whiteboard resize handles
    wbLeftHandle = document.getElementById('wb-left-handle');
    wbRightHandle = document.getElementById('wb-right-handle');
    // const canvasContainer = document.getElementById('canvas-container'); // No longer needed for these listeners

    // Mouseenter/mouseleave listeners on canvasContainer for handle visibility are removed.
    // Visibility is now controlled by mode (setup/whiteboard) and CSS handles hover effects.

    [wbLeftHandle, wbRightHandle].forEach(handle => {
        handle.addEventListener('mousedown', startWhiteboardResize);
    });

    document.addEventListener('mousemove', doWhiteboardResize);
    document.addEventListener('mouseup', stopWhiteboardResize);
});

// Populate camera selection dropdown
// This function is now called AFTER initWebcam has successfully started a stream.
async function populateCameraList() {
    console.log('Populating camera list (post-permission)...');
    let videoDevices = [];
    const maxAttempts = 3; // Polling can still be useful for devices that enumerate slowly.
    const delayBetweenAttempts = 100; // 1 second

    try {
        // Poll for devices. Permissions should already be granted by initWebcam.
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            console.log(`Enumerating devices, attempt ${attempt}/${maxAttempts}...`);
            const devices = await navigator.mediaDevices.enumerateDevices();
            console.log(`Attempt ${attempt} - All devices found:`, devices);
            
            videoDevices = devices.filter(device => device.kind === 'videoinput');
            console.log(`Attempt ${attempt} - Filtered video input devices:`, videoDevices.map(d => ({ label: d.label, deviceId: d.deviceId, kind: d.kind })));

            const hasLabeledDevices = videoDevices.some(device => device.label && device.label !== '');
            if (videoDevices.length > 0 && hasLabeledDevices) {
                console.log(`Found labeled video devices on attempt ${attempt}. Proceeding.`);
                break; 
            }
            if (videoDevices.length > 0 && attempt === maxAttempts) {
                console.log(`Found video devices (some may be unlabeled) on final attempt ${attempt}. Proceeding.`);
                break;
            }

            if (attempt < maxAttempts) {
                console.log(`Waiting ${delayBetweenAttempts}ms before next attempt...`);
                await new Promise(resolve => setTimeout(resolve, delayBetweenAttempts));
            }
        }

        cameraSelect.innerHTML = ''; // Clear existing options

        if (videoDevices.length === 0) {
            const option = document.createElement('option');
            option.textContent = 'No cameras found';
            cameraSelect.appendChild(option);
            cameraSelect.disabled = true;
            console.warn("populateCameraList: No video input devices found even after initWebcam likely succeeded.");
            return; // initWebcam handles the stream; this function just updates UI.
        }

        cameraSelect.disabled = false;
        videoDevices.forEach((device, index) => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = device.label || `Camera ${index + 1} (No label)`;
            cameraSelect.appendChild(option);
        });

        // Note: We no longer call initWebcam from here. 
        // The active camera is managed by the initial initWebcam call and the 'change' event listener.

    } catch (error) {
        console.error('Error populating camera list:', error);
        cameraSelect.innerHTML = '<option>Error loading cameras</option>';
        cameraSelect.disabled = true;
        // Do not call initWebcam from here.
    }
}

// Initialize webcam access
async function initWebcam(deviceId = null) {
    try {
        // Stop any existing stream before starting a new one
        if (webcam.srcObject) {
            webcam.srcObject.getTracks().forEach(track => track.stop());
        }

        const videoConstraints = {
            width: { ideal: 1280 },
            height: { ideal: 720 }
        };

        if (deviceId) {
            videoConstraints.deviceId = { exact: deviceId };
        } else {
            // Only use facingMode if no specific deviceId is requested
            videoConstraints.facingMode = 'environment'; 
        }
        
        const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
        
        webcam.srcObject = stream;
        
        // Wait for video metadata to load
        webcam.onloadedmetadata = async () => { // Made async to await populateCameraList
            videoWidth = webcam.videoWidth;
            videoHeight = webcam.videoHeight;
            
            // Get camera container dimensions
            const cameraContainer = document.getElementById('camera-container');
            const containerWidth = cameraContainer.clientWidth;
            const aspectRatio = videoWidth / videoHeight;

            // Set video display dimensions
            webcam.style.width = `${containerWidth}px`;
            webcam.style.height = `${containerWidth / aspectRatio}px`;

            // Set overlay canvas to match displayed video size
            overlayCanvas.width = containerWidth;
            overlayCanvas.height = containerWidth / aspectRatio;

            // Update videoWidth/height variables to match displayed size
            videoWidth = containerWidth;
            videoHeight = containerWidth / aspectRatio;
            
            // --- Whiteboard Canvas initial drawing surface size ---
            const canvasContainer = document.getElementById('canvas-container');
            console.log('initWebcam container dimensions:', {
                clientWidth: canvasContainer.clientWidth,
                clientHeight: canvasContainer.clientHeight,
                offsetWidth: canvasContainer.offsetWidth,
                offsetHeight: canvasContainer.offsetHeight
            });
            
            // Use 1:1 aspect ratio for the whiteboard
            // Use offsetWidth/Height instead of clientWidth/Height for more reliable measurements
            const containerSize = Math.min(canvasContainer.offsetWidth, canvasContainer.offsetHeight);
            console.log('Calculated initial whiteboard size:', containerSize);
            
            // Initial values will be properly set when whiteboard becomes visible
            currentWhiteboardDrawingWidth = containerSize;
            currentWhiteboardDrawingHeight = containerSize;
            console.log('Set initial whiteboard dimensions:', {
                width: currentWhiteboardDrawingWidth,
                height: currentWhiteboardDrawingHeight
            });
            whiteboardCanvas.width = currentWhiteboardDrawingWidth;
            whiteboardCanvas.height = currentWhiteboardDrawingHeight;

            // Populate camera list AFTER stream is active and permissions are granted
            await populateCameraList();

            // Ensure the camera select dropdown reflects the currently active stream's deviceId
            const currentStream = webcam.srcObject;
            if (currentStream) {
                const videoTracks = currentStream.getVideoTracks();
                if (videoTracks.length > 0) {
                    const currentTrackSettings = videoTracks[0].getSettings();
                    const activeDeviceId = currentTrackSettings.deviceId;
                    const activeTrackLabel = videoTracks[0].label;

                    if (activeDeviceId) { // Ensure activeDeviceId is valid
                        let foundInSelect = false;
                        if (cameraSelect.options.length > 0) {
                            for (let i = 0; i < cameraSelect.options.length; i++) {
                                if (cameraSelect.options[i].value === activeDeviceId) {
                                    cameraSelect.value = activeDeviceId;
                                    foundInSelect = true;
                                    break;
                                }
                            }
                        }

                        if (!foundInSelect) {
                            console.warn("Active camera's deviceId not found in the populated list. Adding it dynamically.");
                            const option = document.createElement('option');
                            option.value = activeDeviceId;
                            // Use track label, fallback to a generic name with ID
                            option.textContent = activeTrackLabel || `Active Camera (ID: ${activeDeviceId.substring(0, 8)}...)`;
                            cameraSelect.appendChild(option);
                            cameraSelect.value = activeDeviceId; // Select the newly added option
                        }
                    } else {
                        console.warn("Could not determine deviceId of the active camera stream.");
                    }
                } else {
                    console.warn("Active stream has no video tracks.");
                }
            } else {
                console.warn("No active stream source to determine current camera.");
            }
            
            // Calculate trapezoid points based on video dimensions
            calculateTrapezoidPoints(); // This will also call updateHtmlHandlesPositions
            updatePerspectiveMatrix(); // Initial calculation of the perspective matrix
            if (!isWhiteboardMode) { // If in setup mode
                drawTrapezoid(); // Ensure handles are styled (visible) and trapezoid drawn correctly initially
                // Ensure handles are visible immediately after initialization
                htmlHandles.forEach(handle => {
                    if (handle) handle.style.display = 'block';
                });
            }
            
            // Start drawing loop
            requestAnimationFrame(drawLoop);
            
            // If starting directly in whiteboard mode, ensure WebGL is initialized after canvas is ready
            if (initialPhase === 'whiteboard' && isWhiteboardMode) {
                if (!isWebGLInitialized) {
                    // Defer WebGL initialization with a short timeout.
                    setTimeout(() => {
                        requestAnimationFrame(() => {
                            initWebGL();
                            isWebGLInitialized = true;
                            updateWhiteboardLayout(); // Position and style canvas and handles
                        });
                    }, 100);
                } else {
                    // If WebGL already initialized (e.g., camera change while in whiteboard initialPhase)
                    updateWhiteboardLayout(); // Ensure layout and handles are updated
                }
            }
        };
    } catch (error) {
        console.error('Error accessing webcam:', error);
        alert('Unable to access webcam. Please ensure you have granted camera permissions.');
        // If webcam access fails, disable camera selection as it's non-functional
        cameraSelect.innerHTML = '<option>Camera access failed</option>';
        cameraSelect.disabled = true;
    }
}

// Global flag to ensure WebGL is initialized only once
let isWebGLInitialized = false;
// Global flag to ensure perspective info is logged only once
let hasLoggedPerspectiveInfo = false;

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

    // Update the perspective matrix whenever trapezoid points change
    updatePerspectiveMatrix();
    // Update HTML handle positions
    updateHtmlHandlesPositions();
}

// Update positions of HTML handles based on trapezoidPoints
function updateHtmlHandlesPositions() {
    if (!videoWidth || !videoHeight || htmlHandles.length === 0) return;

    console.log('updateHtmlHandlesPositions running, timestamp:', Date.now()); // DEBUG LOG

    const cameraContainer = document.getElementById('camera-container');
    if (!cameraContainer) return;
    const containerRect = cameraContainer.getBoundingClientRect();

    for (let i = 0; i < htmlHandles.length; i++) { // Iterate through handles
        const handleEl = htmlHandles[i];
        const actualTrapezoidPointIndex = trapezoidPointIndices[i];
        const canvasP = trapezoidPoints[actualTrapezoidPointIndex];

        if (handleEl && canvasP) {
            // Convert canvas coordinates to CSS pixel values relative to the container
            // This will be the target center for our handle's circle.
            let targetCenterX = (canvasP[0] / videoWidth) * containerRect.width;
            let targetCenterY = (canvasP[1] / videoHeight) * containerRect.height;

            // Apply adjustments to the target center position.
            // These adjustments were originally for the needle tip, but we'll keep them
            // to ensure the circle center aligns where the tip was intended.
            // i is the htmlHandles index:
            // 0: Visual Bottom-Right handle, "UL" label
            // 1: Visual Bottom-Left handle, "UR" label
            // 2: Visual Top-Left handle, "BR" label
            // 3: Visual Top-Right handle, "BL" label
            if (i === 0) { // Visual Bottom-Right ("UL")
                targetCenterX -= 2; 
            } else if (i === 1) { // Visual Bottom-Left ("UR")
                targetCenterX += 2;
            } else if (i === 2) { // Visual Top-Left ("BR")
                targetCenterX -= 4;
            } else if (i === 3) { // Visual Top-Right ("BL")
                targetCenterX += 4;
            }
            
            // Position the handle element so its center aligns with (targetCenterX, targetCenterY).
            // The draggable-handle is 16x16px. Its center is at (8px, 8px) from its top-left.
            handleEl.style.left = `${targetCenterX - 8}px`; 
            handleEl.style.top = `${targetCenterY - 8}px`;
            
            // The circle element is positioned at (2px, 2px) within the draggable-handle.
            // Its CSS width/height is 12px. With a 2px border, its visual size is 16px.
            // So it visually fills the draggable-handle. No specific JS positioning needed for it here.
            const circleEl = handleEl.querySelector('.handle-circle');
            if (circleEl) {
                // Ensure default position if it was ever changed by mistake
                circleEl.style.left = '2px'; 
                circleEl.style.top = '2px';
            }
            
            // Position the label based on handle type (relative to the handleEl, which is now centered on the point)
            const labelEl = handleEl.querySelector('.corner-label');
            if (labelEl) {
                // Position labels based on visual handle index (i), considering the diagonal swap.
                // htmlHandles[0] (Visually BR, effectively UL)
                if (i === 0) { 
                    labelEl.style.left = '0px';   // Centered above (like original UL/UR)
                    labelEl.style.top = '-25px';
                    labelEl.style.transform = 'translateX(-50%)';
                // htmlHandles[1] (Visually BL, effectively UR)
                } else if (i === 1) { 
                    labelEl.style.left = '0px';   // Centered above (like original UL/UR)
                    labelEl.style.top = '-25px';
                    labelEl.style.transform = 'translateX(-50%)';
                // htmlHandles[2] (Visually UL, effectively BR)
                } else if (i === 2) { 
                    labelEl.style.left = '-25px'; // Left and up (like original BR)
                    labelEl.style.top = '-20px';
                    labelEl.style.transform = ''; // Clear transform if not needed
                // htmlHandles[3] (Visually UR, effectively BL)
                } else if (i === 3) { 
                    labelEl.style.left = '20px';  // Right and up (like original BL)
                    labelEl.style.top = '-20px';
                    labelEl.style.transform = ''; // Clear transform if not needed
                }
            }
        }
    }
}

// Recalculate and update the perspective matrix
function updatePerspectiveMatrix() {
    if (videoWidth && videoHeight && trapezoidPoints && trapezoidPoints.length === 4) {
        hasLoggedPerspectiveInfo = false; // Reset log flag so it logs for the new matrix
        const transformData = calculatePerspectiveMatrix();
        if (transformData && transformData.matrix) {
            currentPerspectiveMatrix = transformData.matrix;
            currentSrcPoints = transformData.srcPoints; // Store srcPoints for logging
        } else {
            console.error("Failed to calculate perspective matrix. Using identity matrix.");
            currentPerspectiveMatrix = [1,0,0, 0,1,0, 0,0,1]; // Fallback to identity
            // Attempt to use original trapezoid points if available, otherwise empty
            currentSrcPoints = trapezoidPoints ? trapezoidPoints.map(point => [point[0] / videoWidth, point[1] / videoHeight]) : [];
        }
    } else {
        // Not enough data to calculate, set to identity (no transformation)
        currentPerspectiveMatrix = [1,0,0, 0,1,0, 0,0,1];
        currentSrcPoints = []; // Default to empty array
        console.warn("Not enough data for perspective matrix, using identity.");
    }
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
    
    // Don't draw trapezoid outline - remove the horizontal lines
    // overlayCtx.beginPath();
    // overlayCtx.moveTo(trapezoidPoints[0][0], trapezoidPoints[0][1]);
    // 
    // for (let i = 1; i < trapezoidPoints.length; i++) {
    //     overlayCtx.lineTo(trapezoidPoints[i][0], trapezoidPoints[i][1]);
    // }
    // 
    // overlayCtx.closePath();
    // overlayCtx.strokeStyle = 'white';
    // overlayCtx.lineWidth = 3;
    // overlayCtx.stroke();

    // Ensure HTML handles are always visible in setup mode
    if (!isWhiteboardMode) {
        htmlHandles.forEach(handle => {
            if (handle) handle.style.display = 'block';
        });
    } else {
        htmlHandles.forEach(handle => {
            if (handle) handle.style.display = 'none';
        });
    }
}

// Helper function to clip a line to a rectangle using Cohen-Sutherland algorithm
function clipLineToRect(x1, y1, x2, y2, rectX, rectY, rectWidth, rectHeight) {
    const INSIDE = 0; // 0000
    const LEFT = 1;   // 0001
    const RIGHT = 2;  // 0010
    const BOTTOM = 4; // 0100
    const TOP = 8;    // 1000
    
    function computeOutCode(x, y) {
        let code = INSIDE;
        if (x < rectX) code |= LEFT;
        else if (x > rectX + rectWidth) code |= RIGHT;
        if (y < rectY) code |= BOTTOM;
        else if (y > rectY + rectHeight) code |= TOP;
        return code;
    }
    
    let outcode1 = computeOutCode(x1, y1);
    let outcode2 = computeOutCode(x2, y2);
    let accept = false;
    
    while (true) {
        if (!(outcode1 | outcode2)) {
            // Both points inside rectangle
            accept = true;
            break;
        } else if (outcode1 & outcode2) {
            // Both points share an outside zone (completely outside)
            break;
        } else {
            // Line needs clipping
            let x, y;
            let outcodeOut = outcode1 ? outcode1 : outcode2;
            
            if (outcodeOut & TOP) {
                x = x1 + (x2 - x1) * (rectY + rectHeight - y1) / (y2 - y1);
                y = rectY + rectHeight;
            } else if (outcodeOut & BOTTOM) {
                x = x1 + (x2 - x1) * (rectY - y1) / (y2 - y1);
                y = rectY;
            } else if (outcodeOut & RIGHT) {
                y = y1 + (y2 - y1) * (rectX + rectWidth - x1) / (x2 - x1);
                x = rectX + rectWidth;
            } else if (outcodeOut & LEFT) {
                y = y1 + (y2 - y1) * (rectX - x1) / (x2 - x1);
                x = rectX;
            }
            
            if (outcodeOut === outcode1) {
                x1 = x;
                y1 = y;
                outcode1 = computeOutCode(x1, y1);
            } else {
                x2 = x;
                y2 = y;
                outcode2 = computeOutCode(x2, y2);
            }
        }
    }
    
    return accept ? { x1, y1, x2, y2 } : null;
}

// Helper function to get event coordinates relative to the canvas
// This function is kept as it might be useful for other interactions with overlayCanvas,
// but it's not used for the HTML handle dragging.
function getCanvasCoordinates(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if (event.touches && event.touches.length > 0) {
        clientX = event.touches[0].clientX;
        clientY = event.touches[0].clientY;
    } else if (event.changedTouches && event.changedTouches.length > 0) { // For touchend
        clientX = event.changedTouches[0].clientX;
        clientY = event.changedTouches[0].clientY;
    }
    else {
        clientX = event.clientX;
        clientY = event.clientY;
    }

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
    };
}

// Event handlers for trapezoid corner dragging (now with HTML elements)
function handleTrapezoidInteractionStart(event) {
    if (isWhiteboardMode) return; // Interaction only in setup mode

    // 'this' refers to the HTML handle element the event was triggered on
    draggedHtmlHandle = this;
    
    // Add grabbing cursor style to body to indicate drag, and prevent text selection
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    if (event.type === 'touchstart') {
        event.preventDefault(); // Prevent scrolling/zooming
    }

    if (magnifierDiv) {
        magnifierDiv.style.display = 'block';
    }
    // Initial draw of magnifier content will happen in the first move event
}

function handleTrapezoidInteractionMove(event) {
    if (!draggedHtmlHandle || isWhiteboardMode) return;

    if (event.type === 'touchmove' || event.type === 'mousemove') {
        event.preventDefault(); // Prevent scrolling/zooming during drag
    }

    const cameraContainer = document.getElementById('camera-container');
    if (!cameraContainer) return;
    const containerRect = cameraContainer.getBoundingClientRect();

    // Determine clientX/Y from touch or mouse event
    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const clientY = event.touches ? event.touches[0].clientY : event.clientY;

    // Calculate coordinates relative to the camera container
    let containerX = clientX - containerRect.left;
    let containerY = clientY - containerRect.top;
    
    // Find the index of the dragged handle (0 for BR, 1 for BL, etc.)
    const handleIdx = htmlHandles.indexOf(draggedHtmlHandle);
    if (handleIdx === -1) return; // Should not happen

    // Determine the actual index in trapezoidPoints array to update
    const actualTrapezoidPointIndex = trapezoidPointIndices[handleIdx];

    // Convert container coordinates to canvas coordinates for trapezoid points (simple scaling)
    const canvasX = (containerX / containerRect.width) * videoWidth;
    const canvasY = (containerY / containerRect.height) * videoHeight;

    // Update the corresponding trapezoidPoint. No clamping.
    trapezoidPoints[actualTrapezoidPointIndex][0] = canvasX;
    trapezoidPoints[actualTrapezoidPointIndex][1] = canvasY;
    
    // Convert container coordinates to actual video coordinates for magnifier
    const videoElement = webcam;
    const videoDisplayX = (containerX / containerRect.width) * videoElement.offsetWidth;
    const videoDisplayY = (containerY / containerRect.height) * videoElement.offsetHeight;
    const magnifierVideoX = (videoDisplayX / videoElement.offsetWidth) * videoElement.videoWidth;
    const magnifierVideoY = (videoDisplayY / videoElement.offsetHeight) * videoElement.videoHeight;
    
    // Update matrix and handle positions
    updatePerspectiveMatrix();
    updateHtmlHandlesPositions(); // This updates the draggedHtmlHandle's style.left/top

    // Update Magnifier
    if (magnifierDiv && magnifierCtx && draggedHtmlHandle && webcam.readyState >= webcam.HAVE_CURRENT_DATA) {
        // Position the magnifier div near the cursor
        const magnifierWidth = 100;
        const magnifierHeight = 100;

        // Position magnifier above the cursor with a 20px gap
        magnifierDiv.style.left = `${containerX - (magnifierWidth / 2)}px`;
        magnifierDiv.style.top = `${containerY - magnifierHeight - 20}px`;

        // Check if cursor is within video bounds using magnifier coordinates
        if (magnifierVideoX >= 0 && magnifierVideoX <= webcam.videoWidth && magnifierVideoY >= 0 && magnifierVideoY <= webcam.videoHeight) {
            // Draw magnified content from the cursor position in video coordinates
            const videoFeedX = magnifierVideoX; // Cursor position in video coordinates
            const videoFeedY = magnifierVideoY; // Cursor position in video coordinates

            const sourceSize = 50; // 50x50 pixels from video
            const destSize = 100;  // Drawn as 100x100 on magnifier canvas

            const sx = videoFeedX - sourceSize / 2;
            const sy = videoFeedY - sourceSize / 2;

            // Debug log: print coordinates in one line
            console.log(`Mouse: canvas(${containerX.toFixed(1)},${containerY.toFixed(1)}) webcam(${magnifierVideoX.toFixed(1)},${magnifierVideoY.toFixed(1)}) | Minimap: canvas(${(sx + sourceSize/2).toFixed(1)},${(sy + sourceSize/2).toFixed(1)}) webcam(${videoFeedX.toFixed(1)},${videoFeedY.toFixed(1)}) | Canvas max: (${webcam.videoWidth},${webcam.videoHeight}) | Node: y=${currentCornerY.toFixed(1)} Ymag=${centerY.toFixed(1)} | Prev: y=${prevCornerVideoY.toFixed(1)} Ymag=${prevMagnifierY.toFixed(1)} | Next: y=${nextCornerVideoY.toFixed(1)} Ymag=${nextMagnifierY.toFixed(1)}`);

            magnifierCtx.clearRect(0, 0, destSize, destSize);
            magnifierCtx.drawImage(webcam, 
                                   sx, sy, sourceSize, sourceSize, 
                                   0, 0, destSize, destSize);
            
            // Draw lines from center to trapezoid corners
            magnifierCtx.strokeStyle = 'rgba(255, 0, 0, 0.7)';
            magnifierCtx.lineWidth = 1;
            magnifierCtx.fillStyle = 'red';
            
            // Get the trapezoid point index that corresponds to the dragged handle
            const draggedTrapezoidIndex = trapezoidPointIndices[handleIdx];
            
            // Calculate the two neighboring corner indices (previous and next in the trapezoid)
            const prevIndex = (draggedTrapezoidIndex + 3) % 4; // Previous corner (wrapping around)
            const nextIndex = (draggedTrapezoidIndex + 1) % 4; // Next corner (wrapping around)
            
            // Get the current dragged corner position in video coordinates
            const currentCornerX = magnifierVideoX; // This is where the cursor/center is
            const currentCornerY = magnifierVideoY;
            
            // Convert neighbor corners to magnifier coordinates relative to current corner
            const prevCornerVideoX = trapezoidPoints[prevIndex][0];
            const prevCornerVideoY = trapezoidPoints[prevIndex][1];
            const nextCornerVideoX = trapezoidPoints[nextIndex][0];
            const nextCornerVideoY = trapezoidPoints[nextIndex][1];
            
            // Calculate relative positions in video coordinates
            const prevRelativeX = prevCornerVideoX - currentCornerX;
            const prevRelativeY = prevCornerVideoY - currentCornerY;
            const nextRelativeX = nextCornerVideoX - currentCornerX;
            const nextRelativeY = nextCornerVideoY - currentCornerY;
            
            // Convert to magnifier coordinates (magnification factor = destSize/sourceSize = 100/50 = 2)
            const magnificationFactor = destSize / sourceSize;
            const centerX = destSize / 2;
            const centerY = destSize / 2;
            
            const prevMagnifierX = centerX + (prevRelativeX * magnificationFactor);
            const prevMagnifierY = centerY + (prevRelativeY * magnificationFactor);
            const nextMagnifierX = centerX + (nextRelativeX * magnificationFactor);
            const nextMagnifierY = centerY + (nextRelativeY * magnificationFactor);
            
            magnifierCtx.beginPath();
            
            // Draw line to previous neighbor
            const clippedLine1 = clipLineToRect(centerX, centerY, 
                                              prevMagnifierX, prevMagnifierY, 
                                              0, 0, destSize, destSize);
            if (clippedLine1) {
                magnifierCtx.moveTo(clippedLine1.x1, clippedLine1.y1);
                magnifierCtx.lineTo(clippedLine1.x2, clippedLine1.y2);
            }
            
            // Draw line to next neighbor
            const clippedLine2 = clipLineToRect(centerX, centerY, 
                                              nextMagnifierX, nextMagnifierY, 
                                              0, 0, destSize, destSize);
            if (clippedLine2) {
                magnifierCtx.moveTo(clippedLine2.x1, clippedLine2.y1);
                magnifierCtx.lineTo(clippedLine2.x2, clippedLine2.y2);
            }
            
            magnifierCtx.stroke();
            
            // Draw dots for neighbor corners if they are visible in magnifier
            if (prevMagnifierX >= 0 && prevMagnifierX <= destSize && 
                prevMagnifierY >= 0 && prevMagnifierY <= destSize) {
                magnifierCtx.beginPath();
                magnifierCtx.arc(prevMagnifierX, prevMagnifierY, 2, 0, 2 * Math.PI);
                magnifierCtx.fill();
            }
            
            if (nextMagnifierX >= 0 && nextMagnifierX <= destSize && 
                nextMagnifierY >= 0 && nextMagnifierY <= destSize) {
                magnifierCtx.beginPath();
                magnifierCtx.arc(nextMagnifierX, nextMagnifierY, 2, 0, 2 * Math.PI);
                magnifierCtx.fill();
            }
            
            // Draw center dot
            magnifierCtx.beginPath();
            magnifierCtx.arc(destSize / 2, destSize / 2, 2, 0, 2 * Math.PI);
            magnifierCtx.fill();
        } else {
            // Clear magnifier when outside video bounds
            console.log(`Mouse: canvas(${containerX.toFixed(1)},${containerY.toFixed(1)}) webcam(${magnifierVideoX.toFixed(1)},${magnifierVideoY.toFixed(1)}) | OUT OF BOUNDS | Canvas max: (${webcam.videoWidth},${webcam.videoHeight})`);
            magnifierCtx.clearRect(0, 0, destSize, destSize);
            // Fill with a dark background to indicate out of bounds
            magnifierCtx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            magnifierCtx.fillRect(0, 0, destSize, destSize);
            
            // Draw center dot even when out of bounds
            const destSize = 100; // Define destSize for out-of-bounds case
            magnifierCtx.fillStyle = 'red';
            magnifierCtx.beginPath();
            magnifierCtx.arc(destSize / 2, destSize / 2, 2, 0, 2 * Math.PI);
            magnifierCtx.fill();
        }
    }
}

function handleTrapezoidInteractionEnd(event) {
    if (!draggedHtmlHandle) return;
    
    draggedHtmlHandle = null;
    // Restore cursor and text selection
    document.body.style.cursor = 'default';
    document.body.style.userSelect = 'auto';

    if (magnifierDiv) {
        magnifierDiv.style.display = 'none';
    }
}


// Initialize WebGL for perspective correction
function initWebGL() {
    console.log('=== INITIALIZING WEBGL ===');
    console.log('whiteboardCanvas element:', whiteboardCanvas);
    console.log('Canvas dimensions:', whiteboardCanvas?.width, 'x', whiteboardCanvas?.height);
    console.log('Canvas style dimensions:', whiteboardCanvas?.style.width, 'x', whiteboardCanvas?.style.height);
    
    if (!whiteboardCanvas) {
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
    console.log('WebGL version:', gl.getParameter(gl.VERSION));
    console.log('WebGL vendor:', gl.getParameter(gl.VENDOR));
    console.log('WebGL renderer:', gl.getParameter(gl.RENDERER));
    
    // Get shader sources
    const vertexShaderSource = document.getElementById('vertex-shader').text;
    const fragmentShaderSource = document.getElementById('fragment-shader').text;
    
    // Create shader program
    console.log('Creating shaders...');
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    
    if (!vertexShader || !fragmentShader) {
        console.error('Failed to create shaders');
        return;
    }
    
    program = createProgram(gl, vertexShader, fragmentShader);
    if (!program) {
        console.error('Failed to create shader program');
        return;
    }
    console.log('Shader program created successfully');
    
    // Look up attribute locations
    positionLocation = gl.getAttribLocation(program, 'a_position');
    texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');
    
    // Look up uniform locations
    resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
    matrixLocation = gl.getUniformLocation(program, 'u_matrix');
    
    console.log('Attribute/Uniform locations:');
    console.log('  positionLocation:', positionLocation);
    console.log('  texCoordLocation:', texCoordLocation);
    console.log('  resolutionLocation:', resolutionLocation);
    console.log('  matrixLocation:', matrixLocation);
    
    // Create buffers
    positionBuffer = gl.createBuffer(); // Use global variable
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    // Use whiteboardCanvas dimensions for the rectangle, which should match videoWidth/Height
    setRectangle(gl, 0, 0, whiteboardCanvas.width, whiteboardCanvas.height); 
    
    // Enable and point position attribute
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    texCoordBuffer = gl.createBuffer(); // Use global variable
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0.0, 0.0,
        1.0, 0.0,
        0.0, 1.0,
        0.0, 1.0,
        1.0, 0.0,
        1.0, 1.0
    ]), gl.STATIC_DRAW);

    // Enable and point texCoord attribute
    gl.enableVertexAttribArray(texCoordLocation);
    gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);
    
    // Create texture
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    
    // Set texture parameters
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    
    console.log('WebGL initialization complete');
    console.log('=== END WEBGL INIT ===');
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
    if (!gl || !isWebGLInitialized) {
        console.log('Skipping frame - WebGL not ready. gl:', !!gl, 'initialized:', isWebGLInitialized);
        return;
    }
    
    // Tell WebGL how to convert from clip space to pixels
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    
    // Clear the canvas
    gl.clearColor(1, 1, 1, 1); // White background for whiteboard
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    // Tell it to use our program (pair of shaders)
    gl.useProgram(program);
    
    // Buffers and attributes are already set up in initWebGL.
    // We just need to ensure the correct buffers are active if we were using multiple,
    // but here, positionBuffer and texCoordBuffer are the only ones for these attributes.
    // gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer); // Not strictly needed if no other buffer was bound
    // gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0); // Already configured
    // gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer); // Not strictly needed
    // gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0); // Already configured
    
    // Set the resolution (still needed if canvas can resize, or for shader logic)
    gl.uniform2f(resolutionLocation, gl.canvas.width, gl.canvas.height);
    
    // Use the pre-calculated perspective transformation matrix
    if (!currentPerspectiveMatrix) {
        console.error("Perspective matrix not available in processVideoFrame.");
        // Fallback to an identity matrix or skip drawing
        // For now, using an identity matrix to avoid crashing if this happens.
        // This should ideally not occur if updatePerspectiveMatrix is called correctly.
        currentPerspectiveMatrix = [1,0,0, 0,1,0, 0,0,1];
    }
    const matrix = currentPerspectiveMatrix;

    // Set the matrix uniform.
    // currentPerspectiveMatrix is row-major.
    // WebGL 1.0 (ES 2.0) requires transpose to be false.
    // Manually transpose the matrix to column-major form.
    const matrixTransposed = [
        matrix[0], matrix[3], matrix[6], // Column 0
        matrix[1], matrix[4], matrix[7], // Column 1
        matrix[2], matrix[5], matrix[8]  // Column 2
    ];
    gl.uniformMatrix3fv(matrixLocation, false, matrixTransposed);

    // Log basic rendering info once
    if (!hasLoggedPerspectiveInfo) {
        console.log("=== WebGL Rendering Debug ===");
        console.log("Canvas dimensions:", gl.canvas.width, "x", gl.canvas.height);
        console.log("Viewport:", gl.getParameter(gl.VIEWPORT));
        console.log("Current program:", program);
        console.log("Matrix location:", matrixLocation);
        console.log("Resolution location:", resolutionLocation);
        console.log("Has perspective matrix:", !!currentPerspectiveMatrix);
        hasLoggedPerspectiveInfo = true;
    }

    // Update the texture with the current video frame
    try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, webcam);
    } catch (error) {
        console.error('Error updating texture:', error);
        return;
    }
    
    // Draw the rectangle
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
        console.error('WebGL error before draw:', error);
    }
    
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    
    const drawError = gl.getError();
    if (drawError !== gl.NO_ERROR) {
        console.error('WebGL error after draw:', drawError);
    }

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

// Helper function to solve a linear system Ax = b using Gauss-Jordan elimination
// A is an N x N matrix (array of arrays), b is an N x 1 vector (array)
// Returns solution vector x, or null if matrix is singular or system is inconsistent
function solveLinearSystem(A_orig, b_orig) {
    const N = A_orig.length;
    if (N === 0 || A_orig[0].length !== N || b_orig.length !== N) {
        console.error("Invalid input to solveLinearSystem.");
        return null;
    }

    // Create augmented matrix [A|b] and clone A_orig, b_orig to avoid modifying them
    const A = A_orig.map(row => [...row]);
    const b = [...b_orig];

    for (let i = 0; i < N; i++) {
        // Pivot selection: find row with max absolute value in current column i, below current row i
        let maxRow = i;
        for (let k = i + 1; k < N; k++) {
            if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) {
                maxRow = k;
            }
        }

        // Swap rows in A and b
        [A[i], A[maxRow]] = [A[maxRow], A[i]];
        [b[i], b[maxRow]] = [b[maxRow], b[i]];

        // Check for singularity
        if (Math.abs(A[i][i]) < 1e-10) { // Epsilon for near-zero pivot
            console.warn("Singular matrix or near-zero pivot encountered in Gauss-Jordan elimination.");
            return null; 
        }

        // Normalize pivot row: divide by pivot A[i][i]
        // This makes A[i][i] = 1
        const pivotVal = A[i][i];
        for (let j = i; j < N; j++) {
            A[i][j] /= pivotVal;
        }
        b[i] /= pivotVal;

        // Eliminate other rows
        for (let k = 0; k < N; k++) {
            if (k !== i) {
                const factor = A[k][i];
                for (let j = i; j < N; j++) {
                    A[k][j] -= factor * A[i][j];
                }
                b[k] -= factor * b[i];
            }
        }
    }
    // After Gauss-Jordan, A should be identity matrix, and b will contain the solution vector x
    return b; 
}

// Calculate perspective transformation matrix
function calculatePerspectiveMatrix() {
    // Source points (trapezoid corners in normalized video coordinates)
    const currentSrcPointsNorm = trapezoidPoints.map(point => [
        point[0] / videoWidth,
        point[1] / videoHeight
    ]);
    
    // Destination points (output canvas corners, normalized)
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

    // Therefore, dstPoints (which maps 1:1 with currentSrcPointsNorm) should be:
    const dstPoints = [
        [1, 0],  // currentSrcPointsNorm[0] (Paper's Top-Right) maps to Output Top-Right
        [0, 0],  // currentSrcPointsNorm[1] (Paper's Top-Left) maps to Output Top-Left
        [0, 1],  // currentSrcPointsNorm[2] (Paper's Bottom-Left) maps to Output Bottom-Left
        [1, 1]   // currentSrcPointsNorm[3] (Paper's Bottom-Right) maps to Output Bottom-Right
    ];
    
    // --- DLT Solver using Gaussian Elimination ---
    // We want to find matrix H such that for each correspondence (x_dst, y_dst) <-> (x_src, y_src):
    // x_src = (h00*x_dst + h01*y_dst + h02) / (h20*x_dst + h21*y_dst + h22)
    // y_src = (h10*x_dst + h11*y_dst + h12) / (h20*x_dst + h21*y_dst + h22)
    // Setting h22 = 1 (h[8]=1), we get a linear system for the first 8 elements of H.
    // Each point correspondence gives two rows in an 8x8 matrix M for M*h_prime = v
    
    const M = []; // This will be the 8x8 matrix
    const v = []; // This will be the 8x1 vector
    
    for (let i = 0; i < 4; i++) {
        const x_dst = dstPoints[i][0];
        const y_dst = dstPoints[i][1];
        const x_src = currentSrcPointsNorm[i][0];
        const y_src = currentSrcPointsNorm[i][1];
        
        M.push([x_dst, y_dst, 1, 0,     0,     0, -x_src * x_dst, -x_src * y_dst]);
        v.push(x_src);
        
        M.push([0,     0,     0, x_dst, y_dst, 1, -y_src * x_dst, -y_src * y_dst]);
        v.push(y_src);
    }

    const h_prime = solveLinearSystem(M, v);

    if (!h_prime) {
        console.error("DLT solver failed (solveLinearSystem returned null).");
        return { matrix: null, srcPoints: currentSrcPointsNorm }; // Indicate failure
    }

    // Full homography vector h (h22 = 1)
    const h = [...h_prime, 1.0];
    
    // Reshape h into a 3x3 matrix (row-major)
    const perspectiveMatrix = [
        h[0], h[1], h[2],
        h[3], h[4], h[5],
        h[6], h[7], h[8]
    ];
    
    return { matrix: perspectiveMatrix, srcPoints: currentSrcPointsNorm };
}


// Switch to whiteboard mode
function startWhiteboardMode() {
    // Add resize observer for debugging
    const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            console.log('Canvas container resized:', {
                width: entry.contentRect.width,
                height: entry.contentRect.height
            });
        }
    });
    resizeObserver.observe(document.getElementById('canvas-container'));

    console.log('Starting whiteboard mode transition');
    
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
                    whiteboardView.classList.add('active'); // Add .active class
                    
                    // INITIALIZE WHITEBOARD SIZE HERE AFTER VISIBLE
                    const canvasContainer = document.getElementById('canvas-container');
                    const containerSize = Math.min(canvasContainer.offsetWidth, canvasContainer.offsetHeight);
                    console.log('Final container size:', containerSize);
                    
                    currentWhiteboardDrawingWidth = containerSize;
                    currentWhiteboardDrawingHeight = containerSize;
                    whiteboardCanvas.width = currentWhiteboardDrawingWidth;
                    whiteboardCanvas.height = currentWhiteboardDrawingHeight;
                    
                    console.log('Setting up whiteboard after transition...');
                    console.log('Container size for WebGL:', containerSize);
                    
                    // Force re-initialization of WebGL with proper size
                    if (gl) {
                        console.log('Updating existing WebGL viewport and rectangle');
                        gl.viewport(0, 0, containerSize, containerSize);
                        setRectangle(gl, 0, 0, containerSize, containerSize);
                    }
                    
                    updateWhiteboardLayout();
                    if (!isWebGLInitialized) {
                        console.log('Initializing WebGL for the first time');
                        initWebGL();
                        isWebGLInitialized = true;
                    } else {
                        console.log('WebGL already initialized');
                    }
                    updateWhiteboardLayout(); // Position and style canvas and handles
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
            whiteboardView.classList.remove('active'); // Remove .active class
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
    // Hide whiteboard resize handles
    if (wbLeftHandle && wbRightHandle) {
        wbLeftHandle.style.display = 'none';
        wbRightHandle.style.display = 'none';
    }
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


// --- Whiteboard Resizing Functions ---

function updateWhiteboardLayout() {
    if (!whiteboardCanvas || !wbLeftHandle || !wbRightHandle) {
        console.log('updateWhiteboardLayout: Missing required elements');
        return;
    }

    // Ensure handles are visible if in whiteboard mode.
    // backToSetupMode() handles hiding them when exiting this mode.
    if (isWhiteboardMode) {
        wbLeftHandle.style.display = 'block';
        wbRightHandle.style.display = 'block';
    } else {
        // This function should primarily be called for layout updates in whiteboard mode.
        // If called when not in whiteboard mode, ensure handles are hidden and exit.
        wbLeftHandle.style.display = 'none';
        wbRightHandle.style.display = 'none';
        console.warn("updateWhiteboardLayout called when not in whiteboard mode. Handles hidden.");
        return;
    }

    const canvasContainer = document.getElementById('canvas-container');
    if (!canvasContainer) {
        console.error('Canvas container not found');
        return;
    }

    console.log('=== updateWhiteboardLayout called ===');
    console.log('Call stack:', new Error().stack.split('\n').slice(1, 4).join('\n'));
    console.log('Current whiteboard dimensions:', {
        width: currentWhiteboardDrawingWidth,
        height: currentWhiteboardDrawingHeight,
        canvasWidth: whiteboardCanvas.width,
        canvasHeight: whiteboardCanvas.height
    });
    console.log('Container dimensions:', {
        clientWidth: canvasContainer.clientWidth,
        clientHeight: canvasContainer.clientHeight,
        offsetWidth: canvasContainer.offsetWidth,
        offsetHeight: canvasContainer.offsetHeight
    });

    const containerWidth = canvasContainer.clientWidth;
    const containerHeight = canvasContainer.clientHeight;

    // Calculate maximum possible dimensions with 1:1 aspect ratio
    const aspectRatio = 1; // Force 1:1 ratio
    const maxWidth = Math.min(containerWidth, window.innerWidth, containerHeight * aspectRatio);
    const maxHeight = Math.min(containerHeight, containerWidth / aspectRatio);
    
    console.log('Calculated limits:', {maxWidth, maxHeight, windowWidth: window.innerWidth});

    // Always use the maximum available space for whiteboard
    const oldWidth = currentWhiteboardDrawingWidth;
    const oldHeight = currentWhiteboardDrawingHeight;
    
    // Use container size to fill available space
    const containerSize = Math.min(canvasContainer.offsetWidth, canvasContainer.offsetHeight);
    currentWhiteboardDrawingWidth = containerSize;
    currentWhiteboardDrawingHeight = containerSize;
    
    console.log('Dimension changes:', {
        oldWidth, oldHeight,
        newWidth: currentWhiteboardDrawingWidth,
        newHeight: currentWhiteboardDrawingHeight,
        widthChanged: oldWidth !== currentWhiteboardDrawingWidth,
        heightChanged: oldHeight !== currentWhiteboardDrawingHeight
    });

    // Update canvas dimensions
    whiteboardCanvas.width = currentWhiteboardDrawingWidth;
    whiteboardCanvas.height = currentWhiteboardDrawingHeight;
    whiteboardCanvas.style.width = currentWhiteboardDrawingWidth + 'px';
    whiteboardCanvas.style.height = currentWhiteboardDrawingHeight + 'px';

    // Position handles relative to the actual canvas position
    const handleWidth = 8;
    const handleHeight = 70;
    
    // Calculate canvas position within container (centered by flexbox)
    const canvasLeft = (containerWidth - currentWhiteboardDrawingWidth) / 2;
    const canvasTop = (containerHeight - currentWhiteboardDrawingHeight) / 2;
    
    // Position handles adjacent to the canvas edges
    wbLeftHandle.style.top = `${canvasTop + (currentWhiteboardDrawingHeight - handleHeight) / 2}px`;
    wbLeftHandle.style.left = `${canvasLeft - handleWidth}px`;
    
    wbRightHandle.style.top = `${canvasTop + (currentWhiteboardDrawingHeight - handleHeight) / 2}px`;
    wbRightHandle.style.left = `${canvasLeft + currentWhiteboardDrawingWidth}px`;
    
    console.log('Handle positions:', {
        leftHandle: { top: wbLeftHandle.style.top, left: wbLeftHandle.style.left },
        rightHandle: { top: wbRightHandle.style.top, left: wbRightHandle.style.left },
        canvasPosition: { left: canvasLeft, top: canvasTop }
    });
    console.log('=== updateWhiteboardLayout complete ===');
}

function startWhiteboardResize(event) {
    event.preventDefault();
    isResizingWhiteboard = true;
    draggedWhiteboardHandleSide = event.target.dataset.side;
    wbResizeInitialMouseX = event.clientX;
    wbResizeInitialWidth = currentWhiteboardDrawingWidth;

    document.body.style.cursor = 'ew-resize';
    // Make the dragged handle more prominent
    event.target.style.backgroundColor = 'rgba(0, 100, 220, 0.9)'; // Darker, more opaque active blue for drag
    event.target.style.borderColor = 'rgba(0, 100, 220, 1)';    // Solid border for drag
}

function doWhiteboardResize(event) {
    if (!isResizingWhiteboard) return;
    event.preventDefault();

    const deltaX = event.clientX - wbResizeInitialMouseX;
    let newWidth;

    if (draggedWhiteboardHandleSide === 'left') {
        newWidth = wbResizeInitialWidth - 2 * deltaX; // Multiply by 2 to keep centered
    } else { // 'right'
        newWidth = wbResizeInitialWidth + 2 * deltaX;
    }

    // Clamp newWidth to a minimum and maximum
    const canvasContainer = document.getElementById('canvas-container');
    const minWidth = 300; // More practical minimum size
    const maxWidth = Math.min(canvasContainer.clientWidth, window.innerWidth);
    
    newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));

    if (newWidth !== currentWhiteboardDrawingWidth) {
        // Keep height constant, only change width (allow aspect ratio to change)
        currentWhiteboardDrawingWidth = newWidth;
        // Height remains unchanged - no need to recalculate it
        whiteboardCanvas.width = currentWhiteboardDrawingWidth; // Update drawing buffer width
        // whiteboardCanvas.height stays the same

        // Update CSS display size to match drawing buffer size
        whiteboardCanvas.style.width = currentWhiteboardDrawingWidth + 'px';
        whiteboardCanvas.style.height = currentWhiteboardDrawingHeight + 'px';

        // Update WebGL viewport and uniforms
        if (gl && program) { // Check if WebGL is initialized
            gl.viewport(0, 0, currentWhiteboardDrawingWidth, currentWhiteboardDrawingHeight);
            gl.useProgram(program); // Ensure program is active for uniform setting
            gl.uniform2f(resolutionLocation, currentWhiteboardDrawingWidth, currentWhiteboardDrawingHeight);
            
            // Re-set the rectangle for drawing with new width but same height
            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer); // Ensure correct buffer is bound
            setRectangle(gl, 0, 0, currentWhiteboardDrawingWidth, currentWhiteboardDrawingHeight);
        }
        
        // Update handle positions manually instead of calling updateWhiteboardLayout
        const canvasContainer = document.getElementById('canvas-container');
        const containerWidth = canvasContainer.clientWidth;
        const containerHeight = canvasContainer.clientHeight;
        const handleWidth = 8;
        const handleHeight = 70;
        
        // Calculate canvas position within container (centered by flexbox)
        const canvasLeft = (containerWidth - currentWhiteboardDrawingWidth) / 2;
        const canvasTop = (containerHeight - currentWhiteboardDrawingHeight) / 2;
        
        // Position handles adjacent to the canvas edges
        wbLeftHandle.style.top = `${canvasTop + (currentWhiteboardDrawingHeight - handleHeight) / 2}px`;
        wbLeftHandle.style.left = `${canvasLeft - handleWidth}px`;
        
        wbRightHandle.style.top = `${canvasTop + (currentWhiteboardDrawingHeight - handleHeight) / 2}px`;
        wbRightHandle.style.left = `${canvasLeft + currentWhiteboardDrawingWidth}px`;
    }
}

function stopWhiteboardResize() {
    if (!isResizingWhiteboard) return;
    isResizingWhiteboard = false;
    draggedWhiteboardHandleSide = null;
    document.body.style.cursor = 'default';

    // Reset background and border for both handles to their default CSS styles.
    // CSS :hover will take over if mouse is still over one of them.
    if (wbLeftHandle) {
        wbLeftHandle.style.backgroundColor = ''; // Revert to CSS default
        wbLeftHandle.style.borderColor = '';   // Revert to CSS default
    }
    if (wbRightHandle) {
        wbRightHandle.style.backgroundColor = ''; // Revert to CSS default
        wbRightHandle.style.borderColor = '';   // Revert to CSS default
    }
}
