// Global WebSocket Client
const socket = io();

// UI State Cache
let currentDbState = null;
let activeContainerId = 'a'; // Tracks which of the dual containers ('a' or 'b') is active
const containerA = document.getElementById('layer-container-a');
const containerB = document.getElementById('layer-container-b');
const fullscreenOverlay = document.getElementById('fullscreen-overlay');

// WebRTC Stream Elements
let peerConnection = null;
let webrtcStream = null;

// ==========================================
// 1. DOCK & FULLSCREEN TRIGGERS
// ==========================================

// Request fullscreen on click
fullscreenOverlay.onclick = () => {
  requestFullscreen();
};

function requestFullscreen() {
  const docEl = document.documentElement;
  
  const launchFS = docEl.requestFullscreen || 
                   docEl.mozRequestFullScreen || 
                   docEl.webkitRequestFullScreen || 
                   docEl.msRequestFullscreen;
                   
  if (launchFS) {
    launchFS.call(docEl)
      .then(() => {
        // Fade out overlay prompt
        fullscreenOverlay.style.opacity = 0;
        setTimeout(() => {
          fullscreenOverlay.style.display = 'none';
        }, 500);
        reportDisplayStatus();
      })
      .catch((err) => {
        console.error('Fullscreen launch rejected:', err);
        // Fallback: hide overlay anyway so presentation works in normal window
        fullscreenOverlay.style.opacity = 0;
        setTimeout(() => {
          fullscreenOverlay.style.display = 'none';
        }, 500);
      });
  } else {
    fullscreenOverlay.style.display = 'none';
  }
}

// Report screen metrics to server
function reportDisplayStatus() {
  const isFS = !!(document.fullscreenElement || 
                 document.webkitFullscreenElement || 
                 document.mozFullScreenElement || 
                 document.msFullscreenElement);
                 
  socket.emit('display-status', {
    active: true,
    width: window.innerWidth,
    height: window.innerHeight,
    fullscreen: isFS
  });
}

// Bind resize and fullscreen state shifts
window.onresize = reportDisplayStatus;
document.addEventListener('fullscreenchange', reportDisplayStatus);
document.addEventListener('webkitfullscreenchange', reportDisplayStatus);
document.addEventListener('mozfullscreenchange', reportDisplayStatus);

// ==========================================
// 2. WEBRTC WINDOW CAST STREAM RECEIVER
// ==========================================

socket.on('webrtc-signaling', async (data) => {
  const { type, sdp, candidate } = data;
  
  if (type === 'offer') {
    console.log('Received WebRTC SDP Offer from Control Panel. Connecting...');
    
    if (peerConnection) {
      peerConnection.close();
    }
    
    peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    
    // Forward ICE Candidates back to the sender
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-signaling', {
          type: 'candidate',
          candidate: event.candidate
        });
      }
    };
    
    // Play incoming stream track
    peerConnection.ontrack = (event) => {
      console.log('WebRTC Stream Track received!');
      webrtcStream = event.streams[0];
      
      // Update any active WebRTC video elements
      const elements = document.querySelectorAll('.webrtc-element');
      elements.forEach(el => {
        el.srcObject = webrtcStream;
        el.play().catch(e => console.error('Play WebRTC stream error:', e));
      });
    };
    
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription({ type, sdp }));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      
      socket.emit('webrtc-signaling', {
        type: 'answer',
        sdp: answer.sdp
      });
    } catch (err) {
      console.error('Failed to resolve WebRTC session:', err);
    }
    
  } else if (type === 'candidate' && peerConnection) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('Error adding ICE Candidate:', err);
    }
  }
});

// ==========================================
// 3. SOCKET STATE SYNCHRONIZATION
// ==========================================

let activePlaylistIntervals = [];

function clearActivePlaylistCycles() {
  activePlaylistIntervals.forEach(timer => {
    if (timer && typeof timer.clear === 'function') {
      timer.clear();
    }
  });
  activePlaylistIntervals = [];
}

function synchronizeCustomFonts(collection) {
  if (!collection || !collection.fonts) return;
  
  let styleNode = document.getElementById('custom-fonts-style-block');
  if (!styleNode) {
    styleNode = document.createElement('style');
    styleNode.id = 'custom-fonts-style-block';
    document.head.appendChild(styleNode);
  }
  
  let cssRules = '';
  collection.fonts.forEach(font => {
    cssRules += `
      @font-face {
        font-family: '${font.name}';
        src: url('/uploads/fonts/${font.filename}');
      }
    `;
  });
  styleNode.innerHTML = cssRules;
  console.log("Synchronized custom fonts onto display:", collection.fonts.map(f => f.name));
}

socket.on('connect', () => {
  console.log('Showing Screen registered with WebSocket Server.');
  socket.emit('register-client', { role: 'display' });
  reportDisplayStatus();
});

// Initial state load
socket.on('sync-state', (data) => {
  currentDbState = data.state;
  if (currentDbState && currentDbState.activeCollectionId) {
    const collection = currentDbState.collections.find(c => c.id === currentDbState.activeCollectionId);
    synchronizeCustomFonts(collection);
  }
  renderActiveScene(true); // Initial load (no fade needed)
});

// Global state update
socket.on('state-updated', (state) => {
  currentDbState = state;
  if (currentDbState && currentDbState.activeCollectionId) {
    const collection = currentDbState.collections.find(c => c.id === currentDbState.activeCollectionId);
    synchronizeCustomFonts(collection);
  }
});

// Real-time scene switches
socket.on('scene-changed', (data) => {
  if (currentDbState) {
    currentDbState.activeSceneId = data.activeSceneId;
    clearActivePlaylistCycles();
    renderActiveScene(false); // Perform crossfade
  }
});

// Dynamic source sliders or visibility shifts
socket.on('source-controlled', (data) => {
  const { sourceId, property, value } = data;
  const activeContainer = activeContainerId === 'a' ? containerA : containerB;
  
  const mediaElement = activeContainer.querySelector(`[data-source-id="${sourceId}"]`);
  
  if (mediaElement) {
    if (property === 'volume') {
      mediaElement.volume = value;
    } else if (property === 'loop') {
      mediaElement.loop = value;
    } else if (property === 'visible') {
      mediaElement.style.display = value ? 'block' : 'none';
    } else if (property === 'aspectRatioMode') {
      const src = findSourceInState(sourceId);
      if (src) {
        src.aspectRatioMode = value;
        applyMediaAspectAndLayout(mediaElement, src);
      }
    } else if (['scale', 'x', 'y'].includes(property)) {
      const src = findSourceInState(sourceId);
      if (src) {
        if (!src.manualLayout) src.manualLayout = { scale: 1.0, x: 0, y: 0 };
        src.manualLayout[property] = parseFloat(value);
        applyMediaAspectAndLayout(mediaElement, src);
      }
    }
  }
});

// Live Typewriter edits
socket.on('text-content-updated', (data) => {
  const { sourceId, content } = data;
  const activeContainer = activeContainerId === 'a' ? containerA : containerB;
  
  const textNode = activeContainer.querySelector(`.overlay-text-node[data-source-id="${sourceId}"]`);
  if (textNode) {
    textNode.textContent = content;
  }
});

// Helper: find source in active collection state
function findSourceInState(sourceId) {
  if (!currentDbState || !currentDbState.activeCollectionId) return null;
  const collection = currentDbState.collections.find(c => c.id === currentDbState.activeCollectionId);
  if (!collection) return null;
  for (const scene of collection.scenes) {
    const src = scene.sources.find(s => s.id === sourceId);
    if (src) return src;
  }
  return null;
}

// Helper: Apply smart-crop aspect ratios and manual transforms
function applyMediaAspectAndLayout(elem, src) {
  if (!elem) return;
  const aspect = src.aspectRatioMode || 'crop';
  const layout = src.manualLayout || { scale: 1.0, x: 0, y: 0 };
  
  if (aspect === 'crop') {
    elem.style.objectFit = 'cover';
    elem.style.width = '100%';
    elem.style.height = '100%';
    elem.style.transform = 'none';
    elem.style.top = '0';
    elem.style.left = '0';
  } else {
    elem.style.objectFit = 'contain';
    elem.style.width = '100%';
    elem.style.height = '100%';
    elem.style.top = '0';
    elem.style.left = '0';
    elem.style.transform = `translate(${layout.x}%, ${layout.y}%) scale(${layout.scale})`;
  }
}

// ==========================================
// 4. OBS DUAL-LAYER TRANSITION RENDERING ENGINE
// ==========================================

function renderActiveScene(immediate = false) {
  if (!currentDbState || !currentDbState.activeCollectionId || !currentDbState.activeSceneId) {
    return;
  }

  const collection = currentDbState.collections.find(c => c.id === currentDbState.activeCollectionId);
  if (!collection) return;

  const scene = collection.scenes.find(s => s.id === currentDbState.activeSceneId);
  if (!scene) return;

  // Determine active and incoming containers
  const currentActiveContainer = activeContainerId === 'a' ? containerA : containerB;
  const targetBufferContainer = activeContainerId === 'a' ? containerB : containerA;

  // Empty buffer
  targetBufferContainer.innerHTML = '';

  console.log(`Preloading scene: "${scene.name}" into Container: ${activeContainerId === 'a' ? 'B' : 'A'}`);

  // Build and insert assets
  scene.sources.forEach((src, idx) => {
    let elem = null;

    if (src.isPlaylist || src.type === 'playlist') {
      elem = document.createElement('div');
      elem.className = 'display-element playlist-container';
      applyMediaAspectAndLayout(elem, src);
      
      const files = src.playlistFiles || [];
      if (files.length > 0) {
        const pLayerA = document.createElement('div');
        pLayerA.className = 'playlist-layer active';
        pLayerA.style.transition = `opacity ${src.transitionDuration || 300}ms ease-in-out`;
        
        const pLayerB = document.createElement('div');
        pLayerB.className = 'playlist-layer';
        pLayerB.style.transition = `opacity ${src.transitionDuration || 300}ms ease-in-out`;
        
        elem.appendChild(pLayerA);
        elem.appendChild(pLayerB);
        
        let currentFileIndex = 0;
        let activeLayer = pLayerA;
        let inactiveLayer = pLayerB;
        
        const getMediaType = (filename) => {
          if (!filename) return 'image';
          const ext = filename.split('.').pop().toLowerCase();
          if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) return 'image';
          if (['mp4', 'webm', 'ogg', 'mov'].includes(ext)) return 'video';
          if (['mp3', 'wav', 'aac', 'flac'].includes(ext)) return 'audio';
          return 'image';
        };
        
        const loadMediaIntoLayer = (layer, fileObj, onLoaded) => {
          layer.innerHTML = '';
          if (!fileObj) {
            if (onLoaded) onLoaded();
            return;
          }
          
          // Support both legacy string array and the new object array structure
          const filename = typeof fileObj === 'string' ? fileObj : (fileObj.name || '');
          const fileUrl = typeof fileObj === 'string' ? `/uploads/${collection.id}/${fileObj}` : (fileObj.url || '');
          
          const mediaType = getMediaType(filename);
          let child = null;
          
          let called = false;
          const done = () => {
            if (called) return;
            called = true;
            if (onLoaded) onLoaded();
          };
          
          // Safety timeout to prevent playlist freeze if media loading hangs or gets blocked
          const safetyTimeout = setTimeout(done, 2000);
          
          if (mediaType === 'image') {
            child = document.createElement('img');
            child.onload = () => {
              clearTimeout(safetyTimeout);
              done();
            };
            child.onerror = () => {
              clearTimeout(safetyTimeout);
              console.error("Image failed to load:", fileUrl);
              done();
            };
            child.style.width = '100%';
            child.style.height = '100%';
            child.style.objectFit = (src.aspectRatioMode || 'crop') === 'crop' ? 'cover' : 'contain';
            child.src = fileUrl;
            layer.appendChild(child);
            
          } else if (mediaType === 'video') {
            child = document.createElement('video');
            child.style.width = '100%';
            child.style.height = '100%';
            child.style.objectFit = (src.aspectRatioMode || 'crop') === 'crop' ? 'cover' : 'contain';
            child.autoplay = true;
            child.playsInline = true;
            child.muted = src.volume === 0 || src.volume === undefined;
            if (src.volume !== undefined) child.volume = src.volume;
            
            child.oncanplay = () => {
              clearTimeout(safetyTimeout);
              child.play().catch(e => {
                console.warn("Autoplay failed, attempting muted play:", e);
                child.muted = true;
                child.play().catch(err => console.error("Muted play also failed:", err));
              });
              done();
            };
            
            child.onerror = (e) => {
              clearTimeout(safetyTimeout);
              console.error("Video failed to load:", fileUrl, e);
              done();
            };
            
            child.src = fileUrl;
            layer.appendChild(child);
            
          } else if (mediaType === 'audio') {
            child = document.createElement('audio');
            child.autoplay = true;
            if (src.volume !== undefined) child.volume = src.volume;
            
            child.oncanplay = () => {
              clearTimeout(safetyTimeout);
              child.play().catch(e => console.error("Audio play failed:", e));
              done();
            };
            
            child.onerror = (e) => {
              clearTimeout(safetyTimeout);
              console.error("Audio failed to load:", fileUrl, e);
              done();
            };
            
            child.src = fileUrl;
            layer.appendChild(child);
          }
        };
        
        loadMediaIntoLayer(pLayerA, files[0]);
        
        const cycleToNext = () => {
          if (files.length <= 1) return;
          currentFileIndex = (currentFileIndex + 1) % files.length;
          const nextFile = files[currentFileIndex];
          
          loadMediaIntoLayer(inactiveLayer, nextFile, () => {
            if (src.transitionEffect === 'fade') {
              inactiveLayer.classList.add('active');
              activeLayer.classList.remove('active');
            } else {
              inactiveLayer.style.transition = 'none';
              activeLayer.style.transition = 'none';
              inactiveLayer.classList.add('active');
              activeLayer.classList.remove('active');
              setTimeout(() => {
                inactiveLayer.style.transition = `opacity ${src.transitionDuration || 300}ms ease-in-out`;
                activeLayer.style.transition = `opacity ${src.transitionDuration || 300}ms ease-in-out`;
              }, 50);
            }
            
            const temp = activeLayer;
            activeLayer = inactiveLayer;
            inactiveLayer = temp;
            
            scheduleNext();
          });
        };
        
        let cycleTimeout = null;
        
        const scheduleNext = () => {
          if (cycleTimeout) clearTimeout(cycleTimeout);
          
          const activeVideo = activeLayer.querySelector('video');
          const activeAudio = activeLayer.querySelector('audio');
          if (activeVideo) {
            activeVideo.onended = () => {
              cycleToNext();
            };
          } else if (activeAudio) {
            activeAudio.onended = () => {
              cycleToNext();
            };
          } else {
            cycleTimeout = setTimeout(cycleToNext, (src.imageDuration || 5) * 1000);
          }
        };
        
        scheduleNext();
        
        activePlaylistIntervals.push({
          clear: () => {
            if (cycleTimeout) clearTimeout(cycleTimeout);
            const videos = elem.querySelectorAll('video');
            videos.forEach(v => { v.pause(); v.src = ''; });
            const audios = elem.querySelectorAll('audio');
            audios.forEach(a => { a.pause(); a.src = ''; });
          }
        });
      }
      
    } else if (src.type === 'image') {
      elem = document.createElement('img');
      elem.src = src.url;
      elem.className = 'display-element';
      applyMediaAspectAndLayout(elem, src);
      
    } else if (src.type === 'video') {
      elem = document.createElement('video');
      elem.src = src.url;
      elem.className = 'display-element';
      elem.autoplay = true;
      elem.playsInline = true;
      elem.loop = src.loop || false;
      elem.volume = src.volume !== undefined ? src.volume : 1.0;
      applyMediaAspectAndLayout(elem, src);
      
    } else if (src.type === 'audio') {
      elem = document.createElement('audio');
      elem.src = src.url;
      elem.autoplay = true;
      elem.loop = src.loop !== undefined ? src.loop : true;
      elem.volume = src.volume !== undefined ? src.volume : 1.0;
      
    } else if (src.type === 'text') {
      elem = document.createElement('div');
      elem.className = 'overlay-text-node';
      
      // Absolute positioning parameters
      elem.style.position = 'absolute';
      elem.style.left = `${src.style.left !== undefined ? src.style.left : 20}%`;
      elem.style.top = `${src.style.top !== undefined ? src.style.top : 40}%`;
      elem.style.width = `${src.style.width !== undefined ? src.style.width : 60}%`;
      elem.style.height = `${src.style.height !== undefined ? src.style.height : 20}%`;
      elem.style.display = 'flex';
      elem.style.alignItems = 'center';
      elem.style.justifyContent = 'center';
      elem.style.textAlign = 'center';
      elem.style.boxSizing = 'border-box';
      
      // Text visual overlay formatting
      elem.style.fontFamily = src.style.fontFamily || 'Open Sans';
      elem.style.color = src.style.color || '#ffffff';
      elem.style.backgroundColor = src.style.background || 'rgba(15,12,30,0.65)';
      elem.style.padding = `${src.style.padding !== undefined ? src.style.padding : 15}px`;
      elem.style.fontSize = src.style.fontSize || '2.5rem';
      
      elem.style.fontWeight = src.style.bold ? 'bold' : 'normal';
      elem.style.fontStyle = src.style.italic ? 'italic' : 'normal';
      elem.style.textDecoration = src.style.underline ? 'underline' : 'none';
      
      const shadowColor = src.style.shadowColor || '#000000';
      const shadowBlur = src.style.shadowBlur !== undefined ? src.style.shadowBlur : 4;
      const shadowDist = src.style.shadowDistance !== undefined ? src.style.shadowDistance : 2;
      const shadowAng = src.style.shadowAngle !== undefined ? src.style.shadowAngle : 45;
      const shadowRad = shadowAng * Math.PI / 180;
      const shadowX = Math.round(shadowDist * Math.cos(shadowRad));
      const shadowY = Math.round(shadowDist * Math.sin(shadowRad));
      elem.style.textShadow = `${shadowX}px ${shadowY}px ${shadowBlur}px ${shadowColor}`;
      
      elem.textContent = src.content;
      
    } else if (src.type === 'webrtc') {
      elem = document.createElement('video');
      elem.className = 'display-element webrtc-element';
      elem.autoplay = true;
      elem.playsInline = true;
      elem.muted = true; // prevent local microphonic sound feedback loops
      applyMediaAspectAndLayout(elem, src);
      
      if (webrtcStream) {
        elem.srcObject = webrtcStream;
      }
    }

    if (elem) {
      elem.setAttribute('data-source-id', src.id);
      elem.style.display = src.visible ? 'block' : 'none';
      
      // Dynamic Visual Layering: topmost item gets highest z-index
      elem.style.zIndex = 100 - idx;
      
      targetBufferContainer.appendChild(elem);
    }
  });

  if (immediate) {
    targetBufferContainer.classList.add('active');
    currentActiveContainer.classList.remove('active');
    currentActiveContainer.innerHTML = '';
    activeContainerId = activeContainerId === 'a' ? 'b' : 'a';
  } else {
    // Crossfade Resolve
    targetBufferContainer.classList.add('active');
    currentActiveContainer.classList.remove('active');

    // Smooth fade outgoing media
    const outgoingMedia = currentActiveContainer.querySelectorAll('video, audio');
    outgoingMedia.forEach(media => {
      fadeVolumeOut(media, 800);
    });

    activeContainerId = activeContainerId === 'a' ? 'b' : 'a';
    
    setTimeout(() => {
      const containerToClear = activeContainerId === 'a' ? containerB : containerA;
      const videos = containerToClear.querySelectorAll('video');
      videos.forEach(v => { v.pause(); v.src = ''; v.load(); });
      const audios = containerToClear.querySelectorAll('audio');
      audios.forEach(a => { a.pause(); a.src = ''; });
      
      containerToClear.innerHTML = '';
    }, 900);
  }
}

// Fade Audio levels smoothly over X milliseconds
function fadeVolumeOut(mediaElement, duration) {
  const startVolume = mediaElement.volume;
  if (startVolume === 0) return;
  
  const steps = 15;
  const intervalTime = duration / steps;
  let currentStep = 0;
  
  const fadeInterval = setInterval(() => {
    currentStep++;
    const nextVolume = startVolume * (1 - (currentStep / steps));
    if (nextVolume <= 0.02) {
      mediaElement.volume = 0;
      mediaElement.pause();
      clearInterval(fadeInterval);
    } else {
      mediaElement.volume = nextVolume;
    }
  }, intervalTime);
}
