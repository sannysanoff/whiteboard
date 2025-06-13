# Whiteboard Camera

Transform your physical whiteboard or paper into a digital whiteboard using your device's camera with real-time perspective correction.

🔗 **[Try it live](https://sannysanoff.github.io/whiteboard)**

## Features

- **Real-time perspective correction** - Automatically straightens and squares your whiteboard or paper
- **Interactive setup** - Drag corner handles to precisely define your whiteboard area
- **Live preview** - See exactly what will be captured before switching to whiteboard mode
- **Video hold** - Freeze the camera feed to work with static content
- **Magnifier tool** - Precise corner positioning with zoom functionality
- **Export options** - Copy to clipboard or save as PNG
- **Responsive design** - Works on desktop and mobile devices
- **No installation required** - Runs entirely in your browser

## How to Use

1. **Position your device** - Move your camera back and angle it to see your desk/whiteboard
2. **Adjust the trapezoid** - Drag the red corner handles to match your paper or whiteboard boundaries
3. **Fine-tune with zoom** - Use the zoom slider for precise adjustments
4. **Start whiteboard mode** - Click "View Your Whiteboard" or press Enter
5. **Capture and save** - Use the floating buttons to copy or save your corrected whiteboard

## Keyboard Shortcuts

- **Spacebar** - Hold/unhold video feed (setup mode only)
- **Enter** - Switch to whiteboard mode (setup mode only)

## Technical Details

- Built with vanilla JavaScript and WebGL
- Uses perspective transformation matrices for real-time correction
- Implements Cohen-Sutherland line clipping for magnifier display
- Responsive design with CSS Grid and Flexbox
- Local storage for persistent settings

## Browser Compatibility

- Chrome/Chromium (recommended)
- Firefox
- Safari
- Edge

Requires WebGL support and camera access permissions.

## Development

This is a client-side only application. To run locally:

1. Clone the repository
2. Serve the files using any HTTP server (e.g., `python -m http.server`)
3. Open in your browser

## License

MIT License - feel free to use and modify for your projects.
