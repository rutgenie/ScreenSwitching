# ScreenSwitching — Changelog

---

## Session: Multi-Monitor Detection & Fullscreen Projection Output
**Date:** 2026-05-30

### Overview
Implemented OBS-style automatic multi-monitor detection and direct screen projection. The "Open Showing Screen" button now auto-detects connected displays using the browser Window Management API and positions the display window directly onto the target secondary monitor. A manual "Enter Fullscreen Mode" overlay inside the display window handles the browser security restriction that prevents programmatic fullscreen without a direct user gesture.

---

### 📁 1. Control Panel HTML
#### File: [control.html](file:///home/ptong/Dev/ScreenSwitching_sideDev/public/control.html)

- Replaced the plain "Open Showing Screen" button with an **OBS-style split button** (`#launch-split-btn-wrapper`):
  - **Left side** (`#btn-launch-display`): Auto-detects the secondary monitor and launches the display window directly onto it.
  - **Right chevron** (`#btn-launch-chevron`): Opens a floating display picker menu listing all detected monitors.
- Added `#display-select-menu` — a floating panel listing each connected screen with its name, resolution, and position offset.
- Added `#display-select-backdrop` — an invisible click-trap that closes the picker when clicking outside.
- Added `#screen-api-feedback` — a dynamic area below the split button showing detected monitor count, names, and resolutions.

---

### 📁 2. Control Panel Application Logic
#### File: [control.js](file:///home/ptong/Dev/ScreenSwitching_sideDev/public/js/control.js)

- **`checkMultiScreenSupport()`** — Called on page load. Requests permission for the browser `Window Management API` (`getScreenDetails`). Attaches `onscreenchange` to auto-refresh the monitor list when displays are connected or disconnected. Falls back gracefully if denied or unsupported.

- **`renderScreenApiFeedback()`** — Renders a per-screen row for every detected monitor, showing its label, resolution, and `(left, top)` offset. The screen hosting the control panel is highlighted with a coloured border.

- **`launchDisplayOnScreen(screenObj)`** — Core projection launcher. Builds a `window.open()` features string with the target screen's `left`, `top`, `width`, and `height` coordinates to position the popup directly on the correct physical monitor. Opens `/display.html` in a named window (`ScreenSwitchingDisplayOutput`), reusing the same window handle if already open.

- **Auto-detect logic** on main button click: Prefers a non-primary screen that is not the current window's screen, with three fallback tiers before defaulting to single-monitor mode.

- **`renderDisplaySelectMenu()`** — Builds the OBS-style picker. Each item shows the screen icon (📺 secondary / 🖥️ primary), label, resolution, position, and a Primary / Secondary / This Window badge.

---

### 📁 3. Display Screen Logic
#### File: [display.js](file:///home/ptong/Dev/ScreenSwitching_sideDev/public/js/display.js)

- **Fullscreen overlay** (`#fullscreen-overlay`) is shown on load with a prompt:
  > *"Click anywhere on this window to activate Fullscreen Output"*

  This is the required design pattern for browser-based fullscreen. `requestFullscreen()` can only be called from a **direct user gesture inside the target window** — it cannot be triggered remotely from the opener window or via `setTimeout`/`postMessage` due to browser security policy.

- **`requestFullscreen()`** — Calls `document.documentElement.requestFullscreen()`. On success, fades out and hides the overlay. On rejection, hides the overlay gracefully so the presentation continues in windowed mode.

- **`reportDisplayStatus()`** — Emits the window's resolution and fullscreen state to the server so the control panel TV/Projector status indicator stays in sync.

---

### 📝 Design Notes & Known Limitations

| Behaviour | Reason |
|---|---|
| Display window appears on the correct screen automatically | Window Management API provides exact `left/top` per physical monitor |
| Fullscreen requires one click inside the display window | Browser security — `requestFullscreen()` requires a direct user gesture in that window; cannot be bypassed without Electron / native kiosk mode |
| F11 inside the display window also achieves fullscreen (Windows) | Standard browser keyboard shortcut |
| Screen picker shows monitor brand names | Provided by the OS via the Window Management API |
| Graceful fallback on single-monitor setups | Opens on primary display when only one screen is detected |

---

## Previous Session: Library Deletion Sync & Simplified Font Uploader

Changes applied to resolve the real-time library synchronization bug and integrate a simplified custom font uploader directly inside the text settings panel.

---

## 📁 1. Main Server State and Multer APIs
### File: [server.js](file:///home/ptong/Dev/ScreenSwitching/server.js)

- Modified the POST route for `/api/collections/:id/fonts` to automatically parse and extract `fontName` from the original uploaded file name (excluding extension) if `fontName` is not provided in the request body.
```javascript
// 6.2. Add a Custom Typography Font file to the library
app.post('/api/collections/:id/fonts', fontUpload.single('fontFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No font file provided.' });
  const { id } = req.params;
  let { fontName } = req.body;
  if (!fontName) {
    if (req.file.originalname) {
      fontName = path.parse(req.file.originalname).name;
    } else {
      return res.status(400).json({ error: 'Font name is required.' });
    }
  }
  // ...
```

---

## 📁 2. Control Panel HTML Modals
### File: [control.html](file:///home/ptong/Dev/ScreenSwitching/public/control.html)

- Removed the legacy custom font uploader form panel from the **Manage Collection Sources Library** modal (`#modal-manage-sources`).
- Appended a brand-new dedicated `#modal-upload-font` modal overlay right below it containing a simplified file selector and upload button (bypassing manual Font Family Name inputs entirely).
```html
  <!-- Modal 5.5: Upload Custom Font -->
  <div class="modal-overlay" id="modal-upload-font">
    <div class="modal-content" style="width: 400px;">
      <div class="modal-header">
        <h3>✏️ Upload Custom Font</h3>
        <button class="btn-icon" onclick="closeModal('modal-upload-font')">×</button>
      </div>
      <form id="form-upload-font-popup">
        <div class="form-group">
          <label style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 8px; display: block;">Select Font File (.ttf, .otf, .woff, .woff2)</label>
          <input type="file" id="popup-font-file" accept=".ttf,.otf,.woff,.woff2" required style="font-size: 0.85rem; border: 1px solid rgba(255,255,255,0.06); padding: 8px; border-radius: 6px; width: 100%; cursor: pointer; background: var(--bg-input); color: var(--text-primary);">
        </div>
        <div class="form-actions" style="margin-top: 24px;">
          <button type="button" class="btn-secondary" onclick="closeModal('modal-upload-font')">Cancel</button>
          <button type="submit" class="btn-primary">Upload Font</button>
        </div>
      </form>
    </div>
  </div>
```

---

## 📁 3. Control Panel Application Logic
### File: [control.js](file:///home/ptong/Dev/ScreenSwitching/public/js/control.js)

- **Library Deletion Real-Time Refresh:** Inside `renderAll()`, forced the library sources table to re-render using `loadManageSourcesTable()` if the Manage Sources modal is open whenever socket state changes occur:
```javascript
  const manageModal = document.getElementById('modal-manage-sources');
  if (manageModal && manageModal.classList.contains('active')) {
    loadManageSourcesTable();
  }
```
- **Inline Settings shortcut row:** Rendered an elegant "Add your font" shortcut row and "Upload Font" button directly below the typography dropdown select:
```html
          <div class="font-upload-shortcut-row" style="display: flex; align-items: center; justify-content: space-between; margin-top: 6px; font-size: 0.72rem; color: var(--text-secondary);">
            <span>Add your font</span>
            <button type="button" class="btn-secondary" style="padding: 2px 8px; font-size: 0.7rem; border-radius: 4px; height: auto;" onclick="openModal('modal-upload-font')">Upload Font</button>
          </div>
```
- **Uploader Form Handler:** Submits a simplified `FormData` payload containing the file and the auto-derived font family name (parsed from the file name):
```javascript
const formUploadFontPopup = document.getElementById('form-upload-font-popup');
if (formUploadFontPopup) {
  formUploadFontPopup.onsubmit = async (e) => {
    e.preventDefault();
    const activeColl = getActiveCollection();
    if (!activeColl) return;
    
    const fontFile = document.getElementById('popup-font-file').files[0];
    if (!fontFile) return;
    
    const fontName = fontFile.name.substring(0, fontFile.name.lastIndexOf('.'));
    
    const formData = new FormData();
    formData.append('fontName', fontName);
    formData.append('fontFile', fontFile);
    // ...
```
- **Live Stylesheet Injection:** Created `synchronizeCustomFonts(collection)` inside the control dashboard to inject dynamic `@font-face` styles so custom uploaded fonts show up immediately on the local preview canvas.

---

## 📁 4. Mirror Screen Custom Font Loading
### File: [display.js](file:///home/ptong/Dev/ScreenSwitching/public/js/display.js)

- Corrected the font file loading source path inside `synchronizeCustomFonts(collection)` to fetch from the physical serving folder `/uploads/_fonts/` instead of the legacy incorrect `/uploads/fonts/` path:
```javascript
  collection.fonts.forEach(font => {
    cssRules += `
      @font-face {
        font-family: '${font.name}';
        src: url('/uploads/_fonts/${font.filename}');
      }
    `;
  });
```
