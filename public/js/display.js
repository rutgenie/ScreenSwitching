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

socket.on('connect', () => {
  console.log('Showing Screen registered with WebSocket Server.');
  socket.emit('register-client', { role: 'display' });
  reportDisplayStatus();
});

// Initial state load
socket.on('sync-state', (data) => {
  currentDbState = data.state;
  renderActiveScene(true); // Initial load (no fade needed)
});

// Global state update
socket.on('state-updated', (state) => {
  currentDbState = state;
});

// Real-time scene switches
socket.on('scene-changed', (data) => {
  if (currentDbState) {
    currentDbState.activeSceneId = data.activeSceneId;
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

    if (src.type === 'image') {
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
      elem.className = `overlay-text-node position-${src.style.position}`;
      elem.style.color = src.style.color;
      elem.style.backgroundColor = src.style.background;
      elem.style.fontSize = src.style.fontSize || '2.5rem';
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
