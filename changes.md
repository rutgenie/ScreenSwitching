# Project Changes: Library Deletion Sync & Simplified Font Uploader

This document summarizes the changes applied to the ScreenSwitching codebase to resolve the real-time library synchronization bug and integrate a simplified custom font uploader directly inside the text settings panel.

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
