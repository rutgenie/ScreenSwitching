const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

// Try importing qrcode-terminal, fallback if not installed yet
let qrcodeTerminal;
try {
  qrcodeTerminal = require('qrcode-terminal');
} catch (e) {
  console.log('qrcode-terminal package is missing, will load without rendering terminal QR codes.');
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3001;
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure database folder, database file, and uploads root exist
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Global server state cached in memory, synchronized with db.json
let state = {
  activeCollectionId: '',
  activeSceneId: '',
  collections: []
};

// Load State from Database
function loadState() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      state = JSON.parse(raw);
      console.log('State successfully loaded from db.json');
    } else {
      saveState(); // write defaults
    }
  } catch (err) {
    console.error('Error loading db.json, starting with empty state:', err);
  }
}

// Save State to Database
function saveState() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing to db.json:', err);
  }
}

loadState();

// Express Configuration
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// Helper: Get collection directory path
function getCollectionDir(collectionId) {
  const dir = path.join(UPLOADS_DIR, collectionId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// Multer Setup for Dynamic Collection Storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const collectionId = req.body.collectionId || state.activeCollectionId;
    if (!collectionId) {
      return cb(new Error('No active collection specified for dynamic file storage.'));
    }
    const dir = getCollectionDir(collectionId);
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    // Generate unique name keeping original extension
    const ext = path.extname(file.originalname);
    const basename = path.basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9]/g, '_')
      .toLowerCase();
    cb(null, `${basename}_${Date.now()}${ext}`);
  }
});

const upload = multer({ storage: storage });

// REST APIs

// 1. Get full database state
app.get('/api/state', (req, res) => {
  res.json(state);
});

// 2. Create a new collection
app.post('/api/collections', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Collection name is required.' });

  const id = `coll_${uuidv4().substring(0, 8)}`;
  const collectionDir = getCollectionDir(id);

  const newCollection = {
    id,
    name,
    folder: `uploads/${id}`,
    scenes: []
  };

  state.collections.push(newCollection);
  if (!state.activeCollectionId) {
    state.activeCollectionId = id;
  }
  saveState();

  io.emit('state-updated', state);
  res.status(201).json(newCollection);
});

// 3. Delete a collection (and its media files recursively)
app.delete('/api/collections/:id', (req, res) => {
  const { id } = req.params;
  const index = state.collections.findIndex(c => c.id === id);
  if (index === -1) return res.status(404).json({ error: 'Collection not found.' });

  // Delete physical directory
  const dirPath = path.join(UPLOADS_DIR, id);
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }

  state.collections.splice(index, 1);

  // Re-evaluate active state if deleted collection was active
  if (state.activeCollectionId === id) {
    state.activeCollectionId = state.collections.length > 0 ? state.collections[0].id : '';
    const activeColl = state.collections.find(c => c.id === state.activeCollectionId);
    state.activeSceneId = (activeColl && activeColl.scenes.length > 0) ? activeColl.scenes[0].id : '';
  }
  saveState();

  io.emit('state-updated', state);
  res.json({ success: true, message: 'Collection deleted.' });
});

// 4. Create a scene in a collection
app.post('/api/collections/:id/scenes', (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Scene name is required.' });

  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  const sceneId = `scene_${uuidv4().substring(0, 8)}`;
  const newScene = {
    id: sceneId,
    name,
    sources: []
  };

  collection.scenes.push(newScene);

  // Set active scene if none selected
  if (state.activeCollectionId === id && !state.activeSceneId) {
    state.activeSceneId = sceneId;
  }
  saveState();

  io.emit('state-updated', state);
  res.status(201).json(newScene);
});

// 5. Delete a scene
app.delete('/api/collections/:id/scenes/:sceneId', (req, res) => {
  const { id, sceneId } = req.params;
  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  const sceneIndex = collection.scenes.findIndex(s => s.id === sceneId);
  if (sceneIndex === -1) return res.status(404).json({ error: 'Scene not found.' });

  const scene = collection.scenes[sceneIndex];

  // Clean up physical files associated with sources inside this scene
  scene.sources.forEach(src => {
    if (src.url && src.url.startsWith('/uploads/')) {
      const filepath = path.join(__dirname, src.url);
      if (fs.existsSync(filepath)) {
        try {
          fs.unlinkSync(filepath);
        } catch (err) {
          console.error(`Failed to delete source file ${filepath}:`, err);
        }
      }
    }
  });

  collection.scenes.splice(sceneIndex, 1);

  if (state.activeSceneId === sceneId) {
    state.activeSceneId = collection.scenes.length > 0 ? collection.scenes[0].id : '';
  }
  saveState();

  io.emit('state-updated', state);
  res.json({ success: true, message: 'Scene deleted.' });
});

// 6. Upload a media source (Image, Video, Audio) to a Scene
app.post('/api/upload', upload.single('mediaFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No media file provided.' });

  const { collectionId, sceneId, sourceName } = req.body;
  if (!collectionId || !sceneId) {
    return res.status(400).json({ error: 'Collection ID and Scene ID are required.' });
  }

  const collection = state.collections.find(c => c.id === collectionId);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  const scene = collection.scenes.find(s => s.id === sceneId);
  if (!scene) return res.status(404).json({ error: 'Scene not found.' });

  // Deduce type from mimetype
  let type = 'image';
  if (req.file.mimetype.startsWith('video/')) {
    type = 'video';
  } else if (req.file.mimetype.startsWith('audio/')) {
    type = 'audio';
  }

  const sourceId = `src_${uuidv4().substring(0, 8)}`;
  const relativeUrl = `/uploads/${collectionId}/${req.file.filename}`;

  const newSource = {
    id: sourceId,
    name: sourceName || req.file.originalname,
    type: type,
    url: relativeUrl,
    visible: true
  };

  // Add initial player configurations
  if (type === 'video' || type === 'audio') {
    newSource.volume = 1.0;
    newSource.loop = (type === 'audio'); // Audio loops by default, video plays once
  }

  scene.sources.push(newSource);
  saveState();

  io.emit('state-updated', state);
  res.status(201).json(newSource);
});

// 6.5. Add an existing collection asset source to a scene
app.post('/api/collections/:id/scenes/:sceneId/sources/existing', (req, res) => {
  const { id, sceneId } = req.params;
  const { name, filename, type } = req.body;
  if (!filename || !type) return res.status(400).json({ error: 'Filename and Type are required.' });

  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  const scene = collection.scenes.find(s => s.id === sceneId);
  if (!scene) return res.status(404).json({ error: 'Scene not found.' });

  const sourceId = `src_${uuidv4().substring(0, 8)}`;
  const relativeUrl = `/uploads/${id}/${filename}`;

  const newSource = {
    id: sourceId,
    name: name || filename,
    type: type,
    url: relativeUrl,
    visible: true,
    aspectRatioMode: 'crop',
    manualLayout: { scale: 1.0, x: 0, y: 0 }
  };

  if (type === 'video' || type === 'audio') {
    newSource.volume = 1.0;
    newSource.loop = (type === 'audio');
  }

  scene.sources.push(newSource);
  saveState();

  io.emit('state-updated', state);
  res.status(201).json(newSource);
});

// 6.7. Add a WebRTC stream source to a scene
app.post('/api/collections/:id/scenes/:sceneId/sources/webrtc', (req, res) => {
  const { id, sceneId } = req.params;
  const { name } = req.body;

  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  const scene = collection.scenes.find(s => s.id === sceneId);
  if (!scene) return res.status(404).json({ error: 'Scene not found.' });

  const sourceId = `src_${uuidv4().substring(0, 8)}`;

  const newSource = {
    id: sourceId,
    name: name || 'Application Window Stream',
    type: 'webrtc',
    visible: true,
    aspectRatioMode: 'crop',
    manualLayout: { scale: 1.0, x: 0, y: 0 }
  };

  scene.sources.push(newSource);
  saveState();

  io.emit('state-updated', state);
  res.status(201).json(newSource);
});

// 7. Add a text source overlay to a scene
app.post('/api/collections/:id/scenes/:sceneId/sources/text', (req, res) => {
  const { id, sceneId } = req.params;
  const { name, content, style } = req.body;
  if (!content) return res.status(400).json({ error: 'Text content is required.' });

  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  const scene = collection.scenes.find(s => s.id === sceneId);
  if (!scene) return res.status(404).json({ error: 'Scene not found.' });

  const sourceId = `src_${uuidv4().substring(0, 8)}`;
  const newSource = {
    id: sourceId,
    name: name || 'Text Overlay',
    type: 'text',
    content: content,
    style: style || {
      color: '#ffffff',
      fontSize: '2rem',
      position: 'center',
      background: 'rgba(0,0,0,0.5)'
    },
    visible: true
  };

  scene.sources.push(newSource);
  saveState();

  io.emit('state-updated', state);
  res.status(201).json(newSource);
});

// 8. Delete a source
app.delete('/api/collections/:id/scenes/:sceneId/sources/:sourceId', (req, res) => {
  const { id, sceneId, sourceId } = req.params;
  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  const scene = collection.scenes.find(s => s.id === sceneId);
  if (!scene) return res.status(404).json({ error: 'Scene not found.' });

  const sourceIndex = scene.sources.findIndex(src => src.id === sourceId);
  if (sourceIndex === -1) return res.status(404).json({ error: 'Source not found.' });

  const source = scene.sources[sourceIndex];

  // Physically delete media file
  if (source.url && source.url.startsWith('/uploads/')) {
    const filepath = path.join(__dirname, source.url);
    if (fs.existsSync(filepath)) {
      try {
        fs.unlinkSync(filepath);
      } catch (err) {
        console.error(`Failed to delete source file ${filepath}:`, err);
      }
    }
  }

  scene.sources.splice(sourceIndex, 1);
  saveState();

  io.emit('state-updated', state);
  res.json({ success: true, message: 'Source deleted.' });
});

// 9. Get uploaded files in a collection
app.get('/api/collections/:id/files', (req, res) => {
  const { id } = req.params;
  const dir = path.join(UPLOADS_DIR, id);
  if (!fs.existsSync(dir)) {
    return res.json([]);
  }
  
  try {
    const filenames = fs.readdirSync(dir);
    const files = filenames.map(name => {
      const filePath = path.join(dir, name);
      const stats = fs.statSync(filePath);
      
      const ext = path.extname(name).toLowerCase();
      let type = 'other';
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext)) {
        type = 'image';
      } else if (['.mp4', '.webm', '.ogg', '.mov'].includes(ext)) {
        type = 'video';
      } else if (['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) {
        type = 'audio';
      }
      
      return {
        name,
        url: `/uploads/${id}/${name}`,
        size: stats.size,
        type
      };
    });
    res.json(files);
  } catch (err) {
    console.error(`Failed to read directory ${dir}:`, err);
    res.status(500).json({ error: 'Failed to read directory.' });
  }
});

// 10. Duplicate a collection
app.post('/api/collections/:id/duplicate', (req, res) => {
  const { id } = req.params;
  const srcCollection = state.collections.find(c => c.id === id);
  if (!srcCollection) return res.status(404).json({ error: 'Collection not found.' });

  const newId = `coll_${uuidv4().substring(0, 8)}`;
  const newDir = getCollectionDir(newId);
  const oldDir = path.join(UPLOADS_DIR, id);

  // Copy physical files if old directory exists
  if (fs.existsSync(oldDir)) {
    try {
      const files = fs.readdirSync(oldDir);
      files.forEach(file => {
        fs.copyFileSync(path.join(oldDir, file), path.join(newDir, file));
      });
    } catch (err) {
      console.error('Failed to copy physical files during duplication:', err);
    }
  }

  // Helper recursive mapping function to clone scenes and sources with fresh IDs
  const duplicatedScenes = srcCollection.scenes.map(oldScene => {
    const newSceneId = `scene_${uuidv4().substring(0, 8)}`;
    const duplicatedSources = oldScene.sources.map(oldSrc => {
      const newSrcId = `src_${uuidv4().substring(0, 8)}`;
      let newUrl = oldSrc.url;
      if (oldSrc.url && oldSrc.url.startsWith(`/uploads/${id}/`)) {
        newUrl = oldSrc.url.replace(`/uploads/${id}/`, `/uploads/${newId}/`);
      }
      
      return { ...oldSrc, id: newSrcId, url: newUrl };
    });
    
    return {
      id: newSceneId,
      name: oldScene.name,
      sources: duplicatedSources
    };
  });

  const newCollection = {
    id: newId,
    name: `${srcCollection.name} (Copy)`,
    folder: `uploads/${newId}`,
    scenes: duplicatedScenes
  };

  state.collections.push(newCollection);
  saveState();

  io.emit('state-updated', state);
  res.status(201).json(newCollection);
});

// 11. Rename a collection
app.put('/api/collections/:id/rename', (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Collection name is required.' });

  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  collection.name = name;
  saveState();

  io.emit('state-updated', state);
  res.json(collection);
});

// 12. Duplicate a scene
app.post('/api/collections/:id/scenes/:sceneId/duplicate', (req, res) => {
  const { id, sceneId } = req.params;
  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  const srcScene = collection.scenes.find(s => s.id === sceneId);
  if (!srcScene) return res.status(404).json({ error: 'Scene not found.' });

  const newSceneId = `scene_${uuidv4().substring(0, 8)}`;
  
  const duplicatedSources = srcScene.sources.map(oldSrc => {
    const newSrcId = `src_${uuidv4().substring(0, 8)}`;
    return { ...oldSrc, id: newSrcId };
  });

  const newScene = {
    id: newSceneId,
    name: `${srcScene.name} (Copy)`,
    sources: duplicatedSources
  };

  collection.scenes.push(newScene);
  saveState();

  io.emit('state-updated', state);
  res.status(201).json(newScene);
});

// 13. Rename a scene
app.put('/api/collections/:id/scenes/:sceneId/rename', (req, res) => {
  const { id, sceneId } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Scene name is required.' });

  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  const scene = collection.scenes.find(s => s.id === sceneId);
  if (!scene) return res.status(404).json({ error: 'Scene not found.' });

  scene.name = name;
  saveState();

  io.emit('state-updated', state);
  res.json(scene);
});

// 14. Reorder collections
app.put('/api/collections/reorder', (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'Order must be an array.' });

  const reordered = [];
  order.forEach(colId => {
    const col = state.collections.find(c => c.id === colId);
    if (col) reordered.push(col);
  });

  state.collections.forEach(col => {
    if (!reordered.find(c => c.id === col.id)) {
      reordered.push(col);
    }
  });

  state.collections = reordered;
  saveState();

  io.emit('state-updated', state);
  res.json({ success: true, collections: state.collections });
});

// 15. Reorder scenes
app.put('/api/collections/:id/scenes/reorder', (req, res) => {
  const { id } = req.params;
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'Order must be an array.' });

  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  const reordered = [];
  order.forEach(scId => {
    const sc = collection.scenes.find(s => s.id === scId);
    if (sc) reordered.push(sc);
  });

  collection.scenes.forEach(sc => {
    if (!reordered.find(s => s.id === sc.id)) {
      reordered.push(sc);
    }
  });

  collection.scenes = reordered;
  saveState();

  io.emit('state-updated', state);
  res.json({ success: true, scenes: collection.scenes });
});

// 16. Reorder sources
app.put('/api/collections/:id/scenes/:sceneId/sources/reorder', (req, res) => {
  const { id, sceneId } = req.params;
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'Order must be an array.' });

  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  const scene = collection.scenes.find(s => s.id === sceneId);
  if (!scene) return res.status(404).json({ error: 'Scene not found.' });

  const reordered = [];
  order.forEach(srcId => {
    const src = scene.sources.find(s => s.id === srcId);
    if (src) reordered.push(src);
  });

  scene.sources.forEach(src => {
    if (!reordered.find(s => s.id === src.id)) {
      reordered.push(src);
    }
  });

  scene.sources = reordered;
  saveState();

  io.emit('state-updated', state);
  res.json({ success: true, sources: scene.sources });
});


// Real-Time Socket Connection Handlers
let clients = new Set();
let displayStatus = { active: false, width: 0, height: 0, fullscreen: false };

io.on('connection', (socket) => {
  console.log(`New WebSocket connection established (ID: ${socket.id})`);
  clients.add(socket);

  // WebRTC signaling routing bridge
  socket.on('webrtc-signaling', (data) => {
    socket.broadcast.emit('webrtc-signaling', data);
  });

  // Send state immediately on connection
  socket.emit('sync-state', {
    state,
    displayStatus
  });

  // Client registration
  socket.on('register-client', (data) => {
    socket.role = data.role;
    console.log(`Client ${socket.id} registered as role: "${data.role}"`);
    if (data.role === 'display') {
      displayStatus.active = true;
      io.emit('display-status-updated', displayStatus);
    }
  });

  // Switch active Collection
  socket.on('change-collection', (data) => {
    const { collectionId } = data;
    const collection = state.collections.find(c => c.id === collectionId);
    if (collection) {
      state.activeCollectionId = collectionId;
      state.activeSceneId = collection.scenes.length > 0 ? collection.scenes[0].id : '';
      saveState();
      io.emit('collection-changed', {
        activeCollectionId: state.activeCollectionId,
        activeSceneId: state.activeSceneId,
        state
      });
      console.log(`Switched active collection to: ${collection.name} (${collectionId})`);
    }
  });

  // Switch active Scene
  socket.on('change-scene', (data) => {
    const { sceneId } = data;
    state.activeSceneId = sceneId;
    saveState();
    io.emit('scene-changed', { activeSceneId: sceneId });
    console.log(`Switched active scene to ID: ${sceneId}`);
  });

  // Real-time source control (Volume, Loop, Visible toggle)
  socket.on('control-source', (data) => {
    // data: { collectionId, sceneId, sourceId, property, value }
    const { collectionId, sceneId, sourceId, property, value } = data;

    // Mutate state directly
    const collection = state.collections.find(c => c.id === collectionId);
    if (collection) {
      const scene = collection.scenes.find(s => s.id === sceneId);
      if (scene) {
        const source = scene.sources.find(src => src.id === sourceId);
        if (source) {
          source[property] = value;
          saveState();

          // Broadcast delta change to other screens
          io.emit('source-controlled', { collectionId, sceneId, sourceId, property, value });
          console.log(`Source control: Source ${sourceId} property "${property}" updated to ${value}`);
        }
      }
    }
  });

  // Real-time text content updates (Typewriter dynamic edit)
  socket.on('update-text-content', (data) => {
    const { collectionId, sceneId, sourceId, content } = data;
    const collection = state.collections.find(c => c.id === collectionId);
    if (collection) {
      const scene = collection.scenes.find(s => s.id === sceneId);
      if (scene) {
        const source = scene.sources.find(src => src.id === sourceId);
        if (source && source.type === 'text') {
          source.content = content;
          saveState();
          io.emit('text-content-updated', { sourceId, content });
        }
      }
    }
  });

  // Report Display Window Screen status
  socket.on('display-status', (data) => {
    // data: { active, width, height, fullscreen }
    displayStatus = { ...displayStatus, ...data };
    io.emit('display-status-updated', displayStatus);
    console.log('Showing screen status updated:', displayStatus);
  });

  // Disconnection handler
  socket.on('disconnect', () => {
    clients.delete(socket);
    console.log(`WebSocket client disconnected (ID: ${socket.id})`);
    if (socket.role === 'display') {
      // Check if any other display client remains
      let displayExists = false;
      for (let s of io.sockets.sockets.values()) {
        if (s.role === 'display') displayExists = true;
      }
      if (!displayExists) {
        displayStatus.active = false;
        io.emit('display-status-updated', displayStatus);
        console.log('All fullscreen showing display pages disconnected.');
      }
    }
  });
});

// Resolve local network IP address
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const k in interfaces) {
    for (const k2 in interfaces[k]) {
      const address = interfaces[k][k2];
      if (address.family === 'IPv4' && !address.internal) {
        addresses.push(address.address);
      }
    }
  }
  return addresses;
}

// Boot Server
server.listen(PORT, () => {
  console.log('\n======================================================');
  console.log(`🚀 ScreenSwitching Server running on port ${PORT}`);
  console.log(`💻 Local Control Panel: http://localhost:${PORT}/control.html`);
  console.log(`📺 Fullscreen Output Screen: http://localhost:${PORT}/display.html`);

  const localIPs = getLocalIPs();
  if (localIPs.length > 0) {
    const remoteUrl = `http://${localIPs[0]}:${PORT}/remote.html`;
    console.log('\n📱 Smartphone Remote Control URL:');
    console.log(`👉 ${remoteUrl}`);

    // Print ASCII QR Code in terminal if available
    if (qrcodeTerminal) {
      console.log('\nScan this QR code with your phone to remote control:');
      qrcodeTerminal.generate(remoteUrl, { small: true });
    }
  } else {
    console.log('📱 Smartphone Remote Control URL: Connect device to local network');
  }
  console.log('======================================================\n');
});
