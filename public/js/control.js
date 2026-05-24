// Global WebSocket Client
const socket = io();

// Application UI States
let currentDbState = null;
let currentDisplayStatus = null;
let selectedFile = null;
let activeTextPosition = 'center';
let selectedLibraryFile = null;

// WebRTC Stream Casting States
let webrtcPeerConnection = null;
let localCaptureStream = null;

// Screen Placement Management API Cache
let screenDetails = null;

// DOM Elements Cache
const elDisplayStatusDot = document.getElementById('display-status-dot');
const elDisplayStatusText = document.getElementById('display-status-text');
const elDisplayResRow = document.getElementById('display-res-row');
const elDisplayResolutionText = document.getElementById('display-resolution-text');
const elCollectionList = document.getElementById('collection-list-container');
const elSceneList = document.getElementById('scene-list-container');
const elSourcesList = document.getElementById('sources-list-container');
const elActiveCollectionTitle = document.getElementById('active-collection-title');
const elBtnDeleteCollection = document.getElementById('btn-delete-collection');
const elBtnAddSource = document.getElementById('btn-add-source');
const elPreviewCanvas = document.getElementById('preview-canvas');
const elScreenApiFeedback = document.getElementById('screen-api-feedback');
const elBtnLaunchDisplay = document.getElementById('btn-launch-display');

// Pairing elements
const elRemoteUrlText = document.getElementById('remote-url-text');
const elRemoteQrImg = document.getElementById('remote-qr-img');

// Modals
const modalCollection = document.getElementById('modal-collection');
const modalScene = document.getElementById('modal-scene');
const modalSource = document.getElementById('modal-source');

// Forms & Inputs
const formCreateCollection = document.getElementById('form-create-collection');
const formCreateScene = document.getElementById('form-create-scene');
const formUploadMedia = document.getElementById('form-upload-media');
const formCreateTextSource = document.getElementById('form-create-text-source');
const elDragArea = document.getElementById('file-drag-area');
const elFileInput = document.getElementById('media-file-input');
const elSelectedFileLabel = document.getElementById('selected-file-label');
const elSelectedFileName = document.getElementById('selected-file-name');
const elUploadProgressRow = document.getElementById('upload-progress-row');
const elProgressBarFill = document.getElementById('progress-bar-fill');
const elProgressPercentage = document.getElementById('progress-percentage');
const elBtnUploadSubmit = document.getElementById('btn-upload-submit');

// ==========================================
// 1. WEB SOCKETS SETUP & REAL-TIME STATE SYNC
// ==========================================

socket.on('connect', () => {
  console.log('Connected to ScreenSwitching Socket Server.');
  socket.emit('register-client', { role: 'control' });
  
  // Set up remote pairings dynamically based on window host
  const host = window.location.host;
  const remoteUrl = `${window.location.protocol}//${host}/remote.html`;
  elRemoteUrlText.textContent = remoteUrl;
  elRemoteUrlText.href = remoteUrl;
  
  // Inject QR code for smartphone remote controls
  elRemoteQrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(remoteUrl)}`;
  elRemoteQrImg.style.display = 'block';
});

// Synchronize absolute server DB state on load
socket.on('sync-state', (data) => {
  currentDbState = data.state;
  currentDisplayStatus = data.displayStatus;
  
  updateDisplayStatusUI(currentDisplayStatus);
  renderAll();
});

// Update database Cache on incremental edits
socket.on('state-updated', (state) => {
  currentDbState = state;
  renderAll();
});

// Capture display screen resolution, fullscreen, and activity status changes
socket.on('display-status-updated', (status) => {
  currentDisplayStatus = status;
  updateDisplayStatusUI(status);

  // Auto-reconnect WebRTC stream cast if TV output reconnected
  if (status.active && localCaptureStream) {
    console.log("TV screen detected online. Re-negotiating WebRTC cast stream...");
    initiateWebRTCCasting();
  }
});

// Handles instant active scene switches triggered by mobile phones
socket.on('scene-changed', (data) => {
  if (currentDbState) {
    currentDbState.activeSceneId = data.activeSceneId;
    renderAll();
  }
});

// Mirror collection switching
socket.on('collection-changed', (data) => {
  currentDbState = data.state;
  renderAll();
});

// Receive live sliders and button triggers from mobile remotes
socket.on('source-controlled', (data) => {
  const { collectionId, sceneId, sourceId, property, value } = data;
  if (!currentDbState) return;
  
  const coll = currentDbState.collections.find(c => c.id === collectionId);
  if (coll) {
    const scene = coll.scenes.find(s => s.id === sceneId);
    if (scene) {
      const src = scene.sources.find(s => s.id === sourceId);
      if (src) {
        src[property] = value;
        
        // Target dynamic UI elements to avoid full redraw blinking
        const slider = document.querySelector(`.volume-slider[data-source-id="${sourceId}"]`);
        if (slider && property === 'volume') {
          slider.value = value;
        }
        
        const visibilityBtn = document.querySelector(`.btn-visibility[data-source-id="${sourceId}"]`);
        if (visibilityBtn && property === 'visible') {
          updateVisibilityButton(visibilityBtn, value);
        }
        
        renderPreviewCanvas(); // Re-render local canvas
      }
    }
  }
});

// Re-draw text changes instantly
socket.on('text-content-updated', (data) => {
  const { sourceId, content } = data;
  const textarea = document.querySelector(`.text-input-field[data-source-id="${sourceId}"]`);
  if (textarea) {
    textarea.value = content;
  }
  
  // Re-map content to state
  if (currentDbState) {
    const activeColl = getActiveCollection();
    if (activeColl) {
      const activeScene = activeColl.scenes.find(s => s.id === currentDbState.activeSceneId);
      if (activeScene) {
        const src = activeScene.sources.find(s => s.id === sourceId);
        if (src) src.content = content;
      }
    }
  }
  renderPreviewCanvas();
});

// Update the Top Bar connection indicators
function updateDisplayStatusUI(status) {
  if (status.active) {
    elDisplayStatusDot.className = 'status-dot active';
    elDisplayStatusText.textContent = 'Online';
    elDisplayResRow.style.display = 'flex';
    elDisplayResolutionText.textContent = `${status.width}x${status.height} ${status.fullscreen ? '(Fullscreen)' : ''}`;
  } else {
    elDisplayStatusDot.className = 'status-dot inactive';
    elDisplayStatusText.textContent = 'Offline';
    elDisplayResRow.style.display = 'none';
  }
}

// ==========================================
// 2. DOM RENDERING PIPELINES (INCLUDING DRAG-DROP)
// ==========================================

function getActiveCollection() {
  if (!currentDbState || !currentDbState.activeCollectionId) return null;
  return currentDbState.collections.find(c => c.id === currentDbState.activeCollectionId);
}

function renderAll() {
  renderCollectionsList();
  renderScenesList();
  renderSourcesList();
  renderPreviewCanvas();
}

// Render left column Event Collections
function renderCollectionsList() {
  elCollectionList.innerHTML = '';
  if (!currentDbState || currentDbState.collections.length === 0) {
    elCollectionList.innerHTML = '<li style="color:var(--text-muted); font-size:0.8rem; text-align:center; padding:12px;">No collections created</li>';
    elActiveCollectionTitle.textContent = 'Select or Create a Collection';
    elBtnDeleteCollection.style.display = 'none';
    return;
  }

  currentDbState.collections.forEach(coll => {
    const isActive = coll.id === currentDbState.activeCollectionId;
    
    const li = document.createElement('li');
    li.className = `collection-item ${isActive ? 'active' : ''}`;
    li.onclick = () => selectCollection(coll.id);
    
    // Drag & Drop sequencing properties
    li.draggable = true;
    li.dataset.id = coll.id;
    
    li.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      li.classList.add('dragging');
      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'collection', id: coll.id }));
    });
    
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      li.classList.add('drag-over');
    });
    
    li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
    
    li.addEventListener('drop', async (e) => {
      e.preventDefault();
      li.classList.remove('drag-over');
      const dataStr = e.dataTransfer.getData('text/plain');
      if (!dataStr) return;
      
      try {
        const data = JSON.parse(dataStr);
        if (data.type !== 'collection' || data.id === coll.id) return;
        
        const order = currentDbState.collections.map(c => c.id);
        const srcIdx = order.indexOf(data.id);
        const targetIdx = order.indexOf(coll.id);
        if (srcIdx > -1 && targetIdx > -1) {
          order.splice(srcIdx, 1);
          order.splice(targetIdx, 0, data.id);
          
          const res = await fetch('/api/collections/reorder', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order })
          });
          if (res.ok) console.log("Collections reordered successfully.");
        }
      } catch (err) {
        console.error("Failed to reorder collections:", err);
      }
    });
    
    const span = document.createElement('span');
    span.className = 'collection-name';
    span.textContent = coll.name;
    li.appendChild(span);

    // Option Dropdown button (⋮)
    const contextBtn = document.createElement('button');
    contextBtn.className = 'btn-context-trigger';
    contextBtn.title = 'Event Actions';
    contextBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2.9 2-2 2s.9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>`;
    contextBtn.onclick = (e) => {
      e.stopPropagation();
      showContextMenu(e, 'collection', coll.id, coll.name);
    };
    li.appendChild(contextBtn);
    
    elCollectionList.appendChild(li);
    
    if (isActive) {
      elActiveCollectionTitle.textContent = coll.name;
      elBtnDeleteCollection.style.display = 'inline-flex';
    }
  });
}

// Render scenes list
function renderScenesList() {
  elSceneList.innerHTML = '';
  const activeColl = getActiveCollection();
  
  if (!activeColl) {
    elSceneList.innerHTML = '<li style="color:var(--text-muted); font-size:0.8rem; text-align:center; padding:12px;">Select a collection first</li>';
    return;
  }
  
  if (activeColl.scenes.length === 0) {
    elSceneList.innerHTML = '<li style="color:var(--text-muted); font-size:0.8rem; text-align:center; padding:12px;">No scenes found</li>';
    return;
  }

  activeColl.scenes.forEach(scene => {
    const isActive = scene.id === currentDbState.activeSceneId;
    
    const li = document.createElement('li');
    li.className = `scene-item ${isActive ? 'active' : ''}`;
    li.onclick = () => selectScene(scene.id);
    
    // Drag & Drop sequencing properties
    li.draggable = true;
    li.dataset.id = scene.id;
    
    li.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      li.classList.add('dragging');
      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'scene', id: scene.id }));
    });
    
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      li.classList.add('drag-over');
    });
    
    li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
    
    li.addEventListener('drop', async (e) => {
      e.preventDefault();
      li.classList.remove('drag-over');
      const dataStr = e.dataTransfer.getData('text/plain');
      if (!dataStr) return;
      
      try {
        const data = JSON.parse(dataStr);
        if (data.type !== 'scene' || data.id === scene.id) return;
        
        const order = activeColl.scenes.map(s => s.id);
        const srcIdx = order.indexOf(data.id);
        const targetIdx = order.indexOf(scene.id);
        if (srcIdx > -1 && targetIdx > -1) {
          order.splice(srcIdx, 1);
          order.splice(targetIdx, 0, data.id);
          
          const res = await fetch(`/api/collections/${activeColl.id}/scenes/reorder`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order })
          });
          if (res.ok) console.log("Scenes reordered successfully.");
        }
      } catch (err) {
        console.error("Failed to reorder scenes:", err);
      }
    });
    
    const spanName = document.createElement('span');
    spanName.className = 'scene-name';
    spanName.textContent = scene.name;
    li.appendChild(spanName);

    // Option Dropdown button (⋮)
    const contextBtn = document.createElement('button');
    contextBtn.className = 'btn-context-trigger';
    contextBtn.title = 'Scene Actions';
    contextBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2.9 2-2 2s.9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>`;
    contextBtn.onclick = (e) => {
      e.stopPropagation();
      showContextMenu(e, 'scene', scene.id, scene.name);
    };
    li.appendChild(contextBtn);
    
    elSceneList.appendChild(li);
  });
}

// Render central source grid cards
function renderSourcesList() {
  elSourcesList.innerHTML = '';
  const activeColl = getActiveCollection();
  
  if (!activeColl || !currentDbState.activeSceneId) {
    elSourcesList.innerHTML = `
      <div class="no-scene-placeholder">
        <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
        <p>Select an active Event and Scene to start managing presentation layers</p>
      </div>`;
    elBtnAddSource.style.display = 'none';
    document.getElementById('btn-add-existing-source').style.display = 'none';
    document.getElementById('btn-add-window-source').style.display = 'none';
    return;
  }
  
  // Show source trigger buttons
  elBtnAddSource.style.display = 'inline-flex';
  document.getElementById('btn-add-existing-source').style.display = 'inline-flex';
  document.getElementById('btn-add-window-source').style.display = 'inline-flex';
  
  const activeScene = activeColl.scenes.find(s => s.id === currentDbState.activeSceneId);
  if (!activeScene) return;
  
  if (activeScene.sources.length === 0) {
    elSourcesList.innerHTML = `
      <div class="no-scene-placeholder">
        <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
        <p>This scene has no source layers yet. Insert standard media files, library assets, or stream PowerPoint windows!</p>
      </div>`;
    return;
  }

  activeScene.sources.forEach(src => {
    const card = document.createElement('div');
    card.className = `source-card ${src.type}-type draggable`;
    
    // Drag & Drop sequencing properties
    card.draggable = true;
    card.dataset.id = src.id;
    
    card.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      card.classList.add('dragging');
      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'source', id: src.id }));
    });
    
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      card.classList.add('drag-over');
    });
    
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    
    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const dataStr = e.dataTransfer.getData('text/plain');
      if (!dataStr) return;
      
      try {
        const data = JSON.parse(dataStr);
        if (data.type !== 'source' || data.id === src.id) return;
        
        const order = activeScene.sources.map(s => s.id);
        const srcIdx = order.indexOf(data.id);
        const targetIdx = order.indexOf(src.id);
        if (srcIdx > -1 && targetIdx > -1) {
          order.splice(srcIdx, 1);
          order.splice(targetIdx, 0, data.id);
          
          const res = await fetch(`/api/collections/${activeColl.id}/scenes/${currentDbState.activeSceneId}/sources/reorder`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order })
          });
          if (res.ok) console.log("Source layers reordered.");
        }
      } catch (err) {
        console.error("Failed to reorder sources:", err);
      }
    });

    // 1. Card Header
    const cardHeader = document.createElement('div');
    cardHeader.className = 'source-header';
    
    const titleRow = document.createElement('div');
    titleRow.className = 'source-title-row';
    
    let iconPath = '';
    if (src.type === 'image') iconPath = 'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z';
    else if (src.type === 'video') iconPath = 'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z';
    else if (src.type === 'audio') iconPath = 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z';
    else if (src.type === 'text') iconPath = 'M19 4H5c-1.11 0-2 .08-2 .2v15.6c0 1.12.89 2.2 2 2.2h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-3 12H8v-2h8v2zm0-4H8V10h8v2zm0-4H8V6h8v2z';
    else if (src.type === 'webrtc') iconPath = 'M21 3H3c-1.11 0-2 .89-2 2v12c0 1.1.89 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.11-.9-2-2-2zm0 14H3V5h18v12z';
    
    titleRow.innerHTML = `
      <svg class="source-icon" viewBox="0 0 24 24"><path d="${iconPath}"/></svg>
      <span class="source-title" title="${src.name}">${src.name}</span>
    `;
    
    cardHeader.appendChild(titleRow);
    card.appendChild(cardHeader);
    
    // 2. Card Media Preview Box
    const previewArea = document.createElement('div');
    previewArea.className = 'source-preview-area';
    
    if (src.type === 'image') {
      previewArea.innerHTML = `<img src="${src.url}" alt="Preview">`;
    } else if (src.type === 'video') {
      previewArea.innerHTML = `<video src="${src.url}" muted></video>`;
    } else if (src.type === 'audio') {
      previewArea.innerHTML = `
        <div class="source-preview-placeholder">
          <svg viewBox="0 0 24 24"><path d="${iconPath}"/></svg>
          <span>Background Audio Track</span>
        </div>`;
    } else if (src.type === 'text') {
      previewArea.innerHTML = `
        <div class="source-preview-placeholder" style="padding: 10px; width: 100%;">
          <span style="font-size:0.8rem; font-family:var(--font-header); font-weight:700; color: #fff; text-shadow:0 2px 4px #000; text-align:center;">
            ${src.content.length > 50 ? src.content.substring(0, 50) + '...' : src.content}
          </span>
          <span style="font-size: 0.65rem; color: var(--accent);">Text Overlay (${src.style.position})</span>
        </div>`;
    } else if (src.type === 'webrtc') {
      previewArea.innerHTML = `
        <div class="source-preview-placeholder">
          <svg viewBox="0 0 24 24"><path d="${iconPath}"/></svg>
          <span style="color:var(--accent); font-weight:bold;">App Window Screen Cast</span>
        </div>`;
    }
    
    card.appendChild(previewArea);
    
    // 3. Card Configuration controls
    const controls = document.createElement('div');
    controls.className = 'source-controls';
    
    if (src.type === 'video' || src.type === 'audio') {
      // Volume Control Slider
      const volRow = document.createElement('div');
      volRow.className = 'volume-row';
      volRow.innerHTML = `
        <svg class="volume-icon" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
        <input type="range" class="volume-slider" min="0" max="1" step="0.05" value="${src.volume !== undefined ? src.volume : 1.0}" data-source-id="${src.id}" oninput="adjustSourceVolume('${src.id}', this.value)">
      `;
      controls.appendChild(volRow);
      
      // Dynamic Loop Checkbox
      const loopLabel = document.createElement('label');
      loopLabel.className = 'checkbox-row';
      
      const loopCheck = document.createElement('input');
      loopCheck.type = 'checkbox';
      loopCheck.checked = src.loop || false;
      loopCheck.onchange = (e) => toggleSourceLoop(src.id, e.target.checked);
      
      loopLabel.appendChild(loopCheck);
      loopLabel.appendChild(document.createTextNode('Repeat / Loop Playback'));
      controls.appendChild(loopLabel);
    }
    
    // Image, Video, and WebRTC Aspect ratio controllers
    if (['image', 'video', 'webrtc'].includes(src.type)) {
      const aspectRow = document.createElement('label');
      aspectRow.className = 'checkbox-row';
      aspectRow.style.marginTop = '4px';
      
      const aspectCheck = document.createElement('input');
      aspectCheck.type = 'checkbox';
      aspectCheck.checked = (src.aspectRatioMode || 'crop') === 'crop';
      
      aspectRow.appendChild(aspectCheck);
      aspectRow.appendChild(document.createTextNode('Smart Crop (Fill Screen Cover)'));
      controls.appendChild(aspectRow);
      
      // Manual Position & Scale translation sliders
      const manualControls = document.createElement('div');
      manualControls.className = 'manual-layout-controls';
      manualControls.style.display = (src.aspectRatioMode || 'crop') === 'manual' ? 'flex' : 'none';
      
      const layout = src.manualLayout || { scale: 1.0, x: 0, y: 0 };
      
      manualControls.innerHTML = `
        <div class="slider-group">
          <div class="slider-label-row">
            <span>Scale multiplier</span>
            <span class="slider-val" id="val-scale-${src.id}">${layout.scale.toFixed(2)}x</span>
          </div>
          <input type="range" min="0.1" max="3" step="0.05" value="${layout.scale}" oninput="adjustSourceLayout('${src.id}', 'scale', this.value)">
        </div>
        <div class="slider-group">
          <div class="slider-label-row">
            <span>Position Offset X (Horizontal)</span>
            <span class="slider-val" id="val-x-${src.id}">${layout.x}%</span>
          </div>
          <input type="range" min="-100" max="100" step="1" value="${layout.x}" oninput="adjustSourceLayout('${src.id}', 'x', this.value)">
        </div>
        <div class="slider-group">
          <div class="slider-label-row">
            <span>Position Offset Y (Vertical)</span>
            <span class="slider-val" id="val-y-${src.id}">${layout.y}%</span>
          </div>
          <input type="range" min="-100" max="100" step="1" value="${layout.y}" oninput="adjustSourceLayout('${src.id}', 'y', this.value)">
        </div>
      `;
      controls.appendChild(manualControls);
      
      aspectCheck.onchange = (e) => {
        const isCrop = e.target.checked;
        const mode = isCrop ? 'crop' : 'manual';
        manualControls.style.display = isCrop ? 'none' : 'flex';
        
        socket.emit('control-source', {
          collectionId: activeColl.id,
          sceneId: currentDbState.activeSceneId,
          sourceId: src.id,
          property: 'aspectRatioMode',
          value: mode
        });
        
        src.aspectRatioMode = mode;
        renderPreviewCanvas();
      };
    }

    if (src.type === 'text') {
      // Edit Content on the fly
      const textarea = document.createElement('textarea');
      textarea.className = 'text-input-field';
      textarea.value = src.content;
      textarea.setAttribute('data-source-id', src.id);
      textarea.oninput = (e) => editTextSourceContent(src.id, e.target.value);
      textarea.placeholder = 'Edit overlay message here...';
      controls.appendChild(textarea);
    }
    
    // 4. Card Action Buttons (Visibility toggle + Delete)
    const actionRow = document.createElement('div');
    actionRow.className = 'source-actions-row';
    
    const visibilityBtn = document.createElement('button');
    visibilityBtn.className = 'btn-card-action btn-visibility';
    visibilityBtn.setAttribute('data-source-id', src.id);
    visibilityBtn.onclick = () => toggleSourceVisibility(src.id, !src.visible);
    updateVisibilityButton(visibilityBtn, src.visible);
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-card-action btn-delete';
    deleteBtn.onclick = () => deleteSource(activeColl.id, activeScene.id, src.id);
    deleteBtn.innerHTML = `
      <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
      Delete Layer`;
      
    actionRow.appendChild(visibilityBtn);
    actionRow.appendChild(deleteBtn);
    controls.appendChild(actionRow);
    
    card.appendChild(controls);
    elSourcesList.appendChild(card);
  });
}

function updateVisibilityButton(btn, isVisible) {
  if (isVisible) {
    btn.innerHTML = `
      <svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
      Output Visible`;
    btn.style.color = 'var(--accent)';
  } else {
    btn.innerHTML = `
      <svg viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.82l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.74-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.01-.17c0-1.66-1.34-3-3-3l-.16.02z"/></svg>
      Output Hidden`;
    btn.style.color = 'var(--text-muted)';
  }
}

// Replicate active display monitor onto the control preview canvas (OBS Mirror)
function renderPreviewCanvas() {
  elPreviewCanvas.innerHTML = '';
  const activeColl = getActiveCollection();
  
  if (!activeColl || !currentDbState.activeSceneId) {
    elPreviewCanvas.innerHTML = '<span style="color: var(--text-muted); font-size: 0.75rem; text-align:center;">No active scene selected</span>';
    return;
  }
  
  const activeScene = activeColl.scenes.find(s => s.id === currentDbState.activeSceneId);
  if (!activeScene) return;
  
  // Render visual preview blocks
  const container = document.createElement('div');
  container.style.position = 'relative';
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.background = '#000';
  container.style.overflow = 'hidden';
  
  activeScene.sources.forEach((src, idx) => {
    if (!src.visible) return;
    
    let elem = null;
    
    if (src.type === 'image') {
      elem = document.createElement('img');
      elem.src = src.url;
      elem.className = 'display-element';
      applyPreviewAspectAndLayout(elem, src);
      
    } else if (src.type === 'video') {
      elem = document.createElement('video');
      elem.src = src.url;
      elem.className = 'display-element';
      applyPreviewAspectAndLayout(elem, src);
      
    } else if (src.type === 'text') {
      elem = document.createElement('div');
      elem.className = `overlay-text-node position-${src.style.position}`;
      elem.style.fontSize = '0.9rem'; // downscale inside preview
      elem.style.color = src.style.color;
      elem.style.backgroundColor = src.style.background;
      elem.textContent = src.content;
      
    } else if (src.type === 'webrtc') {
      elem = document.createElement('video');
      elem.className = 'display-element';
      elem.autoplay = true;
      elem.muted = true;
      if (localCaptureStream) {
        elem.srcObject = localCaptureStream;
      }
      applyPreviewAspectAndLayout(elem, src);
    }
    
    if (elem) {
      // preview mirroring layering indices
      elem.style.zIndex = 100 - idx;
      container.appendChild(elem);
    }
  });
  
  elPreviewCanvas.appendChild(container);
}

// Helper: Apply preview coordinates
function applyPreviewAspectAndLayout(elem, src) {
  if (!elem) return;
  const aspect = src.aspectRatioMode || 'crop';
  const layout = src.manualLayout || { scale: 1.0, x: 0, y: 0 };
  
  if (aspect === 'crop') {
    elem.style.objectFit = 'cover';
    elem.style.width = '100%';
    elem.style.height = '100%';
    elem.style.transform = 'none';
    elem.style.position = 'absolute';
    elem.style.top = '0';
    elem.style.left = '0';
  } else {
    elem.style.objectFit = 'contain';
    elem.style.width = '100%';
    elem.style.height = '100%';
    elem.style.position = 'absolute';
    elem.style.top = '0';
    elem.style.left = '0';
    elem.style.transform = `translate(${layout.x}%, ${layout.y}%) scale(${layout.scale})`;
  }
}

// ==========================================
// 3. API ACTION TRIGGERS (HTTP POST & DELETE & RENAMES & DUPLICATE)
// ==========================================

function selectCollection(id) {
  socket.emit('change-collection', { collectionId: id });
}

function selectScene(id) {
  socket.emit('change-scene', { sceneId: id });
}

// Create New Event Collection
formCreateCollection.onsubmit = async (e) => {
  e.preventDefault();
  const name = document.getElementById('new-collection-name').value.trim();
  if (!name) return;
  
  try {
    const res = await fetch('/api/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    
    if (res.ok) {
      const data = await res.json();
      closeModal('modal-collection');
      formCreateCollection.reset();
      selectCollection(data.id);
    }
  } catch (err) {
    console.error('Failed to create collection:', err);
  }
};

// Delete Active Collection
elBtnDeleteCollection.onclick = () => {
  if (!currentDbState || !currentDbState.activeCollectionId) return;
  deleteCollectionPrompt(currentDbState.activeCollectionId);
};

// Create Scene
formCreateScene.onsubmit = async (e) => {
  e.preventDefault();
  const activeColl = getActiveCollection();
  if (!activeColl) return;
  
  const name = document.getElementById('new-scene-name').value.trim();
  if (!name) return;
  
  try {
    const res = await fetch(`/api/collections/${activeColl.id}/scenes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (res.ok) {
      const data = await res.json();
      closeModal('modal-scene');
      formCreateScene.reset();
      selectScene(data.id);
    }
  } catch (err) {
    console.error('Failed to create scene:', err);
  }
};

// Media Source Upload Pipeline (Multer engine)
formUploadMedia.onsubmit = async (e) => {
  e.preventDefault();
  const activeColl = getActiveCollection();
  if (!activeColl || !currentDbState.activeSceneId || !selectedFile) return;
  
  const sourceName = document.getElementById('media-file-name').value.trim();
  
  const formData = new FormData();
  formData.append('mediaFile', selectedFile);
  formData.append('collectionId', activeColl.id);
  formData.append('sceneId', currentDbState.activeSceneId);
  formData.append('sourceName', sourceName);
  
  elUploadProgressRow.style.display = 'flex';
  elProgressBarFill.style.width = '0%';
  elProgressPercentage.textContent = 'Uploading: 0%';
  elBtnUploadSubmit.disabled = true;
  
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload', true);
  
  xhr.upload.addEventListener('progress', (event) => {
    if (event.lengthComputable) {
      const percent = Math.round((event.loaded / event.total) * 100);
      elProgressBarFill.style.width = `${percent}%`;
      elProgressPercentage.textContent = `Uploading: ${percent}%`;
    }
  });
  
  xhr.onload = function() {
    if (xhr.status === 201) {
      closeModal('modal-source');
      resetUploadForm();
    } else {
      alert(`Upload failed: ${xhr.statusText}`);
      elUploadProgressRow.style.display = 'none';
      elBtnUploadSubmit.disabled = false;
    }
  };
  
  xhr.onerror = function() {
    alert('Network error during file upload.');
    elUploadProgressRow.style.display = 'none';
    elBtnUploadSubmit.disabled = false;
  };
  
  xhr.send(formData);
};

// Create Text Source
formCreateTextSource.onsubmit = async (e) => {
  e.preventDefault();
  const activeColl = getActiveCollection();
  if (!activeColl || !currentDbState.activeSceneId) return;
  
  const name = document.getElementById('text-source-name').value.trim();
  const content = document.getElementById('text-source-content').value.trim();
  const position = document.getElementById('text-source-position').value;
  
  const style = {
    color: '#ffffff',
    fontSize: position === 'center' ? '3rem' : '2rem',
    position: position,
    background: 'rgba(15, 12, 30, 0.65)'
  };
  
  try {
    const res = await fetch(`/api/collections/${activeColl.id}/scenes/${currentDbState.activeSceneId}/sources/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content, style })
    });
    if (res.ok) {
      closeModal('modal-source');
      formCreateTextSource.reset();
    }
  } catch (err) {
    console.error('Failed to create text source:', err);
  }
};

// Delete Source
async function deleteSource(collectionId, sceneId, sourceId) {
  if (!confirm('Permanently delete this media layer and purge its file?')) return;
  
  try {
    await fetch(`/api/collections/${collectionId}/scenes/${sceneId}/sources/${sourceId}`, {
      method: 'DELETE'
    });
  } catch (err) {
    console.error('Failed to delete source:', err);
  }
}

// ==========================================
// 4. FLOATING CONTEXT ACTION MENUS
// ==========================================

function showContextMenu(e, type, targetId, currentName) {
  const menu = document.getElementById('custom-context-menu');
  menu.innerHTML = '';
  
  if (type === 'collection') {
    menu.innerHTML = `
      <button class="context-menu-item" onclick="renameCollectionPrompt('${targetId}', '${currentName}')">
        <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg> Rename Event
      </button>
      <button class="context-menu-item" onclick="duplicateCollection('${targetId}')">
        <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg> Duplicate Event
      </button>
      <button class="context-menu-item delete" onclick="deleteCollectionPrompt('${targetId}')">
        <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg> Delete Event
      </button>
    `;
  } else if (type === 'scene') {
    menu.innerHTML = `
      <button class="context-menu-item" onclick="renameScenePrompt('${targetId}', '${currentName}')">
        <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg> Rename Scene
      </button>
      <button class="context-menu-item" onclick="duplicateScene('${targetId}')">
        <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg> Duplicate Scene
      </button>
      <button class="context-menu-item delete" onclick="deleteScenePrompt('${targetId}')">
        <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg> Delete Scene
      </button>
    `;
  }
  
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY + window.scrollY}px`;
  menu.classList.add('active');
}

// Dismiss popup menu on click outside
window.addEventListener('click', () => {
  document.getElementById('custom-context-menu').classList.remove('active');
});

// Prompt action execution scripts
async function renameCollectionPrompt(id, currentName) {
  const newName = prompt("Enter a new name for this Collection:", currentName);
  if (!newName || newName.trim() === "" || newName.trim() === currentName) return;
  
  try {
    const res = await fetch(`/api/collections/${id}/rename`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() })
    });
    if (res.ok) console.log("Collection renamed.");
  } catch (err) {
    console.error("Rename event failed:", err);
  }
}

async function duplicateCollection(id) {
  try {
    const res = await fetch(`/api/collections/${id}/duplicate`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      selectCollection(data.id);
    }
  } catch (err) {
    console.error("Duplication failed:", err);
  }
}

async function deleteCollectionPrompt(id) {
  if (!confirm('Are you absolutely sure you want to delete this Collection? ALL associated files and scenes will be permanently deleted from the disk!')) return;
  
  try {
    const res = await fetch(`/api/collections/${id}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      console.log('Collection successfully deleted.');
    }
  } catch (err) {
    console.error('Failed to delete collection:', err);
  }
}

async function renameScenePrompt(sceneId, currentName) {
  const activeColl = getActiveCollection();
  if (!activeColl) return;
  const newName = prompt("Enter a new name for this Scene:", currentName);
  if (!newName || newName.trim() === "" || newName.trim() === currentName) return;
  
  try {
    const res = await fetch(`/api/collections/${activeColl.id}/scenes/${sceneId}/rename`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() })
    });
    if (res.ok) console.log("Scene renamed.");
  } catch (err) {
    console.error("Rename scene failed:", err);
  }
}

async function duplicateScene(sceneId) {
  const activeColl = getActiveCollection();
  if (!activeColl) return;
  
  try {
    const res = await fetch(`/api/collections/${activeColl.id}/scenes/${sceneId}/duplicate`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      selectScene(data.id);
    }
  } catch (err) {
    console.error("Scene duplication failed:", err);
  }
}

async function deleteScenePrompt(sceneId) {
  const activeColl = getActiveCollection();
  if (!activeColl) return;
  deleteScene(activeColl.id, sceneId);
}

// ==========================================
// 5. EXISTING MEDIA PICKER LIBRARY SYSTEM
// ==========================================

document.getElementById('btn-add-existing-source').onclick = async () => {
  const activeColl = getActiveCollection();
  if (!activeColl) return;
  
  try {
    const res = await fetch(`/api/collections/${activeColl.id}/files`);
    const files = await res.json();
    
    const grid = document.getElementById('existing-library-grid');
    grid.innerHTML = '';
    selectedLibraryFile = null;
    document.getElementById('btn-add-existing-submit').disabled = true;
    document.getElementById('existing-source-name').value = '';
    
    if (files.length === 0) {
      grid.innerHTML = '<div style="color:var(--text-muted); font-size:0.8rem; grid-column: 1/-1; text-align:center; padding:20px;">No uploaded files found in this collection folder yet. Upload some files first!</div>';
    } else {
      files.forEach(file => {
        const card = document.createElement('div');
        card.className = 'library-card';
        
        let iconPath = 'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z';
        if (file.type === 'video') iconPath = 'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z';
        else if (file.type === 'audio') iconPath = 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z';
        
        card.innerHTML = `
          <svg class="library-card-icon" viewBox="0 0 24 24"><path d="${iconPath}"/></svg>
          <span class="library-card-name" title="${file.name}">${file.name}</span>
        `;
        
        card.onclick = () => {
          document.querySelectorAll('.library-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
          selectedLibraryFile = file;
          document.getElementById('btn-add-existing-submit').disabled = false;
          document.getElementById('existing-source-name').value = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
        };
        grid.appendChild(card);
      });
    }
    
    openModal('modal-existing-source');
  } catch (err) {
    console.error("Failed to load collection assets:", err);
  }
};

document.getElementById('btn-add-existing-submit').onclick = async () => {
  const activeColl = getActiveCollection();
  if (!activeColl || !currentDbState.activeSceneId || !selectedLibraryFile) return;
  
  const name = document.getElementById('existing-source-name').value.trim();
  
  try {
    const res = await fetch(`/api/collections/${activeColl.id}/scenes/${currentDbState.activeSceneId}/sources/existing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name || selectedLibraryFile.name,
        filename: selectedLibraryFile.name,
        type: selectedLibraryFile.type
      })
    });
    
    if (res.ok) {
      closeModal('modal-existing-source');
    }
  } catch (err) {
    console.error("Failed to insert existing library asset:", err);
  }
};

// ==========================================
// 6. WEBRTC DESKTOP SCREEN SHARE STREAM CASTER
// ==========================================

document.getElementById('btn-add-window-source').onclick = async () => {
  const activeColl = getActiveCollection();
  if (!activeColl || !currentDbState.activeSceneId) return;

  // 1. Insecure Origin Context Pre-check
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    alert("⚠️ Secure Context Required!\n\nWebRTC Application Window Casting requires a Secure Context (HTTPS or localhost).\n\nPlease access the Control Panel using:\n👉 http://localhost:3001/control.html\n\nIf you are accessing from another computer on your local network, you can either:\n1. Configure HTTPS proxy options on your host server.\n2. In Chrome/Edge, enable the flag:\n   chrome://flags/#unsafely-treat-insecure-origin-as-secure\n   and add your server IP (e.g. http://192.168.1.15:3001) to the allowed list.");
    return;
  }

  try {
    // 2. Call getDisplayMedia IMMEDIATELY to preserve transient user activation gesture
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "always" },
      audio: true
    });

    localCaptureStream = stream;
    console.log("Acquired desktop window capture stream successfully!");

    // 3. Ask for the descriptive name AFTER successful capture
    let windowTitle = prompt("Enter a description display name for this window (e.g. PPT Presentation, Canva Screen):", "PowerPoint Application");
    if (windowTitle === null) {
      windowTitle = "Application Window Stream";
    }

    // 4. Register WebRTC source state entry in scene db
    const res = await fetch(`/api/collections/${activeColl.id}/scenes/${currentDbState.activeSceneId}/sources/webrtc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: windowTitle.trim() || 'Application Window Stream' })
    });

    if (!res.ok) {
      alert("Failed to register WebRTC source layer with scene state.");
      localCaptureStream.getTracks().forEach(t => t.stop());
      localCaptureStream = null;
      return;
    }

    // 5. Initiate WebRTC Peer Connection casting channel
    initiateWebRTCCasting();

    // 6. Handle stream track stoppage (if user clicks "Stop Sharing" native chrome toolbar)
    localCaptureStream.getVideoTracks()[0].onended = () => {
      console.log("Desktop capture stream track ended.");
      stopWebRTCCasting();
    };

  } catch (err) {
    console.error("getDisplayMedia capture failed:", err);
    if (err.name === 'NotAllowedError') {
      alert("Casting cancelled: Screen share permission was denied by the user.");
    } else {
      alert("Application window stream casting failed: " + err.message);
    }
  }
};

async function initiateWebRTCCasting() {
  if (!localCaptureStream) return;
  
  if (webrtcPeerConnection) {
    webrtcPeerConnection.close();
  }

  console.log("Negotiating WebRTC SDP Cast Connection...");
  webrtcPeerConnection = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

  // Load stream tracks
  localCaptureStream.getTracks().forEach(track => {
    webrtcPeerConnection.addTrack(track, localCaptureStream);
  });

  // Broker ICE candidates
  webrtcPeerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtc-signaling', {
        type: 'candidate',
        candidate: event.candidate
      });
    }
  };

  // Create and send SDP Offer
  const offer = await webrtcPeerConnection.createOffer();
  await webrtcPeerConnection.setLocalDescription(offer);

  socket.emit('webrtc-signaling', {
    type: 'offer',
    sdp: offer.sdp
  });
}

function stopWebRTCCasting() {
  if (webrtcPeerConnection) {
    webrtcPeerConnection.close();
    webrtcPeerConnection = null;
  }
  if (localCaptureStream) {
    localCaptureStream.getTracks().forEach(t => t.stop());
    localCaptureStream = null;
  }
  console.log("WebRTC screen share casting halted.");
}

// Receive Answer SDP and remote ICE Candidates
socket.on('webrtc-signaling', async (data) => {
  const { type, sdp, candidate } = data;
  
  if (type === 'answer' && webrtcPeerConnection) {
    console.log("Received WebRTC SDP Answer from Showing Screen. Cast Active!");
    await webrtcPeerConnection.setRemoteDescription(new RTCSessionDescription({ type, sdp }));
  } else if (type === 'candidate' && webrtcPeerConnection) {
    try {
      await webrtcPeerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error("Error adding remote ICE candidate:", err);
    }
  }
});

// ==========================================
// 7. REAL-TIME SOURCE CONTROL EMITTERS
// ==========================================

function adjustSourceVolume(sourceId, volume) {
  const activeColl = getActiveCollection();
  if (!activeColl || !currentDbState.activeSceneId) return;
  
  socket.emit('control-source', {
    collectionId: activeColl.id,
    sceneId: currentDbState.activeSceneId,
    sourceId: sourceId,
    property: 'volume',
    value: parseFloat(volume)
  });
}

function toggleSourceLoop(sourceId, shouldLoop) {
  const activeColl = getActiveCollection();
  if (!activeColl || !currentDbState.activeSceneId) return;
  
  socket.emit('control-source', {
    collectionId: activeColl.id,
    sceneId: currentDbState.activeSceneId,
    sourceId: sourceId,
    property: 'loop',
    value: shouldLoop
  });
}

function toggleSourceVisibility(sourceId, isVisible) {
  const activeColl = getActiveCollection();
  if (!activeColl || !currentDbState.activeSceneId) return;
  
  socket.emit('control-source', {
    collectionId: activeColl.id,
    sceneId: currentDbState.activeSceneId,
    sourceId: sourceId,
    property: 'visible',
    value: isVisible
  });
}

function editTextSourceContent(sourceId, text) {
  const activeColl = getActiveCollection();
  if (!activeColl || !currentDbState.activeSceneId) return;
  
  socket.emit('update-text-content', {
    collectionId: activeColl.id,
    sceneId: currentDbState.activeSceneId,
    sourceId: sourceId,
    content: text
  });
}

// Live aspect modifiers coordinate adjustments
function adjustSourceLayout(sourceId, property, value) {
  const activeColl = getActiveCollection();
  if (!activeColl || !currentDbState.activeSceneId) return;
  
  const label = document.getElementById(`val-${property}-${sourceId}`);
  if (label) {
    label.textContent = property === 'scale' ? `${parseFloat(value).toFixed(2)}x` : `${value}%`;
  }
  
  socket.emit('control-source', {
    collectionId: activeColl.id,
    sceneId: currentDbState.activeSceneId,
    sourceId: sourceId,
    property: property,
    value: parseFloat(value)
  });
  
  // Cache layout changes locally to render instantly in mirror preview
  const activeScene = activeColl.scenes.find(s => s.id === currentDbState.activeSceneId);
  const src = activeScene.sources.find(s => s.id === sourceId);
  if (src) {
    if (!src.manualLayout) src.manualLayout = { scale: 1.0, x: 0, y: 0 };
    src.manualLayout[property] = parseFloat(value);
  }
  renderPreviewCanvas();
}

// ==========================================
// 8. FILE DRAG & DROP UX & TABS HANDLERS
// ==========================================

function resetUploadForm() {
  formUploadMedia.reset();
  selectedFile = null;
  elSelectedFileLabel.style.display = 'none';
  elSelectedFileName.textContent = 'None';
  elUploadProgressRow.style.display = 'none';
  elProgressBarFill.style.width = '0%';
  elBtnUploadSubmit.disabled = true;
}

// Bind drag hooks
elDragArea.addEventListener('dragenter', (e) => { e.preventDefault(); elDragArea.classList.add('dragging'); });
elDragArea.addEventListener('dragover', (e) => { e.preventDefault(); elDragArea.classList.add('dragging'); });
elDragArea.addEventListener('dragleave', () => { elDragArea.classList.remove('dragging'); });
elDragArea.addEventListener('drop', (e) => {
  e.preventDefault();
  elDragArea.classList.remove('dragging');
  if (e.dataTransfer.files.length > 0) {
    handleFileSelection(e.dataTransfer.files[0]);
  }
});

elDragArea.onclick = () => elFileInput.click();
elFileInput.onchange = (e) => {
  if (e.target.files.length > 0) {
    handleFileSelection(e.target.files[0]);
  }
};

function handleFileSelection(file) {
  selectedFile = file;
  elSelectedFileName.textContent = `${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`;
  elSelectedFileLabel.style.display = 'block';
  elBtnUploadSubmit.disabled = false;
  
  const nameInput = document.getElementById('media-file-name');
  if (!nameInput.value) {
    nameInput.value = file.name.substring(0, file.name.lastIndexOf('.'));
  }
}

function toggleSourceTab(tab) {
  const fileBtn = document.getElementById('tab-file-upload');
  const textBtn = document.getElementById('tab-text-overlay');
  const fileContent = document.getElementById('source-tab-file-content');
  const textContent = document.getElementById('source-tab-text-content');
  
  if (tab === 'file') {
    fileBtn.className = 'btn-secondary btn-accent';
    textBtn.className = 'btn-secondary';
    fileContent.style.display = 'block';
    textContent.style.display = 'none';
  } else {
    fileBtn.className = 'btn-secondary';
    textBtn.className = 'btn-secondary btn-accent';
    fileContent.style.display = 'none';
    textContent.style.display = 'block';
  }
}

function setTextPosition(elem) {
  document.querySelectorAll('.style-option').forEach(opt => opt.classList.remove('selected'));
  elem.classList.add('selected');
  activeTextPosition = elem.getAttribute('data-position');
  document.getElementById('text-source-position').value = activeTextPosition;
}

// ==========================================
// 9. DYNAMIC SCREEN PLACEMENT API & LAUNCHERS
// ==========================================

async function checkMultiScreenSupport() {
  elScreenApiFeedback.innerHTML = '';
  
  if ('getScreenDetails' in window || 'getScreens' in window) {
    try {
      const getScreens = window.getScreenDetails || window.getScreens;
      screenDetails = await getScreens();
      
      console.log('Window Management Screen Placement API Supported!');
      renderScreenApiFeedback();
      
      screenDetails.onscreenchange = () => {
        renderScreenApiFeedback();
      };
      
    } catch (err) {
      console.log('Screen Placement API Blocked or Denied:', err);
      renderScreenApiFallback('Coordinates detection active. Launch popups manually onto second TV screen.');
    }
  } else {
    console.log('Window Management API unsupported by this browser.');
    renderScreenApiFallback('Auto display positioning unavailable. Drag showing window to secondary monitor and press Fullscreen.');
  }
}

function renderScreenApiFeedback() {
  elScreenApiFeedback.innerHTML = '';
  if (!screenDetails || !screenDetails.screens) return;
  
  const screens = screenDetails.screens;
  
  const labelDiv = document.createElement('div');
  labelDiv.style.fontSize = '0.75rem';
  labelDiv.style.fontWeight = 'bold';
  labelDiv.style.color = 'var(--accent)';
  labelDiv.textContent = `🖥️ Detected Monitors (${screens.length}):`;
  elScreenApiFeedback.appendChild(labelDiv);
  
  screens.forEach((scr, idx) => {
    const isTarget = !scr.isPrimary || scr.left > 0;
    const isCurrent = scr === screenDetails.currentScreen;
    
    const row = document.createElement('div');
    row.className = `screen-item-row ${isTarget ? 'secondary' : ''}`;
    row.style.border = isCurrent ? '1px solid var(--primary)' : '1px solid rgba(255,255,255,0.05)';
    
    row.innerHTML = `
      <svg viewBox="0 0 24 24"><path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/></svg>
      <div class="screen-info">
        <span class="screen-name-label">${scr.label || `Display ${idx+1}`} ${isCurrent ? '(Active)' : ''}</span>
        <span class="screen-res">${scr.width}x${scr.height} | Offsets: (${scr.left}, ${scr.top})</span>
      </div>
    `;
    
    elScreenApiFeedback.appendChild(row);
  });
}

function renderScreenApiFallback(message) {
  elScreenApiFeedback.innerHTML = `
    <div style="font-size:0.7rem; color:var(--text-muted); line-height:1.4; border-top:1px solid rgba(255,255,255,0.05); padding-top:10px;">
      ℹ️ ${message}
    </div>`;
}

elBtnLaunchDisplay.onclick = () => {
  let left = 0;
  let top = 0;
  let width = 1280;
  let height = 720;
  let popupFeatures = 'menubar=no,location=no,status=no,toolbar=no';
  
  if (screenDetails && screenDetails.screens.length > 1) {
    const secondaryScreen = screenDetails.screens.find(s => !s.isPrimary) || screenDetails.screens[1];
    left = secondaryScreen.left;
    top = secondaryScreen.top;
    width = secondaryScreen.width;
    height = secondaryScreen.height;
    
    popupFeatures += `,left=${left},top=${top},width=${width},height=${height},fullscreen=yes`;
  } else {
    left = window.screen.width || 1920;
    width = window.screen.width || 1920;
    height = window.screen.height || 1080;
    
    popupFeatures += `,left=${left},top=0,width=${width},height=${height}`;
  }
  
  const displayWindow = window.open('/display.html', 'ScreenSwitchingDisplayOutput', popupFeatures);
  if (!displayWindow) {
    alert('Popup Blocker detected! Please allow popups for this site so that ScreenSwitching can open the Showing Screen on your TV/Projector.');
  }
};

// ==========================================
// 10. MODALS TRIGGERS
// ==========================================

function openModal(id) {
  document.getElementById(id).classList.add('active');
  if (id === 'modal-source') {
    resetUploadForm();
    toggleSourceTab('file');
  }
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

document.getElementById('btn-add-collection').onclick = () => openModal('modal-collection');
document.getElementById('btn-add-scene').onclick = () => openModal('modal-scene');
elBtnAddSource.onclick = () => openModal('modal-source');

// Start up routines
window.onload = () => {
  checkMultiScreenSupport();
};
