// Global WebSocket Client
const socket = io();

// Cache variables
let currentDbState = null;
let volumeHistory = {}; // Track pre-mute volumes: { sourceId: volume }

// DOM Cache
const elCollDropdown = document.getElementById('remote-collection-dropdown');
const elScenesGrid = document.getElementById('remote-scenes-container');
const elMixerSection = document.getElementById('remote-audio-mixer-section');
const elMixerCards = document.getElementById('remote-audio-cards-container');

// ==========================================
// 1. SOCKET SYNCHRONIZATION PIPELINE
// ==========================================

socket.on('connect', () => {
  console.log('Mobile remote socket registered.');
  socket.emit('register-client', { role: 'remote' });
});

// Synchronize state immediately on connection
socket.on('sync-state', (data) => {
  currentDbState = data.state;
  renderDropdown();
  renderScenesGrid();
  renderMixer();
});

// Redraw when the global DB state is updated
socket.on('state-updated', (state) => {
  currentDbState = state;
  renderDropdown();
  renderScenesGrid();
  renderMixer();
});

// Broadcast collection switches
socket.on('collection-changed', (data) => {
  currentDbState = data.state;
  renderDropdown();
  renderScenesGrid();
  renderMixer();
});

// Synchronize active scene button glows
socket.on('scene-changed', (data) => {
  if (currentDbState) {
    currentDbState.activeSceneId = data.activeSceneId;
    
    // Quick render button glows without full redrawing list
    const buttons = document.querySelectorAll('.btn-remote-scene');
    buttons.forEach(btn => {
      const btnSceneId = btn.getAttribute('data-scene-id');
      if (btnSceneId === data.activeSceneId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    
    // Mixer must change since the active media layers have changed
    renderMixer();
  }
});

// If volume is adjusted from the PC control panel, keep mobile slider aligned
socket.on('source-controlled', (data) => {
  const { sourceId, property, value } = data;
  if (property === 'volume') {
    const slider = document.getElementById(`remote-slider-${sourceId}`);
    const txt = document.getElementById(`remote-voltxt-${sourceId}`);
    
    if (slider) slider.value = value;
    if (txt) txt.textContent = Math.round(value * 100) + '%';
    
    // Mute visual state toggles
    const muteBtn = document.querySelector(`.btn-remote-mute[data-source-id="${sourceId}"]`);
    if (muteBtn) {
      if (value === 0) {
        muteBtn.classList.add('muted');
        muteBtn.innerHTML = `<svg viewBox="0 0 24 24" style="fill:var(--error); width:18px; height:18px;"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.21.05-.42.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`;
      } else {
        muteBtn.classList.remove('muted');
        muteBtn.innerHTML = `<svg viewBox="0 0 24 24" style="fill:var(--text-secondary); width:18px; height:18px;"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
      }
    }
  }
});

// ==========================================
// 2. REMOTE UI RENDERING PIPELINES
// ==========================================

function getActiveCollection() {
  if (!currentDbState || !currentDbState.activeCollectionId) return null;
  return currentDbState.collections.find(c => c.id === currentDbState.activeCollectionId);
}

// Render the top bar dropdown choices
function renderDropdown() {
  elCollDropdown.innerHTML = '';
  if (!currentDbState || currentDbState.collections.length === 0) {
    elCollDropdown.innerHTML = '<option value="">No Collections Available</option>';
    return;
  }
  
  currentDbState.collections.forEach(coll => {
    const opt = document.createElement('option');
    opt.value = coll.id;
    opt.textContent = coll.name;
    opt.selected = coll.id === currentDbState.activeCollectionId;
    elCollDropdown.appendChild(opt);
  });
}

// Render mid-section Grid of large tap buttons
function renderScenesGrid() {
  elScenesGrid.innerHTML = '';
  const activeColl = getActiveCollection();
  
  if (!activeColl) {
    elScenesGrid.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem; text-align:center; padding:30px;">Select a Collection first</div>';
    return;
  }
  
  if (activeColl.scenes.length === 0) {
    elScenesGrid.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem; text-align:center; padding:30px;">No scenes inside this collection.</div>';
    return;
  }

  activeColl.scenes.forEach(scene => {
    const isActive = scene.id === currentDbState.activeSceneId;
    
    const btn = document.createElement('button');
    btn.className = `btn-remote-scene ${isActive ? 'active' : ''}`;
    btn.setAttribute('data-scene-id', scene.id);
    btn.onclick = () => selectScene(scene.id);
    
    btn.innerHTML = `
      <span>${scene.name}</span>
      <span class="btn-remote-scene-indicator"></span>
    `;
    
    elScenesGrid.appendChild(btn);
  });
}

// Render sound mixer cards if active scene contains video or audio layers
function renderMixer() {
  elMixerCards.innerHTML = '';
  const activeColl = getActiveCollection();
  if (!activeColl || !currentDbState.activeSceneId) {
    elMixerSection.style.display = 'none';
    return;
  }
  
  const activeScene = activeColl.scenes.find(s => s.id === currentDbState.activeSceneId);
  if (!activeScene) {
    elMixerSection.style.display = 'none';
    return;
  }
  
  // Filter for audios/videos
  const soundSources = activeScene.sources.filter(s => s.type === 'video' || s.type === 'audio');
  
  if (soundSources.length === 0) {
    elMixerSection.style.display = 'none';
    return;
  }
  
  elMixerSection.style.display = 'flex';
  
  soundSources.forEach(src => {
    const isMuted = src.volume === 0;
    
    const card = document.createElement('div');
    card.className = 'remote-audio-card';
    
    // Sound item details
    const cardHeader = document.createElement('div');
    cardHeader.className = 'remote-audio-card-header';
    cardHeader.innerHTML = `
      <span class="remote-audio-name">${src.name} (${src.type})</span>
      <span class="remote-audio-vol-txt" id="remote-voltxt-${src.id}">${Math.round((src.volume || 0) * 100)}%</span>
    `;
    card.appendChild(cardHeader);
    
    // Sliders + mutes row
    const slideRow = document.createElement('div');
    slideRow.className = 'remote-audio-slider-row';
    
    const muteBtn = document.createElement('button');
    muteBtn.className = `btn-remote-mute ${isMuted ? 'muted' : ''}`;
    muteBtn.setAttribute('data-source-id', src.id);
    muteBtn.onclick = () => toggleMute(src.id, src.volume);
    
    if (isMuted) {
      muteBtn.innerHTML = `<svg viewBox="0 0 24 24" style="fill:var(--error); width:18px; height:18px;"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.21.05-.42.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`;
    } else {
      muteBtn.innerHTML = `<svg viewBox="0 0 24 24" style="fill:var(--text-secondary); width:18px; height:18px;"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
    }
    
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'volume-slider';
    slider.id = `remote-slider-${src.id}`;
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.05';
    slider.value = src.volume !== undefined ? src.volume : 1.0;
    slider.oninput = (e) => adjustVolume(src.id, e.target.value);
    
    slideRow.appendChild(muteBtn);
    slideRow.appendChild(slider);
    card.appendChild(slideRow);
    
    elMixerCards.appendChild(card);
  });
}

// ==========================================
// 3. ACTION EVENT EMITTERS (WEBSOCKETS)
// ==========================================

function selectCollection(id) {
  socket.emit('change-collection', { collectionId: id });
}

function selectScene(id) {
  socket.emit('change-scene', { sceneId: id });
}

function adjustVolume(sourceId, volume) {
  const activeColl = getActiveCollection();
  if (!activeColl || !currentDbState.activeSceneId) return;
  
  const val = parseFloat(volume);
  
  // If sliding above zero, clear muted historical state cache
  if (val > 0) {
    delete volumeHistory[sourceId];
  }
  
  socket.emit('control-source', {
    collectionId: activeColl.id,
    sceneId: currentDbState.activeSceneId,
    sourceId: sourceId,
    property: 'volume',
    value: val
  });
}

// Mutes and restores previous volume level on double clicks
function toggleMute(sourceId, currentVol) {
  const activeColl = getActiveCollection();
  if (!activeColl || !currentDbState.activeSceneId) return;
  
  let targetVol = 0;
  
  if (currentVol === 0) {
    // Restore pre-mute value or default to 0.7
    targetVol = volumeHistory[sourceId] !== undefined ? volumeHistory[sourceId] : 0.7;
    delete volumeHistory[sourceId];
  } else {
    // Cache previous value and drop to zero
    volumeHistory[sourceId] = currentVol;
    targetVol = 0;
  }
  
  socket.emit('control-source', {
    collectionId: activeColl.id,
    sceneId: currentDbState.activeSceneId,
    sourceId: sourceId,
    property: 'volume',
    value: targetVol
  });
}

// Dropdown collection switch listeners
elCollDropdown.onchange = (e) => {
  if (e.target.value) {
    selectCollection(e.target.value);
  }
};
